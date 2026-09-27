"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { VaultProvider, useVault } from "@/lib/vault";
import { Auth } from "@/components/Auth";
import { VaultGate } from "@/components/VaultGate";
import { Dashboard } from "@/components/Dashboard";
import { Spinner } from "@/components/ui";

type Stage = "loading" | "signed-out" | "needs-2fa" | "ready";

function App() {
  const v = useVault();
  const [stage, setStage] = useState<Stage>("loading");
  const { loadProfile, lock } = v;

  const check = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { lock(); return setStage("signed-out"); }
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2") return setStage("needs-2fa");
    await loadProfile();
    setStage("ready");
  }, [loadProfile, lock]);

  useEffect(() => {
    check();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { lock(); setStage("signed-out"); }
    });
    return () => data.subscription.unsubscribe();
  }, [check, lock]);

  if (stage === "loading") return <main className="gate"><Spinner /></main>;
  if (stage === "signed-out" || stage === "needs-2fa")
    return <Auth initialStep={stage === "needs-2fa" ? "challenge" : "email"} onDone={check} />;
  if (!v.profile) return <main className="gate"><Spinner /></main>;
  if (!v.unlocked) return <VaultGate />;
  return <Dashboard />;
}

export default function Page() {
  return <VaultProvider><App /></VaultProvider>;
}
