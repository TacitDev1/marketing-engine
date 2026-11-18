import { useState, useEffect, useCallback } from "react";
import {
  CalendarCheck,
  CircleNotch,
  Play,
  Brain,
  Lightbulb,
  MagnifyingGlass,
  Trash,
  ArrowCounterClockwise,
  PushPin,
  Plus,
  Minus,
  PencilSimple,
  Check,
  X,
  Broom,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button, Card, Badge, EmptyState } from "./ui.jsx";

// Jarvis as marketing lead (2026-11-02): the daily session, its briefing, the
// fresh start, and the playbook it learns into. Server side: server/session.js,
// server/playbook.js, server/fresh-start.js.

const PHASE_LABEL = {
  idle: "Not run yet",
  starting: "Starting",
  observe: "Looking at what changed",
  learn: "Learning from your reviews",
  plan: "Choosing today's work",
  write: "Writing",
  critic: "Reviewing its own drafts",
  done: "Done for today",
  stopped: "Stopped early",
  interrupted: "Interrupted",
  error: "Hit a problem",
};

const time = (iso, tz) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }) : "";
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "");

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
  return body;
}

export default function JarvisToday({ onOpenDraft, active = true }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [minutes, setMinutes] = useState(60);

  const load = useCallback(async () => {
    try {
      setData(await api("/api/session"));
      setErr("");
    } catch (e) {
      setErr(`Couldn't load today's session: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [active, load]);

  async function runNow() {
    setBusy("run");
    try {
      await api("/api/session/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes }) });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  const s = data?.session;
  const brief = data?.briefs?.[0];
  const win = s?.window;
  const running = !!s?.running;
  const recentLog = (s?.log || []).slice(-6).reverse();

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5">
        <CalendarCheck size={18} className="text-brand" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Today's session</div>
          <div className="text-[12.5px] text-muted">
            {win?.auto
              ? `Runs by itself ${win.start}:00-${win.end}:00 (${win.tz.replace("Africa/", "")}) on weekdays: learns from your reviews, picks what to write and why, writes, critiques, briefs you.`
              : "On this machine a session only runs when you start it."}
          </div>
        </div>
        {running ? (
          <Badge tone="brand" icon={CircleNotch} className="[&>svg]:animate-spin">
            {PHASE_LABEL[s.phase] || s.phase}
            {s.writeStop ? ` · writing until ${time(s.writeStop, win?.tz)}` : ""}
          </Badge>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink-2"
              aria-label="Session length"
            >
              {[30, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
            <Button onClick={runNow} disabled={busy === "run"}>
              {busy === "run" ? <CircleNotch size={15} className="animate-spin" /> : <Play size={15} weight="fill" />}
              Run a session now
            </Button>
          </div>
        )}
      </div>

      {err && (
        <div className="flex items-center gap-2 border-b border-line bg-crit-soft/60 px-4 py-2 text-[12.5px] text-crit">
          <WarningCircle size={15} /> {err}
        </div>
      )}

      {running && recentLog.length > 0 && (
        <ul className="border-b border-line px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
          {recentLog.map((l, i) => (
            <li key={l.at + i} className="flex gap-2">
              <span className="w-11 shrink-0 font-mono text-faint">{time(l.at, win?.tz)}</span>
              <span className={i === 0 ? "text-ink-2" : ""}>{l.text}</span>
            </li>
          ))}
        </ul>
      )}

      {brief ? <Brief brief={brief} onOpenDraft={onOpenDraft} /> : !running && (
        <EmptyState icon={CalendarCheck} title="No briefing yet" hint="After its first session Jarvis leaves a briefing here: what it learned, what it wrote and why, what it threw away, and what it needs from you." />
      )}
    </Card>
  );
}

function Brief({ brief, onOpenDraft }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-faint">Briefing · {day(brief.createdAt)}</span>
        <span className="font-medium text-ink">{brief.headline}</span>
      </div>

      {brief.needs?.length > 0 && (
        <div className="mt-2.5 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12.5px] text-ink-2">
          <span className="font-semibold text-warn">Needs from you: </span>
          {brief.needs.join(" ")}
        </div>
      )}

      {brief.produced?.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[12px] font-semibold text-muted">Written for your review</div>
          <ul className="space-y-1.5">
            {brief.produced.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpenDraft?.(p.id)} className="text-left font-medium text-ink hover:text-brand hover:underline">
                  {p.kind === "blog" ? "Blog" : "LinkedIn"}: {p.title}
                </button>
                <span className="text-faint"> · review {p.score}/10</span>
                <div className="text-[12.5px] text-muted">Why: {p.why}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-3 text-[12.5px] font-medium text-brand hover:underline">
        {open ? "Hide details" : "What it learned, threw away and recommends"}
      </button>
      {open && (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <Section icon={Brain} title="Learned" items={brief.learned} empty="Nothing new: review some drafts so it can learn." />
          <Section icon={Trash} title="Threw away" items={(brief.discarded || []).map((d) => `${d.title}: ${d.reason}`)} empty="Nothing: every draft passed." />
          <Section icon={Lightbulb} title="Recommends for the site" items={(brief.recommendations || []).map((r) => `${r.title} (${r.why})`)} empty="No site changes today." />
          <Section icon={MagnifyingGlass} title="Asked the Researcher to look into" items={(brief.research || []).map((r) => `${r.topic} (${r.why})`)} empty="No new research questions." />
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, items = [], empty }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        <Icon size={13} /> {title}
      </div>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-ink-2">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <div className="text-[12.5px] text-faint">{empty}</div>
      )}
    </div>
  );
}

// ---------- Fresh start ----------

export function FreshStart({ onDone }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => api("/api/fresh-start").then(setInfo).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);

  const c = info?.counts;
  async function go() {
    if (!c) return;
    const ok = window.confirm(
      `Fresh start: clear Jarvis's work-in-progress so you start from a clean slate.\n\n` +
        `Archived (kept, out of sight, restorable):\n` +
        `• ${c.draftsToArchive} unreviewed drafts (your ${c.draftsKept} approved/posted drafts stay)\n` +
        `• ${c.findings} findings, ${c.recommendations} recommendations, ${c.directives} build/avoid notes\n` +
        `• the research queue and the activity feed\n\n` +
        `Kept as Jarvis's background knowledge: the wiki, keyword research and competitor profiles.\n` +
        `Jarvis re-checks the open recommendations in its next session and turns the build/avoid notes into tentative playbook rules.\n\nGo ahead?`
    );
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const m = await api("/api/fresh-start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      setMsg(`Done. Archived ${m.archivedDraftIds.length} drafts and the old lists; nothing was deleted.`);
      await load();
      onDone?.();
    } catch (e) {
      setMsg(`Fresh start failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  async function restore(id) {
    if (!window.confirm("Bring back everything this fresh start archived? Anything new since then stays.")) return;
    setBusy(true);
    try {
      const out = await api("/api/fresh-start/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      setMsg(`Restored ${out.restored.drafts} drafts and the archived lists.`);
      await load();
      onDone?.();
    } catch (e) {
      setMsg(`Restore failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const last = info?.snapshots?.[0];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-muted shadow-card">
      <Broom size={17} className="text-brand" />
      <span className="min-w-0 flex-1">
        {last && !last.restoredAt
          ? `Fresh start on ${day(last.createdAt)}: ${last.archivedDraftIds?.length || 0} drafts and the old lists are archived (restorable).`
          : "Too much old work in the way? A fresh start archives it all (nothing is deleted) and keeps Jarvis's knowledge."}
        {msg && <span className="ml-2 text-ink-2">{msg}</span>}
      </span>
      {last && !last.restoredAt && (
        <Button variant="ghost" onClick={() => restore(last.id)} disabled={busy}>
          <ArrowCounterClockwise size={15} /> Restore
        </Button>
      )}
      <Button variant="outline" onClick={go} disabled={busy || !c}>
        {busy ? <CircleNotch size={15} className="animate-spin" /> : <Broom size={15} />} Fresh start
      </Button>
    </div>
  );
}

// ---------- Playbook tab ----------

const KIND_TONE = { topic: "brand", voice: "violet", claim: "crit", format: "sky", timing: "good", avoid: "warn" };
const SOURCE_LABEL = { founder: "Mara", seed: "starting rule", edit: "learned from an edit", rejection: "learned from a rejection", analytics: "learned from analytics", research: "from the Researcher", you: "added by hand" };

export function Playbook() {
  const [rules, setRules] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState({ kind: "voice", text: "" });
  const [editing, setEditing] = useState(null); // { id, text }

  const load = useCallback(async () => {
    try {
      const out = await api("/api/playbook");
      setRules(out.rules || []);
      setKinds(out.kinds || []);
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function patch(id, body) {
    try {
      await api(`/api/playbook/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }
  async function add() {
    if (!draft.text.trim()) return;
    try {
      await api("/api/playbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      setDraft({ kind: draft.kind, text: "" });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const used = rules.filter((r) => r.status === "active" && (r.pinned || r.confidence >= 0.5));
  return (
    <div className="py-2">
      <p className="mb-3 px-1 text-[12.5px] leading-relaxed text-muted">
        The rules Jarvis writes and reviews by. Each one gets stronger when your reviews confirm it and weaker when you go the other way.
        Rules at 50% or more (or pinned) are used: {used.length} right now. Edit, pin or add your own.
      </p>
      {err && <div className="mb-2 px-1 text-[12.5px] text-crit">{err}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px]" aria-label="Rule type">
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder='Add a rule, e.g. "Never mention competitors by name"'
          className="min-w-[240px] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px]"
        />
        <Button variant="outline" onClick={add} disabled={!draft.text.trim()}>
          <Plus size={14} /> Add
        </Button>
      </div>

      <ul className="divide-y divide-line">
        {rules.map((r) => {
          const pct = Math.round(r.confidence * 100);
          const isUsed = r.status === "active" && (r.pinned || r.confidence >= 0.5);
          return (
            <li key={r.id} className={`flex flex-wrap items-start gap-3 px-1 py-2.5 ${isUsed ? "" : "opacity-60"}`}>
              <Badge tone={KIND_TONE[r.kind] || "neutral"} className="mt-0.5 w-[62px] justify-center">
                {r.kind}
              </Badge>
              <div className="min-w-0 flex-1">
                {editing?.id === r.id ? (
                  <div className="flex gap-2">
                    <input value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} className="flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-[13px]" />
                    <button type="button" aria-label="Save" onClick={() => patch(r.id, { text: editing.text }).then(() => setEditing(null))} className="text-good">
                      <Check size={16} />
                    </button>
                    <button type="button" aria-label="Cancel" onClick={() => setEditing(null)} className="text-faint">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="text-[13px] leading-relaxed text-ink-2">{r.text}</div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                      <span className={`block h-full ${pct >= 70 ? "bg-good" : pct >= 50 ? "bg-brand" : "bg-line-strong"}`} style={{ width: `${pct}%` }} />
                    </span>
                    {pct}%
                  </span>
                  <span>{SOURCE_LABEL[r.source] || r.source}</span>
                  {!isUsed && <span>· not used yet</span>}
                  {r.evidence?.length > 0 && <span title={r.evidence.map((e) => `${e.at?.slice(0, 10)}: ${e.note}`).join("\n")}>· {r.evidence.length} signal{r.evidence.length === 1 ? "" : "s"}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 text-faint">
                <button type="button" title="Less important" onClick={() => patch(r.id, { confidence: Math.max(0.1, r.confidence - 0.1) })} className="rounded p-1 hover:bg-surface-2">
                  <Minus size={14} />
                </button>
                <button type="button" title="More important" onClick={() => patch(r.id, { confidence: Math.min(0.95, r.confidence + 0.1) })} className="rounded p-1 hover:bg-surface-2">
                  <Plus size={14} />
                </button>
                <button type="button" title={r.pinned ? "Unpin" : "Pin: always use this rule"} onClick={() => patch(r.id, { pinned: !r.pinned })} className={`rounded p-1 hover:bg-surface-2 ${r.pinned ? "text-brand" : ""}`}>
                  <PushPin size={14} weight={r.pinned ? "fill" : "regular"} />
                </button>
                <button type="button" title="Edit" onClick={() => setEditing({ id: r.id, text: r.text })} className="rounded p-1 hover:bg-surface-2">
                  <PencilSimple size={14} />
                </button>
                <button type="button" title="Remove this rule" onClick={() => window.confirm("Remove this rule from the playbook?") && patch(r.id, { status: "deleted" })} className="rounded p-1 hover:bg-surface-2 hover:text-crit">
                  <Trash size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
