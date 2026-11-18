// The playbook — what Jarvis has learned about writing Larkwell's marketing, as
// plain-language rules people can read and edit (Jarvis screen > Playbook).
//
// Modelled on Everything Claude Code's "instincts": each rule is atomic, carries
// a confidence score and the evidence behind it, gets stronger when reviewers
// confirm it and weaker when they contradict it or it stops coming up.
//   0.3 tentative (not used) · 0.5 used · 0.7 strong · 0.9 core
// Rules at 0.5+ (or pinned) go into every writer and critic prompt.
//
// Seeded 2026-11-02 from Mara's five concerns (quality/accuracy, Larkwell tone,
// topics wrong for buyers, repetition, unchecked claims), Larkwell's voice and
// services (src/lib/company.js), and the content/research quality gates from the
// marketing skills. Everything after that is learned.

import { load, persist, newId, addActivity } from "./stores.js";
import { jaccard } from "./similarity.js";

export const RULE_KINDS = ["topic", "voice", "claim", "format", "timing", "avoid"];
const SOURCES = ["founder", "seed", "edit", "rejection", "analytics", "research", "you"];

export const USE_AT = 0.5; // rules at/above this go into prompts
const MIN = 0.1;
const MAX = 0.95;
const DORMANT_BELOW = 0.3;
const UP = 0.05; // a reviewer signal that confirms a rule
const DOWN = 0.1; // a correction / contradicting signal
const DECAY_PER_WEEK = 0.02; // a rule nothing has confirmed for a week
const PROMPT_RULES = 15;
const RULES_CAP = 200;

const SEED_RULES = [
  // Mara's concerns (2026-11-02) — start strong.
  ["topic", "founder", 0.75, "Every piece must tie to one Larkwell service and a real problem that IT and SAP leaders at mid-to-large enterprises are trying to solve. If it doesn't, don't write it."],
  ["avoid", "founder", 0.7, "Don't write about niche regulation or compliance topics (for example EPA e-Manifest or DORA CTPP rules) unless they directly change what an SAP buyer has to do and Larkwell offers help with it."],
  ["avoid", "founder", 0.75, "Don't repeat a theme Larkwell covered in the last two weeks (for example Clean Core or S/4HANA deadline timing). Pick a different service or a genuinely new angle."],
  ["format", "founder", 0.75, "Never open a LinkedIn post with the \"X often fails\" / \"is often the difference\" / \"often leads to\" formula. Open with a specific fact, a clear stance or a concrete situation."],
  ["claim", "founder", 0.8, "Every number (percentage, cost, time saved, statistic) must come from a source we can link to. No source, no number."],
  ["claim", "founder", 0.8, "No claims about Larkwell results, clients, certifications or awards that aren't verified. Brackenfield Waste and Osterby Utilities are the only clients we may name."],
  ["voice", "founder", 0.75, "Write in UK English: organisation, optimise, modernise, analyse, behaviour."],
  ["voice", "founder", 0.7, "Sound like a senior SAP practitioner who did the work: plain, specific, calm and honest about trade-offs. No hype, no exclamation marks."],
  ["format", "founder", 0.7, "Blog titles are complete phrases of 60 characters or fewer, never cut off mid-phrase."],
  ["format", "founder", 0.65, "One clear point per LinkedIn post. Cut anything that doesn't support it."],
  // Larkwell voice + positioning (src/lib/company.js, server/prompts.js).
  ["voice", "seed", 0.65, "Name the actual SAP thing in every claim (module, transaction, release, migration step). Cut any sentence that could appear in any vendor's post."],
  ["voice", "seed", 0.7, "Be practical about custom code: modernise what earns its keep, retire the rest, and say which is which."],
  ["topic", "seed", 0.6, "Spread across Larkwell's whole service catalogue (Basis, ABAP, plant maintenance, billing, integration, data migration, managed services, Fiori), not just S/4HANA migration."],
  // Marketing skills: content-strategy, copywriting, social, market-research.
  ["format", "seed", 0.6, "Open with the point in the first line. No warm-up, no scene-setting, no rhetorical question."],
  ["avoid", "seed", 0.6, "No engagement bait: no questions tacked on just to farm comments, no \"Agree?\", no fake urgency."],
  ["topic", "seed", 0.6, "Prefer topics with measured search demand (Search Console queries, the keyword sheet) or a timely SAP announcement, and say which in the reason for writing it."],
  ["topic", "seed", 0.55, "Match the buyer's stage: problem posts for awareness, cost/approach/comparison pieces for evaluation, Larkwell-specific detail for buyers close to a decision."],
  ["format", "seed", 0.6, "Blogs answer the search question in the first paragraph and then cover the follow-up questions. Every section adds something new."],
  ["claim", "seed", 0.6, "Keep fact, opinion and estimate apart. Label an estimate as an estimate."],
  ["format", "seed", 0.55, "Any call to action is soft and specific to the piece (talk to Larkwell about this exact problem), never generic."],
  ["timing", "seed", 0.5, "No more than one Larkwell LinkedIn post per working day; weekday mornings UK time."],
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function sig(s) {
  return new Set(norm(s).split(" ").filter((w) => w.length >= 4));
}
const clamp = (n) => Math.round(Math.min(MAX, Math.max(MIN, n)) * 100) / 100;

function state() {
  const s = load("playbook");
  return { rules: Array.isArray(s.rules) ? s.rules : [], seededAt: s.seededAt || null };
}
function save(s) {
  const rules = s.rules.length > RULES_CAP ? s.rules.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.confidence - a.confidence).slice(0, RULES_CAP) : s.rules;
  persist("playbook", { ...s, rules });
}

function makeRule({ kind, text, confidence, source, evidence = [] }, nowISO) {
  return {
    id: newId("pb", nowISO),
    kind: RULE_KINDS.includes(kind) ? kind : "voice",
    text: String(text || "").trim().slice(0, 400),
    confidence: clamp(Number(confidence) || USE_AT),
    source: SOURCES.includes(source) ? source : "seed",
    evidence: evidence.slice(-12),
    pinned: false,
    status: "active",
    createdAt: nowISO,
    updatedAt: nowISO,
    lastSeenAt: nowISO,
  };
}

// Plant the starting rules once (first boot after the 2026-11-02 deploy).
export function ensureSeeded(nowISO) {
  const s = state();
  if (s.seededAt) return 0;
  for (const [kind, source, confidence, text] of SEED_RULES) {
    s.rules.push(makeRule({ kind, source, confidence, text, evidence: [{ at: nowISO, note: source === "founder" ? "Mara's review of the Library, 2026-11-02" : "starting rule" }] }, nowISO));
  }
  s.seededAt = nowISO;
  save(s);
  return SEED_RULES.length;
}

export function listRules({ includeDormant = true } = {}) {
  const rules = state().rules.filter((r) => includeDormant || r.status === "active");
  return rules.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.confidence - a.confidence);
}

// The rules the writer and critic follow right now.
export function activeRules({ limit = PROMPT_RULES, kinds = null } = {}) {
  return listRules({ includeDormant: false })
    .filter((r) => (r.pinned || r.confidence >= USE_AT) && (!kinds || kinds.includes(r.kind)))
    .slice(0, limit);
}

// Prompt block for writers/critic. Small and hard-capped (numCtx is 8k).
export function playbookBlock(rules = activeRules()) {
  if (!rules.length) return "";
  const lines = rules.map((r) => `- (${r.kind}${r.confidence >= 0.7 || r.pinned ? ", strict" : ""}) ${r.text}`);
  return [`Larkwell PLAYBOOK - rules learned from the team's reviews. Follow every one:`, ...lines].join("\n").slice(0, 3500);
}

// Add a rule; a near-duplicate of an existing one reinforces it instead.
export function addRule({ kind, text, confidence = USE_AT, source = "you", evidence = [] }, nowISO) {
  const t = String(text || "").trim();
  if (!t) return null;
  const s = state();
  const sg = sig(t);
  const dup = s.rules.find((r) => r.status !== "deleted" && jaccard(sg, sig(r.text)) >= 0.6);
  if (dup) {
    dup.confidence = clamp(dup.confidence + UP);
    dup.evidence = [...(dup.evidence || []), ...evidence].slice(-12);
    dup.lastSeenAt = nowISO;
    dup.updatedAt = nowISO;
    if (dup.status === "dormant" && dup.confidence >= DORMANT_BELOW) dup.status = "active";
    save(s);
    return { rule: dup, merged: true };
  }
  const rule = makeRule({ kind, text: t, confidence, source, evidence }, nowISO);
  s.rules.push(rule);
  save(s);
  return { rule, merged: false };
}

// Human edits from the Playbook tab: text, kind, confidence, pin, status.
export function updateRule(id, patch, nowISO) {
  const s = state();
  const r = s.rules.find((x) => x.id === id);
  if (!r) return null;
  if (typeof patch.text === "string" && patch.text.trim()) r.text = patch.text.trim().slice(0, 400);
  if (RULE_KINDS.includes(patch.kind)) r.kind = patch.kind;
  if (patch.confidence != null && Number.isFinite(Number(patch.confidence))) r.confidence = clamp(Number(patch.confidence));
  if (typeof patch.pinned === "boolean") r.pinned = patch.pinned;
  if (["active", "dormant", "deleted"].includes(patch.status)) r.status = patch.status;
  if (r.status === "dormant" && r.confidence >= USE_AT && patch.status == null) r.status = "active";
  r.updatedAt = nowISO;
  if (patch.confidence != null || patch.text) r.evidence = [...(r.evidence || []), { at: nowISO, note: "edited by hand" }].slice(-12);
  save(s);
  return r;
}

// A learning signal: +UP when evidence confirms a rule, -DOWN when it contradicts.
export function reinforce(id, direction, note, nowISO) {
  const s = state();
  const r = s.rules.find((x) => x.id === id);
  if (!r || r.status === "deleted") return null;
  const before = r.confidence;
  r.confidence = clamp(r.confidence + (direction > 0 ? UP : -DOWN));
  r.evidence = [...(r.evidence || []), { at: nowISO, note: `${direction > 0 ? "confirmed" : "contradicted"}: ${String(note || "").slice(0, 200)}` }].slice(-12);
  if (direction > 0) r.lastSeenAt = nowISO;
  r.status = r.confidence < DORMANT_BELOW && !r.pinned ? "dormant" : "active";
  r.updatedAt = nowISO;
  save(s);
  return { rule: r, before, after: r.confidence };
}

// Rules nothing has confirmed for a while slowly lose weight (pinned ones don't).
export function decay(nowISO) {
  const s = state();
  const now = Date.parse(nowISO);
  const changed = [];
  for (const r of s.rules) {
    if (r.pinned || r.status !== "active") continue;
    const from = Date.parse(r.lastDecayAt || r.lastSeenAt || r.createdAt);
    const weeks = Math.floor((now - from) / (7 * 86400000));
    if (weeks < 1) continue;
    const before = r.confidence;
    r.confidence = clamp(r.confidence - DECAY_PER_WEEK * weeks);
    r.lastDecayAt = new Date(from + weeks * 7 * 86400000).toISOString();
    if (r.confidence < DORMANT_BELOW) r.status = "dormant";
    if (r.confidence !== before) changed.push({ id: r.id, text: r.text, before, after: r.confidence });
  }
  if (changed.length) save(s);
  return changed;
}

// Fresh start: the Researcher's open Build/Avoid directives become tentative
// rules (0.4: below the use line, so only evidence lifts them into prompts).
export function importDirectives(directives, nowISO) {
  let n = 0;
  for (const d of directives.slice(0, 50)) {
    const out = addRule(
      { kind: d.kind === "avoid" ? "avoid" : "topic", text: d.text, confidence: 0.4, source: "research", evidence: [{ at: nowISO, note: `Researcher directive ${d.id} (${d.createdAt?.slice(0, 10) || ""})` }] },
      nowISO
    );
    if (out && !out.merged) n++;
  }
  if (n) addActivity({ actor: "jarvis", event: "playbook.imported", summary: `kept ${n} of the Researcher's build/avoid notes as tentative playbook rules` }, nowISO);
  return n;
}
