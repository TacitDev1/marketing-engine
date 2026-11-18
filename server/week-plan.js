// The week's plan (agent team, phase 3). Once a week the Strategist agent
// decides what Larkwell should say and to whom: one focus, a few themes, and the
// specific blogs and LinkedIn posts worth writing, each with its reason. Jarvis
// reads the plan in every daily session and writes from it, so the daily picks
// follow a week-long line instead of whatever the data shows that afternoon.
//
// The plan guides; it does not force. Jarvis may still pick something else
// when the day's data gives a strong reason, and says so in its "why".

import { services, postTypes } from "../src/lib/company.js";
import { listDrafts } from "./drafts.js";
import { mergedKeywords } from "./strategy.js";
import { activeRules } from "./playbook.js";
import { publishingStatus } from "./autopublish.js";
import { fileReport, latestReport, previousReport } from "./agent-reports.js";
import { sessionWindow, localNow } from "./session.js";
import { gscConfigured, ga4Configured, gscOpportunities, ga4Summary } from "./tools/google.js";
import { load, persist, enqueueTopic, tasteSince, listFeedback, listCompetitors, newId } from "./stores.js";

const DAY_MS = 86400000;
// A plan guides Jarvis for eleven days: filed on a Friday, it covers the week
// after, plus cover into the following week when the Strategist misses a
// Friday (a public holiday, a failed run).
const PLAN_LIVE_MS = 11 * DAY_MS;
const PLANS_KEPT = 12;
const MAX_PIECES = 14;
const serviceIds = new Set(services.map((s) => s.id));
// Case studies need a real client win, so they are never planned unattended.
const POST_TYPES = postTypes.filter((p) => p.id !== "case-study").map((p) => p.id);

const line = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const state = () => {
  const s = load("weekPlan") || {};
  return { plans: Array.isArray(s.plans) ? s.plans : [] };
};

export function listPlans(limit = 6) {
  return state().plans.slice(0, limit);
}

// The plan Jarvis should follow now, or null when there is none or it is stale.
export function currentPlan(date = new Date()) {
  const p = state().plans[0];
  return p && date.getTime() - Date.parse(p.createdAt) < PLAN_LIVE_MS ? p : null;
}

// A piece Jarvis tried to write this many times without a draft surviving the
// critic is dropped, so one bad piece cannot take a slot every day of the week.
const MAX_ATTEMPTS = 2;

// Pieces of the current plan nobody has written yet, in the Strategist's order.
export function openPieces(date = new Date()) {
  return (currentPlan(date)?.pieces || []).filter((p) => !p.draftId && (p.attempts || 0) < MAX_ATTEMPTS);
}

// Jarvis wrote this piece and the draft was thrown away.
export function noteAttempt(pieceId) {
  const s = state();
  const piece = s.plans[0]?.pieces.find((p) => p.id === pieceId);
  if (!piece) return;
  piece.attempts = (piece.attempts || 0) + 1;
  persist("weekPlan", s);
}

export function markPieceUsed(pieceId, draftId, nowISO) {
  const s = state();
  const piece = s.plans[0]?.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.draftId) return false;
  piece.draftId = draftId;
  piece.usedAt = nowISO;
  persist("weekPlan", s);
  return true;
}

function planBody(p) {
  const out = [`**Focus:** ${p.focus}`, ""];
  if (p.themes.length) out.push("## Themes", ...p.themes.map((t) => `- **${t.theme}**${t.serviceId ? ` (${t.serviceId})` : ""}: ${t.why}`), "");
  out.push("## Pieces to write", ...p.pieces.map((x, i) => `${i + 1}. ${x.kind === "blog" ? `Blog on "${x.keyword}"` : `LinkedIn ${x.postType}`}${x.serviceId ? ` (${x.serviceId})` : ""}: ${x.angle} *Why: ${x.why}*`), "");
  if (p.avoid.length) out.push("## Leave alone this week", ...p.avoid.map((a) => `- ${a}`), "");
  if (p.research.length) out.push("## Questions for the Researcher", ...p.research.map((r) => `- ${r.topic} (${r.why})`), "");
  if (p.notes) out.push("## Notes", p.notes);
  return out.join("\n").trim();
}

// The week a plan is for: a plan filed from Thursday on is for the week
// starting the next Monday (the Strategist runs on Friday afternoon).
function weekOfFor(nowISO) {
  const win = sessionWindow();
  const t = localNow(win, new Date(nowISO));
  if (t.weekday >= 1 && t.weekday <= 3) return t.dateKey;
  const ahead = (8 - t.weekday) % 7 || 7;
  return localNow(win, new Date(Date.parse(nowISO) + ahead * DAY_MS)).dateKey;
}

// The Strategist files its plan here. Returns { plan, report } or { error }.
export function saveWeekPlan(input, nowISO) {
  const focus = line(input?.focus, 400);
  if (!focus) return { error: "focus_required" };
  const pieces = [];
  for (const p of Array.isArray(input?.pieces) ? input.pieces.slice(0, MAX_PIECES) : []) {
    const kind = p?.kind === "blog" ? "blog" : p?.kind === "linkedin" ? "linkedin" : "";
    const angle = line(p?.angle, 400);
    const why = line(p?.why, 400);
    const keyword = line(p?.keyword, 120);
    if (!kind || !angle || !why || (kind === "blog" && !keyword)) continue;
    pieces.push({
      id: `pp-${pieces.length + 1}-${Date.parse(nowISO) || 0}`,
      kind,
      keyword,
      serviceId: serviceIds.has(p.serviceId) ? p.serviceId : "",
      postType: kind === "blog" ? undefined : POST_TYPES.includes(p.postType) ? p.postType : "how-to",
      angle,
      why,
      draftId: null,
      usedAt: null,
      attempts: 0,
    });
  }
  if (!pieces.length) return { error: "pieces_required" };

  const research = [];
  for (const r of Array.isArray(input?.research) ? input.research.slice(0, 5) : []) {
    const topic = line(r?.topic, 300);
    const why = line(r?.why, 300);
    if (!topic) continue;
    enqueueTopic({ topic, front: "messaging", rationale: `Strategist, week of ${nowISO.slice(0, 10)}: ${why}`, priority: 5, createdBy: "strategist" }, nowISO);
    research.push({ topic, why });
  }

  const plan = {
    id: newId("plan", nowISO),
    createdAt: nowISO,
    weekOf: weekOfFor(nowISO),
    focus,
    themes: (Array.isArray(input?.themes) ? input.themes : [])
      .map((t) => ({ theme: line(t?.theme, 160), serviceId: serviceIds.has(t?.serviceId) ? t.serviceId : "", why: line(t?.why, 300) }))
      .filter((t) => t.theme)
      .slice(0, 5),
    pieces,
    avoid: (Array.isArray(input?.avoid) ? input.avoid : []).map((a) => line(a, 200)).filter(Boolean).slice(0, 8),
    research,
    notes: line(input?.notes, 1200),
  };
  const s = state();
  persist("weekPlan", { plans: [plan, ...s.plans].slice(0, PLANS_KEPT) });

  // The plan is also the Strategist's report, so it shows with the others.
  const { report } = fileReport(
    "strategist",
    {
      title: `Plan for the week of ${plan.weekOf}`,
      headline: focus,
      body: planBody(plan),
      needs: input?.needs,
    },
    nowISO
  );
  return { plan, report };
}

// Lines for Jarvis's daily planning prompt; empty when there is no live plan.
export function planLinesForJarvis(date = new Date()) {
  const plan = currentPlan(date);
  if (!plan) return [];
  const open = openPieces(date);
  return [
    `THE WEEK'S PLAN FROM THE STRATEGIST (week of ${plan.weekOf}). Focus: ${plan.focus}`,
    ...(open.length
      ? [
          "Pieces of the plan not written yet (id: piece). Pick from these first, in this order, and give the id as planPieceId. Choose something else only when today's data gives a strong reason, and say so in the why:",
          ...open.slice(0, 8).map((p) => `- ${p.id}: ${p.kind === "blog" ? `blog, keyword "${p.keyword}"` : `linkedin ${p.postType}`}${p.serviceId ? `, service ${p.serviceId}` : ""}. Angle: ${p.angle} Why: ${p.why}`),
        ]
      : ["No piece of the plan is left to write; choose from today's data, in line with the focus."]),
    ...(plan.avoid.length ? [`The plan says to leave these alone this week: ${plan.avoid.join(" | ")}`] : []),
  ];
}

// ---------- what the Strategist is given ----------

const within = (iso, ms, now) => now - Date.parse(iso || 0) < ms;

// Everything the Strategist needs to plan a week, in one call. Each outside
// source fails soft: a missing connection is reported, never thrown.
export async function strategistBrief(date = new Date()) {
  const now = date.getTime();
  const win = sessionWindow();
  const drafts = listDrafts();
  const missing = [];

  let search = null;
  if (gscConfigured()) {
    try {
      const o = await gscOpportunities();
      search = { range: o.range, closeToPageOne: o.strikingDistance.slice(0, 15), seenButNotClicked: o.ctrGaps.slice(0, 8) };
    } catch (err) {
      missing.push(`Search Console failed: ${String(err.message).slice(0, 120)}`);
    }
  } else missing.push("Search Console is not connected on this machine.");

  let traffic = null;
  if (ga4Configured()) {
    try {
      const g = await ga4Summary();
      traffic = { range: g.range, totals: g.totals, topPages: (g.topPages || []).slice(0, 10) };
    } catch (err) {
      missing.push(`GA4 failed: ${String(err.message).slice(0, 120)}`);
    }
  } else missing.push("GA4 is not connected on this machine.");

  const recent = drafts
    .filter((d) => within(d.savedAt, 45 * DAY_MS, now))
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
    .slice(0, 60)
    .map((d) => ({
      kind: d.kind,
      title: line(d.payload?.title || d.payload?.hook, 120),
      keyword: d.payload?.keyword || "",
      serviceId: d.payload?.serviceId || "",
      status: d.status,
      date: String(d.savedAt).slice(0, 10),
      editor: d.payload?.editor ? { verdict: d.payload.editor.verdict, score: d.payload.editor.score, reason: line(d.payload.editor.reason, 160) } : null,
      publishedUrl: d.payload?.publishedUrl || "",
    }));
  const coverage = Object.fromEntries(services.map((s) => [s.id, 0]));
  for (const d of drafts) {
    if (d.status !== "archived" && within(d.savedAt, 45 * DAY_MS, now) && d.payload?.serviceId in coverage) coverage[d.payload.serviceId]++;
  }
  const covered = recent.map((r) => `${r.title} ${r.keyword}`).join(" ").toLowerCase();

  const reviews = tasteSince(new Date(now - 30 * DAY_MS).toISOString())
    .filter((e) => ["approved", "posted", "rejected", "deleted"].includes(e.event))
    .slice(-30)
    .map((e) => ({ event: e.event, kind: e.kind, serviceId: e.serviceId || "", text: line(e.text, 140), reason: line(e.reason, 200) }));

  const pub = publishingStatus();
  const last = state().plans[0] || null;
  const measurement = latestReport("measurement");
  const seo = latestReport("seo");

  return {
    today: localNow(win, date).dateKey,
    capacity: {
      // What Jarvis can write before the next plan: this is the size to plan for.
      blogsPerDay: win.blogs,
      linkedinPostsPerDay: win.posts,
      workingDays: win.days.length,
      blogPublishingDays: pub.enabled ? pub.days : [],
      blogsClearedAndWaiting: pub.waiting,
    },
    services: services.map((s) => ({ id: s.id, name: s.name || s.label || s.id, piecesInLast45Days: coverage[s.id] })),
    linkedinPostTypes: POST_TYPES,
    search,
    traffic,
    keywordsWithMeasuredVolume: mergedKeywords()
      .filter((k) => k.volume != null && !k.estimated && !covered.includes(String(k.keyword).toLowerCase()))
      .slice(0, 40)
      .map((k) => ({ keyword: k.keyword, monthlySearches: k.volume, segment: k.segment || "", intent: k.intent || "" })),
    recentWork: recent,
    teamReviews: reviews,
    openTeamNotes: listFeedback({ status: "open" }).slice(0, 8).map((f) => line(f.text, 240)),
    playbookRules: activeRules({ limit: 20 }).map((r) => `(${r.kind}) ${r.text}`),
    competitors: listCompetitors().slice(0, 12).map((c) => ({ name: c.name, positioning: line(c.positioning || c.summary, 200) })),
    lastPlan: last
      ? { weekOf: last.weekOf, focus: last.focus, pieces: last.pieces.map((p) => ({ kind: p.kind, keyword: p.keyword, angle: p.angle, written: !!p.draftId })), avoid: last.avoid }
      : null,
    latestMeasurement: measurement ? { date: measurement.dateKey, headline: measurement.headline, metrics: measurement.metrics } : null,
    latestSeo: seo ? { date: seo.dateKey, headline: seo.headline, openActions: (previousReport("seo")?.actions || []).filter((a) => a.status === "open").map((a) => a.title) } : null,
    missing,
  };
}
