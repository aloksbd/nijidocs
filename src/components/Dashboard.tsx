"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useVault } from "@/lib/vault";
import { buildIndex, search } from "@/lib/search";
import { supabase } from "@/lib/supabase";
import type { DocEntry, Folder } from "@/lib/types";
import { DocGrid } from "./DocGrid";
import { UploadDialog } from "./UploadDialog";
import { DocView } from "./DocView";
import { GroupView } from "./GroupView";
import { Brand, Dialog, SearchIcon, errMsg } from "./ui";

export type View =
  | { kind: "all" } | { kind: "mine" } | { kind: "folder"; id: string } | { kind: "group"; id: string }
  | { kind: "doc"; id: string } | { kind: "requests" } | { kind: "settings" };

export function Dashboard() {
  const v = useVault();
  const [view, setViewState] = useState<View>({ kind: "all" });
  const [q, setQ] = useState("");
  const [upload, setUpload] = useState<{ groupId?: string; folderId?: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [newFolderFor, setNewFolderFor] = useState<string | null | undefined>(undefined); // null = personal
  const [newGroup, setNewGroup] = useState(false);

  // Browser back button moves between views
  const setView = useCallback((next: View) => {
    history.pushState(next, "");
    setViewState(next); setMenu(false); window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    history.replaceState({ kind: "all" }, "");
    const pop = (e: PopStateEvent) => setViewState((e.state as View) ?? { kind: "all" });
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const groupName = useCallback((id: string) => v.groups.find((g) => g.id === id)?.name ?? "Group", [v.groups]);
  const placeNames = useCallback((d: DocEntry) => [
    ...d.groupIds.map(groupName),
    ...v.items.filter((i) => i.documentId === d.id).map((i) => v.folders.find((f) => f.id === i.folderId)?.name ?? ""),
  ], [groupName, v.items, v.folders]);
  const index = useMemo(() => buildIndex(v.docs, placeNames), [v.docs, placeNames]);
  const results = useMemo(() => {
    const ids = search(index, q);
    return ids.map((id) => v.docs.find((d) => d.id === id)!).filter(Boolean);
  }, [index, q, v.docs]);

  const personalFolders = v.folders.filter((f) => f.ownerId === v.uid);
  const docsIn = (folderId: string) => v.items.filter((i) => i.folderId === folderId).map((i) => v.docs.find((d) => d.id === i.documentId)).filter(Boolean) as DocEntry[];

  const title = (() => {
    switch (view.kind) {
      case "all": return "All documents";
      case "mine": return "Only me";
      case "folder": return v.folders.find((f) => f.id === view.id)?.name ?? "Folder";
      default: return "";
    }
  })();

  let list: DocEntry[] = [];
  if (view.kind === "all") list = v.docs;
  if (view.kind === "mine") list = v.docs.filter((d) => d.ownerId === v.uid && d.groupIds.length === 0);
  if (view.kind === "folder") list = docsIn(view.id);
  const folder = view.kind === "folder" ? v.folders.find((f) => f.id === view.id) : undefined;
  const searching = q.trim().length > 0;

  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn btn-ghost menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
        <button className="btn btn-ghost hide-sm" style={{ padding: 0 }} onClick={() => { setQ(""); setView({ kind: "all" }); }}><Brand /></button>
        <div className="search" role="search">
          <SearchIcon />
          <input className="input" type="search" placeholder="Search names, numbers, or any text in a document"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
        </div>
        <button className="btn btn-primary" onClick={() => setUpload({})}>Upload</button>
        <button className="btn btn-ghost hide-sm" onClick={v.lock}>Lock</button>
      </header>

      <nav className={`side ${menu ? "open" : ""}`} aria-label="Documents">
        <div className="side-group">
          <Nav cur={view.kind === "all"} onClick={() => setView({ kind: "all" })} label="All documents" count={v.docs.length} />
          <Nav cur={view.kind === "mine"} onClick={() => setView({ kind: "mine" })} label="Only me"
            count={v.docs.filter((d) => d.ownerId === v.uid && d.groupIds.length === 0).length} />
          {v.requests.length > 0 && (
            <button className="nav" aria-current={view.kind === "requests"} onClick={() => setView({ kind: "requests" })}>
              Print requests <span className="badge">{v.requests.length}</span>
            </button>
          )}
        </div>

        <div className="side-group">
          <div className="side-head">My folders<button className="btn btn-ghost btn-sm" onClick={() => setNewFolderFor(null)} aria-label="New folder">+ New</button></div>
          {personalFolders.map((f) => <FolderNav key={f.id} f={f} cur={view.kind === "folder" && view.id === f.id} count={docsIn(f.id).length} onClick={() => setView({ kind: "folder", id: f.id })} />)}
          {personalFolders.length === 0 && <p className="hint" style={{ padding: "0 10px" }}>Try Academic, Government or Work.</p>}
        </div>

        <div className="side-group">
          <div className="side-head">Shared groups<button className="btn btn-ghost btn-sm" onClick={() => setNewGroup(true)}>+ New</button></div>
          {v.groups.map((g) => (
            <div key={g.id}>
              <Nav cur={view.kind === "group" && view.id === g.id} onClick={() => setView({ kind: "group", id: g.id })}
                label={g.name} count={v.docs.filter((d) => d.groupIds.includes(g.id)).length} />
              <div className="sub">
                {v.folders.filter((f) => f.groupId === g.id).map((f) => (
                  <FolderNav key={f.id} f={f} cur={view.kind === "folder" && view.id === f.id} count={docsIn(f.id).length} onClick={() => setView({ kind: "folder", id: f.id })} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="side-group">
          <Nav cur={view.kind === "settings"} onClick={() => setView({ kind: "settings" })} label="Settings" />
          <button className="nav" onClick={v.lock}>Lock vault</button>
        </div>
      </nav>

      <main className="main">
        {searching && view.kind !== "doc" ? (
          <>
            <div className="main-head"><div><h1>Results for “{q.trim()}”</h1>
              <p className="muted">{results.length} document{results.length === 1 ? "" : "s"}. Searches names, IDs, owners, numbers, folders and the text read from each document.</p></div></div>
            {results.length ? <DocGrid docs={results} query={q} onOpen={(id) => setView({ kind: "doc", id })} groupName={groupName} uid={v.uid} />
              : <div className="empty"><h2>No matches</h2><p className="muted">Try fewer words, part of a number, or the person&apos;s name.</p></div>}
          </>
        ) : view.kind === "doc" ? (
          <DocView id={view.id} onBack={() => history.back()} />
        ) : view.kind === "group" ? (
          <GroupView id={view.id} onOpen={(id) => setView({ kind: "doc", id })} onOpenFolder={(id) => setView({ kind: "folder", id })}
            onNewFolder={() => setNewFolderFor(view.id)} onUpload={() => setUpload({ groupId: view.id })} onLeft={() => setView({ kind: "all" })} />
        ) : view.kind === "requests" ? (
          <Requests />
        ) : view.kind === "settings" ? (
          <Settings />
        ) : (
          <>
            <div className="main-head">
              <div>
                <h1>{title}</h1>
                <p className="muted">
                  {folder?.groupId ? `Folder in ${groupName(folder.groupId)}` : folder ? "Your folder, only you see this arrangement" : `${list.length} document${list.length === 1 ? "" : "s"}`}
                </p>
              </div>
              {folder && <FolderActions folder={folder} onDeleted={() => setView({ kind: "all" })} onUpload={() => setUpload({ folderId: folder.id, groupId: folder.groupId ?? undefined })} />}
            </div>
            {list.length ? <DocGrid docs={list} onOpen={(id) => setView({ kind: "doc", id })} groupName={groupName} uid={v.uid} />
              : <div className="empty">
                  <h2>{folder ? "This folder is empty" : "Nothing here yet"}</h2>
                  <p className="muted">{folder ? "Upload a document here, or add ones you already have." : "Upload a photo or PDF of a document. Its text is read on this device so you can search it later."}</p>
                  <button className="btn btn-primary" onClick={() => setUpload(folder ? { folderId: folder.id, groupId: folder.groupId ?? undefined } : {})}>Upload a document</button>
                </div>}
          </>
        )}
      </main>

      {upload && <UploadDialog preset={upload} onClose={() => setUpload(null)} onDone={(id) => { setUpload(null); setQ(""); setView({ kind: "doc", id }); }} />}
      {newFolderFor !== undefined && (
        <NameDialog title={newFolderFor ? `New folder in ${groupName(newFolderFor)}` : "New folder"} label="Folder name" action="Create folder"
          onClose={() => setNewFolderFor(undefined)} onSave={(n) => v.createFolder(n, newFolderFor)} />
      )}
      {newGroup && (
        <NameDialog title="New shared group" label="Group name" action="Create group" hint="For example Office, Relatives or Hostel. You'll add people next."
          onClose={() => setNewGroup(false)} onSave={async (n) => { const id = await v.createGroup(n); setView({ kind: "group", id }); }} />
      )}
    </div>
  );
}

function Nav({ cur, onClick, label, count }: { cur: boolean; onClick: () => void; label: string; count?: number }) {
  return <button className="nav" aria-current={cur} onClick={onClick}>{label}{count !== undefined && <span className="count">{count}</span>}</button>;
}
function FolderNav({ f, cur, count, onClick }: { f: Folder; cur: boolean; count: number; onClick: () => void }) {
  return <button className="nav" aria-current={cur} onClick={onClick}><span className="tab-icon" aria-hidden />{f.name}<span className="count">{count}</span></button>;
}

export function NameDialog({ title, label, action, hint, initial = "", onClose, onSave }: {
  title: string; label: string; action: string; hint?: string; initial?: string; onClose: () => void; onSave: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); if (!name.trim()) return;
        setBusy(true); setError("");
        try { await onSave(name); onClose(); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
      }}>
        <label className="field"><span>{label}</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        {hint && <p className="hint">{hint}</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><button className="btn btn-primary" disabled={busy || !name.trim()}>{action}</button></div>
      </form>
    </Dialog>
  );
}

function FolderActions({ folder, onDeleted, onUpload }: { folder: Folder; onDeleted: () => void; onUpload: () => void }) {
  const v = useVault();
  const [rename, setRename] = useState(false);
  const [adding, setAdding] = useState(false);
  return (
    <div className="row">
      <button className="btn btn-sm" onClick={() => setAdding(true)}>Add documents</button>
      <button className="btn btn-sm" onClick={onUpload}>Upload here</button>
      <button className="btn btn-sm" onClick={() => setRename(true)}>Rename</button>
      <button className="btn btn-sm btn-danger" onClick={async () => {
        if (!confirm(`Delete the folder "${folder.name}"? The documents stay in your vault.`)) return;
        await v.deleteFolder(folder.id); onDeleted();
      }}>Delete folder</button>
      {rename && <NameDialog title="Rename folder" label="Folder name" action="Save name" initial={folder.name} onClose={() => setRename(false)} onSave={(n) => v.renameFolder(folder.id, n)} />}
      {adding && <AddToFolder folder={folder} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddToFolder({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const v = useVault();
  const inFolder = new Set(v.items.filter((i) => i.folderId === folder.id).map((i) => i.documentId));
  const eligible = v.docs.filter((d) => !inFolder.has(d.id) && (folder.groupId ? d.groupIds.includes(folder.groupId) : true));
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Add to ${folder.name}`} onClose={onClose}>
      {folder.groupId && <p className="hint">Only documents already shared with this group can go in its folders.</p>}
      {eligible.length === 0 ? <p className="muted">Every eligible document is already in this folder.</p> : (
        <div style={{ maxHeight: 360, overflow: "auto" }}>
          {eligible.map((d) => (
            <label key={d.id} className="check"><input type="checkbox" checked={picked.includes(d.id)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))} />
              <span>{d.meta.name} <span className="muted small">{d.meta.slug}</span></span></label>
          ))}
        </div>
      )}
      <div className="row"><button className="btn btn-primary" disabled={busy || !picked.length} onClick={async () => {
        setBusy(true);
        await supabase.from("folder_items").insert(picked.map((id) => ({ folder_id: folder.id, document_id: id })));
        await v.refresh(); onClose();
      }}>Add {picked.length || ""} document{picked.length === 1 ? "" : "s"}</button></div>
    </Dialog>
  );
}

function Requests() {
  const v = useVault();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="main-head"><div><h1>Print requests</h1><p className="muted">A print link ran out of time and the person printing asked for 15 more minutes.</p></div></div>
      {v.requests.map((r) => {
        const d = v.docs.find((x) => x.id === r.document_id);
        return (
          <div key={r.id} className="panel spread">
            <div><h3>{d?.meta.name ?? "Document"}</h3><p className="small muted">Link made {new Date(r.created_at).toLocaleString()} · request {r.request_count} of 5</p></div>
            <div className="row">
              <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={async () => { setBusy(r.id); await v.approveShare(r.id); setBusy(null); }}>Allow 15 minutes</button>
              <button className="btn btn-danger btn-sm" disabled={busy === r.id} onClick={async () => { setBusy(r.id); await v.revokeShare(r.id); setBusy(null); }}>Turn off link</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Settings() {
  const v = useVault();
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <h1>Settings</h1>
      <div className="panel">
        <h2>Account</h2>
        <p>{v.profile?.display_name}<br /><span className="muted small">{v.profile?.email}, +{v.profile?.phone}</span></p>
        <div className="row">
          <button className="btn" onClick={v.lock}>Lock vault</button>
          <button className="btn" onClick={() => { v.lock(); supabase.auth.signOut(); }}>Sign out</button>
        </div>
      </div>
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault(); setMsg(""); setErr("");
        if (next.length < 10) return setErr("Use at least 10 characters.");
        try { await v.changePassphrase(cur, next); setMsg("Passphrase changed."); setCur(""); setNext(""); } catch (x) { setErr(errMsg(x)); }
      }}>
        <h2>Change vault passphrase</h2>
        <label className="field"><span>Current passphrase</span><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label className="field"><span>New passphrase</span><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        {err && <p className="error">{err}</p>}{msg && <p style={{ color: "var(--ok)" }}>{msg}</p>}
        <div className="row"><button className="btn btn-primary">Change passphrase</button></div>
        <p className="hint">Your recovery key keeps working after this change.</p>
      </form>
      <div className="panel">
        <h2>How your documents are protected</h2>
        <p className="small muted">Files, names, IDs and the text read from documents are encrypted on this device before upload. The server stores only scrambled data it cannot read. Your vault locks itself after 15 minutes without activity. Folder and group names are not encrypted, so keep them general.</p>
      </div>
    </div>
  );
}
