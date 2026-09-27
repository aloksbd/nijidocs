"use client";
import type { DocEntry } from "@/lib/types";
import { snippet } from "@/lib/search";

export function expiryChip(expiry?: string) {
  if (!expiry) return null;
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <span className="chip chip-warn">Expired</span>;
  if (days <= 90) return <span className="chip chip-warn">Expires in {days} day{days === 1 ? "" : "s"}</span>;
  return null;
}

function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

export function DocGrid({ docs, query, onOpen, groupName, uid }: {
  docs: DocEntry[]; query?: string; onOpen: (id: string) => void; groupName: (id: string) => string; uid: string;
}) {
  return (
    <div className="grid">
      {docs.map((d) => {
        const snip = query ? snippet(d.meta.ocrText, query) : null;
        return (
          <button key={d.id} className="sheet" onClick={() => onOpen(d.id)}>
            <span className="title">{query ? <Highlight text={d.meta.name} q={query} /> : d.meta.name}</span>
            <span className="stamp">{d.meta.slug}</span>
            {d.meta.belongsTo && <span className="small muted">Belongs to {d.meta.belongsTo}</span>}
            {snip && <span className="snippet"><Highlight text={snip} q={query!} /></span>}
            <span className="chips">
              {expiryChip(d.meta.expiry)}
              {d.groupIds.length === 0 && d.ownerId === uid && <span className="chip">Only me</span>}
              {d.groupIds.map((g) => <span key={g} className="chip chip-manila">{groupName(g)}</span>)}
              {d.pageCount > 1 && <span className="chip">{d.pageCount} pages</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
