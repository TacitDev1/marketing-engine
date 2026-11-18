// Marketing Engine brain server — routes: automatic blog publishing and the weekly summary.
// Registered from server/index.js via registerPublishingRoutes(app).

import { publishingStatus, updatePublishing } from "../autopublish.js";
import { listSummaries, sendWeeklySummary } from "../weekly-summary.js";
import { listWeekAheads, buildWeekAhead, sendWeekAhead } from "../week-ahead.js";
import { approvalsStatus, collectDecisions, requestApproval, deliverGif, approvalInbox, decideInApp } from "../approvals.js";
import { makePostImages } from "../post-images.js";
import { listDrafts, updateDraft } from "../drafts.js";
import { nowISO } from "./shared.js";

export function registerPublishingRoutes(app) {
  // ---------- Automatic blog publishing (see server/autopublish.js) ----------
  app.get("/api/publishing", (_req, res) => res.json(publishingStatus()));
  app.patch("/api/publishing", (req, res) => res.json(updatePublishing(req.body || {}, nowISO())));

  // ---------- The weekly summary (see server/weekly-summary.js) ----------
  app.get("/api/summary", (_req, res) => res.json({ summaries: listSummaries(), teamsConfigured: !!process.env.MKT_TEAMS_WEBHOOK }));

  // ---------- The Approvals inbox, in the app (the default; see server/approvals.js) ----------
  app.get("/api/approvals/inbox", (_req, res) => res.json(approvalInbox()));
  // Body: { decision: "approve" | "revise" | "drop" | "stop", reason?, by?, picture? }
  app.post("/api/approvals/:id/decide", (req, res) => {
    const out = decideInApp(req.params.id, req.body || {}, nowISO());
    const bad = { bad_decision: 400, note_required: 400, unknown_draft: 404, already_decided: 409, too_late: 409 };
    res.status(bad[out.result] || 200).json({ ...out, inbox: approvalInbox() });
  });

  // ---------- Optional: approving in Teams (see server/approvals.js) ----------
  app.get("/api/approvals", (_req, res) => res.json(approvalsStatus()));
  // Fetch and apply the decisions now (the server also does this by itself).
  app.post("/api/approvals/collect", async (_req, res) => res.json(await collectDecisions(nowISO())));
  // Send one draft's card to Teams (again).
  app.post("/api/approvals/:id/request", async (req, res) => res.json(await requestApproval(req.params.id, nowISO(), { again: true })));

  // Make (or remake) a LinkedIn post's pictures. Body: what to change, e.g.
  // { icon, colour, cardStyle, photo }, or { reset: true } to start from Jarvis's own choice.
  app.post("/api/approvals/:id/pictures", async (req, res) => {
    const { reset, ...change } = req.body || {};
    if (reset) {
      const d = listDrafts().find((x) => x.id === req.params.id);
      if (d?.payload?.images) updateDraft(d.id, { payload: { ...d.payload, images: null } }, nowISO());
    }
    res.json(await makePostImages(req.params.id, nowISO(), change));
  });

  // Save an approved post's moving picture to the file store and post the link (again).
  app.post("/api/approvals/:id/gif", async (req, res) => {
    const link = await deliverGif(req.params.id, nowISO());
    res.status(link ? 200 : 409).json(link ? { link } : { error: "no moving picture saved: the post has no chosen moving picture, the file flow is not set up, or the save failed (see the activity feed)" });
  });

  // ---------- The week ahead (see server/week-ahead.js) ----------
  app.get("/api/week-ahead", (_req, res) => res.json({ sent: listWeekAheads(), preview: buildWeekAhead(nowISO()), teamsConfigured: !!process.env.MKT_TEAMS_WEBHOOK }));
  let sendingAhead = false;
  app.post("/api/week-ahead/send", async (_req, res) => {
    if (sendingAhead) return res.status(409).json({ error: "already_sending" });
    sendingAhead = true;
    try {
      res.json({ weekAhead: await sendWeekAhead(nowISO(), { by: "you" }) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      sendingAhead = false;
    }
  });

  // Build and send one now (also the way to test the Teams connection).
  let sending = false;
  app.post("/api/summary/send", async (_req, res) => {
    if (sending) return res.status(409).json({ error: "already_sending" });
    sending = true;
    try {
      res.json({ summary: await sendWeeklySummary(nowISO(), { by: "you" }) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      sending = false;
    }
  });
}
