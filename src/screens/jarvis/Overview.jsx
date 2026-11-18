import { useState, useEffect, useCallback } from "react";
import { BellRinging, Compass, CheckCircle, Circle, ArrowRight } from "@phosphor-icons/react";
import { Card, Badge } from "../../components/ui.jsx";

// The first thing on the Jarvis screen: what is waiting on a person, and the
// plan the team is working to this week. Everything here is read from the
// agents' own records (GET /api/agents, GET /api/publishing).

// One line per thing only a person can do, most pressing first.
function needsFrom(agents, reports, pub) {
  const out = [];
  for (const d of pub?.awaitingApproval || []) {
    out.push({ key: `approve-${d.id}`, tone: "warn", text: `Blog ready for your approval: "${d.title}"`, note: `Editor ${d.score}/10`, action: "Read and approve", draftId: d.id });
  }
  for (const a of agents || []) {
    if (a.status !== "live") continue;
    if (!a.enabled) out.push({ key: `off-${a.id}`, tone: "neutral", text: `The ${a.name} agent is switched off.`, action: "Open agents", view: "agents" });
    else if (a.lastRun && a.lastRun.status !== "ok" && a.lastRun.status !== "skipped") {
      out.push({ key: `run-${a.id}`, tone: "crit", text: `The ${a.name} agent's last run ${a.lastRun.status === "timeout" ? "ran out of time" : "failed"}.`, action: "Open agents", view: "agents" });
    }
  }
  if (pub && !pub.enabled) out.push({ key: "pub-off", tone: "neutral", text: "Blog publishing is switched off.", action: "Open publishing", view: "publishing" });
  for (const r of Object.values(reports || {})) {
    r.needs.forEach((n, i) => out.push({ key: `need-${r.id}-${i}`, tone: "brand", text: n, note: `${r.agentName} agent`, action: "Read the report", view: "agents" }));
  }
  return out;
}

export function Overview({ active, onOpenDraft, onGo, onCount }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([fetch("/api/agents"), fetch("/api/publishing")]);
      if (!a.ok || !p.ok) throw new Error(`status ${a.ok ? p.status : a.status}`);
      const agents = await a.json();
      setState({ agents: agents.agents || [], reports: agents.reports || {}, plan: agents.plan || null, pub: await p.json() });
      setError("");
    } catch (err) {
      setError(`Couldn't load what needs you (${err.message}).`);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const needs = state ? needsFrom(state.agents, state.reports, state.pub) : [];
  const count = needs.length;
  useEffect(() => {
    if (state) onCount?.(count);
  }, [state, count, onCount]);

  const plan = state?.plan;
  const written = plan ? plan.pieces.filter((p) => p.draftId).length : 0;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <BellRinging size={18} className="text-brand" />
          <h2 className="text-[15px] font-semibold text-ink">Needs you</h2>
          {state && <Badge tone={count ? "warn" : "good"}>{count ? count : "All clear"}</Badge>}
        </div>
        {error && <p className="text-[13px] text-crit">{error}</p>}
        {!state && !error && <p className="text-[13px] text-faint">Loading</p>}
        {state && !count && <p className="text-[13px] text-muted">Nothing is waiting on a person right now.</p>}
        {count > 0 && (
          <ul className="divide-y divide-line">
            {needs.map((n) => (
              <li key={n.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
                  {n.text}
                  {n.note && <span className="ml-2 text-[12px] text-faint">{n.note}</span>}
                </span>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
                  onClick={() => (n.draftId ? onOpenDraft?.(n.draftId) : onGo(n.view))}
                >
                  {n.action} <ArrowRight size={12} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Compass size={18} className="text-brand" />
          <h2 className="text-[15px] font-semibold text-ink">This week's plan</h2>
          {plan && (
            <Badge tone="neutral">
              {written} of {plan.pieces.length} written
            </Badge>
          )}
        </div>
        {state && !plan && <p className="text-[13px] text-muted">No plan yet. The Strategist agent writes one every Friday for the week after, and Jarvis then writes from it each day.</p>}
        {plan && (
          <>
            <p className="text-[13px] leading-relaxed text-ink">{plan.focus}</p>
            <ul className="mt-3 space-y-1.5">
              {plan.pieces.map((p) => (
                <li key={p.id} className="flex items-start gap-2 text-[13px] leading-snug">
                  {p.draftId ? <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-good" aria-label="Written" /> : <Circle size={16} className="mt-0.5 shrink-0 text-faint" aria-label="Not written yet" />}
                  <span className={p.draftId ? "text-muted" : "text-ink-2"}>
                    <span className="font-medium">{p.kind === "blog" ? `Blog: ${p.keyword}` : `LinkedIn ${p.postType}`}</span>
                    <span className="text-muted"> · {p.angle}</span>
                    {p.draftId && onOpenDraft && (
                      <button type="button" className="ml-2 text-[12.5px] text-brand hover:underline" onClick={() => onOpenDraft(p.draftId)}>
                        Open the draft
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline" onClick={() => onGo("agents")}>
              Read the full plan and its reasons <ArrowRight size={12} weight="bold" />
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
