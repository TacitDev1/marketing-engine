// Jarvis's working session — replaces the old 10-minute tick (2026-11-02).
//
// The server runs a short daily window on weekdays (15:00-17:00 local by default), so Jarvis works like
// a marketing lead with a two-hour slot: one session per day, phases back to
// back, flat out on the GPU, every decision written down with its reason.
//
//   1. Observe  what changed since the last session: what the team approved,
//               posted, rejected (and why), how they edited Jarvis's drafts,
//               Search Console / GA4, open team notes, fresh SAP news.
//   2. Learn    update the playbook: confirm or weaken rules, add new ones.
//   3. Plan     choose today's few pieces, each with a "why this, why now",
//               queue research gaps, recommend site changes.
//   4. Write    draft → critic → targeted rewrite, until the writing cut-off.
//   5. Brief    the daily briefing: learned, made, threw away, recommends, needs.
//
// On the server it starts itself inside the window (JARVIS_WINDOW_START/END,
// Europe/London). On a laptop it only runs from "Run a session now".
// Humans still approve and post everything.

import { chatJSON, clean, generateDraft, generateBlog, isBrainAvailable } from "./brain.js";
import { critiqueAndFix } from "./critic.js";
import { ensureSeeded, activeRules, listRules, playbookBlock, reinforce, addRule, decay, RULE_KINDS } from "./playbook.js";
import { findingById, pendingArchivedRecs, markRecsReviewed } from "./fresh-start.js";
import { saveDraft, listDrafts } from "./drafts.js";
import { findNearDuplicate } from "./draft-dedupe.js";
import { mergedKeywords } from "./strategy.js";
import { planLinesForJarvis, openPieces, markPieceUsed, noteAttempt } from "./week-plan.js";
import { gscConfigured, ga4Configured, gscOpportunities, ga4Summary } from "./tools/google.js";
import { fetchNews } from "./tools/web.js";
import { NEWS_QUERIES, ALL_FRONTS } from "./seeds.js";
import { services, postTypes } from "../src/lib/company.js";
import {
  load,
  persist,
  addActivity,
  tasteSince,
  recentFindings,
  addFinding,
  enqueueTopic,
  addRecommendation,
  listFeedback,
} from "./stores.js";

const MIN = 60000;
const serviceIds = new Set(services.map((s) => s.id));
// Case studies need a real, verified client win: never written unattended.
const SESSION_POST_TYPES = postTypes.filter((p) => p.id !== "case-study").map((p) => p.id);
const BRIEFS_CAP = 60;
const LOG_CAP = 80;

// ---------- the window ----------

export function sessionWindow() {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
  return {
    auto: process.env.MKT_DEPLOYMENT === "server" && process.env.JARVIS_SESSION !== "off",
    start: num(process.env.JARVIS_WINDOW_START, 15),
    end: num(process.env.JARVIS_WINDOW_END, 17),
    tz: process.env.JARVIS_TZ || "Europe/London",
    days: [1, 2, 3, 4, 5],
    blogs: Math.max(0, num(process.env.JARVIS_BLOGS_PER_SESSION, 1)),
    posts: Math.max(0, num(process.env.JARVIS_POSTS_PER_SESSION, 2)),
  };
}

export function localNow(win, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: win.tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, minutes, seconds: Number(parts.second), weekday };
}

// Inside the window with enough time left to be worth starting (25 min).
export function inWindow(win = sessionWindow(), date = new Date()) {
  const t = localNow(win, date);
  return win.days.includes(t.weekday) && t.minutes >= win.start * 60 && t.minutes <= win.end * 60 - 25;
}

function windowEndMs(win, date = new Date()) {
  const t = localNow(win, date);
  return date.getTime() + (win.end * 60 - t.minutes) * MIN - t.seconds * 1000;
}

// ---------- session state ----------

const nowISO = () => new Date().toISOString();
function getState() {
  return load("session");
}
function setState(patch) {
  return persist("session", { ...load("session"), ...patch });
}
export function getSession() {
  const s = getState();
  return { ...s, window: sessionWindow(), inWindow: inWindow() };
}
export function listBriefs(limit = 10) {
  return (load("briefs") || []).slice(-limit).reverse();
}

let running = false;
function log(phase, text) {
  const s = getState();
  const entry = { at: nowISO(), phase, text: String(text).slice(0, 300) };
  setState({ phase, log: [...(s.log || []), entry].slice(-LOG_CAP) });
  addActivity({ actor: "jarvis", event: `session.${phase}`, summary: entry.text }, entry.at);
}

// ---------- scheduler (server) ----------

let timer = null;
export function startSessionScheduler() {
  const t = nowISO();
  ensureSeeded(t);
  // A session cut off by the 17:00 stop (or a crash) is not "running" any more.
  const s = getState();
  if (s.running) setState({ running: false, phase: "interrupted", finishedAt: t });
  const win = sessionWindow();
  if (!win.auto) {
    console.log("Jarvis sessions: manual on this machine (Jarvis > Run a session now).");
    return;
  }
  const check = () => {
    try {
      if (running || !inWindow(win)) return;
      const st = getState();
      const today = localNow(win).dateKey;
      if (st.completedDate === today) return;
      // At most two starts a day: a session that keeps crashing must not loop.
      const starts = st.startsDate === today ? st.starts || 0 : 0;
      if (starts >= 2) return;
      setState({ startsDate: today, starts: starts + 1 });
      runSession({ deadlineMs: windowEndMs(win), by: "schedule" }).catch((err) => console.error("session:", err.message));
    } catch (err) {
      console.error("session check:", err.message);
    }
  };
  timer = setInterval(check, 2 * MIN);
  timer.unref?.();
  setTimeout(check, 45000).unref?.();
  console.log(`Jarvis sessions: daily ${win.start}:00-${win.end}:00 ${win.tz}, weekdays.`);
}

// "Run a session now" (Jarvis screen). Returns at once; the session runs on.
export function runSessionNow({ minutes = 60, by = "you" } = {}) {
  if (running) return { started: false, reason: "A session is already running." };
  const m = Math.max(15, Math.min(150, Number(minutes) || 60));
  runSession({ deadlineMs: Date.now() + m * MIN, by }).catch((err) => console.error("session:", err.message));
  return { started: true, minutes: m };
}

// ---------- the session ----------

export async function runSession({ deadlineMs, by = "you" }) {
  if (running) return null;
  running = true;
  const win = sessionWindow();
  const startedAt = nowISO();
  const total = Math.max(10 * MIN, deadlineMs - Date.now());
  const margin = Math.min(20 * MIN, total * 0.2);
  const writeStop = deadlineMs - margin; // no new drafts after this
  const prev = getState();
  // Learning cursor: everything up to the moment the last session LOOKED
  // (observe), not when it finished. The team reviews while the box is up,
  // i.e. mostly during a session; a finish-time cursor skipped those forever.
  const since = prev.observedUpTo || prev.lastStartedAt || null;
  setState({
    date: localNow(win).dateKey,
    phase: "starting",
    running: true,
    by,
    startedAt,
    lastStartedAt: startedAt,
    finishedAt: null,
    deadline: new Date(deadlineMs).toISOString(),
    writeStop: new Date(writeStop).toISOString(),
    picks: [],
    produced: [],
    discarded: [],
    learned: [],
    recommendations: [],
    research: [],
    log: [],
  });
  const ctx = { since, deadlineMs, writeStop, notes: [] };
  try {
    log("starting", `session started (${by}); writing until ${new Date(writeStop).toLocaleTimeString("en-GB", { timeZone: win.tz, hour: "2-digit", minute: "2-digit" })}`);
    ensureSeeded(startedAt);
    if (!(await waitForModel(deadlineMs))) {
      log("error", "the local model never came up; nothing written this session");
      return finish(ctx, { failed: "model unavailable" });
    }

    const observedAt = nowISO();
    const signals = await observe(ctx);
    const learned = await learn(signals, ctx);
    // Only move the cursor once the signals were actually learned from.
    setState({ learned, observedUpTo: observedAt });

    const planned = await plan(signals, ctx, win);
    setState({ picks: planned.picks, recommendations: planned.recommendations, research: planned.research });

    await write(planned.picks, ctx, win);
    return finish(ctx, { signals });
  } catch (err) {
    console.error("session failed:", err);
    log("error", `session stopped: ${err.message}`);
    return finish(ctx, { failed: err.message });
  } finally {
    running = false;
  }
}

async function waitForModel(deadlineMs) {
  // The GPU box boots at 15:00; Ollama can take a few minutes to come up.
  const until = Math.min(deadlineMs - 20 * MIN, Date.now() + 10 * MIN);
  while (Date.now() < until) {
    if (await isBrainAvailable()) return true;
    await new Promise((r) => setTimeout(r, 15000));
  }
  return isBrainAvailable();
}

// ---------- 1. observe ----------

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

async function observe(ctx) {
  log("observe", "looking at what changed since the last session");
  const sinceMs = ctx.since ? Date.parse(ctx.since) : 0;
  const sig = { taste: tasteSince(ctx.since), edits: [], gsc: null, ga4: null, feedback: [], findings: [], archivedRecs: pendingArchivedRecs(), errors: [] };

  // Human edits to Jarvis's drafts: the difference IS the lesson.
  for (const d of listDrafts()) {
    const o = d.payload?.aiOriginal;
    if (!o || d.status === "archived" || Date.parse(d.updatedAt || 0) <= sinceMs) continue;
    const p = d.payload;
    const before = squash(`${o.title || o.hook} ${o.body}`);
    const after = squash(`${p.title || p.hook} ${p.body}`);
    if (before === after) continue;
    sig.edits.push({ id: d.id, kind: d.kind, status: d.status, before: before.slice(0, 500), after: after.slice(0, 500) });
    if (sig.edits.length >= 6) break;
  }

  if (gscConfigured()) {
    try {
      const o = await gscOpportunities();
      sig.gsc = { striking: o.strikingDistance.slice(0, 10), ctrGaps: o.ctrGaps.slice(0, 6) };
    } catch (err) {
      sig.errors.push(`Search Console: ${err.message}`);
    }
  }
  if (ga4Configured()) {
    try {
      const g = await ga4Summary();
      sig.ga4 = { totals: g.totals, topPages: (g.topPages || []).slice(0, 6) };
    } catch (err) {
      sig.errors.push(`GA4: ${err.message}`);
    }
  }
  sig.feedback = listFeedback({ status: "open" }).slice(0, 5).map((f) => `${f.author ? `${f.author}: ` : ""}${f.text.slice(0, 200)}`);

  // A little fresh SAP news so timely topics are on the table.
  const st = getState();
  const cursor = st.newsCursor || 0;
  for (let i = 0; i < 2; i++) {
    const q = NEWS_QUERIES[(cursor + i) % NEWS_QUERIES.length];
    try {
      for (const it of (await fetchNews(q.q, 4)).slice(0, 3)) {
        addFinding({ front: q.front, title: it.title, summary: `SAP news${it.sourceName ? ` (${it.sourceName})` : ""}: ${it.title}.`, url: it.sourceUrl || it.link, sources: [it.sourceUrl || it.link].filter(Boolean), kind: "web" }, nowISO());
      }
    } catch {
      /* news is optional */
    }
  }
  setState({ newsCursor: cursor + 2 });
  const weekAgo = Date.now() - 7 * 86400000;
  sig.findings = recentFindings(40).filter((f) => Date.parse(f.createdAt) > weekAgo).slice(0, 10);

  const kept = sig.taste.filter((e) => e.event === "approved" || e.event === "posted").length;
  const killed = sig.taste.filter((e) => e.event === "rejected" || e.event === "deleted").length;
  log(
    "observe",
    `since last time: ${kept} kept, ${killed} rejected, ${sig.edits.length} edited; ${sig.gsc ? `${sig.gsc.striking.length} search queries close to page one` : "no Search Console data"}; ${sig.findings.length} fresh findings`
  );
  return sig;
}

// ---------- 2. learn ----------

const LEARN_FORMAT = {
  type: "object",
  properties: {
    confirmed: { type: "array", items: { type: "object", properties: { ruleId: { type: "string" }, because: { type: "string" } }, required: ["ruleId", "because"] } },
    contradicted: { type: "array", items: { type: "object", properties: { ruleId: { type: "string" }, because: { type: "string" } }, required: ["ruleId", "because"] } },
    newRules: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: RULE_KINDS }, text: { type: "string" }, because: { type: "string" } }, required: ["kind", "text", "because"] } },
  },
  required: ["confirmed", "contradicted", "newRules"],
};

async function learn(sig, ctx) {
  const t = nowISO();
  const learned = [];
  for (const c of decay(t)) learned.push(`faded (not confirmed lately): "${c.text.slice(0, 80)}" ${c.before} → ${c.after}`);

  const reviews = sig.taste
    .filter((e) => ["approved", "posted", "rejected", "deleted"].includes(e.event))
    .slice(-20)
    .map((e) => `- ${e.event.toUpperCase()} ${e.kind}${e.serviceId ? ` (${e.serviceId})` : ""}${e.text ? `: "${e.text.slice(0, 160)}"` : ""}${e.reason ? ` — reason: ${e.reason}` : ""}`);
  const edits = sig.edits.map((e) => `- EDITED ${e.kind}:\n  Jarvis wrote: ${e.before.slice(0, 350)}\n  The team changed it to: ${e.after.slice(0, 350)}`);
  const notes = sig.feedback.map((f) => `- TEAM NOTE: ${f}`);
  if (!reviews.length && !edits.length && !notes.length) {
    log("learn", "nothing new to learn from yet (no reviews or edits since the last session)");
    return learned;
  }
  const rules = listRules({ includeDormant: false }).slice(0, 30);
  const out = await chatJSON(
    [
      {
        role: "system",
        content: [
          "You keep Larkwell Consulting's marketing playbook: short rules for writing Larkwell's LinkedIn posts and SAP blog articles.",
          "Below are the current rules (with ids) and what the team did with Jarvis's drafts since the last session.",
          "APPROVED/POSTED = they liked it. REJECTED/DELETED = they didn't (the reason, when given, matters most). EDITED = what they changed.",
          "Decide which rules this evidence CONFIRMS and which it CONTRADICTS (use rule ids), and add at most 3 NEW rules",
          "that capture a clear, repeatable preference the evidence shows. Each new rule: one atomic instruction, plain UK English,",
          "specific enough to act on. Do not restate an existing rule. If the evidence is thin, return empty lists.",
          "Return ONLY JSON.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "CURRENT RULES:",
          ...rules.map((r) => `${r.id}: ${r.text}`),
          "",
          "WHAT THE TEAM DID:",
          ...reviews,
          ...edits,
          ...notes,
          "",
          "Update the playbook now as JSON.",
        ]
          .join("\n")
          .slice(0, 14000),
      },
    ],
    LEARN_FORMAT,
    { numPredict: 900, tier: "quality" }
  );
  const ids = new Set(rules.map((r) => r.id));
  for (const c of (out.confirmed || []).slice(0, 8)) {
    if (!ids.has(c.ruleId)) continue;
    const r = reinforce(c.ruleId, +1, c.because, t);
    if (r) learned.push(`confirmed: "${r.rule.text.slice(0, 80)}" (${r.before} → ${r.after})`);
  }
  for (const c of (out.contradicted || []).slice(0, 8)) {
    if (!ids.has(c.ruleId)) continue;
    const r = reinforce(c.ruleId, -1, c.because, t);
    if (r) learned.push(`weakened: "${r.rule.text.slice(0, 80)}" (${r.before} → ${r.after})`);
  }
  for (const n of (out.newRules || []).slice(0, 3)) {
    const text = clean(n.text);
    if (text.length < 15) continue;
    const r = addRule({ kind: n.kind, text, confidence: 0.5, source: edits.length ? "edit" : "rejection", evidence: [{ at: t, note: clean(n.because).slice(0, 200) }] }, t);
    if (r) learned.push(r.merged ? `reinforced: "${r.rule.text.slice(0, 80)}"` : `new rule: "${text.slice(0, 100)}"`);
  }
  log("learn", learned.length ? `playbook: ${learned.length} change${learned.length === 1 ? "" : "s"}` : "the evidence didn't change any rule");
  return learned;
}

// ---------- 3. plan ----------

const PLAN_FORMAT = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["blog", "linkedin"] },
          keyword: { type: "string" },
          serviceId: { type: "string" },
          postType: { type: "string" },
          angle: { type: "string" },
          why: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          findingId: { type: "string" },
          planPieceId: { type: "string" },
        },
        required: ["kind", "serviceId", "angle", "why"],
      },
    },
    research: { type: "array", items: { type: "object", properties: { topic: { type: "string" }, front: { type: "string" }, why: { type: "string" } }, required: ["topic", "why"] } },
    recommendations: {
      type: "array",
      items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, why: { type: "string" }, effort: { type: "string", enum: ["small", "medium", "large"] } }, required: ["title", "detail", "why"] },
    },
  },
  required: ["picks", "research", "recommendations"],
};

function recentWork(days) {
  const cutoff = Date.now() - days * 86400000;
  return listDrafts().filter((d) => Date.parse(d.savedAt || 0) > cutoff);
}

async function plan(sig, ctx, win) {
  const t = nowISO();
  const recent = recentWork(21);
  const coverage = {};
  for (const d of listDrafts().filter((d) => d.status !== "archived" && Date.parse(d.savedAt || 0) > Date.now() - 30 * 86400000)) {
    const id = d.payload?.serviceId;
    if (id) coverage[id] = (coverage[id] || 0) + 1;
  }
  const thin = services
    .slice()
    .sort((a, b) => (coverage[a.id] || 0) - (coverage[b.id] || 0))
    .slice(0, 6)
    .map((s) => s.id);
  const recentTitles = recent.map((d) => d.payload?.title || d.payload?.hook || "").filter(Boolean).slice(0, 20);
  const covered = recentTitles.join(" ").toLowerCase();
  const keywords = mergedKeywords()
    .filter((k) => k.volume != null && !k.estimated && !covered.includes(String(k.keyword).toLowerCase()))
    .slice(0, 12);

  // The Strategist's plan for the week, when there is a live one.
  const weekPlan = planLinesForJarvis();
  const planPieces = new Map(openPieces().map((p) => [p.id, p]));

  const lines = [
    `TODAY: choose exactly ${win.blogs} blog article${win.blogs === 1 ? "" : "s"} and ${win.posts} LinkedIn post${win.posts === 1 ? "" : "s"}, plus 2 backups, ranked best first.`,
    "",
    ...weekPlan,
    weekPlan.length ? " " : "",
    "MEASURED SEARCH DEMAND (Search Console, last 90 days: queries where Larkwell ranks 4-15, i.e. close to page one):",
    ...(sig.gsc?.striking || []).slice(0, 8).map((r) => `- "${r.query}" position ${Math.round(r.position)}, ${r.impressions} impressions, page ${r.page}`),
    !sig.gsc ? "- (Search Console not available today)" : "",
    "KEYWORDS WITH MEASURED VOLUME NOT COVERED RECENTLY (keyword sheet / SEMrush):",
    ...keywords.map((k) => `- "${k.keyword}" ${k.volume}/mo${k.segment ? ` (${k.segment})` : ""}`),
    "FRESH SAP NEWS AND RESEARCH (id: title):",
    ...sig.findings.slice(0, 8).map((f) => `- ${f.id}: ${f.title}`),
    `SERVICES COVERED LEAST IN THE LAST 30 DAYS: ${thin.join(", ")}`,
    `ALREADY WRITTEN IN THE LAST 3 WEEKS (do not repeat these themes): ${recentTitles.join(" | ") || "(nothing yet)"}`,
    sig.feedback.length ? `OPEN NOTES FROM THE TEAM: ${sig.feedback.join(" | ")}` : "",
    "",
    "SITE SIGNALS (for recommendations):",
    ...(sig.gsc?.ctrGaps || []).slice(0, 5).map((r) => `- CTR gap: "${r.query}" on ${r.page} at position ${Math.round(r.position)} gets ${r.clicks} clicks from ${r.impressions} impressions (~${r.missedClicks} missed)`),
    sig.ga4 ? `- GA4 last 28 days: ${sig.ga4.totals?.sessions ?? "?"} sessions; top pages: ${sig.ga4.topPages.map((p) => `${p.page} (${p.views} views)`).join(", ")}` : "",
    ...(sig.archivedRecs.recs.length
      ? ["EARLIER RECOMMENDATIONS TO RE-CHECK (keep only the ones the data above still supports):", ...sig.archivedRecs.recs.slice(0, 12).map((r) => `- ${r.title}: ${String(r.detail).slice(0, 140)}`)]
      : []),
    "",
    `Service ids: ${services.map((s) => s.id).join(", ")}. LinkedIn post types: ${SESSION_POST_TYPES.join(", ")}.`,
    "Plan the session now as JSON.",
  ].filter((l) => l !== "");

  const out = await chatJSON(
    [
      {
        role: "system",
        content: [
          "You are Larkwell Consulting's head of marketing (SAP consulting and cloud). Every afternoon you decide what the team publishes next and why.",
          "Choose pieces that (1) an IT or SAP leader at a mid-to-large enterprise needs, (2) tie to ONE Larkwell service,",
          "(3) are backed by evidence: measured search demand, a timely SAP development, or a service gap, and (4) don't repeat recent themes.",
          "For each pick: kind; keyword (blogs: the exact search query or keyword from the data); serviceId; postType (LinkedIn);",
          "angle = the specific point the piece makes; why = 1-2 sentences a founder would accept for 'why this, why today';",
          "evidence = the data lines you relied on; findingId when built on a news/research item;",
          "planPieceId when the pick is a piece of the week's plan (keep that piece's kind, keyword, service and angle).",
          "research = up to 4 questions the Researcher should dig into next (gaps you noticed), each with why.",
          "recommendations = up to 4 concrete website or SEO changes the data supports (title, detail, why, effort).",
          "",
          playbookBlock(activeRules({ limit: 12 })),
          "",
          "Return ONLY JSON.",
        ].join("\n"),
      },
      { role: "user", content: lines.join("\n").slice(0, 16000) },
    ],
    PLAN_FORMAT,
    { numPredict: 1600, tier: "quality" }
  );

  const picks = (out.picks || [])
    .map((p) => {
      const kind = p.kind === "blog" ? "blog" : "linkedin";
      const keyword = clean(p.keyword || "");
      return {
        kind,
        keyword: kind === "blog" ? keyword || clean(p.angle).slice(0, 70) : keyword,
        serviceId: serviceIds.has(p.serviceId) ? p.serviceId : "",
        postType: kind === "blog" ? undefined : SESSION_POST_TYPES.includes(p.postType) ? p.postType : "how-to",
        angle: clean(p.angle),
        why: clean(p.why),
        evidence: (Array.isArray(p.evidence) ? p.evidence : []).map(clean).filter(Boolean).slice(0, 5),
        findingId: p.findingId && sig.findings.some((f) => f.id === p.findingId) ? p.findingId : null,
        planPieceId: null,
      };
    })
    .map((p, i) => {
      // A pick that names a piece of the week's plan is that piece: its kind,
      // keyword, service and angle come from the plan, not from the model's
      // retelling of it. A piece can be picked once.
      const piece = planPieces.get((out.picks || [])[i]?.planPieceId);
      if (!piece) return p;
      planPieces.delete(piece.id);
      return { ...p, kind: piece.kind, keyword: piece.keyword || p.keyword, serviceId: piece.serviceId || p.serviceId, postType: piece.kind === "blog" ? undefined : piece.postType, angle: piece.angle, why: p.why || piece.why, planPieceId: piece.id };
    })
    .filter((p) => p.angle && p.why)
    .slice(0, win.blogs + win.posts + 2);

  const research = [];
  for (const r of (out.research || []).slice(0, 4)) {
    const rec = enqueueTopic({ topic: clean(r.topic), front: ALL_FRONTS.includes(r.front) ? r.front : "messaging", rationale: `Jarvis session ${t.slice(0, 10)}: ${clean(r.why)}`, priority: 4, createdBy: "jarvis" }, t);
    if (rec) research.push({ topic: rec.topic, why: clean(r.why) });
  }
  const recommendations = [];
  for (const r of (out.recommendations || []).slice(0, 4)) {
    if (!clean(r.title)) continue;
    const rec = addRecommendation({ front: "content-seo", title: clean(r.title), detail: `${clean(r.detail)} Why: ${clean(r.why)}`, effort: r.effort, evidence: [`session:${t.slice(0, 10)}`] }, t);
    if (rec) recommendations.push({ id: rec.id, title: rec.title, why: clean(r.why) });
  }
  if (sig.archivedRecs.snapshotId) markRecsReviewed(sig.archivedRecs.snapshotId, t);

  const fromPlan = picks.filter((p) => p.planPieceId).length;
  log("plan", `picked ${picks.length} piece${picks.length === 1 ? "" : "s"}${weekPlan.length ? ` (${fromPlan} from the week's plan)` : ""}, queued ${research.length} research question${research.length === 1 ? "" : "s"}, ${recommendations.length} site recommendation${recommendations.length === 1 ? "" : "s"}`);
  for (const p of picks) log("plan", `${p.kind === "blog" ? `blog "${p.keyword}"` : `${p.postType} post`} (${p.serviceId || "any service"}): ${p.why}`);
  return { picks, research, recommendations };
}

// ---------- 4. write ----------

const MODEL_GONE = /ECONNREFUSED|ECONNRESET|fetch failed|ETIMEDOUT|socket hang up/i;

async function write(picks, ctx, win) {
  const quota = { blog: win.blogs, linkedin: win.posts };
  const made = { blog: 0, linkedin: 0 };
  const rules = activeRules();
  const rulesText = playbookBlock(rules);
  for (const pick of picks) {
    if (made[pick.kind] >= quota[pick.kind]) continue;
    const left = ctx.writeStop - Date.now();
    const need = pick.kind === "blog" ? 25 * MIN : 8 * MIN;
    if (left < need) {
      log("write", `not starting ${pick.kind === "blog" ? `the blog on "${pick.keyword}"` : "another post"}: ${Math.max(0, Math.round(left / MIN))} min left before the cut-off`);
      continue;
    }
    const label = pick.kind === "blog" ? `blog "${pick.keyword}"` : `${pick.postType} post on ${pick.serviceId || "SAP"}`;
    log("write", `writing ${label}`);
    try {
      const finding = pick.findingId ? findingById(pick.findingId) : null;
      const angle = `${pick.angle}${finding ? ` (informed by: ${finding.title})` : ""}`;
      let payload =
        pick.kind === "blog"
          ? await generateBlog({ keyword: pick.keyword, serviceId: pick.serviceId || undefined, nudge: angle, rules: rulesText })
          : await generateDraft({ type: pick.postType, serviceId: pick.serviceId || undefined, nudge: angle, rules: rulesText });
      if (!payload || (!payload.hook && !payload.title)) throw new Error("the writer returned nothing");

      const recent = recentWork(14).map((d) => ({ title: d.payload?.title, hook: d.payload?.hook, keyword: d.payload?.keyword }));
      const sourcesText = finding ? `${finding.title}\n${finding.summary}` : "";
      log("critic", `reviewing ${label}`);
      const review = await critiqueAndFix({
        kind: pick.kind,
        payload,
        rulesBlock: rulesText,
        sourcesText,
        recent,
        deadline: ctx.deadlineMs - 8 * MIN,
        log: (text) => log("critic", text),
      });
      const title = review.payload.title || review.payload.hook || label;
      // Only a draft that was written and then thrown away counts against a
      // planned piece; a model outage or a crash does not.
      if (!review.passed) {
        if (pick.planPieceId) noteAttempt(pick.planPieceId);
        discard(pick, title, review.discardReason, review.critique);
        continue;
      }
      payload = review.payload;
      const dup = await findNearDuplicate({ kind: pick.kind, payload }, listDrafts()).catch(() => null);
      if (dup) {
        if (pick.planPieceId) noteAttempt(pick.planPieceId);
        discard(pick, title, `near-duplicate of "${String(dup.draft.payload?.title || dup.draft.payload?.hook || dup.draft.id).slice(0, 70)}"`, review.critique);
        continue;
      }
      payload = {
        ...payload,
        origin: "jarvis",
        sessionDate: localNow(win).dateKey,
        why: pick.why,
        evidence: pick.evidence,
        critique: review.critique,
        serviceId: payload.serviceId || pick.serviceId || "",
        postType: pick.kind === "blog" ? undefined : pick.postType,
        findingId: finding?.id,
        planPieceId: pick.planPieceId || undefined,
        sources: finding?.url ? [finding.url] : payload.sources,
      };
      const rec = saveDraft({ kind: pick.kind, payload, nowISO: nowISO() });
      if (pick.planPieceId) markPieceUsed(pick.planPieceId, rec.id, nowISO());
      made[pick.kind]++;
      const s = getState();
      setState({ produced: [...(s.produced || []), { id: rec.id, kind: pick.kind, title: String(title).slice(0, 140), why: pick.why, score: review.critique.score, revisions: review.critique.revisions }] });
      log("write", `saved ${label} for review (critic ${review.critique.score}/10${review.critique.revisions ? `, after ${review.critique.revisions} rewrite${review.critique.revisions === 1 ? "" : "s"}` : ""})`);
    } catch (err) {
      if (MODEL_GONE.test(String(err?.message)) && !(await isBrainAvailable())) {
        log("error", `the model went away mid-session (${String(err.message).slice(0, 60)}); stopping`);
        break;
      }
      discard(pick, label, `failed: ${String(err.message).slice(0, 120)}`);
    }
  }
}

function discard(pick, title, reason, critique) {
  const s = getState();
  setState({ discarded: [...(s.discarded || []), { kind: pick.kind, title: String(title).slice(0, 140), reason: String(reason || "").slice(0, 240), score: critique?.score ?? null }] });
  log("critic", `threw away ${pick.kind === "blog" ? "blog" : "post"} "${String(title).slice(0, 70)}": ${reason}`);
}

// ---------- 5. brief ----------

function finish(ctx, { signals = null, failed = null } = {}) {
  const t = nowISO();
  const s = getState();
  const win = sessionWindow();
  const produced = s.produced || [];
  const discarded = s.discarded || [];
  const learned = s.learned || [];
  const needs = [];
  if (produced.length) needs.push(`Review today's ${produced.length} draft${produced.length === 1 ? "" : "s"} in the Library: approve, edit, or reject with a reason. Every review teaches me.`);
  if (signals && !signals.taste.length && !signals.edits.length) needs.push("Nobody reviewed my earlier drafts, so I couldn't learn anything new today.");
  if (signals && !signals.gsc) needs.push("Search Console isn't connected on the server, so I chose topics without live search data.");
  if (signals?.errors?.length) needs.push(`Data problems: ${signals.errors.join("; ").slice(0, 200)}`);
  if (failed) needs.push(`The session stopped early: ${failed}`);
  const headline = failed && !produced.length
    ? `Session stopped early: ${failed}`
    : `Wrote ${produced.length} piece${produced.length === 1 ? "" : "s"} for review${discarded.length ? `, threw away ${discarded.length} that ${discarded.length === 1 ? "wasn't" : "weren't"} good enough` : ""}${learned.length ? `, ${learned.length} playbook change${learned.length === 1 ? "" : "s"}` : ""}.`;
  const brief = {
    id: `brief-${t}`,
    date: s.date || localNow(win).dateKey,
    createdAt: t,
    by: s.by,
    headline,
    learned,
    produced,
    discarded,
    picks: (s.picks || []).map((p) => ({ kind: p.kind, keyword: p.keyword, serviceId: p.serviceId, postType: p.postType, why: p.why })),
    recommendations: s.recommendations || [],
    research: s.research || [],
    needs,
    signals: signals
      ? {
          kept: signals.taste.filter((e) => e.event === "approved" || e.event === "posted").length,
          rejected: signals.taste.filter((e) => e.event === "rejected" || e.event === "deleted").length,
          edits: signals.edits.length,
          searchConsole: !!signals.gsc,
          analytics: !!signals.ga4,
          findings: signals.findings.length,
        }
      : null,
    minutes: Math.round((Date.parse(t) - Date.parse(s.startedAt || t)) / MIN),
  };
  const briefs = load("briefs") || [];
  persist("briefs", [...briefs, brief].slice(-BRIEFS_CAP));
  setState({ running: false, phase: failed ? "stopped" : "done", finishedAt: t, lastCompletedAt: failed ? s.lastCompletedAt || null : t, completedDate: failed ? s.completedDate : brief.date });
  addActivity({ actor: "jarvis", event: "session.brief", summary: headline }, t);
  return brief;
}
