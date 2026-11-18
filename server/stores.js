// Local JSON stores — the shared contract between the two Autopilot agents
// (the Claude Researcher loop and the in-app Worker). Same on-disk pattern as
// drafts.js: load -> mutate -> persist, synchronous, single-user-safe. All files
// live under data/ (gitignored). Nothing here calls the model or the network.

import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { writeJsonAtomic, readJsonSafe } from "./atomic.js";
import { jaccard } from "./similarity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

const FILES = {
  queue: "research-queue.json",
  findings: "findings.json",
  recommendations: "recommendations.json",
  directives: "directives.json",
  activity: "activity.json",
  workerState: "worker-state.json",
  autopilot: "autopilot.json",
  keywords: "researched-keywords.json",
  taste: "taste.json",
  competitors: "competitors.json",
  feedback: "feedback.json",
  librarianState: "librarian-state.json",
  schedule: "schedule.json",
  // Jarvis as marketing lead (2026-11-02): learned rules, the daily session's
  // state, and the briefings it leaves behind.
  playbook: "playbook.json",
  session: "session-state.json",
  briefs: "briefs.json",
  // The agent team (server/agent-team.js): on/off switches and the run log.
  agentTeam: "agent-team.json",
  // Automatic blog publishing (server/autopublish.js) and the weekly summary
  // (server/weekly-summary.js).
  publishing: "publishing.json",
  summaries: "summaries.json",
  // What the agents file: their reports (server/agent-reports.js) and the
  // Strategist's week plan (server/week-plan.js).
  agentReports: "agent-reports.json",
  weekPlan: "week-plan.json",
  // The Monday "week ahead" message (server/week-ahead.js).
  weekAhead: "week-ahead.json",
  // Approvals asked for and collected through Teams (server/approvals.js).
  approvals: "approvals.json",
  // Fingerprints of the wiki pages written from the app's records (server/wiki-bridge.js).
  wikiBridge: "wiki-bridge.json",
};

const DEFAULTS = {
  queue: [],
  findings: [],
  recommendations: [],
  directives: [],
  activity: [],
  keywords: [],
  taste: [],
  competitors: [],
  feedback: [],
  playbook: { rules: [], seededAt: null },
  session: { date: "", phase: "idle", running: false, startedAt: null, finishedAt: null, lastCompletedAt: null, picks: [], produced: [], discarded: [], learned: [], recommendations: [], log: [] },
  briefs: [],
  agentTeam: { enabled: {}, runs: [] },
  // days: 0 = Sunday. afterHour: local hour (session timezone) from which a
  // post may go out, late enough for the Editor to have finished.
  publishing: { enabled: true, days: [1, 3, 5], afterHour: 16, log: [] },
  summaries: [],
  agentReports: [],
  weekPlan: { plans: [] },
  weekAhead: [],
  approvals: { requests: {}, applied: [], lastCollect: null },
  wikiBridge: { pages: {} },
  librarianState: { lastRunAt: null, lastResult: null, running: false, enabled: true, runCount: 0 },
  // Publishing calendar (server/schedule.js): a LinkedIn post every N days from
  // anchorDate, a blog on blogWeekday (0=Sun..6=Sat, -1=off), reminder at reminderHour.
  schedule: {
    settings: { linkedinEveryDays: 2, workWeekOnly: true, blogWeekday: 5, reminderHour: 8, anchorDate: "" },
    slots: {},
  },
  workerState: {
    lastRunAt: null,
    lastResult: null,
    seenDraftKeys: [],
    draftsToday: { date: "", count: 0 },
    running: false,
    seedsPlanted: false,
  },
  autopilot: {
    workerEnabled: process.env.AUTOPILOT_ENABLED === "true",
    cadenceMs: Number(process.env.AUTOPILOT_CADENCE_MS) || 600000,
    dailyDraftCap: Number(process.env.AUTOPILOT_DAILY_DRAFT_CAP) || 4,
    // Active hours: outside this window the Worker stays idle even when ON, so a
    // paid GPU instance never ticks overnight. Off by default on a laptop; the
    // server .env turns it on. Hours are in `tz`; `end` is exclusive (19 = until 19:00).
    activeHours: {
      enabled: process.env.AUTOPILOT_ACTIVE_HOURS === "true",
      start: Number(process.env.AUTOPILOT_ACTIVE_START) || 7,
      end: Number(process.env.AUTOPILOT_ACTIVE_END) || 19,
      days: [1, 2, 3, 4, 5],
      tz: process.env.AUTOPILOT_TZ || "Europe/London",
    },
    researcherLastSeenAt: null,
    updatedAt: null,
  },
};

const ACTIVITY_CAP = 1000; // the stats screen draws a 7-day trend from this — 500 held <1 day
const QUEUE_CAP = 50;
const QUEUE_PRUNE_AGE_MS = 14 * 86400000; // stale/done queue records older than this are deleted
const FINDINGS_CAP = 1000; // news findings accrue ~3/tick forever; keep the most recent
const RECOMMENDATIONS_CAP = 500;
const RECS_OPEN_CAP = 100; // open recs beyond this auto-expire oldest-first (222 piled up unactioned)

function fileFor(key) {
  return path.join(DATA_DIR, FILES[key]);
}

export function load(key) {
  // Deep-ish clone of the default so callers can't mutate the shared default.
  const raw = readJsonSafe(fileFor(key), () => JSON.parse(JSON.stringify(DEFAULTS[key])), { backup: true });
  // Object stores written before a field existed lack it forever — a restored
  // .bak or a new state field then crashes consumers (`draftsToday.date` on
  // undefined) or silently disables logic (`count < undefined`). Merge over the
  // defaults so every expected field always exists.
  const def = DEFAULTS[key];
  if (def && typeof def === "object" && !Array.isArray(def) && raw && typeof raw === "object" && !Array.isArray(raw)) {
    const merged = { ...JSON.parse(JSON.stringify(def)), ...raw };
    // One level deeper too, so a new field inside e.g. schedule.settings or
    // autopilot.activeHours gets its default instead of `undefined`.
    for (const k of Object.keys(def)) {
      if (def[k] && typeof def[k] === "object" && !Array.isArray(def[k]) && raw[k] && typeof raw[k] === "object" && !Array.isArray(raw[k])) {
        merged[k] = { ...JSON.parse(JSON.stringify(def[k])), ...raw[k] };
      }
    }
    return merged;
  }
  return raw;
}

export function persist(key, value) {
  // backup:true keeps a .bak of the last good file — without it a single
  // unreadable file resets the store to its default and the next write makes
  // that permanent (drafts.json had this safety net; the rest did not).
  writeJsonAtomic(fileFor(key), value, { backup: true });
  return value;
}

// Monotonic-ish id without Math.random (counter + supplied timestamp).
let _seq = 0;
export function newId(prefix, nowISO) {
  const t = Date.parse(nowISO) || 0;
  return `${prefix}-${t}-${_seq++}`;
}

export function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);
}

// ---------- activity log (append-only, capped) ----------

export function addActivity({ actor, event, summary, ref = null }, nowISO) {
  const log = load("activity");
  log.push({ id: newId("a", nowISO), ts: nowISO, actor, event, summary, ref });
  // keep only the most recent ACTIVITY_CAP
  persist("activity", log.slice(-ACTIVITY_CAP));
}

export function recentActivity(limit = 50) {
  return load("activity").slice(-limit).reverse();
}

// ---------- research queue ----------

const normTopic = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Enqueue a topic unless an open (queued/claimed) one already matches. Returns
// the record, or null if it was a duplicate.
export function enqueueTopic({ topic, front = "messaging", rationale = "", priority = 3, createdBy = "worker" }, nowISO) {
  const q = load("queue");
  const key = normTopic(topic);
  if (!key) return null;
  const dup = q.find((t) => ["queued", "claimed"].includes(t.status) && normTopic(t.topic) === key);
  if (dup) return null;
  const pr = Math.round(Number(priority));
  const rec = {
    id: newId("rq", nowISO),
    topic: String(topic).trim().slice(0, 500),
    front: String(front || "messaging").slice(0, 40),
    rationale: String(rationale || "").slice(0, 2000),
    priority: Number.isFinite(pr) ? Math.min(5, Math.max(1, pr)) : 3, // NaN would scramble the queue sort
    status: "queued",
    claimToken: null,
    claimedAt: null,
    createdBy,
    createdAt: nowISO,
    doneAt: null,
    findingIds: [],
  };
  q.push(rec);
  // Cap the queue: oldest queued beyond QUEUE_CAP go stale.
  const queued = q.filter((t) => t.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (queued.length > QUEUE_CAP) {
    for (const old of queued.slice(0, queued.length - QUEUE_CAP)) old.status = "stale";
  }
  // Delete stale/done records after two weeks — they were kept forever and the
  // file (rewritten in full on every write) grew without bound.
  const cutoff = Date.parse(nowISO) - QUEUE_PRUNE_AGE_MS;
  const pruned = q.filter(
    (t) => !(["stale", "done"].includes(t.status) && Date.parse(t.doneAt || t.createdAt) < cutoff)
  );
  persist("queue", pruned);
  return rec;
}

// Highest priority, then oldest. Optional status filter.
export function listQueue({ status, limit } = {}) {
  let q = load("queue");
  if (status) q = q.filter((t) => t.status === status);
  q = q.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  return limit ? q.slice(0, limit) : q;
}

// Claim up to `count` queued topics; stamp a shared claim token.
// Research topics go stale: they're generated from that week's news/context,
// and priority-then-oldest claiming meant the Researcher burned iterations on
// 9-day-old ideas while fresh ones sat behind the queue cap. Expire on claim.
const TOPIC_TTL_MS = 7 * 86400000;

const CLAIM_TTL_MS = 2 * 3600000; // a research iteration takes minutes; hours = it died

export function claimTopics(count, nowISO) {
  const q = load("queue");
  const now = Date.parse(nowISO);
  // Release zombie claims first (an iteration that crashed mid-research never
  // calls topic-done, so its topic showed "researching" forever — one sat
  // claimed since July). Released topics then face the normal age sweep below.
  for (const t of q) {
    if (t.status === "claimed" && now - Date.parse(t.claimedAt || t.createdAt) > CLAIM_TTL_MS) {
      t.status = "queued";
      delete t.claimToken;
    }
  }
  for (const t of q) {
    if (t.status === "queued" && now - Date.parse(t.createdAt) > TOPIC_TTL_MS) t.status = "expired";
  }
  const token = sha1(`${nowISO}:${_seq++}`);
  const picked = q
    .filter((t) => t.status === "queued")
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(1, count));
  for (const t of picked) {
    t.status = "claimed";
    t.claimToken = token;
    t.claimedAt = nowISO;
  }
  persist("queue", q);
  return { token, topics: picked };
}

export function markTopicDone(topicId, claimToken, nowISO) {
  const q = load("queue");
  const t = q.find((x) => x.id === topicId);
  if (!t) return null;
  if (claimToken && t.claimToken && claimToken !== t.claimToken) return null;
  t.status = "done";
  t.doneAt = nowISO;
  persist("queue", q);
  return t;
}

// ---------- findings ----------

// Add a finding, deduped by hash. Returns { record, duplicate }.
export function addFinding(f, nowISO) {
  const list = load("findings");
  const hash = f.hash || sha1(`${f.url || ""}|${f.title || ""}|${f.summary || ""}`);
  const existing = list.find((x) => x.hash === hash);
  if (existing) return { record: existing, duplicate: true };
  const rec = {
    id: newId("f", nowISO),
    topicId: f.topicId || null,
    front: f.front || "messaging",
    // Clamped: findings arrive over HTTP and flow verbatim into three 8k-context
    // prompts — one pasted 40KB article would silently truncate every classify
    // call for it (the directive-overflow failure mode, reopened from outside).
    title: String(f.title || "").trim().slice(0, 300),
    summary: String(f.summary || "").trim().slice(0, 4000),
    url: f.url || "",
    sources: (Array.isArray(f.sources) ? f.sources : f.sources ? [f.sources] : []).slice(0, 10),
    kind: f.kind || "web",
    data: f.data || null,
    hash,
    processed: false,
    processedAt: null,
    attempts: 0,
    ingestedToWiki: [],
    actions: [],
    createdAt: nowISO,
  };
  list.push(rec);
  persist("findings", list.length > FINDINGS_CAP ? list.slice(-FINDINGS_CAP) : list);
  return { record: rec, duplicate: false };
}

export function updateFinding(id, patch) {
  const list = load("findings");
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  persist("findings", list);
  return list[idx];
}

export function unprocessedFindings(limit) {
  const list = load("findings").filter((f) => !f.processed && f.attempts < 3);
  return limit ? list.slice(0, limit) : list;
}

export function recentFindings(limit = 20) {
  return load("findings").slice(-limit).reverse();
}

// ---------- recommendations ----------

// Word signature for rec dedupe (same approach as the worker's variety guard).
const REC_SIG_STOP = new Set(["with", "that", "this", "from", "your", "into", "have", "more", "page", "pages", "site"]);
function recSig(text) {
  const words = String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !REC_SIG_STOP.has(w));
  return new Set(words.slice(0, 16));
}
const REC_DUP_THRESHOLD = 0.55;

export function addRecommendation(r, nowISO) {
  const list = load("recommendations");
  // Near-duplicate of an OPEN rec? Don't file a new one — bump the existing
  // rec's `seen` counter and merge evidence. The Worker files the same advice
  // repeatedly ("add a BTP page") from different findings; the counter turns
  // that repetition into a priority signal instead of pile noise.
  const sig = recSig(`${r.title} ${r.detail}`);
  const dup = list.find((x) => x.status === "open" && jaccard(sig, recSig(`${x.title} ${x.detail}`)) >= REC_DUP_THRESHOLD);
  if (dup) {
    dup.seen = (dup.seen || 1) + 1;
    dup.lastSeenAt = nowISO;
    dup.evidence = [...new Set([...(dup.evidence || []), ...(r.evidence || [])])];
    persist("recommendations", list);
    return dup;
  }
  const rec = {
    id: newId("rec", nowISO),
    front: r.front || "messaging",
    title: String(r.title || "").trim(),
    detail: String(r.detail || "").trim(),
    evidence: r.evidence || [],
    effort: ["small", "medium", "large"].includes(r.effort) ? r.effort : "medium",
    status: "open",
    seen: 1, // bumped when the same advice arrives again — a natural priority signal
    createdAt: nowISO,
  };
  list.push(rec);
  // Keep the open pile reviewable: beyond RECS_OPEN_CAP the oldest open recs
  // expire (status flip, reversible) instead of accumulating forever.
  const open = list.filter((r) => r.status === "open");
  if (open.length > RECS_OPEN_CAP) {
    for (const old of open.slice(0, open.length - RECS_OPEN_CAP)) old.status = "expired";
  }
  persist("recommendations", list.length > RECOMMENDATIONS_CAP ? list.slice(-RECOMMENDATIONS_CAP) : list);
  return rec;
}

export function listRecommendations({ status } = {}) {
  let list = load("recommendations");
  if (status) list = list.filter((r) => r.status === status);
  // Most-repeated advice first (the Worker keeps arriving at it), then newest.
  return list.slice().sort((a, b) => (b.seen || 1) - (a.seen || 1) || (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function updateRecommendation(id, patch) {
  const list = load("recommendations");
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  if (patch.status && ["open", "done", "dismissed", "expired"].includes(patch.status)) list[idx].status = patch.status;
  persist("recommendations", list);
  return list[idx];
}

// ---------- directives (Researcher -> Worker: what to build / avoid) ----------

// Directives are transient steering, not permanent policy: they age out after
// DIRECTIVE_MAX_AGE_DAYS and only the newest DIRECTIVE_OPEN_CAP per kind stay
// open. Without this the pile grows forever and (via directiveLines) overflows
// the model's context window — which silently killed every sift/topic call
// between 2026-07-10 and 2026-07-11.
const DIRECTIVE_OPEN_CAP = { build: 30, avoid: 20 };
const DIRECTIVE_MAX_AGE_DAYS = 14;
const DIRECTIVES_CAP = 500; // total records kept on disk (open + closed)

function expireDirectives(list, nowISO) {
  const cutoff = Date.parse(nowISO) - DIRECTIVE_MAX_AGE_DAYS * 86400000;
  for (const d of list) {
    if (d.status === "open" && Date.parse(d.createdAt) < cutoff) d.status = "expired";
  }
  for (const kind of ["build", "avoid"]) {
    const open = list.filter((d) => d.status === "open" && d.kind === kind);
    // oldest first; everything beyond the cap (counting from the newest) expires
    for (const old of open.slice(0, Math.max(0, open.length - DIRECTIVE_OPEN_CAP[kind]))) {
      old.status = "expired";
    }
  }
  return list.length > DIRECTIVES_CAP ? list.slice(-DIRECTIVES_CAP) : list;
}

export function addDirective({ kind, text, front = "", evidence = [] }, nowISO) {
  let list = load("directives");
  const k = kind === "avoid" ? "avoid" : "build";
  const t = String(text || "").trim();
  if (!t) return null;
  // de-dupe identical open directives
  if (list.some((d) => d.status === "open" && d.kind === k && d.text.toLowerCase() === t.toLowerCase())) return null;
  const rec = { id: newId("dir", nowISO), kind: k, text: t, front, evidence, status: "open", createdAt: nowISO };
  list.push(rec);
  list = expireDirectives(list, nowISO);
  persist("directives", list);
  return rec;
}

export function listDirectives({ status = "open" } = {}) {
  const list = load("directives");
  return (status ? list.filter((d) => d.status === status) : list).slice().reverse();
}

export function updateDirective(id, patch) {
  const list = load("directives");
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  if (patch.status && ["open", "done", "dismissed", "expired"].includes(patch.status)) list[idx].status = patch.status;
  persist("directives", list);
  return list[idx];
}

// ---------- researched SEO keywords (the keyword knowledge base) ----------
// The deep researcher (Claude + SEMrush) files keywords here; they accumulate and
// merge into the SEO screen's opportunity table alongside the static research file.

const KEYWORDS_CAP = 2000;
const numOrNull = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v == null ? "" : String(v).trim());

export function listResearchedKeywords() {
  return load("keywords");
}

// Bulk upsert keyword rows (deduped by lowercased keyword). `meta` supplies defaults
// for rows that don't carry their own front/serviceId/source. Returns {added, updated, total}.
export function addResearchedKeywords(rows, meta = {}, nowISO) {
  if (!Array.isArray(rows) || !rows.length) return { added: 0, updated: 0, total: load("keywords").length };
  const list = load("keywords");
  const byKw = new Map(list.map((k) => [k.keyword.toLowerCase(), k]));
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    const keyword = str(r.keyword);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    const norm = {
      keyword,
      volume: numOrNull(r.volume),
      intent: str(r.intent),
      difficulty: numOrNull(r.difficulty ?? r.kd),
      cpc: numOrNull(r.cpc),
      trend: str(r.trend),
      front: str(r.front || meta.front),
      serviceId: str(r.serviceId || meta.serviceId),
      source: str(r.source || meta.source || "unverified"),
      database: str(r.database || meta.database),
      note: str(r.note || meta.note),
    };
    const existing = byKw.get(key);
    if (existing) {
      // Refresh fields but keep identity; don't clobber a value with an empty one.
      // A SEMrush-measured volume/difficulty is never downgraded by a later guess.
      const keepMeasured = existing.source === "semrush" && norm.source !== "semrush";
      for (const [k, v] of Object.entries(norm)) {
        if (keepMeasured && (k === "volume" || k === "difficulty" || k === "source" || k === "cpc")) continue;
        if (v !== "" && v != null) existing[k] = v;
      }
      existing.updatedAt = nowISO;
      updated++;
    } else {
      const rec = { id: newId("kw", nowISO), ...norm, createdAt: nowISO, updatedAt: nowISO };
      list.push(rec);
      byKw.set(key, rec);
      added++;
    }
  }
  let out = list;
  if (out.length > KEYWORDS_CAP) out = out.sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, KEYWORDS_CAP);
  persist("keywords", out);
  return { added, updated, total: out.length };
}

// ---------- worker state & autopilot config ----------

export function getWorkerState() {
  return load("workerState");
}
export function setWorkerState(patch) {
  return persist("workerState", { ...load("workerState"), ...patch });
}

export function getAutopilot() {
  return load("autopilot");
}
export function setAutopilot(patch, nowISO) {
  return persist("autopilot", { ...load("autopilot"), ...patch, updatedAt: nowISO });
}

export function getLibrarianState() {
  return load("librarianState");
}
export function setLibrarianState(patch) {
  return persist("librarianState", { ...load("librarianState"), ...patch });
}

// ---------- taste (what Tobias keeps vs kills — the Worker's feedback loop) ----------

const TASTE_CAP = 600;

// event: "approved" | "posted" | "deleted" (keep/kill), plus the session-era
// signals "rejected" (marked delete/archived, optionally WITH the reviewer's
// reason), "repicked" and "skipped" (schedule). `reason` and `text` (a short
// snippet of the draft) are what the playbook learns from.
// "picture": the picture a person chose for a LinkedIn post when approving it;
// "redraw": what they asked to change about the pictures. Both carry `detail`.
const TASTE_EVENTS = ["approved", "posted", "deleted", "rejected", "repicked", "skipped", "picture", "redraw"];
export function addTasteEvent({ event, kind, postType = "", serviceId = "", origin = "", reason = "", text = "", draftId = "", detail = null }, nowISO) {
  if (!TASTE_EVENTS.includes(event)) return null;
  const list = load("taste");
  const rec = { event, kind, postType, serviceId, origin, at: nowISO };
  const r = String(reason || "").trim().slice(0, 500);
  if (r) rec.reason = r;
  const t = String(text || "").trim().slice(0, 240);
  if (t) rec.text = t;
  if (draftId) rec.draftId = String(draftId);
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = Object.fromEntries(Object.entries(detail).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 60) : v]));
    if (Object.keys(d).length) rec.detail = d;
  }
  list.push(rec);
  persist("taste", list.length > TASTE_CAP ? list.slice(-TASTE_CAP) : list);
  return true;
}

// Taste events after `sinceISO` (the session's Observe phase reads these).
export function tasteSince(sinceISO) {
  const since = sinceISO ? Date.parse(sinceISO) : 0;
  return load("taste").filter((e) => Date.parse(e.at) > since);
}

// Compact keep/kill counts per postType and per serviceId. keep = approved/posted,
// kill = deleted. Only keys with enough events to mean something (min 3).
export function tasteSummary(minEvents = 3) {
  const list = load("taste");
  const tally = (field) => {
    const m = {};
    for (const e of list) {
      const k = e[field];
      if (!k) continue;
      if (!["approved", "posted", "deleted", "rejected"].includes(e.event)) continue;
      m[k] = m[k] || { keep: 0, kill: 0 };
      if (e.event === "deleted" || e.event === "rejected") m[k].kill++;
      else m[k].keep++;
    }
    return Object.entries(m)
      .filter(([, v]) => v.keep + v.kill >= minEvents)
      .map(([key, v]) => ({ key, ...v }));
  };
  return { postTypes: tally("postType"), services: tally("serviceId"), total: list.length };
}

// ---------- competitors (structured profiles the Researcher maintains) ----------

const COMPETITORS_CAP = 25;

function normDomain(d) {
  return String(d || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
}

// The same firm often shows up under a second domain (.com vs .eu, a rebrand,
// a country site) — matching on domain alone created twin cards. Match on the
// normalised NAME too, ignoring legal-suffix noise.
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(group|consulting|consultants|solutions|inc|llc|ltd|gmbh|bv|the|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Upsert by domain OR name: profiles update in place so they stay current
// instead of piling up. All content must come from the Researcher's real
// sources — this store never invents anything, it just persists.
export function upsertCompetitor(p, nowISO) {
  const domain = normDomain(p.domain);
  if (!domain || !String(p.name || "").trim()) return { error: "name and domain required" };
  const list = load("competitors");
  const nn = normName(p.name);
  const existing = list.find(
    (c) => c.domain === domain || (c.altDomains || []).includes(domain) || (nn && normName(c.name) === nn)
  );
  // Same firm, different domain (e.g. .com vs .eu): keep the original domain as
  // the card's identity and remember the other one so future filings match too.
  if (existing && existing.domain !== domain) {
    existing.altDomains = [...new Set([...(existing.altDomains || []), domain])];
  }
  const fields = {
    name: String(p.name).trim(),
    domain,
    positioning: String(p.positioning || "").trim(),
    serviceOverlap: Array.isArray(p.serviceOverlap) ? p.serviceOverlap.slice(0, 20) : [],
    contentThemes: Array.isArray(p.contentThemes) ? p.contentThemes.slice(0, 12) : [],
    keywordOverlap: Array.isArray(p.keywordOverlap) ? p.keywordOverlap.slice(0, 25) : [],
    gaps: Array.isArray(p.gaps) ? p.gaps.slice(0, 12) : [], // where Larkwell can win
    strengths: Array.isArray(p.strengths) ? p.strengths.slice(0, 12) : [],
    sources: Array.isArray(p.sources) ? p.sources.slice(0, 15) : [],
    note: String(p.note || "").trim(),
  };
  if (existing) {
    // Merge: new non-empty fields win; array fields union (capped). The card's
    // primary domain is its IDENTITY and never changes — a different domain in
    // a refresh was already recorded in altDomains above.
    for (const [k, v] of Object.entries(fields)) {
      if (k === "domain") continue;
      if (Array.isArray(v)) existing[k] = [...new Set([...v, ...(existing[k] || [])])].slice(0, 25);
      else if (v) existing[k] = v;
    }
    existing.updatedAt = nowISO;
    existing.timesResearched = (existing.timesResearched || 1) + 1;
    persist("competitors", list);
    return { record: existing, updated: true };
  }
  const rec = { id: newId("comp", nowISO), ...fields, createdAt: nowISO, updatedAt: nowISO, timesResearched: 1 };
  list.push(rec);
  persist("competitors", list.length > COMPETITORS_CAP ? list.slice(-COMPETITORS_CAP) : list);
  return { record: rec, updated: false };
}

export function listCompetitors() {
  return load("competitors")
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

// ---------- exec feedback (requests from the C-level, reviewed by Tobias) ----------

const FEEDBACK_CAP = 300;

export function addFeedback({ text, author = "" }, nowISO) {
  const t = String(text || "").trim();
  if (!t) return null;
  const rec = {
    id: newId("fb", nowISO),
    text: t.slice(0, 2000),
    author: String(author || "").trim().slice(0, 80),
    status: "open", // open -> done | dismissed
    createdAt: nowISO,
  };
  const list = load("feedback");
  list.push(rec);
  // Over the cap, drop the oldest CLOSED notes first; an open request is never
  // silently evicted.
  let kept = list;
  if (kept.length > FEEDBACK_CAP) {
    let excess = kept.length - FEEDBACK_CAP;
    kept = kept.filter((f) => {
      if (excess > 0 && f.status !== "open") {
        excess--;
        return false;
      }
      return true;
    });
  }
  persist("feedback", kept);
  return rec;
}

export function listFeedback({ status } = {}) {
  let list = load("feedback");
  if (status) list = list.filter((f) => f.status === status);
  return list.slice().reverse();
}

// A reply on a feedback note, so a question like "is this expected or can we
// clean it up?" gets its answer next to the question instead of in a chat.
const REPLY_CAP = 50;
export function addFeedbackReply(id, { text, author = "" }, nowISO) {
  const t = String(text || "").trim();
  if (!t) return null;
  const list = load("feedback");
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  const reply = {
    id: newId("fbr", nowISO),
    text: t.slice(0, 4000),
    author: String(author || "").trim().slice(0, 80),
    createdAt: nowISO,
  };
  list[idx].replies = [...(list[idx].replies || []), reply].slice(-REPLY_CAP);
  persist("feedback", list);
  return list[idx];
}

export function updateFeedback(id, patch) {
  const list = load("feedback");
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  if (patch.status && ["open", "done", "dismissed"].includes(patch.status)) list[idx].status = patch.status;
  persist("feedback", list);
  return list[idx];
}
