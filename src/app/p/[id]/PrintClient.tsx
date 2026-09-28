"use client";
import { useCallback, useEffect, useState } from "react";
import * as C from "@/lib/crypto";
import type { Meta } from "@/lib/types";
import { useRenderedPages, type PlainFile } from "@/components/DocPages";
import { Brand, Spinner } from "@/components/ui";

type Api =
  | { status: "active"; expiresAt: string; encMeta: string; files: string[] }
  | { status: "expired"; canRequest: boolean } | { status: "requested" } | { status: "revoked" }
  | { status: "invalid" } | { status: "error" };

export function PrintClient({ id }: { id: string }) {
  const [api, setApi] = useState<Api | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [files, setFiles] = useState<PlainFile[] | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const key = new URLSearchParams(location.hash.slice(1)).get("k");
    if (!key) { setError("This link is incomplete. Ask the sender to copy the whole link again."); return; }
    const r: Api = await fetch(`/api/print/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({ status: "error" }));
    setApi(r);
    if (r.status !== "active") { setFiles(null); return; }
    try {
      const k = await C.importAes(C.fromB64(key));
      const m = await C.decryptJSON<Meta>(k, r.encMeta);
      setMeta(m);
      const out: PlainFile[] = [];
      for (let i = 0; i < r.files.length; i++) {
        const ct = new Uint8Array(await (await fetch(r.files[i])).arrayBuffer());
        out.push({ mime: m.files[i]?.mime ?? "image/jpeg", bytes: await C.aesDecrypt(k, ct) });
      }
      setFiles(out);
    } catch { setError("This link is damaged and the document can't be opened. Ask the sender for a new link."); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // When waiting for approval, check every 5 seconds
  useEffect(() => {
    if (api?.status !== "requested") return;
    const t = setInterval(load, 5000); return () => clearInterval(t);
  }, [api?.status, load]);

  const left = api?.status === "active" ? Math.max(0, Math.floor((new Date(api.expiresAt).getTime() - now) / 1000)) : 0;
  useEffect(() => {
    if (api?.status === "active" && left === 0) { setFiles(null); setMeta(null); load(); }
  }, [left, api?.status, load]);

  const { urls } = useRenderedPages(files);

  async function requestMore() {
    const r = await fetch(`/api/print/${id}`, { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (r) setApi(r);
  }

  const shell = (body: React.ReactNode) => (
    <main className="gate"><div className="gate-card"><Brand />{body}</div></main>
  );

  if (error) return shell(<><h1>Can&apos;t open this document</h1><p className="muted">{error}</p></>);
  if (!api) return shell(<div className="row muted"><Spinner /> Opening…</div>);
  if (api.status === "invalid" || api.status === "error") return shell(<><h1>Link not found</h1><p className="muted">Check that you copied the whole link, or ask the sender for a new one.</p></>);
  if (api.status === "revoked") return shell(<><h1>This link was turned off</h1><p className="muted">The sender stopped sharing this document. Ask them for a new link if you still need to print it.</p></>);
  if (api.status === "expired") return shell(<>
    <h1>Time is up</h1>
    <p className="muted">Print links work for 15 minutes.{api.canRequest ? " You can ask the sender to allow 15 more minutes." : " This link can't be extended again. Ask the sender for a new one."}</p>
    {api.canRequest && <button className="btn btn-primary" onClick={requestMore}>Ask for 15 more minutes</button>}
  </>);
  if (api.status === "requested") return shell(<>
    <h1>Waiting for the sender</h1>
    <p className="muted">They&apos;ve been asked to allow 15 more minutes. Keep this page open; the document will appear as soon as they allow it.</p>
    <div className="row muted"><Spinner /> Checking every few seconds</div>
  </>);

  return (
    <div onContextMenu={(e) => e.preventDefault()}>
      <header className="print-top no-print">
        <div><b>{meta?.name ?? "Document"}</b><div className="small muted">{urls ? `${urls.length} page${urls.length === 1 ? "" : "s"}` : "Decrypting…"}</div></div>
        <div className="row">
          <span className="small">Available for <span className="timer">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span></span>
          <button className="btn btn-primary" disabled={!urls} onClick={() => window.print()}>Print</button>
        </div>
      </header>
      <div className="print-pages">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {urls ? urls.map((u, i) => <img key={i} src={u} alt={`Page ${i + 1}`} draggable={false} />) : <div className="row muted no-print"><Spinner /> Decrypting on this computer…</div>}
      </div>
      <p className="hint no-print" style={{ textAlign: "center", padding: 24 }}>This document was decrypted in this browser only. Please close the tab after printing.</p>
    </div>
  );
}
