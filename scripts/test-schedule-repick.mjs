#!/usr/bin/env node
// Tests for "Let Jarvis re-pick" (server/schedule.js pickForSlot, repick mode).
//
// Regression (2026-10-02): re-pick only excluded the draft currently in the
// slot, so it ping-ponged between the two best drafts forever. Each slot now
// remembers what was passed over.
//
// Runs against a throwaway copy of server/ + src/lib/ with a fake Library of
// five drafts in a temp folder, so the real data/ is never read or written.
//
//   node scripts/test-schedule-repick.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const box = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-repick-"));
fs.cpSync(path.join(root, "server"), path.join(box, "server"), { recursive: true });
fs.cpSync(path.join(root, "src/lib"), path.join(box, "src/lib"), { recursive: true });
fs.mkdirSync(path.join(box, "data"));

// Five LinkedIn drafts that score identically except for the tie-break
// (newest savedAt first), so the ranking is exactly A > B > C > D > E.
const now = Date.now();
const ids = ["A", "B", "C", "D", "E"];
const drafts = ids.map((id, i) => ({
  id: `d-${id}`,
  kind: "linkedin",
  status: "draft",
  savedAt: new Date(now - (i + 1) * 3600e3).toISOString(),
  payload: { hook: `Post ${id}`, body: `Body of post ${id}.`, serviceId: "s4hana", postType: "how-to" },
}));
fs.writeFileSync(path.join(box, "data/drafts.json"), JSON.stringify(drafts));

const S = await import(pathToFileURL(path.join(box, "server/schedule.js")).href);
const scheduleFile = path.join(box, "data/schedule.json");
const readSlot = (key) => JSON.parse(fs.readFileSync(scheduleFile, "utf8")).slots[key] || {};
const label = (id) => (id || "").replace(/^d-/, "") || "-";

// A future LinkedIn day from the cadence rules, so the slot is "live".
const slot = S.listSlots().find((x) => x.kind === "linkedin" && !x.past);
if (!slot) throw new Error("no upcoming linkedin slot in the default cadence");
const key = slot.key;

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
}
async function repick() {
  const out = await S.pickForSlot(key, { repick: true });
  return { out, id: out.slot?.draftId || null, passed: readSlot(key).passed || [] };
}

console.log(`slot ${key}, Library: ${ids.join(" > ")}\n`);

// 1) automatic pick, then five re-picks walk the ranking in order
const first = await S.pickForSlot(key);
check("automatic pick takes the best draft", first.slot?.draftId === "d-A", `got ${label(first.slot?.draftId)}`);
check("automatic pick leaves passed empty", (readSlot(key).passed || []).length === 0);
for (const want of ["B", "C", "D", "E"]) {
  const r = await repick();
  check(`re-pick -> ${want}`, r.id === `d-${want}`, `got ${label(r.id)}, passed over [${r.passed.map(label).join(",")}], considered ${r.out.considered}, passedCount ${r.out.passedCount}`);
}
let r = await repick();
check("re-pick after E -> unchanged, 'been through all' message", r.out.unchanged === true && /been through all 5 linkedin drafts/.test(r.out.reason), r.out.reason);
check("unchanged keeps E in the slot", readSlot(key).draftId === "d-E");
r = await repick();
check("next re-pick starts over at A", r.id === "d-A", `got ${label(r.id)}`);
check("...with passed cleared", r.passed.length === 0, `passed [${r.passed.map(label).join(",")}]`);

// 2) choosing by hand clears passed; the next re-pick is the best other than it
await repick(); // A -> B, passed [A]
await repick(); // B -> C, passed [A,B]
check("passed has grown before hand choice", readSlot(key).passed?.length === 2, `passed [${(readSlot(key).passed || []).map(label).join(",")}]`);
S.assignDraft(key, "d-C", "you");
check("assignDraft(by=you) clears passed", (readSlot(key).passed || []).length === 0);
r = await repick();
check("re-pick after hand choice of C -> A (best other than C)", r.id === "d-A", `got ${label(r.id)}`);

// 3) unassignDraft clears passed
await repick(); // A -> B, passed [C, A]
check("passed non-empty before unassign", (readSlot(key).passed || []).length > 0);
S.unassignDraft("d-B");
const afterUnassign = readSlot(key);
check("unassignDraft empties the slot and clears passed", !afterUnassign.draftId && (afterUnassign.passed || []).length === 0);

// 4) a passed id whose draft left the Library is ignored and breaks nothing
await S.pickForSlot(key); // auto fill -> A
const st = JSON.parse(fs.readFileSync(scheduleFile, "utf8"));
st.slots[key].passed = ["d-GHOST", "d-B"];
fs.writeFileSync(scheduleFile, JSON.stringify(st));
r = await repick();
check("ghost id ignored: re-pick from A skips B -> C", r.id === "d-C", `got ${label(r.id)}`);
check("ghost id dropped from passed", !r.passed.includes("d-GHOST") && r.out.passedCount === 2, `passed [${r.passed.map(label).join(",")}], passedCount ${r.out.passedCount}`);

// 5) slots written before this change (no `passed` field) still work
const st2 = JSON.parse(fs.readFileSync(scheduleFile, "utf8"));
delete st2.slots[key].passed;
delete st2.slots[key].exhausted;
fs.writeFileSync(scheduleFile, JSON.stringify(st2));
r = await repick();
check("legacy slot without passed: re-pick works", r.id === "d-A", `from C got ${label(r.id)}`);

// 6) start-over never re-saves the draft already in the slot
S.assignDraft(key, "d-A", "you");
for (let i = 0; i < 4; i++) await repick(); // B, C, D, E
r = await repick(); // exhausted
r = await repick(); // start over: best other than E
check("start-over excludes the draft in the slot", r.id === "d-A" && r.passed.length === 0, `got ${label(r.id)}`);

// 7) publishing (markPublished) clears the memory
await repick(); // A -> B, passed [A]
S.markPublished("d-B", new Date().toISOString());
check("markPublished clears passed", (readSlot(key).passed || []).length === 0 && !readSlot(key).exhausted);
S.reopenForDraft("d-B");
check("reopenForDraft keeps passed clear", (readSlot(key).passed || []).length === 0);

// 8) only one free draft: a clear "only draft" message, never a no-op pick
const blogBody = "## Heading\n\n" + "A real paragraph of text for the blog. ".repeat(12);
const withBlog = [...JSON.parse(fs.readFileSync(path.join(box, "data/drafts.json"), "utf8")), { id: "d-BLOG", kind: "blog", status: "draft", savedAt: new Date().toISOString(), payload: { title: "Only blog", body: blogBody, serviceId: "s4hana" } }];
fs.writeFileSync(path.join(box, "data/drafts.json"), JSON.stringify(withBlog));
const bslot = S.listSlots().find((x) => x.kind === "blog" && !x.past);
if (bslot) {
  const p1 = await S.pickForSlot(bslot.key);
  check("single blog: automatic pick takes it", p1.slot?.draftId === "d-BLOG");
  for (const n of [1, 2]) {
    const o = await S.pickForSlot(bslot.key, { repick: true });
    check(`single blog: re-pick ${n} -> "only blog draft free" (unchanged)`, o.unchanged === true && /only blog draft free/.test(o.reason) && readSlot(bslot.key).draftId === "d-BLOG", o.reason);
  }
} else check("single blog: an upcoming blog slot exists", false);

fs.rmSync(box, { recursive: true, force: true });
console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);
