// server/website.js
// A read-only window into the PARKED company-website (the Astro marketing site that
// lives next door at ../company-website). This module NEVER rebuilds or restructures
// the site. It can:
//   - report site state (parked Astro site, page/post counts, where it lives,
//     when it was last built)
//   - list + preview content-collection entries and Astro pages
//   - export an approved blog draft into src/content/news/en as a NEW
//     markdown file with `draft: true`
//   - MANAGE news posts + success stories (edit / show / hide / Go Live) — see
//     the manage layer at the bottom. This deliberately relaxed the original
//     "never edit an existing site file" guardrail (Tobias, 2026-08-18);
//     all writes stay inside src/content/news and are backed up first.
//
// Guardrail: never touch site code/config — only src/content/news content.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { WEBSITE_REPO } from "./config.js";

const run = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The company website repository: MKT_WEBSITE_REPO, or ../company-website.
const SITE_ROOT = WEBSITE_REPO;
const CONTENT_DIR = path.join(SITE_ROOT, "src", "content");
const NEWS_DIR = path.join(CONTENT_DIR, "news", "en");
const PAGES_DIR = path.join(SITE_ROOT, "src", "pages");
const DIST_DIR = path.join(SITE_ROOT, "dist");

const COLLECTIONS = ["news", "services", "industries", "locations"];

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function siteAvailable() {
  return exists(SITE_ROOT);
}

// --- tiny front-matter reader (no YAML dep; good enough for title/date/draft) ---
// Inverse of yamlString for a front-matter scalar: strip the outer quotes and,
// for a double-quoted value, undo its \\ and \" escapes. Without this every
// Manage-site save re-escaped an already-escaped title, so `Why "clean core"`
// grew a new layer of backslashes on the live site with each save.
function unquoteScalar(v) {
  const t = String(v || "").trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function readFrontMatter(file) {
  const fm = {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (m) {
      for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^([\w-]+):\s*(.*)$/);
        if (kv) fm[kv[1]] = unquoteScalar(kv[2]);
      }
    }
  } catch {
    /* ignore */
  }
  return fm;
}

function walkMd(dir) {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (/\.(md|mdx)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function relToSite(file) {
  return path.relative(SITE_ROOT, file).split(path.sep).join("/");
}

function collectionEntries(name) {
  const dir = path.join(CONTENT_DIR, name);
  return walkMd(dir).map((file) => {
    const fm = readFrontMatter(file);
    const base = path.basename(file).replace(/\.(md|mdx)$/i, "");
    return {
      collection: name,
      slug: base,
      title: fm.title || base.replace(/-/g, " "),
      date: fm.date || null,
      draft: fm.draft === "true",
      rel: relToSite(file),
    };
  });
}

function astroPages() {
  if (!exists(PAGES_DIR)) return [];
  return fs
    .readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(astro|md|mdx)$/i.test(e.name))
    .map((e) => {
      const file = path.join(PAGES_DIR, e.name);
      return {
        collection: "page",
        slug: e.name.replace(/\.(astro|md|mdx)$/i, ""),
        title: e.name,
        date: null,
        draft: false,
        rel: relToSite(file),
      };
    });
}

function dirMtime(p) {
  try {
    return fs.statSync(p).mtime.toISOString();
  } catch {
    return null;
  }
}

export function overview() {
  if (!siteAvailable()) {
    return { available: false, root: SITE_ROOT };
  }
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(SITE_ROOT, "package.json"), "utf8"));
  } catch {
    /* ignore */
  }
  const counts = {};
  for (const c of COLLECTIONS) counts[c] = collectionEntries(c).length;
  counts.pages = astroPages().length;

  return {
    available: true,
    root: SITE_ROOT,
    name: pkg.name || "company-website",
    version: pkg.version || null,
    framework: "Astro",
    parked: true,
    counts,
    lastBuilt: exists(DIST_DIR) ? dirMtime(DIST_DIR) : null,
    hasMigrationNotes: exists(path.join(SITE_ROOT, "migration-notes")),
    hasOldWebsite: exists(path.join(SITE_ROOT, "old_website")),
  };
}

export function listPages() {
  if (!siteAvailable()) return { available: false, entries: [] };
  const entries = [];
  for (const c of COLLECTIONS) entries.push(...collectionEntries(c));
  entries.push(...astroPages());
  // newest news first, then everything else alphabetically
  entries.sort((a, b) => {
    if (a.collection === "news" && b.collection === "news") {
      return String(b.date || "").localeCompare(String(a.date || ""));
    }
    return a.collection.localeCompare(b.collection) || a.slug.localeCompare(b.slug);
  });
  return { available: true, entries };
}

// Read a single entry's raw content. `rel` must be one of the paths we listed
// (validated to stay inside the site root and be a content/page file).
export function readEntry(rel) {
  if (!rel) return null;
  const full = path.resolve(SITE_ROOT, rel);
  if (!full.startsWith(SITE_ROOT + path.sep)) return null; // no traversal
  if (!/\.(md|mdx|astro)$/i.test(full)) return null;
  if (!exists(full)) return null;
  try {
    return {
      rel: relToSite(full),
      content: fs.readFileSync(full, "utf8"),
    };
  } catch {
    return null;
  }
}

// --- full route list for the live preview navigator ---
const SITEMAP = path.join(DIST_DIR, "sitemap-0.xml");

function humanize(seg) {
  return seg
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bSap\b/g, "SAP")
    .replace(/\bS 4\b/gi, "S/4")
    .replace(/\bHana\b/g, "HANA")
    .replace(/\bAi\b/g, "AI")
    .replace(/\bAws\b/g, "AWS")
    .replace(/\bHr\b/g, "HR")
    .replace(/\bFaq\b/g, "FAQ")
    .replace(/\bBtp\b/g, "BTP")
    .replace(/\bEcc\b/g, "ECC")
    .replace(/\bMps\b/g, "MPS");
}

function groupOf(p) {
  if (p === "/") return "Main";
  const seg = p.split("/").filter(Boolean)[0];
  if (seg === "news") return "News";
  if (seg === "sap") return "SAP services";
  if (seg === "products") return "Products";
  return "Pages";
}

function labelOf(p) {
  if (p === "/") return "Home";
  const segs = p.split("/").filter(Boolean);
  if (segs.length === 1) return humanize(segs[0]);
  // section index vs. deep page
  return humanize(segs[segs.length - 1]);
}

// Every public route of the site. Prefers the built sitemap (authoritative,
// includes every generated /news/* and /sap/* page); falls back to enumerating
// pages + content collections if the site hasn't been built yet.
export function siteRoutes() {
  if (!siteAvailable()) return { available: false, routes: [], count: 0, source: "none" };

  let paths = [];
  let source = "sitemap";
  try {
    if (exists(SITEMAP)) {
      const xml = fs.readFileSync(SITEMAP, "utf8");
      paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
        try {
          return new URL(m[1]).pathname;
        } catch {
          return m[1];
        }
      });
    }
  } catch {
    /* fall through to enumeration */
  }

  if (!paths.length) {
    source = "filesystem";
    paths = ["/"];
    for (const pg of astroPages()) {
      if (pg.slug === "index") continue;
      paths.push(`/${pg.slug}/`);
    }
    for (const c of COLLECTIONS) {
      for (const e of collectionEntries(c)) {
        paths.push(`/${c}/${e.slug.replace(/^[a-z]{2}\//, "")}/`);
      }
    }
  }

  // normalize (ensure leading slash, strip trailing slash except root) + dedup
  const seen = new Set();
  const routes = [];
  for (let p of paths) {
    if (!p.startsWith("/")) p = "/" + p;
    const norm = p === "/" ? "/" : p.replace(/\/+$/, "");
    if (seen.has(norm)) continue;
    seen.add(norm);
    routes.push({ path: norm, label: labelOf(norm), group: groupOf(norm) });
  }

  const order = ["Main", "Pages", "SAP services", "Products", "News"];
  routes.sort((a, b) => {
    const ga = order.indexOf(a.group);
    const gb = order.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.path.localeCompare(b.path);
  });

  return { available: true, routes, count: routes.length, source };
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function yamlString(s) {
  // Escape backslashes first, then quotes; collapse any newline to a space.
  // A raw newline would split the front-matter line in two and an unescaped
  // trailing backslash would escape the closing quote — either breaks the
  // YAML and, worse, only fails at the live Astro build, not in our own parser.
  const clean = String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ");
  return `"${clean}"`;
}

// Export a Library blog draft into the site.
// Returns { ok, rel, slug, published, overwritten } or { ok:false, error }.
// If `overwriteRel` points at a file this draft was published to before (and it
// still exists), it OVERWRITES that same file (backed up first, original date
// preserved) so re-publishing an edited draft updates the post rather than
// creating a duplicate. Otherwise it writes a NEW, never-colliding file
// (suffixing -2, -3, …). draft:true (default) keeps it hidden; publish:true
// writes draft:false. Either way it only goes truly LIVE on Go Live / deploy.
export function exportBlogDraft(draft, { publish = false, overwriteRel = null } = {}) {
  if (!siteAvailable()) return { ok: false, error: "site_not_found" };
  if (!draft || draft.kind !== "blog") return { ok: false, error: "not_a_blog_draft" };
  const p = draft.payload || {};
  const title = p.title || "Untitled SAP article";

  try {
    fs.mkdirSync(NEWS_DIR, { recursive: true });
  } catch {
    /* ignore */
  }

  let file = null;
  let finalSlug;
  let keepDate = null;
  let wasLive = false;
  let overwritten = false;
  if (overwriteRel) {
    const target = resolveNewsFile(overwriteRel);
    if (target) {
      try {
        backupFile(target);
      } catch {
        /* best effort */
      }
      file = target;
      finalSlug = path.basename(target).replace(/\.(md|mdx)$/i, "");
      const existing = readManagedMeta(target);
      keepDate = existing.date || null; // don't bump the post's date
      // "Update on website" on a LIVE post must not quietly hide it again: keep
      // its current visibility unless the caller asked to make it visible.
      wasLive = !existing.unmanaged && existing.draft === false;
      overwritten = true;
    }
  }
  if (!file) {
    let slug = slugify(p.slug || title) || "blog-draft";
    finalSlug = slug;
    let n = 2;
    while (exists(path.join(NEWS_DIR, `${finalSlug}.md`))) {
      finalSlug = `${slug}-${n++}`;
    }
    file = path.join(NEWS_DIR, `${finalSlug}.md`);
  }

  const fmLines = [
    "---",
    `title: ${yamlString(title)}`,
    `date: ${yamlString(keepDate || new Date().toISOString())}`,
  ];
  if (p.metaDescription) fmLines.push(`description: ${yamlString(p.metaDescription)}`);
  if (p.keyword) fmLines.push(`tags:\n  - ${yamlString(p.keyword)}`);
  fmLines.push("categories:\n  - Blogs");
  const visible = publish || wasLive;
  fmLines.push(`draft: ${visible ? "false" : "true"}`);
  fmLines.push("---", "");

  const body = (p.body || "").trim() + "\n";
  try {
    fs.writeFileSync(file, fmLines.join("\n") + "\n" + body, "utf8");
  } catch (err) {
    return { ok: false, error: "write_failed", message: err.message };
  }
  return { ok: true, rel: relToSite(file), slug: finalSlug, published: visible, overwritten, keptLive: wasLive && !publish };
}

// ============================================================================
// Manage layer — the built-in CMS.
//
// The original "never edit an existing site file" guardrail was DELIBERATELY
// relaxed on 2026-08-18: Tobias wants C-level users to manage blog posts and
// success stories (both live in src/content/news) from the app. Safety rails:
//   - every write is confined to src/content/news (path-validated)
//   - every edited file is backed up FIRST, outside the site repo
//     (marketing/data/site-backups — so backups can never be committed/deployed)
//   - nothing reaches the live site until goLive() commits + pushes, and that
//     only ever stages src/content/news, never code or config
// ============================================================================

const BACKUP_DIR = path.resolve(HERE, "..", "data", "site-backups");
const NEWS_ROOT = path.join(CONTENT_DIR, "news");

// A news file, validated: must resolve inside src/content/news and be markdown.
function resolveNewsFile(rel) {
  if (!rel) return null;
  const full = path.resolve(SITE_ROOT, rel);
  if (!full.startsWith(NEWS_ROOT + path.sep)) return null;
  if (!/\.(md|mdx)$/i.test(full)) return null;
  if (!exists(full)) return null;
  return full;
}

function backupFile(full) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(BACKUP_DIR, `${stamp}-${path.basename(full)}`);
  fs.copyFileSync(full, dest);
  return dest;
}

// Split a raw markdown file into { fmLines, body }. Returns null if there is no
// front-matter block (we refuse to manage such a file rather than guess).
function splitFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return { fmLines: m[1].split(/\r?\n/), body: m[2] };
}

// Replace a single-line scalar key in the front-matter (title:, description:,
// draft:). Inserts the line if the key doesn't exist. List keys (categories)
// and anything we don't understand are left byte-for-byte intact.
function setFmScalar(fmLines, key, rendered) {
  const re = new RegExp(`^${key}:`);
  const idx = fmLines.findIndex((l) => re.test(l));
  if (idx >= 0) {
    // Refuse to touch a block scalar (`key: >-` / `key: |`): rewriting only the
    // key line would orphan its indented continuation lines and break the YAML.
    // None of the real files use this today; this is a guard, not a live path.
    const value = fmLines[idx].slice(fmLines[idx].indexOf(":") + 1).trim();
    if (/^[>|]/.test(value)) throw new Error("block_scalar");
    fmLines[idx] = `${key}: ${rendered}`;
  } else {
    fmLines.push(`${key}: ${rendered}`);
  }
  return fmLines;
}

// Richer front-matter read for the manage list: adds description, categories
// (list values), and keeps the cheap regex approach of readFrontMatter.
function readManagedMeta(file) {
  const meta = { title: "", date: null, description: "", draft: false, categories: [] };
  try {
    const raw = fs.readFileSync(file, "utf8");
    const fm = splitFrontMatter(raw);
    if (!fm) return { ...meta, unmanaged: true };
    let inCategories = false;
    for (const line of fm.fmLines) {
      const listItem = line.match(/^\s+-\s+(.*)$/);
      if (inCategories && listItem) {
        meta.categories.push(unquoteScalar(listItem[1]));
        continue;
      }
      inCategories = false;
      const kv = line.match(/^([\w-]+):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const val = unquoteScalar(kv[2]);
      if (key === "categories" && !val) inCategories = true;
      else if (key === "categories" && val) meta.categories.push(val);
      else if (key === "title") meta.title = val;
      else if (key === "date") meta.date = val;
      else if (key === "description") meta.description = val;
      else if (key === "draft") meta.draft = val === "true";
    }
    meta.body = fm.body.trim();
  } catch {
    meta.unmanaged = true;
  }
  return meta;
}

const isStory = (categories) =>
  (categories || []).some((c) => /case stud|success/i.test(c));

// Everything the manage screen needs, one call: each news entry with enough
// meta to list, badge, and open it.
export function listManaged() {
  if (!siteAvailable()) return { available: false, entries: [] };
  const entries = walkMd(NEWS_ROOT).map((file) => {
    const meta = readManagedMeta(file);
    const base = path.basename(file).replace(/\.(md|mdx)$/i, "");
    return {
      rel: relToSite(file),
      slug: base,
      title: meta.title || base.replace(/-/g, " "),
      date: meta.date,
      draft: meta.draft,
      story: isStory(meta.categories),
      description: meta.description,
      unmanaged: !!meta.unmanaged,
    };
  });
  entries.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return { available: true, entries };
}

// Read one entry for the editor: meta + body.
export function readManaged(rel) {
  const full = resolveNewsFile(rel);
  if (!full) return null;
  const meta = readManagedMeta(full);
  if (meta.unmanaged) return null;
  return { rel: relToSite(full), ...meta };
}

// Edit a post's title / description / body in place. Anything not passed is
// left untouched; all other front-matter (date, author, categories) survives
// byte-for-byte. Backs the file up first.
export function updateEntry(rel, { title, description, body } = {}) {
  const full = resolveNewsFile(rel);
  if (!full) return { ok: false, error: "not_found" };
  let raw;
  try {
    raw = fs.readFileSync(full, "utf8");
  } catch (err) {
    return { ok: false, error: "read_failed", message: err.message };
  }
  const fm = splitFrontMatter(raw);
  if (!fm) return { ok: false, error: "unmanaged_file" };
  // An explicit empty body would blank the whole article — refuse it (title is
  // guarded the same way). Do this before backing up.
  if (typeof body === "string" && !body.trim()) return { ok: false, error: "empty_body" };
  let backup;
  try {
    backup = backupFile(full);
  } catch (err) {
    return { ok: false, error: "backup_failed", message: err.message };
  }
  let { fmLines } = fm;
  try {
    if (typeof title === "string" && title.trim()) setFmScalar(fmLines, "title", yamlString(title.trim()));
    if (typeof description === "string") setFmScalar(fmLines, "description", yamlString(description.trim()));
  } catch {
    return { ok: false, error: "unmanaged_file" }; // block scalar — refuse to corrupt it
  }
  const newBody = typeof body === "string" ? body.trim() + "\n" : fm.body;
  try {
    fs.writeFileSync(full, `---\n${fmLines.join("\n")}\n---\n\n${newBody.replace(/^\n+/, "")}`, "utf8");
  } catch (err) {
    return { ok: false, error: "write_failed", message: err.message };
  }
  return { ok: true, rel: relToSite(full), backup: path.basename(backup) };
}

// Show/hide a post on the site (draft front-matter flag). Backed up first.
export function setEntryVisibility(rel, visible) {
  const full = resolveNewsFile(rel);
  if (!full) return { ok: false, error: "not_found" };
  let raw;
  try {
    raw = fs.readFileSync(full, "utf8");
  } catch (err) {
    return { ok: false, error: "read_failed", message: err.message };
  }
  const fm = splitFrontMatter(raw);
  if (!fm) return { ok: false, error: "unmanaged_file" };
  try {
    backupFile(full);
  } catch (err) {
    return { ok: false, error: "backup_failed", message: err.message };
  }
  try {
    setFmScalar(fm.fmLines, "draft", visible ? "false" : "true");
  } catch {
    return { ok: false, error: "unmanaged_file" };
  }
  try {
    fs.writeFileSync(full, `---\n${fm.fmLines.join("\n")}\n---\n\n${fm.body.replace(/^\n+/, "")}`, "utf8");
  } catch (err) {
    return { ok: false, error: "write_failed", message: err.message };
  }
  return { ok: true, rel: relToSite(full), visible };
}

// ----- Go Live: commit + push ONLY src/content/news; the site host redeploys -----

// Every git call carries an explicit identity: the server has no global
// user.name/user.email, and without one `git commit` (and `pull --rebase`)
// fails with "Author identity unknown" — which took Go Live down on 2026-09-25.
const GIT_IDENTITY_NAME = process.env.SITE_GIT_NAME || "Marketing Engine";
const GIT_IDENTITY_EMAIL = process.env.SITE_GIT_EMAIL || "marketing-app@larkwell.example";
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: GIT_IDENTITY_NAME,
  GIT_AUTHOR_EMAIL: GIT_IDENTITY_EMAIL,
  GIT_COMMITTER_NAME: GIT_IDENTITY_NAME,
  GIT_COMMITTER_EMAIL: GIT_IDENTITY_EMAIL,
  // Never hang on a credential or editor prompt from a headless service.
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
};

async function git(args) {
  return run("git", args, { cwd: SITE_ROOT, timeout: 60000, env: GIT_ENV });
}

// Pending content changes (not yet on the live site), friendly-labelled.
export async function siteChanges() {
  if (!siteAvailable()) return { available: false, changes: [] };
  let out;
  try {
    out = (await git(["status", "--porcelain", "--", "src/content/news"])).stdout;
  } catch (err) {
    return { available: true, changes: [], error: err.message };
  }
  const KIND = { M: "edited", A: "new", D: "removed", "?": "new" };
  const changes = out
    .split("\n")
    .filter(Boolean)
    // Go Live only ever sends .md/.mdx, so only those are "waiting" — a stray
    // image here would otherwise light the Publish card forever.
    .filter((line) => /\.(md|mdx)"?$/i.test(line.trim()))
    .map((line) => {
      const code = line.slice(0, 2).trim()[0] || "M";
      const rel = line.slice(3).trim().replace(/^"|"$/g, "");
      const full = path.resolve(SITE_ROOT, rel);
      let title = path.basename(rel).replace(/\.(md|mdx)$/i, "").replace(/-/g, " ");
      if (exists(full)) {
        const meta = readManagedMeta(full);
        if (meta.title) title = meta.title;
      }
      return { rel, title, kind: KIND[code] || "edited" };
    });
  // Commits already made but not pushed (a Go Live whose push failed). The
  // tree is clean then, so without this the screen said "all your changes are
  // live" and hid the button that retries the push.
  let unpushed = 0;
  try {
    unpushed = parseInt((await git(["rev-list", "--count", "@{u}..HEAD"])).stdout.trim(), 10) || 0;
  } catch {
    unpushed = 0;
  }
  return { available: true, changes, unpushed };
}

// One Go Live at a time — a double-click must not race two pushes.
let goingLive = false;

// The branch Go Live publishes to. PRODUCTION, by decision (Tobias,
// 2026-09-25): the live-preview review step was scrapped — the host never served
// a working URL for it and it hid a broken build for two days. Content goes
// straight to main, the site host deploys larkwell.example, and the UI makes the person
// confirm twice. Pinned here so a checkout left on another branch can never
// change where content goes.
export const PUBLISH_BRANCH = process.env.SITE_PUBLISH_BRANCH || "main";

// `rels` (optional): the exact content files the user confirmed. When given,
// ONLY those are staged, so another person's half-finished save landing between
// the confirm dialog and the commit cannot ride along. Only .md/.mdx count.
export async function goLive({ rels } = {}) {
  if (!siteAvailable()) return { ok: false, error: "site_not_found" };
  if (goingLive) return { ok: false, error: "already_running" };
  goingLive = true;
  try {
    // BRANCH GATE: refuse unless the checkout AND its upstream are the pinned
    // publish branch. `git push` with no refspec ships whatever is checked out.
    let head = "";
    let upstream = "";
    try {
      head = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
      upstream = (await git(["rev-parse", "--abbrev-ref", "@{u}"])).stdout.trim();
    } catch {
      /* handled below */
    }
    if (head !== PUBLISH_BRANCH || upstream !== `origin/${PUBLISH_BRANCH}`) {
      return {
        ok: false,
        error: "wrong_branch",
        message: `Refused: the website checkout is on "${head || "?"}" (upstream ${upstream || "none"}), but content is only ever sent to "${PUBLISH_BRANCH}". Switch the company-website checkout back to ${PUBLISH_BRANCH} first.`,
      };
    }
    // Stage ONLY content. Every git op below is pathspec-scoped to
    // src/content/news so nothing else in the repo (a code experiment, a
    // config tweak) can ride along.
    const wanted = Array.isArray(rels)
      ? rels
          .map((r) => String(r || "").replace(/\\/g, "/"))
          .filter((r) => /^src\/content\/news\/[^\0]+\.(md|mdx)$/i.test(r) && !r.includes(".."))
      : null;
    const pending = (await siteChanges()).changes || [];
    const staged = wanted ? pending.filter((c) => wanted.includes(c.rel)) : pending.filter((c) => /\.(md|mdx)$/i.test(c.rel));
    if (wanted && wanted.length && !staged.length && pending.length) {
      return { ok: false, error: "changes_moved", message: "The changes you confirmed are no longer pending — the list has changed. Look at it again." };
    }
    if (staged.length) {
      await git(["add", "-A", "--", ...staged.map((c) => c.rel)]);
    }
    // Anything staged in news? (diff --cached exits 1 when there ARE changes.)
    let hasStaged = false;
    try {
      await git(["diff", "--cached", "--quiet", "--", "src/content/news"]);
    } catch {
      hasStaged = true;
    }
    if (hasStaged) {
      await git(["commit", "-m", "content: updates from the marketing app", "--", ...staged.map((c) => c.rel)]);
    } else {
      // Nothing new to commit — but a PREVIOUS push may have failed, leaving a
      // local commit unpushed. Only truly bail if there's nothing to push.
      let unpushed = 0;
      try {
        unpushed = parseInt((await git(["rev-list", "--count", "@{u}..HEAD"])).stdout.trim(), 10) || 0;
      } catch {
        unpushed = 0; // no upstream / detached — the push below surfaces it
      }
      if (!unpushed) return { ok: false, error: "nothing_to_publish" };
    }
    // SAFETY GATE: the push ships the whole branch, and the UI only showed the
    // user content changes. If ANY unpushed commit touches a file outside
    // src/content/news (a code experiment committed by hand in this repo), refuse
    // — that must never ride along on a content click.
    // Compare TREES (merge-base ... HEAD), not commits: `git log --name-only`
    // lists NO files for a merge commit, so a local merge would slip through.
    // Any merge commit in the unpushed range is refused outright.
    try {
      const merges = parseInt((await git(["rev-list", "--merges", "--count", "@{u}..HEAD"])).stdout.trim(), 10) || 0;
      if (merges) {
        return {
          ok: false,
          error: "merge_commits",
          message: `Refused: ${merges} unpushed merge commit${merges === 1 ? "" : "s"} on ${PUBLISH_BRANCH}. Push or undo that by hand first — the app only ever sends content.`,
        };
      }
      const names = (await git(["diff", "--name-only", "@{u}...HEAD"]))
        .stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      const foreign = names.filter((f) => !f.startsWith("src/content/news"));
      if (foreign.length) {
        return {
          ok: false,
          error: "non_content_commits",
          message: `Refused: unpushed commits touch files outside the blog content (${foreign[0]}${foreign.length > 1 ? ` +${foreign.length - 1} more` : ""}). Push or remove those by hand first — the app only ever sends content.`,
        };
      }
    } catch {
      /* no upstream — the push below will surface the real error */
    }
    // Remember where the remote was, so after the push we can name every content
    // file it carried, including ones committed by an earlier Go Live whose push
    // failed (a retry stages nothing new, so `staged` alone would be empty).
    let upstreamBefore = "";
    try {
      upstreamBefore = (await git(["rev-parse", "@{u}"])).stdout.trim();
    } catch {
      upstreamBefore = "";
    }
    // Push EXPLICITLY to the pinned branch. On a non-fast-forward (someone
    // edited on GitHub / another machine) or transient failure, rebase on the
    // remote — content-only commits rebase cleanly — and retry once.
    try {
      await git(["push", "origin", `${PUBLISH_BRANCH}:${PUBLISH_BRANCH}`]);
    } catch {
      try {
        await git(["pull", "--rebase", "origin", PUBLISH_BRANCH]);
        await git(["push", "origin", `${PUBLISH_BRANCH}:${PUBLISH_BRANCH}`]);
      } catch (err) {
        // A conflicted rebase strands the repo mid-rebase and bricks every
        // future Go Live — always leave the repo in a clean state.
        try { await git(["rebase", "--abort"]); } catch { /* not mid-rebase */ }
        return { ok: false, error: "push_failed", message: String(err.stderr || err.message || "").slice(0, 300) };
      }
    }
    const committed = staged.map((c) => ({ rel: c.rel, title: c.title, kind: c.kind }));
    if (upstreamBefore) {
      try {
        const sent = (await git(["diff", "--name-only", "--diff-filter=AM", `${upstreamBefore}..HEAD`, "--", "src/content/news"]))
          .stdout.split("\n").map((l) => l.trim()).filter((l) => /\.(md|mdx)$/i.test(l));
        for (const rel of sent) {
          if (committed.some((c) => c.rel === rel)) continue;
          const full = path.resolve(SITE_ROOT, rel);
          const title = (exists(full) && readManagedMeta(full).title) || path.basename(rel).replace(/\.(md|mdx)$/i, "").replace(/-/g, " ");
          committed.push({ rel, title, kind: "sent" });
        }
      } catch {
        /* the push worked; the list is best-effort */
      }
    }
    return { ok: true, branch: PUBLISH_BRANCH, committed };
  } catch (err) {
    return { ok: false, error: "golive_failed", message: String(err.stderr || err.message || "").slice(0, 300) };
  } finally {
    goingLive = false;
  }
}
