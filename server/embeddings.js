// Local embeddings via Ollama (nomic-embed-text) — free, no API key, on-GPU.
// Turns text into vectors so retrieval can match on MEANING, not just shared
// words. Everything stays on this machine. If the embed model isn't installed,
// callers fall back to keyword search, so the app never hard-depends on this.
//
// Install the model once:  ollama pull nomic-embed-text

import { getSettings, ollamaBase } from "./settings.js";
import { recordUsage } from "./usage.js";

// Host + embed model come from the Settings store now (changeable at runtime).
const embedModel = () => getSettings().embedModel;

const CONCURRENCY = 6; // be kind to the GPU; embeds are cheap but not free
// nomic-embed-text has a ~2048-token context. Dense table/spreadsheet text
// tokenizes heavily, so cap input conservatively to avoid 500s. The first
// ~1600 chars capture more than enough signal for similarity matching.
const MAX_EMBED_CHARS = 1600;

// Cache the availability probe, keyed by model name, for a short while only:
// on the server the app often boots before Ollama is up, and a forever-cache
// kept dedupe, semantic search and the Librarian off until the next restart.
let _availFor = null;
const AVAIL_TTL_MS = 60000;
export function resetEmbedAvailability() {
  _availFor = null;
}

// Is the embedding model installed and reachable?
export async function embedAvailable() {
  const model = embedModel();
  if (_availFor && _availFor.model === model && Date.now() - _availFor.at < AVAIL_TTL_MS) return _availFor.ok;
  try {
    const res = await fetch(`${ollamaBase()}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) { _availFor = { model, ok: false, at: Date.now() }; return false; }
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name || m.model || "");
    const ok = names.some((n) => n.startsWith(model));
    _availFor = { model, ok, at: Date.now() };
    return ok;
  } catch {
    _availFor = { model, ok: false, at: Date.now() };
    return false;
  }
}

// Embed a single string -> number[]. Throws if the model is unavailable.
// Generous timeout: the FIRST call cold-loads the model into the GPU, which can
// take a while; subsequent calls are tens of milliseconds.
export async function embed(text, timeoutMs = 90000) {
  const res = await fetch(`${ollamaBase()}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel(), prompt: String(text || "").slice(0, MAX_EMBED_CHARS) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!Array.isArray(data.embedding)) throw new Error("no embedding in response");
  recordUsage({ model: embedModel(), promptTokens: data.prompt_eval_count || 0, outputTokens: 0, kind: "embed", nowISO: new Date().toISOString() });
  return data.embedding;
}

// Embed many strings with bounded concurrency -> number[][] (same order).
// Warms the model with one call first, so the cold-load cost is paid once
// rather than racing across CONCURRENCY parallel requests.
export async function embedBatch(texts) {
  const out = new Array(texts.length);
  if (!texts.length) return out;
  out[0] = await embed(texts[0]); // warm-up (pays model load once)
  let i = 1;
  async function worker() {
    while (i < texts.length) {
      const idx = i++;
      out[idx] = await embed(texts[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length - 1) }, worker));
  return out;
}

// Cosine similarity of two equal-length vectors. Returns -1..1.
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

// Rank `items` (each {text, ...}) against a query embedding, return top n with
// a `.score`. `vectors` is a parallel array of precomputed item embeddings.
export function rankByVector(queryVec, items, vectors, n = 5) {
  return items
    .map((item, idx) => ({ ...item, score: cosine(queryVec, vectors[idx]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export function embedInfo() {
  return { model: embedModel(), host: ollamaBase() };
}
