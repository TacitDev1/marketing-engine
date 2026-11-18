#!/usr/bin/env node
// Tests for phase 2 of the agent team (2026-11-12): the Editor's verdicts and
// the "cleared to publish" gate (server/editor.js), automatic blog publishing
// (server/autopublish.js) and the weekly summary (server/weekly-summary.js).
//
// Runs against a throwaway copy of server/ + src/lib/ in a temp folder. The
// website repo, Go Live, GA4 and Teams are all faked, so nothing real is
// touched or sent.
//
//   node scripts/test-publishing.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const box = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-publishing-"));
fs.cpSync(path.join(root, "server"), path.join(box, "server"), { recursive: true });
fs.cpSync(path.join(root, "src/lib"), path.join(box, "src/lib"), { recursive: true });
fs.symlinkSync(path.join(root, "node_modules"), path.join(box, "node_modules"), process.platform === "win32" ? "junction" : "dir");
fs.mkdirSync(path.join(box, "data"));
fs.mkdirSync(path.join(box, "wiki"));

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures++;
};
const write = (f, v) => fs.writeFileSync(path.join(box, "data", f), JSON.stringify(v));
const read = (f) => JSON.parse(fs.readFileSync(path.join(box, "data", f), "utf8"));

process.env.JARVIS_TZ = "UTC";
process.env.JARVIS_WINDOW_START = "15";
process.env.JARVIS_WINDOW_END = "17";
delete process.env.MKT_TEAMS_WEBHOOK;

// Dates: Monday 9 Nov 2026 is a publishing day (Mon/Wed/Fri by default).
const at = (s) => new Date(`${s}Z`);
const MON_1605 = at("2026-11-09T16:05:00");
const iso = (d) => d.toISOString();
const savedAt = "2026-11-09T15:20:00.000Z";

// A complete blog body: headings, over 300 words, ends on a full sentence, no figures.
const para = (topic) =>
  `Most teams meet ${topic} later than they should, and the delay shapes every decision that follows. The work itself is not mysterious. It needs someone who owns it, a written plan the business has agreed, and a test that proves the result before anyone depends on it. When those three things are missing, the project drifts, the people closest to the system fill the gaps from memory, and the eventual fix costs more than the plan would have. Larkwell sees the same pattern in landscapes of every size, which is why the first conversation is about ownership and evidence before it is about tools.`;
const body = (topic) => [`## Why ${topic} gets left late`, para(topic), `## What a workable plan contains`, para(`the plan for ${topic}`), `## How to prove it worked`, para(`testing ${topic}`), `## Where to start this quarter`, para(`the first step on ${topic}`)].join("\n\n");
const blog = (id, title, topic, extra = {}) => ({
  id,
  kind: "blog",
  status: "draft",
  savedAt,
  updatedAt: savedAt,
  payload: { title, metaDescription: `A practical look at ${topic} for SAP teams: who should own it, what the plan must contain, and how to prove the result before go-live day arrives.`, body: body(topic), slug: id, keyword: topic, serviceId: "basis", origin: "jarvis", ...extra },
});
write("drafts.json", [
  blog("b-good", "SAP system copies without the weekend scramble", "system copies"),
  blog("b-figures", "Patching SAP kernels on a fixed calendar", "kernel patching"),
  blog("b-seven", "Transport governance for mixed landscapes", "transport governance"),
  blog("b-approved", "Printing and output management after go-live", "output management", {}),
  { id: "l-post", kind: "linkedin", status: "draft", savedAt, updatedAt: savedAt, payload: { hook: "Disaster recovery plans are tested less often than they are written.", body: "A plan nobody has rehearsed is a document, not a capability. Run the failover once a year and write down what broke.", serviceId: "dr", postType: "hot-take", origin: "jarvis" } },
  { id: "l-reject", kind: "linkedin", status: "draft", savedAt, updatedAt: savedAt, payload: { hook: "Thoughts on the weather in data centres.", body: "It is warm.", origin: "jarvis" } },
  { id: "l-old", kind: "linkedin", status: "approved", savedAt, updatedAt: savedAt, payload: { hook: "Already approved by a person.", body: "x" } },
]);

const editor = await import(pathToFileURL(path.join(box, "server/editor.js")).href);
const autopublish = await import(pathToFileURL(path.join(box, "server/autopublish.js")).href);
const summary = await import(pathToFileURL(path.join(box, "server/weekly-summary.js")).href);
const drafts = await import(pathToFileURL(path.join(box, "server/drafts.js")).href);
const get = (id) => drafts.listDrafts().find((d) => d.id === id);
// A person approved one blog in the Library.
drafts.updateDraft("b-approved", { status: "approved" }, savedAt);

// ---------- the Editor ----------
const q = editor.editorQueue();
check(q.waiting === 5 && q.drafts[0].kind === "blog" && q.drafts.at(-1).kind === "linkedin", "the queue holds the unreviewed drafts, blogs first");
check(!q.drafts.some((d) => d.id === "l-old" || d.id === "b-approved"), "drafts a person already reviewed are not in the queue");
check(q.clearScore === 8 && Array.isArray(q.knownClients) && q.knownClients.includes("Brackenfield Waste"), "the queue tells the Editor the publish bar and the clients that may be named");

let r = editor.applyEditorVerdict("b-good", { verdict: "pass", score: 9, body: `${body("system copies")}\n\nTeams that optimize this early have fewer surprises.`, changes: "tightened the intro" }, iso(MON_1605));
check(r.editor.cleared === true && r.editor.issues.length === 0, `a complete, clean blog passed at 9 is cleared to publish (issues: ${JSON.stringify(r.editor?.issues)})`);
check(/optimise this early/.test(get("b-good").payload.body) && get("b-good").status === "draft", "the Editor's text is saved, through the guardrails (UK spelling)");

r = editor.applyEditorVerdict("b-figures", { verdict: "pass", score: 9, body: `${body("kernel patching")}\n\nA fixed calendar cuts unplanned downtime by 43% in the first year.` }, iso(MON_1605));
check(r.editor.cleared === false && r.editor.issues.some((i) => i.code === "unsourced_figures"), "a figure with no source blocks clearing, whatever score the Editor gave");
r = editor.applyEditorVerdict("b-figures", { verdict: "pass", score: 10, body: body("kernel patching") }, iso(MON_1605));
check(r.error === undefined && r.editor.cleared === true, "the Editor can fix the issue and send the draft again");

r = editor.applyEditorVerdict("b-seven", { verdict: "pass", score: 7 }, iso(MON_1605));
check(r.editor.cleared === false && r.editor.issues.length === 0 && get("b-seven").status === "draft", "a sound blog under the publish bar stays in the Library, not cleared");

r = editor.applyEditorVerdict("l-post", { verdict: "pass", score: 9 }, iso(MON_1605));
check(r.editor.cleared === false && r.editor.verdict === "pass", "a LinkedIn post is never cleared for automatic publishing");

check(editor.applyEditorVerdict("l-reject", { verdict: "reject", score: 2 }, iso(MON_1605)).error === "reason_required", "a rejection needs a reason");
r = editor.applyEditorVerdict("l-reject", { verdict: "reject", score: 2, reason: "No line to any Larkwell service." }, iso(MON_1605));
check(get("l-reject").status === "archived" && get("l-reject").archivedFrom === "draft" && get("l-reject").payload.editor.reason === "No line to any Larkwell service.", "a rejected draft is archived with the reason, not deleted");
check(read("taste.json").some((e) => e.event === "rejected" && e.draftId === "l-reject" && /^Editor: No line/.test(e.reason)), "the rejection and its reason are recorded for Jarvis to learn from");
check(editor.applyEditorVerdict("l-old", { verdict: "pass", score: 9 }, iso(MON_1605)).error === "not_a_draft", "the Editor cannot touch a draft a person already approved");
check(editor.applyEditorVerdict("nope", { verdict: "pass", score: 9 }, iso(MON_1605)).error === "not_found", "an unknown draft is reported");
check(editor.applyEditorVerdict("b-seven", { verdict: "maybe", score: 9 }, iso(MON_1605)).error === "verdict_required", "an unknown verdict is refused");
check(editor.editorQueue().waiting === 0, "edited drafts leave the queue");

// A blog a person approved can also be cleared by hand-setting nothing: only
// the Editor's verdict clears. Give the approved blog a verdict the way the
// Editor would have before the approval.
const approved = get("b-approved");
drafts.updateDraft("b-approved", { payload: { ...approved.payload, editor: { verdict: "pass", score: 8, cleared: true, issues: [], at: iso(MON_1605) } } }, iso(MON_1605));

// ---------- automatic publishing ----------
const pushed = [];
let pushOk = true;
const deps = {
  isServer: () => true,
  siteAvailable: () => true,
  exportBlogDraft: (d, opts) => ({ ok: true, rel: `src/content/news/en/${d.id}.md`, slug: d.id, published: opts.publish, overwritten: !!opts.overwriteRel }),
  goLive: async ({ rels }) => {
    if (!pushOk) return { ok: false, error: "push_rejected", message: "remote said no" };
    pushed.push(...rels);
    return { ok: true, committed: rels.map((rel) => ({ rel })) };
  },
};
const run = (d, extra = {}) => autopublish.runAutoPublish(iso(d), { deps: { ...deps, ...extra } });

check(autopublish.publishCandidates().map((d) => d.id).join() === "b-approved", "only a blog a person approved can go out");
check(autopublish.awaitingApproval().map((d) => d.id).join() === "b-figures,b-good", "blogs the Editor cleared wait for a person's approval, best first");

// ---------- the week ahead and the approval note ----------
process.env.MKT_APP_URL = "https://marketing.example";
const ahead = await import(pathToFileURL(path.join(box, "server/week-ahead.js")).href);
const teams = await import(pathToFileURL(path.join(box, "server/teams.js")).href);
const MON_0805 = at("2026-11-09T08:05:00");
const wa = ahead.buildWeekAhead(iso(MON_0805));
check(wa.days.map((d) => d.name).join() === "Monday,Tuesday,Wednesday,Thursday,Friday", "the week ahead covers Monday to Friday");
check(wa.approvals.map((a) => a.id).join() === "b-figures,b-good" && wa.approvals[0].url === "https://marketing.example/?screen=library&draft=b-figures", "it lists the blogs waiting for approval, each with a link that opens it");
check(/goes live from 16:00: "Printing and output management after go-live" \(approved\)/.test(wa.days[0].lines.join(" ")), "Monday shows the approved blog going live");
check(/goes live only if someone approves it first/.test(wa.days[2].lines.join(" ")) && /Patching SAP kernels/.test(wa.days[2].lines.join(" ")), "Wednesday shows the next blog, which still needs approval");
check(wa.days[1].lines.some((l) => /^SEO agent:/.test(l)) && wa.days[4].lines.some((l) => /^Strategist agent:/.test(l)) && !wa.days[1].lines.some((l) => /publishing day|goes live/.test(l)), "each day lists the agents that run and only publishing days mention a blog going out");
check(/Waiting for your approval \(2\)/.test(ahead.weekAheadText(wa)) && /\[Patching SAP kernels on a fixed calendar\]\(https:\/\/marketing\.example/.test(ahead.weekAheadText(wa)), "the message leads with the approvals");
check(ahead.buildWeekAhead("2026-11-14T10:00:00.000Z").days[0].dateKey === "2026-11-16" && ahead.buildWeekAhead("2026-11-11T10:00:00.000Z").days.length === 3, "built at a weekend it covers next week; built midweek, the days that are left");
check(!ahead.weekAheadDue(MON_0805) && !ahead.weekAheadDue(at("2026-11-09T14:55:00")) && ahead.weekAheadDue(at("2026-11-09T15:01:00")) && ahead.weekAheadDue(at("2026-11-10T15:05:00")) && !ahead.weekAheadDue(at("2026-11-07T15:30:00")), "due from Monday 15:00, still due on Tuesday if the server was off, never at a weekend");
let sentCard = null;
const sentWa = await ahead.sendWeekAhead(iso(at("2026-11-09T15:02:00")), { send: async (w) => ((sentCard = w), { channel: "teams", status: "sent" }) });
check(sentWa.delivery.status === "sent" && sentCard.approvals.length === 2 && read("week-ahead.json").length === 1, "the week ahead is sent and kept");
check(!ahead.weekAheadDue(at("2026-11-09T15:10:00")) && !ahead.weekAheadDue(at("2026-11-12T15:10:00")) && ahead.weekAheadDue(at("2026-11-16T15:05:00")), "it is sent once a week");
const card = teams.teamsCard({ title: "T", sections: [{ title: "S", lines: ["a", "b"] }], actions: [{ title: "Open", url: "https://marketing.example/x" }] });
check(card.attachments[0].content.actions[0].type === "Action.OpenUrl" && card.attachments[0].content.body[2].text === "- a\n- b", "a Teams card carries its sections and a button that opens the app");
let note = null;
await ahead.announceForApproval(get("b-figures"), { send: async (c) => ((note = c), { status: "sent" }) });
check(/^Blog ready for your approval: Patching SAP kernels/.test(note.title) && note.actions[0].url.endsWith("draft=b-figures") && /Nothing goes out before that/.test(note.sections[1].lines.join(" ")), "a cleared blog is announced with a link to read and approve it");
delete process.env.MKT_APP_URL;

check((await run(MON_1605, { isServer: () => false })).skipped === "not_the_server", "a laptop never publishes");
check((await run(at("2026-11-10T16:05:00"))).skipped === "not_a_publishing_day", "nothing goes out on a non-publishing day");
check((await run(at("2026-11-09T15:30:00"))).skipped === "too_early", "nothing goes out before the Editor has had time");
autopublish.updatePublishing({ enabled: false }, iso(MON_1605));
check((await run(MON_1605)).skipped === "switched_off", "the off switch stops publishing");
autopublish.updatePublishing({ enabled: true }, iso(MON_1605));

pushOk = false;
r = await run(MON_1605);
check(r.skipped === "failed" && get("b-approved").status === "approved" && get("b-approved").payload.exportedRel === "src/content/news/en/b-approved.md", "a failed push is logged and the draft keeps its file link for the retry");
await run(MON_1605);
await run(MON_1605);
check((await run(MON_1605)).skipped === "gave_up_today", "after three failed pushes it stops trying that day");

// Next publishing day (Wednesday): the push works.
pushOk = true;
const WED = at("2026-11-11T16:10:00");
r = await run(WED);
check(r.published?.draftId === "b-approved" && r.published.url === "https://larkwell.example/news/b-approved" && pushed.join() === "src/content/news/en/b-approved.md", "the best cleared blog is written visible and pushed");
check(get("b-approved").status === "posted" && get("b-approved").payload.autoPublishedAt && get("b-approved").payload.publishedUrl, "the draft is marked posted with its public link");
check((await run(at("2026-11-11T16:20:00"))).skipped === "already_published_today", "one post a day at most");
check(!read("taste.json").some((e) => e.event === "posted"), "an automatic publish is not recorded as a person's approval");
const st = autopublish.publishingStatus();
check(st.waiting === 0 && st.next === null && st.awaitingApproval.length === 2 && st.awaitingApproval[0].id === "b-figures" && st.recent[0].status === "published" && st.canPublish === false, "status shows what is waiting for approval and what went out (and that this machine cannot publish)");
const FRI = at("2026-11-13T16:10:00");
check((await run(FRI)).skipped === "nothing_approved" && get("b-figures").status === "draft", "a cleared blog nobody approved is not published, whatever its score");
const early = await summary.buildWeeklySummary(iso(FRI), { traffic: async () => null });
check(early.needs.some((n) => /2 blogs edited and ready for you to approve/.test(n) && /Nothing is published until you approve/.test(n)), "the weekly summary asks for the approval");
drafts.updateDraft("b-figures", { status: "approved" }, iso(FRI));
r = await run(FRI);
check(r.published?.draftId === "b-figures", "once a person approves it, it goes out on the next publishing day");
autopublish.updatePublishing({ days: [2, 9, "x"], afterHour: 15 }, iso(WED));
check(autopublish.publishingStatus().days.join() === "2" && autopublish.publishingStatus().afterHour === 15, "days and the start hour can be changed; bad values are dropped");

// ---------- the weekly summary ----------
const FRI_1640 = at("2026-11-13T16:40:00");
const s = await summary.buildWeeklySummary(iso(FRI_1640), { traffic: async () => "Website, last 28 days (GA4): 23 sessions, 22 visitors." });
check(s.published.length === 2 && s.published.some((p) => p.url === "https://larkwell.example/news/b-approved"), "the summary lists what was published, with links");
check(s.failedPublishes.length === 0, "a blog that failed and then went out is not reported as failed");
check(s.editor.passed === 5 && s.editor.rejected.length === 1 && s.written.blogs === 4 && s.written.linkedin === 3, `it counts the week's writing and editing (passed ${s.editor.passed}, rejected ${s.editor.rejected.length}, blogs ${s.written.blogs}, posts ${s.written.linkedin})`);
check(s.linkedinReadyCount === 1 && s.needs.some((n) => /LinkedIn post edited and waiting/.test(n)), "it says a LinkedIn post is waiting for a person");
check(s.needs.some((n) => /Researcher agent did not run/.test(n)), "it flags an agent that did not run");
const text = summary.summaryText(s);
check(/week ending 2026-11-13/.test(text) && /Published on larkwell.example/.test(text) && /Needs you/.test(text) && /23 sessions/.test(text), "the text version has every section");

check(summary.summaryDue(at("2026-11-12T16:40:00")) === false, "not due on a Thursday");
check(summary.summaryDue(at("2026-11-13T16:00:00")) === false, "not due before 16:30 on Friday");
check(summary.summaryDue(FRI_1640) === true, "due on Friday from 16:30");
let sent = null;
const rec = await summary.sendWeeklySummary(iso(FRI_1640), { send: async (x) => ((sent = x), { channel: "teams", status: "sent" }), traffic: async () => null });
check(sent && rec.delivery.status === "sent" && rec.text && summary.listSummaries()[0].id === rec.id, "the summary is sent and kept");
check(summary.summaryDue(at("2026-11-13T16:50:00")) === false, "it is sent once");
check(summary.summaryDue(at("2026-11-16T16:40:00")) === false && summary.summaryDue(at("2026-11-23T16:40:00")) === true, "a missed Friday is made up on the next day the server is on");
const byHand = await summary.sendWeeklySummary(iso(at("2026-11-20T10:00:00")), { by: "you", traffic: async () => null });
check(byHand.delivery.status === "not_configured" && summary.summaryDue(at("2026-11-20T16:40:00")) === true, "a summary sent by hand is kept in the app and does not replace the scheduled one");

// ---------- approving in Teams ----------
const ap = await import(pathToFileURL(path.join(box, "server/approvals.js")).href);
const FRI_ISO = iso(at("2026-11-13T15:05:00"));
check((await ap.requestApproval("b-good", FRI_ISO)).status === "not_configured", "with no approval workflow set up nothing is sent");
process.env.MKT_APPROVAL_REQUEST_WEBHOOK = "https://flow.example/request";
process.env.MKT_APPROVAL_FETCH_WEBHOOK = "https://flow.example/fetch";
const calls = [];
let reply = () => ({ ok: true, status: 202, text: async () => "" });
const fetcher = async (url, opts) => (calls.push({ url, body: JSON.parse(opts.body) }), reply(url));
r = await ap.requestApproval("b-good", FRI_ISO, { fetcher });
const cardSent = calls[0]?.body.card;
check(r.status === "sent" && calls[0].url === "https://flow.example/request" && calls[0].body.draftId === "b-good" && calls[0].body.kind === "blog", "a cleared blog is sent to the approval workflow");
check(cardSent.actions.map((x) => `${x.data.decision}:${x.data.draftId}`).join() === "approve:b-good,revise:b-good,drop:b-good" && cardSent.body.some((b) => b.type === "Input.Text" && b.id === "reason") && cardSent.body.some((b) => /What a workable plan contains/.test(b.text || "")), "the card carries the whole blog, the Approve, Send back and Drop buttons and a reason box");
check(JSON.stringify(cardSent).length < 26000, "the card fits inside Teams' size limit");
check((await ap.requestApproval("b-good", FRI_ISO, { fetcher })).status === "already_sent" && calls.length === 1, "a draft is sent for approval once");
check((await ap.requestApproval("b-approved", FRI_ISO, { fetcher })).status === "not_waiting", "a draft that is no longer waiting is not sent");
reply = () => ({ ok: false, status: 502, text: async () => "bad gateway" });
r = await ap.requestApproval("b-seven", FRI_ISO, { fetcher });
check(r.status === "failed" && /502/.test(r.error) && ap.approvalsStatus().failed.some((f) => f.id === "b-seven") && ap.approvalsStatus().waiting.some((w) => w.id === "b-good"), "a failed send is recorded and shown; the sent one shows as waiting");

// Decisions come back the way a SharePoint list would return them.
reply = () => ({
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({
      value: [
        { ID: 1, Title: "b-good", Decision: "Approve", Reason: "", Responder: { displayName: "Mara" }, Created: "2026-11-13T09:12:00Z" },
        { ID: 2, Title: "b-seven", Decision: "Reject", Reason: "Too generic for our buyers.", Responder: "Tobias", Created: "2026-11-13T09:15:00Z" },
        { ID: 3, Title: "b-good", Decision: "Reject", Reason: "A second click.", Created: "2026-11-13T09:20:00Z" },
        { ID: 4, Title: "no-such-draft", Decision: "Approve" },
        { ID: 5, Title: "b-figures", Decision: "Maybe" },
      ],
    }),
});
const got = await ap.collectDecisions(FRI_ISO, { fetcher });
check(got.status === "ok" && got.applied.map((x) => x.result).join() === "approved,dropped,already_decided,unknown_draft", "decisions are applied once each; a second click and an unknown draft change nothing; an unreadable decision is skipped");
const stopSent = calls.find((c) => c.url.endsWith("/request") && c.body.card?.actions?.[0]?.data?.decision === "stop");
check(stopSent && stopSent.body.draftId === "b-good" && /Mara approved/.test(stopSent.body.card.body[0].text) && /publishes to larkwell.example on/.test(stopSent.body.card.body[1].text), "after an approval the chat gets a card that says who approved, when it goes out, and has a Stop button");
check(get("b-good").status === "approved" && get("b-good").payload.approval.by === "Mara" && get("b-good").payload.approval.via === "teams", "an approval in Teams marks the blog Approved and records who gave it");
check(autopublish.publishCandidates().some((d) => d.id === "b-good"), "the approved blog is now in line to publish");
check(get("b-seven").status === "archived" && read("taste.json").some((e) => e.event === "rejected" && e.draftId === "b-seven" && e.reason === "Too generic for our buyers."), "a rejection archives the draft and its reason reaches Jarvis");
check(read("taste.json").some((e) => e.event === "approved" && e.draftId === "b-good"), "the approval is recorded as a person's keep");
check((await ap.collectDecisions(FRI_ISO, { fetcher })).applied.length === 0, "collecting again applies nothing twice");
reply = () => ({ ok: true, status: 200, text: async () => "<html>sign in</html>" });
check((await ap.collectDecisions(FRI_ISO, { fetcher })).status === "failed" && ap.approvalsStatus().lastCollect.error, "an unreadable answer is reported, not applied");

// The rules: who may decide, stopping, sending back, dropping, chasing.
check(ap.isNamedApprover("Mara Venter") && ap.isNamedApprover("tobias example") && ap.isNamedApprover("Léna Example") && ap.isNamedApprover("LENA X") && ap.isNamedApprover("") && !ap.isNamedApprover("Maran Other") && !ap.isNamedApprover("Sam Visitor"), "only the named approvers count (a click with no name recorded is accepted)");
const decide = (rows) => {
  reply = (url) => (url.endsWith("/fetch") ? { ok: true, status: 200, text: async () => JSON.stringify(rows) } : { ok: true, status: 202, text: async () => "" });
  return ap.collectDecisions(FRI_ISO, { fetcher });
};
calls.length = 0;
let res = await decide([{ ID: 10, Title: "b-good", Decision: "stop", Reason: "", Responder: "Sam Visitor" }]);
check(res.applied[0].result === "not_an_approver" && get("b-good").status === "approved" && calls.some((c) => c.body.card?.actions?.[0]?.data?.decision === "stop"), "Stop from someone who is not an approver is ignored and the Stop card is offered again");
res = await decide([{ ID: 11, Title: "b-good", Decision: "stop", Reason: "The pricing changed yesterday.", Responder: "Jonas" }]);
check(res.applied[0].result === "stopped" && get("b-good").status === "draft" && get("b-good").payload.held.by === "Jonas" && !autopublish.publishCandidates().some((d) => d.id === "b-good"), "an approver's Stop pulls the blog out of the publishing line and holds it");
check((await ap.requestApproval("b-good", FRI_ISO, { fetcher })).status === "held", "a stopped piece is not sent round again by itself");
const told = [];
reply = (url) => (url.endsWith("/fetch") ? { ok: true, status: 200, text: async () => JSON.stringify([{ ID: 12, Title: "b-approved", Decision: "stop", Responder: "Jonas" }]) } : { ok: true, status: 202, text: async () => "" });
res = await ap.collectDecisions(FRI_ISO, { fetcher, tell: async (c) => told.push(c.title) });
check(res.applied[0].result === "too_late" && /Jonas pressed Stop on .* already been published/.test(told[0] || ""), "a blog that has already gone out cannot be stopped, and the chat is told so");

await ap.requestApproval("l-post", FRI_ISO, { fetcher });
calls.length = 0;
res = await decide([{ ID: 13, Title: "l-post", Decision: "approve", Responder: "Sam Visitor" }]);
check(res.applied[0].result === "not_an_approver" && get("l-post").status === "draft" && calls.some((c) => c.url.endsWith("/request") && c.body.draftId === "l-post"), "a click from someone who is not an approver changes nothing and the card is sent again");
res = await decide([{ ID: 14, Title: "l-post", Decision: "revise", Reason: "Open with the failover test, not the plan.", Responder: "Léna Example" }]);
const sentBack = get("l-post");
check(res.applied[0].result === "sent_back" && sentBack.status === "draft" && !sentBack.payload.editor && sentBack.payload.revision.by === "Léna Example", "Send back with a note returns the piece to the Editor");
const requeued = editor.editorQueue().drafts.find((d) => d.id === "l-post");
check(requeued && /Léna Example: Open with the failover test/.test(requeued.reviewerNote), "the Editor is given the reviewer's note");
editor.applyEditorVerdict("l-post", { verdict: "pass", score: 8, hook: "We ran the failover test before we wrote the plan.", changes: "Opened with the test." }, FRI_ISO);
calls.length = 0;
r = await ap.requestApproval("l-post", FRI_ISO, { fetcher });
const revised = calls[0]?.body.card;
check(r.status === "sent" && revised.body.some((b) => /Revised after Léna Example's note/.test(b.text || "")) && revised.actions.map((x) => x.data.decision).join() === "approve,drop", "the reworked piece comes back marked as revised, and can only be approved or dropped");
res = await decide([{ ID: 15, Title: "l-post", Decision: "revise", Reason: "Still not it.", Responder: "Mara" }]);
check(res.applied[0].result === "dropped" && get("l-post").status === "archived" && read("taste.json").some((e) => e.draftId === "l-post" && /Sent back a second time: Still not it/.test(e.reason)), "a second send-back drops the piece and Jarvis hears why");

// A blog a person sent back returns to them even when the Editor marks the rework under its bar.
const back = drafts.saveDraft({ kind: "blog", payload: { title: "Sizing HANA for a carve-out", metaDescription: get("b-approved").payload.metaDescription, body: get("b-approved").payload.body, slug: "sizing", keyword: "hana sizing", serviceId: "basis", origin: "jarvis", revision: { note: "Open with an example.", by: "Jonas" } }, nowISO: FRI_ISO });
const v = editor.applyEditorVerdict(back.id, { verdict: "pass", score: 7, notes: "No source for the technical statements.", changes: "Opened with an example." }, FRI_ISO);
check(v.editor.cleared === false && v.editor.issues.length === 0 && !autopublish.awaitingApproval().some((d) => d.id === back.id) === false, "a reworked blog under the Editor's bar still waits for the person who sent it back");
check(ap.approvalCard(get(back.id)).body.some((b) => /The Editor's reservations: No source/.test(b.text || "")), "its card shows the Editor's reservations");
await decide([{ ID: 30, Title: back.id, Decision: "approve", Responder: "Jonas" }]);
check(autopublish.publishCandidates().some((d) => d.id === back.id), "and once that person approves it, it is in line to publish");

// Nobody answers: one reminder after two working days, expiry after a week.
const quiet = drafts.saveDraft({ kind: "linkedin", payload: { hook: "Nobody will answer this one.", body: "Text.", origin: "jarvis" }, nowISO: FRI_ISO });
await ap.requestApproval(quiet.id, FRI_ISO, { fetcher });
const reminders = [];
const chase = (d) => ap.chaseApprovals(iso(at(d)), { send: async (c) => reminders.push(c), fetcher });
check((await chase("2026-11-16T15:05:00")).reminded.length === 0, "no reminder after one working day (the weekend does not count)");
check((await chase("2026-11-17T15:05:00")).reminded.join() === quiet.id && /still waiting for a decision/.test(reminders[0].title), "a reminder goes to the chat after two working days");
check((await chase("2026-11-18T15:05:00")).reminded.length === 0 && reminders.length === 1, "only one reminder is sent");
const tasteBefore = read("taste.json").length;
check((await chase("2026-11-21T15:05:00")).expired.join() === quiet.id && get(quiet.id).status === "archived" && read("taste.json").length === tasteBefore, "after a week it is archived as not reviewed, and Jarvis is not told it was rejected");

const liCard = ap.approvalCard(get("l-old"));
check(liCard.actions[0].title === "Approve" && /ready to post/.test(liCard.body[0].text), "a LinkedIn post's card says approving only marks it ready to post");
// ---------- pictures for LinkedIn posts ----------
const pics = await import(pathToFileURL(path.join(box, "server/post-images.js")).href);
fs.mkdirSync(path.join(box, "data/images"), { recursive: true });
const GIF = Buffer.from("GIF89a fake moving picture ÿþ bytes", "latin1");
fs.writeFileSync(path.join(box, "data/images/p-1.gif"), GIF);
const GREEN = "#3fff8f";
const picPost = drafts.saveDraft({
  kind: "linkedin",
  payload: { hook: "Fiori apps that nobody opens.", body: "Text.", serviceId: "fiori", origin: "jarvis", images: { options: [{ n: 1, kind: "ascii", label: "ASCII poster (Gear)", file: "p-1.png", gifFile: "p-1.gif" }, { n: 2, kind: "card", label: "Branded card", file: "p-2.png" }], settings: { icon: "Gear", colour: GREEN, cardStyle: "brand" }, chosen: null } },
  nowISO: FRI_ISO,
});
// "Change the pictures": what was picked is learned; "Keep as it is" and unknown values are not.
check(ap.applyDecision({ draftId: picPost.id, decision: "pictures", by: "Lena", change: { colour: "Green", cardStyle: "no-such-style" } }, FRI_ISO).result === "pictures", "a redraw request is accepted for a LinkedIn post");
const redraw = read("taste.json").find((e) => e.event === "redraw" && e.draftId === picPost.id);
check(redraw && redraw.detail.colour === GREEN && !("cardStyle" in redraw.detail) && !("icon" in redraw.detail), "the redraw is remembered with only what the person picked");
// Approve with picture 1: the choice is remembered with its look.
ap.applyDecision({ draftId: picPost.id, decision: "approve", by: "Lena", picture: 1, change: {} }, FRI_ISO);
const chosenEv = read("taste.json").find((e) => e.event === "picture" && e.draftId === picPost.id);
check(get(picPost.id).payload.images.chosen === 1 && chosenEv && chosenEv.detail.pick === "ascii" && chosenEv.detail.colour === GREEN, "the chosen picture is stored on the post and remembered with its colour");
const learned = pics.learnedPictureTaste(read("taste.json"));
check(learned.colour === GREEN && learned.order.length === 0, "two votes for green make it the starting colour; one pick does not yet decide the order");
check(pics.orderOptions([{ n: 1, kind: "ascii" }, { n: 2, kind: "card" }, { n: 3, kind: "photo" }], ["card"]).map((o) => `${o.n}${o.kind}`).join() === "1card,2ascii,3photo", "the kind people pick most is shown first and the options are numbered again");
check(pics.learnedPictureTaste([{ event: "picture", detail: { colour: GREEN } }, { event: "picture", detail: { colour: "#2e7bff" } }]).colour === undefined, "a tie decides nothing");
check(pics.settingsFrom({}, { colour: GREEN }).colour === GREEN && pics.settingsFrom({ colour: "Amber" }, { colour: GREEN }).colour === "#ffb63d", "a learned colour is the start, and a person's change wins over it");

// Two collections at once (the timer and a "collect now"): a decision is applied once,
// even when its follow-up (the next card) takes a while.
const twice = drafts.saveDraft({ kind: "linkedin", payload: { hook: "Collected twice?", body: "Text.", origin: "jarvis" }, nowISO: FRI_ISO });
let slowRows = [{ DraftId: twice.id, Decision: "approve", Reason: "", By: "Jonas", At: "2026-11-13T09:40:00Z" }];
const slow = async (url) => (await new Promise((r) => setTimeout(r, 50)), { ok: true, status: 200, text: async () => (url.endsWith("/fetch") ? JSON.stringify(slowRows) : "") });
const [c1, c2] = await Promise.all([ap.collectDecisions(FRI_ISO, { fetcher: slow }), ap.collectDecisions(FRI_ISO, { fetcher: slow })]);
check(c1.applied.filter((a) => a.draftId === twice.id).length + c2.applied.filter((a) => a.draftId === twice.id).length === 1, "two collections started together apply a decision once");

// The moving picture goes to the file store whole, and the link to the chat.
process.env.MKT_PICTURE_FILE_WEBHOOK = "https://flow.example/file";
process.env.MKT_PICTURE_WEBHOOK = "https://flow.example/pictures";
process.env.MKT_APPROVAL_CHAT_ID = "19:test-chat";
process.env.MKT_FILE_SITE_URL = "https://files.larkwell.example/sites/Marketing/";
const fileSent = [];
const fileFetcher = async (url, opts) => (fileSent.push({ url, body: JSON.parse(opts.body) }), { ok: true, status: 200, text: async () => (url.endsWith("/file") ? JSON.stringify({ path: "/Shared Documents/marketing-engine/x y.gif" }) : "") });
const link = await ap.deliverGif(picPost.id, FRI_ISO, fileFetcher);
check(Buffer.from(fileSent[0]?.body.content || "", "base64").equals(GIF) && /fiori-apps-that-nobody-opens-p-1\.gif$/.test(fileSent[0].body.name), "the GIF is sent byte for byte, named after the post");
check(link === "https://files.larkwell.example/sites/Marketing/Shared%20Documents/marketing-engine/x%20y.gif" && get(picPost.id).payload.images.gifLink === link, "the SharePoint link is built from the site and the saved path, and kept on the post");
check(fileSent[1]?.url === "https://flow.example/pictures" && fileSent[1].body.chatId === "19:test-chat" && fileSent[1].body.message.body.content.includes(link), "the link is posted to the approval chat");
const failing = async () => ({ ok: false, status: 500, text: async () => "boom" });
check((await ap.deliverGif(picPost.id, FRI_ISO, failing)) === "", "a failed save returns nothing and does not throw");
check((await ap.deliverGif("b-good", FRI_ISO, fileFetcher)) === "" && fileSent.length === 2, "a post without a chosen moving picture sends nothing");
for (const k of ["MKT_PICTURE_FILE_WEBHOOK", "MKT_PICTURE_WEBHOOK", "MKT_APPROVAL_CHAT_ID", "MKT_FILE_SITE_URL"]) delete process.env[k];

delete process.env.MKT_APPROVAL_REQUEST_WEBHOOK;
delete process.env.MKT_APPROVAL_FETCH_WEBHOOK;

fs.rmSync(box, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
