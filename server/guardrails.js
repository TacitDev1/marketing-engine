// Output guardrails — a cleanup pass that catches the slips the local 8B model
// makes despite the prompt: hype words Larkwell bans, over-long blog titles/metas,
// and invented client names. Mechanical and conservative: we only fix things we
// can fix safely, and FLAG (don't silently alter) anything judgement-heavy.

import { company, knownClients } from "../src/lib/company.js";
import { SELF_NAMES, SELF_RE_SOURCE, linkHosts, linkedinPath } from "./config.js";

// Hype words Larkwell's voice rule bans -> plain replacements. Whole-word, case-
// preserving for the first letter. Kept tight so we don't mangle real meaning.
const BANNED = [
  ["seamlessly", "smoothly"],
  ["seamless", "smooth"],
  ["revolutionize", "improve"],
  ["revolutionise", "improve"],
  ["revolutionary", "significant"],
  ["game-changer", "major shift"],
  ["game changer", "major shift"],
  ["game-changing", "significant"],
  ["unleash", "enable"],
  ["supercharge", "speed up"],
  ["next-gen", "modern"],
  // (not "next generation": "the next generation of S/4HANA tooling" became
  // "the modern of S/4HANA tooling")
  ["cutting-edge", "modern"],
  ["cutting edge", "modern"],
  ["state-of-the-art", "modern"],
  ["elevate", "improve"],
  ["empower", "help"],
  ["paradigm shift", "shift"],
  ["best-in-class", "strong"],
  ["world-class", "strong"],
];

// Em/en dashes (and the horizontal bar) are the #1 "written by AI" tell and Larkwell
// bans them. Replace with a spaced hyphen. Returns { text, had }.
export function scrubDashes(input) {
  const before = String(input || "");
  const text = before.replace(/\s*[—–―]\s*/g, " - ");
  return { text, had: text !== before };
}

function preserveCase(replacement, original) {
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// Replace banned words; return { text, replaced: [{from, to}] }.
export function scrubHype(input) {
  let text = String(input || "");
  const replaced = [];
  for (const [bad, good] of BANNED) {
    const re = new RegExp(`\\b${bad.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "gi");
    text = text.replace(re, (m) => {
      replaced.push({ from: m, to: preserveCase(good, m) });
      return preserveCase(good, m);
    });
  }
  return { text, replaced };
}

// Larkwell writes UK English (Mara, 2026-11-02: "Optimizing" next to
// "Standardising" in the same Library). Swap the common US spellings; stems are
// listed explicitly so words like "size", "prize" or "Azure" are never touched.
const UK_IZE_STEMS =
  "optimi|organi|priori|prioriti|standardi|moderni|customi|minimi|maximi|recogni|reali|utili|centrali|digitali|monetis|categori|summari|visuali|speciali|capitali|synchroni|authori|operationali|industriali|harmoni|stabili|emphasi|finali|initiali|normali|personali|virtuali|containeri|commerciali|globali|locali|mobili|productisi|productiz|rationali|revolutioni|incentivi|operationali|democrati|memori|apologi|criticis|criti|characteri|familiari|jeopardi|legitimi|mechani|neutrali|penali|strategi|sympathi|tokeni|economi";
const UK_IZE = new RegExp(`\\b(${UK_IZE_STEMS})z(e|ed|es|ing|ation|ations|er|ers)\\b`, "gi");
const UK_WORDS = [
  [/\banalyz(e|ed|es|ing|er|ers)\b/gi, "analys$1"],
  [/\bbehavior(s|al)?\b/gi, "behaviour$1"],
  [/\bcolor(s|ed|ful)?\b/gi, "colour$1"],
  [/\bfavor(s|ed|ite|ites|able)?\b/gi, "favour$1"],
  [/\blabor\b/gi, "labour"],
  [/\bcenter(s)?\b/gi, "centre$1"],
  [/\bcentered\b/gi, "centred"],
  [/\bcatalog(s)?\b/gi, "catalogue$1"],
  [/\bdefense\b/gi, "defence"],
  [/\bmodeling\b/gi, "modelling"],
  [/\bmodeled\b/gi, "modelled"],
  [/\bcanceled\b/gi, "cancelled"],
  [/\bcanceling\b/gi, "cancelling"],
  [/\btraveling\b/gi, "travelling"],
  [/\blabeled\b/gi, "labelled"],
  [/\blabeling\b/gi, "labelling"],
];
function keepCase(from, to) {
  return from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
}
// SAP's own names keep SAP's spelling (SPRO "Customizing", "SQL Optimizer",
// "Plan Visualizer", "Code Analyzer").
const UK_KEEP = new Set(["Customizing", "Optimizer", "Visualizer", "Analyzer"]);
// URLs and Markdown link targets are never touched: larkwell.example's own slugs
// use US spelling (/optimizing-sap-fico-processes) and a "fixed" link is a 404.
const UK_SKIP = /(https?:\/\/[^\s)>\]]+|\]\([^)]*\)|www\.[^\s)>\]]+)/gi;
function scrubUkPart(part, changed) {
  let text = part.replace(UK_IZE, (m, stem, end) => {
    if (UK_KEEP.has(m)) return m;
    changed.push(m);
    return keepCase(m, `${stem}s${end}`.toLowerCase());
  });
  for (const [re, rep] of UK_WORDS) {
    text = text.replace(re, (m) => {
      changed.push(m);
      return keepCase(m, m.replace(new RegExp(re.source, "i"), rep).toLowerCase());
    });
  }
  return text;
}
export function scrubUkSpelling(input) {
  const changed = [];
  const text = String(input || "")
    .split(UK_SKIP)
    .map((part, i) => (i % 2 === 1 ? part : scrubUkPart(part, changed)))
    .join("");
  return { text, changed: [...new Set(changed.map((c) => c.toLowerCase()))] };
}

// Trim an SEO title to <= max chars at a word boundary (default 60). Only trims;
// never invents text. Returns the (possibly shorter) title.
export function fitTitle(title, max = 60) {
  let t = String(title || "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  // Cut at the last word boundary before max, drop trailing punctuation.
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  t = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,:;-]+$/, "");
  // A cut can strand a connector word at the end ("... Recovery Plan for").
  // Dropping it reads like a chosen title instead of a truncated one.
  t = t.replace(/\s+(?:for|and|to|the|with|your|a|an|of|in|on|at|from|by)$/i, "");
  return t;
}

// Trim a meta description to <= 160 chars at a word boundary.
export function fitMeta(meta, max = 160) {
  let m = String(meta || "").trim().replace(/\s+/g, " ");
  if (m.length <= max) return m;
  const cut = m.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,:;-]+$/, "");
}

// Heuristic: flag phrases that read like an invented client/case the model made
// up. We don't remove them (could be legit) — we surface them for review.
const INVENTED_PATTERNS = [
  /\b(?:a|one)\s+(?:leading|major|global|large|prominent|well-known)\s+(?:[a-z]+\s+){0,2}(?:company|enterprise|manufacturer|retailer|bank|firm|organization|organisation|client|customer)\b/gi,
  /\bFortune\s?\d{2,3}\b/gi,
  /\b(?:client|customer)\s+[A-Z]\b/g, // "Client A", "Customer X"
  /\bacme\b/gi,
];

export function findInventedClients(text) {
  const s = String(text || "");
  const hits = new Set();
  for (const re of INVENTED_PATTERNS) {
    for (const m of s.match(re) || []) hits.add(m.trim());
  }
  return [...hits];
}

// Entities that are safe to name even though they're capitalised — they are NOT
// being claimed as Larkwell clients: Larkwell itself, its verified clients, vendors,
// analysts, products, and the regions Larkwell operates in. Anything else named in a
// client-win frame is treated as a suspected fabricated client and FLAGGED for
// review (we never strip a real-looking company name automatically — too risky).
const SAFE_ENTITIES = new Set(
  [
    ...knownClients,
    ...SELF_NAMES, "Global",
    "SAP", "AWS", "Azure", "Microsoft", "Oracle", "Google", "IBM", "Amazon",
    "Gartner", "IDC", "Forrester", "Ariba", "SuccessFactors", "Fiori",
    "NetWeaver", "HANA", "S/4HANA", "S4HANA", "ECC", "BTP", "Basis", "ABAP",
    "Solution Manager", "Concur", "Datasphere",
    ...company.regions, "South Africa", "Netherlands", "Europe", "UK",
    "United States", "US", "EU", "Africa",
  ].map((s) => s.toLowerCase())
);

// Common capitalised sentence-openers that are not company names.
const NOT_A_NAME = new Set(
  [
    "The", "This", "That", "These", "Those", "Our", "Your", "Their", "We", "It",
    "As", "When", "While", "After", "Before", "Today", "Many", "Most", "Some",
    "Every", "All", "If", "Here", "There", "But", "And", "For", "With", "In",
    "On", "At", "A", "An", "One", "Companies", "Businesses", "Organizations",
    "Organisations", "Enterprises", "Customers", "Clients", "Teams", "Leaders",
  ].map((s) => s.toLowerCase())
);

function isSuspectName(raw) {
  const name = String(raw || "").trim().replace(/[’'`]s$/i, "").trim();
  if (!name) return null;
  const low = name.toLowerCase();
  if (SAFE_ENTITIES.has(low)) return null;
  // A multi-word known name followed by more capitalised words ("Brackenfield
  // Waste. Then ...") is still the known name.
  for (const e of SAFE_ENTITIES) if (e.includes(" ") && (low.startsWith(`${e} `) || low.startsWith(`${e}.`))) return null;
  const first = name.split(/\s+/)[0];
  if (NOT_A_NAME.has(first.toLowerCase())) return null;
  // Must start with a capital and not be an all-caps generic acronym we listed.
  if (!/^[A-Z]/.test(name)) return null;
  return name;
}

// Two high-precision frames where the 8B fabricates a NAMED client win:
//   1. "Larkwell Consulting helped/partnered with/worked with <Name>"
//   2. "<Name> achieved/realized/migrated ... Larkwell" (sentence-initial subject,
//      with Larkwell mentioned in the same sentence).
const CLIENT_VERB_AFTER_SELF = new RegExp(
  `\\b${SELF_RE_SOURCE}\\s+(?:helped|helps|help|worked with|partnered with|partnering with|supported|assisted|enabled|guided|migrated|transformed|delivered for|served)\\s+([A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,2})`,
  "g"
);
const SELF_WORD = new RegExp(`\\b${SELF_RE_SOURCE}\\b`, "i");
const NAME_THEN_WIN_VERB =
  /(?:^|[.!?]\s+)([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,2})\s+(?:achieves|achieved|realizes|realized|realised|saw|gained|reduced|cut|improved|transformed|migrated|embarked|modernized|modernised|partnered|streamlined|saved)\b/g;

// FLAG (do not alter) named companies presented as Larkwell clients/wins that are
// not on the verified allowlist. Returns a de-duplicated array of names.
export function findFabricatedClientClaims(text) {
  const s = String(text || "");
  const hits = new Set();
  let m;
  CLIENT_VERB_AFTER_SELF.lastIndex = 0;
  while ((m = CLIENT_VERB_AFTER_SELF.exec(s))) {
    const name = isSuspectName(m[1]);
    if (name) hits.add(name);
  }
  NAME_THEN_WIN_VERB.lastIndex = 0;
  while ((m = NAME_THEN_WIN_VERB.exec(s))) {
    // Only a win claim if the SAME sentence also mentions Larkwell — cut the window
    // at the sentence boundary, or the check bleeds ~200 chars into FOLLOWING
    // sentences and flags "Acme migrated. Larkwell sees this often." falsely
    // (each false positive costs a regeneration, sometimes a dropped draft).
    const idx = m.index + m[0].length;
    let window = s.slice(Math.max(0, m.index), idx + 200);
    const stop = window.slice(m[0].length).search(/[.!?]/);
    if (stop >= 0) window = window.slice(0, m[0].length + stop + 1);
    if (!SELF_WORD.test(window)) continue;
    const name = isSuspectName(m[1]);
    if (name) hits.add(name);
  }
  return [...hits];
}

// Strip fabricated client references, turning them into honest, generic wording.
// Rules are precise so they don't mangle Larkwell's own self-description (Larkwell is a
// consultancy/firm, never a "manufacturer/retailer/bank/client", so those nouns
// are safe to rewrite; generic "company/enterprise" is only rewritten when it
// follows a "helped/worked with" verb, i.e. clearly a client story).
const STRIP_RULES = [
  { re: /\b(?:a\s+)?fortune\s?\d{2,3}(?:\s+(?:company|companies|enterprise|enterprises|firm|business|client|customer))?\b/gi, rep: "large enterprises" },
  // "Client A" / "customer B", but not "the customer I spoke to".
  { re: /\b(?:[Cc]lient|[Cc]ustomer)\s+(?!I\b)[A-Z]\b/g, rep: "a client" },
  { re: /\bacme(?:\s+(?:corp(?:oration)?|inc|co|ltd|industries))?\b/gi, rep: "a client" },
  // "a leading [adj] <client-type noun>" -> "clients" (subject or object position).
  // Only client-type nouns Larkwell would never call itself (avoids self-description hits).
  {
    re: /\b(?:a|an|one)\s+(?:leading|major|global|large|prominent|well[-\s]known|top|renowned|key|notable|prestigious|multinational)\s+(?:[a-z-]+\s+){0,2}(?:manufacturer|retailer|bank|insurer|automaker|distributor|conglomerate|client|customer)s?\b/gi,
    rep: "clients",
  },
  // verb-anchored generic company/organisation -> "<verb> clients"
  {
    re: /\b(helped|help|worked with|partnered with|partnering with|supported|assisted|enabled|guided)\s+(?:a|an|one of|several)\s+(?:(?:leading|major|global|large|prominent|well[-\s]known|top|renowned|key|notable)\s+)?(?:[a-z-]+\s+){0,2}(?:company|companies|enterprise|enterprises|organisation|organization|business|businesses|corporation|brand|brands)\b/gi,
    rep: "$1 clients",
  },
  // "helped/for numerous|many|countless|several clients" -> "organisations" (removes
  // the client-instance framing the success detector trips on).
  {
    re: /\b(helped|help|for|serve|serving|served)\s+(?:numerous|many|countless|several|multiple)\s+clients\b/gi,
    rep: "$1 organisations",
  },
  // generic "a leading/large <industry> company/firm" (subject of a fabricated case
  // study) -> "clients". Industry adjective nouns Larkwell would never call itself.
  {
    re: /\b(?:a|an|one)\s+(?:leading|major|global|large|prominent|well[-\s]known|top|renowned|key|notable|prestigious|multinational|mid[-\s]?sized|mid[-\s]?tier)\s+(?:[a-z-]+\s+){0,2}(?:manufacturing|production|logistics|mining|retail|financial|automotive|industrial|pharmaceutical|chemical|energy|utilities)\s+(?:company|companies|firm|business|businesses|organi[sz]ation|enterprise|enterprises|group)s?\b/gi,
    rep: "clients",
  },
];

export function stripInventedClients(text) {
  let t = String(text || "");
  const stripped = [];
  for (const { re, rep } of STRIP_RULES) {
    t = t.replace(re, (...m) => {
      stripped.push(m[0].trim());
      let out = rep.replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? "");
      // Preserve sentence-initial capitalisation.
      if (/^[A-Z]/.test(m[0])) out = out.charAt(0).toUpperCase() + out.slice(1);
      return out;
    });
  }
  t = t.replace(/\bclients clients\b/gi, "clients").replace(/[ \t]{2,}/g, " ");
  return { text: t, stripped: [...new Set(stripped)] };
}

// Broad client-SUCCESS detector (stricter than findFabricatedClientClaims, which
// only catches NAMED companies). Tobias's rule: the app must NEVER write about a
// client win/outcome unless it comes from Larkwell (a verified win). The local 8B invents
// these constantly — generic client stories ("a leading manufacturer achieved…",
// "our client migrated without downtime") as well as named ones. This flags the
// SUCCESS/OUTCOME framing so autopilot drafts that trip it can be rejected outright.
// General capability language ("Larkwell helps enterprises migrate") does NOT trip it —
// only a specific client instance tied to an outcome.
const CLIENT_SUCCESS_PATTERNS = [
  // a specific (even un-named) client instance — the classic fabricated case study
  // Industry nouns Larkwell never calls itself: the instance alone is the tell.
  /\b(?:a|an|one)\s+(?:leading|major|global|large|mid[-\s]?sized|mid[-\s]?tier|prominent|multinational|top|well[-\s]known|renowned|key|notable|prestigious)\s+(?:[a-z-]+\s+){0,3}(?:manufacturer|producer|retailer|bank|insurer|distributor|conglomerate|automaker|steelmaker|steel|oil|gas|food|mining|logistics|utility|utilities|multinational)\b/gi,
  // Generic nouns ("a large enterprise") are ordinary capability language
  // ("running SAP for a large enterprise means…"); only a hit with an outcome
  // verb in the same clause is a client story.
  /\b(?:a|an|one)\s+(?:leading|major|global|large|mid[-\s]?sized|mid[-\s]?tier|prominent|multinational|top|well[-\s]known|renowned|key|notable|prestigious)\s+(?:[a-z-]+\s+){0,3}(?:company|companies|enterprise|business|businesses|firm|organi[sz]ation)\b[^.!?]{0,90}?\b(?:achiev|migrated|reduced|cut\b|saved|delivered|transitioned|moderni[sz]ed|realiz|realis|implemented|succeeded|transformed|streamlined|avoided)/gi,
  // "our/a client … <outcome verb>" within the same clause
  /\b(?:our|a|an|one of our|one of my)\s+clients?\b[^.!?]{0,90}?\b(?:achiev|migrat|reduc|cut|saved?|deliver|transition|moderni[sz]|navigat|realiz|realis|implement|succeed|success|transform|streamlin|avoid)/gi,
  /\bhelped\s+(?:a|an|one|several|many|numerous|countless)\b[^.!?]{0,90}?\b(?:migrate|migrated|achieve|achieved|reduce|reduced|cut|save|saved|deliver|delivered|transition|transitioned|moderni[sz]e|moderni[sz]ed|navigate|navigated|avoid|avoided|transform|transformed)\b/gi,
  /\bsuccessfully\s+(?:migrated|navigated|delivered|transitioned|implemented|deployed|moderni[sz]ed|completed|helped|transformed)\b/gi,
  /\bachieved\s+(?:a\s+)?(?:smooth|significant|seamless|major|substantial|remarkable|notable|\d)/gi,
  // "helped [its/our/their/the] clients <outcome>" — no quantifier word needed
  /\bhelped\s+(?:its\s+|our\s+|their\s+|the\s+)?clients?\b[^.!?]{0,60}?\b(?:migrat|achiev|reduc|cut|save|deliver|transition|moderni[sz]|navigat|transform|streamlin|avoid)/gi,
  // a SPECIFIC (singular) client instance — the tell of a fabricated case study
  /\bour\s+client\b/gi,
  /\bthe\s+client\s+(?:was|is|had|has|now|needed|wanted|faced|faces|is facing|was facing)\b/gi,
  /\b(?:the|our|their)\s+client\s+now\b/gi,
  /\bworked\s+(?:closely\s+)?with\s+(?:them|the\s+client|our\s+client|this\s+client)\b/gi,
  // outcome / result framing of a specific engagement
  /\bthe\s+outcome\s+was\b/gi,
  /\ba\s+successful\s+(?:migration|transition|transformation|implementation|deployment|rollout|project|conversion|go-live)\b/gi,
];

// Does the text ground its client talk in a VERIFIED Larkwell win? (Then it's allowed.)
// Case-sensitive on purpose: a client name must not be grounded by the same
// letters in lower case (an everyday word, a URL slug).
export function isClientSuccessGrounded(text) {
  const s = String(text || "");
  return knownClients.some((c) => new RegExp(`\\b${c.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`).test(s));
}

// Returns the client-success frames found (empty array = clean). Includes named
// fabricated-client hits too, so this is the single check the worker rejects on.
export function detectClientSuccess(text) {
  const s = String(text || "");
  const hits = new Set();
  for (const re of CLIENT_SUCCESS_PATTERNS) {
    re.lastIndex = 0;
    for (const m of s.match(re) || []) hits.add(m.trim());
  }
  for (const n of findFabricatedClientClaims(s)) hits.add(n);
  return [...hits];
}

// ---- "Clean core" positioning detector ----
// Larkwell leadership (2026-07-08): do NOT advocate clean core / keeping custom code
// out of the S/4HANA digital core. This flags the ADVOCACY phrasings (not normal
// custom-code discussion) so the generator regenerates past them.
const CLEAN_CORE_PATTERNS = [
  /\bclean[-\s]core\b/gi,
  /\bkeep(?:ing|s)?\s+the\s+(?:digital\s+)?core\s+clean\b/gi,
  /\b(?:custom code|customi[sz]ations?|logic|extensions?)\b[^.!?]{0,40}?\b(?:out of|off|away from|outside)\s+the\s+(?:digital\s+)?core\b/gi,
  /\b(?:move|moving|keep|keeping|push|pushing|get|getting|shift|shifting)\b[^.!?]{0,40}?\b(?:out of|off|outside)\s+the\s+(?:digital\s+)?core\b/gi,
  /\bside[-\s]by[-\s]side\b[^.!?]{0,40}?\bkeep[^.!?]{0,20}?\bcore\s+clean\b/gi,
];
export function detectCleanCore(text) {
  const s = String(text || "");
  const hits = new Set();
  for (const re of CLEAN_CORE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of s.match(re) || []) hits.add(m.trim());
  }
  return [...hits];
}

// ---- AI-slop detector (Tobias's #1 content rule: only quality ships) ----
// A draft that trips this is regenerated once by the autopilot, then dropped if
// still sloppy (see worker.js). Manual drafts are flagged, not dropped.

// Any one of these = instant slop (the phrases that scream "written by an AI").
const SLOP_HARD = [
  /in today's (?:fast-paced|ever-evolving|ever-changing|digital|competitive|modern|rapidly changing)/i,
  /(?:ever-evolving|ever-changing|fast-paced|rapidly changing) (?:world|landscape|environment|market)/i,
  /\bin a world where\b/i,
  /\bin an era (?:of|where)\b/i,
  /\bdigital (?:landscape|age|era)\b/i,
  /\bdelv(?:e|es|ing)\b/i,
  /navigat(?:e|es|ing) the (?:complexit|challeng|landscape|ever|maze)/i,
  /\bat the end of the day\b/i,
  /\bin conclusion\b/i,
  /it'?s important to (?:note|remember|understand|recognize|recognise)/i,
  /\bwhen it comes to\b/i,
  /\bin the (?:world|realm) of\b/i,
  /\bone thing is clear\b/i,
  /\bthe key (?:takeaway |thing )?is\b/i,
  /\blook no further\b/i,
  /\brest assured\b/i,
];
// Buzzwords / connectives; matched on stems so inflections count (unlock →
// unlocking, leverage → leveraging). 3+ distinct = slop.
const SLOP_SOFT = [
  /\bleverag/i, /\brobust\b/i, /\bseamless/i, /\bcutting[- ]edge\b/i,
  /\bstate[- ]of[- ]the[- ]art\b/i, /\bgame[- ]?chang/i, /\bunlock/i,
  /\belevat/i, /\bempower/i, /\brevolutioni[sz]/i, /\bstreamlin/i,
  /\bsupercharg/i, /\bmoreover\b/i, /\bfurthermore\b/i, /\badditionally\b/i,
  /\bharness/i, /\bpivotal\b/i, /\bmyriad\b/i, /\btestament to\b/i,
  /\bfoster/i, /\bbespoke\b/i, /\bunparalleled\b/i, /\bholistic\b/i,
  /\butili[sz]/i, /\bplethora\b/i, /\btapestry\b/i, /\bbeacon\b/i,
];

// Returns { isSlop, score, hits[] }.
export function detectSlop(text) {
  const s = String(text || "");
  const hard = [];
  for (const re of SLOP_HARD) { const m = s.match(re); if (m) hard.push(m[0].toLowerCase().trim()); }
  const soft = new Set();
  for (const re of SLOP_SOFT) { const m = s.match(re); if (m) soft.add(m[0].toLowerCase().trim()); }
  // Em/en dash — the signature AI tell (should already be scrubbed; caught here
  // as a backstop for any path that reaches detection unscrubbed).
  if (/[—–―]/.test(s)) hard.push("em dash");
  const struct = [];
  // "not just X, but/it's/rather Y" — a flagrant AI tell Larkwell bans, so it counts
  // as instant slop (hard) rather than one soft point.
  if (/\bnot just\b[^.?!]{0,70}\b(?:but|it'?s|it is|rather|instead)\b/i.test(s)) hard.push('"not just X, but Y"');
  // Pain-point QUESTION BARRAGE ("Are you struggling…? Do you worry…?") — a very
  // strong slop tell, so 2+ questions near the top counts as hard.
  const head = s.slice(0, 400);
  const qCount = (head.match(/\?/g) || []).length;
  if (qCount >= 2) hard.push("pain-point question barrage");
  else {
    const firstLine = s.split("\n").map((l) => l.trim()).find(Boolean) || "";
    if (/\?$/.test(firstLine) && firstLine.length < 140) struct.push("rhetorical-question opener");
  }

  const softCount = soft.size + struct.length;
  const isSlop = hard.length >= 1 || softCount >= 3;
  return { isSlop, score: hard.length * 2 + softCount, hits: [...hard, ...soft, ...struct] };
}

// Light, model-free slop scrub: swap the "soft" buzzwords for plain words and
// cut the worst "hard" phrases where it's safe. Conservative and whole-word so
// it can't mangle meaning. Used to edit existing drafts up to the no-slop bar
// without re-running the model (which would just re-introduce slop). Anything
// structural it can't safely fix (rhetorical-question barrage, "not just X but
// Y", a named fabricated client) is left for a human — detectSlop still flags it.
const SLOP_WORD_MAP = [
  ["leveraging", "using"], ["leverages", "uses"], ["leveraged", "used"], ["leverage", "use"],
  ["robust", "reliable"],
  ["unlocking", "opening up"], ["unlocks", "opens up"], ["unlocked", "opened up"], ["unlock", "open up"],
  ["streamlining", "simplifying"], ["streamlines", "simplifies"], ["streamlined", "simplified"], ["streamline", "simplify"],
  ["harnessing", "using"], ["harnesses", "uses"], ["harnessed", "used"], ["harness", "use"],
  ["utilizing", "using"], ["utilizes", "uses"], ["utilized", "used"], ["utilize", "use"],
  ["utilising", "using"], ["utilises", "uses"], ["utilised", "used"], ["utilise", "use"],
  ["moreover", "also"], ["furthermore", "also"], ["additionally", "also"],
  ["utilizations", "uses"], ["utilisations", "uses"], ["utilization", "use"], ["utilisation", "use"],
  ["pivotal", "key"], ["myriad", "many"], ["plethora", "range"],
  ["fostering", "building"], ["fosters", "builds"], ["fostered", "built"], ["foster", "build"],
  ["bespoke", "custom"], ["holistic", "complete"], ["unparalleled", "strong"],
  ["tapestry", "mix"], ["beacon", "example"],
];
const SLOP_PHRASE_MAP = [
  [/\bin conclusion,?\s*/gi, ""],
  [/\bat the end of the day,?\s*/gi, ""],
  [/\bit'?s important to (?:note|remember|understand|recognize|recognise) that\s*/gi, ""],
  [/\bwhen it comes to\b/gi, "for"],
  [/\bdelving into\b/gi, "examining"], [/\bdelves into\b/gi, "examines"], [/\bdelve into\b/gi, "examine"],
  [/\bthe key takeaway is(?: that)?:?\s*/gi, ""],
  [/\bin today'?s [^,.]*?(?:world|landscape|environment|market|era|age),?\s*/gi, ""],
  [/\bin a world where\b\s*/gi, ""],
  [/\brest assured,?\s*/gi, ""],
  [/\blook no further\b[.:]?\s*/gi, ""],
  [/\btestament to\b/gi, "a sign of"],
  [/\bnavigat(?:e|es|ing) the (?:complexit(?:y|ies)|intricacies) of\b/gi, "manage"],
  [/\bnavigat(?:e|es|ing) the (?:challenges|landscape|maze) of\b/gi, "handle"],
  [/\bnavigat(?:e|es|ing) the (?:complexit(?:y|ies)|challenges|landscape|maze|intricacies)\b/gi, "manage this"],
  [/\bthe digital landscape\b/gi, "the SAP market"],
  [/\bdigital landscape\b/gi, "SAP market"],
  [/\bdigital (?:age|era)\b/gi, "SAP market"],
  // Drop the "successfully" success-claim framing (keeps the verb, honest tone).
  [/\bsuccessfully\s+(migrated|navigated|delivered|transitioned|implemented|deployed|moderni[sz]ed|completed|transformed|helped|streamlined)\b/gi, "$1"],
];

export function scrubSlop(input) {
  const before = String(input || "");
  let text = before;
  for (const [re, rep] of SLOP_PHRASE_MAP) text = text.replace(re, rep);
  for (const [bad, good] of SLOP_WORD_MAP) {
    const re = new RegExp(`\\b${bad}\\b`, "gi");
    text = text.replace(re, (m) => preserveCase(good, m));
  }
  // Judge "changed" on the word swaps only: recapitalising is tidying, and a
  // clean draft must not get a "Cleaned AI-slop wording" warning for it.
  const swapped = text !== before;
  // Recapitalise after a dropped leading phrase (never after e.g. / i.e. / vs.),
  // and tidy whitespace.
  text = text.replace(/^(\s*)([a-z])/, (_, s, c) => s + c.toUpperCase());
  text = text.replace(/(?<!\b(?:e\.g|i\.e|vs|etc|approx|incl|cf|no))([.!?]\s+)([a-z])/gi, (m, p, c) => (/[a-z]/.test(c) ? p + c.toUpperCase() : m));
  text = text.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n");
  return { text, changed: swapped };
}

// ---------- outbound links ----------
// Mara (2026-09-22): a reaction post ended with a link to a vendor, sending our
// readers to a free trial of someone else's documentation product. Drafts may only
// link to Larkwell's own pages and to SAP itself; every other URL is removed (a markdown
// link keeps its anchor text, a bare URL goes, and a "Source:" label left with
// nothing after it goes too). Placeholder links (example.com) fall out the same way.
// The allowed hosts come from server/config.js: the company site (MKT_SITE_URL),
// plus company.linkHosts or MKT_LINK_ALLOWLIST, plus the company's LinkedIn page.
const hostIs = (host, allowed) => host === allowed || host.endsWith(`.${allowed}`);
const LINK_ALLOW = [
  (u) => linkHosts().some((h) => hostIs(u.hostname.toLowerCase().replace(/^www\./, ""), h.toLowerCase())),
  (u) => {
    const p = linkedinPath();
    return !!p && /(^|\.)linkedin\.com$/i.test(u.hostname) && u.pathname.toLowerCase().startsWith(p.toLowerCase());
  },
];
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return String(url);
  }
};
export function isAllowedLink(url) {
  try {
    const u = new URL(url);
    return LINK_ALLOW.some((ok) => ok(u));
  } catch {
    return false;
  }
}
const URL_RE = /\bhttps?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/gi;
const MD_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
const EMPTY_LABEL_RE = /^\s*(?:[-*•]\s*)?(?:source|sources|read more|learn more|more|link|links|via|reference|references|see|full story|read the full (?:article|story|report))\s*[:\-]?\s*$/i;

export function stripOutboundLinks(input) {
  const removed = [];
  let text = String(input || "").replace(MD_LINK_RE, (m, label, url) => {
    if (isAllowedLink(url)) return m;
    removed.push(hostOf(url));
    return label;
  });
  text = text.replace(URL_RE, (url) => {
    if (isAllowedLink(url)) return url;
    removed.push(hostOf(url));
    return "";
  });
  if (!removed.length) return { text, removed };
  text = text
    .split("\n")
    // Drop a "Source:" style label only when its link was the last thing after
    // it; a "Sources" heading over a list that still has links stays.
    .filter((line, i, arr) => !(EMPTY_LABEL_RE.test(line) && !(arr[i + 1] || "").trim()))
    .filter((line) => !/^\s*[-*•]\s*$/.test(line)) // a bullet whose only content was the link
    .map((line) => line.replace(/\(\s*\)/g, "").replace(/[ \t]+([,.;:!?])/g, "$1").replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, removed: [...new Set(removed)] };
}

// The full clean pipeline for one text field: dashes → hype → slop → invented
// clients → outside links. Order matters (strip invented clients after the slop
// swaps so they can't hide a "helped a leading company" frame).
function cleanField(input) {
  const d = scrubDashes(input);
  const hp = scrubHype(d.text);
  const sl = scrubSlop(hp.text);
  const uk = scrubUkSpelling(sl.text);
  const ic = stripInventedClients(uk.text);
  const ln = stripOutboundLinks(ic.text);
  return { text: ln.text, hadDash: d.had, hype: hp.replaced, slopChanged: sl.changed, uk: uk.changed, stripped: ic.stripped, links: ln.removed };
}

function linkWarning(...fields) {
  const hosts = [...new Set(fields.flatMap((f) => f.links))];
  return hosts.length ? `Removed outside link(s) - we don't send readers to other companies: ${hosts.join(", ")}` : null;
}

// Convenience: clean a LinkedIn-style draft IN PLACE (not just flag), returning
// the cleaned text + warnings + structured flags (slop / fabricated) so the
// generator can decide to regenerate.
export function applyToPost({ hook, body }) {
  const H = cleanField(hook);
  const B = cleanField(body);
  const combined = `${H.text}\n${B.text}`;
  const warnings = [];
  if (H.hadDash || B.hadDash) warnings.push("Removed em dashes.");
  const replaced = [...H.hype, ...B.hype];
  if (replaced.length) {
    warnings.push(`Softened hype wording: ${[...new Set(replaced.map((r) => r.from.toLowerCase()))].join(", ")}`);
  }
  if (H.slopChanged || B.slopChanged) warnings.push("Cleaned AI-slop wording.");
  if (H.uk.length || B.uk.length) warnings.push("Switched to UK spelling.");
  const stripped = [...new Set([...H.stripped, ...B.stripped])];
  if (stripped.length) warnings.push(`Rewrote invented client reference(s): ${stripped.join(", ")}`);
  const links = linkWarning(H, B);
  if (links) warnings.push(links);
  const fabricated = findFabricatedClientClaims(combined);
  if (fabricated.length) warnings.push(`Unverified named client - check before posting: ${fabricated.join(", ")}`);
  const clientSuccess = isClientSuccessGrounded(combined) ? [] : detectClientSuccess(combined);
  if (clientSuccess.length) {
    warnings.push(`Unverified client-success framing - keep it general: ${clientSuccess.slice(0, 3).join(", ")}`);
  }
  const cleanCore = detectCleanCore(combined);
  if (cleanCore.length) warnings.push(`Pushes "clean core" (Larkwell goes the opposite way) - rewrite: ${cleanCore.slice(0, 3).join(", ")}`);
  const slop = detectSlop(combined);
  if (slop.isSlop) warnings.push(`Still reads AI-ish - tighten before posting: ${slop.hits.slice(0, 5).join(", ")}`);
  return { hook: H.text, body: B.text, warnings, slop: slop.isSlop, slopHits: slop.hits, fabricated, clientSuccess, cleanCore };
}

// Convenience: clean a blog draft, fitting title/meta and returning flags.
export function applyToBlog({ title, metaDescription, body }) {
  const T = cleanField(title);
  const M = cleanField(metaDescription);
  const Bd = cleanField(body);
  const fittedTitle = fitTitle(T.text);
  const fittedMeta = fitMeta(M.text);
  const combined = `${fittedTitle}\n${Bd.text}`;
  const warnings = [];
  if (T.hadDash || M.hadDash || Bd.hadDash) warnings.push("Removed em dashes.");
  if (T.slopChanged || M.slopChanged || Bd.slopChanged) warnings.push("Cleaned AI-slop wording.");
  if (T.uk.length || M.uk.length || Bd.uk.length) warnings.push("Switched to UK spelling.");
  // A title that had to be cut is usually cut mid-phrase ("...: A Cost-Effective").
  // Callers that can regenerate (the session critic) use titleCut to ask for a
  // new title instead of shipping the stump.
  const titleCut = fittedTitle.length !== T.text.trim().replace(/\s+/g, " ").length;
  if (titleCut) warnings.push("Trimmed the title to fit 60 characters.");
  if (fittedMeta.length < 140) warnings.push(`Meta is short (${fittedMeta.length} chars) - consider expanding to 140-160.`);
  const stripped = [...new Set([...T.stripped, ...M.stripped, ...Bd.stripped])];
  if (stripped.length) warnings.push(`Rewrote invented client reference(s): ${stripped.join(", ")}`);
  const links = linkWarning(T, M, Bd);
  if (links) warnings.push(links);
  const fabricated = findFabricatedClientClaims(combined);
  if (fabricated.length) warnings.push(`Unverified named client - check before posting: ${fabricated.join(", ")}`);
  const clientSuccess = isClientSuccessGrounded(combined) ? [] : detectClientSuccess(combined);
  if (clientSuccess.length) {
    warnings.push(`Unverified client-success framing - keep it general: ${clientSuccess.slice(0, 3).join(", ")}`);
  }
  const cleanCore = detectCleanCore(combined);
  if (cleanCore.length) warnings.push(`Pushes "clean core" (Larkwell goes the opposite way) - rewrite: ${cleanCore.slice(0, 3).join(", ")}`);
  const slop = detectSlop(combined);
  if (slop.isSlop) warnings.push(`Still reads AI-ish - tighten before posting: ${slop.hits.slice(0, 5).join(", ")}`);
  return { title: fittedTitle, metaDescription: fittedMeta, body: Bd.text, warnings, titleCut, slop: slop.isSlop, slopHits: slop.hits, fabricated, clientSuccess, cleanCore };
}
