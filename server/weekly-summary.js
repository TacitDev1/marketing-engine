// The weekly summary (Tobias, 2026-11-12): once a week, what was published,
// what the agents did, and what needs a person. It is built in code from the
// brain's own records (no model call), kept in data/summaries.json, shown in
// the app, and posted to a Teams channel when MKT_TEAMS_WEBHOOK is set.
//
// Sent automatically on the server on MKT_SUMMARY_DAY (default 5 = Friday) from
// MKT_SUMMARY_TIME (default 16:30, session timezone), once per day at most; if
// that day was missed, on the next day the server is on.

import { listDrafts } from "./drafts.js";
import { listAgents, agentRuns, agentsSignedOut } from "./agent-team.js";
import { publishCandidates, awaitingApproval, publishingStatus } from "./autopublish.js";
import { listReports } from "./agent-reports.js";
import { currentPlan } from "./week-plan.js";
import { sessionWindow, localNow } from "./session.js";
import { analyticsSummary } from "./tools/google.js";
import { postToTeams, appUrl } from "./teams.js";
import { load, persist, addActivity, newId } from "./stores.js";

const WEEK_MS = 7 * 86400000;
const KEPT = 60;
const CHECK_EVERY_MS = 5 * 60 * 1000;
const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ""));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// GA4 can be slow or unconfigured; the summary never waits long for it.
async function trafficLine() {
  try {
    const a = await Promise.race([analyticsSummary(), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 12000))]);
    const t = a?.ga4?.totals;
    if (!t) return null;
    return `Website, last 28 days (GA4): ${plural(t.sessions, "session")}, ${plural(t.users, "visitor")}.`;
  } catch {
    return null;
  }
}

// The facts for the week ending `nowISO`.
export async function buildWeeklySummary(nowISO, { traffic = trafficLine } = {}) {
  const now = Date.parse(nowISO);
  const since = now - WEEK_MS;
  const inWeek = (iso) => {
    const t = Date.parse(iso || 0);
    return t > since && t <= now;
  };
  const drafts = listDrafts();
  const pub = publishingStatus();
  const log = (load("publishing")?.log || []).filter((e) => inWeek(e.at));
  const published = log.filter((e) => e.status === "published").map((e) => ({ title: e.title, url: e.url }));
  // Count a blog once even if the push was retried.
  const failedPublishes = [...new Map(log.filter((e) => e.status === "failed").map((e) => [e.draftId, e])).values()]
    .filter((e) => !log.some((p) => p.status === "published" && p.draftId === e.draftId))
    .map((e) => ({ title: e.title, error: e.error }));

  const runs = agentRuns(null, 200).filter((r) => inWeek(r.finishedAt));
  const agents = listAgents()
    .filter((a) => a.status === "live")
    .map((a) => {
      const mine = runs.filter((r) => r.agentId === a.id && r.status !== "skipped");
      return { id: a.id, name: a.name, enabled: a.enabled, runs: mine.length, failed: mine.filter((r) => r.status !== "ok").length };
    });

  const written = drafts.filter((d) => inWeek(d.savedAt));
  const edited = drafts.filter((d) => inWeek(d.payload?.editor?.at));
  const editor = {
    passed: edited.filter((d) => d.payload.editor.verdict === "pass").length,
    cleared: edited.filter((d) => d.payload.editor.cleared).length,
    rejected: edited.filter((d) => d.payload.editor.verdict === "reject").map((d) => ({ title: clip(d.payload.title || d.payload.hook, 90), reason: clip(d.payload.editor.reason, 160) })),
  };
  // LinkedIn is posted by a person: these are edited and waiting for one.
  const linkedinReady = drafts
    .filter((d) => d.kind === "linkedin" && (d.status === "draft" || d.status === "approved") && d.payload?.editor?.verdict === "pass")
    .sort((a, b) => (b.payload.editor.score || 0) - (a.payload.editor.score || 0));

  // What the reporting agents (Strategist, SEO, Measurement) found this week:
  // the newest report of each.
  const reports = [];
  for (const r of listReports({ limit: 80 })) {
    if (inWeek(r.createdAt) && !reports.some((x) => x.agentId === r.agentId)) reports.push(r);
  }
  const plan = currentPlan(new Date(nowISO));

  const needs = [];
  for (const r of reports) for (const n of r.needs) needs.push(`${r.agentName}: ${n}`);
  for (const f of failedPublishes) needs.push(`A blog could not be published: "${clip(f.title, 80)}" (${f.error}).`);
  if (agentsSignedOut()) needs.push("Claude is signed out on the server, so every agent run fails: someone needs to run claude there, type /login and sign in.");
  for (const a of agents) {
    if (!a.enabled) needs.push(`The ${a.name} agent is switched off.`);
    else if (a.runs && a.failed === a.runs) needs.push(`Every ${a.name} run failed this week.`);
    else if (!a.runs) needs.push(`The ${a.name} agent did not run this week.`);
  }
  const toApprove = awaitingApproval();
  if (toApprove.length) needs.push(`${plural(toApprove.length, "blog")} edited and ready for you to approve in the Library: ${toApprove.slice(0, 3).map((d) => `"${clip(d.payload.title, 70)}"`).join(", ")}. Nothing is published until you approve it.`);
  // Pieces someone stopped after they were approved: they sit in the Library
  // until a person decides what to do with them.
  for (const d of drafts.filter((d) => d.status === "draft" && d.payload?.held)) {
    needs.push(`"${clip(d.payload.title || d.payload.hook, 70)}" was stopped by ${d.payload.held.by || "someone"}${d.payload.held.reason ? ` (${clip(d.payload.held.reason, 100)})` : ""} and is held in the Library.`);
  }
  if (!pub.enabled) needs.push("Scheduled blog publishing is switched off.");
  else if (!published.length && !pub.waiting && !toApprove.length) needs.push("No blog went out and none is ready to approve.");
  if (linkedinReady.length) needs.push(`${plural(linkedinReady.length, "LinkedIn post")} edited and waiting for someone to post.`);

  return {
    id: newId("sum", nowISO),
    createdAt: nowISO,
    weekEnding: localNow(sessionWindow(), new Date(nowISO)).dateKey,
    published,
    failedPublishes,
    agents,
    written: { blogs: written.filter((d) => d.kind === "blog").length, linkedin: written.filter((d) => d.kind !== "blog").length },
    editor,
    blogsWaiting: publishCandidates().length,
    blogsToApprove: toApprove.length,
    linkedinReady: linkedinReady.slice(0, 5).map((d) => clip(d.payload.hook || d.payload.title, 110)),
    linkedinReadyCount: linkedinReady.length,
    traffic: await traffic(),
    reports: reports.map((r) => ({ agent: r.agentName, headline: clip(r.headline, 240), actions: r.actions.length })),
    plan: plan ? { weekOf: plan.weekOf, focus: clip(plan.focus, 240), pieces: plan.pieces.length, written: plan.pieces.filter((p) => p.draftId).length } : null,
    needs,
  };
}

// Sections of plain lines, shared by the app, the stored text and the Teams card.
export function summarySections(s) {
  const out = [];
  out.push({
    title: "Published on larkwell.example",
    lines: s.published.length ? s.published.map((p) => `[${clip(p.title, 100)}](${p.url})`) : ["Nothing was published this week."],
  });
  const work = [`Written: ${plural(s.written.blogs, "blog")}, ${plural(s.written.linkedin, "LinkedIn post")}.`];
  work.push(`Edited: ${s.editor.passed} passed, cleared ${plural(s.editor.cleared, "blog")} for approval, ${s.editor.rejected.length} rejected.`);
  for (const a of s.agents) work.push(`${a.name}: ${a.enabled ? `${plural(a.runs, "run")}${a.failed ? `, ${a.failed} failed` : ""}` : "switched off"}.`);
  work.push(`${plural(s.blogsWaiting, "blog")} approved and waiting for a publishing day; ${s.blogsToApprove ?? 0} waiting for approval.`);
  out.push({ title: "What the agents did", lines: work });
  if (s.editor.rejected.length) out.push({ title: "Rejected by the Editor", lines: s.editor.rejected.slice(0, 5).map((r) => `${r.title}: ${r.reason}`) });
  if (s.linkedinReadyCount) out.push({ title: "LinkedIn posts ready for a person to post", lines: s.linkedinReady });
  // Summaries stored before phase 3 have no reports or plan.
  if (s.plan) out.push({ title: "The week's plan", lines: [s.plan.focus, `${s.plan.written} of ${plural(s.plan.pieces, "planned piece")} written so far.`] });
  if (s.reports?.length) {
    out.push({ title: "What the agents found", lines: s.reports.map((r) => `${r.agent}: ${r.headline}${r.actions ? ` (${plural(r.actions, "proposed fix", "proposed fixes")} in the app)` : ""}`) });
  }
  if (s.traffic) out.push({ title: "Results", lines: [s.traffic] });
  out.push({ title: "Needs you", lines: s.needs.length ? s.needs : ["Nothing this week."] });
  return out;
}

export function summaryText(s) {
  return [`Larkwell marketing: week ending ${s.weekEnding}`, ...summarySections(s).flatMap((sec) => ["", sec.title, ...sec.lines.map((l) => `- ${l}`)])].join("\n");
}

const sendToTeams = (s) => postToTeams({ title: `Larkwell marketing: week ending ${s.weekEnding}`, sections: summarySections(s), actions: [{ title: "Open Jarvis", url: `${appUrl()}/?screen=jarvis` }] });

export function listSummaries(limit = 8) {
  return (load("summaries") || []).slice(0, limit);
}

// Build this week's summary, send it, keep it.
export async function sendWeeklySummary(nowISO, { by = "schedule", send = sendToTeams, traffic } = {}) {
  const summary = await buildWeeklySummary(nowISO, traffic ? { traffic } : {});
  const delivery = await send(summary);
  const rec = { ...summary, text: summaryText(summary), sections: summarySections(summary), delivery, by };
  persist("summaries", [rec, ...(load("summaries") || [])].slice(0, KEPT));
  addActivity(
    {
      actor: "system",
      event: "summary.sent",
      summary: `weekly summary for the week ending ${summary.weekEnding}: ${delivery.status === "sent" ? "posted to Teams" : delivery.status === "not_configured" ? "saved in the app (no Teams connection set up)" : `could not post to Teams (${delivery.error})`}`,
    },
    nowISO
  );
  return rec;
}

// Due on the summary day from the summary time; or on any later day when the
// last summary is over a week old (the server was off on the day itself).
export function summaryDue(date = new Date()) {
  const t = localNow(sessionWindow(), date);
  const day = /^[0-6]$/.test(process.env.MKT_SUMMARY_DAY || "") ? Number(process.env.MKT_SUMMARY_DAY) : 5;
  const [h, m] = String(process.env.MKT_SUMMARY_TIME || "16:30").split(":").map(Number);
  if (t.minutes < (h || 0) * 60 + (m || 0)) return false;
  // Summaries a person sent by hand don't count: the scheduled one still goes out.
  const last = (load("summaries") || []).find((s) => s.by === "schedule");
  if (last?.weekEnding === t.dateKey) return false;
  if (t.weekday === day) return true;
  return !!last && date.getTime() - Date.parse(last.createdAt) > WEEK_MS + 86400000;
}

let timer = null;
let running = false;
export function startSummaryScheduler() {
  if (timer || process.env.MKT_DEPLOYMENT !== "server") return;
  const tick = async () => {
    if (running || !summaryDue()) return;
    running = true;
    try {
      await sendWeeklySummary(new Date().toISOString());
    } catch (err) {
      console.error("weekly summary:", err.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
}
