// The week ahead (Tobias, 2026-11-16): on Monday, when the server starts
// for the day, the team gets one
// message that says, day by day, what will happen this week: what Jarvis is
// due to write, which agents run, which blog goes out on which day, which
// LinkedIn posts are due for a person to post, and, first of all, what is
// waiting for someone's approval, each with a link straight to it.
//
// Built in code from the brain's own records (no model call), kept in
// data/week-ahead.json, shown in the app, and posted to Teams when
// MKT_TEAMS_WEBHOOK is set.
//
// Sent on MKT_WEEK_AHEAD_DAY (default 1 = Monday) from MKT_WEEK_AHEAD_TIME
// (default 15:00, when the server's hours begin; session timezone). If the
// server was off that day, the message goes out on the next working day.

import { listDrafts } from "./drafts.js";
import { AGENTS, listAgents } from "./agent-team.js";
import { publishCandidates, awaitingApproval, publishingStatus } from "./autopublish.js";
import { currentPlan } from "./week-plan.js";
import { listReports } from "./agent-reports.js";
import { listSlots } from "./schedule.js";
import { sessionWindow, localNow } from "./session.js";
import { postToTeams, draftLink, appUrl } from "./teams.js";
import { load, persist, addActivity, newId } from "./stores.js";

const DAY_MS = 86400000;
const KEPT = 30;
const CHECK_EVERY_MS = 5 * 60 * 1000;
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ""));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pieceLabel = (p) => (p.kind === "blog" ? `a blog on "${p.keyword}"` : `a LinkedIn ${p.postType} post (${clip(p.angle, 70)})`);

// The working days the message covers: this week's from today on, or next
// week's when it is built at a weekend.
function daysAhead(nowISO) {
  const win = sessionWindow();
  const out = [];
  const start = Date.parse(nowISO);
  for (let i = 0; i < 7 && out.length < 5; i++) {
    const t = localNow(win, new Date(start + i * DAY_MS));
    if (!win.days.includes(t.weekday)) continue;
    // Stop at the end of the working week (the next Monday belongs to next week's message).
    if (out.length && t.weekday <= out[out.length - 1].weekday) break;
    out.push({ dateKey: t.dateKey, weekday: t.weekday, name: DAY_NAME[t.weekday] });
  }
  return out;
}

export function buildWeekAhead(nowISO) {
  const win = sessionWindow();
  const days = daysAhead(nowISO);
  const pub = publishingStatus();
  const plan = currentPlan(new Date(nowISO));
  const toApprove = awaitingApproval();
  const approved = publishCandidates();
  const live = listAgents().filter((a) => a.status === "live" && a.enabled);
  const onDay = new Map(AGENTS.map((a) => [a.id, a.days]));
  const drafts = new Map(listDrafts().map((d) => [d.id, d]));
  const slots = days.length ? listSlots({ from: days[0].dateKey, to: days[days.length - 1].dateKey }) : [];

  // Jarvis works down the plan: so many blogs and posts a day.
  const blogsLeft = (plan?.pieces || []).filter((p) => !p.draftId && p.kind === "blog");
  const postsLeft = (plan?.pieces || []).filter((p) => !p.draftId && p.kind !== "blog");
  // Blogs go out one per publishing day: approved ones first, then any still
  // waiting for approval (they only go out if someone approves them in time).
  const queue = [...approved.map((d) => ({ d, approved: true })), ...toApprove.map((d) => ({ d, approved: false }))];

  const dayLines = days.map((day) => {
    const lines = [];
    const writing = [...blogsLeft.splice(0, win.blogs), ...postsLeft.splice(0, win.posts)];
    lines.push(writing.length ? `Jarvis writes ${writing.map(pieceLabel).join("; ")}.` : `Jarvis writes ${plural(win.blogs, "blog")} and ${plural(win.posts, "LinkedIn post")}, chosen from that day's search data.`);
    const weekly = live.filter((a) => a.repeat !== "loop" && (onDay.get(a.id) || []).includes(day.weekday));
    for (const a of weekly) lines.push(`${a.name} agent: ${a.job.charAt(0).toLowerCase()}${a.job.slice(1)}`);
    if (pub.enabled && pub.days.includes(day.weekday)) {
      const next = queue.shift();
      if (!next) lines.push(`Blog publishing day (from ${pub.afterHour}:00): nothing is approved yet, so nothing goes out unless a blog is approved by then.`);
      else if (next.approved) lines.push(`Blog goes live from ${pub.afterHour}:00: "${clip(next.d.payload.title, 90)}" (approved).`);
      else lines.push(`Blog publishing day (from ${pub.afterHour}:00): "${clip(next.d.payload.title, 90)}" goes live only if someone approves it first.`);
    }
    for (const s of slots.filter((s) => s.date === day.dateKey && s.kind === "linkedin")) {
      const d = s.draftId ? drafts.get(s.draftId) : null;
      lines.push(d ? `LinkedIn post for a person to post: "${clip(d.payload?.hook || d.payload?.title, 90)}".` : "LinkedIn post due, none chosen yet.");
    }
    return { ...day, lines };
  });

  // What only a person can do, most pressing first: approvals, then the
  // agents' open questions from their newest reports.
  const approvals = toApprove.map((d) => ({ id: d.id, title: clip(d.payload.title, 100), score: d.payload.editor.score, changes: clip(d.payload.editor.changes, 160), url: draftLink(d.id) }));
  const questions = [];
  const seen = new Set();
  for (const r of listReports({ limit: 40 })) {
    if (seen.has(r.agentId) || Date.parse(nowISO) - Date.parse(r.createdAt) > 9 * DAY_MS) continue;
    seen.add(r.agentId);
    for (const n of r.needs) questions.push(`${r.agentName}: ${n}`);
  }

  return {
    id: newId("wa", nowISO),
    createdAt: nowISO,
    weekOf: days[0]?.dateKey || localNow(win, new Date(nowISO)).dateKey,
    focus: plan ? clip(plan.focus, 300) : "",
    approvals,
    days: dayLines,
    questions: questions.slice(0, 8),
    serverHours: `${win.start}:00 to ${win.end}:00 on weekdays`,
  };
}

export function weekAheadSections(w) {
  const out = [];
  if (w.focus) out.push({ title: "This week's focus", lines: [w.focus], plain: true });
  out.push({
    title: w.approvals.length ? `Waiting for your approval (${w.approvals.length})` : "Waiting for your approval",
    lines: w.approvals.length
      ? [...w.approvals.map((a) => `[${a.title}](${a.url}) (Editor ${a.score}/10)`), `Open the link, read it, and mark it Approved. The app is reachable ${w.serverHours}.`]
      : ["Nothing right now. Blogs the Editor clears this week will be posted here as they are ready."],
  });
  for (const d of w.days) out.push({ title: `${d.name} ${d.dateKey.slice(8)}/${d.dateKey.slice(5, 7)}`, lines: d.lines });
  if (w.questions.length) out.push({ title: "Questions from the agents", lines: w.questions });
  return out;
}

export function weekAheadText(w) {
  return [`Larkwell marketing: the week ahead (from ${w.weekOf})`, ...weekAheadSections(w).flatMap((sec) => ["", sec.title, ...sec.lines.map((l) => `- ${l}`)])].join("\n");
}

const sendToTeams = (w) =>
  postToTeams({
    title: `Larkwell marketing: the week ahead (from ${w.weekOf})`,
    sections: weekAheadSections(w),
    actions: [...w.approvals.slice(0, 3).map((a) => ({ title: `Approve: ${clip(a.title, 40)}`, url: a.url })), { title: "Open Jarvis", url: `${appUrl()}/?screen=jarvis` }],
  });

export function listWeekAheads(limit = 4) {
  return (load("weekAhead") || []).slice(0, limit);
}

export async function sendWeekAhead(nowISO, { by = "schedule", send = sendToTeams } = {}) {
  const w = buildWeekAhead(nowISO);
  const delivery = await send(w);
  const rec = { ...w, text: weekAheadText(w), sections: weekAheadSections(w), delivery, by };
  persist("weekAhead", [rec, ...(load("weekAhead") || [])].slice(0, KEPT));
  addActivity(
    { actor: "system", event: "weekahead.sent", summary: `week-ahead message: ${delivery.status === "sent" ? "posted to Teams" : delivery.status === "not_configured" ? "saved in the app (no Teams connection set up)" : `could not post to Teams (${delivery.error})`}` },
    nowISO
  );
  return rec;
}

// Due from the set time on the set day, once a week; and on any later working
// day that week if the server was off then.
export function weekAheadDue(date = new Date()) {
  const win = sessionWindow();
  const t = localNow(win, date);
  const day = /^[0-6]$/.test(process.env.MKT_WEEK_AHEAD_DAY || "") ? Number(process.env.MKT_WEEK_AHEAD_DAY) : 1;
  const [h, m] = String(process.env.MKT_WEEK_AHEAD_TIME || "15:00").split(":").map(Number);
  if (!win.days.includes(t.weekday) || t.weekday < day) return false;
  if (t.weekday === day && t.minutes < (h || 0) * 60 + (m || 0)) return false;
  // One scheduled message per week: none since this week's send day began.
  const last = (load("weekAhead") || []).find((w) => w.by === "schedule");
  const sinceSendDay = (t.weekday - day) * DAY_MS + t.minutes * 60000;
  return !last || date.getTime() - Date.parse(last.createdAt) > sinceSendDay;
}

// The Editor has just cleared a blog: tell the team at once, with the link,
// while the app is up and someone can approve it the same afternoon.
export async function announceForApproval(draft, { send = postToTeams } = {}) {
  const p = draft.payload || {};
  return send({
    title: `Blog ready for your approval: ${clip(p.title, 110)}`,
    sections: [
      { lines: [clip(p.metaDescription, 220) || "No summary."], plain: true },
      { lines: [`Editor's mark: ${p.editor?.score}/10.${p.editor?.changes ? ` What it changed: ${clip(p.editor.changes, 240)}` : ""}`, "It is published on the next publishing day once someone marks it Approved. Nothing goes out before that."] },
    ],
    actions: [{ title: "Read and approve", url: draftLink(draft.id) }],
  });
}

let timer = null;
let running = false;
export function startWeekAheadScheduler() {
  if (timer || process.env.MKT_DEPLOYMENT !== "server") return;
  const tick = async () => {
    if (running || !weekAheadDue()) return;
    running = true;
    try {
      await sendWeekAhead(new Date().toISOString());
    } catch (err) {
      console.error("week ahead:", err.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  // The first check soon after boot: the message should not wait five minutes.
  setTimeout(tick, 60000).unref();
}
