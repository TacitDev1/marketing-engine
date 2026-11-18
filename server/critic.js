// The critic — Jarvis reviewing its own draft the way Larkwell's marketing lead
// would, before anything reaches the Library ("don't write that, fix that").
//
// Two layers:
//   1. Hard checks in code (cheap, certain): cut-off title, the recycled
//      "X often fails" hook, numbers with no source behind them, a theme we
//      covered in the last two weeks, AI-slop, invented clients.
//   2. A strict review by the big model against the playbook, Larkwell's buyers and
//      services: score 0-10, buyer fit, on-brand, what to fix.
// A failing draft gets up to two targeted rewrites; if it still fails it is
// discarded and the reason goes in the daily brief. Fewer, better.

import { chatJSON, clean, reviseDraft } from "./brain.js";
import { detectSlop, findFabricatedClientClaims, detectClientSuccess, isClientSuccessGrounded, fitTitle } from "./guardrails.js";
import { company, services } from "../src/lib/company.js";
import { jaccard } from "./similarity.js";

export const PASS_SCORE = 7;
const MAX_REVISIONS = 2;

const textOf = (p) => `${p.title || ""}\n${p.hook || ""}\n${p.body || ""}`;

// ---------- hard checks ----------

// The hook formula Mara flagged: nearly every autopilot post opened with it.
const HOOK_FORMULA = /\b(?:is|are)?\s*often\s+(?:fails?|the difference|leads?|hides?|stalls?|creates?|exists?|ignored|overlooked|underestimated|treated|a distraction|the highest)\b/i;

// Figures that need a source: percentages, money, multipliers, millions/billions,
// "N in M", "N out of M". Years, SAP releases (S/4HANA 2023, ECC 6.0,
// NetWeaver 7.5) and plain counts ("3 steps") are not claims.
const FIGURE = /(?:[$€£]\s?\d[\d,.]*\s?(?:k|m|bn|million|billion)?|\bR\s?\d[\d,.]*\s?(?:k|m|bn|million|billion)?\b|\b\d+(?:[.,]\d+)?\s?(?:-|to)\s?\d+(?:[.,]\d+)?\s?%|\b\d+(?:[.,]\d+)?\s?(?:%|percent\b|per cent\b)|\b\d+(?:[.,]\d+)?\s?x\b|\b\d+(?:[.,]\d+)?\s?(?:million|billion)\b|\b\d{1,2}\s(?:in|out of)\s\d{1,3}\b(?!\s*(?:steps?|weeks?|days?|months?|years?)))/gi;

export function findFigures(text) {
  return [...new Set((String(text || "").match(FIGURE) || []).map((m) => m.trim()))];
}

// A figure is sourced when the same number appears in the source material the
// draft was written from (finding summaries, Search Console rows...).
function digitsOf(fig) {
  // "1,000" is a thousand, not one-point-zero: drop thousands separators first
  // (the source text gets the same treatment).
  return (fig.replace(/,(\d{3})/g, "$1").match(/\d+(?:[.,]\d+)?/g) || []).map((d) => d.replace(",", "."));
}
export function unsourcedFigures(text, sourcesText) {
  const src = String(sourcesText || "").replace(/,(\d{3})/g, "$1");
  return findFigures(text).filter((fig) => !digitsOf(fig).every((d) => new RegExp(`(^|[^\\d.])${d.replace(".", "[.,]")}([^\\d]|$)`).test(src)));
}

const SIG_STOP = new Set("the a an and or but to of in for with your you our we is are be on at as it its how what why that this from into can will would should could help guide global sap larkwell has have more most when where who".split(" "));
function sigOf(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !SIG_STOP.has(w))
      .slice(0, 16)
  );
}

// `recent` = [{ title, hook, keyword }] written in the last two weeks (any status).
export function repeatsTheme(payload, recent = []) {
  const mine = sigOf(`${payload.title || payload.hook || ""} ${payload.keyword || ""}`);
  let best = null;
  for (const r of recent) {
    const score = jaccard(mine, sigOf(`${r.title || r.hook || ""} ${r.keyword || ""}`));
    if (score >= 0.4 && (!best || score > best.score)) best = { score, title: r.title || r.hook };
  }
  return best;
}

export function hardChecks({ kind, payload, sourcesText = "", recent = [] }) {
  const issues = [];
  const text = textOf(payload);
  if (kind === "blog" && (payload.titleCut || !payload.title || String(payload.title).length > 60)) {
    issues.push({ code: "title_cut", hard: false, fix: "Write a complete blog title of at most 60 characters (never cut off mid-phrase).", note: `title "${payload.title || ""}" was cut to fit` });
  }
  if (kind !== "blog" && HOOK_FORMULA.test(payload.hook || "")) {
    issues.push({ code: "hook_formula", hard: false, fix: "Rewrite the hook: open with a specific fact, a clear stance or a concrete situation, not the \"X often fails\" formula.", note: "recycled \"often\" hook" });
  }
  const unsourced = unsourcedFigures(text, sourcesText);
  if (unsourced.length) {
    issues.push({ code: "unsourced_figures", hard: false, fix: `Remove these figures, which have no source we can cite, and rephrase the sentences without them: ${unsourced.join(", ")}.`, note: `unsourced: ${unsourced.join(", ")}` });
  }
  const rep = repeatsTheme(payload, recent);
  if (rep) issues.push({ code: "repeat_theme", hard: true, note: `too close to "${String(rep.title).slice(0, 70)}" (${Math.round(rep.score * 100)}%)` });
  const slop = detectSlop(text);
  if (slop.isSlop) issues.push({ code: "slop", hard: false, fix: `Remove the AI-sounding phrasing (${slop.hits.slice(0, 5).join(", ")}); plain, specific sentences.`, note: `AI-slop: ${slop.hits.slice(0, 3).join(", ")}` });
  const fabricated = findFabricatedClientClaims(text);
  const success = isClientSuccessGrounded(text) ? [] : detectClientSuccess(text);
  if (fabricated.length || success.length) {
    issues.push({ code: "invented_client", hard: false, fix: "Remove every client story, client name or client outcome. Speak about the problem and Larkwell's capability in general terms.", note: `unverified client claim: ${[...fabricated, ...success].slice(0, 2).join(", ")}` });
  }
  return issues;
}

// ---------- model review ----------

const REVIEW_FORMAT = {
  type: "object",
  properties: {
    score: { type: "number" },
    buyerFit: { type: "boolean" },
    onBrand: { type: "boolean" },
    problems: { type: "array", items: { type: "string" } },
    fix: { type: "string" },
  },
  required: ["score", "buyerFit", "onBrand", "problems", "fix"],
};

async function modelReview({ kind, payload, rulesBlock }) {
  const system = [
    `You are the head of marketing at ${company.name}, ${company.oneLiner}`,
    `Buyers: ${company.audience}`,
    `Larkwell services: ${services.map((s) => s.label).join(", ")}.`,
    ``,
    `Review a ${kind === "blog" ? "blog article" : "LinkedIn post"} your team drafted, BEFORE it goes to the founders.`,
    `Be strict. Approve only what you would be proud to publish under Larkwell's name.`,
    `Score 0-10: 9-10 publish as is; 7-8 good, small fixes; 5-6 generic or off-target; 0-4 wrong for Larkwell.`,
    `buyerFit = true only if an IT or SAP leader at a mid-to-large enterprise would care AND it ties to a Larkwell service.`,
    `onBrand = true only if it follows every playbook rule below and sounds like a senior SAP practitioner.`,
    `problems = the concrete problems (short). fix = ONE editing instruction that would fix them (empty if none).`,
    ``,
    rulesBlock || "",
    ``,
    `Return ONLY JSON: { score, buyerFit, onBrand, problems, fix }.`,
  ].join("\n");
  const body = String(payload.body || "");
  const user = [
    kind === "blog" ? `TITLE: ${payload.title || ""}\nKEYWORD: ${payload.keyword || ""}\n\n${body.slice(0, 9000)}` : `HOOK: ${payload.hook || ""}\n\n${body}`,
    ``,
    `Review it now as JSON.`,
  ].join("\n");
  const out = await chatJSON(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    REVIEW_FORMAT,
    { numPredict: 450, tier: "quality" }
  );
  return {
    score: Math.max(0, Math.min(10, Math.round(Number(out.score) || 0))),
    buyerFit: !!out.buyerFit,
    onBrand: !!out.onBrand,
    problems: (Array.isArray(out.problems) ? out.problems : []).map(clean).filter(Boolean).slice(0, 6),
    fix: clean(out.fix || ""),
  };
}

// A cut title is cheaper to fix on its own than with a whole-article rewrite.
const TITLE_FORMAT = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
async function newTitle(payload) {
  for (let i = 0; i < 2; i++) {
    const out = await chatJSON(
      [
        { role: "system", content: "You write SEO titles for Larkwell Consulting's SAP blog. One complete, specific title of AT MOST 55 characters, keyword near the start, UK English, no clickbait, no colon-stacked fragments. Return ONLY JSON: { title }." },
        { role: "user", content: `Keyword: ${payload.keyword || ""}\nCurrent (too long or cut) title: ${payload.title || ""}\nArticle opening: ${String(payload.body || "").slice(0, 600)}\nWrite the title now as JSON.` },
      ],
      TITLE_FORMAT,
      { numPredict: 60 }
    );
    const t = clean(out.title || "");
    if (t && t.length <= 60 && fitTitle(t) === t) return t;
  }
  return null;
}

// ---------- the loop ----------

// Review → fix → review, at most MAX_REVISIONS rewrites, never past `deadline`.
// Returns { passed, payload, critique, discardReason }.
export async function critiqueAndFix({ kind, payload, rulesBlock = "", sourcesText = "", recent = [], deadline = Infinity, log = () => {} }) {
  let current = { ...payload };
  let revisions = 0;
  for (;;) {
    const hard = hardChecks({ kind, payload: current, sourcesText, recent });
    const blocking = hard.find((i) => i.hard);
    if (blocking) return { passed: false, payload: current, critique: { issues: hard.map((i) => i.note), revisions }, discardReason: blocking.note };

    // Title first: a separate, cheap fix.
    const titleIssue = hard.find((i) => i.code === "title_cut");
    if (titleIssue) {
      const t = await newTitle(current).catch(() => null);
      if (t) {
        current = { ...current, title: t };
        delete current.titleCut;
        log(`new title: "${t}"`);
        continue;
      }
    }

    let review;
    try {
      review = await modelReview({ kind, payload: current, rulesBlock });
    } catch (err) {
      return { passed: false, payload: current, critique: { issues: hard.map((i) => i.note), revisions }, discardReason: `review failed: ${err.message}` };
    }
    const fixable = hard.filter((i) => !i.hard && i.code !== "title_cut");
    const passed = !fixable.length && !titleIssue && review.score >= PASS_SCORE && review.buyerFit && review.onBrand;
    const critique = {
      score: review.score,
      buyerFit: review.buyerFit,
      onBrand: review.onBrand,
      issues: [...hard.map((i) => i.note), ...review.problems].slice(0, 8),
      revisions,
    };
    if (passed) {
      delete current.titleCut;
      return { passed: true, payload: current, critique };
    }
    if (!review.buyerFit) {
      return { passed: false, payload: current, critique, discardReason: `not for Larkwell's buyers: ${review.problems[0] || "no clear buyer or service"}` };
    }
    if (revisions >= MAX_REVISIONS || Date.now() > deadline) {
      return { passed: false, payload: current, critique, discardReason: `still ${review.score}/10 after ${revisions} rewrite${revisions === 1 ? "" : "s"}: ${critique.issues[0] || "below the bar"}` };
    }
    // A title the separate title fix couldn't repair rides along with the rewrite
    // (the brief names the title, so reviseDraft is allowed to change it).
    const instruction = [...fixable.map((i) => i.fix), titleIssue?.fix, review.fix].filter(Boolean).join(" ");
    if (!instruction) {
      return { passed: false, payload: current, critique, discardReason: `scored ${review.score}/10 with no clear fix` };
    }
    try {
      const out = await reviseDraft({ kind, payload: current, instruction });
      current = { ...out.payload };
      // The rewrite's title is judged on its own (the length check still
      // catches a real stump); the old cut flag must not outlive it.
      delete current.titleCut;
      revisions++;
      log(`rewrite ${revisions}: ${instruction.slice(0, 140)}`);
    } catch (err) {
      return { passed: false, payload: current, critique, discardReason: `rewrite failed: ${err.message}` };
    }
  }
}

export { MAX_REVISIONS, HOOK_FORMULA };
