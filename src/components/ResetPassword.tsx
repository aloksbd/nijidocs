"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Brand, Spinner, errMsg } from "./ui";

const MIN_PASSWORD = 8;

export function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled) { setValid(true); setReady(true); }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session) { setValid(true); setReady(true); }
      else if (!cancelled) setTimeout(() => setReady(true), 1500);
    });
    return () => { cancelled = true; data.subscription.unsubscribe(); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      if (password.length < MIN_PASSWORD) throw new Error(`Use a password with at least ${MIN_PASSWORD} characters.`);
      if (password !== password2) throw new Error("Those passwords don't match.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => { location.href = "/"; }, 1500);
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <main className="gate">
      <div className="gate-card">
        <Brand />
        {!ready && <div className="row muted"><Spinner /> Checking your link…</div>}
        {ready && !valid && (
          <>
            <h1>This link is invalid or expired</h1>
            <p className="muted">Ask for a new password reset link and try again.</p>
            <Link className="btn btn-ghost btn-sm" href="/">Back to sign in</Link>
          </>
        )}
        {ready && valid && done && (
          <>
            <h1>Password updated</h1>
            <p className="muted">Taking you back to NijiDocs…</p>
          </>
        )}
        {ready && valid && !done && (
          <form className="stack" onSubmit={submit}>
            <div><h1>Set a new password</h1><p className="muted">Choose a new password for your account.</p></div>
            <label className="field"><span>New password</span>
              <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
            <label className="field"><span>Confirm password</span>
              <input className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy}>Update password</button>
          </form>
        )}
      </div>
    </main>
  );
}
