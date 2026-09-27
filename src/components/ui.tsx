"use client";
import { useEffect } from "react";

export function Brand() {
  return <div className="brand"><b>NijiDocs</b><span>निजी</span></div>;
}
export function Spinner() { return <span className="spinner" aria-label="Loading" />; }

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="dialog-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="spread"><h2>{title}</h2><button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong. Try again.";

export function SearchIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
