import { useState, useEffect, useCallback, useRef } from "react";
import { useDeployment, placeWords } from "../lib/deployment.js";
import {
  Robot,
  Play,
  Pause,
  WarningCircle,
  Article,
  Sparkle,
  MagnifyingGlass,
  Cpu,
  Notepad,
  Lightbulb,
  Queue as QueueIcon,
  Broadcast,
  Flag,
  Clock,
  Graph,
  CaretDown,
  Brain,
  House,
  UsersThree,
  Newspaper,
  GearSix,
} from "@phosphor-icons/react";
import {
  Button,
  Card,
  StatusDot,
  Tabs,
  EmptyState,
  StatTile,
  AgentCard,
  ActivityFeed,
} from "../components/ui.jsx";
import AgentScene from "../components/AgentScene.jsx";
import JarvisToday, { FreshStart, Playbook } from "../components/JarvisToday.jsx";
import AgentTeam from "../components/AgentTeam.jsx";
import Publishing from "../components/Publishing.jsx";
import WeekAhead from "../components/WeekAhead.jsx";
import ApprovalInbox from "../components/ApprovalInbox.jsx";
import { actorTone, activityText, focusBrief } from "./jarvis/helpers.jsx";
import { ago } from "../lib/format.js";
import { BriefBox } from "./jarvis/BriefBox.jsx";
import { Findings } from "./jarvis/Findings.jsx";
import { Directives } from "./jarvis/Directives.jsx";
import { Recs } from "./jarvis/Recs.jsx";
import { Drafts } from "./jarvis/Drafts.jsx";
import { Queue } from "./jarvis/Queue.jsx";
import { Activity } from "./jarvis/Activity.jsx";
import { Overview } from "./jarvis/Overview.jsx";

// The screen's views. One job each: what needs a person and how the day went;
// the agents and their reports; publishing; the working lists; what Jarvis has
// learned; and the rarely-used controls.
const VIEWS = ["overview", "agents", "publishing", "work", "playbook", "settings"];

export default function Jarvis({ onNavigate, onOpenDraft, active = true }) {
  const dep = useDeployment();
  const place = placeWords(dep);
  const [status, setStatus] = useState(null);
  const [data, setData] = useState({ findings: [], recs: [], directives: [], queue: [], activity: [], drafts: [] });
  const [stats, setStats] = useState({
    draftsToday: 0,
    openFindings: 0,
    abandonedFindings: 0,
    lastTickErrors: 0,
    recsOpen: 0,
    activityTotal: 0,
    trends: { drafts: [], findings: [], recs: [], activity: [] },
  });
  const [tab, setTab] = useState("recs");
  // Which view is open, remembered per browser.
  const [view, setViewState] = useState(() => {
    try {
      const v = localStorage.getItem("jarvis-view");
      return VIEWS.includes(v) ? v : "overview";
    } catch {
      return "overview";
    }
  });
  const setView = useCallback((v) => {
    setViewState(v);
    try {
      localStorage.setItem("jarvis-view", v);
    } catch {
      /* private mode */
    }
  }, []);
  const [needsCount, setNeedsCount] = useState(null);
  const [unreachable, setUnreachable] = useState(false); // brain on :8787 not answering
  const [beat, setBeat] = useState(false); // flips each refresh to show liveness
  const [drafting, setDrafting] = useState({}); // recId -> true while a draft is being generated
  const [draftErr, setDraftErr] = useState({}); // recId -> error text when a draft attempt failed
  // The "how the team works" picture: open by default, remembered per browser.
  const [showScene, setShowScene] = useState(() => {
    try { return localStorage.getItem("jarvis-scene-open") !== "false"; } catch { return true; }
  });

  const refresh = useCallback(() => {
    fetch("/api/autopilot/status")
      .then((r) => r.json())
      .then((s) => {
        setStatus(s);
        setUnreachable(false);
      })
      .catch(() => setUnreachable(true));
    fetch("/api/autopilot/stats").then((r) => r.json()).then(setStats).catch(() => {});
    Promise.all([
      fetch("/api/autopilot/findings?limit=200").then((r) => r.json()).catch(() => ({})),
      fetch("/api/autopilot/recommendations").then((r) => r.json()).catch(() => ({})),
      fetch("/api/autopilot/directives").then((r) => r.json()).catch(() => ({})),
      fetch("/api/autopilot/queue").then((r) => r.json()).catch(() => ({})),
      fetch("/api/autopilot/activity?limit=300").then((r) => r.json()).catch(() => ({})),
      fetch("/api/drafts").then((r) => r.json()).catch(() => ({})),
    ]).then(([f, r, dir, q, a, d]) => {
      // Keep the previous slice when a fetch failed (each catch yields {}) —
      // a brain hiccup must not render as cheerful "Nothing researched yet"
      // empty states (SecondBrain's rule, applied here).
      setData((prev) => ({
        findings: f.findings ?? prev.findings,
        recs: r.recommendations ?? prev.recs,
        directives: dir.directives ?? prev.directives,
        queue: q.queue ? q.queue.filter((t) => ["queued", "claimed"].includes(t.status)) : prev.queue,
        activity: a.activity ?? prev.activity,
        drafts: d.drafts ?? prev.drafts,
      }));
      setBeat((b) => !b);
    });
  }, []);

  // One transient, plain-words note for failed one-click actions (pause/play,
  // rec/directive buttons) — they used to fail in total silence.
  const [actionErr, setActionErr] = useState(null);
  const actionErrTimer = useRef(null);
  function flagActionError(text) {
    setActionErr(text || "That didn't go through — Jarvis may be busy or restarting. Try again in a moment.");
    clearTimeout(actionErrTimer.current);
    actionErrTimer.current = setTimeout(() => setActionErr(null), 6000);
  }

  useEffect(() => {
    // Poll only while this screen is the visible one — keep-alive keeps it
    // mounted forever, and 8 fetches every 5s from a hidden screen adds up.
    // Refreshes immediately on re-activation, so the data is always current.
    if (!active) return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh, active]);

  const [powerBusy, setPowerBusy] = useState(false);
  async function togglePower() {
    if (powerBusy) return; // a double-click must not toggle on→off→on
    setPowerBusy(true);
    try {
      // Send what the button SHOWED (`expect`) along with the intent. The brain
      // refuses (409) if someone else already flipped it — two people pressing
      // "Pause" within one poll used to turn Jarvis back ON.
      const shown = !!status?.workerEnabled;
      const res = await fetch("/api/autopilot/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !shown, expect: shown }),
      });
      if (res.status === 409) {
        const now = await res.json().catch(() => ({}));
        flagActionError(`Someone else just ${now.workerEnabled ? "turned Jarvis on" : "paused Jarvis"} — your click changed nothing.`);
      } else if (!res.ok) flagActionError();
    } catch {
      flagActionError();
    } finally {
      setPowerBusy(false);
      refresh();
    }
  }

  async function setRec(id, s) {
    try {
      const res = await fetch(`/api/autopilot/recommendations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: s }),
      });
      if (!res.ok) flagActionError();
    } catch {
      flagActionError();
    } finally {
      refresh();
    }
  }

  // Approve a rec -> the brain drafts from it (LinkedIn post, or a blog for
  // SEO/content fronts), saves to the Library, and marks the rec done. We jump
  // to the Drafts tab so the result is right there. Still never posts.
  async function draftFromRec(id) {
    setDrafting((d) => ({ ...d, [id]: true }));
    setDraftErr((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
    try {
      const res = await fetch(`/api/autopilot/recommendations/${id}/draft`, { method: "POST" });
      if (res.ok) {
        setView("work");
        setTab("drafts");
      } else {
        // Don't leave the user staring at a spinner that just stops — say it failed.
        const e = await res.json().catch(() => ({}));
        setDraftErr((prev) => ({
          ...prev,
          [id]: e.message || "Couldn't draft this one. Jarvis may be busy - try again in a moment.",
        }));
      }
    } catch {
      setDraftErr((prev) => ({ ...prev, [id]: "Couldn't reach Jarvis. Try again in a moment." }));
    } finally {
      setDrafting((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
      refresh();
    }
  }

  async function setDir(id, s) {
    try {
      const res = await fetch(`/api/autopilot/directives/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: s }),
      });
      if (!res.ok) flagActionError();
    } catch {
      flagActionError();
    } finally {
      refresh();
    }
  }


  const on = status?.workerEnabled;
  const running = status?.workerRunning;
  const seen = status?.researcherLastSeenAt;
  const researcherActive = seen && Date.now() - Date.parse(seen) < 35 * 60000;
  const researcherBusy = seen && Date.now() - Date.parse(seen) < 4 * 60000;
  // From /api/autopilot/stats (counted from the Library by date); the worker-state
  // counter only rolls over when a tick runs, so it went stale for weeks.
  const draftsToday = stats.draftsToday ?? 0;
  const idleOutsideHours = !!on && status?.withinActiveHours === false;
  const ah = status?.activeHours;

  const researcherState = researcherBusy ? "working" : researcherActive ? "on" : "off";
  const workerState = !on ? "off" : running ? "working" : idleOutsideHours ? "idle" : "on";

  const views = [
    { id: "overview", label: "Overview", icon: House, n: needsCount ?? undefined },
    { id: "agents", label: "Agents", icon: UsersThree },
    { id: "publishing", label: "Publishing", icon: Newspaper },
    { id: "work", label: "Research and ideas", icon: Lightbulb, n: data.recs.length },
    { id: "playbook", label: "Playbook", icon: Brain },
    { id: "settings", label: "Settings", icon: GearSix },
  ];
  // "Brief Jarvis" lives in the work view: open it, then put the cursor there.
  const briefJarvis = () => {
    setView("work");
    setTimeout(focusBrief, 60);
  };

  const tabs = [
    { id: "recs", label: "Recommendations", icon: Lightbulb, n: data.recs.length },
    { id: "findings", label: "Findings", icon: Notepad, n: data.findings.length },
    { id: "directives", label: "Build / Avoid", icon: Flag, n: data.directives.length },
    { id: "drafts", label: "Drafts", icon: Article, n: data.drafts.length },
    { id: "queue", label: "Queue", icon: QueueIcon, n: data.queue.length },
    { id: "activity", label: "Activity", icon: Broadcast, n: data.activity.length },
  ];

  const railItems = data.activity.slice(0, 7).map((a) => ({
    id: a.id,
    tone: actorTone(a.actor),
    text: activityText(a, onOpenDraft),
    time: ago(a.ts),
  }));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-6 sm:px-8 lg:px-10">
      <header className="mb-4 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2.5 text-[23px] font-bold tracking-[-0.035em] text-ink">
            <Robot weight="fill" size={26} className="text-brand" />
            Jarvis
          </h1>
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-relaxed text-muted">
            Jarvis and the agent team plan, write, edit and measure Larkwell's marketing. Nothing is published until a person approves it.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {/* The on/off state is the laptop's background worker; the server works in daily sessions. */}
          {!place.server && (
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
                on ? "border-good/25 bg-good-soft text-good" : "border-line bg-surface-2 text-muted"
              }`}
            >
              <StatusDot tone={on ? "good" : "idle"} pulse={on} className={`transition-opacity ${beat ? "opacity-100" : "opacity-60"}`} />
              {on ? "Background drafting is on" : "Background drafting is off"}
            </span>
          )}
          <Button onClick={briefJarvis}>
            <Sparkle size={15} weight="fill" /> Brief Jarvis
          </Button>
        </div>
      </header>

      <nav aria-label="Jarvis views" className="scroll-quiet mb-5 overflow-x-auto border-b border-line pb-2">
        <Tabs tabs={views} active={view} onChange={setView} className="flex-nowrap" />
      </nav>

      {/* Unreachable banner — a dead brain must never render as calm zeros */}
      {unreachable && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-crit/25 bg-crit-soft px-3.5 py-2.5 text-[13px] text-crit">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span>Jarvis is starting up. Give it a moment and it'll reconnect.</span>
        </div>
      )}

      {actionErr && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span>{actionErr}</span>
        </div>
      )}

      {/* Engine-trouble banner — a failing pipeline must never look healthy */}
      {(stats.abandonedFindings > 0 || stats.lastTickErrors > 0) && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            Jarvis hit a snag:
            {stats.lastTickErrors > 0 && ` the last run hit ${stats.lastTickErrors} error${stats.lastTickErrors === 1 ? "" : "s"}`}
            {stats.lastTickErrors > 0 && stats.abandonedFindings > 0 && " ·"}
            {stats.abandonedFindings > 0 &&
              ` ${stats.abandonedFindings} finding${stats.abandonedFindings === 1 ? "" : "s"} failed 3 times and won't be retried`}
            .{" "}
            <button type="button" className="underline" onClick={() => { setView("work"); setTab("activity"); }}>
              See the activity log
            </button>
          </span>
        </div>
      )}

      {/* Overview: what needs a person, the week's plan, today's session, the numbers */}
      {view === "overview" && (
        <div className="flex flex-col gap-4">
          <ApprovalInbox active={active && view === "overview"} />
          <Overview active={active && view === "overview"} onOpenDraft={onOpenDraft} onGo={setView} onCount={setNeedsCount} />
          <JarvisToday onOpenDraft={onOpenDraft} active={active && view === "overview"} />
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <StatTile icon={Article} label="Drafts today" value={draftsToday} sub="written by Jarvis" spark={stats.trends.drafts} />
            <StatTile icon={Notepad} label="Open findings" value={stats.openFindings} sub={`${data.queue.length} questions queued to research`} spark={stats.trends.findings} />
            <StatTile icon={Lightbulb} label="Recommendations" value={stats.recsOpen} sub="open, from Jarvis and the agents" spark={stats.trends.recs} />
            <StatTile icon={Broadcast} label="Events (7 days)" value={stats.trends.activity.reduce((a, b) => a + b, 0)} sub={`${stats.activityTotal} logged in total`} spark={stats.trends.activity} />
          </div>
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3.5 text-[13px] font-semibold tracking-[-0.01em] text-ink">
              <Clock size={16} className="text-brand" />
              Latest activity
              <button type="button" className="ml-auto text-[12.5px] font-medium text-brand hover:underline" onClick={() => { setView("work"); setTab("activity"); }}>
                See all
              </button>
            </div>
            {railItems.length ? <ActivityFeed items={railItems} /> : <EmptyState icon={Broadcast} title="No activity yet" hint="Each step Jarvis and the agents take is listed here." />}
          </Card>
        </div>
      )}

      {/* Agents: who they are, when they run, what each last reported */}
      {view === "agents" && (
        <div className="flex flex-col gap-4">
          <AgentTeam active={active && view === "agents"} />
          <Card className="overflow-hidden">
            <button
              type="button"
              onClick={() => setShowScene((v) => { try { localStorage.setItem("jarvis-scene-open", String(!v)); } catch { /* private mode */ } return !v; })}
              aria-expanded={showScene}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left text-[13px] font-semibold tracking-[-0.01em] text-ink transition-colors hover:bg-surface-2"
            >
              <Graph size={16} className="text-brand" />
              How the team works
              <span className="ml-1 hidden font-normal text-faint sm:inline">the whole flow, at a glance</span>
              <CaretDown size={13} weight="bold" className={`ml-auto text-faint transition-transform duration-200 ${showScene ? "" : "-rotate-90"}`} />
            </button>
            {showScene && <AgentScene />}
          </Card>
        </div>
      )}

      {/* Publishing: the approval queue, the schedule, the weekly summary, the week ahead */}
      {view === "publishing" && (
        <div className="flex flex-col gap-4">
          <Publishing active={active && view === "publishing"} onOpenDraft={onOpenDraft} />
          <WeekAhead active={active && view === "publishing"} />
        </div>
      )}

      {/* Research and ideas: brief Jarvis by hand, and the working lists */}
      {view === "work" && (
        <div className="flex flex-col gap-4">
          <BriefBox onDone={refresh} onNavigate={onNavigate} />
          <Card className="overflow-hidden">
            <div className="scroll-quiet overflow-x-auto border-b border-line p-2.5">
              <Tabs tabs={tabs} active={tab} onChange={setTab} />
            </div>
            <div className="scroll-quiet max-h-[64vh] overflow-y-auto px-3 py-1.5">
              {tab === "recs" && <Recs items={data.recs} onSet={setRec} onDraft={draftFromRec} drafting={drafting} errors={draftErr} />}
              {tab === "findings" && <Findings items={data.findings} />}
              {tab === "directives" && <Directives items={data.directives} onSet={setDir} />}
              {tab === "drafts" && <Drafts items={data.drafts} onNavigate={onNavigate} />}
              {tab === "queue" && <Queue items={data.queue} status={status} onAdded={refresh} />}
              {tab === "activity" && <Activity items={data.activity} onOpenDraft={onOpenDraft} />}
            </div>
          </Card>
        </div>
      )}

      {/* Playbook: what Jarvis has learned from the team's reviews */}
      {view === "playbook" && (
        <Card className="px-3 py-3">
          <Playbook />
        </Card>
      )}

      {/* Settings: the laptop's background worker, and the fresh start */}
      {view === "settings" && (
        <div className="flex flex-col gap-4">
          {place.server ? (
            <Card className="p-5 text-[13px] leading-relaxed text-muted">
              On the server Jarvis works in one session each weekday and the agents run in the same hours. Switch an agent on or off under Agents, and blog publishing
              under Publishing.
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
                <span className="text-[13px] text-muted">
                  <span className="font-medium text-ink">Background drafting on this machine.</span> {on ? "On: Jarvis drafts on its own between sessions." : "Off: Jarvis only works when you run a session or brief it."}
                </span>
                <Button onClick={togglePower} disabled={powerBusy} variant={on ? "outline" : "primary"}>
                  {on ? (
                    <><Pause size={16} weight="fill" /> Pause</>
                  ) : (
                    <><Play size={16} weight="fill" /> Play</>
                  )}
                </Button>
              </div>
              <div className="grid gap-3.5 md:grid-cols-2">
                <AgentCard
                  icon={Cpu}
                  accent="violet"
                  name="Jarvis Worker"
                  statusLabel={workerState === "off" ? "paused" : workerState === "working" ? "drafting" : "idle"}
                  statusTone={workerState === "off" ? "idle" : workerState === "idle" ? "warn" : "good"}
                  pulse={workerState === "working"}
                  sub={`Local model ${place.onHere}. It turns findings into posts and blogs, and every one is quality-checked before you see it.`}
                  meta={
                    !on
                      ? "paused"
                      : idleOutsideHours
                        ? `on · idle until ${String(ah?.start ?? 7).padStart(2, "0")}:00 ${ah?.tz || ""} (active hours) · ${draftsToday} drafts today`
                        : `last built ${ago(status?.lastRunAt)} · ${draftsToday} drafts today`
                  }
                />
                <AgentCard
                  icon={MagnifyingGlass}
                  accent="brand"
                  name="Researcher"
                  statusLabel={researcherState === "working" ? "working" : researcherState === "on" ? "active" : "off"}
                  statusTone={researcherState === "off" ? "idle" : "good"}
                  pulse={researcherState === "working"}
                  sub="Web and SEMrush research. It files findings and answers the questions Jarvis queues."
                  meta={researcherActive ? `last researched ${ago(seen)}` : "not running"}
                  hint={null}
                />
              </div>
            </>
          )}
          <div>
            <h2 className="mb-2 text-[13px] font-semibold text-ink">Start over</h2>
            <FreshStart onDone={refresh} />
          </div>
        </div>
      )}
    </div>
  );
}
