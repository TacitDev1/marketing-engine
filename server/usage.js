// Token-usage tracker — for THIS app only.
//
// Records every model call the marketing app's brain makes (drafts, blogs,
// classification, embeddings) with the tokens Ollama reports, and aggregates
// them for the Token Usage screen. It does NOT read your Claude Code history or
// any other tool — just this app's own consumption. Local only.
//
// Cost is $0 for local Ollama models (no billing); if the brain is ever pointed
// at a paid API model, a price table kicks in so the same screen shows real cost
// — which is what matters after the move to a server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./atomic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, "../data/usage.json");
const CAP = 100000; // keep the most recent N calls

// Paid-model pricing, USD per 1M tokens [input, output]. Local Ollama models
// aren't listed → cost 0. Add hosted models here when the brain moves to one.
const PRICING = [
  { match: /opus/i, in: 15, out: 75 },
  { match: /sonnet/i, in: 3, out: 15 },
  { match: /haiku/i, in: 1, out: 5 },
  { match: /gpt-4o|gpt-4\.1/i, in: 2.5, out: 10 },
];
function priceFor(model) {
  return PRICING.find((p) => p.match.test(model || "")) || null;
}

let _rows = null;
let _timer = null;

function load() {
  if (_rows) return _rows;
  try {
    _rows = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!Array.isArray(_rows)) _rows = [];
  } catch {
    _rows = [];
  }
  return _rows;
}

function schedulePersist() {
  if (_timer) return;
  _timer = setTimeout(() => {
    _timer = null;
    try {
      writeJsonAtomic(FILE, _rows.slice(-CAP), { pretty: false });
    } catch {
      /* non-fatal */
    }
  }, 1500);
}

// Called by the brain on every model call. kind: "chat" | "embed".
export function recordUsage({ model, promptTokens = 0, outputTokens = 0, kind = "chat", nowISO }) {
  const rows = load();
  rows.push({
    t: Date.parse(nowISO) || Date.now(),
    model: model || "",
    kind,
    p: Math.max(0, Math.round(promptTokens) || 0),
    o: Math.max(0, Math.round(outputTokens) || 0),
  });
  if (rows.length > CAP + 5000) _rows = rows.slice(-CAP);
  schedulePersist();
}

export function getUsage({ days = 30 } = {}) {
  const rows = load();
  const since = days > 0 ? Date.now() - days * 86400000 : 0;
  const sel = rows.filter((r) => r.t >= since);

  const totals = { calls: 0, prompt: 0, output: 0, tokens: 0, cost: 0, unpricedCalls: 0 };
  const byDay = new Map();
  const byModel = new Map();
  const byKind = new Map();

  for (const r of sel) {
    const tok = r.p + r.o;
    const price = priceFor(r.model);
    const cost = price ? (r.p * price.in + r.o * price.out) / 1e6 : 0;
    totals.calls++; totals.prompt += r.p; totals.output += r.o; totals.tokens += tok; totals.cost += cost;
    if (!price) totals.unpricedCalls++;

    const day = new Date(r.t).toISOString().slice(0, 10);
    const d = byDay.get(day) || { date: day, tokens: 0, cost: 0 };
    d.tokens += tok; d.cost += cost; byDay.set(day, d);

    const mk = r.model || "(unknown)";
    const mm = byModel.get(mk) || { model: mk, calls: 0, tokens: 0, cost: 0, priced: !!price };
    mm.calls++; mm.tokens += tok; mm.cost += cost; byModel.set(mk, mm);

    const kk = r.kind || "chat";
    const kc = byKind.get(kk) || { kind: kk, calls: 0, tokens: 0 };
    kc.calls++; kc.tokens += tok; byKind.set(kk, kc);
  }

  return {
    available: true,
    range: { days },
    totals,
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
    byKind: [...byKind.values()].sort((a, b) => b.tokens - a.tokens),
  };
}
