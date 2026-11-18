// Library near-duplicate detection by MEANING (nomic-embed-text), not shared words.
// Mara (2026-09-22): "Library seems to contain many duplicates." The worker's
// word-overlap variety guard only compared the incoming finding's TITLE with the
// last 30 drafts, so the model kept writing the same post in new words (2027 ECC
// deadline, disaster recovery, clean-core ABAP...). Every new autopilot draft is
// now compared with the whole Library before it is saved.
//
// Vectors are cached on disk by a hash of the draft text, so each draft is
// embedded once, not on every tick. If the embed model is missing, callers get
// null and carry on (the app never hard-depends on embeddings).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embed, embedAvailable, cosine } from "./embeddings.js";
import { getSettings } from "./settings.js";
import { sha1 } from "./stores.js";
import { readJsonSafe, writeJsonAtomic } from "./atomic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(__dirname, "../data/draft-vectors.json");

// Measured on the Library (2026-09-22): pairs at >= 0.93 are the same post
// reworded; below ~0.9 they are different angles on a related topic.
export const DRAFT_DUP_THRESHOLD = Number(process.env.DRAFT_DUP_THRESHOLD) || 0.93;

export const draftText = (p = {}) => `${p.title || ""}\n${p.hook || ""}\n${p.body || ""}`.trim();

let cache = null; // { model, vecs: { [hash]: number[] } }
let cacheMtime = 0;
function mtime() {
  try {
    return fs.statSync(STORE).mtimeMs;
  } catch {
    return 0;
  }
}
// The cleanup script writes this file from its own process; re-read when it
// changed on disk so the server doesn't overwrite its prune with stale memory.
function loadCache() {
  const model = getSettings().embedModel;
  const m = mtime();
  if (!cache || cache.model !== model || m !== cacheMtime) {
    const disk = readJsonSafe(STORE, { model, vecs: {} });
    cache = disk.model === model ? disk : { model, vecs: {} };
    cacheMtime = m;
  }
  return cache;
}
function saveCache(c) {
  writeJsonAtomic(STORE, c, { pretty: false });
  cacheMtime = mtime();
}

// Embed each text (cached). Returns vectors in the same order.
export async function vectorsFor(texts) {
  const c = loadCache();
  let added = false;
  const out = [];
  try {
    for (const t of texts) {
      const key = sha1(t);
      if (!c.vecs[key]) {
        c.vecs[key] = await embed(t);
        added = true;
      }
      out.push(c.vecs[key]);
    }
  } finally {
    // Keep what was embedded even if Ollama drops out mid-batch: the first
    // pass over a 300-draft Library must not start from zero on every retry.
    if (added) saveCache(c);
  }
  return out;
}

// Drop cached vectors for drafts no longer in the Library.
export function pruneVectors(drafts) {
  const c = loadCache();
  const live = new Set(drafts.map((d) => sha1(draftText(d.payload))));
  const before = Object.keys(c.vecs).length;
  for (const k of Object.keys(c.vecs)) if (!live.has(k)) delete c.vecs[k];
  if (Object.keys(c.vecs).length !== before) saveCache(c);
}

// The closest existing draft of the same kind at or above the threshold, as
// { draft, score }, or null (no match, or embeddings unavailable).
export async function findNearDuplicate({ kind, payload }, drafts, threshold = DRAFT_DUP_THRESHOLD) {
  if (!(await embedAvailable())) return null;
  const text = draftText(payload);
  if (!text) return null;
  const pool = drafts.filter((d) => d.kind === kind && draftText(d.payload));
  if (!pool.length) return null;
  const [vec, ...vecs] = await vectorsFor([text, ...pool.map((d) => draftText(d.payload))]);
  let best = null;
  pool.forEach((d, i) => {
    const score = cosine(vec, vecs[i]);
    if (score >= threshold && (!best || score > best.score)) best = { draft: d, score };
  });
  return best;
}
