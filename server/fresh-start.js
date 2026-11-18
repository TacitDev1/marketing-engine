// Fresh start (Mara, 2026-11-02): clear everything Jarvis shows as work in
// progress so the team starts from a clean slate, WITHOUT losing anything.
//
//   1. Snapshot every affected store to data/archive/fresh-start-<stamp>/.
//   2. Empty the live lists: findings, recommendations, Build/Avoid directives,
//      research queue, activity feed, old keep/kill counts.
//   3. Archive every Library draft that isn't approved or posted.
//   4. Keep, untouched, the knowledge underneath: wiki, keyword research,
//      competitor profiles (Jarvis keeps using them).
//
// Archived is not forgotten: archivedFinding() still resolves a finding's
// source link, the open directives become tentative playbook rules, the open
// recommendations are re-checked by the next session, archived drafts still
// count for the duplicate check. restoreFreshStart() merges a snapshot back.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, persist, addActivity, setWorkerState } from "./stores.js";
import { listDrafts, archiveDrafts, restoreArchived } from "./drafts.js";
import { unassignDraft } from "./schedule.js";
import { importDirectives } from "./playbook.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");

// store key -> file name (stores.js FILES); all are arrays.
const CLEARED = {
  findings: "findings.json",
  recommendations: "recommendations.json",
  directives: "directives.json",
  queue: "research-queue.json",
  activity: "activity.json",
  taste: "taste.json",
};

const isKept = (d) => d.status === "approved" || d.status === "posted";

export function freshStartPreview() {
  const counts = {};
  for (const key of Object.keys(CLEARED)) counts[key] = (load(key) || []).length;
  const drafts = listDrafts();
  counts.draftsToArchive = drafts.filter((d) => d.status !== "archived" && !isKept(d)).length;
  counts.draftsKept = drafts.filter(isKept).length;
  counts.openRecommendations = (load("recommendations") || []).filter((r) => r.status === "open").length;
  counts.openDirectives = (load("directives") || []).filter((d) => d.status === "open").length;
  counts.wikiKept = true;
  return { counts, snapshots: listSnapshots() };
}

export function listSnapshots() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((d) => d.startsWith("fresh-start-"))
    .map((d) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, d, "manifest.json"), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function snapshotDir(id) {
  // ids come from the API: only our own folder names are accepted.
  if (!/^fresh-start-[0-9TZ-]+$/.test(String(id || ""))) return null;
  const dir = path.join(ARCHIVE_DIR, id);
  return fs.existsSync(path.join(dir, "manifest.json")) ? dir : null;
}

export function runFreshStart(nowISO, { by = "" } = {}) {
  const id = `fresh-start-${nowISO.replace(/[:.]/g, "-")}`;
  const dir = path.join(ARCHIVE_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  // 1. Snapshot (raw copies; drafts too, as a belt-and-braces backup).
  const files = [];
  for (const file of [...Object.values(CLEARED), "drafts.json", "worker-state.json"]) {
    const src = path.join(DATA_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, file));
      files.push(file);
    }
  }
  const before = freshStartPreview().counts;
  const openRecs = (load("recommendations") || []).filter((r) => r.status === "open");
  const openDirectives = (load("directives") || []).filter((d) => d.status === "open");

  // Write the manifest BEFORE clearing, so a crash mid-way still leaves a
  // restorable snapshot.
  const manifest = {
    id,
    createdAt: nowISO,
    by: String(by || "").slice(0, 60),
    counts: before,
    files,
    archivedDraftIds: [],
    openRecIds: openRecs.map((r) => r.id),
    recsReviewedAt: null,
    restoredAt: null,
  };
  const writeManifest = () => fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeManifest();

  // 2. Directives become tentative playbook rules before the list is cleared.
  const imported = importDirectives(openDirectives, nowISO);

  // 3. Clear the live lists.
  for (const key of Object.keys(CLEARED)) persist(key, []);
  setWorkerState({
    lastResult: null,
    draftsToday: { date: "", count: 0 },
    genToday: { date: "", count: 0 },
    seenDraftKeys: [],
    running: false,
    seedsPlanted: true, // never replant the old seed topics
  });

  // 4. Archive the drafts nobody approved; free their calendar slots.
  const archived = archiveDrafts((d) => !isKept(d), nowISO);
  for (const draftId of archived) unassignDraft(draftId);
  manifest.archivedDraftIds = archived;
  manifest.importedDirectives = imported;
  writeManifest();
  _findingsCache = null;

  addActivity(
    {
      actor: "you",
      event: "fresh-start",
      summary: `fresh start${by ? ` by ${by}` : ""}: archived ${archived.length} drafts, ${before.findings} findings, ${before.recommendations} recommendations, ${before.directives} build/avoid notes. Nothing deleted; the wiki, keywords and competitors are kept.`,
    },
    nowISO
  );
  return manifest;
}

// Merge a snapshot back: archived records return next to anything new.
export function restoreFreshStart(id, nowISO) {
  const dir = snapshotDir(id);
  if (!dir) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const restored = {};
  for (const [key, file] of Object.entries(CLEARED)) {
    const snapFile = path.join(dir, file);
    if (!fs.existsSync(snapFile)) continue;
    let old;
    try {
      old = JSON.parse(fs.readFileSync(snapFile, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(old)) continue;
    const live = load(key) || [];
    // Taste events have no id: key them by time + event + draft.
    const idOf = (r) => r.id || `${r.at}|${r.event}|${r.draftId || r.serviceId || ""}`;
    const have = new Set(live.map(idOf));
    const merged = [...old.filter((r) => !have.has(idOf(r))), ...live];
    persist(key, merged);
    restored[key] = merged.length - live.length;
  }
  restored.drafts = restoreArchived(manifest.archivedDraftIds, nowISO).length;
  manifest.restoredAt = nowISO;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  _findingsCache = null;
  addActivity({ actor: "you", event: "fresh-start.restored", summary: `restored the ${manifest.createdAt.slice(0, 10)} fresh start: ${restored.drafts} drafts and ${restored.findings || 0} findings are back` }, nowISO);
  return { manifest, restored };
}

// ---------- archive lookups Jarvis keeps using ----------

let _findingsCache = null; // Map id -> finding, across all snapshots
function archivedFindingsMap() {
  if (_findingsCache) return _findingsCache;
  const map = new Map();
  for (const m of listSnapshots()) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, m.id, "findings.json"), "utf8"));
      for (const f of list) if (!map.has(f.id)) map.set(f.id, f);
    } catch {
      /* snapshot without findings */
    }
  }
  _findingsCache = map;
  return map;
}

// A finding by id, live or archived (so a draft can still cite its source).
export function findingById(id) {
  if (!id) return null;
  return (load("findings") || []).find((f) => f.id === id) || archivedFindingsMap().get(id) || null;
}
export function archivedFinding(id) {
  return archivedFindingsMap().get(id) || null;
}

// Open recommendations from the newest snapshot that no session has
// re-checked yet. markRecsReviewed() closes that loop.
export function pendingArchivedRecs(limit = 25) {
  const m = listSnapshots().find((s) => !s.recsReviewedAt && !s.restoredAt && (s.openRecIds || []).length);
  if (!m) return { snapshotId: null, recs: [] };
  try {
    const all = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, m.id, "recommendations.json"), "utf8"));
    const want = new Set(m.openRecIds);
    const recs = all
      .filter((r) => want.has(r.id))
      .sort((a, b) => (b.seen || 1) - (a.seen || 1))
      .slice(0, limit);
    return { snapshotId: m.id, recs };
  } catch {
    return { snapshotId: null, recs: [] };
  }
}
export function markRecsReviewed(snapshotId, nowISO) {
  const dir = snapshotDir(snapshotId);
  if (!dir) return;
  const file = path.join(dir, "manifest.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  m.recsReviewedAt = nowISO;
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
}
