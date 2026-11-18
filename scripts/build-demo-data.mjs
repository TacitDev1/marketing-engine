#!/usr/bin/env node
// Builds the sample data for Larkwell Consulting (an invented company) and the
// snapshot the static demo serves.
//
//   node scripts/build-demo-data.mjs           # data/ fixtures + src/demo/snapshot.json
//   node scripts/build-demo-data.mjs --no-data # snapshot only, leave data/ alone
//
// How: copy server/ and src/lib/ into a temp folder (like the tests do), feed
// scripts/demo-fixtures.mjs through the server's OWN store functions, so every
// record has exactly the shape the real server writes. Then copy the result to
// data/ and wiki/, start the real server on it (no models needed), and record
// the GET responses the demo's screens ask for.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as FX from "./demo-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE_DATA = !process.argv.includes("--no-data");
const box = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-demo-"));
fs.cpSync(path.join(root, "server"), path.join(box, "server"), { recursive: true });
fs.cpSync(path.join(root, "src/lib"), path.join(box, "src/lib"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(box, "public"), { recursive: true });
fs.cpSync(path.join(root, "knowledge"), path.join(box, "knowledge"), { recursive: true });
fs.mkdirSync(path.join(box, "wiki"));
for (const f of fs.readdirSync(path.join(root, "wiki"))) {
  // Only the hand-written pages; the five bridge pages are rebuilt below.
  if (f.endsWith(".md") && !/^(larkwell-marketing|larkwell-example-seo|what-the-larkwell|larkwell-published)/.test(f)) fs.copyFileSync(path.join(root, "wiki", f), path.join(box, "wiki", f));
}
try {
  fs.symlinkSync(path.join(root, "node_modules"), path.join(box, "node_modules"), "junction");
} catch {
  fs.symlinkSync(path.join(root, "node_modules"), path.join(box, "node_modules"), "dir");
}
fs.writeFileSync(path.join(box, "package.json"), JSON.stringify({ type: "module" }));
fs.mkdirSync(path.join(box, "data"));

// No models: anything that would call one fails fast instead of waiting.
process.env.OLLAMA_HOST = "127.0.0.1:9";
const imp = (p) => import(pathToFileURL(path.join(box, p)).href);
const stores = await imp("server/stores.js");
const drafts = await imp("server/drafts.js");
const editor = await imp("server/editor.js");
const approvals = await imp("server/approvals.js");
const team = await imp("server/agent-team.js");
const reports = await imp("server/agent-reports.js");
const weekPlan = await imp("server/week-plan.js");
const schedule = await imp("server/schedule.js");
const playbook = await imp("server/playbook.js");
const images = await imp("server/images.js");
const bridge = await imp("server/wiki-bridge.js");
const wiki = await imp("server/wiki.js");
const { services } = await imp("src/lib/company.js");

const NOW = Date.now();
const DAY = 86400000;
// "days ago" at a working hour, never in the future. A time later today than
// now is squeezed into the last few hours, keeping the order of events.
const at = (daysAgo, hour = 10, min = 0) => {
  const d = new Date(NOW - daysAgo * DAY);
  d.setHours(hour, min, 0, 0);
  if (d.getTime() <= NOW - 60000) return d.toISOString();
  return new Date(NOW - (24 - hour - min / 60) * 10 * 60000).toISOString();
};
const label = (id) => services.find((s) => s.id === id)?.label || "";
const ids = {};

// ---------- the Library: drafts, the Editor, people ----------
playbook.ensureSeeded(at(14, 9));
const all = [...FX.BLOGS.map((b) => ({ ...b, kind: "blog" })), ...FX.POSTS.map((p) => ({ ...p, kind: "linkedin" }))].sort((a, b) => b.daysAgo - a.daysAgo);
for (const d of all) {
  const payload =
    d.kind === "blog"
      ? { title: d.title, metaDescription: d.metaDescription, body: d.body, keyword: d.keyword, slug: d.slug, serviceId: d.serviceId, serviceLabel: label(d.serviceId), origin: "jarvis", warnings: [] }
      : { hook: d.hook, body: d.body, hashtags: d.hashtags, serviceId: d.serviceId, serviceLabel: label(d.serviceId), postType: d.postType, ...(d.productId ? { productId: d.productId } : {}), origin: "jarvis", warnings: [] };
  const rec = drafts.saveDraft({ kind: d.kind, payload, nowISO: at(d.daysAgo, 15, 20) });
  ids[d.key] = rec.id;
  if (d.editor) {
    const out = editor.applyEditorVerdict(rec.id, d.editor, at(d.daysAgo, 16, 5));
    if (out.error) throw new Error(`${d.key}: ${out.error} ${out.message || ""}`);
    if (d.kind === "blog" && d.outcome !== "rejected" && d.editor.score >= 8 && !out.editor.cleared) {
      throw new Error(`${d.key} was meant to be cleared but was not: ${JSON.stringify(out.editor.issues)}`);
    }
  }
  if (d.outcome === "approved" || d.outcome === "posted") {
    approvals.decideInApp(rec.id, { decision: "approve", by: d.approvedBy || "Mara" }, at(Math.max(0, d.daysAgo - 1), 9, 30));
  }
}

// ---------- the Schedule ----------
const monday = new Date(NOW - 21 * DAY);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
schedule.updateSettings({ linkedinEveryDays: 2, workWeekOnly: true, blogWeekday: 3, reminderHour: 8, anchorDate: monday.toISOString().slice(0, 10) });
const slots = schedule.listSlots();
const today = new Date(NOW).toISOString().slice(0, 10);
const nearest = (kind, daysAgo, future) => {
  const target = new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);
  const pool = slots.filter((s) => s.kind === kind && (future ? s.date >= today : s.date <= target && s.date < today));
  return future ? pool[0] : pool[pool.length - 1];
};
const place = (kind, key, daysAgo, future) => {
  const slot = nearest(kind, daysAgo, future);
  if (slot && schedule.assignDraft(slot.key, ids[key], "jarvis")) return slot;
  return null;
};
for (const [kind, key, daysAgo] of [["linkedin", "l-exceptions", 2], ["blog", "b-masterdata", 6]]) {
  const slot = place(kind, key, daysAgo, false);
  const when = slot ? `${slot.date}T09:00:00.000Z` : at(daysAgo, 9);
  drafts.updateDraft(ids[key], { status: "posted" }, when);
  schedule.markPublished(ids[key], when);
  stores.addTasteEvent({ event: "posted", kind, text: key, draftId: ids[key] }, when);
  if (kind === "blog") {
    stores.persist("publishing", { enabled: true, days: [1, 3, 5], afterHour: 16, log: [{ dateKey: when.slice(0, 10), at: when, draftId: ids[key], title: "Master data first: the cutover nobody plans", status: "published", rel: "src/content/news/en/master-data-first.md", url: "https://larkwell.example/news/master-data-first", score: 8 }] });
  }
}
place("linkedin", "l-brackenfield", 0, true);
place("blog", "b-customcode", 0, true);

// ---------- research: findings, queue, recommendations, directives, competitors ----------
for (const f of [...FX.FINDINGS].reverse()) stores.addFinding({ ...f, kind: "web" }, at(f.daysAgo, 11));
for (const q of FX.QUEUE) stores.enqueueTopic(q, at(1, 12));
for (const r of FX.RECOMMENDATIONS) stores.addRecommendation({ ...r, evidence: ["jarvis:session"] }, at(2, 16));
for (const d of FX.DIRECTIVES) stores.addDirective(d, at(7, 16));
for (const c of FX.COMPETITORS) stores.upsertCompetitor(c, at(4, 13));
for (const [event, kind, postType, serviceId, daysAgo] of FX.TASTE) stores.addTasteEvent({ event, kind, postType, serviceId, origin: "jarvis" }, at(daysAgo, 10));

// ---------- the agent team: runs, plan, reports ----------
for (const [agentId, daysAgo, status, minutes, summary] of [...FX.RUNS].sort((a, b) => b[1] - a[1])) {
  const start = at(daysAgo, agentId === "editor" ? 15 : 15, agentId === "editor" ? 40 : 5);
  const end = new Date(Date.parse(start) + minutes * 60000).toISOString();
  team.recordAgentRun(agentId, { startedAt: start, status, exitCode: status === "ok" ? 0 : 1, model: "claude-sonnet-5-5", summary }, end);
}
const { plan } = weekPlan.saveWeekPlan(FX.WEEK_PLAN, at(FX.WEEK_PLAN.daysAgo, 16, 30));
FX.WEEK_PLAN.pieces.forEach((p, i) => {
  if (p.usedBy && ids[p.usedBy]) weekPlan.markPieceUsed(plan.pieces[i].id, ids[p.usedBy], at(2, 15, 30));
});
reports.fileReport("measurement", FX.MEASUREMENT_REPORT, at(FX.MEASUREMENT_REPORT.daysAgo, 16, 0));
reports.fileReport("seo", FX.SEO_REPORT, at(FX.SEO_REPORT.daysAgo, 16, 0));

// ---------- Jarvis's daily session and its briefing ----------
const briefAt = at(FX.BRIEF.daysAgo, 16, 45);
const produced = ["l-copilot", "l-founder"].map((k) => {
  const d = drafts.listDrafts().find((x) => x.id === ids[k]);
  return { id: d.id, kind: d.kind, title: d.payload.hook, why: FX.BRIEF.picks.find((p) => p.serviceId === d.payload.serviceId)?.why || "", score: 8, revisions: 1 };
});
stores.persist("briefs", [{ id: `brief-${briefAt}`, date: briefAt.slice(0, 10), createdAt: briefAt, by: "schedule", ...FX.BRIEF, produced, signals: { kept: 4, rejected: 2, edits: 1, searchConsole: false, analytics: false, findings: FX.FINDINGS.length }, minutes: 41 }]);
stores.persist("session", { date: briefAt.slice(0, 10), phase: "done", running: false, startedAt: at(0, 15, 4), finishedAt: briefAt, lastCompletedAt: briefAt, completedDate: briefAt.slice(0, 10), picks: [], produced, discarded: FX.BRIEF.discarded, learned: FX.BRIEF.learned, recommendations: [], log: [] });
stores.addActivity({ actor: "jarvis", event: "session.brief", summary: FX.BRIEF.headline }, briefAt);
stores.setAutopilot({ researcherLastSeenAt: at(0, 15, 23) }, at(0, 15, 23));
stores.setLibrarianState({ lastRunAt: at(1, 17), lastResult: { merged: 0, linked: 4, orphansLinked: 1, lintIssues: 0, errors: 0 }, runCount: 9 });

// ---------- pictures: branded cards drawn by the server itself ----------
const cards = [
  ["l-brackenfield", "Work orders closed at the asset", "Brackenfield Waste, depot by depot", "brand"],
  ["l-patchday", "Patch day: rate the notes first", "A routine a small Basis team can keep", "tech"],
  ["l-paper", "Three screens, not thirty", "SAP PM on the depot tablet", "light"],
  ["b-billing", "Billing exceptions have causes", "Fix the top two, then automate", "deep"],
];
for (const [key, headline, subline, style] of cards) {
  await images.generateImage({ providerId: "cards", headline, subline, style, size: "linkedin", draftId: ids[key], nowISO: at(1, 16) });
}

// ---------- the wiki: five pages kept current from the records ----------
wiki.ensureSchema(at(14, 9));
bridge.syncWiki(at(0, 16, 50));

// Activity in time order (seeding filed it out of order).
stores.persist("activity", [...stores.load("activity")].sort((a, b) => a.ts.localeCompare(b.ts)));

// ---------- copy the result into the repo ----------
const DROP = /\.bak$|^draft-vectors\.json$|^usage\.json$/;
if (WRITE_DATA) {
  fs.rmSync(path.join(root, "data"), { recursive: true, force: true });
  fs.cpSync(path.join(box, "data"), path.join(root, "data"), { recursive: true, filter: (src) => !DROP.test(path.basename(src)) });
  for (const f of fs.readdirSync(path.join(box, "wiki"))) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(box, "wiki", f), path.join(root, "wiki", f));
  }
  console.log("wrote data/ and wiki/");
}

// ---------- record the API the demo screens read ----------
const PORT = 8899;
const server = spawn(process.execPath, ["server/index.js"], { cwd: box, env: { ...process.env, PORT: String(PORT), MKT_DEPLOYMENT: "" }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (c) => (log += c));
server.stderr.on("data", (c) => (log += c));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}
const get = async (p) => {
  const res = await fetch(base + p);
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
};
const PATHS = [
  "/api/health", "/api/deployment", "/api/autopilot/status", "/api/autopilot/stats", "/api/autopilot/activity?limit=300",
  "/api/autopilot/findings?limit=200", "/api/autopilot/recommendations", "/api/autopilot/directives", "/api/autopilot/queue",
  "/api/drafts", "/api/agents", "/api/publishing", "/api/summary", "/api/week-ahead", "/api/approvals/inbox", "/api/approvals",
  "/api/session", "/api/playbook", "/api/fresh-start", "/api/schedule", "/api/competitors", "/api/librarian",
  "/api/wiki/all", "/api/wiki/graph", "/api/images", "/api/knowledge/status",
];
const snap = { takenAt: new Date(NOW).toISOString(), get: {} };
try {
  for (const p of PATHS) snap.get[p] = await get(p);
  for (const pg of snap.get["/api/wiki/all"].pages || []) snap.get[`/api/wiki/page/${pg.slug}`] = await get(`/api/wiki/page/${pg.slug}`);
  for (const kind of ["linkedin", "blog"]) snap.get[`/api/schedule/candidates?kind=${kind}`] = await get(`/api/schedule/candidates?kind=${kind}`);
} catch (err) {
  console.error(log.slice(-3000));
  throw err;
} finally {
  server.kill();
}

// Pictures go into the demo bundle; the snapshot points at them by file name.
const imgDir = path.join(root, "src/demo/images");
fs.rmSync(imgDir, { recursive: true, force: true });
fs.mkdirSync(imgDir, { recursive: true });
for (const img of snap.get["/api/images"].images || []) {
  fs.copyFileSync(path.join(box, "data/images", img.file), path.join(imgDir, img.file));
}
// Never ship a local path (the ffmpeg hint names the home folder, for example).
let json = JSON.stringify(snap, null, 1);
for (const p of [box, root, os.homedir()]) {
  for (const v of [JSON.stringify(p).slice(1, -1), p.replace(/\\/g, "/"), p]) json = json.split(v).join("~");
}
fs.writeFileSync(path.join(root, "src/demo/snapshot.json"), json + "\n");
console.log(`wrote src/demo/snapshot.json (${Object.keys(snap.get).length} responses) and ${fs.readdirSync(imgDir).length} pictures`);
fs.rmSync(box, { recursive: true, force: true });
