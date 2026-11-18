// The Editor agent's side of the brain (2026-11-12).
//
// The Editor is a Claude Code run (.claude/commands/mkt-editor.md) that works
// from the copywriting and copy-editing skills. It asks for the drafts nobody
// has edited yet, rewrites or rejects each one, and sends back a verdict. This
// module serves that queue and decides, in code, whether an edited blog is
// CLEARED to publish: the agent's judgement is necessary but not sufficient.
// A cleared blog still waits for a person to approve it in the Library before
// it goes out (server/autopublish.js). A blog is cleared only when
//   - the Editor passed it with a score of CLEAR_SCORE or more, and
//   - the hard checks find nothing (no unsourced figure, no invented client,
//     no AI-slop, no repeat of a recent theme, a complete title), and
//   - the blog audit finds nothing critical (it has a body, it is not cut off).
// A rejected draft is archived (hidden, restorable), never deleted.

import { listDrafts, updateDraft } from "./drafts.js";
import { hardChecks } from "./critic.js";
import { applyToBlog, applyToPost } from "./guardrails.js";
import { activeRules } from "./playbook.js";
import { findingById } from "./fresh-start.js";
import { unassignDraft } from "./schedule.js";
import { addActivity, addTasteEvent } from "./stores.js";
import { services, postTypes, knownClients } from "../src/lib/company.js";
import { auditBlog, isCritical, describeProblems } from "../src/lib/blog-audit.js";

export const CLEAR_SCORE = 8;
const QUEUE_LIMIT = 6;
const RECENT_DAYS = 14;

const SERVICE_LABEL = Object.fromEntries(services.map((s) => [s.id, s.label]));
const POST_TYPE_LABEL = Object.fromEntries(postTypes.map((p) => [p.id, p.label]));
const str = (v, max) => String(v ?? "").slice(0, max);

// The only facts a draft may cite: the finding it was written from, plus the
// sources and evidence the session attached.
function sourcesTextOf(payload) {
  const finding = payload.findingId ? findingById(payload.findingId) : null;
  return [finding ? `${finding.title}\n${finding.summary}` : "", ...(Array.isArray(payload.sources) ? payload.sources : []), typeof payload.evidence === "string" ? payload.evidence : JSON.stringify(payload.evidence || "")]
    .filter(Boolean)
    .join("\n");
}

function recentOthers(id) {
  const cutoff = Date.now() - RECENT_DAYS * 86400000;
  return listDrafts()
    .filter((d) => d.id !== id && Date.parse(d.savedAt || 0) > cutoff)
    .map((d) => ({ title: d.payload?.title, hook: d.payload?.hook, keyword: d.payload?.keyword }));
}

const needsEdit = (d) => d.status === "draft" && !d.payload?.editor;

// What the Editor works on next: unedited drafts, blogs first (they publish),
// newest first, with what it needs to judge each one.
export function editorQueue(limit = QUEUE_LIMIT) {
  const waiting = listDrafts()
    .filter(needsEdit)
    .sort((a, b) => (b.kind === "blog") - (a.kind === "blog") || String(b.savedAt).localeCompare(String(a.savedAt)));
  return {
    waiting: waiting.length,
    clearScore: CLEAR_SCORE,
    // Rules the team's reviews taught Jarvis; the Editor holds drafts to them too.
    rules: activeRules().map((r) => r.text),
    knownClients,
    drafts: waiting.slice(0, Math.max(1, limit)).map((d) => {
      const p = d.payload || {};
      return {
        id: d.id,
        kind: d.kind,
        title: p.title || "",
        hook: p.hook || "",
        metaDescription: p.metaDescription || "",
        body: p.body || "",
        keyword: p.keyword || p.targetKeyword || "",
        service: SERVICE_LABEL[p.serviceId] || "",
        postType: POST_TYPE_LABEL[p.postType] || "",
        why: p.why || "",
        // A person sent this draft back from Teams with this note: the edit must answer it.
        reviewerNote: p.revision?.note ? `${p.revision.by || "A reviewer"}: ${p.revision.note}` : "",
        // Everything the draft may cite. A figure that is not in here has no source.
        sources: sourcesTextOf(p).slice(0, 4000),
        recentTitles: recentOthers(d.id)
          .map((r) => r.title || r.hook)
          .filter(Boolean)
          .slice(0, 25),
      };
    }),
  };
}

// The Editor's verdict on one draft. Returns { error } for a bad request, else
// { draft, editor } where editor.cleared says whether a blog may auto-publish
// and editor.issues lists what the code checks still object to (so the agent
// can fix those and send the draft again).
export function applyEditorVerdict(id, input, nowISO) {
  const draft = listDrafts().find((d) => d.id === id);
  if (!draft) return { error: "not_found" };
  if (draft.status !== "draft") return { error: "not_a_draft", message: `This draft is "${draft.status}"; the Editor only works on unreviewed drafts.` };
  const verdict = input?.verdict;
  if (verdict !== "pass" && verdict !== "reject") return { error: "verdict_required", message: 'verdict must be "pass" or "reject".' };
  const score = Math.max(0, Math.min(10, Math.round(Number(input?.score))));
  if (!Number.isFinite(score)) return { error: "score_required", message: "score must be a number from 0 to 10." };
  const p = draft.payload || {};
  const label = str(p.title || p.hook || draft.id, 80);

  if (verdict === "reject") {
    const reason = str(input?.reason || input?.notes, 400).trim();
    if (!reason) return { error: "reason_required", message: "A rejection needs a reason." };
    const editor = { verdict, score, reason, at: nowISO, cleared: false, issues: [] };
    const saved = updateDraft(id, { status: "archived", payload: { ...p, editor } }, nowISO);
    unassignDraft(id);
    // Jarvis learns from rejections and their reasons at its next session, the
    // same way it learns from a person's. (The Editor's rewrites reach it too,
    // as the difference between what Jarvis wrote and the saved text.)
    addTasteEvent({ event: "rejected", kind: draft.kind, postType: p.postType || "", serviceId: p.serviceId || "", origin: p.origin || "", reason: `Editor: ${reason}`, text: label, draftId: id }, nowISO);
    addActivity({ actor: "agent", event: "editor.rejected", summary: `Editor rejected "${label}": ${reason}`, ref: { libraryId: id } }, nowISO);
    return { draft: saved, editor };
  }

  // A pass: take the Editor's text where it sent some, then run it through the
  // same guardrails every draft gets.
  const text = (key) => (typeof input?.[key] === "string" && input[key].trim() ? input[key] : p[key] || "");
  let next;
  if (draft.kind === "blog") {
    const cleaned = applyToBlog({ title: text("title"), metaDescription: text("metaDescription"), body: text("body") });
    next = { ...p, title: cleaned.title, metaDescription: cleaned.metaDescription, body: cleaned.body, warnings: cleaned.warnings };
    if (cleaned.titleCut) next.titleCut = true;
    else delete next.titleCut;
  } else {
    const cleaned = applyToPost({ hook: text("hook"), body: text("body") });
    next = { ...p, hook: cleaned.hook, body: cleaned.body, warnings: cleaned.warnings };
  }

  const issues = hardChecks({ kind: draft.kind, payload: next, sourcesText: sourcesTextOf(next), recent: recentOthers(id) }).map((i) => ({ code: i.code, note: i.note, fix: i.fix || "" }));
  if (draft.kind === "blog") {
    const problems = auditBlog(next);
    if (isCritical(problems)) issues.push({ code: "incomplete", note: describeProblems(problems.filter((x) => x.severity === "critical")), fix: "Complete the article: it needs a title and a full body that ends on a finished sentence." });
  }
  const cleared = draft.kind === "blog" && score >= CLEAR_SCORE && issues.length === 0;
  const editor = {
    verdict,
    score,
    notes: str(input?.notes, 600),
    changes: str(input?.changes, 600),
    at: nowISO,
    cleared,
    issues,
  };
  const saved = updateDraft(id, { payload: { ...next, editor } }, nowISO);
  addActivity(
    {
      actor: "agent",
      event: "editor.passed",
      summary: `Editor passed "${label}" (${score}/10)${draft.kind === "blog" ? (cleared ? ", cleared; waiting for a person to approve it" : `, not cleared: ${issues.length ? issues.map((i) => i.code).join(", ") : `score under ${CLEAR_SCORE}`}`) : ""}`,
      ref: { libraryId: id },
    },
    nowISO
  );
  return { draft: saved, editor };
}
