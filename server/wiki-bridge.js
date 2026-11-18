// The bridge between the agent team and the wiki (2026-11-16). The wiki is the
// team's long-term memory: the Researcher has always written its findings into
// it. This module makes the rest of the loop part of it too.
//
//   Writing  Five pages are kept up to date from the brain's own records: the
//            week's plan, the latest SEO audit, the weekly results, what Larkwell
//            has published, and what the team turned down and why. Each is one
//            rolling page, rewritten in place, so the wiki holds the current
//            picture and a short history without a new page every week (the
//            Librarian merges near-duplicate pages, and dated copies would be
//            exactly that). They are written in code, with no model call, and
//            only when their content has changed. Hand edits to these five
//            pages are overwritten.
//
//   Reading  searchWiki() is what the agents and the writers use to draw on
//            everything in the wiki, these pages and the research alike.

import { getPage, savePage, relevantPages, APP_RECORD_SOURCE } from "./wiki.js";
import { listDrafts } from "./drafts.js";
import { listReports } from "./agent-reports.js";
import { listPlans } from "./week-plan.js";
import { load, persist, sha1 } from "./stores.js";

const NOTE = "*This page is kept up to date automatically from the agents' records. Edits made here are overwritten.*";
const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ""));
const one = (s, n) => clip(String(s || "").replace(/\s+/g, " ").trim(), n);
const day = (iso) => String(iso || "").slice(0, 10);

// ---------- the five pages ----------

function planPage() {
  const plans = listPlans(8);
  if (!plans.length) return null;
  const [cur, ...older] = plans;
  const body = [
    NOTE,
    "",
    `## Week of ${cur.weekOf}`,
    `**Focus:** ${cur.focus}`,
    "",
    ...cur.themes.map((t) => `- **${t.theme}**: ${t.why}`),
    "",
    "### Pieces planned",
    ...cur.pieces.map((p) => `- ${p.kind === "blog" ? `Blog on "${p.keyword}"` : `LinkedIn ${p.postType}`}${p.draftId ? " (written)" : ""}: ${p.angle} Why: ${p.why}`),
    ...(cur.avoid.length ? ["", "### Left alone this week", ...cur.avoid.map((a) => `- ${a}`)] : []),
    ...(older.length ? ["", "## Earlier weeks", ...older.map((p) => `- ${p.weekOf}: ${p.focus} (${p.pieces.filter((x) => x.draftId).length} of ${p.pieces.length} pieces written)`)] : []),
    "",
    "Related: [[Larkwell published content]], [[What the Larkwell team turns down and why]].",
  ];
  return { title: "Larkwell marketing plan by week", type: "campaign", summary: `The Strategist's plan for the week of ${cur.weekOf}: ${one(cur.focus, 160)}`, body: body.join("\n") };
}

function seoPage() {
  const reports = listReports({ agentId: "seo", limit: 6 });
  if (!reports.length) return null;
  const [cur, ...older] = reports;
  const recs = new Map((load("recommendations") || []).map((r) => [r.id, r.status]));
  const body = [
    NOTE,
    "",
    `## Audit of ${cur.dateKey}`,
    cur.headline,
    "",
    cur.body,
    ...(cur.actions.length ? ["", "### Fixes proposed", ...cur.actions.map((a) => `- **${a.title}**${a.page ? ` (${a.page})` : ""}, ${recs.get(a.recId) || "open"}: ${one(a.detail, 400)}`)] : []),
    ...(older.length ? ["", "## Earlier audits", ...older.map((r) => `- ${r.dateKey}: ${r.headline}`)] : []),
  ];
  return { title: "larkwell.example SEO audit findings", type: "campaign", summary: `SEO audit of ${cur.dateKey}: ${one(cur.headline, 170)}`, body: clip(body.join("\n"), 9000) };
}

function resultsPage() {
  const reports = listReports({ agentId: "measurement", limit: 12 });
  if (!reports.length) return null;
  const cur = reports[0];
  const cols = ["sessions7d", "users7d", "searchClicks7d", "searchImpressions7d", "sessions28d", "searchClicks28d"];
  const head = ["Week ending", "Sessions (7d)", "Visitors (7d)", "Search clicks (7d)", "Search impressions (7d)", "Sessions (28d)", "Search clicks (28d)"];
  const cell = (v) => (Number.isFinite(v) ? String(v) : "not measured");
  const body = [
    NOTE,
    "",
    `## Week ending ${cur.dateKey}`,
    cur.headline,
    "",
    cur.body,
    "",
    "## Week by week",
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...reports.map((r) => `| ${r.dateKey} | ${cols.map((c) => cell(r.metrics?.[c])).join(" | ")} |`),
  ];
  return { title: "Larkwell marketing results by week", type: "campaign", summary: `Results for the week ending ${cur.dateKey}: ${one(cur.headline, 170)}`, body: clip(body.join("\n"), 9000) };
}

function publishedPage() {
  const drafts = new Map(listDrafts().map((d) => [d.id, d]));
  const log = (load("publishing")?.log || []).filter((e) => e.status === "published");
  if (!log.length) return null;
  const body = [
    NOTE,
    "",
    "What Larkwell has published on larkwell.example through the app, newest first. A new piece should not repeat one of these; it can link to it.",
    "",
    ...log.slice(0, 60).map((e) => {
      const p = drafts.get(e.draftId)?.payload || {};
      return `- ${e.dateKey}: [${e.title}](${e.url})${p.keyword ? `, keyword "${p.keyword}"` : ""}${p.serviceId ? `, service ${p.serviceId}` : ""}.${p.metaDescription ? ` ${one(p.metaDescription, 200)}` : ""}`;
    }),
    "",
    "Related: [[Larkwell marketing plan by week]].",
  ];
  return { title: "Larkwell published content", type: "campaign", summary: `${log.length} blog${log.length === 1 ? "" : "s"} published on larkwell.example through the app; the newest is "${one(log[0].title, 100)}" (${log[0].dateKey}).`, body: body.join("\n") };
}

function turnedDownPage() {
  // Rejections and drops with a reason (from a person or the Editor), and the
  // notes people wrote when they sent a piece back.
  const lines = [];
  for (const e of (load("taste") || []).filter((e) => (e.event === "rejected" || e.event === "deleted") && e.reason).slice(-40)) {
    lines.push({ at: e.at, text: `${day(e.at)}, ${e.kind}${e.serviceId ? ` (${e.serviceId})` : ""}, "${one(e.text, 90)}": ${one(e.reason, 300)}` });
  }
  for (const d of listDrafts()) {
    const r = d.payload?.revision;
    if (r?.note) lines.push({ at: r.at, text: `${day(r.at)}, ${d.kind}, "${one(d.payload.title || d.payload.hook, 90)}": sent back by ${r.by || "a reviewer"} with the note "${one(r.note, 300)}"` });
  }
  if (!lines.length) return null;
  lines.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const body = [
    NOTE,
    "",
    "Why pieces were rejected, dropped or sent back, newest first. \"Editor:\" marks the Editor agent's reason; the others are a person's. Anyone planning or writing for Larkwell should read these before repeating a topic or an approach.",
    "",
    ...lines.slice(0, 50).map((l) => `- ${l.text}`),
    "",
    "Related: [[Larkwell marketing plan by week]].",
  ];
  return { title: "What the Larkwell team turns down and why", type: "campaign", summary: `${lines.length} recorded reason${lines.length === 1 ? "" : "s"} for rejecting, dropping or sending back a piece; the latest: ${one(lines[0].text, 140)}`, body: body.join("\n") };
}

const PAGES = [planPage, seoPage, resultsPage, publishedPage, turnedDownPage];
export const BRIDGE_TITLES = ["Larkwell marketing plan by week", "larkwell.example SEO audit findings", "Larkwell marketing results by week", "Larkwell published content", "What the Larkwell team turns down and why"];

// Bring the five pages up to date. Cheap, and safe to call after anything that
// might have changed them; a page is rewritten only when its text differs.
// Never throws: the wiki being unwritable must not break filing a report.
export function syncWiki(nowISO) {
  const written = [];
  // A fingerprint of what was last written, per page: the wiki tidies text as
  // it saves, so the file on disk cannot be compared with the text built here.
  const seen = { ...(load("wikiBridge")?.pages || {}) };
  for (const build of PAGES) {
    try {
      const page = build();
      if (!page) continue;
      const print = sha1(`${page.summary}\n${page.body}`);
      if (seen[page.title] === print && getPage(page.title)) continue;
      savePage({ ...page, sources: [APP_RECORD_SOURCE] }, nowISO);
      seen[page.title] = print;
      written.push(page.title);
    } catch (err) {
      console.error("wiki bridge:", err.message);
    }
  }
  if (written.length) persist("wikiBridge", { pages: seen });
  return written;
}

// ---------- reading ----------

// The wiki pages most relevant to a question, for an agent to read. A page's
// `sources` say where its content came from; a figure with no source there is
// not a fact to publish.
export async function searchWiki(query, n = 5) {
  const q = one(query, 400);
  if (!q) return [];
  const pages = await relevantPages(q, Math.max(1, Math.min(8, n)));
  return pages.map((p) => ({ title: p.title, type: p.type, updated: day(p.updated), summary: p.summary, sources: p.sources.slice(0, 5), text: clip(p.body, 1800) }));
}

// The same, as short grounding lines for Jarvis's writers.
export async function wikiGrounding(query, n = 2) {
  try {
    return (await relevantPages(one(query, 300), n)).map((p) => ({ source: `wiki: ${p.title}`, text: `${p.summary} ${one(p.body.replace(NOTE, ""), 400)}` }));
  } catch {
    return [];
  }
}
