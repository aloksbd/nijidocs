"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Brand, errMsg } from "./ui";

type Step = "email" | "code" | "enroll" | "challenge";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Auth({ onDone, initialStep }: { onDone: () => void; initialStep?: Step }) {
  const [step, setStep] = useState<Step>(initialStep ?? "email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);

  useEffect(() => { setStep(initialStep ?? "email"); }, [initialStep]);

  async function afterPrimary() {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel === "aal2") return onDone();
    if (data?.nextLevel === "aal2") { setCode(""); setStep("challenge"); return; }
    await startEnroll();
  }

  async function startEnroll() {
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `NijiDocs ${Date.now()}` });
    if (error) throw error;
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode(""); setStep("enroll");
  }

  const run = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    try { await fn(); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  const sendCode = run(async () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new Error("Enter an email address, like ram@gmail.com.");
    const { error } = await supabase.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
    if (error) throw error;
    setEmail(e); setCode(""); setStep("code");
  });

  const verifyEmail = run(async () => {
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    if (error) throw new Error("That code didn't work. Check you entered the newest one, or send a new code.");
    await afterPrimary();
  });

  const verifyTotp = run(async () => {
    let factorId = enroll?.id;
    if (step === "challenge") {
      const { data } = await supabase.auth.mfa.listFactors();
      factorId = data?.totp.find((f) => f.status === "verified")?.id;
      if (!factorId) throw new Error("No authenticator is set up for this account.");
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId!, code: code.trim() });
    if (error) throw new Error("That code did not match. Check the time on your phone and try the newest code.");
    onDone();
  });

  return (
    <main className="gate">
      <div className="gate-card">
        <Brand />
        {step === "email" && (
          <form className="stack" onSubmit={sendCode}>
            <div><h1>Sign in</h1><p className="muted">Your family&apos;s documents, encrypted so only you and the people you choose can open them.</p></div>
            <label className="field"><span>Email address</span>
              <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy}>Send code</button>
            <p className="hint">New email addresses create an account. We&apos;ll email you a sign-in code.</p>
          </form>
        )}
        {step === "code" && (
          <form className="stack" onSubmit={verifyEmail}>
            <div><h1>Check your email</h1><p className="muted">We sent a code to {email}. It can take a minute; check spam too.</p></div>
            <label className="field"><span>Code from the email</span>
              <input className="input num" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy || code.length < 6}>Verify</button>
            <div className="spread">
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={sendCode}>Send a new code</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep("email")}>Use a different email</button>
            </div>
          </form>
        )}
        {step === "enroll" && enroll && (
          <form className="stack" onSubmit={verifyTotp}>
            <div><h1>Turn on two-step sign-in</h1>
              <p className="muted">Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 2FAS or Aegis). You&apos;ll enter a code from it each time you sign in.</p></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="Authenticator QR code" width={180} height={180} style={{ background: "#fff", borderRadius: 8, padding: 8, justifySelf: "center" }} />
            <p className="hint" style={{ textAlign: "center", wordBreak: "break-all" }}>Can&apos;t scan? Enter this key: <b>{enroll.secret}</b></p>
            <label className="field"><span>Code from the app</span>
              <input className="input num" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy || code.length < 6}>Turn on</button>
          </form>
        )}
        {step === "challenge" && (
          <form className="stack" onSubmit={verifyTotp}>
            <div><h1>Authenticator code</h1><p className="muted">Open your authenticator app and enter the code for NijiDocs.</p></div>
            <label className="field"><span>6-digit code</span>
              <input className="input num" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy || code.length < 6}>Continue</button>
            <button type="button" className="btn btn-ghost" onClick={() => supabase.auth.signOut().then(() => setStep("email"))}>Sign out</button>
          </form>
        )}
      </div>
    </main>
  );
}
