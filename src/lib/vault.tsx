"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";
import * as C from "./crypto";
import { normalizePhone } from "./phone";
import { freeSlug, isValidSlug, slugify } from "./slug";
import type { DocEntry, Folder, FolderItem, Group, Meta, PrintShare } from "./types";

type Keys = { privateKey: CryptoKey; publicKey: CryptoKey; hmacKey: CryptoKey };
type Secrets = { privateKey: string; hmacKey: string };
type Profile = { id: string; email: string | null; phone: string | null; display_name: string | null; public_key: string | null;
  vault: C.Sealed | null; vault_recovery: C.Sealed | null };

const BUCKET = "vault";
const IDLE_LOCK_MS = 15 * 60 * 1000;
const path = (owner: string, doc: string, i: number) => `${owner}/${doc}/${i}`;

function useVaultState() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [keys, setKeys] = useState<Keys | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [requests, setRequests] = useState<PrintShare[]>([]);
  const [loading, setLoading] = useState(false);
  const keysRef = useRef<Keys | null>(null);
  keysRef.current = keys;

  const uid = profile?.id ?? "";

  const loadProfile = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    let { data, error } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      // Account created before the database was set up: make the profile now
      const r = await supabase.rpc("ensure_profile");
      if (r.error) throw new Error("The database isn't set up yet. Run supabase/schema.sql in the Supabase SQL editor.");
      ({ data, error } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle());
      if (error) throw error;
      if (!data) throw new Error("Your profile can't be read. Run the latest supabase/schema.sql (see README, “Already ran an earlier schema”).");
    }
    setProfile(data as Profile);
    return data as Profile;
  }, []);

  // ── load everything I can see and decrypt it locally
  const refresh = useCallback(async (k?: Keys) => {
    const K = k ?? keysRef.current;
    if (!K) return;
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const me = u.user!.id;
      const [gm, gs, ds, dg, fs, fi, rq] = await Promise.all([
        supabase.from("group_members").select("*").eq("user_id", me),
        supabase.from("groups").select("*"),
        supabase.from("documents").select("*"),
        supabase.from("document_groups").select("*"),
        supabase.from("folders").select("*").order("name"),
        supabase.from("folder_items").select("*"),
        supabase.from("print_shares").select("*").eq("status", "requested"),
      ]);
      for (const r of [gm, gs, ds, dg, fs, fi, rq]) if (r.error) throw r.error;

      const groupList: Group[] = [];
      for (const m of gm.data!) {
        const g = gs.data!.find((x) => x.id === m.group_id);
        if (!g) continue;
        try {
          groupList.push({ id: g.id, name: g.name, ownerId: g.owner_id, isDefault: g.is_default,
            role: m.role, key: await C.unwrapWith(K.privateKey, m.wrapped_key) });
        } catch { /* key no longer valid */ }
      }
      groupList.sort((a, b) => Number(b.isDefault && b.ownerId === me) - Number(a.isDefault && a.ownerId === me) || a.name.localeCompare(b.name));

      const docList: DocEntry[] = [];
      for (const d of ds.data!) {
        const shares = dg.data!.filter((x) => x.document_id === d.id);
        let key: CryptoKey | null = null;
        try {
          if (d.owner_id === me) key = await C.unwrapWith(K.privateKey, d.owner_wrapped_key);
          else for (const s of shares) {
            const g = groupList.find((x) => x.id === s.group_id);
            if (g) { key = await C.importAes(await C.aesDecrypt(g.key, C.fromB64(s.wrapped_key))); break; }
          }
          if (!key) continue;
          const meta = await C.decryptJSON<Meta>(key, d.enc_meta);
          docList.push({ id: d.id, ownerId: d.owner_id, pageCount: d.page_count, contentHmac: d.content_hmac,
            slugHmac: d.slug_hmac, createdAt: d.created_at, updatedAt: d.updated_at, key, meta,
            groupIds: shares.map((s) => s.group_id).filter((g) => groupList.some((x) => x.id === g)) });
        } catch (e) { console.warn("Could not decrypt document", d.id, e); }
      }
      docList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      setGroups(groupList);
      setDocs(docList);
      setFolders(fs.data!.map((f) => ({ id: f.id, name: f.name, ownerId: f.owner_id, groupId: f.group_id })));
      setItems(fi.data!.map((i) => ({ folderId: i.folder_id, documentId: i.document_id })));
      setRequests(rq.data as PrintShare[]);
    } finally { setLoading(false); }
  }, []);

  // ── first-time vault setup: keys, recovery key, default Family group
  const setupVault = useCallback(async (displayName: string, phone: string, passphrase: string) => {
    const p = profile!;
    const pair = await C.newKeyPair();
    const secrets: Secrets = { privateKey: await C.exportPrivate(pair.privateKey), hmacKey: await C.newHmacKeyRaw() };
    const recoveryKey = C.newRecoveryKey();
    const { error } = await supabase.from("profiles").update({
      display_name: displayName.trim(), phone, public_key: await C.exportPublic(pair.publicKey),
      vault: await C.seal(passphrase, secrets), vault_recovery: await C.seal(recoveryKey, secrets),
    }).eq("id", p.id);
    if (error) throw error.code === "23505" ? new Error("That mobile number is already used by another account.") : error;
    const K: Keys = { privateKey: await C.importPrivate(secrets.privateKey), publicKey: pair.publicKey,
      hmacKey: await C.importHmac(secrets.hmacKey) };
    // Family group
    const gk = await C.newAesKey();
    const { data: g, error: ge } = await supabase.from("groups")
      .insert({ name: "Family", owner_id: p.id, is_default: true }).select().single();
    if (ge) throw ge;
    const { error: me } = await supabase.from("group_members")
      .insert({ group_id: g.id, user_id: p.id, role: "owner", wrapped_key: await C.wrapFor(pair.publicKey, gk) });
    if (me) throw me;
    await loadProfile();
    // The caller shows the recovery key first, then calls open()
    return { recoveryKey, open: async () => { setKeys(K); await refresh(K); } };
  }, [profile, loadProfile, refresh]);

  const openWith = useCallback(async (secrets: Secrets) => {
    const p = profile!;
    const K: Keys = { privateKey: await C.importPrivate(secrets.privateKey),
      publicKey: await C.importPublic(p.public_key!), hmacKey: await C.importHmac(secrets.hmacKey) };
    setKeys(K);
    await refresh(K);
  }, [profile, refresh]);

  const unlock = useCallback(async (passphrase: string) => {
    let s: Secrets;
    try { s = await C.unseal<Secrets>(passphrase, profile!.vault!); }
    catch { throw new Error("That vault passphrase is not correct."); }
    await openWith(s);
  }, [profile, openWith]);

  /** Recover with the paper key and set a new passphrase. */
  const recover = useCallback(async (recoveryKey: string, newPassphrase: string) => {
    let s: Secrets;
    try { s = await C.unseal<Secrets>(C.normalizeRecovery(recoveryKey), profile!.vault_recovery!); }
    catch { throw new Error("That recovery key is not correct."); }
    const { error } = await supabase.from("profiles").update({ vault: await C.seal(newPassphrase, s) }).eq("id", profile!.id);
    if (error) throw error;
    await loadProfile();
    await openWith(s);
  }, [profile, loadProfile, openWith]);

  const changePassphrase = useCallback(async (current: string, next: string) => {
    let s: Secrets;
    try { s = await C.unseal<Secrets>(current, profile!.vault!); }
    catch { throw new Error("Your current passphrase is not correct."); }
    const { error } = await supabase.from("profiles").update({ vault: await C.seal(next, s) }).eq("id", profile!.id);
    if (error) throw error;
    await loadProfile();
  }, [profile, loadProfile]);

  const lock = useCallback(() => {
    setKeys(null); setDocs([]); setGroups([]); setFolders([]); setItems([]); setRequests([]);
  }, []);

  // Auto-lock after 15 minutes of no activity
  useEffect(() => {
    if (!keys) return;
    let t = setTimeout(lock, IDLE_LOCK_MS);
    const bump = () => { clearTimeout(t); t = setTimeout(lock, IDLE_LOCK_MS); };
    const ev = ["pointerdown", "keydown", "scroll"];
    ev.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => { clearTimeout(t); ev.forEach((e) => window.removeEventListener(e, bump)); };
  }, [keys, lock]);

  // ── documents
  const takenSlugs = useMemo(() => new Set(docs.filter((d) => d.ownerId === uid).map((d) => d.meta.slug)), [docs, uid]);
  const suggestSlug = useCallback((name: string) => freeSlug(name, takenSlugs), [takenSlugs]);

  const contentHash = useCallback(async (files: File[]) => {
    const parts = await Promise.all(files.map(async (f) => C.toB64(await C.sha256(new Uint8Array(await f.arrayBuffer())))));
    return C.hmac(keys!.hmacKey, parts.join("|"));
  }, [keys]);

  /** Returns my documents that contain any of these exact files. */
  const findDuplicates = useCallback(async (files: File[]) => {
    const whole = await contentHash(files);
    const single = await Promise.all(files.map((f) => contentHash([f])));
    return docs.filter((d) => d.ownerId === uid && (d.contentHmac === whole || single.includes(d.contentHmac)));
  }, [contentHash, docs, uid]);

  const log = useCallback(async (documentId: string, event: string, detail?: string) => {
    await supabase.from("activity").insert({ document_id: documentId, actor_id: uid, event, detail });
  }, [uid]);

  const uploadDoc = useCallback(async (input: {
    files: File[]; name: string; slug: string; belongsTo: string; docNumber: string; expiry: string;
    ocrText: string; groupIds: string[]; folderIds: string[];
  }, onProgress?: (m: string) => void) => {
    const K = keys!;
    const slug = input.slug.trim();
    if (!isValidSlug(slug)) throw new Error("The ID can only use letters, numbers and single hyphens.");
    if (takenSlugs.has(slug)) throw new Error(`You already have a document with the ID "${slug}".`);
    const id = crypto.randomUUID();
    const dk = await C.newAesKey();
    const uploaded: string[] = [];
    try {
      for (let i = 0; i < input.files.length; i++) {
        onProgress?.(`Encrypting and uploading file ${i + 1} of ${input.files.length}`);
        const ct = await C.aesEncrypt(dk, new Uint8Array(await input.files[i].arrayBuffer()));
        const p = path(uid, id, i);
        const { error } = await supabase.storage.from(BUCKET).upload(p, new Blob([ct]), { contentType: "application/octet-stream" });
        if (error) throw error;
        uploaded.push(p);
      }
      const meta: Meta = {
        name: input.name.trim(), slug, belongsTo: input.belongsTo.trim() || undefined,
        docNumber: input.docNumber.trim() || undefined, expiry: input.expiry || undefined,
        ocrText: input.ocrText, createdAt: new Date().toISOString(),
        files: input.files.map((f) => ({ name: f.name, mime: f.type || "application/octet-stream", size: f.size })),
      };
      onProgress?.("Saving");
      const { error } = await supabase.from("documents").insert({
        id, owner_id: uid, slug_hmac: await C.hmac(K.hmacKey, `slug:${slug}`),
        content_hmac: await contentHash(input.files), enc_meta: await C.encryptJSON(dk, meta),
        owner_wrapped_key: await C.wrapFor(K.publicKey, dk), page_count: input.files.length,
      });
      if (error) throw error.code === "23505" ? new Error(`You already have a document with the ID "${slug}".`) : error;
    } catch (e) {
      if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
      throw e;
    }
    for (const gid of input.groupIds) {
      const g = groups.find((x) => x.id === gid)!;
      await supabase.from("document_groups").insert({ document_id: id, group_id: gid,
        wrapped_key: C.toB64(await C.aesEncrypt(g.key, await C.exportRaw(dk))) });
    }
    if (input.folderIds.length)
      await supabase.from("folder_items").insert(input.folderIds.map((f) => ({ folder_id: f, document_id: id })));
    await log(id, "uploaded");
    await refresh();
    return id;
  }, [keys, uid, groups, takenSlugs, contentHash, log, refresh]);

  const updateMeta = useCallback(async (doc: DocEntry, patch: Partial<Omit<Meta, "slug" | "files" | "createdAt">>) => {
    const meta = { ...doc.meta, ...patch };
    const { error } = await supabase.from("documents")
      .update({ enc_meta: await C.encryptJSON(doc.key, meta), updated_at: new Date().toISOString() }).eq("id", doc.id);
    if (error) throw error;
    await log(doc.id, "edited");
    await refresh();
  }, [log, refresh]);

  const setDocGroups = useCallback(async (doc: DocEntry, groupIds: string[]) => {
    const add = groupIds.filter((g) => !doc.groupIds.includes(g));
    const remove = doc.groupIds.filter((g) => !groupIds.includes(g));
    for (const gid of add) {
      const g = groups.find((x) => x.id === gid)!;
      const { error } = await supabase.from("document_groups").insert({ document_id: doc.id, group_id: gid,
        wrapped_key: C.toB64(await C.aesEncrypt(g.key, await C.exportRaw(doc.key))) });
      if (error) throw error;
      await log(doc.id, "shared_with_group", g.name);
    }
    for (const gid of remove) {
      const fids = folders.filter((f) => f.groupId === gid).map((f) => f.id);
      if (fids.length) await supabase.from("folder_items").delete().eq("document_id", doc.id).in("folder_id", fids);
      const { error } = await supabase.from("document_groups").delete().eq("document_id", doc.id).eq("group_id", gid);
      if (error) throw error;
      await log(doc.id, "unshared_from_group", groups.find((x) => x.id === gid)?.name);
    }
    await refresh();
  }, [groups, folders, log, refresh]);

  const deleteDoc = useCallback(async (doc: DocEntry) => {
    const paths = Array.from({ length: doc.pageCount }, (_, i) => path(doc.ownerId, doc.id, i));
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) throw error;
    await supabase.storage.from(BUCKET).remove(paths);
    await refresh();
  }, [refresh]);

  /** Download and decrypt a document's files. */
  const openFiles = useCallback(async (doc: DocEntry) => {
    const out: { mime: string; name: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
    for (let i = 0; i < doc.pageCount; i++) {
      const { data, error } = await supabase.storage.from(BUCKET).download(path(doc.ownerId, doc.id, i));
      if (error) throw error;
      const f = doc.meta.files[i];
      out.push({ mime: f?.mime ?? "application/octet-stream", name: f?.name ?? `file-${i + 1}`,
        bytes: await C.aesDecrypt(doc.key, new Uint8Array(await data.arrayBuffer())) });
    }
    return out;
  }, []);

  // ── folders
  const createFolder = useCallback(async (name: string, groupId: string | null) => {
    const { error } = await supabase.from("folders").insert(groupId ? { name: name.trim(), group_id: groupId } : { name: name.trim(), owner_id: uid });
    if (error) throw error;
    await refresh();
  }, [uid, refresh]);
  const renameFolder = useCallback(async (id: string, name: string) => {
    const { error } = await supabase.from("folders").update({ name: name.trim() }).eq("id", id);
    if (error) throw error; await refresh();
  }, [refresh]);
  const deleteFolder = useCallback(async (id: string) => {
    const { error } = await supabase.from("folders").delete().eq("id", id);
    if (error) throw error; await refresh();
  }, [refresh]);
  const setDocFolders = useCallback(async (doc: DocEntry, folderIds: string[]) => {
    const current = items.filter((i) => i.documentId === doc.id).map((i) => i.folderId);
    const add = folderIds.filter((f) => !current.includes(f));
    const remove = current.filter((f) => !folderIds.includes(f));
    if (add.length) {
      const { error } = await supabase.from("folder_items").insert(add.map((f) => ({ folder_id: f, document_id: doc.id })));
      if (error) throw error;
    }
    if (remove.length) {
      const { error } = await supabase.from("folder_items").delete().eq("document_id", doc.id).in("folder_id", remove);
      if (error) throw error;
    }
    await refresh();
  }, [items, refresh]);

  // ── groups
  const createGroup = useCallback(async (name: string) => {
    const gk = await C.newAesKey();
    const { data: g, error } = await supabase.from("groups").insert({ name: name.trim(), owner_id: uid }).select().single();
    if (error) throw error;
    const { error: me } = await supabase.from("group_members").insert({ group_id: g.id, user_id: uid, role: "owner",
      wrapped_key: await C.wrapFor(keys!.publicKey, gk) });
    if (me) throw me;
    await refresh();
    return g.id as string;
  }, [uid, keys, refresh]);
  const renameGroup = useCallback(async (id: string, name: string) => {
    const { error } = await supabase.from("groups").update({ name: name.trim() }).eq("id", id);
    if (error) throw error; await refresh();
  }, [refresh]);
  const deleteGroup = useCallback(async (id: string) => {
    const { error } = await supabase.from("groups").delete().eq("id", id);
    if (error) throw error; await refresh();
  }, [refresh]);
  const addMember = useCallback(async (groupId: string, phone: string) => {
    const full = normalizePhone(phone);
    if (!full) throw new Error("Enter a Nepali mobile number, like 98XXXXXXXX.");
    const { data, error } = await supabase.rpc("find_user_by_phone", { p: full });
    if (error) throw error;
    const person = data?.[0];
    if (!person) throw new Error("No one with that number has set up NijiDocs yet. Ask them to sign up and create their vault first.");
    const g = groups.find((x) => x.id === groupId)!;
    const { error: e2 } = await supabase.from("group_members").insert({ group_id: groupId, user_id: person.id, role: "member",
      wrapped_key: await C.wrapFor(await C.importPublic(person.public_key), g.key) });
    if (e2) throw e2.code === "23505" ? new Error("That person is already in this group.") : e2;
    return person.display_name as string;
  }, [groups]);
  const removeMember = useCallback(async (groupId: string, userId: string) => {
    const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
    if (error) throw error;
    if (userId === uid) await refresh();
  }, [uid, refresh]);
  const members = useCallback(async (groupId: string) => {
    const { data, error } = await supabase.rpc("group_member_profiles", { g: groupId });
    if (error) throw error;
    return data as { user_id: string; display_name: string | null; phone: string | null; role: string }[];
  }, []);

  // ── print links: the document key travels in the #fragment, which browsers never send to servers
  const createPrintLink = useCallback(async (doc: DocEntry) => {
    const { data, error } = await supabase.from("print_shares").insert({ document_id: doc.id, created_by: uid }).select().single();
    if (error) throw error;
    await log(doc.id, "print_link_created");
    const raw = await C.exportRaw(doc.key);
    return { share: data as PrintShare, url: `${location.origin}/p/${data.id}#k=${C.toB64(raw)}` };
  }, [uid, log]);
  const printLinkUrl = useCallback(async (doc: DocEntry, shareId: string) =>
    `${location.origin}/p/${shareId}#k=${C.toB64(await C.exportRaw(doc.key))}`, []);
  const listShares = useCallback(async (docId: string) => {
    const { data, error } = await supabase.from("print_shares").select("*").eq("document_id", docId).order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    return data as PrintShare[];
  }, []);
  const approveShare = useCallback(async (id: string) => {
    const { error } = await supabase.rpc("extend_print_share", { s: id });
    if (error) throw error; await refresh();
  }, [refresh]);
  const revokeShare = useCallback(async (id: string) => {
    const { error } = await supabase.rpc("revoke_print_share", { s: id });
    if (error) throw error; await refresh();
  }, [refresh]);
  const activity = useCallback(async (docId: string) => {
    const { data, error } = await supabase.from("activity").select("*").eq("document_id", docId).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return data as { id: number; event: string; detail: string | null; actor_id: string | null; created_at: string }[];
  }, []);

  return {
    profile, loadProfile, keys, unlocked: !!keys, uid, loading, groups, docs, folders, items, requests,
    refresh, setupVault, unlock, recover, changePassphrase, lock,
    suggestSlug, takenSlugs, slugify, findDuplicates, uploadDoc, updateMeta, setDocGroups, deleteDoc, openFiles, log,
    createFolder, renameFolder, deleteFolder, setDocFolders,
    createGroup, renameGroup, deleteGroup, addMember, removeMember, members,
    createPrintLink, printLinkUrl, listShares, approveShare, revokeShare, activity,
  };
}

export type Vault = ReturnType<typeof useVaultState>;
const Ctx = createContext<Vault | null>(null);
export function VaultProvider({ children }: { children: React.ReactNode }) {
  const v = useVaultState();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useVault = () => useContext(Ctx)!;
