"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVault } from "@/lib/vault";
import { extractText } from "@/lib/ocr";
import { isValidSlug } from "@/lib/slug";
import type { DocEntry } from "@/lib/types";
import { Dialog, Spinner, errMsg } from "./ui";

const TYPES = ["Citizenship", "Passport", "National ID", "Driving licence", "PAN card", "Birth certificate",
  "Marriage certificate", "Transcript", "Character certificate", "CV", "Offer letter", "Land ownership"];
const MAX_FILE = 25 * 1024 * 1024;

export function UploadDialog({ preset, onClose, onDone }: {
  preset: { groupId?: string; folderId?: string }; onClose: () => void; onDone: (id: string) => void;
}) {
  const v = useVault();
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [belongsTo, setBelongsTo] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>(preset.groupId ? [preset.groupId] : []);
  const [folderIds, setFolderIds] = useState<string[]>(preset.folderId ? [preset.folderId] : []);
  const [ocr, setOcr] = useState<{ state: "idle" | "running" | "done" | "skipped"; text: string; msg: string }>({ state: "idle", text: "", msg: "" });
  const [showText, setShowText] = useState(false);
  const [dupes, setDupes] = useState<DocEntry[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  const people = useMemo(() => Array.from(new Set([v.profile?.display_name ?? "", ...v.docs.map((d) => d.meta.belongsTo ?? "")].filter(Boolean))), [v.docs, v.profile]);

  // Auto-fill the permanent ID from the name until the user edits it
  const { suggestSlug, findDuplicates } = v;
  useEffect(() => { if (!slugTouched) setSlug(name.trim() ? suggestSlug(name) : ""); }, [name, slugTouched, suggestSlug]);

  // Duplicate check + OCR whenever the file list changes
  useEffect(() => {
    if (!files.length) { setDupes([]); setOcr({ state: "idle", text: "", msg: "" }); return; }
    const id = ++runId.current;
    findDuplicates(files).then((d) => id === runId.current && setDupes(d));
    setOcr({ state: "running", text: "", msg: "Getting ready to read text" });
    extractText(files, (msg) => id === runId.current && setOcr((o) => ({ ...o, msg })))
      .then((text) => id === runId.current && setOcr({ state: "done", text, msg: "" }))
      .catch(() => id === runId.current && setOcr({ state: "done", text: "", msg: "Couldn't read text from this file. You can type key words below." }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const ok = Array.from(list).filter((f) => (f.type.startsWith("image/") || f.type === "application/pdf"));
    const big = ok.find((f) => f.size > MAX_FILE);
    if (big) { setError(`${big.name} is larger than 25 MB.`); return; }
    if (ok.length < list.length) setError("Only photos and PDFs can be added.");
    else setError("");
    setFiles((cur) => [...cur, ...ok].slice(0, 30));
  }
  const move = (i: number, d: number) => setFiles((f) => { const n = [...f]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });

  const slugTaken = slug && v.takenSlugs.has(slug);
  const slugBad = slug && !isValidSlug(slug);
  const folderChoices = v.folders.filter((f) => f.ownerId === v.uid || (f.groupId && groupIds.includes(f.groupId)));
  const canSave = files.length > 0 && name.trim() && slug && !slugTaken && !slugBad && ocr.state !== "running" && !busy;

  async function save() {
    setError("");
    setBusy("Starting");
    try {
      const validFolders = folderIds.filter((id) => folderChoices.some((f) => f.id === id));
      const id = await v.uploadDoc({ files, name, slug, belongsTo, docNumber, expiry, ocrText: ocr.text, groupIds, folderIds: validFolders }, setBusy);
      onDone(id);
    } catch (e) { setError(errMsg(e)); setBusy(""); }
  }

  return (
    <Dialog title="Upload a document" onClose={busy ? () => {} : onClose}>
      <div className={`drop ${over ? "over" : ""}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
        <b>{files.length ? "Add another page" : "Choose photos or a PDF"}</b>
        <span className="hint">Front and back of an ID can go in one document. Drag files here or tap to choose.</span>
        <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <div className="file-list">
          {files.map((f, i) => (
            <div key={i} className="file-row">
              <span className="muted num">{i + 1}</span><span className="grow">{f.name}</span>
              <span className="hint num">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {dupes.length > 0 && (
        <p className="notice notice-danger">You already have this file in <b>{dupes.map((d) => d.meta.name).join(", ")}</b>. Uploading again will create a duplicate.</p>
      )}

      {files.length > 0 && (
        <>
          <div className="stack">
            <label className="field"><span>Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Citizenship – Ram" maxLength={100} />
            </label>
            <div className="chips">
              {TYPES.map((t) => <button key={t} type="button" className="chip" style={{ cursor: "pointer" }}
                onClick={() => setName(belongsTo ? `${t} – ${belongsTo}` : t)}>{t}</button>)}
            </div>
            <label className="field"><span>Permanent ID</span>
              <input className="input" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{M}\p{N}-]/gu, "").replace(/-{2,}/g, "-").slice(0, 60)); }} />
              {slugTaken ? <span className="error">That ID is already used. Try {v.suggestSlug(slug)}.</span>
                : slugBad ? <span className="error">Use letters, numbers and hyphens only.</span>
                : <span className="hint">Filled in from the name. You can edit it now, but it can&apos;t be changed after saving.</span>}
            </label>
            <div className="two">
              <label className="field"><span>Belongs to</span>
                <input className="input" list="people" value={belongsTo} onChange={(e) => setBelongsTo(e.target.value)} placeholder="Whose document is this?" />
                <datalist id="people">{people.map((p) => <option key={p} value={p} />)}</datalist>
              </label>
              <label className="field"><span>Document number <span className="muted">(optional)</span></span>
                <input className="input" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
              </label>
            </div>
            <label className="field" style={{ maxWidth: 240 }}><span>Expiry date <span className="muted">(optional)</span></span>
              <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </label>
          </div>

          <div className="panel">
            <div className="spread">
              <h3>Text for search</h3>
              {ocr.state === "running" ? <span className="row small muted"><Spinner /> {ocr.msg}</span>
                : <button className="btn btn-ghost btn-sm" onClick={() => setShowText(!showText)}>{showText ? "Hide text" : `Review text (${ocr.text.split(/\s+/).filter(Boolean).length} words)`}</button>}
            </div>
            <p className="hint">Read on this device. Fix anything wrong so searches find it. {ocr.msg && ocr.state === "done" ? ocr.msg : ""}</p>
            {showText && ocr.state !== "running" && (
              <textarea className="input" rows={6} value={ocr.text} onChange={(e) => setOcr({ ...ocr, text: e.target.value })} />
            )}
            {ocr.state === "running" && <button className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={() => { runId.current++; setOcr({ state: "skipped", text: "", msg: "" }); }}>Skip reading text</button>}
          </div>

          <div className="two">
            <div className="panel">
              <h3>Who can see it</h3>
              {v.groups.map((g) => (
                <label key={g.id} className="check"><input type="checkbox" checked={groupIds.includes(g.id)}
                  onChange={(e) => setGroupIds(e.target.checked ? [...groupIds, g.id] : groupIds.filter((x) => x !== g.id))} />{g.name}</label>
              ))}
              <p className="hint">{groupIds.length ? "Everyone in the checked groups can view and print it." : "Nothing checked: only you can see it."}</p>
            </div>
            <div className="panel">
              <h3>Folders</h3>
              {folderChoices.length === 0 && <p className="hint">No folders yet. You can add it to folders later.</p>}
              {folderChoices.map((f) => (
                <label key={f.id} className="check"><input type="checkbox" checked={folderIds.includes(f.id)}
                  onChange={(e) => setFolderIds(e.target.checked ? [...folderIds, f.id] : folderIds.filter((x) => x !== f.id))} />
                  <span className="tab-icon" aria-hidden />{f.name}{f.groupId && <span className="muted small">in {v.groups.find((g) => g.id === f.groupId)?.name}</span>}</label>
              ))}
            </div>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={!canSave} onClick={save}>
          {busy ? <><Spinner /> {busy}</> : ocr.state === "running" ? "Reading text…" : "Save document"}
        </button>
        {!busy && <button className="btn btn-ghost" onClick={onClose}>Cancel</button>}
      </div>
    </Dialog>
  );
}
