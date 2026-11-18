// Scheduled blog publishing (Tobias, 2026-11-12; approval rule 2026-11-16):
// blogs go live on larkwell.example on a schedule. LinkedIn posts and ads are
// never published from here.
//
// A blog is published only when BOTH hold: the Editor CLEARED it
// (server/editor.js) and a person then APPROVED it in the Library. Nothing
// goes public that a person has not read. The Editor cannot touch an approved
// draft, so an approval is always of the text that will go out.
//
// On a publishing day, once the Editor has had time to work, the best
// approved blog is written to the website repo as a visible post and pushed
// with the same Go Live path a person uses. One post a
// day at most. Every publish, and every failure, is logged for the weekly
// summary.
//
// It only ever runs on the server (MKT_DEPLOYMENT=server): a laptop's website
// clone must never push test content to the live site.

import { listDrafts, updateDraft } from "./drafts.js";
import { exportBlogDraft, goLive, siteAvailable } from "./website.js";
import { markPublished } from "./schedule.js";
import { sessionWindow, localNow } from "./session.js";
import { syncWiki } from "./wiki-bridge.js";
import { load, persist, addActivity } from "./stores.js";
import { company } from "../src/lib/company.js";
import { auditBlog, isCritical } from "../src/lib/blog-audit.js";

const LOG_KEPT = 120;
const MAX_ATTEMPTS = 3; // per day, when the push fails
const CHECK_EVERY_MS = 2 * 60 * 1000;

const isServer = () => process.env.MKT_DEPLOYMENT === "server";

function state() {
  const s = load("publishing") || {};
  return {
    enabled: s.enabled !== false,
    days: Array.isArray(s.days) ? s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [1, 3, 5],
    afterHour: Number.isFinite(s.afterHour) ? s.afterHour : 16,
    log: Array.isArray(s.log) ? s.log : [],
  };
}

const byScoreThenNewest = (a, b) => (b.payload.editor.score || 0) - (a.payload.editor.score || 0) || String(b.savedAt).localeCompare(String(a.savedAt));
// The Editor's part of the gate. Normally it must have cleared the blog (8/10
// or more, no failed check). The exception is a blog a person sent back with a
// note: the reworked text passed the code checks and went back to them, so
// their approval of it stands even where the Editor marked it lower.
const editorOk = (d) => {
  const e = d.payload?.editor;
  if (!e || e.verdict !== "pass") return false;
  return !!e.cleared || (!!d.payload.revision && !(e.issues || []).length);
};
const clearedBlogs = (status) =>
  listDrafts()
    .filter((d) => d.kind === "blog" && d.status === status && editorOk(d) && !isCritical(auditBlog(d.payload)))
    .sort(byScoreThenNewest);

// Blogs that will go out: cleared by the Editor and approved by a person,
// best first.
export function publishCandidates() {
  return clearedBlogs("approved");
}

// Blogs the Editor cleared that no person has approved yet. They wait here
// until someone approves them in the Library.
export function awaitingApproval() {
  return clearedBlogs("draft");
}

export function publishingStatus() {
  const s = state();
  const next = publishCandidates();
  return {
    enabled: s.enabled,
    days: s.days,
    afterHour: s.afterHour,
    // False on a laptop: the switch is shown, but nothing is ever pushed.
    canPublish: isServer() && siteAvailable(),
    waiting: next.length,
    awaitingApproval: awaitingApproval().map((d) => ({ id: d.id, title: d.payload.title || "", score: d.payload.editor.score })),
    next: next[0] ? { id: next[0].id, title: next[0].payload.title || "", score: next[0].payload.editor.score } : null,
    recent: s.log.slice(0, 12),
  };
}

export function updatePublishing(patch, nowISO) {
  const s = state();
  if (typeof patch?.enabled === "boolean") s.enabled = patch.enabled;
  if (Array.isArray(patch?.days)) s.days = [...new Set(patch.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (Number.isInteger(patch?.afterHour) && patch.afterHour >= 0 && patch.afterHour <= 23) s.afterHour = patch.afterHour;
  persist("publishing", s);
  addActivity({ actor: "you", event: "publishing.settings", summary: `automatic blog publishing ${s.enabled ? "on" : "off"}; days ${s.days.join(",") || "none"}; from ${s.afterHour}:00` }, nowISO);
  return publishingStatus();
}

const DEPS = { exportBlogDraft, goLive, siteAvailable, isServer };

// Publish today's post if one is due. Returns { published } or { skipped: why }.
// `deps` exists for the test, which must not touch a real website repo.
export async function runAutoPublish(nowISO, { deps = DEPS, date = new Date(nowISO) } = {}) {
  if (!deps.isServer()) return { skipped: "not_the_server" };
  const s = state();
  if (!s.enabled) return { skipped: "switched_off" };
  if (!deps.siteAvailable()) return { skipped: "site_not_found" };
  const t = localNow(sessionWindow(), date);
  if (!s.days.includes(t.weekday)) return { skipped: "not_a_publishing_day" };
  if (t.minutes < s.afterHour * 60) return { skipped: "too_early" };
  const today = s.log.filter((e) => e.dateKey === t.dateKey);
  if (today.some((e) => e.status === "published")) return { skipped: "already_published_today" };
  if (today.filter((e) => e.status === "failed").length >= MAX_ATTEMPTS) return { skipped: "gave_up_today" };
  const draft = publishCandidates()[0];
  if (!draft) return { skipped: "nothing_approved" };

  const title = String(draft.payload.title || "").slice(0, 140);
  const record = (entry) => {
    const cur = state();
    cur.log = [{ dateKey: t.dateKey, at: nowISO, draftId: draft.id, title, ...entry }, ...cur.log].slice(0, LOG_KEPT);
    persist("publishing", cur);
  };
  const fail = (error, message = "") => {
    record({ status: "failed", error, message: String(message).slice(0, 300) });
    addActivity({ actor: "system", event: "publishing.failed", summary: `could not publish "${title}": ${error}${message ? ` (${String(message).slice(0, 120)})` : ""}`, ref: { libraryId: draft.id } }, nowISO);
    return { skipped: "failed", error };
  };

  const written = deps.exportBlogDraft(draft, { publish: true, overwriteRel: draft.payload.exportedRel || null });
  if (!written.ok) return fail(written.error, written.message);
  // Remember the file straight away: if the push fails, the retry overwrites
  // this file instead of creating a second article.
  updateDraft(draft.id, { payload: { ...draft.payload, exportedRel: written.rel } }, nowISO);

  let live;
  try {
    live = await deps.goLive({ rels: [written.rel] });
  } catch (err) {
    return fail("push_failed", err.message);
  }
  if (!live.ok) return fail(live.error, live.message);

  const url = `${company.site}/news/${written.slug}`;
  const fresh = listDrafts().find((d) => d.id === draft.id) || draft;
  updateDraft(draft.id, { status: "posted", payload: { ...fresh.payload, exportedRel: written.rel, autoPublishedAt: nowISO, publishedUrl: url } }, nowISO);
  markPublished(draft.id, nowISO);
  record({ status: "published", rel: written.rel, url, score: draft.payload.editor.score });
  addActivity({ actor: "system", event: "publishing.published", summary: `published "${title}" to larkwell.example on schedule (approved by a person, Editor ${draft.payload.editor.score}/10)`, ref: { libraryId: draft.id } }, nowISO);
  // The wiki's record of what Larkwell has published.
  syncWiki(nowISO);
  return { published: { draftId: draft.id, title, url, rel: written.rel } };
}

let timer = null;
let running = false;
export function startAutoPublisher() {
  if (timer || !isServer()) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAutoPublish(new Date().toISOString());
    } catch (err) {
      console.error("autopublish:", err.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  console.log("Automatic blog publishing: armed (publishes Editor-cleared blogs on its days).");
}
