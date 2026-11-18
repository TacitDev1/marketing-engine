// Library cleanup. First written 2026-07-06 (fabricated client wins + the S/4HANA
// pile-up); reworked 2026-09-22 after Mara flagged "many duplicates" and a
// post that linked readers to a competitor's free trial.
//   A. Remove fabricated client-success drafts (the local model invents client wins).
//   B. Remove near-duplicate drafts, matched by MEANING (embeddings, >= 0.93 cosine,
//      the same gate the autopilot now applies before saving). Word overlap missed
//      most of them: the model rewords the same post rather than repeating it.
//   C. Strip outside links (anything not Larkwell or SAP) from every unposted draft.
// SAFETY: A and B only ever REMOVE drafts that are origin=autopilot AND status=draft;
// manual, approved and posted drafts are never removed, and they win ties (a
// duplicate of an approved post is the one that goes). C never touches posted drafts.
// C skips drafts already exported to the website (they must be fixed on the site).
// Backs up data/drafts.json first and writes a manifest of everything removed or
// edited, so it is fully reversible. Dry-run by default; pass --apply to act.
// Needs the brain running (BRAIN_URL) and Ollama with the embed model.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectClientSuccess, isClientSuccessGrounded, stripOutboundLinks } from "../server/guardrails.js";
import { vectorsFor, draftText, pruneVectors, DRAFT_DUP_THRESHOLD } from "../server/draft-dedupe.js";
import { embedAvailable, cosine } from "../server/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../data");
const STORE = path.join(DATA, "drafts.json");
const BASE = process.env.BRAIN_URL || "http://127.0.0.1:8787";
const APPLY = process.argv.includes("--apply");

const raw = await (await fetch(`${BASE}/api/drafts`)).json();
const drafts = Array.isArray(raw) ? raw : raw.drafts || [];
console.log(`loaded ${drafts.length} drafts`);

const prunable = (d) => (d.payload || {}).origin === "autopilot" && d.status === "draft";
const protectedN = drafts.filter((d) => !prunable(d)).length;
console.log(`protected (manual / approved / posted): ${protectedN}`);

// --- Rule A: fabricated client success ---
const fabricated = [];
for (const d of drafts) {
  if (!prunable(d)) continue;
  const t = draftText(d.payload);
  if (detectClientSuccess(t).length > 0 && !isClientSuccessGrounded(t)) fabricated.push(d);
}
const fabricatedIds = new Set(fabricated.map((d) => d.id));

// --- Rule B: near-duplicates by meaning, over what survives Rule A ---
if (!(await embedAvailable())) {
  console.error("\nThe embed model isn't available in Ollama (see Settings -> embed model). Stopping.");
  process.exit(1);
}
const pool = drafts.filter((d) => !fabricatedIds.has(d.id) && draftText(d.payload));
console.log(`embedding ${pool.length} drafts (cached after the first run)...`);
const vecs = await vectorsFor(pool.map((d) => draftText(d.payload)));
const vecOf = new Map(pool.map((d, i) => [d.id, vecs[i]]));
// Keepers are decided first: protected drafts, then autopilot drafts oldest-first.
const order = [...pool].sort((a, b) => {
  if (prunable(a) !== prunable(b)) return prunable(a) ? 1 : -1;
  return (a.savedAt || "").localeCompare(b.savedAt || "");
});
const kept = [];
const dupes = []; // { d, of, score }
for (const d of order) {
  let best = null;
  for (const k of kept) {
    if (k.kind !== d.kind) continue;
    const score = cosine(vecOf.get(d.id), vecOf.get(k.id));
    if (score >= DRAFT_DUP_THRESHOLD && (!best || score > best.score)) best = { of: k, score };
  }
  if (best && prunable(d)) dupes.push({ d, ...best });
  else kept.push(d);
}

// --- Rule C: outside links in unposted drafts that survive A and B ---
const removeIds = new Set([...fabricatedIds, ...dupes.map((x) => x.d.id)]);
const relinked = []; // { d, payload, hosts }
const republish = []; // published-to-site blogs with outside links: the site copy needs a human
for (const d of drafts) {
  if (d.status === "posted" || removeIds.has(d.id)) continue;
  const p = d.payload || {};
  // A blog already exported to the website (exportedRel) is edited on the site,
  // not here: patching the Library copy alone would silently diverge from what's live.
  if (p.exportedRel) {
    const hosts = [...new Set(["hook", "body", "title", "metaDescription"].flatMap((f) => (typeof p[f] === "string" ? stripOutboundLinks(p[f]).removed : [])))];
    if (hosts.length) republish.push({ d, hosts });
    continue;
  }
  const hosts = new Set();
  const next = { ...p };
  for (const field of ["hook", "body", "title", "metaDescription"]) {
    if (typeof p[field] !== "string") continue;
    const r = stripOutboundLinks(p[field]);
    if (r.removed.length) {
      next[field] = r.text;
      r.removed.forEach((h) => hosts.add(h));
    }
  }
  if (hosts.size) relinked.push({ d, payload: next, hosts: [...hosts] });
}

const short = (d) => `${((d.payload || {}).title || (d.payload || {}).hook || "").replace(/\s+/g, " ").slice(0, 70)}`;
console.log(`\nRule A — fabricated client stories to remove: ${fabricated.length}`);
fabricated.slice(0, 12).forEach((d) => console.log(`  ✗ ${d.id}  ${short(d)}`));
if (fabricated.length > 12) console.log(`  … +${fabricated.length - 12} more`);

console.log(`\nRule B — near-duplicates to remove (>= ${DRAFT_DUP_THRESHOLD}): ${dupes.length}`);
dupes.slice(0, 15).forEach(({ d, of, score }) =>
  console.log(`  ✗ ${d.id}  ${short(d)}\n      ${score.toFixed(3)} like ${of.id} [${of.status}]  ${short(of)}`)
);
if (dupes.length > 15) console.log(`  … +${dupes.length - 15} more`);

console.log(`\nRule C — drafts with outside links to strip: ${relinked.length}`);
relinked.slice(0, 15).forEach(({ d, hosts }) => console.log(`  ✎ ${d.id} [${d.status}]  ${hosts.join(", ")}  ${short(d)}`));
if (relinked.length > 15) console.log(`  … +${relinked.length - 15} more`);
if (republish.length) {
  console.log(`\nNot touched — already published to the site, fix there and re-publish: ${republish.length}`);
  republish.forEach(({ d, hosts }) => console.log(`  ! ${d.id} [${d.status}]  ${hosts.join(", ")}  ${short(d)}  (${d.payload.exportedRel})`));
}

const remaining = drafts.length - removeIds.size;
console.log(`\nTOTAL: remove ${removeIds.size}, edit ${relinked.length}   →   Library ${drafts.length} → ${remaining}`);

if (!APPLY) {
  console.log("\n(dry run — re-run with --apply to act; a backup + manifest are written on apply)");
  process.exit(0);
}

// backup + manifest, then act via the API (so the running brain stays consistent)
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(STORE, path.join(DATA, `drafts.backup-${stamp}.json`));
const manifest = {
  removed: drafts.filter((d) => removeIds.has(d.id)),
  duplicateOf: Object.fromEntries(dupes.map(({ d, of, score }) => [d.id, { of: of.id, score }])),
  linksStripped: relinked.map(({ d, hosts }) => ({ id: d.id, hosts, before: d.payload })),
};
fs.writeFileSync(path.join(DATA, `cleanup-removed-${stamp}.json`), JSON.stringify(manifest, null, 2));
console.log(`backup: data/drafts.backup-${stamp}.json  ·  manifest: data/cleanup-removed-${stamp}.json`);

let done = 0;
for (const id of removeIds) {
  // cleanup=1: a scripted removal is not Tobias rejecting the post, so it must
  // not count as a "kill" in the taste loop.
  const res = await fetch(`${BASE}/api/drafts/${id}?cleanup=1`, { method: "DELETE" });
  if (res.ok) done++;
  else console.error(`  ! failed to delete ${id}: ${res.status}`);
}
let edited = 0;
for (const { d, payload } of relinked) {
  const res = await fetch(`${BASE}/api/drafts/${d.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  if (res.ok) edited++;
  else console.error(`  ! failed to edit ${d.id}: ${res.status}`);
}
pruneVectors(drafts.filter((d) => !removeIds.has(d.id)));
console.log(`\nremoved ${done}/${removeIds.size}, stripped links in ${edited}/${relinked.length}. Library now ~${remaining}.`);
