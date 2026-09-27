// All encryption happens in the browser with the Web Crypto API.
// The server only ever stores ciphertext and keyed hashes.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
export const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ── AES-256-GCM (documents, metadata, group keys). Format: iv(12) || ciphertext
export async function newAesKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
export async function importAes(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}
export async function exportRaw(key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().exportKey("raw", key));
}
export async function aesEncrypt(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
export async function aesDecrypt(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, key, data.slice(12)));
}
export async function encryptJSON(key: CryptoKey, value: unknown): Promise<string> {
  return toB64(await aesEncrypt(key, enc.encode(JSON.stringify(value))));
}
export async function decryptJSON<T>(key: CryptoKey, b64: string): Promise<T> {
  return JSON.parse(dec.decode(await aesDecrypt(key, fromB64(b64)))) as T;
}

// ── RSA-OAEP-3072 per user (wraps group keys and the user's own document keys)
const RSA = { name: "RSA-OAEP", hash: "SHA-256" } as const;
export async function newKeyPair(): Promise<CryptoKeyPair> {
  return subtle().generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["encrypt", "decrypt"]);
}
export async function exportPublic(k: CryptoKey) { return toB64(await subtle().exportKey("spki", k)); }
export async function exportPrivate(k: CryptoKey) { return toB64(await subtle().exportKey("pkcs8", k)); }
export async function importPublic(b64: string) { return subtle().importKey("spki", fromB64(b64), RSA, true, ["encrypt"]); }
export async function importPrivate(b64: string) { return subtle().importKey("pkcs8", fromB64(b64), RSA, false, ["decrypt"]); }
export async function wrapFor(publicKey: CryptoKey, aes: CryptoKey): Promise<string> {
  return toB64(await subtle().encrypt(RSA, publicKey, await exportRaw(aes)));
}
export async function unwrapWith(privateKey: CryptoKey, b64: string): Promise<CryptoKey> {
  return importAes(new Uint8Array(await subtle().decrypt(RSA, privateKey, fromB64(b64))));
}

// ── passphrase → key (PBKDF2-SHA256, 600k iterations, per OWASP 2023)
export type Sealed = { salt: string; iter: number; data: string };
async function deriveKey(secret: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const base = await subtle().importKey("raw", enc.encode(secret.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function seal(secret: string, value: unknown): Promise<Sealed> {
  const salt = randomBytes(16), iter = 600_000;
  return { salt: toB64(salt), iter, data: await encryptJSON(await deriveKey(secret, salt, iter), value) };
}
export async function unseal<T>(secret: string, s: Sealed): Promise<T> {
  return decryptJSON<T>(await deriveKey(secret, fromB64(s.salt), s.iter), s.data);
}

// ── keyed hashes: let the server enforce "unique ID" and spot duplicates without learning either
export async function newHmacKeyRaw() { return toB64(randomBytes(32)); }
export async function importHmac(b64: string) {
  return subtle().importKey("raw", fromB64(b64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
export async function hmac(key: CryptoKey, data: string | Uint8Array<ArrayBuffer>) {
  return toB64(await subtle().sign("HMAC", key, typeof data === "string" ? enc.encode(data) : data));
}
export async function sha256(data: Uint8Array<ArrayBuffer>) {
  return new Uint8Array(await subtle().digest("SHA-256", data));
}

// Recovery key: 25 characters, easy to write on paper
export function newRecoveryKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(25);
  const chars = Array.from(b, (x) => alphabet[x % 32]).join("");
  return chars.match(/.{5}/g)!.join("-");
}
export const normalizeRecovery = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").match(/.{1,5}/g)?.join("-") ?? "";
