import MiniSearch from "minisearch";
import type { DocEntry } from "./types";

export type SearchRow = {
  id: string; name: string; slug: string; belongsTo: string; docNumber: string;
  ocrText: string; places: string;
};

export function buildIndex(docs: DocEntry[], placeNames: (d: DocEntry) => string[]) {
  const ms = new MiniSearch<SearchRow>({
    fields: ["name", "slug", "belongsTo", "docNumber", "places", "ocrText"],
    storeFields: ["id"],
    // Keep Devanagari; split on whitespace and punctuation only
    tokenize: (t) => t.toLowerCase().split(/[\s\p{P}\p{S}]+/u).filter(Boolean),
    searchOptions: {
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
      boost: { name: 4, slug: 3, belongsTo: 3, docNumber: 3, places: 2, ocrText: 1 },
      combineWith: "AND",
    },
  });
  ms.addAll(docs.map((d) => ({
    id: d.id, name: d.meta.name, slug: d.meta.slug, belongsTo: d.meta.belongsTo ?? "",
    docNumber: d.meta.docNumber ?? "", ocrText: d.meta.ocrText ?? "", places: placeNames(d).join(" "),
  })));
  return ms;
}

export function search(ms: MiniSearch<SearchRow>, q: string): string[] {
  const query = q.trim();
  if (!query) return [];
  let res = ms.search(query);
  // If every word must match and nothing does, fall back to "any word"
  if (res.length === 0) res = ms.search(query, { combineWith: "OR" });
  return res.map((r) => r.id as string);
}

/** Short snippet around the first matching word in the OCR text. */
export function snippet(text: string | undefined, q: string): string | null {
  if (!text || !q.trim()) return null;
  const lower = text.toLowerCase();
  for (const w of q.toLowerCase().split(/\s+/).filter((x) => x.length > 1)) {
    const i = lower.indexOf(w);
    if (i >= 0) {
      const start = Math.max(0, i - 40);
      return (start > 0 ? "…" : "") + text.slice(start, i + w.length + 60).replace(/\s+/g, " ") + "…";
    }
  }
  return null;
}
