// The LLM-Wiki — an AI-maintained knowledge base (Karpathy's pattern).
//
// Instead of re-reading raw files on every query (classic RAG), the local model
// maintains a living wiki of interconnected markdown pages under wiki/. Raw
// sources (the knowledge folder, web articles) stay immutable; the wiki is the
// model-written, cross-referenced layer on top.
//
//   ingest(source)  -> model reads it, writes/updates 1-3 wiki pages + links
//   query(question) -> model answers from the relevant wiki pages (not raw docs)
//   lint()          -> model flags stale claims, contradictions, orphans, gaps
//
// Everything is local. Pages are plain markdown with YAML front-matter, so they
// stay readable and editable by hand. ref: gist.github.com/karpathy/442a6bf...

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatJSON, clean } from "./brain.js";
import { searchKnowledge } from "./knowledge.js";
import { embedAvailable, embed, embedBatch, rankByVector, cosine } from "./embeddings.js";
import { SELF_RE_SOURCE } from "./config.js";
const SELF_WORD_RE = new RegExp(`\\b${SELF_RE_SOURCE}\\b`, "i");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIKI_DIR = path.resolve(__dirname, "../wiki");
const VECTORS_FILE = path.join(WIKI_DIR, ".vectors.json");

const PAGE_TYPES = ["topic", "service", "competitor", "campaign", "audience", "concept"];

// ---------- disk helpers ----------

function ensureDir() {
  if (!fs.existsSync(WIKI_DIR)) fs.mkdirSync(WIKI_DIR, { recursive: true });
}

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";

function pagePath(slug) {
  return path.join(WIKI_DIR, `${slug}.md`);
}

// Parse a page file into { slug, title, type, updated, sources, links, summary, body }.
function parsePage(file) {
  const raw = fs.readFileSync(file, "utf8");
  const slug = path.basename(file, ".md");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  let body = raw;
  if (fm) {
    body = fm[2].trim();
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^([a-zA-Z]+):\s*(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        val = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        val = val.replace(/^["']|["']$/g, "");
      }
      meta[m[1]] = val;
    }
  }
  const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => slugify(m[1]));
  const summary = meta.summary || body.split("\n").find((l) => l.trim())?.slice(0, 200) || "";
  return {
    slug,
    title: meta.title || slug,
    type: meta.type || "topic",
    updated: meta.updated || "",
    sources: Array.isArray(meta.sources) ? meta.sources : meta.sources ? [meta.sources] : [],
    summary,
    links,
    body,
  };
}

// Cached on the .md files' mtimes so the many callers (Second Brain screens,
// graphData, research context, worker ticks) don't re-read + re-parse every
// page on every call. savePage/deletePage change a file's mtime, so the
// signature self-invalidates without wiring invalidation into the writers.
let PAGES_CACHE = null; // { sig, pages }
export function listPages() {
  ensureDir();
  const names = fs
    .readdirSync(WIKI_DIR)
    .filter((f) => f.endsWith(".md") && f !== "CLAUDE.md");
  const sig = names
    .map((f) => {
      try {
        return `${f}:${fs.statSync(path.join(WIKI_DIR, f)).mtimeMs}`;
      } catch {
        return f;
      }
    })
    .join("|");
  if (PAGES_CACHE && PAGES_CACHE.sig === sig) return PAGES_CACHE.pages;
  const pages = names
    .map((f) => parsePage(path.join(WIKI_DIR, f)))
    .sort((a, b) => a.title.localeCompare(b.title));
  PAGES_CACHE = { sig, pages };
  return pages;
}

export function getPage(slug) {
  const file = pagePath(slugify(slug));
  if (!fs.existsSync(file)) return null;
  return parsePage(file);
}

// Write one page to disk as markdown + front-matter. `nowISO` keeps the module
// pure (no Date.now()); the caller stamps the time.
function writePage({ slug, title, type, summary, body, sources = [] }, nowISO) {
  ensureDir();
  const s = slugify(slug || title);
  const fm = [
    "---",
    `title: ${JSON.stringify(title || s)}`,
    `type: ${PAGE_TYPES.includes(type) ? type : "topic"}`,
    `updated: ${nowISO}`,
    summary ? `summary: ${JSON.stringify(clean(summary))}` : null,
    sources.length ? `sources: [${sources.map((x) => JSON.stringify(x)).join(", ")}]` : null,
    "---",
    "",
    clean(body || "").trim(),
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
  fs.writeFileSync(pagePath(s), fm);
  invalidateVectors();
  return s;
}

export function deletePage(slug) {
  const file = pagePath(slugify(slug));
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    invalidateVectors();
    return true;
  }
  return false;
}

// Save hand-edits to a page (from the Second Brain editor). Reuses writePage.
export function savePage({ slug, title, type, summary, body, sources = [] }, nowISO) {
  const written = writePage({ slug: slug || title, title, type, summary, body, sources }, nowISO);
  return getPage(written);
}

// ---------- page-level semantic retrieval ----------

let VECTORS = null; // { sig, slugs, vectors }
function pagesSignature(pages) {
  return pages.map((p) => `${p.slug}:${p.body.length}:${p.updated}`).sort().join("|");
}
// Cheap "has anything changed?" fingerprint for the Librarian — lets it skip a
// whole pass (embeddings + a lint model call) when the wiki is untouched.
export function wikiSignature() {
  return pagesSignature(listPages());
}
function invalidateVectors() {
  VECTORS = null;
}

// Per-page vector cache. The old cache was all-or-nothing: ONE page write
// invalidated everything and the next lookup re-embedded all 235+ pages — the
// Librarian's merge loop paid that up to 15 times per pass (thousands of
// wasted embedding calls, the app's single largest compute sink). Now each
// page keeps its own vector keyed by content; only changed pages re-embed.
// Vectors are aligned to pages BY SLUG (not position), which also fixes a
// latent mis-alignment if the page ordering ever changed under a same signature.
const pageKey = (p) => `${p.slug}:${p.body.length}:${p.updated}`;

async function ensurePageVectors(pages) {
  const sig = pagesSignature(pages);
  if (VECTORS && VECTORS.sig === sig) return VECTORS;
  let entries = {};
  if (fs.existsSync(VECTORS_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(VECTORS_FILE, "utf8"));
      if (cached.entries) {
        entries = cached.entries;
      } else if (cached.slugs && cached.vectors) {
        // one-time migration from the old positional shape
        cached.slugs.forEach((s, i) => {
          const p = pages.find((x) => x.slug === s);
          if (p && cached.vectors[i]) entries[s] = { key: pageKey(p), v: cached.vectors[i] };
        });
      }
    } catch {
      /* rebuild */
    }
  }
  const missing = pages.filter((p) => entries[p.slug]?.key !== pageKey(p));
  if (missing.length) {
    const newVecs = await embedBatch(missing.map((p) => `${p.title}\n${p.summary}\n${p.body}`));
    missing.forEach((p, i) => {
      entries[p.slug] = { key: pageKey(p), v: newVecs[i] };
    });
  }
  // Forget deleted pages so the cache file doesn't grow forever.
  const live = new Set(pages.map((p) => p.slug));
  for (const s of Object.keys(entries)) if (!live.has(s)) delete entries[s];
  VECTORS = { sig, slugs: pages.map((p) => p.slug), vectors: pages.map((p) => entries[p.slug].v), entries };
  try {
    fs.writeFileSync(VECTORS_FILE, JSON.stringify({ entries }));
  } catch {
    /* best-effort */
  }
  return VECTORS;
}

// Find the wiki pages most relevant to `text`. Semantic if available, else a
// title/word-overlap fallback.
export async function relevantPages(text, n = 4) {
  const pages = listPages();
  if (!pages.length) return [];
  if (await embedAvailable()) {
    try {
      const { vectors } = await ensurePageVectors(pages);
      const qVec = await embed(text);
      return rankByVector(qVec, pages, vectors, n).filter((p) => p.score > 0.2);
    } catch {
      /* fall through */
    }
  }
  const q = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  return pages
    .map((p) => {
      const words = `${p.title} ${p.summary}`.toLowerCase().split(/[^a-z0-9]+/);
      const score = words.filter((w) => q.has(w)).length;
      return { ...p, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// ---------- the schema page (CLAUDE.md) ----------

const SCHEMA_DOC = `# Marketing Engine Wiki — maintainer guide

This is an **LLM-maintained knowledge base** for Larkwell Consulting's marketing, built on
Andrej Karpathy's "LLM wiki" pattern. Raw sources (the knowledge folder,
web articles, published LinkedIn posts) are immutable. This wiki is the curated,
cross-referenced layer the model writes and keeps current on top of them.

## Pages
Each page is one markdown file with front-matter:
\`\`\`
---
title: SAP S/4HANA Migration
type: topic        # topic | service | competitor | campaign | audience | concept
updated: <iso date>
summary: one-line gist used for retrieval and indexes
sources: ["file or url it was derived from"]
---
Body in markdown. Link related pages with [[Other Page Title]].
\`\`\`

## Principles
- One page per durable entity or concept. Keep pages focused and < ~400 words.
- Prefer updating an existing page over creating a near-duplicate.
- Cross-link generously with [[wiki links]] so the graph stays connected.
- Record marketing intelligence (themes, positioning, proof angles, terminology,
  audience pains, competitor notes) — NOT raw metrics dumps. Never invent facts.
- Stay in Larkwell's voice: plain, senior, specific. No hype words, no em dashes.

## Operations (run by the app)
- **Ingest**: read a new source once, write/update the few pages it touches.
- **Query**: answer from existing pages, not by re-reading raw sources.
- **Lint**: flag stale claims, contradictions, orphan pages, and missing links.
`;

export function ensureSchema(nowISO) {
  ensureDir();
  const p = path.join(WIKI_DIR, "CLAUDE.md");
  if (!fs.existsSync(p)) fs.writeFileSync(p, SCHEMA_DOC);
  return p;
}

// ---------- ingest ----------

const INGEST_FORMAT = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          type: { type: "string", enum: PAGE_TYPES },
          action: { type: "string", enum: ["create", "update"] },
          summary: { type: "string" },
          body: { type: "string" },
        },
        required: ["title", "type", "summary", "body"],
      },
    },
  },
  required: ["pages"],
};

// Ingest a chunk of source text: the model decides which 1-3 wiki pages to
// create or update, grounded by the existing page index + any related pages.
// A new page from a Researcher finding defaults to "concept": findings are
// marketing intelligence (market facts, buyer pains, competitor notes), not Larkwell
// offerings. Only keep "service" when the page actually names Larkwell as the provider
// (several findings wrongly landed as "service" on 2026-09-07).
function resolveNewPageType(pg) {
  if (pg.type === "service" && !SELF_WORD_RE.test(`${pg.title || ""} ${pg.body || ""}`)) return "concept";
  return pg.type || "concept";
}

export async function ingestText({ text, sourceLabel = "source", nowISO }) {
  ensureSchema(nowISO);
  const existing = listPages();
  const related = await relevantPages(text, 6);

  const system = [
    "You maintain Larkwell Consulting's marketing knowledge wiki (an LLM-maintained wiki).",
    "Larkwell Consulting: SAP technical and functional consulting, plus cloud, for enterprises",
    "modernising and migrating SAP. Voice: plain, senior, specific. No hype, no em dashes.",
    "",
    "Given a NEW SOURCE, decide which wiki pages to create or update. Rules:",
    "- Touch only the 1 to 3 pages this source genuinely informs.",
    "- UPDATING beats creating. If a RELATED page below covers the same subject, you",
    "  MUST update it (reuse its exact title and fold the new material into its body).",
    "  Creating a new page whose title overlaps an existing one is an ERROR — 'X vs Y'",
    "  and 'Y vs X' are the same page; 'X Options' belongs inside 'X'. A new page is",
    "  only justified for a genuinely new subject, and then it must stand alone as a",
    "  substantial note, not a stub.",
    "- Each page: a focused topic/service/competitor/audience/concept, under ~350 words.",
    "- TYPE: use 'service' ONLY for a page describing an offering Larkwell itself provides.",
    "  Market facts, trends, buyer pains, competitor notes and general SAP concepts are 'concept'.",
    "- Capture durable marketing intelligence: positioning, themes, buyer pains, proof",
    "  angles, terminology, competitor notes. Do NOT dump raw metrics or invent facts.",
    "- In each body, link related pages with [[Page Title]] (use existing titles when apt).",
    "",
    "Return ONLY JSON: { pages: [ { title, type, action, summary, body } ] }.",
  ].join("\n");

  // Index = titles only. With 200+ pages, per-page summaries blew the 8k
  // context window and the JSON reply got truncated mid-string (findings were
  // filed but silently never reached the wiki). Titles alone are enough for
  // dedupe/reuse; the RELATED pages below carry full bodies for updating.
  const index = existing
    .slice()
    .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")))
    .slice(0, 250);
  const user = [
    `EXISTING WIKI PAGE TITLES (reuse an exact title to update instead of duplicating):`,
    // Byte-capped, not just item-capped: 250 model-written titles can still be
    // thousands of tokens, and a silently truncated prompt loses the SYSTEM
    // rules first — the exact failure mode this prompt already survived once.
    index.length ? index.map((p) => `- ${p.title} (${p.type})`).join("\n").slice(0, 6000) : "(none yet)",
    "",
    related.length ? `MOST RELATED PAGES (full body, to update rather than duplicate):` : "",
    // 1400 chars (was 800): an "update" is only accepted below when the new body
    // keeps >=70% of the old one, so the model must SEE most of the page.
    ...related.map((p) => `### ${p.title}\n${p.body.slice(0, 1400)}`),
    "",
    `NEW SOURCE (from: ${sourceLabel}):`,
    String(text).slice(0, 4500),
    "",
    "Decide the page create/update set now as JSON.",
  ].join("\n");

  // One retry: the 8B occasionally truncates long multi-page JSON; a second
  // attempt with more output room almost always lands.
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let out;
  try {
    out = await chatJSON(messages, INGEST_FORMAT, { numPredict: 2000 });
  } catch (err) {
    console.error("wiki ingest: first attempt failed, retrying once:", err.message);
    out = await chatJSON(messages, INGEST_FORMAT, { numPredict: 2600 });
  }

  const written = [];
  const skipped = [];
  const relatedSlugs = new Set(related.map((p) => p.slug));
  for (const pg of out.pages || []) {
    if (!pg.title || !pg.body) continue;
    const slug = slugify(pg.title);
    const existingPage = getPage(slug);
    let title = clean(pg.title);
    let sources = [sourceLabel];
    if (existingPage) {
      // UPDATE GATES — the un-gated twin of the Librarian merge used to let the
      // 8B rewrite a whole hand-curated page from a headline and drop its
      // sources. (1) Only pages the model saw in full (RELATED) may be updated;
      // a title it only saw in the index gets skipped, not overwritten blind.
      if (!relatedSlugs.has(existingPage.slug)) {
        skipped.push({ slug, title: existingPage.title, reason: "page not shown in full" });
        continue;
      }
      // (2) Updating must KEEP content: refuse a body under 70% of the old one.
      const minLen = Math.floor(0.7 * String(existingPage.body || "").length);
      if (String(pg.body).length < minLen) {
        skipped.push({ slug, title: existingPage.title, reason: `too short (${String(pg.body).length} < ${minLen} chars)` });
        continue;
      }
      // (3) Sources accumulate; the title stays so [[links]] keep resolving.
      sources = [...new Set([...(existingPage.sources || []), sourceLabel])];
      title = existingPage.title;
    }
    writePage(
      {
        slug,
        title,
        // Existing pages keep their type (never let ingest retype them); new pages
        // resolve through the finding-type guard above.
        type: existingPage ? existingPage.type || pg.type : resolveNewPageType(pg),
        summary: pg.summary,
        body: pg.body,
        sources,
      },
      nowISO
    );
    written.push({ slug, title, action: existingPage ? "update" : "create" });
  }
  return { written, skipped };
}

// Rewrite every [[fromTitle]] link across the wiki to [[toTitle]] — or to plain
// text when toTitle is null (page deleted). Matched by slug, so punctuation and
// case variants of the title are caught too. A link that would point a page at
// itself becomes plain text. Returns the number of pages rewritten.
export function rewriteLinks(fromTitle, toTitle, nowISO) {
  const from = slugify(fromTitle);
  let n = 0;
  for (const p of listPages()) {
    let changed = false;
    const body = String(p.body || "").replace(/\[\[([^\]]+)\]\]/g, (m, inner) => {
      if (slugify(inner) !== from) return m;
      changed = true;
      if (!toTitle || slugify(toTitle) === p.slug) return inner.trim();
      return `[[${toTitle}]]`;
    });
    if (!changed) continue;
    writePage({ slug: p.slug, title: p.title, type: p.type, summary: p.summary, body, sources: p.sources || [] }, nowISO);
    n++;
  }
  return n;
}

export function unlinkTitle(title, nowISO) {
  return rewriteLinks(title, null, nowISO);
}

// Build the wiki from the ingested knowledge base (the knowledge folder). Groups
// the corpus by source file and ingests a representative sample from each, so the
// wiki gets seeded with real Larkwell marketing intelligence. Returns a running tally.
export async function buildFromKnowledge({ nowISO, perSource = 2, onProgress } = {}) {
  const { buildCorpus } = await import("./knowledge.js");
  const { chunks } = await buildCorpus();
  const bySource = new Map();
  for (const c of chunks) {
    if (!bySource.has(c.source)) bySource.set(c.source, []);
    bySource.get(c.source).push(c);
  }

  const results = [];
  for (const [source, cs] of bySource) {
    // Take the longest few chunks from each file as the most information-dense.
    const top = [...cs].sort((a, b) => b.text.length - a.text.length).slice(0, perSource);
    const text = top.map((c) => `[${c.label}] ${c.text}`).join("\n\n");
    try {
      const { written } = await ingestText({ text, sourceLabel: source, nowISO });
      results.push({ source, written: written.map((w) => w.title) });
      onProgress?.({ source, written });
    } catch (err) {
      results.push({ source, error: err.message });
    }
  }
  return { sources: results.length, results, pages: listPages().length };
}

// ---------- query ----------

const QUERY_FORMAT = {
  type: "object",
  properties: {
    answer: { type: "string" },
    used: { type: "array", items: { type: "string" } },
  },
  required: ["answer"],
};

// Answer a question from the wiki pages (with a raw-knowledge fallback if the
// wiki is empty/thin). Read the wiki, not the raw docs — that is the whole point.
export async function query({ question, nowISO, fileAnswer = false }) {
  const pages = await relevantPages(question, 5);

  let context;
  let usedRaw = false;
  if (pages.length) {
    // Slice bodies — one oversized hand-edited page must not blow the 8k prompt.
    context = pages.map((p) => `### ${p.title} (${p.type})\n${p.body.slice(0, 1200)}`).join("\n\n");
  } else {
    // Cold start: wiki has nothing relevant yet — fall back to raw knowledge.
    const hits = await searchKnowledge(question, 4);
    context = hits.map((h) => `### ${h.source}\n${h.text}`).join("\n\n");
    usedRaw = true;
  }

  const system = [
    "You answer questions for Larkwell Consulting's marketing team from the wiki context below.",
    "Be accurate and concise. If the context does not cover it, say so plainly.",
    "Do not invent facts or metrics. Plain senior voice, no hype, no em dashes.",
    "Return ONLY JSON: { answer, used: [page titles you relied on] }.",
  ].join("\n");
  const user = [
    pages.length ? "WIKI CONTEXT:" : "RAW KNOWLEDGE (wiki was thin on this):",
    context || "(nothing found)",
    "",
    `QUESTION: ${question}`,
    "Answer now as JSON.",
  ].join("\n");

  const out = await chatJSON(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    QUERY_FORMAT,
    { numPredict: 700 }
  );

  const answer = clean(out.answer || "");
  let filed = null;
  if (fileAnswer && answer && !usedRaw) {
    const slug = writePage(
      {
        slug: slugify(`q ${question}`),
        title: clean(question).slice(0, 70),
        type: "concept",
        summary: answer.slice(0, 160),
        body: `${answer}\n\nFiled from a question on ${nowISO}.`,
        sources: ["wiki query"],
      },
      nowISO
    );
    filed = slug;
  }

  return {
    answer,
    used: out.used || pages.map((p) => p.title),
    fromWiki: !usedRaw,
    pagesConsidered: pages.map((p) => p.title),
    filed,
  };
}

// ---------- lint ----------

const LINT_FORMAT = {
  type: "object",
  properties: {
    orphans: { type: "array", items: { type: "string" } },
    stale: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
    missingLinks: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } },
  },
  required: ["orphans", "stale", "contradictions", "missingLinks", "suggestions"],
};

// Health check: orphans we can detect mechanically; the rest the model reasons
// about from the page index.
export async function lint({ nowISO } = {}) {
  const pages = listPages();
  if (!pages.length) return { empty: true };

  // Mechanical: pages nothing links to (and which link nowhere).
  const linkedTo = new Set();
  for (const p of pages) for (const l of p.links) linkedTo.add(l);
  const mechanicalOrphans = pages
    .filter((p) => !linkedTo.has(p.slug) && p.links.length === 0)
    .map((p) => p.title);

  // Orphans are detected mechanically above, so the model skips them and focuses on
  // the reasoning categories. We feed a COMPACT index (title — type only) and cap the
  // output, so the 8B returns small, well-formed JSON instead of a truncated blob
  // (feeding all 221 pages with summaries + link lists overflowed numPredict).
  const system = [
    "You are the linter for Larkwell Consulting's marketing wiki. Orphan pages are already",
    "detected mechanically, so do NOT list orphans. Focus only on: stale (claims likely",
    "outdated), contradictions (pages that disagree), missingLinks (pairs that SHOULD",
    "link but don't), suggestions (high-value pages worth creating).",
    "Reference exact page titles. List AT MOST 8 items per category, each one short",
    'sentence. Return ONLY a JSON object with those four arrays plus an empty "orphans" array.',
  ].join("\n");
  const MAX_INDEX = 160;
  const user = [
    `WIKI PAGES (${pages.length} total${pages.length > MAX_INDEX ? `, showing first ${MAX_INDEX}` : ""}) as "title — type":`,
    pages.slice(0, MAX_INDEX).map((p) => `- ${p.title} — ${p.type}`).join("\n"),
    "",
    nowISO ? `Today is ${String(nowISO).slice(0, 10)} — judge staleness against that.` : "",
    "Report the lint findings now as JSON (at most 8 items per category).",
  ].join("\n");

  let model = { orphans: [], stale: [], contradictions: [], missingLinks: [], suggestions: [] };
  try {
    model = await chatJSON(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      LINT_FORMAT,
      { numPredict: 1200 }
    );
  } catch (err) {
    model.suggestions = [`Lint model call failed: ${err.message}`];
  }

  // Merge mechanical orphans in (deduped).
  const orphans = [...new Set([...(model.orphans || []), ...mechanicalOrphans])];
  return { ...model, orphans, pageCount: pages.length };
}

// ---------- the Librarian: keep the wiki tidy ----------
//
// One conservative maintenance pass: merge the single most-similar near-duplicate
// pair (so the wiki stops sprouting "Technical SEO A/B/C" clones), then cross-link
// one orphan page to its nearest neighbours. Reversible (plain markdown), logged
// by the caller. Runs on the local model.

// Env-overridable (WIKI_MERGE_THRESHOLD) so prod can tune how aggressively pages
// merge without a redeploy. Raised 0.9 -> 0.93 after the 27B over-merged distinct
// cost pages on 2026-09-07.
const MERGE_THRESHOLD = process.env.WIKI_MERGE_THRESHOLD ? Number(process.env.WIKI_MERGE_THRESHOLD) : 0.93;

// `decline` lets the model refuse a merge of two pages that are actually about
// different things. No `required`, so it can return just { decline: true }.
const MERGE_FORMAT = {
  type: "object",
  properties: {
    decline: { type: "boolean" },
    title: { type: "string" },
    type: { type: "string", enum: PAGE_TYPES },
    summary: { type: "string" },
    body: { type: "string" },
  },
};

// Hard-fact tokens a merge must never drop: years, percentages, money, numbers
// with units, and any plain 2+ digit number. Used by the merge fact-guard below.
function factTokens(text) {
  const s = String(text || "");
  const out = new Set();
  for (const m of s.matchAll(/\b(?:19|20)\d{2}\b/g)) out.add(m[0]); // years
  for (const m of s.matchAll(/\d+(?:\.\d+)?%/g)) out.add(m[0]); // percentages
  for (const m of s.matchAll(/[$£€R]\s?\d[\d,]*(?:\.\d+)?[KMB]?/gi)) out.add(m[0]); // money
  for (const m of s.matchAll(/\b\d+(?:\.\d+)?\s?(?:ACU|KB|MB|GB|TB|hrs?|mins?|days?|weeks?|months?|years?)\b/gi)) out.add(m[0]); // number+unit
  for (const m of s.matchAll(/\b\d{2,}\b/g)) out.add(m[0]); // any 2+ digit number
  return out;
}

// Every hard fact present in either input body but missing from the merged body.
// Exported for the merge-guard test. A non-empty result means the "merge" dropped
// facts (it summarised) and must be refused rather than written.
export function missingFacts(mergedBody, bodyA, bodyB) {
  const merged = String(mergedBody || "");
  const facts = new Set([...factTokens(bodyA), ...factTokens(bodyB)]);
  return [...facts].filter((t) => !merged.includes(t));
}

// `seen` = slugs already merged or declined THIS runLibrarian pass. runLibrarian
// keeps one Set for the whole pass and passes it in each call so a page can be
// touched at most once — this is what stops chain merges (A->B then B->C
// flattening three distinct pages into one, as the 27B did on 2026-09-07).
export const APP_RECORD_SOURCE = "Marketing Engine app records";
const isAppRecord = (p) => (p.sources || []).includes(APP_RECORD_SOURCE);

export async function curate(nowISO, seen = new Set()) {
  const pages = listPages();
  if (pages.length < 3 || !(await embedAvailable())) return { action: "none", reason: "too few pages or no embeddings" };

  const { vectors } = await ensurePageVectors(pages);

  // 1) every above-threshold pair, best first. Act on the first mergeable pair;
  // skip pairs touching a page already handled this pass, and try the next-best
  // when the model declines a pair.
  const candidates = [];
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const s = cosine(vectors[i], vectors[j]);
      if (s >= MERGE_THRESHOLD) candidates.push({ i, j, score: s });
    }
  }
  candidates.sort((x, y) => y.score - x.score);

  for (const cand of candidates) {
    const a = pages[cand.i];
    const b = pages[cand.j];
    if (seen.has(a.slug) || seen.has(b.slug)) continue; // no chain merges this pass
    // Pages written from the app's own records (server/wiki-bridge.js) are
    // rewritten in place by code; merging one into another page would lose it.
    if (isAppRecord(a) || isAppRecord(b)) continue;
    // Primary = more links, tiebreak longer body. The other is absorbed.
    const [primary, other] =
      a.links.length > b.links.length || (a.links.length === b.links.length && a.body.length >= b.body.length)
        ? [a, b]
        : [b, a];
    try {
      const merged = await chatJSON(
        [
          {
            role: "system",
            content:
              'Merge two overlapping wiki pages into ONE clean page for Larkwell Consulting\'s marketing wiki. MERGE, do not summarise: every number, date, percentage, product name and source in either page MUST appear verbatim in the result. Drop only exact repetition. Keep all [[wiki links]]. If the two pages are actually about DIFFERENT things, do NOT force a merge - return {"decline": true} instead. Plain senior voice, no hype, no em dashes. Return ONLY JSON: { title, type, summary, body } for a merge, or { "decline": true } to refuse.',
          },
          {
            role: "user",
            content: `PAGE A (keep this title if sensible): ${primary.title}\n${primary.body}\n\nPAGE B: ${other.title}\n${other.body}\n\nProduce the merged page now as JSON, or decline.`,
          },
        ],
        MERGE_FORMAT,
        { numPredict: 900, tier: "quality" }
      );
      // The model judged the pages distinct: mark the pair handled and try the
      // next-best candidate instead of forcing a bad merge.
      if (merged.decline === true) {
        seen.add(primary.slug);
        seen.add(other.slug);
        continue;
      }
      const mergedBody = String(merged.body || "");
      // GATE 1 (length): a merged body under half the larger input means content
      // was summarised away, and the other page is about to be deleted. Refuse.
      if (mergedBody.length < 0.5 * Math.max(primary.body.length, other.body.length)) {
        return { action: "error", detail: `merge of "${primary.title}" refused: result too short (${mergedBody.length} chars) - content would be lost` };
      }
      // GATE 2 (fact preservation): every hard fact (year, %, number, money/unit)
      // from BOTH inputs must survive. The 27B summarised three cost pages into a
      // bullet list with every figure gone and the length gate missed it because
      // the inputs were short. Refuse, and write/delete nothing.
      const dropped = missingFacts(mergedBody, primary.body, other.body);
      if (dropped.length) {
        console.warn(`librarian: merge of "${primary.title}" refused, drops facts: ${dropped.join(", ")}`);
        return { action: "error", detail: `merge of "${primary.title}" refused: drops facts: ${dropped.join(", ")}` };
      }
      // GATE 3 (freshness): either page may have been UPDATED during the model
      // call (worker ingest, hand edit) - a merge built from stale copies would
      // silently erase that update. Abort; the next pass retries fresh.
      const freshPrimary = getPage(primary.slug);
      const freshOther = getPage(other.slug);
      if (!freshPrimary || !freshOther || freshPrimary.updated !== primary.updated || freshOther.updated !== other.updated) {
        return { action: "error", detail: `merge of "${primary.title}" skipped: a page changed mid-merge` };
      }
      // Keep the primary's TITLE and TYPE: [[links]] resolve by title, and the
      // merge model must never RETYPE a page (it silently turned concept pages
      // into service pages on 2026-09-07).
      const slug = writePage(
        {
          slug: primary.slug,
          title: primary.title,
          type: primary.type,
          summary: merged.summary,
          body: mergedBody,
          sources: [...new Set([...(primary.sources || []), ...(other.sources || [])])],
        },
        nowISO
      );
      // Delete the absorbed page AND point every [[link]] at it to the primary.
      // Without this each merge left dangling links behind (44% of all links
      // by 2026-09-02) and the Second Brain graph silently lost edges.
      let relinked = 0;
      if (slug !== other.slug) {
        deletePage(other.slug);
        relinked = rewriteLinks(other.title, primary.title, nowISO);
      }
      seen.add(primary.slug);
      seen.add(other.slug);
      return { action: "merged", detail: `${other.title} -> ${primary.title}${relinked ? ` (${relinked} pages relinked)` : ""}`, score: Number(cand.score.toFixed(2)) };
    } catch (err) {
      return { action: "error", detail: err.message };
    }
  }

  // 2) no merge needed -> cross-link one orphan (no outbound links) to neighbours.
  const orphanIdx = pages.findIndex((p) => p.links.length === 0);
  if (orphanIdx >= 0) {
    const orphan = pages[orphanIdx];
    const neighbours = pages
      .map((p, k) => ({ p, s: k === orphanIdx ? -1 : cosine(vectors[orphanIdx], vectors[k]) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, 2)
      .filter((x) => x.s > 0.5)
      .map((x) => x.p.title);
    if (neighbours.length) {
      const links = neighbours.map((t) => `[[${t}]]`).join(" ");
      // Freshness gate, as for merges: a hand edit made while the vectors were
      // being built must not be overwritten with the stale body.
      const freshOrphan = getPage(orphan.slug);
      if (!freshOrphan || freshOrphan.updated !== orphan.updated) {
        return { action: "error", detail: `linking "${orphan.title}" skipped: the page changed meanwhile` };
      }
      writePage(
        { slug: orphan.slug, title: orphan.title, type: orphan.type, summary: orphan.summary, body: `${orphan.body}\n\nRelated: ${links}`, sources: orphan.sources },
        nowISO
      );
      return { action: "linked", detail: `${orphan.title} -> ${neighbours.join(", ")}` };
    }
  }

  return { action: "none", reason: "tidy" };
}

// Batch version of the Librarian's cross-link step: pull EVERY orphan (a page with
// no outbound [[links]]) into the graph in one pass by appending links to its two
// nearest neighbours by meaning. Embedding-based (no model call) so it's fast and
// reliable, and reversible (plain markdown). The Librarian still trickles in 1/tick;
// this clears the backlog at once.
export async function crosslinkOrphans({ nowISO, max = 500 } = {}) {
  const pages = listPages();
  if (pages.length < 3 || !(await embedAvailable())) {
    return { linked: 0, scanned: 0, remaining: 0, reason: "too few pages or no embeddings" };
  }
  const { vectors } = await ensurePageVectors(pages);
  const orphanIdxs = pages.map((p, i) => (p.links.length === 0 ? i : -1)).filter((i) => i >= 0);
  const details = [];
  let linked = 0;
  for (const idx of orphanIdxs.slice(0, max)) {
    const orphan = pages[idx];
    const neighbours = pages
      .map((p, k) => ({ t: p.title, s: k === idx ? -1 : cosine(vectors[idx], vectors[k]) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 2)
      .filter((x) => x.s > 0.5)
      .map((x) => x.t);
    if (!neighbours.length) continue;
    const links = neighbours.map((t) => `[[${t}]]`).join(" ");
    const freshOrphan = getPage(orphan.slug);
    if (!freshOrphan || freshOrphan.updated !== orphan.updated) continue; // edited meanwhile: next pass
    writePage(
      { slug: orphan.slug, title: orphan.title, type: orphan.type, summary: orphan.summary, body: `${orphan.body}\n\nRelated: ${links}`, sources: orphan.sources },
      nowISO
    );
    linked++;
    details.push(`${orphan.title} -> ${neighbours.join(", ")}`);
  }
  return { linked, scanned: orphanIdxs.length, remaining: orphanIdxs.length - linked, details };
}

// Graph for the Second Brain: nodes = notes, links = explicit [[links]] PLUS
// semantic "related" edges (each note's top few most-similar notes), so the graph
// is meaningful even though the model rarely hand-links. Cached by page signature.
let GRAPH_CACHE = null;
export async function graphData() {
  const pages = listPages();
  const sig = pagesSignature(pages);
  if (GRAPH_CACHE && GRAPH_CACHE.sig === sig) return GRAPH_CACHE.data;

  const idset = new Set(pages.map((p) => p.slug));
  const nodes = pages.map((p) => ({ id: p.slug, label: p.title, type: p.type, deg: 0 }));
  const links = [];
  const seen = new Set();
  const add = (s, t, kind) => {
    if (s === t || !idset.has(s) || !idset.has(t)) return;
    const key = [s, t].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source: s, target: t, kind });
  };

  // explicit links (p.links are already slugs)
  for (const p of pages) for (const l of p.links) add(p.slug, l, "link");

  // semantic related edges (top 3 neighbours above a similarity floor)
  if (pages.length > 1 && (await embedAvailable())) {
    try {
      const { vectors } = await ensurePageVectors(pages);
      for (let i = 0; i < pages.length; i++) {
        const sims = [];
        for (let j = 0; j < pages.length; j++) {
          if (i === j) continue;
          sims.push([j, cosine(vectors[i], vectors[j])]);
        }
        sims.sort((a, b) => b[1] - a[1]);
        for (const [j, s] of sims.slice(0, 3)) if (s > 0.62) add(pages[i].slug, pages[j].slug, "related");
      }
    } catch {
      /* semantic edges optional */
    }
  }

  const deg = {};
  for (const e of links) { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; }
  for (const n of nodes) n.deg = deg[n.id] || 0;

  const data = { nodes, links };
  GRAPH_CACHE = { sig, data };
  return data;
}

export function wikiStatus() {
  const pages = listPages();
  const byType = {};
  for (const p of pages) byType[p.type] = (byType[p.type] || 0) + 1;
  const links = pages.reduce((a, p) => a + p.links.length, 0);
  return { pages: pages.length, byType, links };
}
