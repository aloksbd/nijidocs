// The permanent document ID, e.g. "citizenship-ram". Lowercase, letters/digits/hyphens.
// Devanagari letters are kept so Nepali names work too.
export function slugify(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "document";
}
export const isValidSlug = (s: string) => /^[\p{L}\p{M}\p{N}]+(-[\p{L}\p{M}\p{N}]+)*$/u.test(s) && s.length <= 60;

export function freeSlug(base: string, taken: Set<string>): string {
  const b = slugify(base);
  if (!taken.has(b)) return b;
  for (let i = 2; ; i++) if (!taken.has(`${b}-${i}`)) return `${b}-${i}`;
}
