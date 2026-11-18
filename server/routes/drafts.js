// Marketing Engine brain server — routes: The draft library, plus the blog audit (also run from the boot block in index.js).
// Registered from server/index.js via registerDraftRoutes(app).

import { reviseDraft } from "../brain.js";
import { listDrafts, saveDraft, updateDraft, deleteDraft, draftsSummary } from "../drafts.js";
import {
  markPublished as scheduleMarkPublished,
  scheduledDrafts,
  unassignDraft as scheduleUnassign,
  reopenForDraft as scheduleReopen,
} from "../schedule.js";
import { findNearDuplicate } from "../draft-dedupe.js";
import { addActivity, addTasteEvent } from "../stores.js";
import {
  auditBlog,
  isCritical as isCriticalBlog,
  describeProblems as describeBlogProblems,
} from "../../src/lib/blog-audit.js";
import { nowISO } from "./shared.js";

// ----- Blog audit: is anything missing from a blog? -----
// Runs at startup and every 6 hours; logs to the activity feed only when the
// list of incomplete blogs changes (no repeat noise). Same checks as the
// Library badge and the Schedule warning (src/lib/blog-audit.js).
function blogAuditReport() {
  const rows = listDrafts()
    // Posted blogs are already out; marked ones are going. Audit the rest.
    .filter((d) => d.kind === "blog" && d.status !== "delete" && d.status !== "archived" && d.status !== "posted")
    .map((d) => ({ id: d.id, title: d.payload?.title || "(untitled)", status: d.status, problems: auditBlog(d.payload) }))
    .filter((r) => r.problems.length);
  return { checked: listDrafts().filter((d) => d.kind === "blog").length, incomplete: rows };
}
let lastBlogAuditSig = "";
export function runBlogAudit() {
  try {
    const rep = blogAuditReport();
    const critical = rep.incomplete.filter((r) => isCriticalBlog(r.problems));
    const sig = critical.map((r) => `${r.id}:${r.problems.map((x) => x.id).join("+")}`).join("|");
    if (sig !== lastBlogAuditSig) {
      lastBlogAuditSig = sig;
      if (critical.length) {
        addActivity(
          {
            actor: "system",
            event: "blog.audit",
            summary: `${critical.length} blog${critical.length === 1 ? "" : "s"} not ready to publish: ${critical.slice(0, 3).map((r) => `"${r.title.slice(0, 50)}" (${describeBlogProblems(r.problems.filter((x) => x.severity === "critical"))})`).join("; ")}`,
            ref: { libraryId: critical[0].id },
          },
          nowISO()
        );
      }
    }
  } catch (err) {
    console.error("blog audit:", err.message);
  }
}

// A draft with no text is never worth keeping, and an empty blog that gets
// scheduled looks like lost work. Refuse it at the door, from every screen.
function emptyDraftError(kind, payload) {
  const body = String(payload?.body || "").trim();
  if (kind === "blog" && body.length < 200) return "This article has no body text, so it wasn't saved. Generate it again, or paste the text in first.";
  if (kind !== "blog" && !body) return "This post has no text, so it wasn't saved.";
  return null;
}

export function registerDraftRoutes(app) {
  // ---------- Draft library (local review queue) ----------

  app.get("/api/drafts/audit", (_req, res) => res.json(blogAuditReport()));

  app.get("/api/drafts", (_req, res) => {
    try {
      res.json({ drafts: listDrafts(), summary: draftsSummary(), scheduled: scheduledDrafts() });
    } catch (err) {
      res.json({ drafts: [], summary: { total: 0, byStatus: {} }, error: err.message });
    }
  });

  // Save (or upsert) a draft. Body: { kind, payload }. A NEW draft that reads like
  // one already in the Library is still saved (a human chose it) but carries a
  // warning naming the twin, so the Library shows it - the same gate the Worker
  // applies, minus the veto.

  app.post("/api/drafts", async (req, res) => {
    const { kind, payload } = req.body || {};
    if (!payload) return res.status(400).json({ error: "payload required" });
    const emptyMsg = emptyDraftError(kind, payload);
    if (emptyMsg) return res.status(400).json({ error: "empty_draft", message: emptyMsg });
    try {
      let duplicateOf = null;
      if (!payload.libraryId) {
        try {
          // Time-boxed: a cold vector cache (first save after a deploy) must not
          // hold the Save button for minutes; without an answer we save unwarned.
          const dup = await Promise.race([
            findNearDuplicate({ kind: kind === "blog" ? "blog" : "linkedin", payload }, listDrafts()),
            new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
          ]);
          if (dup) {
            duplicateOf = { id: dup.draft.id, score: dup.score, title: String(dup.draft.payload?.title || dup.draft.payload?.hook || "").slice(0, 80) };
            const note = `Reads like an existing draft (${Math.round(dup.score * 100)}%): "${duplicateOf.title}"`;
            payload.warnings = [...(payload.warnings || []).filter((w) => !/^Reads like an existing draft/.test(w)), note];
          }
        } catch (err) {
          console.error("drafts: duplicate check skipped:", err.message);
        }
      }
      res.json({ ...saveDraft({ kind, payload, nowISO: nowISO() }), duplicateOf });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Brief Jarvis on an existing draft: revise it per a human instruction and save
  // the result back onto the SAME record ("boss wants X changed" lives here, not
  // in a chat that gets lost). Body: { instruction }. Never posts.
  app.post("/api/drafts/:id/brief", async (req, res) => {
    const instruction = String(req.body?.instruction || "").trim();
    if (!instruction) return res.status(400).json({ error: "instruction required" });
    const record = listDrafts().find((d) => d.id === req.params.id);
    if (!record) return res.status(404).json({ error: "not_found" });
    try {
      const { changes, warnings } = await reviseDraft({ kind: record.kind, payload: record.payload || {}, instruction });
      // The model call above takes 30-120s. Re-read the record now so any edit or
      // PATCH made in the meantime isn't reverted: merge the revised fields onto
      // the CURRENT payload, not the stale pre-call snapshot.
      const fresh = listDrafts().find((d) => d.id === req.params.id) || record;
      // Keep a short trail of who asked for what, on the record itself.
      const briefs = [...(fresh.payload?.briefs || []), { instruction, at: nowISO() }].slice(-10);
      // Merge ONLY the fields the brief rewrote onto the fresh record: anything
      // else changed during the model call (hashtags, image, site link) stays.
      const updated = updateDraft(record.id, { payload: { ...fresh.payload, ...changes, briefs } }, nowISO());
      // The draft can be DELETED during the 30-120s model call — say so instead
      // of returning 200 with a null draft the UI would choke on.
      if (!updated) return res.status(404).json({ error: "not_found", message: "This draft was deleted while Jarvis was working." });
      addActivity(
        { actor: "you", event: "draft.briefed", summary: `brief applied: ${instruction.slice(0, 80)}`, ref: { libraryId: record.id } },
        nowISO()
      );
      res.json({ draft: updated, warnings });
    } catch (err) {
      res.status(503).json({ error: err.message });
    }
  });

  // Update a draft's status or payload. Body: { status?, payload? }.
  // payload REPLACES the stored payload wholesale (callers send the full object),
  // so guard against a partial/non-object payload silently wiping a draft.
  app.patch("/api/drafts/:id", (req, res) => {
    const body = req.body || {};
    if ("payload" in body && (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))) {
      return res.status(400).json({ error: "payload must be an object" });
    }
    // payload replaces wholesale, but the link to the published site file
    // (exportedRel) must survive an edit that omits it — otherwise re-publishing
    // an edited post would create a duplicate instead of updating it.
    const before = listDrafts().find((d) => d.id === req.params.id);
    if (body.payload && before) {
      const emptyMsg = emptyDraftError(before.kind, body.payload);
      if (emptyMsg) return res.status(400).json({ error: "empty_draft", message: emptyMsg });
    }
    if (body.payload && !("exportedRel" in body.payload)) {
      if (before?.payload?.exportedRel) body.payload.exportedRel = before.payload.exportedRel;
    }
    const updated = updateDraft(req.params.id, body, nowISO());
    if (!updated) return res.status(404).json({ error: "not_found" });
    // Someone else saved this draft after the editor loaded it (body.ifUpdatedAt
    // is stale). Refuse rather than overwrite their work; the client keeps the
    // typed text on screen and says so.
    if (updated.conflict) return res.status(409).json({ error: "conflict", current: updated.current });
    // Taste signal: a draft moving to approved/posted is a "keep". Only on a real
    // transition — re-saving an already-approved draft isn't a new signal.
    if (body.status && ["approved", "posted"].includes(body.status) && before && before.status !== body.status) {
      const p = updated.payload || {};
      addTasteEvent(
        { event: body.status, kind: updated.kind, postType: p.postType || p.type || "", serviceId: p.serviceId || p.service || "", origin: p.origin || "", text: p.title || p.hook || "", draftId: updated.id },
        nowISO()
      );
    }
    // A draft posted by hand closes the schedule slot that was holding it; un-posting
    // it (mistake, or it was pulled) reopens that slot so the calendar tells the truth.
    if (body.status === "posted" && before && before.status !== "posted") scheduleMarkPublished(updated.id, nowISO());
    // (Not for "delete": flagging an old posted draft must leave the slot's
    // published record alone, same as a real delete does.)
    if (body.status && body.status !== "posted" && body.status !== "delete" && before && before.status === "posted") scheduleReopen(updated.id);
    // Marked for deletion (or archived): it must not stay lined up on the
    // calendar. Free the slot now (same as a real delete) so Jarvis re-picks;
    // un-marking doesn't put it back — a human chooses again.
    if ((body.status === "delete" || body.status === "archived") && before && before.status !== body.status) {
      const freed = scheduleUnassign(updated.id);
      if (freed.length) addActivity({ actor: "system", event: "schedule.freed", summary: `slot ${freed.join(", ")} is open again (its draft was ${body.status === "delete" ? "marked for deletion" : "archived"}); Jarvis re-picks on the next check`, ref: {} }, nowISO());
    }
    // Learning signal: marking an unreviewed draft for deletion is a rejection
    // (with the reviewer's reason when they gave one). Archiving only counts
    // when a reason comes with it; otherwise it's just tidying.
    const reason = String(body.reason || "").trim();
    const rejecting =
      before &&
      before.status !== body.status &&
      // Unreviewed = a plain draft, or an archived one that was a plain draft.
      // (An archived "To delete" draft was counted when it was first marked.)
      (before.status === "draft" || (before.status === "archived" && (before.archivedFrom || "draft") === "draft")) &&
      (body.status === "delete" || (body.status === "archived" && reason));
    if (rejecting) {
      const p = updated.payload || {};
      addTasteEvent(
        { event: "rejected", kind: updated.kind, postType: p.postType || p.type || "", serviceId: p.serviceId || p.service || "", origin: p.origin || "", reason, text: p.title || p.hook || "", draftId: updated.id },
        nowISO()
      );
    }
    res.json(updated);
  });

  app.delete("/api/drafts/:id", (req, res) => {
    // Taste signal: deleting a never-approved draft is a "kill" (Tobias rejected
    // it). Deleting an approved/posted draft is just cleanup — not a signal.
    // ?cleanup=1 marks a scripted Library cleanup (scripts/cleanup-library.mjs), not a
    // human rejection, so it stays out of the taste loop.
    const rec = listDrafts().find((d) => d.id === req.params.id);
    // A draft already MARKED for deletion was counted as a rejection when it was
    // marked (PATCH above); deleting it now is cleanup, not a second signal.
    const wasUnreviewed = rec && rec.status === "draft";
    if (wasUnreviewed && req.query.cleanup !== "1") {
      const p = rec.payload || {};
      addTasteEvent(
        { event: "deleted", kind: rec.kind, postType: p.postType || p.type || "", serviceId: p.serviceId || p.service || "", origin: p.origin || "", reason: String(req.query.reason || ""), text: p.title || p.hook || "", draftId: rec.id },
        nowISO()
      );
    }
    const freed = scheduleUnassign(req.params.id);
    if (freed.length) addActivity({ actor: "system", event: "schedule.freed", summary: `slot ${freed.join(", ")} is open again (its draft was deleted); Jarvis re-picks on the next check`, ref: {} }, nowISO());
    res.json({ deleted: deleteDraft(req.params.id), siteFile: rec?.payload?.exportedRel || null });
  });
}
