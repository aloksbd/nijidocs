"use client";
import { useCallback, useEffect, useState } from "react";
import { useVault } from "@/lib/vault";
import { DocGrid } from "./DocGrid";
import { NameDialog } from "./Dashboard";
import { errMsg } from "./ui";

type Member = { user_id: string; display_name: string | null; phone: string | null; role: string };

export function GroupView({ id, onOpen, onOpenFolder, onNewFolder, onUpload, onLeft }: {
  id: string; onOpen: (id: string) => void; onOpenFolder: (id: string) => void; onNewFolder: () => void; onUpload: () => void; onLeft: () => void;
}) {
  const v = useVault();
  const g = v.groups.find((x) => x.id === id);
  const [members, setMembers] = useState<Member[]>([]);
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState(false);
  const { members: loadMembers } = v;
  const load = useCallback(() => loadMembers(id).then(setMembers).catch(() => {}), [loadMembers, id]);
  useEffect(() => { load(); }, [load]);
  if (!g) return <div className="empty"><h2>This group isn&apos;t available</h2></div>;

  const isOwner = g.ownerId === v.uid;
  const docs = v.docs.filter((d) => d.groupIds.includes(id));
  const folders = v.folders.filter((f) => f.groupId === id);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="main-head">
        <div><h1>{g.name}</h1><p className="muted">{docs.length} shared document{docs.length === 1 ? "" : "s"}, {members.length} member{members.length === 1 ? "" : "s"}</p></div>
        <div className="row">
          <button className="btn btn-sm" onClick={onUpload}>Upload to {g.name}</button>
          <button className="btn btn-sm" onClick={onNewFolder}>New folder</button>
          {isOwner && <button className="btn btn-sm" onClick={() => setRename(true)}>Rename</button>}
          {isOwner && !g.isDefault && <button className="btn btn-sm btn-danger" onClick={async () => {
            if (!confirm(`Delete the group "${g.name}"? Documents stay with their owners but are no longer shared here.`)) return;
            await v.deleteGroup(id); onLeft();
          }}>Delete group</button>}
          {!isOwner && <button className="btn btn-sm btn-danger" onClick={async () => {
            if (!confirm(`Leave "${g.name}"? You'll stop seeing its documents.`)) return;
            await v.removeMember(id, v.uid); onLeft();
          }}>Leave group</button>}
        </div>
      </div>

      <div className="doc-layout">
        <section className="stack">
          {folders.length > 0 && (
            <div className="row">
              {folders.map((f) => (
                <button key={f.id} className="btn" onClick={() => onOpenFolder(f.id)}><span className="tab-icon" aria-hidden />{f.name}
                  <span className="muted small num">{v.items.filter((i) => i.folderId === f.id).length}</span></button>
              ))}
            </div>
          )}
          {docs.length ? <DocGrid docs={docs} onOpen={onOpen} groupName={(x) => v.groups.find((y) => y.id === x)?.name ?? ""} uid={v.uid} />
            : <div className="empty"><h2>Nothing shared here yet</h2><p className="muted">Upload a document and check {g.name}, or open one of your documents and share it.</p></div>}
        </section>
        <aside className="panel">
          <h2>Members</h2>
          <ul className="log">
            {members.map((m) => (
              <li key={m.user_id}>
                <span>{m.display_name ?? "Unnamed"} {m.role === "owner" && <span className="chip">Owner</span>}<br /><span className="muted small">+{m.phone}</span></span>
                {isOwner && m.role !== "owner" && <button className="btn btn-sm btn-danger" onClick={async () => { await v.removeMember(id, m.user_id); load(); }}>Remove</button>}
              </li>
            ))}
          </ul>
          {isOwner && (
            <form className="stack" onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setError(""); setMsg("");
              try { const n = await v.addMember(id, phone); setMsg(`${n ?? "They"} can now see everything shared with ${g.name}.`); setPhone(""); load(); }
              catch (x) { setError(errMsg(x)); } finally { setBusy(false); }
            }}>
              <label className="field"><span>Add by mobile number</span><input className="input" inputMode="tel" placeholder="98XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
              <p className="hint">They need a NijiDocs account with a vault first.</p>
              {error && <p className="error">{error}</p>}{msg && <p className="small" style={{ color: "var(--ok)" }}>{msg}</p>}
              <button className="btn btn-primary btn-sm" disabled={busy || phone.replace(/\D/g, "").length < 10}>Add member</button>
            </form>
          )}
        </aside>
      </div>
      {rename && <NameDialog title="Rename group" label="Group name" action="Save name" initial={g.name} onClose={() => setRename(false)} onSave={(n) => v.renameGroup(id, n)} />}
    </div>
  );
}
