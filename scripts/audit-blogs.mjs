#!/usr/bin/env node
// Blog audit report: which blogs in the Library are missing something?
// Read-only: reads data/drafts.json, changes nothing. Same checks as the
// Library badge, the Schedule warning and the server's 6-hourly audit.
//
//   node scripts/audit-blogs.mjs          # problems only
//   node scripts/audit-blogs.mjs --all    # every blog, including complete ones
//
// Exit code 1 when any blog is not publishable (no text, cut off, no title),
// so it can sit in a cron job or a deploy check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditBlog, isCritical, describeProblems } from "../src/lib/blog-audit.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const drafts = JSON.parse(fs.readFileSync(path.join(root, "data/drafts.json"), "utf8"));
// Posted blogs are already out; marked "To delete" ones are going.
const blogs = drafts.filter((d) => d.kind === "blog" && d.status !== "delete" && d.status !== "posted");
const all = process.argv.includes("--all");
let critical = 0;
let warn = 0;
for (const d of blogs) {
  const p = d.payload || {};
  const problems = auditBlog(p);
  const crit = isCritical(problems);
  if (crit) critical++;
  else if (problems.length) warn++;
  if (!problems.length && !all) continue;
  const tag = crit ? "NOT READY" : problems.length ? "missing  " : "ok       ";
  console.log(`${tag}  ${d.id}  [${d.status}]  ${(p.title || "(untitled)").slice(0, 70)}`);
  if (problems.length) console.log(`           ${describeProblems(problems)} | body ${String(p.body || "").length} chars | saved ${d.savedAt || "?"} | updated ${d.updatedAt || "?"}`);
}
console.log(`\n${blogs.length} blogs checked: ${critical} not ready to publish, ${warn} with something missing, ${blogs.length - critical - warn} complete.`);
process.exit(critical ? 1 : 0);
