"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { VaultProvider, useVault } from "@/lib/vault";
import { Auth } from "@/components/Auth";
import { VaultGate } from "@/components/VaultGate";
import { Dashboard } from "@/components/Dashboard";
import { Brand, Spinner, errMsg } from "@/components/ui";

type Stage = "loading" | "signed-out" | "ready" | "error";

function App() {
  const v = useVault();
  const [stage, setStage] = useState<Stage>("loading");
  const [problem, setProblem] = useState("");
  const { loadProfile, lock } = v;

  const check = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { lock(); return setStage("signed-out"); }
    try {
      await loadProfile();
      setStage("ready");
    } catch (e) {
      setProblem(errMsg(e));
      setStage("error");
    }
  }, [loadProfile, lock]);

  useEffect(() => {
    check();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { lock(); setStage("signed-out"); }
    });
    return () => data.subscription.unsubscribe();
  }, [check, lock]);

  if (stage === "loading") return <main className="gate"><Spinner /></main>;
  if (stage === "signed-out") return <Auth onDone={check} />;
  if (stage === "error") return (
    <main className="gate"><div className="gate-card">
      <Brand />
      <h1>Something went wrong</h1>
      <p className="muted">{problem}</p>
      <div className="row">
        <button className="btn btn-primary" onClick={() => { setStage("loading"); check(); }}>Try again</button>
        <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div></main>
  );
  if (!v.profile) return <main className="gate"><Spinner /></main>;
  if (!v.unlocked) return <VaultGate />;
  return <Dashboard />;
}

export default function Page() {
  return <VaultProvider><App /></VaultProvider>;
}
