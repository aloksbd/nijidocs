"use client";
import { useState } from "react";
import { useVault } from "@/lib/vault";
import { supabase } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";
import { Brand, errMsg } from "./ui";

const MIN = 10;

export function VaultGate() {
  const v = useVault();
  const p = v.profile!;
  const isNew = !p.vault;
  const [mode, setMode] = useState<"unlock" | "recover">("unlock");
  const [name, setName] = useState(p.display_name ?? "");
  const [phone, setPhone] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [rk, setRk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [openVault, setOpenVault] = useState<(() => Promise<void>) | null>(null);
  const [saved, setSaved] = useState(false);

  const run = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    try { await fn(); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  const checkNew = () => {
    if (pass.length < MIN) throw new Error(`Use at least ${MIN} characters. A short sentence works well.`);
    if (pass !== pass2) throw new Error("The two passphrases don't match.");
  };

  // Shown once, right after setup. Keys are already loaded; this screen just blocks the app.
  if (recoveryKey) {
    return (
      <main className="gate"><div className="gate-card">
        <Brand />
        <div><h1>Write down your recovery key</h1>
          <p className="muted">If you forget your vault passphrase, this key is the only way back in. Nobody — including us — can reset it. Keep it on paper somewhere safe.</p></div>
        <div className="recovery">{recoveryKey}</div>
        <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I&apos;ve written it down</label>
        <button className="btn btn-primary" disabled={!saved || busy} onClick={async () => { setBusy(true); await openVault?.(); }}>{busy ? "Opening…" : "Open my vault"}</button>
      </div></main>
    );
  }

  return (
    <main className="gate"><div className="gate-card">
      <Brand />
      {isNew ? (
        <form className="stack" onSubmit={run(async () => {
          if (!name.trim()) throw new Error("Enter your name so family can recognise you.");
          const ph = normalizePhone(phone);
          if (!ph) throw new Error("Enter your Nepali mobile number, like 98XXXXXXXX.");
          checkNew();
          const r = await v.setupVault(name, ph, pass);
          setOpenVault(() => r.open);
          setRecoveryKey(r.recoveryKey);
        })}>
          <div><h1>Create your vault</h1>
            <p className="muted">Your documents are locked with a passphrase that never leaves this device. Choose one you&apos;ll remember — it&apos;s different from your sign-in.</p></div>
          <label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ram Sharma" /></label>
          <label className="field"><span>Mobile number</span><input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXXXXXXX" />
            <span className="hint">Family members add you to groups using this number. One account per number.</span></label>
          <label className="field"><span>Vault passphrase</span><input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          <label className="field"><span>Type it again</span><input className="input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>{busy ? "Creating keys…" : "Create vault"}</button>
        </form>
      ) : mode === "unlock" ? (
        <form className="stack" onSubmit={run(() => v.unlock(pass))}>
          <div><h1>Unlock your vault</h1><p className="muted">Welcome back{p.display_name ? `, ${p.display_name}` : ""}.</p></div>
          <label className="field"><span>Vault passphrase</span><input className="input" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus /></label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy || !pass}>{busy ? "Unlocking…" : "Unlock"}</button>
          <div className="spread">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode("recover"); setError(""); setPass(""); }}>Forgot passphrase?</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </form>
      ) : (
        <form className="stack" onSubmit={run(async () => { checkNew(); await v.recover(rk, pass); })}>
          <div><h1>Use your recovery key</h1><p className="muted">Enter the key you wrote down when you created your vault, then choose a new passphrase.</p></div>
          <label className="field"><span>Recovery key</span><input className="input" value={rk} onChange={(e) => setRk(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" /></label>
          <label className="field"><span>New passphrase</span><input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          <label className="field"><span>Type it again</span><input className="input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>Recover vault</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode("unlock"); setError(""); }}>Back</button>
        </form>
      )}
    </div></main>
  );
}
