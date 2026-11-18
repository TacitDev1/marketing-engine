import { useState } from "react";
import { CircleNotch, Books, Stethoscope } from "@phosphor-icons/react";

// ---- tools (build / lint) ----

export default function Tools({ onChanged }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  async function run(kind) {
    setBusy(kind);
    setMsg("");
    try {
      if (kind === "build") {
        const res = await fetch("/api/wiki/build-from-knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!res.ok) throw new Error();
        const r = await res.json();
        setMsg(`Wiki now has ${r.pages} notes`);
        onChanged();
      } else {
        const res = await fetch("/api/wiki/lint", { method: "POST" });
        if (!res.ok) throw new Error();
        const r = await res.json();
        const issues = (r.orphans?.length || 0) + (r.stale?.length || 0) + (r.contradictions?.length || 0);
        setMsg(`Lint: ${issues} issues, ${r.suggestions?.length || 0} ideas`);
      }
    } catch {
      setMsg("That didn't work — Jarvis may be busy. Try again in a moment.");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => run("build")} disabled={!!busy} title="Build notes from your files" className="grid h-9 w-9 place-items-center rounded-lg border border-line-strong text-muted hover:border-brand hover:text-brand disabled:opacity-50">
        {busy === "build" ? <CircleNotch size={15} className="animate-spin" /> : <Books size={16} />}
      </button>
      <button onClick={() => run("lint")} disabled={!!busy} title="Health-check the wiki" className="grid h-9 w-9 place-items-center rounded-lg border border-line-strong text-muted hover:border-brand hover:text-brand disabled:opacity-50">
        {busy === "lint" ? <CircleNotch size={15} className="animate-spin" /> : <Stethoscope size={16} />}
      </button>
      {msg && <span className="ml-1 inline-block max-w-[45vw] truncate align-middle text-[12px] text-faint" title={msg}>{msg}</span>}
    </div>
  );
}
