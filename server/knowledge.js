// Knowledge ingest — reads the SEO agency's hand-over files (and anything else
// Tobias drops in marketing/knowledge/) into searchable text chunks, so the
// brain can ground drafts in Larkwell's real SEO / content / analytics data.
//
// Pure local: files are parsed on-device, cached to knowledge/.cache.json.
// Supports .docx, .xlsx, .pptx, .csv, .txt, .md. Read-only.
//
// CLI:  node server/knowledge.js            (build + show status)
//       node server/knowledge.js "query"    (build + show top matches)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import XLSX from "xlsx";
import AdmZip from "adm-zip";
import { embedAvailable, embed, embedBatch, rankByVector } from "./embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "../knowledge");
const CACHE_FILE = path.join(KNOWLEDGE_DIR, ".cache.json");
const VECTORS_FILE = path.join(KNOWLEDGE_DIR, ".vectors.json");

const MAX_ROWS_PER_SHEET = 150; // audits have thousands of rows; cap for sanity
const MAX_CHUNK_CHARS = 1200;

const STOPWORDS = new Set(
  ("the a an and or of to in for on with is are be as at by from this that it " +
    "we our you your they their i s4hana sap larkwell will can has have").split(
    " "
  )
);

// ---------- extractors (each returns array of { label, text }) ----------

async function extractDocx(file) {
  const { value } = await mammoth.extractRawText({ path: file });
  return splitParagraphs(value).map((text, i) => ({
    label: `p${i + 1}`,
    text,
  }));
}

function extractXlsx(file) {
  // Read via buffer (XLSX.read) to avoid Node ESM fs-wiring issues with readFile.
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true });
  const out = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    if (!rows.length) continue;
    const capped = rows.slice(0, MAX_ROWS_PER_SHEET);
    const text = capped
      .map((r) => r.map((c) => (c == null ? "" : String(c))).join(" | "))
      .filter((l) => l.trim())
      .join("\n");
    if (text.trim()) {
      const note =
        rows.length > MAX_ROWS_PER_SHEET
          ? ` (showing first ${MAX_ROWS_PER_SHEET} of ${rows.length} rows)`
          : "";
      out.push({ label: `sheet:${name}${note}`, text });
    }
  }
  return out;
}

function extractPptx(file) {
  const zip = new AdmZip(file);
  const out = [];
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNum(a.entryName) - slideNum(b.entryName));
  for (const e of slideEntries) {
    const xml = e.getData().toString("utf8");
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    const text = decodeXml(runs.join(" ")).replace(/\s+/g, " ").trim();
    if (text) out.push({ label: `slide ${slideNum(e.entryName)}`, text });
  }
  return out;
}

function extractPlain(file) {
  const text = fs.readFileSync(file, "utf8");
  return splitParagraphs(text).map((t, i) => ({ label: `block${i + 1}`, text: t }));
}

// ---------- helpers ----------

const slideNum = (n) => parseInt(n.match(/slide(\d+)\.xml/)[1], 10);
const decodeXml = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 25)
    .flatMap((p) =>
      p.length <= MAX_CHUNK_CHARS ? [p] : chunkString(p, MAX_CHUNK_CHARS)
    );
}

function chunkString(s, size) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function tokenize(s) {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// ---------- corpus build (with mtime cache) ----------

function listFiles() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
  return fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((f) => !f.startsWith("."))
    .filter((f) => /\.(docx|xlsx|pptx|csv|txt|md)$/i.test(f))
    .map((f) => path.join(KNOWLEDGE_DIR, f));
}

function signature(files) {
  return files
    .map((f) => `${path.basename(f)}:${fs.statSync(f).mtimeMs}`)
    .sort()
    .join("|");
}

let CORPUS = null; // { sig, chunks: [{ source, label, text }] }

export async function buildCorpus({ force = false } = {}) {
  const files = listFiles();
  const sig = signature(files);

  if (!force && CORPUS && CORPUS.sig === sig) return CORPUS;

  if (!force && fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      if (cached.sig === sig) {
        CORPUS = cached;
        return CORPUS;
      }
    } catch {
      /* rebuild */
    }
  }

  const chunks = [];
  for (const file of files) {
    const base = path.basename(file);
    const ext = path.extname(file).toLowerCase();
    try {
      let parts = [];
      if (ext === ".docx") parts = await extractDocx(file);
      else if (ext === ".xlsx") parts = extractXlsx(file);
      else if (ext === ".pptx") parts = extractPptx(file);
      else parts = extractPlain(file);
      for (const p of parts) {
        chunks.push({ source: base, label: p.label, text: p.text });
      }
    } catch (err) {
      console.error(`knowledge: failed to parse ${base}: ${err.message}`);
    }
  }

  CORPUS = { sig, chunks };
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(CORPUS));
  } catch {
    /* cache is best-effort */
  }
  return CORPUS;
}

// ---------- retrieval ----------
//
// searchKnowledge() prefers SEMANTIC search (embeddings — matches on meaning)
// and falls back to keyword-overlap scoring if the embed model isn't installed.
// Both return the same shape: [{ source, label, text }].

export async function searchKnowledge(query, n = 5) {
  const { chunks } = await buildCorpus();
  if (!chunks.length) return [];

  if (await embedAvailable()) {
    try {
      return await searchSemantic(query, chunks, n);
    } catch (err) {
      console.error("knowledge: semantic search failed, using keywords:", err.message);
    }
  }
  return searchKeyword(query, chunks, n);
}

// Keyword-overlap scoring (the original, kept as a no-dependency fallback).
function searchKeyword(query, chunks, n) {
  const qTerms = new Set(tokenize(query));
  if (!qTerms.size) return [];

  const scored = chunks.map((c) => {
    const terms = tokenize(c.text);
    let hits = 0;
    for (const t of terms) if (qTerms.has(t)) hits++;
    const score = hits / Math.sqrt(terms.length + 1);
    return { ...c, score, hits };
  });

  return scored
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((c) => ({ source: c.source, label: c.label, text: c.text.slice(0, 600) }));
}

// Semantic search: embed every chunk once (cached on disk by corpus signature),
// embed the query, rank by cosine similarity.
async function searchSemantic(query, chunks, n) {
  const vectors = await ensureVectors(chunks);
  const qVec = await embed(query);
  return rankByVector(qVec, chunks, vectors, n).map((c) => ({
    source: c.source,
    label: c.label,
    text: c.text.slice(0, 600),
  }));
}

let VECTORS = null; // { sig, vectors: number[][] }

// Build (or load from cache) one embedding per corpus chunk. Rebuilds whenever
// the corpus signature changes (a file was added/edited/removed).
async function ensureVectors(chunks) {
  const { sig } = CORPUS;
  if (VECTORS && VECTORS.sig === sig) return VECTORS.vectors;

  if (fs.existsSync(VECTORS_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(VECTORS_FILE, "utf8"));
      if (cached.sig === sig && cached.vectors?.length === chunks.length) {
        VECTORS = cached;
        return VECTORS.vectors;
      }
    } catch {
      /* rebuild */
    }
  }

  const vectors = await embedBatch(chunks.map((c) => `${c.source}\n${c.text}`));
  VECTORS = { sig, vectors };
  try {
    fs.writeFileSync(VECTORS_FILE, JSON.stringify(VECTORS));
  } catch {
    /* cache is best-effort */
  }
  return vectors;
}

// Pull structured target keywords from the Keyword Research workbook so the
// Blogs/SEO screens can offer Tobias real keywords (with volumes) to target.
// Cached on the source files' mtime+size so hot paths (Blogs/SEO/researcher
// loop) don't re-parse the whole XLSX every call.
let KEYWORDS_CACHE = null; // { sig, rows }
// When the keyword-research sheet's volumes were pulled, so screens can say how
// old they are. NOT the file's mtime: on the server that is the git-pull date.
// Set this to the month the keyword sheet in knowledge/ was pulled. Update it
// when a new sheet is dropped in.
const KEYWORD_SHEET_DATE = "2026-04";
export function keywordSheetDate() {
  if (KEYWORD_SHEET_DATE) return KEYWORD_SHEET_DATE;
  let newest = 0;
  for (const f of listFiles().filter((f) => /keyword research/i.test(path.basename(f)))) {
    try {
      newest = Math.max(newest, fs.statSync(f).mtimeMs);
    } catch {
      /* skip */
    }
  }
  return newest ? new Date(newest).toISOString().slice(0, 7) : null;
}

export function getKeywords() {
  const files = listFiles().filter((f) => /keyword research/i.test(path.basename(f)));
  if (!files.length) return [];
  const sig = files
    .map((f) => {
      try {
        const st = fs.statSync(f);
        return `${f}:${st.mtimeMs}:${st.size}`;
      } catch {
        return f;
      }
    })
    .join("|");
  if (KEYWORDS_CACHE && KEYWORDS_CACHE.sig === sig) return KEYWORDS_CACHE.rows;
  const out = [];
  const seen = new Set();
  for (const file of files) {
    let wb;
    try {
      wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
    } catch {
      continue;
    }
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
      for (const r of rows) {
        // Tolerant column matching (KEYWORD / Search Volume / Intent / Theme / Segment).
        const get = (re) => {
          const k = Object.keys(r).find((key) => re.test(key));
          return k ? String(r[k]).trim() : "";
        };
        const keyword = get(/keyword/i);
        if (!keyword || seen.has(keyword.toLowerCase())) continue;
        const volRaw = get(/volume/i).replace(/[^0-9]/g, "");
        seen.add(keyword.toLowerCase());
        out.push({
          keyword,
          volume: volRaw ? parseInt(volRaw, 10) : null,
          intent: get(/intent/i),
          theme: get(/theme/i),
          segment: get(/segment/i),
        });
      }
    }
  }
  const rows = out.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  KEYWORDS_CACHE = { sig, rows };
  return rows;
}

export async function knowledgeStatus() {
  const { chunks } = await buildCorpus();
  const bySource = {};
  for (const c of chunks) bySource[c.source] = (bySource[c.source] || 0) + 1;
  return {
    files: Object.keys(bySource).length,
    chunks: chunks.length,
    bySource,
    retrieval: (await embedAvailable()) ? "semantic" : "keyword",
  };
}

// ---------- CLI ----------

if (process.argv[1] && process.argv[1].endsWith("knowledge.js")) {
  const query = process.argv[2];
  (async () => {
    const status = await knowledgeStatus();
    console.log("Knowledge status:", JSON.stringify(status, null, 2));
    if (query) {
      console.log(`\nTop matches for: "${query}"\n`);
      const hits = await searchKnowledge(query, 5);
      for (const h of hits) {
        console.log(`— [${h.source} · ${h.label}]`);
        console.log(`  ${h.text.slice(0, 240)}\n`);
      }
    }
  })();
}
