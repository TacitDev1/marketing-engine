// The agent team (2026-11-12): Larkwell's marketing agents, each a Claude Code run
// on the server that works from a group of marketing skills (.claude/skills/,
// copied from github.com/coreyhaines31/marketingskills) and files its results
// through this brain's API. Every agent reads .agents/product-marketing.md
// first; that file is the shared picture of Larkwell.
//
// This module is the register: who the agents are, when each is due, whether
// it is switched on, and what its last runs did. It starts nothing itself.
// scripts/agents-window.mjs asks GET /api/agents/due inside the server's daily
// window, runs what is due with the Claude CLI, and reports each run back.
//
// An agent with `status: "planned"` is listed in the app but never due: its
// slash command has not been written yet.

import { load, persist, addActivity } from "./stores.js";
import { sessionWindow, localNow } from "./session.js";
import { postToTeams } from "./teams.js";

// Sonnet 5.5 does the judgement work; Haiku 5.5 is for mechanical jobs
// (assembling a report). Override per agent with MKT_AGENT_MODEL_<ID>, or for
// all of them with MKT_AGENT_MODEL.
const MODEL = "claude-sonnet-5-5";
// An agent sends anything longer than a few words to the brain by writing the
// JSON to a file in .agent-out/ and posting that file. A headless run refuses
// a curl command that carries quoted JSON in a heredoc, so this is the only
// dependable way to file a report. (A file rule is spelled Edit(...); it
// covers the Write tool.)
export const AGENT_OUT_DIR = ".agent-out";
const BRAIN_TOOLS = `Bash(curl:*),Bash(printenv:*),Edit(${AGENT_OUT_DIR}/**)`;
// What no agent may read. An allow rule for Read does not fence reading in: a
// headless run can read any file in the project unless it is denied here.
export const DENIED_TOOLS = "Read(.env),Read(.env.*),Read(**/.env),Read(**/.env.*),Read(.secrets/**),Read(data/**)";
const WEB_TOOLS = `${BRAIN_TOOLS},WebFetch,WebSearch`;
// Agents that work from skills also load them and the shared context file.
const SKILL_TOOLS = "Skill,Read(.claude/skills/**),Read(.agents/**)";
const WEEKDAYS = [1, 2, 3, 4, 5];

// `repeat: "loop"` agents run again and again until the window closes (each
// run checks `precheck` first, so an idle pass costs nothing); `"daily"`
// agents run once on each of their `days` (0 = Sunday).
export const AGENTS = [
  {
    id: "researcher",
    name: "Researcher",
    job: "Researches the questions Jarvis queues and files findings, keywords and competitor profiles.",
    // Its protocol (.claude/commands/mkt-research.md) predates the skills and
    // is self-contained.
    skills: [],
    command: "/mkt-research",
    status: "live",
    repeat: "loop",
    days: WEEKDAYS,
    precheck: "research-queue",
    tools: WEB_TOOLS,
    maxTurns: 80,
    maxMinutes: 30,
  },
  {
    id: "editor",
    name: "Editor",
    job: "Rewrites or rejects drafts before they reach the Library, and clears blogs for publishing.",
    skills: ["copywriting", "copy-editing", "social", "marketing-psychology", "image"],
    command: "/mkt-editor",
    status: "live",
    // Runs whenever unedited drafts are waiting (Jarvis writes through the
    // window), ahead of the Researcher: a blog must be edited before it can
    // be published that afternoon.
    precheck: "editor-queue",
    priority: 1,
    repeat: "loop",
    days: WEEKDAYS,
    tools: `${BRAIN_TOOLS},${SKILL_TOOLS}`,
    maxTurns: 80,
    maxMinutes: 30,
  },
  {
    id: "strategist",
    name: "Strategist",
    job: "Writes next week's plan: the focus, and the blogs and posts Jarvis should write, each with its reason.",
    skills: ["marketing-plan", "content-strategy", "customer-research", "marketing-ideas", "marketing-council"],
    command: "/mkt-strategist",
    status: "live",
    repeat: "daily",
    // Friday, after Measurement: next week's plan is ready before Monday's
    // week-ahead message and Monday's session.
    days: [5],
    tools: `${WEB_TOOLS},${SKILL_TOOLS}`,
    maxTurns: 60,
    maxMinutes: 30,
  },
  {
    id: "seo",
    name: "SEO",
    job: "Audits part of larkwell.example each week and proposes exact fixes for a person to apply.",
    skills: ["seo-audit", "ai-seo", "schema", "site-architecture", "link-building", "competitors"],
    command: "/mkt-seo",
    status: "live",
    repeat: "daily",
    days: [2],
    tools: `${WEB_TOOLS},${SKILL_TOOLS}`,
    maxTurns: 80,
    maxMinutes: 40,
  },
  {
    id: "conversion",
    name: "Conversion",
    job: "Reviews the key pages and proposes concrete changes that turn visitors into enquiries.",
    skills: ["cro", "lead-magnets", "offers", "free-tools", "popups"],
    command: "/mkt-conversion",
    status: "planned",
    repeat: "daily",
    days: [3],
    tools: `${WEB_TOOLS},${SKILL_TOOLS}`,
    maxTurns: 60,
    maxMinutes: 30,
  },
  {
    id: "sales",
    name: "Sales and competitors",
    job: "Keeps competitor dossiers current and drafts one-pagers, outreach and LinkedIn ads research. Publishes nothing.",
    skills: ["competitor-profiling", "reverse-engineer-marketing", "sales-enablement", "prospecting", "cold-email", "launch", "public-relations", "ads", "ad-creative"],
    command: "/mkt-sales",
    status: "planned",
    repeat: "daily",
    days: [4],
    tools: `${WEB_TOOLS},${SKILL_TOOLS}`,
    maxTurns: 80,
    maxMinutes: 40,
  },
  {
    id: "measurement",
    name: "Measurement",
    job: "Reports the week's results from GA4 and Search Console and checks that the tracking still works.",
    skills: ["analytics", "conversion-tracking", "attribution", "ab-testing"],
    command: "/mkt-measurement",
    status: "live",
    repeat: "daily",
    days: [5],
    // Ahead of the Strategist, which reads this report.
    priority: 1,
    tools: `${BRAIN_TOOLS},${SKILL_TOOLS}`,
    maxTurns: 60,
    maxMinutes: 30,
  },
];

const RUNS_KEPT = 200;
// The window closes for agents a little before the box stops, so a run is
// never cut off by the 17:00 shutdown. Minutes before the session window's end.
const STOP_BEFORE_END_MIN = 25;

const byId = (id) => AGENTS.find((a) => a.id === id) || null;

function state() {
  const s = load("agentTeam") || {};
  return { enabled: s.enabled && typeof s.enabled === "object" ? s.enabled : {}, runs: Array.isArray(s.runs) ? s.runs : [], signOutAlertedOn: s.signOutAlertedOn || null };
}

function modelFor(agent) {
  return process.env[`MKT_AGENT_MODEL_${agent.id.toUpperCase()}`] || process.env.MKT_AGENT_MODEL || agent.model || MODEL;
}

// Live agents are on unless someone switched them off; planned ones are never on.
function isEnabled(agent, s = state()) {
  return agent.status === "live" && s.enabled[agent.id] !== false;
}

function describe(agent, s) {
  const runs = s.runs.filter((r) => r.agentId === agent.id);
  return {
    id: agent.id,
    name: agent.name,
    job: agent.job,
    skills: agent.skills,
    status: agent.status,
    enabled: isEnabled(agent, s),
    repeat: agent.repeat,
    days: agent.days,
    model: modelFor(agent),
    lastRun: runs[0] || null,
    runCount: runs.length,
  };
}

export function listAgents() {
  const s = state();
  return AGENTS.map((a) => describe(a, s));
}

export function agentRuns(id, limit = 20) {
  return state()
    .runs.filter((r) => !id || r.agentId === id)
    .slice(0, limit);
}

// Returns the updated agent, or null (unknown id) / false (a planned agent
// cannot be switched on).
export function setAgentEnabled(id, enabled, nowISO) {
  const agent = byId(id);
  if (!agent) return null;
  if (agent.status !== "live") return false;
  const s = state();
  s.enabled[id] = !!enabled;
  persist("agentTeam", s);
  addActivity({ actor: "you", event: "agent.toggled", summary: `${agent.name} agent switched ${enabled ? "on" : "off"}` }, nowISO);
  return describe(agent, s);
}

// What the runner should start now. `secondsLeft` is how long the agents'
// window still has today (0 outside it); the runner must not start a run it
// cannot finish. Daily agents that already ran today are left out.
// `only` names one agent for a manual run: it is returned if it is live and
// switched on, whatever the day and whether or not it already ran.
export function dueAgents(date = new Date(), { only = "" } = {}) {
  const win = sessionWindow();
  const t = localNow(win, date);
  const inDays = win.days.includes(t.weekday);
  const stopMin = win.end * 60 - STOP_BEFORE_END_MIN;
  const secondsLeft = inDays && t.minutes >= win.start * 60 ? Math.max(0, (stopMin - t.minutes) * 60 - t.seconds) : 0;
  const s = state();
  const ranToday = (a) => s.runs.some((r) => r.agentId === a.id && r.dateKey === t.dateKey && r.status === "ok");
  const agents = AGENTS.filter((a) => isEnabled(a, s))
    .filter((a) => (only ? a.id === only : a.days.includes(t.weekday) && (a.repeat === "loop" || !ranToday(a))))
    // Once-a-day agents first, so the looping ones fill the time that is left.
    .sort((a, b) => (a.repeat === "loop") - (b.repeat === "loop") || (b.priority || 0) - (a.priority || 0))
    .map((a) => ({
      id: a.id,
      name: a.name,
      command: a.command,
      model: modelFor(a),
      tools: a.tools,
      deniedTools: DENIED_TOOLS,
      maxTurns: a.maxTurns,
      maxMinutes: a.maxMinutes,
      repeat: a.repeat,
      precheck: a.precheck || null,
    }));
  return { dateKey: t.dateKey, tz: win.tz, secondsLeft, agents };
}

const RUN_STATUSES = ["ok", "failed", "timeout", "skipped"];

// A run that failed because Claude on the machine is signed out (its sign-in
// expired). Every run fails the same way until a person signs in again.
const SIGNED_OUT = /OAuth session expired|Failed to authenticate|not logged in|Please run \/login|Invalid API key/i;
export const signedOut = (run) => !!run && run.status === "failed" && SIGNED_OUT.test(String(run.summary || ""));

// True when the newest real run (not skipped) failed for the sign-in: the
// agents stay down until someone signs in.
export function agentsSignedOut() {
  const last = state().runs.find((r) => r.status !== "skipped");
  return signedOut(last);
}

// Claude is signed out: say so in Teams at once (once a day), not only in
// Friday's summary, because every agent run fails until someone signs in.
function alertSignedOut(rec, nowISO) {
  const s = state();
  if (s.signOutAlertedOn === rec.dateKey) return;
  persist("agentTeam", { ...s, signOutAlertedOn: rec.dateKey });
  addActivity({ actor: "agent", event: "agent.signed_out", summary: "Claude is signed out on this machine; the agents cannot run until someone signs in again" }, nowISO);
  void postToTeams({
    title: "The marketing agents cannot run: Claude is signed out",
    sections: [{ lines: [`The ${byId(rec.agentId)?.name || rec.agentId} agent failed because Claude's sign-in has expired. Every agent run fails the same way until someone signs in again.`, "Fix: on the server, run claude, type /login and sign in with the marketing Claude account."], plain: true }],
  });
}

// The runner reports each finished run here. Returns the stored run or null
// for an unknown agent.
export function recordAgentRun(id, run, nowISO) {
  const agent = byId(id);
  if (!agent) return null;
  const win = sessionWindow();
  const startedAt = Date.parse(run?.startedAt) ? new Date(run.startedAt).toISOString() : nowISO;
  const rec = {
    agentId: id,
    dateKey: localNow(win, new Date(startedAt)).dateKey,
    startedAt,
    finishedAt: nowISO,
    status: RUN_STATUSES.includes(run?.status) ? run.status : "failed",
    exitCode: Number.isInteger(run?.exitCode) ? run.exitCode : null,
    model: String(run?.model || "").slice(0, 60),
    // The agent's own closing report (its last lines of output), for the app
    // and the weekly summary.
    summary: String(run?.summary || "").slice(-2000),
  };
  const s = state();
  s.runs = [rec, ...s.runs].slice(0, RUNS_KEPT);
  persist("agentTeam", s);
  if (rec.status !== "skipped") {
    const secs = Math.max(0, Math.round((Date.parse(rec.finishedAt) - Date.parse(rec.startedAt)) / 1000));
    addActivity({ actor: "agent", event: `agent.${rec.status}`, summary: `${agent.name} agent ${rec.status === "ok" ? "finished" : rec.status} after ${Math.round(secs / 60)} min` }, nowISO);
  }
  if (signedOut(rec)) alertSignedOut(rec, nowISO);
  return rec;
}
