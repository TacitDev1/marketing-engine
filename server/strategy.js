// Content-strategy engine — turns Larkwell's real keyword research into a prioritized
// content plan, applying the frameworks from the installed marketing skills:
//  - content-strategy: buyer-stage mapping, content pillars, prioritization
//  - seo-audit: intent-aligned targeting, content-type per page
// Pure local, read-only. Powers the SEO screen.

import { getKeywords, keywordSheetDate } from "./knowledge.js";
import { listResearchedKeywords } from "./stores.js";

// Buyer-stage modifiers (content-strategy skill).
const STAGE_RULES = [
  { stage: "Decision", re: /\b(pricing|price|cost|reviews?|demo|trial|buy|hire|quote)\b/i },
  { stage: "Consideration", re: /\b(best|top|vs|versus|alternativ|comparison|compare|companies|company|services|consultant|consulting|partner|vendor|providers?|firms?)\b/i },
  { stage: "Implementation", re: /\b(migration|implementation|implement|template|example|tutorial|setup|configuration|configure|how to use|integration|upgrade|conversion)\b/i },
  { stage: "Awareness", re: /\b(what is|how to|guide|introduction|intro|basics|meaning|definition|explained|tips)\b/i },
];

function buyerStage(keyword, intent) {
  for (const r of STAGE_RULES) if (r.re.test(keyword)) return r.stage;
  // Fall back on the intent column from the research.
  const i = (intent || "").toLowerCase();
  if (i.includes("transactional")) return "Decision";
  if (i.includes("commercial")) return "Consideration";
  return "Awareness"; // informational / navigational head terms
}

function contentType(stage) {
  switch (stage) {
    case "Consideration":
      return "Comparison / services page";
    case "Decision":
      return "Pricing / proof page";
    case "Implementation":
      return "How-to / implementation guide";
    default:
      return "Educational guide";
  }
}

// Transparent priority score from what we actually have: search potential
// (volume) plus an intent boost (commercial terms convert harder/better).
function priorityScore(volume, stage) {
  const v = volume || 0;
  const searchScore = v > 0 ? Math.min(60, Math.log10(v + 1) * 18) : 5; // 0-60
  const intentBoost =
    stage === "Consideration" ? 30 : stage === "Decision" ? 25 : stage === "Implementation" ? 15 : 8;
  return Math.round(searchScore + intentBoost); // ~13-90
}

function band(score) {
  if (score >= 60) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

// Researcher volumes that count as measured. Everything else the researcher
// files (estimate, web, inferred, manual, unverified...) is a guess: its own
// notes say "no SEMrush auth, honest estimate".
const MEASURED_SOURCES = new Set(["semrush"]);

// The sheet + the researcher's keyword base, deduped by keyword. Rules:
// - the sheet's volume always wins (it is a real SEMrush export; researcher
//   rows labelled "semrush" before 2026-10-04 may just be the old default),
// - a researcher volume only fills a keyword that has none; it is flagged
//   `estimated` unless its source is measured,
// - every row says where its volume came from (volumeSource).
// Sorted measured-first, then by volume.
export function mergedKeywords() {
  const map = new Map();
  for (const k of getKeywords()) {
    map.set(k.keyword.toLowerCase(), { ...k, source: "file", volumeSource: k.volume != null ? "sheet" : null, estimated: false });
  }
  for (const k of listResearchedKeywords()) {
    const key = String(k.keyword || "").trim().toLowerCase();
    if (!key) continue;
    const prev = map.get(key) || {};
    const measured = MEASURED_SOURCES.has(String(k.source || "").toLowerCase());
    const fills = prev.volume == null && k.volume != null;
    map.set(key, {
      ...prev,
      keyword: prev.keyword || k.keyword,
      volume: fills ? k.volume : prev.volume ?? null,
      volumeSource: fills ? (measured ? "semrush" : "estimate") : prev.volumeSource ?? null,
      estimated: fills ? !measured : !!prev.estimated,
      intent: prev.intent || k.intent || "",
      theme: prev.theme || k.front || k.serviceId || "Researched",
      segment: prev.segment || k.serviceId || "",
      difficulty: prev.difficulty ?? k.difficulty ?? null,
      // Sheet keywords stay "file"; the researcher's own finds are "researched".
      source: prev.source === "file" ? "file" : "researched",
    });
  }
  const rank = (k) => (k.volume == null ? 2 : k.estimated ? 1 : 0);
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || (b.volume || 0) - (a.volume || 0));
}

export function getContentPlan() {
  const keywords = mergedKeywords();

  const enriched = keywords.map((k) => {
    const stage = buyerStage(k.keyword, k.intent);
    const score = priorityScore(k.volume, stage);
    return {
      keyword: k.keyword,
      volume: k.volume,
      intent: k.intent,
      theme: k.theme,
      segment: k.segment,
      difficulty: k.difficulty ?? null,
      source: k.source || "file",
      volumeSource: k.volumeSource || null,
      estimated: !!k.estimated,
      stage,
      contentType: contentType(stage),
      score,
      priority: band(score),
    };
  });

  // Content pillars = themes grouped, ranked by total search volume.
  const pillarMap = {};
  for (const k of enriched) {
    const name = k.theme || k.segment || "Other";
    if (!pillarMap[name]) pillarMap[name] = { name, volume: 0, count: 0, keywords: [] };
    pillarMap[name].volume += k.volume || 0;
    pillarMap[name].count += 1;
    pillarMap[name].keywords.push(k);
  }
  const pillars = Object.values(pillarMap)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 6)
    .map((p) => ({
      name: p.name,
      volume: p.volume,
      count: p.count,
      // top 3 keywords in the pillar by score
      top: p.keywords.sort((a, b) => b.score - a.score).slice(0, 3).map((k) => k.keyword),
    }));

  const prioritized = enriched.sort((a, b) => b.score - a.score);

  const stageCounts = enriched.reduce((acc, k) => {
    acc[k.stage] = (acc[k.stage] || 0) + 1;
    return acc;
  }, {});

  return { total: enriched.length, pillars, prioritized, stageCounts, sheetDate: keywordSheetDate() };
}
