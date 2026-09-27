"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVault } from "@/lib/vault";
import type { PrintShare } from "@/lib/types";
import { DocPages, type PlainFile } from "./DocPages";
import { expiryChip } from "./DocGrid";
import { Spinner, errMsg } from "./ui";

const EVENT_LABEL: Record<string, string> = {
  uploaded: "Uploaded", edited: "Details edited", viewed: "Opened", shared_with_group: "Shared with",
  unshared_from_group: "Stopped sharing with", print_link_created: "Print link made", print_link_opened: "Print link opened",
  print_access_requested: "Printer asked for more time", print_access_approved: "15 more minutes allowed", print_link_revoked: "Print link turned off",
  downloaded: "Downloaded",
};

function useCountdown(to?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!to) return 0;
  return Math.max(0, Math.floor((new Date(to).getTime() - now) / 1000));
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function DocView({ id, onBack }: { id: string; onBack: () => void }) {
  const v = useVault();
  const doc = v.docs.find((d) => d.id === id);
  const isOwner = doc?.ownerId === v.uid;
  const [files, setFiles] = useState<PlainFile[] | null>(null);
  const [error, setError] = useState("");
  const logged = useRef(false);

  useEffect(() => {
    if (!doc) return;
    let dead = false;
    v.openFiles(doc).then((f) => !dead && setFiles(f)).catch((e) => !dead && setError(errMsg(e)));
    if (!logged.current) { logged.current = true; v.log(doc.id, "viewed"); }
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  if (!doc) return <div className="empty"><h2>This document isn&apos;t available</h2><p className="muted">It may have been deleted or is no longer shared with you.</p><button className="btn" onClick={onBack}>Go back</button></div>;

  return (
    <div className="stack">
      <div className="spread">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>Back</button>
        {files && (
          <div className="row">
            {files.map((f, i) => (
              <button key={i} className="btn btn-sm" onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([f.bytes], { type: f.mime }));
                a.download = f.name ?? `${doc.meta.slug}-${i + 1}`; a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                v.log(doc.id, "downloaded");
              }}>Download{files.length > 1 ? ` ${i + 1}` : ""}</button>
            ))}
          </div>
        )}
      </div>
      <div>
        <h1>{doc.meta.name}</h1>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="stamp" title="Permanent ID">{doc.meta.slug}</span>
          {expiryChip(doc.meta.expiry)}
          {!isOwner && <span className="chip">Shared with you</span>}
        </div>
      </div>
      <div className="doc-layout">
        <section aria-label="Pages">{error ? <p className="error">{error}</p> : <DocPages files={files} />}</section>
        <aside className="stack">
          <PrintPanel docId={doc.id} />
          <DetailsPanel docId={doc.id} />
          {isOwner && <SharingPanel docId={doc.id} />}
          <FoldersPanel docId={doc.id} />
          {isOwner && <ActivityPanel docId={doc.id} />}
          {isOwner && (
            <button className="btn btn-danger" onClick={async () => {
              if (!confirm(`Delete "${doc.meta.name}" for everyone? This can't be undone.`)) return;
              await v.deleteDoc(doc); onBack();
            }}>Delete document</button>
          )}
        </aside>
      </div>
    </div>
  );
}

function PrintPanel({ docId }: { docId: string }) {
  const v = useVault();
  const doc = v.docs.find((d) => d.id === docId)!;
  const [shares, setShares] = useState<PrintShare[]>([]);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => v.listShares(docId).then(setShares).catch(() => {}), [v, docId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [docId]);
  const current = link ? shares.find((s) => s.id === link.id) : undefined;
  const left = useCountdown(current?.expires_at);

  async function make() {
    setBusy(true); setError(""); setCopied(false);
    try { const r = await v.createPrintLink(doc); setLink({ id: r.share.id, url: r.url }); setShares((s) => [r.share, ...s]); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  async function copy(url: string) { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  const others = shares.filter((s) => s.id !== link?.id && s.status !== "revoked").slice(0, 5);
  return (
    <div className="panel">
      <h2>Send for printing</h2>
      <p className="small muted">Make a link the print shop can open in their browser to print. It works for 15 minutes. After that they can ask you for more time.</p>
      {link && current ? (
        <div className="stack">
          <div className="link-box">
            <input className="input" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Print link" />
            <button className="btn btn-primary btn-sm" onClick={() => copy(link.url)}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <div className="spread">
            <a className="btn btn-sm" href={`https://wa.me/?text=${encodeURIComponent(link.url)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
            {current.status === "revoked" ? <span className="small muted">Turned off</span>
              : left > 0 ? <span className="small">Works for <span className="timer">{mmss(left)}</span></span>
              : <span className="small muted">Time is up</span>}
          </div>
          {current.status !== "revoked" && <button className="btn btn-danger btn-sm" style={{ justifySelf: "start" }} onClick={async () => { await v.revokeShare(current.id); load(); }}>Turn off now</button>}
          <button className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={make} disabled={busy}>Make a new link</button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={make} disabled={busy}>{busy ? <Spinner /> : "Make print link"}</button>
      )}
      {error && <p className="error">{error}</p>}
      {others.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Earlier links</h3>
          {others.map((s) => <ShareRow key={s.id} s={s} onChange={load} docId={docId} />)}
        </div>
      )}
    </div>
  );
}

function ShareRow({ s, onChange, docId }: { s: PrintShare; onChange: () => void; docId: string }) {
  const v = useVault();
  const left = useCountdown(s.expires_at);
  const doc = v.docs.find((d) => d.id === docId)!;
  return (
    <div className="spread small">
      <span className="muted">{new Date(s.created_at).toLocaleString()}{s.status === "requested" ? ", asking for more time" : left > 0 ? `, ${mmss(left)} left` : ", expired"}</span>
      <span className="row">
        {s.status === "requested" && <button className="btn btn-primary btn-sm" onClick={async () => { await v.approveShare(s.id); onChange(); }}>Allow 15 min</button>}
        {left > 0 && <button className="btn btn-sm" onClick={async () => navigator.clipboard.writeText(await v.printLinkUrl(doc, s.id))}>Copy</button>}
        <button className="btn btn-sm btn-danger" onClick={async () => { await v.revokeShare(s.id); onChange(); }}>Turn off</button>
      </span>
    </div>
  );
}

function DetailsPanel({ docId }: { docId: string }) {
  const v = useVault();
  const doc = v.docs.find((d) => d.id === docId)!;
  const isOwner = doc.ownerId === v.uid;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ ...doc.meta });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!edit) setF({ ...doc.meta }); }, [doc.meta, edit]);

  if (!edit) return (
    <div className="panel">
      <div className="spread"><h2>Details</h2>{isOwner && <button className="btn btn-sm" onClick={() => setEdit(true)}>Edit</button>}</div>
      <dl className="stack small" style={{ gap: 6 }}>
        <Row k="Permanent ID" v={doc.meta.slug} />
        <Row k="Belongs to" v={doc.meta.belongsTo} />
        <Row k="Document number" v={doc.meta.docNumber} />
        <Row k="Expiry date" v={doc.meta.expiry && new Date(doc.meta.expiry).toLocaleDateString()} />
        <Row k="Added" v={new Date(doc.createdAt).toLocaleDateString()} />
      </dl>
      <details><summary className="small" style={{ cursor: "pointer" }}>Text used for search ({(doc.meta.ocrText ?? "").split(/\s+/).filter(Boolean).length} words)</summary>
        <p className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: 8, maxHeight: 240, overflow: "auto" }}>{doc.meta.ocrText || "No text was read from this document."}</p></details>
    </div>
  );
  return (
    <form className="panel" onSubmit={async (e) => {
      e.preventDefault(); if (!f.name.trim()) return setError("Enter a name.");
      setBusy(true); setError("");
      try { await v.updateMeta(doc, { name: f.name, belongsTo: f.belongsTo, docNumber: f.docNumber, expiry: f.expiry, ocrText: f.ocrText }); setEdit(false); }
      catch (x) { setError(errMsg(x)); } finally { setBusy(false); }
    }}>
      <h2>Edit details</h2>
      <label className="field"><span>Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Permanent ID</span><input className="input" value={f.slug} readOnly /><span className="hint">IDs can&apos;t be changed after a document is saved.</span></label>
      <label className="field"><span>Belongs to</span><input className="input" value={f.belongsTo ?? ""} onChange={(e) => setF({ ...f, belongsTo: e.target.value })} /></label>
      <label className="field"><span>Document number</span><input className="input" value={f.docNumber ?? ""} onChange={(e) => setF({ ...f, docNumber: e.target.value })} /></label>
      <label className="field"><span>Expiry date</span><input className="input" type="date" value={f.expiry ?? ""} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></label>
      <label className="field"><span>Text used for search</span><textarea className="input" rows={6} value={f.ocrText ?? ""} onChange={(e) => setF({ ...f, ocrText: e.target.value })} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="btn btn-primary" disabled={busy}>Save details</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(false)}>Cancel</button></div>
    </form>
  );
}
const Row = ({ k, v }: { k: string; v?: string | false }) => (
  <div className="spread"><dt className="muted">{k}</dt><dd style={{ textAlign: "right", wordBreak: "break-word" }}>{v || "—"}</dd></div>
);

function SharingPanel({ docId }: { docId: string }) {
  const v = useVault();
  const doc = v.docs.find((d) => d.id === docId)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="panel">
      <h2>Who can see it</h2>
      {v.groups.map((g) => (
        <label key={g.id} className="check"><input type="checkbox" disabled={busy} checked={doc.groupIds.includes(g.id)}
          onChange={async (e) => {
            setBusy(true); setError("");
            try { await v.setDocGroups(doc, e.target.checked ? [...doc.groupIds, g.id] : doc.groupIds.filter((x) => x !== g.id)); }
            catch (x) { setError(errMsg(x)); } finally { setBusy(false); }
          }} />{g.name}</label>
      ))}
      <p className="hint">{doc.groupIds.length ? "Unchecking a group also removes the document from that group's folders." : "Only you can see this document."}</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function FoldersPanel({ docId }: { docId: string }) {
  const v = useVault();
  const doc = v.docs.find((d) => d.id === docId)!;
  const choices = v.folders.filter((f) => f.ownerId === v.uid || (f.groupId && doc.groupIds.includes(f.groupId)));
  const current = v.items.filter((i) => i.documentId === docId).map((i) => i.folderId);
  const [busy, setBusy] = useState(false);
  if (!choices.length) return null;
  return (
    <div className="panel">
      <h2>Folders</h2>
      {choices.map((f) => (
        <label key={f.id} className="check"><input type="checkbox" disabled={busy} checked={current.includes(f.id)}
          onChange={async (e) => { setBusy(true); await v.setDocFolders(doc, e.target.checked ? [...current, f.id] : current.filter((x) => x !== f.id)).finally(() => setBusy(false)); }} />
          <span className="tab-icon" aria-hidden />{f.name}{f.groupId && <span className="muted small">in {v.groups.find((g) => g.id === f.groupId)?.name}</span>}</label>
      ))}
    </div>
  );
}

function ActivityPanel({ docId }: { docId: string }) {
  const v = useVault();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof v.activity>>>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { v.activity(docId).then(setRows).catch(() => {}); }, [docId, v.docs]);
  return (
    <div className="panel">
      <h2>Activity</h2>
      <ul className="log">
        {rows.map((r) => (
          <li key={r.id}><span>{EVENT_LABEL[r.event] ?? r.event}{r.detail ? ` ${r.detail}` : ""}{!r.actor_id && r.event.startsWith("print") ? " (print shop)" : r.actor_id && r.actor_id !== v.uid ? " (family member)" : ""}</span>
            <span className="muted num">{new Date(r.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span></li>
        ))}
        {!rows.length && <li className="muted">No activity yet.</li>}
      </ul>
    </div>
  );
}
