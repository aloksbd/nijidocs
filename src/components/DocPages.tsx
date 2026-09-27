"use client";
import { useEffect, useState } from "react";
import { renderPdfPages } from "@/lib/pdf";
import { Spinner } from "./ui";

export type PlainFile = { mime: string; name?: string; bytes: Uint8Array<ArrayBuffer> };

/** Turns decrypted files into page images (PDFs are rendered page by page). */
export function useRenderedPages(files: PlainFile[] | null) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!files) return;
    let made: string[] = []; let dead = false;
    (async () => {
      try {
        for (const f of files) {
          if (f.mime === "application/pdf") {
            for (const b of await renderPdfPages(f.bytes, 2)) made.push(URL.createObjectURL(b));
          } else made.push(URL.createObjectURL(new Blob([f.bytes], { type: f.mime })));
        }
        if (!dead) setUrls(made); else made.forEach(URL.revokeObjectURL);
      } catch { if (!dead) setError("This file couldn't be displayed."); }
    })();
    return () => { dead = true; made.forEach(URL.revokeObjectURL); made = []; };
  }, [files]);
  return { urls, error };
}

export function DocPages({ files }: { files: PlainFile[] | null }) {
  const { urls, error } = useRenderedPages(files);
  if (error) return <p className="error">{error}</p>;
  if (!urls) return <div className="row muted"><Spinner /> Decrypting…</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="pages">{urls.map((u, i) => <img key={i} src={u} alt={`Page ${i + 1}`} />)}</div>;
}
