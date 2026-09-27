"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Brand, errMsg } from "./ui";

type Step = "signin" | "signup" | "signup-sent" | "forgot" | "forgot-sent";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export function Auth({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    try { await fn(); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  const goto = (s: Step) => { setError(""); setPassword(""); setPassword2(""); setStep(s); };

  const signIn = run(async () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new Error("Enter an email address, like ram@gmail.com.");
    const { error } = await supabase.auth.signInWithPassword({ email: e, password });
    if (error) {
      if (/not confirmed/i.test(error.message)) throw new Error("Confirm your email first — check your inbox for the confirmation link.");
      throw new Error("Wrong email or password.");
    }
    onDone();
  });

  const signUp = run(async () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new Error("Enter an email address, like ram@gmail.com.");
    if (password.length < MIN_PASSWORD) throw new Error(`Use a password with at least ${MIN_PASSWORD} characters.`);
    if (password !== password2) throw new Error("Those passwords don't match.");
    const { error } = await supabase.auth.signUp({
      email: e, password,
      options: { emailRedirectTo: `${location.origin}/` },
    });
    if (error) throw error;
    setEmail(e); setStep("signup-sent");
  });

  const forgot = run(async () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new Error("Enter an email address, like ram@gmail.com.");
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: `${location.origin}/reset-password` });
    if (error) throw error;
    setEmail(e); setStep("forgot-sent");
  });

  return (
    <main className="gate">
      <div className="gate-card">
        <Brand />
        {step === "signin" && (
          <form className="stack" onSubmit={signIn}>
            <div><h1>Sign in</h1><p className="muted">Your family&apos;s documents, encrypted so only you and the people you choose can open them.</p></div>
            <label className="field"><span>Email address</span>
              <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="field"><span>Password</span>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy || !password}>Sign in</button>
            <div className="spread">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => goto("signup")}>Create an account</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => goto("forgot")}>Forgot password?</button>
            </div>
          </form>
        )}
        {step === "signup" && (
          <form className="stack" onSubmit={signUp}>
            <div><h1>Create an account</h1><p className="muted">We&apos;ll email you a link to confirm your address.</p></div>
            <label className="field"><span>Email address</span>
              <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="field"><span>Password</span>
              <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="field"><span>Confirm password</span>
              <input className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy}>Create account</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => goto("signin")}>Already have an account? Sign in</button>
          </form>
        )}
        {step === "signup-sent" && (
          <>
            <h1>Check your email</h1>
            <p className="muted">We sent a confirmation link to {email}. Click it, then come back and sign in.</p>
            <button className="btn btn-ghost btn-sm" onClick={() => goto("signin")}>Back to sign in</button>
          </>
        )}
        {step === "forgot" && (
          <form className="stack" onSubmit={forgot}>
            <div><h1>Reset your password</h1><p className="muted">We&apos;ll email you a link to set a new password.</p></div>
            <label className="field"><span>Email address</span>
              <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy}>Send reset link</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => goto("signin")}>Back to sign in</button>
          </form>
        )}
        {step === "forgot-sent" && (
          <>
            <h1>Check your email</h1>
            <p className="muted">We sent a password reset link to {email}. It can take a minute; check spam too.</p>
            <button className="btn btn-ghost btn-sm" onClick={() => goto("signin")}>Back to sign in</button>
          </>
        )}
      </div>
    </main>
  );
}
