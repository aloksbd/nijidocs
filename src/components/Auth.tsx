"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Brand, errMsg } from "./ui";

type Step = "email" | "code";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Auth({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      </div>
    </main>
  );
}
