#!/usr/bin/env node
// Tests for Jarvis as marketing lead (2026-11-02): fresh start, playbook,
// critic, and one whole daily session (observe → learn → plan → write → brief).
//
// Runs against a throwaway copy of server/ + src/lib/ with fake data in a temp
// folder, and a fake Ollama (global fetch is stubbed), so the real data/ and
// the GPU are never touched.
//
//   node scripts/test-session.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const box = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-session-"));
fs.cpSync(path.join(root, "server"), path.join(box, "server"), { recursive: true });
fs.cpSync(path.join(root, "src/lib"), path.join(box, "src/lib"), { recursive: true });
fs.symlinkSync(path.join(root, "node_modules"), path.join(box, "node_modules"), process.platform === "win32" ? "junction" : "dir"); // knowledge.js imports parsers
fs.mkdirSync(path.join(box, "data"));
fs.mkdirSync(path.join(box, "wiki"));
fs.writeFileSync(path.join(box, "wiki/sap-basis.md"), "---\ntitle: SAP Basis\n---\nKept knowledge.\n");

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures++;
};
const read = (f) => JSON.parse(fs.readFileSync(path.join(box, "data", f), "utf8"));
const write = (f, v) => fs.writeFileSync(path.join(box, "data", f), JSON.stringify(v));

// ---------- fake data ----------
const day = 86400000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
write("drafts.json", [
  { id: "d-old-1", kind: "linkedin", status: "draft", savedAt: iso(40 * day), updatedAt: iso(40 * day), payload: { hook: "Old unreviewed post", body: "x", origin: "autopilot", serviceId: "s4hana" } },
  { id: "d-old-2", kind: "blog", status: "delete", prevStatus: "draft", savedAt: iso(30 * day), updatedAt: iso(30 * day), payload: { title: "Old blog", body: "y".repeat(300) } },
  { id: "d-keep-1", kind: "linkedin", status: "approved", savedAt: iso(20 * day), updatedAt: iso(20 * day), payload: { hook: "Approved post", body: "z" } },
  { id: "d-keep-2", kind: "blog", status: "posted", savedAt: iso(20 * day), updatedAt: iso(20 * day), payload: { title: "Posted blog", body: "p".repeat(300) } },
  // Recent theme the session must not repeat (2 days old).
  { id: "d-recent", kind: "linkedin", status: "draft", savedAt: iso(2 * day), updatedAt: iso(2 * day), payload: { hook: "BTP consumption credits forecast overruns budget control", body: "recent", serviceId: "btp" } },
]);
write("findings.json", [{ id: "f-1", title: "Old finding", summary: "s", url: "https://example.com/a", sources: [], createdAt: iso(10 * day), processed: true, attempts: 0 }]);
write("recommendations.json", [
  { id: "rec-1", title: "Add FAQ schema to the Basis page", detail: "d", status: "open", seen: 3, createdAt: iso(5 * day) },
  { id: "rec-2", title: "Old expired advice", detail: "d", status: "expired", createdAt: iso(50 * day) },
]);
write("directives.json", [
  { id: "dir-1", kind: "avoid", text: "Do not reference an unconfirmed November 2026 DORA deadline in social content.", status: "open", createdAt: iso(3 * day) },
  { id: "dir-2", kind: "build", text: "Build a BTP FinOps guide around the three 2026 credit pools.", status: "expired", createdAt: iso(30 * day) },
]);
write("research-queue.json", [{ id: "rq-1", topic: "t", status: "done", createdAt: iso(5 * day), priority: 3 }]);
write("activity.json", [{ id: "a-1", ts: iso(1 * day), actor: "worker", event: "x", summary: "old" }]);
write("taste.json", [{ event: "approved", kind: "linkedin", at: iso(9 * day) }]);

// ---------- fake Ollama ----------
const vec = (text) => {
  const v = new Array(64).fill(0);
  for (const w of String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % 64] += 1;
  }
  return v;
};
const POST_BODY =
  "Integration Suite message metering counts every 250 KB block as a billable message, so large IDoc payloads cost more than teams expect.\n\nCheck the Usage tile in the BTP cockpit monthly and split oversized payloads at the source.\n\nCosts rose 40% last year for teams that ignored it.\n\nLarkwell Consulting helps teams size Integration Suite before the bill arrives.";
let reviewCalls = 0;
const calls = { plan: 0, learn: 0, title: 0 };
let learnPrompt = "";
let planPrompt = "";
function chatReply(body) {
  const keys = Object.keys(body.format?.properties || {});
  const user = body.messages.find((m) => m.role === "user")?.content || "";
  const has = (...k) => k.every((x) => keys.includes(x));
  if (has("picks")) {
    calls.plan++;
    planPrompt = user;
    // The Strategist's piece, as listed in the prompt ("- pp-1-<time>: blog ...").
    const pieceId = (user.match(/^- (pp-\d+-\d+):/m) || [])[1];
    return {
      picks: [
        { kind: "blog", keyword: "sap basis managed services cost", serviceId: "basis", angle: "The model's loose retelling of the angle", why: "Search Console shows this query close to page one.", evidence: ["GSC: sap basis managed services cost"], planPieceId: pieceId },
        { kind: "linkedin", serviceId: "btp", postType: "how-to", angle: "BTP consumption credits forecast overruns and budget control", why: "Repeats a recent theme (the critic should catch it).", planPieceId: "pp-made-up" },
        { kind: "linkedin", serviceId: "integration", postType: "how-to", angle: "Integration Suite message metering", why: "Timely: SAP changed message metering.", evidence: ["news"] },
        { kind: "linkedin", serviceId: "fiori", postType: "hot-take", angle: "Fiori launchpad clutter", why: "Fiori is our least-covered service." },
      ],
      research: [{ topic: "How do mid-size SAP customers budget for Basis support?", front: "content-seo", why: "gap in our data" }],
      recommendations: [{ title: "Rewrite the Basis page title to match the query", detail: "Lead with 'SAP Basis managed services'.", why: "CTR gap", effort: "small" }],
    };
  }
  if (has("confirmed", "contradicted", "newRules")) {
    calls.learn++;
    learnPrompt = user;
    const id = (user.match(/^(pb-[\d-]+):/m) || [])[1];
    return {
      confirmed: id ? [{ ruleId: id, because: "the rejection reason matches it" }] : [],
      contradicted: [],
      newRules: [{ kind: "voice", text: "Name the SAP release or transaction in the first line of every LinkedIn post.", because: "edits keep adding it" }],
    };
  }
  if (has("score", "buyerFit")) {
    reviewCalls++;
    const good = /REVISED/.test(user) || /## /.test(user);
    return good ? { score: 8, buyerFit: true, onBrand: true, problems: [], fix: "" } : { score: 6, buyerFit: true, onBrand: false, problems: ["too generic"], fix: "Make it more specific." };
  }
  if (has("hook", "body", "hashtags")) {
    const angle = (user.match(/EDITOR'S ADJUSTMENT[^\n]*/) || [""])[0];
    if (/Fiori/i.test(angle)) return { hook: "Fiori launchpad clutter is a design choice, not fate.", body: "Group tiles by role in the launchpad designer and retire what nobody opens; the Fiori apps library shows usage.\n\nLarkwell Consulting helps teams tidy the launchpad.", hashtags: [] };
    if (/BTP consumption credits/i.test(angle)) return { hook: "BTP consumption credits forecast overruns budget control matters", body: "Forecast credits monthly in the BTP cockpit.", hashtags: [] };
    return { hook: "Integration Suite bills every 250 KB block as a message.", body: POST_BODY, hashtags: [] };
  }
  if (has("hook", "body")) {
    // Revise: drop the unsourced stat and mark the rewrite.
    const cur = (user.split("THE CURRENT DRAFT:")[1] || "").split("EDITOR'S BRIEF")[0].trim();
    const [hook, ...rest] = cur.split("\n");
    return { hook, body: "REVISED " + rest.join("\n").trim().replace(/\n\nCosts rose 40% last year for teams that ignored it\./, "") };
  }
  if (has("title", "metaDescription", "slug", "outline", "intro")) {
    return {
      title: "SAP Basis Managed Services Cost: What Mid-Size Enterprises Actually Pay and Why",
      metaDescription: "What SAP Basis managed services cost, what drives the price, and how to compare providers without surprises in the contract or the support model.",
      slug: "sap-basis-managed-services-cost",
      outline: ["What is included", "What drives the price"],
      intro: "SAP Basis managed services cost depends on landscape size and support hours.",
    };
  }
  if (has("markdown")) {
    return { markdown: `## Section\n\nTeams optimize their SAP Basis spend by sizing support hours against the landscape, checking SM21 and ST22 trends, and agreeing who owns kernel patches. ${"Detail about Basis support. ".repeat(12)}` };
  }
  if (has("title") && keys.length === 1) {
    calls.title++;
    return { title: "SAP Basis Managed Services Cost Explained" };
  }
  if (has("title", "metaDescription", "body")) return { title: "x", metaDescription: "y", body: "REVISED" };
  return {};
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  if (u.endsWith("/api/version")) return ok({ version: "test" });
  if (u.endsWith("/api/tags")) return ok({ models: [{ name: "nomic-embed-text:latest" }] });
  if (u.endsWith("/api/embeddings")) return ok({ embedding: vec(JSON.parse(opts.body).prompt) });
  if (u.endsWith("/api/chat")) {
    const body = JSON.parse(opts.body);
    return ok({ message: { content: JSON.stringify(chatReply(body)) }, prompt_eval_count: 10, eval_count: 10 });
  }
  throw new Error(`offline in tests: ${u}`);
};

// ---------- modules under test ----------
const PB = await import(pathToFileURL(path.join(box, "server/playbook.js")).href);
const FS = await import(pathToFileURL(path.join(box, "server/fresh-start.js")).href);
const C = await import(pathToFileURL(path.join(box, "server/critic.js")).href);
const D = await import(pathToFileURL(path.join(box, "server/drafts.js")).href);
const ST = await import(pathToFileURL(path.join(box, "server/stores.js")).href);
const SE = await import(pathToFileURL(path.join(box, "server/session.js")).href);
const G = await import(pathToFileURL(path.join(box, "server/guardrails.js")).href);
const now = () => new Date().toISOString();

console.log("\n# playbook");
check(PB.ensureSeeded(now()) >= 20, "seeds the starting rules once");
check(PB.ensureSeeded(now()) === 0, "never re-seeds");
const firstRule = PB.listRules()[0];
const up = PB.reinforce(firstRule.id, +1, "test", now());
check(up.after === Math.round((up.before + 0.05) * 100) / 100, `confirming raises confidence (${up.before} → ${up.after})`);
const down = PB.reinforce(firstRule.id, -1, "test", now());
check(Math.abs(down.after - (up.after - 0.1)) < 0.001, `contradicting lowers it more (${down.after})`);
check(PB.addRule({ kind: "voice", text: PB.listRules()[1].text, source: "you" }, now()).merged, "a near-duplicate rule reinforces instead of duplicating");
const s0 = ST.load("playbook");
const old = s0.rules.find((r) => !r.pinned);
old.lastSeenAt = iso(15 * day);
old.lastDecayAt = undefined;
const confBefore = old.confidence;
ST.persist("playbook", s0);
const decayed = PB.decay(now()).find((c) => c.id === old.id);
check(decayed && Math.abs(decayed.after - (confBefore - 0.04)) < 0.001, "two unconfirmed weeks fade a rule by 0.04");
check(PB.playbookBlock().length > 100 && PB.playbookBlock().length <= 3500, "prompt block is present and capped");

console.log("\n# guardrails / critic");
check(G.scrubUkSpelling("We optimize the data center").text === "We optimise the data centre", "UK spelling");
check(G.scrubUkSpelling("Azure prize size").changed.length === 0, "UK spelling leaves size/prize/Azure alone");
check(C.unsourcedFigures("Costs rose 40% and 7 in 10 CIOs agree", "Gartner: 7 in 10 CIOs").join() === "40%", "flags only the figure with no source");
check(C.HOOK_FORMULA.test("A migration strategy based on assumptions often fails."), "spots the recycled 'often fails' hook");
check(!!C.repeatsTheme({ hook: "BTP consumption credits forecast overruns budget" }, [{ hook: "BTP consumption credits forecast overruns budget control" }]), "spots a repeated theme");
check(G.scrubUkSpelling("https://www.larkwell.example/optimizing-sap and [x](/abap-modernization)").changed.length === 0, "UK spelling never touches URLs or link targets");
check(G.scrubUkSpelling("a customer-centered team").text === "a customer-centred team", "centered → centred");
check(G.scrubUkSpelling("SPRO Customizing and the Plan Visualizer").changed.length === 0, "SAP product terms keep SAP's spelling");
check(C.unsourcedFigures("$1,000 saved", "costs of 1,000 dollars").length === 0, "thousands separators match their source");
check(G.applyToBlog({ title: "SAP Basis Managed Services Cost: What Mid-Size Enterprises Actually Pay", metaDescription: "m", body: "b" }).titleCut === true, "flags a title that had to be cut");

console.log("\n# drafts keep the AI original");
const rec = D.saveDraft({ kind: "linkedin", payload: { hook: "AI hook", body: "AI body", source: "model" }, nowISO: now() });
D.updateDraft(rec.id, { payload: { hook: "Human hook", body: "Human body" } }, now());
const edited = D.listDrafts().find((d) => d.id === rec.id);
check(edited.payload.aiOriginal?.body === "AI body" && edited.payload.body === "Human body", "an edit keeps aiOriginal");

console.log("\n# fresh start");
const preview = FS.freshStartPreview().counts;
check(preview.draftsToArchive === 4 && preview.draftsKept === 2, `preview: archive ${preview.draftsToArchive}, keep ${preview.draftsKept}`);
const wikiBefore = fs.readFileSync(path.join(box, "wiki/sap-basis.md"), "utf8");
const m = FS.runFreshStart(now(), { by: "test" });
check(read("findings.json").length === 0 && read("recommendations.json").length === 0 && read("directives.json").length === 0, "findings, recommendations, directives cleared");
check(read("research-queue.json").length === 0 && read("taste.json").length === 0, "queue and old taste cleared");
const after = D.listDrafts();
check(after.filter((d) => d.status === "archived").length === 4, "4 unreviewed drafts archived");
check(after.find((d) => d.id === "d-keep-1").status === "approved" && after.find((d) => d.id === "d-keep-2").status === "posted", "approved/posted drafts untouched");
check(after.find((d) => d.id === "d-old-2").archivedFrom === "delete" && after.find((d) => d.id === "d-old-2").prevStatus === "draft", "a delete-marked draft remembers both statuses");
check(fs.readFileSync(path.join(box, "wiki/sap-basis.md"), "utf8") === wikiBefore, "wiki untouched");
check(fs.existsSync(path.join(box, "data/archive", m.id, "findings.json")), "snapshot written");
check(FS.findingById("f-1")?.url === "https://example.com/a", "archived finding still resolvable");
check(PB.listRules().some((r) => r.source === "research" && r.confidence === 0.4), "open directive kept as a tentative rule (0.4)");
check(!PB.listRules().some((r) => /FinOps guide/.test(r.text)), "expired directive not imported");
check(FS.pendingArchivedRecs().recs.map((r) => r.id).join() === "rec-1", "open recommendation queued for re-check");

console.log("\n# a whole session");
// Reviewer signals since the last session: a rejection with a reason + an edit.
const rec2 = D.saveDraft({ kind: "linkedin", payload: { hook: "AI hook two", body: "AI wording", source: "model", origin: "jarvis" }, nowISO: now() });
D.updateDraft(rec2.id, { payload: { hook: "AI hook two", body: "Human body after the fresh start" } }, now());
ST.addTasteEvent({ event: "rejected", kind: "linkedin", serviceId: "s4hana", reason: "made-up statistic", text: "Old unreviewed post" }, now());
// The Strategist's plan for the week: Jarvis should pick from it.
const WP = await import(pathToFileURL(path.join(box, "server/week-plan.js")).href);
const filed = WP.saveWeekPlan({ focus: "Own the Basis support cost question this week.", pieces: [{ kind: "blog", keyword: "sap basis managed services cost", serviceId: "basis", angle: "What drives Basis support cost", why: "Position 9 in Search Console." }], avoid: ["Clean Core"] }, now());
const brief = await SE.runSession({ deadlineMs: Date.now() + 60 * 60000, by: "test" });
const st = ST.load("session");
check(!!brief && st.phase === "done" && !st.running, `session finished (${brief?.headline})`);
check(calls.learn === 1 && /made-up statistic/.test(learnPrompt) && /Human body/.test(learnPrompt), "learn saw the rejection reason and the human edit");
check(PB.listRules().some((r) => /release or transaction in the first line/.test(r.text) && r.confidence === 0.5), "learned a new rule at 0.5");
check(calls.plan === 1 && st.picks.length === 4 && st.picks.every((p) => p.why), "planned 4 picks, each with a why");
check(/WEEK'S PLAN FROM THE STRATEGIST/.test(planPrompt) && /Own the Basis support cost question/.test(planPrompt) && /leave these alone this week: Clean Core/.test(planPrompt), "the planning prompt carries the week's plan, its focus and what to avoid");
check(st.picks[0].planPieceId === filed.plan.pieces[0].id && st.picks[1].planPieceId === null, "a pick keeps a real plan piece id; a made-up one is dropped");
check(st.picks[0].angle === "What drives Basis support cost", "a pick from the plan takes the plan's own angle, not the model's retelling");
check(read("research-queue.json").some((t) => t.createdBy === "jarvis"), "queued a research question");
check(read("recommendations.json").some((r) => /Basis page title/.test(r.title)), "filed a site recommendation");
check(FS.pendingArchivedRecs().recs.length === 0, "archived recommendations marked as re-checked");
const made = D.listDrafts().filter((d) => d.payload?.origin === "jarvis" && d.payload?.why);
const blog = made.find((d) => d.kind === "blog");
const post = made.find((d) => d.kind === "linkedin" && /Integration Suite/.test(d.payload.hook));
check(blog && blog.payload.planPieceId === filed.plan.pieces[0].id && WP.currentPlan().pieces[0].draftId === blog.id && WP.openPieces().length === 0 && WP.currentPlan().pieces[0].attempts === 0, "the blog written from the plan is recorded against its piece");
check(made.length === 3, `saved 3 drafts (1 blog + 2 posts), got ${made.length}`);
check(blog && blog.payload.title === "SAP Basis Managed Services Cost Explained" && calls.title >= 1, `blog got a complete new title ("${blog?.payload.title}")`);
check(blog && /optimise/.test(blog.payload.body) && !/optimize/.test(blog.payload.body), "blog body is in UK spelling");
check(post && !/40%/.test(post.payload.body), "unsourced 40% removed from the post");
check(post && post.payload.critique?.score === 8 && post.payload.critique?.revisions === 1, "post passed the critic after 1 rewrite");
check(made.every((d) => d.payload.why && d.payload.aiOriginal && !("titleCut" in d.payload)), "every draft carries why + aiOriginal");
check(st.discarded.some((d) => /too close to/.test(d.reason)), "repeated BTP theme thrown away");
check(made.some((d) => d.payload.serviceId === "fiori"), "the backup pick filled the gap");
const briefs = read("briefs.json");
check(briefs.length === 1 && briefs[0].produced.length === 3 && briefs[0].needs.length >= 1, "daily brief written with needs");

console.log("\n# reviews made during a session are learned next time");
const firstObserved = ST.load("session").observedUpTo;
ST.addTasteEvent({ event: "rejected", kind: "blog", reason: "wrong buyer", text: "late review" }, new Date(Date.parse(firstObserved) + 1000).toISOString());
calls.learn = 0;
await SE.runSession({ deadlineMs: Date.now() + 60 * 60000, by: "test" });
check(calls.learn === 1 && /wrong buyer/.test(learnPrompt), "a review made mid-session reaches the next session");

console.log("\n# archived delete-marker back to To delete");
const dm = D.listDrafts().find((d) => d.id === "d-old-2");
D.updateDraft("d-old-2", { status: "delete" }, now());
check(D.listDrafts().find((d) => d.id === "d-old-2").prevStatus === (dm.prevStatus || "draft"), "keeps its original prevStatus");
D.updateDraft("d-old-2", { status: "archived" }, now());

console.log("\n# restore");
const r = FS.restoreFreshStart(m.id, now());
const back = D.listDrafts();
check(r.restored.drafts === 4 && back.find((d) => d.id === "d-old-2").status === "delete" && back.find((d) => d.id === "d-old-2").prevStatus === "draft" && back.find((d) => d.id === "d-old-1").status === "draft", "drafts back to their old status");
check(read("findings.json").some((f) => f.id === "f-1") && read("recommendations.json").some((x) => x.id === "rec-1"), "archived lists merged back");
check(back.filter((d) => d.payload?.origin === "jarvis" && d.payload?.why).length >= 3, "new session drafts survive the restore");

fs.rmSync(box, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
