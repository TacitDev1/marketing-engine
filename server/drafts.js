// Draft library — local persistence so drafts survive refreshes and become a
// real review queue. One JSON file on disk (data/drafts.json, gitignored).
// Statuses: draft -> approved -> posted. Nothing here posts anywhere; "posted"
// is just Tobias marking that HE posted it manually. "delete" is a marker,
// not an action: reviewers reading through the Library flag what should go,
// and someone clears the marked drafts later (Library > Delete > "Delete all
// marked"). Marked drafts are never picked for the Schedule.
// "archived" (2026-11-02, Fresh start): out of sight but kept. Restorable to
// the status it had (prevStatus); still counted by the duplicate check so old
// topics aren't written again; never picked for the Schedule.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic, readJsonSafe } from "./atomic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const STORE = path.join(DATA_DIR, "drafts.json");

export const STATUSES = ["draft", "approved", "posted", "delete", "archived"];

// The AI's own first version of a draft, kept so edits can be compared with
// it (what reviewers change is what Jarvis learns from). Only for model-made
// drafts; a hand-written draft has no AI original.
function aiOriginalOf(payload) {
  const p = payload || {};
  if (p.aiOriginal) return p.aiOriginal;
  if (p.source !== "model" && !p.origin) return undefined;
  return { title: p.title || "", hook: p.hook || "", body: String(p.body || "") };
}

let _counter = 0;
function newId(now) {
  return `d-${now}-${_counter++}`;
}

function load() {
  return readJsonSafe(STORE, [], { backup: true });
}

function persist(list) {
  writeJsonAtomic(STORE, list, { backup: true });
}

// Newest first.
export function listDrafts() {
  return load().sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
}

// Save a new draft (or upsert if it already carries a library id). `kind` is
// "linkedin" or "blog"; `payload` is the full draft object from the screen.
export function saveDraft({ kind, payload, nowISO }) {
  // Last line of defence for every caller (routes, Worker, rec/gap drafts): an
  // empty article or post is never stored. An empty blog once got scheduled.
  const text = String(payload?.body || "").trim();
  if ((kind === "blog" && text.length < 200) || (kind !== "blog" && !text)) {
    const err = new Error(kind === "blog" ? "refused to save a blog with no body text" : "refused to save a post with no text");
    err.code = "empty_draft";
    throw err;
  }
  const list = load();
  const now = Date.parse(nowISO) || 0;
  const existingId = payload?.libraryId;
  if (existingId) {
    const idx = list.findIndex((d) => d.id === existingId);
    if (idx >= 0) {
      // Upsert replaces the payload wholesale, but the link to the published
      // site file (exportedRel) must survive a re-save from the Blogs screen —
      // dropping it made the next Publish create a DUPLICATE article.
      const keptRel = list[idx].payload?.exportedRel;
      const nextPayload = keptRel && !payload?.exportedRel ? { ...payload, exportedRel: keptRel } : { ...payload };
      // A re-save never replaces the AI's original with the edited text.
      const keptOriginal = list[idx].payload?.aiOriginal;
      if (keptOriginal) nextPayload.aiOriginal = keptOriginal;
      list[idx] = { ...list[idx], kind, payload: nextPayload, updatedAt: nowISO };
      persist(list);
      return list[idx];
    }
  }
  // A NEW record must never inherit another draft's published-file link — a
  // copied payload carrying exportedRel would make "Publish" silently overwrite
  // the ORIGINAL article on the site instead of creating a new one.
  const { exportedRel: _stripped, ...freshPayload } = payload || {};
  const original = aiOriginalOf(freshPayload);
  if (original) freshPayload.aiOriginal = original;
  const record = {
    id: newId(now),
    kind: kind === "blog" ? "blog" : "linkedin",
    status: "draft",
    payload: freshPayload,
    savedAt: nowISO,
    updatedAt: nowISO,
  };
  list.push(record);
  persist(list);
  return record;
}

// `patch.ifUpdatedAt` (optional) is an optimistic-concurrency precondition: when
// it is set and does not match the stored updatedAt, the update is refused and
// { conflict: true, current } is returned instead of silently overwriting what
// someone else saved in between (several people share the Library now).
export function updateDraft(id, patch, nowISO) {
  const list = load();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  if (patch.ifUpdatedAt && list[idx].updatedAt && patch.ifUpdatedAt !== list[idx].updatedAt) {
    return { conflict: true, current: list[idx] };
  }
  const next = { ...list[idx], updatedAt: nowISO };
  if (patch.status && STATUSES.includes(patch.status)) {
    // Marking "delete" overwrites the status; keep what it was so the taste loop
    // can tell a rejected draft from cleanup of an approved/posted one.
    if (patch.status === "delete" && list[idx].status !== "delete") {
      const cur = list[idx];
      // Back from the archive into "To delete": an archived delete-marker keeps
      // the prevStatus it already had.
      next.prevStatus = cur.status !== "archived" ? cur.status : cur.archivedFrom === "delete" ? cur.prevStatus || "draft" : cur.archivedFrom || "draft";
    }
    // (Archiving a delete-marked draft keeps its prevStatus for the round trip.)
    if (patch.status !== "delete" && patch.status !== "archived") delete next.prevStatus;
    // Archiving remembers the exact status it came from (even "delete").
    if (patch.status === "archived" && list[idx].status !== "archived") next.archivedFrom = list[idx].status;
    if (patch.status !== "archived") {
      delete next.archivedFrom;
      delete next.archivedAt;
    }
    next.status = patch.status;
  }
  if (patch.payload) {
    next.payload = patch.payload;
    // Edits replace the payload wholesale; the AI original must survive them.
    const kept = list[idx].payload?.aiOriginal;
    if (kept && !next.payload.aiOriginal) next.payload = { ...next.payload, aiOriginal: kept };
  }
  list[idx] = next;
  persist(list);
  return next;
}

export function deleteDraft(id) {
  const list = load();
  const next = list.filter((d) => d.id !== id);
  persist(next);
  return next.length !== list.length;
}

// Archive every draft `which(d)` accepts (Fresh start). Returns the archived ids.
export function archiveDrafts(which, nowISO) {
  const list = load();
  const ids = [];
  for (const d of list) {
    if (d.status === "archived" || !which(d)) continue;
    d.archivedFrom = d.status; // a "delete" marker keeps its own prevStatus too
    d.status = "archived";
    d.archivedAt = nowISO;
    d.updatedAt = nowISO;
    ids.push(d.id);
  }
  if (ids.length) persist(list);
  return ids;
}

// Put archived drafts back where they were (all of them, or just `ids`).
export function restoreArchived(ids = null, nowISO) {
  const want = ids ? new Set(ids) : null;
  const list = load();
  const restored = [];
  for (const d of list) {
    if (d.status !== "archived" || (want && !want.has(d.id))) continue;
    d.status = d.archivedFrom && d.archivedFrom !== "archived" ? d.archivedFrom : "draft";
    if (d.status !== "delete") delete d.prevStatus;
    delete d.archivedFrom;
    delete d.archivedAt;
    d.updatedAt = nowISO;
    restored.push(d.id);
  }
  if (restored.length) persist(list);
  return restored;
}

export function draftsSummary() {
  const list = load();
  const byStatus = { draft: 0, approved: 0, posted: 0 };
  for (const d of list) byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  return { total: list.length, byStatus };
}
