/** Nepali mobile number → digits with country code, e.g. "9779812345678". Empty if invalid. */
export function normalizePhone(input: string): string {
  const d = input.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("9")) return `977${d}`;
  if (d.length === 13 && d.startsWith("9779")) return d;
  return "";
}
