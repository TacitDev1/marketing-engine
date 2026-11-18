// Publishing schedule (Mara, 2026-09-22: "implement scheduler... keep the
// momentum going"). A content calendar: a LinkedIn post every N days and a blog
// on one weekday. For each slot Jarvis picks the best draft in the Library, and
// on the day it writes a short reminder email (subject + body) that a human
// sends / acts on. The app itself still never posts anywhere.
//
// Slots are DERIVED from the cadence rules for the next two weeks; only the ones
// a human or Jarvis has touched (draft assigned, published, skipped) are stored,
// keyed `${date}:${kind}`, so changing the cadence never loses those.
//
// Email: no mailer is configured yet. The reminder is built and stored on the
// slot, surfaced on the Schedule screen and in the activity feed. Wire a mailer
// into `deliverReminder` when there is one.

import { listDrafts } from "./drafts.js";
import { load, persist, addActivity, recentFindings, getAutopilot } from "./stores.js";
import { embedAvailable, cosine } from "./embeddings.js";
import { vectorsFor, draftText } from "./draft-dedupe.js";
import { services, products } from "../src/lib/company.js";
import { auditBlog } from "../src/lib/blog-audit.js";

const HORIZON_DAYS = 14; // slots shown / reminded ahead
const HISTORY_DAYS = 7; // past slots kept visible so a missed day is obvious
const CHECK_MS = 5 * 60000;
const KINDS = ["linkedin", "blog"];
const STATUSES = ["planned", "ready", "published", "skipped"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------- dates (all in the autopilot's timezone) ----------
const tz = () => getAutopilot()?.activeHours?.tz || "Europe/London";

// "YYYY-MM-DD" of a Date in tz.
function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function hourIn(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz(), hour: "numeric", hour12: false }).format(date)) % 24;
}
// Date arithmetic on keys, timezone-free (a key is a calendar day, not an instant).
const toUTC = (key) => Date.UTC(...key.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
const addDays = (key, n) => new Date(toUTC(key) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const weekdayOf = (key) => new Date(toUTC(key)).getUTCDay();
// A real calendar day, not just the right shape (2026-13-99 must be refused).
export const isDateKey = (key) => /^\d{4}-\d{2}-\d{2}$/.test(key) && addDays(key, 0) === key;

// ---------- store ----------
function state() {
  const s = load("schedule");
  // The cadence counts from the day the schedule was first used. Persist it, or
  // "today" would move every day and every day would become a LinkedIn day.
  if (!s.settings.anchorDate) {
    s.settings.anchorDate = dateKey();
    persist("schedule", s);
  }
  return s;
}
const slotKey = (date, kind) => `${date}:${kind}`;

// A stored slot still counts unless it was Jarvis' own auto-pick on a day the
// cadence no longer includes (e.g. a Saturday after "work week only" went on):
// that one dissolves and frees its draft. Anything a human touched stays.
function isLive(stored, settings) {
  if (stored.pickedBy !== "jarvis" || stored.status !== "ready") return true;
  return ruleKinds(stored.date, settings).includes(stored.kind);
}

export function getSettings() {
  return state().settings;
}

export function updateSettings(patch = {}) {
  const s = state();
  const next = { ...s.settings };
  if (patch.linkedinEveryDays != null) next.linkedinEveryDays = Math.max(0, Math.min(14, Math.round(Number(patch.linkedinEveryDays) || 0)));
  if (patch.blogWeekday != null) next.blogWeekday = Number(patch.blogWeekday) >= 0 && Number(patch.blogWeekday) <= 6 ? Math.round(Number(patch.blogWeekday)) : -1;
  if (patch.workWeekOnly != null) next.workWeekOnly = Boolean(patch.workWeekOnly);
  if (patch.reminderHour != null) next.reminderHour = Math.max(0, Math.min(23, Math.round(Number(patch.reminderHour) || 0)));
  if (patch.anchorDate && isDateKey(patch.anchorDate)) next.anchorDate = patch.anchorDate;
  s.settings = next;
  persist("schedule", s);
  return next;
}

// Working days (Mon-Fri) from the anchor up to `date`, signed. Counting in
// working days is what makes "every second day" mean Mon, Wed, Fri, Tue, Thu...
// with no weekend posts (Tobias, 2026-09-22).
const isWorkday = (key) => { const w = weekdayOf(key); return w >= 1 && w <= 5; };
function workdaysBetween(a, b) {
  const [from, to, sign] = a <= b ? [a, b, 1] : [b, a, -1];
  let n = 0;
  for (let d = from; d < to; d = addDays(d, 1)) if (isWorkday(d)) n++;
  return sign * n;
}

// Which kinds the cadence puts on a given day.
function ruleKinds(date, settings) {
  const kinds = [];
  const every = settings.linkedinEveryDays;
  if (every > 0) {
    const gap = settings.workWeekOnly ? workdaysBetween(settings.anchorDate, date) : daysBetween(settings.anchorDate, date);
    const onDay = settings.workWeekOnly ? isWorkday(date) : true;
    if (onDay && ((gap % every) + every) % every === 0) kinds.push("linkedin");
  }
  if (settings.blogWeekday >= 0 && weekdayOf(date) === settings.blogWeekday) kinds.push("blog");
  return kinds;
}

// The calendar: rule-derived slots merged with stored ones, past week to two
// weeks ahead, oldest first. Each slot carries its draft (if still in the Library).
export function listSlots({ from, to } = {}) {
  const s = state();
  const today = dateKey();
  const start = from || addDays(today, -HISTORY_DAYS);
  const end = to || addDays(today, HORIZON_DAYS);
  const drafts = new Map(listDrafts().map((d) => [d.id, d]));
  const out = new Map();
  for (let d = start; d <= end; d = addDays(d, 1)) {
    for (const kind of ruleKinds(d, s.settings)) out.set(slotKey(d, kind), { key: slotKey(d, kind), date: d, kind, status: "planned", draftId: null });
  }
  for (const [key, stored] of Object.entries(s.slots)) {
    if (stored.date < start || stored.date > end || !isLive(stored, s.settings)) continue;
    out.set(key, { ...out.get(key), ...stored, key });
  }
  return [...out.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
    .map((slot) => {
      const draft = slot.draftId ? drafts.get(slot.draftId) || null : null;
      // A deleted draft leaves the slot open again.
      const status = slot.status === "ready" && !draft ? "planned" : slot.status;
      return { ...slot, status, draft: draft ? summarise(draft) : null, today: slot.date === today, past: slot.date < today };
    });
}

function summarise(d) {
  const p = d.payload || {};
  return {
    id: d.id,
    kind: d.kind,
    status: d.status,
    title: p.title || "",
    hook: p.hook || "",
    serviceLabel: p.serviceLabel || "",
    serviceId: p.serviceId || p.service || "",
    postType: p.postType || p.type || "",
    origin: p.origin || "manual",
    warnings: p.warnings || [],
    problems: d.kind === "blog" ? auditBlog(p) : [],
    savedAt: d.savedAt,
  };
}

function saveSlot(key, patch) {
  const s = state();
  const [date, kind] = key.split(":");
  if (!isDateKey(date) || !KINDS.includes(kind)) return null;
  const prev = s.slots[key] || { date, kind, status: "planned", draftId: null };
  s.slots[key] = { ...prev, ...patch, date, kind, updatedAt: new Date().toISOString() };
  // Keep the file small: drop touched slots older than the visible history.
  const cutoff = addDays(dateKey(), -HISTORY_DAYS * 4);
  for (const [k, v] of Object.entries(s.slots)) if (v.date < cutoff) delete s.slots[k];
  persist("schedule", s);
  return listSlots({ from: date, to: date }).find((x) => x.key === key) || null;
}

// ---------- assigning drafts ----------
// Drafts that could fill a slot of this kind: not posted, not already sitting in
// another open slot, and not the draft of a slot that was published (even if its
// Library status was later flipped back to draft by mistake).
export function candidates(kind, exceptKey = null) {
  const taken = new Set(
    Object.entries(state().slots)
      // A missed slot (past, never published) frees its draft for a new day.
      .filter(([k, v]) => k !== exceptKey && v.draftId && v.status !== "skipped" && (v.status === "published" || (v.date >= dateKey() && isLive(v, state().settings))))
      .map(([, v]) => v.draftId)
  );
  return listDrafts()
    // Never line up a draft with no text (an empty blog once got scheduled).
    .filter((d) => d.kind === kind && d.status !== "posted" && d.status !== "delete" && d.status !== "archived" && !taken.has(d.id))
    .filter((d) => String(d.payload?.body || "").trim().length >= (kind === "blog" ? 200 : 1))
    .map(summarise);
}

// `passed` = drafts the person already skipped with "Let Jarvis re-pick" on
// this slot (see pickForSlot). Any human choice or emptying starts it afresh.
const CLEAR_PASSED = { passed: [], exhausted: false };

export function assignDraft(key, draftId, by = "you") {
  if (!draftId) return saveSlot(key, { draftId: null, status: "planned", pickedBy: null, reason: "", reminder: null, remindedAt: null, ...CLEAR_PASSED });
  const draft = listDrafts().find((d) => d.id === draftId);
  if (!draft) return null;
  const [, kind] = key.split(":");
  if (draft.kind !== kind) return null;
  if (!candidates(kind, key).some((c) => c.id === draftId)) return null; // already in another open slot
  return saveSlot(key, { draftId, status: "ready", pickedBy: by, reason: by === "you" ? "chosen by hand" : undefined, reminder: null, remindedAt: null, ...(by === "you" ? CLEAR_PASSED : {}) });
}

export function setSlotStatus(key, status) {
  if (!STATUSES.includes(status)) return null;
  const patch = { status };
  if (status === "published") patch.publishedAt = new Date().toISOString();
  if (status === "published" || status === "skipped") Object.assign(patch, CLEAR_PASSED);
  return saveSlot(key, patch);
}

// A draft deleted from the Library leaves its open slot(s) empty again; the next
// fill re-picks. Returns the freed keys so the caller can log it.
export function unassignDraft(draftId) {
  const s = state();
  const freed = [];
  for (const [key, slot] of Object.entries(s.slots)) {
    if (slot.draftId === draftId && slot.status === "ready") {
      saveSlot(key, { draftId: null, status: "planned", pickedBy: null, reason: "", reminder: null, remindedAt: null, ...CLEAR_PASSED });
      freed.push(key);
    }
  }
  return freed;
}

// The reverse: a draft un-posted in the Library reopens the published slot that
// held it (back to "ready"), so it shows as still to do.
export function reopenForDraft(draftId) {
  const s = state();
  for (const [key, slot] of Object.entries(s.slots)) {
    if (slot.draftId === draftId && slot.status === "published") saveSlot(key, { status: "ready", publishedAt: null, ...CLEAR_PASSED });
  }
}

// A draft marked "posted" in the Library closes the slot that holds it.
export function markPublished(draftId, nowISO) {
  const s = state();
  for (const [key, slot] of Object.entries(s.slots)) {
    if (slot.draftId === draftId && slot.status !== "published") {
      saveSlot(key, { status: "published", publishedAt: nowISO, ...CLEAR_PASSED });
      return key;
    }
  }
  return null;
}

// draftId -> { key, date, kind } for every draft lined up in an open slot from
// today on. The Library shows this next to the draft so nobody reviews or
// deletes a scheduled post blind.
export function scheduledDrafts() {
  const out = {};
  for (const slot of listSlots({ from: dateKey(), to: addDays(dateKey(), HORIZON_DAYS) })) {
    if (slot.status === "ready" && slot.draftId) out[slot.draftId] = { key: slot.key, date: slot.date, kind: slot.kind };
  }
  return out;
}

// ---------- Jarvis' pick ----------
// Best draft for a slot, scored on evidence we already have: approved beats
// unreviewed, clean beats flagged, a service or product we haven't published
// lately beats a repeat, and (when embeddings are up) closeness to this week's
// research findings beats stale topics. No model call: it runs in milliseconds
// and the reasons are auditable.
// `repick`: the person pressed "Let Jarvis re-pick". Scoring is deterministic,
// so excluding only the current draft made the button ping-pong between the two
// best drafts forever. The slot now remembers every draft passed over this way
// (`passed`), so each press offers the next-best one in the same ranking. When
// the list is used up it says so once; the press after that starts again from
// the best. Automatic fills (repick=false) never read or grow `passed`; they
// clear it, as does any human choice (assignDraft, published/skipped, emptied).
export async function pickForSlot(key, { repick = false } = {}) {
  const [date, kind] = key.split(":");
  const slotNow = state().slots[key] || {};
  const current = repick ? slotNow.draftId || null : null;
  const known = new Set(listDrafts().map((d) => d.id));
  let passed = [];
  if (repick) {
    // Missing field = []. Ids whose draft has left the Library are dropped.
    passed = [...new Set([...(Array.isArray(slotNow.passed) ? slotNow.passed : []), ...(current ? [current] : [])])].filter((id) => known.has(id));
  }
  // The press after "been through all": start over from the best one. The
  // draft in the slot stays out of the running (re-picking it would be a no-op).
  const restart = repick && !!slotNow.exhausted;
  if (restart) passed = [];
  const passedSet = new Set(restart ? (current ? [current] : []) : passed);
  const all = candidates(kind, key);
  const pool = all.filter((c) => !passedSet.has(c.id));
  // Nothing but the current draft is free: there is no list to walk.
  if (repick && current && all.length && all.every((c) => c.id === current)) {
    saveSlot(key, CLEAR_PASSED);
    return {
      slot: listSlots({ from: date, to: date }).find((x) => x.key === key),
      reason: `This is the only ${kind} draft free right now, so there's nothing else to pick. Generate or approve another first.`,
      unchanged: true,
      considered: 0,
      passedCount: 0,
    };
  }
  if (repick && !pool.length && all.length) {
    saveSlot(key, { passed, exhausted: true });
    return {
      slot: listSlots({ from: date, to: date }).find((x) => x.key === key),
      reason: `You've been through all ${all.length} ${kind} draft${all.length === 1 ? "" : "s"} that ${all.length === 1 ? "is" : "are"} free right now. Choose one by hand, or press again to start from the best one.`,
      unchanged: true,
      considered: 0,
      passedCount: passed.length,
    };
  }
  if (!pool.length) return { slot: null, reason: `No ${kind} drafts left in the Library. Generate or approve one first.`, considered: 0, passedCount: passed.length };

  // Services/products covered in the last few filled slots.
  const recent = listSlots({ from: addDays(date, -HISTORY_DAYS * 2), to: addDays(date, HORIZON_DAYS) })
    .filter((x) => x.key !== key && x.draft && x.status !== "skipped")
    .map((x) => x.draft.serviceId)
    .filter(Boolean);
  const recentSvc = new Set(recent);

  // Freshness: similarity to the latest research findings (best-effort).
  let fresh = new Map();
  try {
    const findings = recentFindings(20).map((f) => `${f.title || ""} ${f.summary || ""}`.trim()).filter(Boolean);
    if (findings.length && (await embedAvailable())) {
      const all = listDrafts();
      const texts = pool.map((c) => draftText(all.find((d) => d.id === c.id)?.payload));
      const [fv, dv] = [await vectorsFor(findings), await vectorsFor(texts)];
      pool.forEach((c, i) => fresh.set(c.id, Math.max(...fv.map((v) => cosine(dv[i], v)))));
    }
  } catch {
    fresh = new Map(); // freshness is a bonus, never a blocker
  }

  const scored = pool.map((c) => {
    const why = [];
    let score = 0;
    if (c.status === "approved") { score += 10; why.push("already approved"); }
    if (!c.warnings.length) { score += 2; why.push("no guardrail flags"); } else score -= c.warnings.length;
    if (c.serviceId && !recentSvc.has(c.serviceId)) { score += 3; why.push(`${c.serviceLabel || c.serviceId} hasn't been covered lately`); }
    const f = fresh.get(c.id);
    if (f != null && f >= 0.6) { score += Math.round(f * 5); why.push("close to this week's research"); }
    if (c.savedAt && Date.now() - Date.parse(c.savedAt) < 14 * 86400000) score += 1;
    if (c.origin === "manual") { score += 1; why.push("written by hand"); }
    return { c, score, why };
  });
  scored.sort((a, b) => b.score - a.score || (b.c.savedAt || "").localeCompare(a.c.savedAt || ""));
  // The embeddings above can take a while; if a human filled the slot meanwhile,
  // their choice stands (and their draft must not get double-booked elsewhere).
  // Only a choice made DURING this pick counts: re-picking a slot that was
  // hand-chosen before the press is exactly what the person asked for.
  const now = state().slots[key];
  if (now && now.pickedBy === "you" && now.draftId && !(slotNow.pickedBy === "you" && slotNow.draftId === now.draftId)) {
    return { slot: listSlots({ from: date, to: date }).find((x) => x.key === key), reason: "already chosen by hand", passedCount: passed.length };
  }
  // The pool is from before those awaits too: meanwhile another pick may have
  // taken the winner, or someone marked it "To delete", posted or deleted it.
  // Take the best one that is STILL a candidate.
  const stillFree = new Set(candidates(kind, key).map((c) => c.id).filter((id) => !passedSet.has(id)));
  const pick = scored.find((x) => stillFree.has(x.c.id));
  if (!pick) return { slot: null, reason: `No ${kind} drafts left in the Library. Generate or approve one first.` };
  const pickReason = pick.why.length ? pick.why.join(", ") : "the best of what's in the Library right now";
  const slot = saveSlot(key, {
    draftId: pick.c.id,
    status: "ready",
    pickedBy: "jarvis",
    reason: pickReason,
    reminder: null,
    remindedAt: null,
    // Re-pick: remember what was passed over. Automatic fill: start clean.
    ...(repick ? { passed: restart ? [] : passed, exhausted: false } : CLEAR_PASSED),
  });
  return { slot, reason: pickReason, considered: scored.length, passedCount: repick ? passed.length : 0 };
}

// ---------- reminder email ----------
// On the server the built UI is served from the API port; on a laptop Vite serves it on 5180.
const APP_URL = process.env.MKT_APP_URL || (process.env.SERVE_DIST === "1" ? `http://localhost:${process.env.PORT || 8787}` : "http://localhost:5180");

export function buildReminder(slot) {
  const d = slot.draft;
  const draft = d ? listDrafts().find((x) => x.id === d.id) : null;
  const p = draft?.payload || {};
  const what = slot.kind === "blog" ? "a blog post on larkwell.example" : "a LinkedIn post";
  const title = slot.kind === "blog" ? p.title || d?.title || "" : p.hook || d?.hook || "";
  const subject = draft ? `Today: publish ${what} - ${title.slice(0, 70)}` : `Today: ${what} is due, nothing picked yet`;
  const lines = [
    `Hi,`,
    ``,
    `It's ${WEEKDAYS[weekdayOf(slot.date)]} ${slot.date}, a ${slot.kind === "blog" ? "blog" : "LinkedIn"} day on the schedule.`,
    ``,
  ];
  if (!draft) {
    lines.push(`Nothing is lined up for this slot yet. Open the Schedule screen and let Jarvis pick, or choose a draft: ${APP_URL}`);
  } else {
    lines.push(slot.pickedBy === "jarvis" ? `Jarvis picked this one because it's ${slot.reason}.` : `You chose this one.`, ``);
    if (slot.kind === "blog") {
      lines.push(`TITLE: ${p.title || ""}`, ``, `META: ${p.metaDescription || ""}`, ``, `The full article is in the Library (${draft.status}); publish it from the Blogs screen.`);
    } else {
      lines.push(`--- copy from here ---`, p.hook || "", ``, p.body || "");
      if (p.hashtags?.length) lines.push(``, p.hashtags.map((h) => `#${String(h).replace(/^#/, "")}`).join(" "));
      lines.push(`--- to here ---`);
    }
    if (p.warnings?.length) lines.push(``, `Check before posting: ${p.warnings.join(" · ")}`);
    lines.push(``, `Once it's live, mark it posted in the Library: ${APP_URL}`);
  }
  lines.push(``, `- Marketing Engine (Jarvis)`);
  return { subject, body: lines.join("\n") };
}

export function reminderFor(key) {
  const slot = listSlots().find((x) => x.key === key) || listSlots({ from: key.slice(0, 10), to: key.slice(0, 10) }).find((x) => x.key === key);
  if (!slot) return null;
  const reminder = buildReminder(slot);
  saveSlot(key, { reminder });
  return { slot: { ...slot, reminder }, reminder };
}

// Where a mailer would go. Returns false until one is configured, so the
// reminder shows in-app and in the activity feed instead of vanishing.
async function deliverReminder(/* slot, reminder */) {
  return false;
}

// Auto-pick: every open slot from today onwards gets Jarvis' pick as soon as the
// Library has something for it, so the calendar is always filled in advance. A
// slot a human has touched (chosen by hand, skipped, published) is left alone;
// "re-pick" on the screen still works.
export async function fillUpcoming(nowISO = new Date().toISOString()) {
  const today = dateKey(new Date(nowISO));
  const open = listSlots({ from: today, to: addDays(today, HORIZON_DAYS) }).filter((x) => x.status === "planned");
  const filled = [];
  const dry = new Set(); // kinds the Library has run out of (a dry blog day must not stop LinkedIn)
  for (const slot of open) {
    if (dry.has(slot.kind)) continue;
    const picked = await pickForSlot(slot.key);
    if (!picked.slot?.draft) {
      dry.add(slot.kind);
      continue;
    }
    addActivity(
      { actor: "jarvis", event: "schedule.picked", summary: `lined up for ${slot.date} (${slot.kind}): ${(picked.slot.draft.title || picked.slot.draft.hook).slice(0, 70)} (${picked.reason})`, ref: { libraryId: picked.slot.draftId } },
      nowISO
    );
    filled.push(slot.key);
  }
  return filled;
}

// ---------- the daily check ----------
// At reminderHour (in tz) on a scheduled day: fill an empty slot with Jarvis'
// pick, build the reminder, log it. Once per slot per day.
export async function runScheduleCheck(nowISO = new Date().toISOString()) {
  const s = state();
  const today = dateKey(new Date(nowISO));
  await fillUpcoming(nowISO);
  if (hourIn(new Date(nowISO)) < s.settings.reminderHour) return [];
  const due = listSlots({ from: today, to: today }).filter((x) => x.status !== "skipped" && x.status !== "published" && !x.remindedAt);
  const done = [];
  for (let slot of due) {
    if (!slot.draft) {
      const picked = await pickForSlot(slot.key);
      slot = picked.slot || slot;
      if (slot.draft) addActivity({ actor: "jarvis", event: "schedule.picked", summary: `picked for today's ${slot.kind}: ${(slot.draft.title || slot.draft.hook).slice(0, 70)} (${picked.reason})`, ref: { libraryId: slot.draftId } }, nowISO);
    }
    const reminder = buildReminder(slot);
    const sent = await deliverReminder(slot, reminder);
    saveSlot(slot.key, { reminder, remindedAt: nowISO, reminderSent: sent });
    addActivity(
      { actor: "jarvis", event: "schedule.due", summary: `${reminder.subject}${sent ? "" : " (reminder ready on the Schedule screen; no mailer configured)"}`, ref: { libraryId: slot.draftId || undefined } },
      nowISO
    );
    done.push(slot.key);
  }
  return done;
}

let timer = null;
let running = false;
export function startScheduler() {
  if (timer) return;
  // One check at a time: the first pick after boot can embed a cold Library for
  // minutes, and a second tick over the same slots would pick and remind twice.
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduleCheck();
    } catch (err) {
      console.error("scheduler:", err.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, CHECK_MS);
  setTimeout(tick, 15000); // first check shortly after boot, once the stores are warm
}

export function scheduleOverview() {
  const slots = listSlots();
  const settings = getSettings();
  return {
    settings,
    tz: tz(),
    today: dateKey(),
    slots,
    dueToday: slots.filter((x) => x.today && x.status !== "skipped" && x.status !== "published"),
    labels: {
      weekdays: WEEKDAYS,
      services: Object.fromEntries(services.map((x) => [x.id, x.label])),
      products: Object.fromEntries(products.map((x) => [x.id, x.label])),
    },
  };
}
