// Marketing Engine brain server — routes: the Editor agent.
// Registered from server/index.js via registerEditorRoutes(app).

import { editorQueue, applyEditorVerdict } from "../editor.js";
import { announceForApproval } from "../week-ahead.js";
import { requestApproval, approvalsConfigured } from "../approvals.js";
import { updateDraft } from "../drafts.js";
import { syncWiki } from "../wiki-bridge.js";
import { nowISO } from "./shared.js";

export function registerEditorRoutes(app) {
  // ---------- The Editor agent (see server/editor.js) ----------
  app.get("/api/editor/queue", (req, res) => res.json(editorQueue(Math.min(12, Number(req.query.limit) || 6))));

  app.post("/api/editor/:id/verdict", (req, res) => {
    const result = applyEditorVerdict(req.params.id, req.body || {}, nowISO());
    if (result.error) return res.status(result.error === "not_found" ? 404 : result.error === "not_a_draft" ? 409 : 400).json(result);
    // A blog that has just been cleared, or a LinkedIn post the Editor passed:
    // ask the team once. With the approval workflow set up they get a card with
    // Approve and Reject buttons; without it, a cleared blog gets a note with a
    // link to the Library. Not awaited: Teams being slow must not hold up the Editor.
    // A piece a person sent back always returns to them once it passes the
    // code checks, even under the Editor's own bar: they asked for the rework,
    // and the card shows the Editor's mark and reservations.
    const reworked = !!result.draft.payload.revision && result.editor.issues.length === 0;
    const ready = result.editor.verdict === "pass" && (result.draft.kind !== "blog" || result.editor.cleared || reworked);
    if (ready && !result.draft.payload.approvalAnnouncedAt) {
      const at = nowISO();
      updateDraft(result.draft.id, { payload: { ...result.draft.payload, approvalAnnouncedAt: at } }, at);
      if (approvalsConfigured().request) requestApproval(result.draft.id, at).catch((err) => console.error("approval request:", err.message));
      else if (result.draft.kind === "blog") announceForApproval(result.draft).catch((err) => console.error("approval note:", err.message));
    }
    // A rejection and its reason belong on the wiki's "turned down" page.
    if (result.editor.verdict === "reject") syncWiki(nowISO());
    res.json({ id: result.draft.id, status: result.draft.status, editor: result.editor });
  });
}
