// Runtime-adjustable model + generation settings.
//
// These used to be module constants / env vars in brain.js and embeddings.js.
// Now they live here, editable from the Settings screen and read by the brain
// at call-time — so switching the model, context size, temperature, keep-alive,
// or even the Ollama host takes effect on the next generation with NO restart.
// Persists to data/settings.json; falls back to env vars / today's defaults so
// nothing breaks if the file is missing. Local only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./atomic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, "../data/settings.json");

export const DEFAULT_SETTINGS = {
  textModel: process.env.OLLAMA_MODEL || "qwen3.5:9b",
  // Optional bigger model for QUALITY tasks (drafting, recommendations, wiki
  // merges). Empty = use textModel for everything, exactly as before. Cheap
  // tasks (classification, topic generation) always stay on textModel — so the
  // quality model only burns GPU time where quality matters.
  qualityModel: process.env.OLLAMA_QUALITY_MODEL || "gemma4:12b",
  embedModel: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
  ollamaHost: process.env.OLLAMA_HOST || "127.0.0.1:11434",
  numCtx: 8192, // context window (tokens) — bigger = smarter/longer but more memory
  numPredict: 900, // default max output tokens (a per-call value still overrides)
  temperature: 0.8, // creativity vs. focus
  keepAlive: "60s", // how long Ollama keeps the model loaded after a call
};

let _cache = null;

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function getSettings() {
  if (!_cache) _cache = { ...DEFAULT_SETTINGS, ...readFile() };
  return _cache;
}

// Whitelist + coerce every field so the UI can't write junk the model chokes on.
export function updateSettings(patch = {}) {
  const cur = getSettings();
  const next = { ...cur };
  if (typeof patch.textModel === "string" && patch.textModel.trim()) next.textModel = patch.textModel.trim();
  // qualityModel may legitimately be set to "" (= use textModel), so accept any string.
  if (typeof patch.qualityModel === "string") next.qualityModel = patch.qualityModel.trim();
  if (typeof patch.embedModel === "string" && patch.embedModel.trim()) next.embedModel = patch.embedModel.trim();
  // On the shared server the model host comes from the environment ONLY. Left
  // editable, anyone on the network could point every prompt, wiki page and
  // knowledge file at a host of their choosing.
  const hostLocked = process.env.MKT_DEPLOYMENT === "server";
  if (!hostLocked && typeof patch.ollamaHost === "string" && patch.ollamaHost.trim()) next.ollamaHost = patch.ollamaHost.trim();
  if (hostLocked) next.ollamaHost = DEFAULT_SETTINGS.ollamaHost;
  if (patch.numCtx != null) next.numCtx = Math.max(512, Math.min(131072, Math.round(Number(patch.numCtx)) || cur.numCtx));
  if (patch.numPredict != null) next.numPredict = Math.max(64, Math.min(8192, Math.round(Number(patch.numPredict)) || cur.numPredict));
  if (patch.temperature != null && !Number.isNaN(Number(patch.temperature))) next.temperature = Math.max(0, Math.min(2, Number(patch.temperature)));
  if (typeof patch.keepAlive === "string" && patch.keepAlive.trim()) next.keepAlive = patch.keepAlive.trim();

  _cache = next;
  try {
    writeJsonAtomic(FILE, next);
  } catch {
    /* non-fatal: settings stay in memory for this run */
  }
  return next;
}

// The Ollama base URL, normalised to include a scheme.
export function ollamaBase() {
  const h = getSettings().ollamaHost;
  return h.startsWith("http") ? h : `http://${h}`;
}
