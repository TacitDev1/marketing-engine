// Marketing Engine brain server — routes: Exec feedback.
// Registered from server/index.js via registerFeedbackRoutes(app).

import { addActivity, addFeedback, addFeedbackReply, listFeedback, updateFeedback } from "../stores.js";
import { nowISO } from "./shared.js";

export function registerFeedbackRoutes(app) {
  // ---------- Exec feedback (requests from the C-level, reviewed by Tobias) ----------

  app.get("/api/feedback", (req, res) => {
    try {
      res.json({ feedback: listFeedback(req.query.status ? { status: String(req.query.status) } : {}) });
    } catch (err) {
      res.json({ feedback: [], error: err.message });
    }
  });

  app.post("/api/feedback", (req, res) => {
    const rec = addFeedback(req.body || {}, nowISO());
    if (!rec) return res.status(400).json({ error: "text required" });
    addActivity({ actor: "human", event: "feedback.added", summary: rec.text.slice(0, 80), ref: { feedbackId: rec.id } }, nowISO());
    res.json(rec);
  });

  // Reply on a note. Body: { text, author }. Returns the note with its replies.
  app.post("/api/feedback/:id/replies", (req, res) => {
    if (!String(req.body?.text || "").trim()) return res.status(400).json({ error: "text required" });
    const rec = addFeedbackReply(req.params.id, req.body || {}, nowISO());
    if (!rec) return res.status(404).json({ error: "not_found" });
    const reply = rec.replies[rec.replies.length - 1];
    addActivity({ actor: "human", event: "feedback.replied", summary: `${reply.author || "someone"}: ${reply.text.slice(0, 70)}`, ref: { feedbackId: rec.id } }, nowISO());
    res.json(rec);
  });

  app.patch("/api/feedback/:id", (req, res) => {
    const updated = updateFeedback(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json(updated);
  });
}
