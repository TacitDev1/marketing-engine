import { useState, useEffect, useCallback } from "react";
import { UsersThree, CircleNotch } from "@phosphor-icons/react";
import { Button, Card, Badge } from "./ui.jsx";
import Markdown from "./Markdown.jsx";
import { ago } from "../lib/format.js";

// The agent team (2026-11-12): the marketing agents that run as Claude Code on
// the server, what each one is for, when it last ran and whether it is switched
// on. Agents that report (Strategist, SEO, Measurement) show their newest
// report here. Server side: server/agent-team.js, server/agent-reports.js.

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RUN_TONE = { ok: "good", failed: "crit", timeout: "warn", skipped: "neutral" };
const RUN_LABEL = { ok: "finished", failed: "failed", timeout: "ran out of time", skipped: "skipped" };

const whenLabel = (a) =>
  a.days.length === 5 && a.days.every((d) => d >= 1 && d <= 5)
    ? a.repeat === "loop"
      ? "Every weekday, for as long as the server is on"
      : "Every weekday"
    : a.days.map((d) => DAY[d]).join(", ");

export default function AgentTeam({ active }) {
  const [agents, setAgents] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [reports, setReports] = useState({});
  const [plan, setPlan] = useState(null);
  const [open, setOpen] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setAgents(data.agents || []);
      setReports(data.reports || {});
      setPlan(data.plan || null);
      setError("");
    } catch (err) {
      setError(`Couldn't load the agents (${err.message}).`);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const toggle = async (a) => {
    setBusy(a.id);
    try {
      const res = await fetch(`/api/agents/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !a.enabled }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await refresh();
    } catch (err) {
      setError(`Couldn't switch ${a.name} ${a.enabled ? "off" : "on"} (${err.message}).`);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <UsersThree size={18} className="text-brand" />
        <h2 className="text-[15px] font-semibold text-ink">The agent team</h2>
      </div>
      <p className="mb-4 text-[13px] text-muted">
        Agents that do the marketing work on the server during its daily hours. Each one works from a set of marketing playbooks and the shared picture of Larkwell, and reports
        what it did here.
      </p>
      {error && <p className="mb-3 text-[13px] text-crit">{error}</p>}
      {agents === null && !error && (
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <CircleNotch size={14} className="animate-spin" /> Loading the agents
        </p>
      )}
      <ul className="divide-y divide-line">
        {(agents || []).map((a) => {
          const report = reports[a.id];
          const written = a.id === "strategist" && plan ? plan.pieces.filter((p) => p.draftId).length : null;
          return (
          <li key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-ink">{a.name}</span>
                {a.status !== "live" ? (
                  <Badge tone="neutral" title="Registered, but not built yet. It does not run.">
                    Planned
                  </Badge>
                ) : a.enabled ? (
                  <Badge tone="good">On</Badge>
                ) : (
                  <Badge tone="warn">Off</Badge>
                )}
                <span className="text-[12px] text-faint">{whenLabel(a)}</span>
              </div>
              <p className="mt-0.5 text-[13px] text-muted">{a.job}</p>
              <p className="mt-1 text-[12px] text-faint">
                {a.lastRun ? (
                  <>
                    Last run {ago(a.lastRun.finishedAt)}: <Badge tone={RUN_TONE[a.lastRun.status] || "neutral"}>{RUN_LABEL[a.lastRun.status] || a.lastRun.status}</Badge>
                  </>
                ) : a.status === "live" ? (
                  "Has not run yet"
                ) : (
                  `Will use: ${a.skills.join(", ")}`
                )}
              </p>
              {report && (
                <div className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-2">
                  <p className="text-[13px] text-ink">
                    <span className="font-medium">{report.title}:</span> {report.headline}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-faint">
                    <span>Filed {ago(report.createdAt)}</span>
                    {written !== null && (
                      <span>
                        Jarvis has written {written} of {plan.pieces.length} planned pieces
                      </span>
                    )}
                    {report.actions.length > 0 && <span>{report.actions.length} proposed {report.actions.length === 1 ? "fix" : "fixes"}, also under Recommendations</span>}
                    <button type="button" className="text-brand hover:underline" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? "" : a.id)}>
                      {open === a.id ? "Hide the report" : "Read the report"}
                    </button>
                  </p>
                  {open === a.id && (
                    <div className="mt-3 border-t border-line pt-3 text-[13px] text-ink">
                      <Markdown text={report.body} />
                      {report.actions.length > 0 && (
                        <>
                          <h3 className="mt-4 text-[13px] font-semibold text-ink">Proposed fixes</h3>
                          <ol className="mt-1 list-decimal space-y-2 pl-5">
                            {report.actions.map((x, i) => (
                              <li key={i}>
                                <span className="font-medium">{x.title}</span>
                                {x.page ? <span className="text-faint"> ({x.page})</span> : null}
                                <span className="block whitespace-pre-wrap text-muted">{x.detail}</span>
                                {x.why ? <span className="block text-faint">Why: {x.why}</span> : null}
                              </li>
                            ))}
                          </ol>
                        </>
                      )}
                      {report.needs.length > 0 && (
                        <>
                          <h3 className="mt-4 text-[13px] font-semibold text-ink">Needs a person</h3>
                          <ul className="mt-1 list-disc pl-5 text-muted">
                            {report.needs.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {a.status === "live" && (
              <Button variant="outline" disabled={busy === a.id} onClick={() => toggle(a)}>
                {a.enabled ? "Switch off" : "Switch on"}
              </Button>
            )}
          </li>
          );
        })}
      </ul>
    </Card>
  );
}
