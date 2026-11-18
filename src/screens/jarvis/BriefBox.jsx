import { useState } from "react";
import { CircleNotch, ShieldCheck, Check, WarningCircle, Sparkle, ArrowSquareOut } from "@phosphor-icons/react";
import { Button, Card, Badge } from "../../components/ui.jsx";

// ---- Brief Jarvis (one-off task → plan → execute into Library) ----

export function BriefBox({ onDone, onNavigate }) {
  const [brief, setBrief] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | planning | running | done
  const [plan, setPlan] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);

  async function run() {
    if (!brief.trim()) return;
    setError(null);
    setPlan(null);
    setTasks([]);
    setPhase("planning");
    let planned;
    try {
      const res = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brief.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `server ${res.status}`);
      planned = await res.json();
    } catch (e) {
      // Show the REAL reason when the server gave one — "model not reachable"
      // is the wrong message for e.g. a validation error.
      setError(
        e?.message && !/failed to fetch/i.test(e.message)
          ? `Jarvis couldn't plan that: ${e.message}`
          : "The local model is not reachable right now. Try again in a moment."
      );
      setPhase("idle");
      return;
    }
    setPlan(planned);
    const live = (planned.tasks || []).map((t) => ({ ...t, status: "queued" }));
    setTasks(live);
    if (!live.length) return setPhase("done");
    setPhase("running");
    const upd = (i, p) => {
      live[i] = { ...live[i], ...p };
      setTasks([...live]);
    };
    for (let i = 0; i < live.length; i++) {
      upd(i, { status: "drafting" });
      try {
        const draft = await execTask(live[i]);
        // Tag the task's service/voice + origin so it's labelled and findable in
        // the Library (generate already returns these; this backstops older paths).
        await saveDraft(live[i].kind, {
          ...draft,
          origin: "jarvis",
          serviceId: draft.serviceId || live[i].serviceId || undefined,
          postType: draft.postType || live[i].postType || undefined,
        });
        upd(i, { status: "saved", preview: live[i].kind === "blog" ? draft.title : draft.hook });
      } catch (e) {
        upd(i, { status: "error", err: e.message });
      }
    }
    setPhase("done");
    onDone?.();
  }

  const busy = phase === "planning" || phase === "running";
  const saved = tasks.filter((t) => t.status === "saved").length;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkle size={17} weight="fill" className="text-brand" />
        <h2 className="text-[15px] font-semibold text-ink">Brief Jarvis</h2>
        <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-good">
          <ShieldCheck size={13} weight="fill" /> drafts only, never posts
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="jarvis-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && run()}
          disabled={busy}
          placeholder="e.g. draft 2 posts on the 2027 deadline and a blog on cloud cost"
          className="flex-1 rounded-lg border border-line-strong bg-canvas px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint focus:border-brand focus:outline-none disabled:opacity-60"
        />
        <Button onClick={run} disabled={busy || !brief.trim()}>
          {phase === "planning" ? (
            <><CircleNotch size={16} className="animate-spin" /> Planning…</>
          ) : phase === "running" ? (
            <><CircleNotch size={16} className="animate-spin" /> Working…</>
          ) : (
            <><Sparkle size={16} weight="fill" /> Go</>
          )}
        </Button>
      </div>
      {error && <p className="mt-2 text-[13px] text-crit">{error}</p>}

      {plan && (
        <div className="reveal mt-3 rounded-lg border border-line bg-surface-2 p-4">
          <p className="text-[13px] leading-relaxed text-ink-2">{plan.interpretation}</p>
          {tasks.length > 0 && (
            <ul className="mt-3 space-y-2">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2.5 text-[13px]">
                  {t.status === "drafting" ? (
                    <CircleNotch size={15} className="mt-0.5 animate-spin text-brand" />
                  ) : t.status === "saved" ? (
                    <Check size={15} weight="bold" className="mt-0.5 text-good" />
                  ) : t.status === "error" ? (
                    <WarningCircle size={15} weight="fill" className="mt-0.5 text-crit" />
                  ) : (
                    <span className="mt-1.5 h-2 w-2 rounded-full border border-line-strong" />
                  )}
                  <span className="flex-1 text-ink-2">
                    {t.label}
                    {t.preview && <span className="text-muted"> - “{t.preview.slice(0, 70)}”</span>}
                  </span>
                  {(t.kind === "blog" ? "blog" : t.postType) && (
                    <Badge tone="neutral">{t.kind === "blog" ? "blog" : t.postType}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {phase === "done" && saved > 0 && (
            <button onClick={() => onNavigate?.("library")} className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
              <ArrowSquareOut size={13} /> {saved} draft{saved === 1 ? "" : "s"} saved to Library
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

async function execTask(task) {
  if (task.kind === "blog") {
    const res = await fetch("/api/blog/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: task.keyword, serviceId: task.serviceId || undefined, nudge: task.nudge || undefined }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `server ${res.status}`);
    return res.json();
  }
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: task.postType, serviceId: task.serviceId || undefined, nudge: task.nudge || undefined }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `server ${res.status}`);
  return res.json();
}
async function saveDraft(kind, payload) {
  const r = await fetch("/api/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, payload }),
  });
  if (!r.ok) throw new Error(`couldn't save to library (server ${r.status})`);
  return r.json();
}
