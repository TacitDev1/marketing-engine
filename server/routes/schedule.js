// Marketing Engine brain server — routes: The publishing schedule.
// Registered from server/index.js via registerScheduleRoutes(app).

import { listDrafts, updateDraft } from "../drafts.js";
import {
  scheduleOverview,
  updateSettings as updateScheduleSettings,
  candidates as scheduleCandidates,
  assignDraft as scheduleAssign,
  setSlotStatus as scheduleStatus,
  pickForSlot as schedulePick,
  reminderFor as scheduleReminder,
  isDateKey,
} from "../schedule.js";
import { addActivity, addTasteEvent } from "../stores.js";
import { nowISO } from "./shared.js";

// Slot keys look like 2026-09-24:linkedin.
const SLOT_KEY = /^(\d{4}-\d{2}-\d{2}):(linkedin|blog)$/;
const slotGuard = (req, res, next) => {
  const m = SLOT_KEY.exec(req.params.key);
  return m && isDateKey(m[1]) ? next() : res.status(400).json({ error: "bad_slot", message: "Not a valid schedule slot." });
};

export function registerScheduleRoutes(app) {
  // ---------- Publishing schedule (content calendar + daily reminder) ----------
  // Calendar for the past week and next two; nothing here posts anywhere.
  app.get("/api/schedule", (_req, res) => {
    try {
      res.json(scheduleOverview());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.put("/api/schedule/settings", (req, res) => res.json(updateScheduleSettings(req.body || {})));
  // Drafts that could fill a slot of this kind (?kind=linkedin|blog&except=<slotKey>).
  app.get("/api/schedule/candidates", (req, res) => {
    const kind = req.query.kind === "blog" ? "blog" : "linkedin";
    res.json({ candidates: scheduleCandidates(kind, req.query.except ? String(req.query.except) : null) });
  });

  app.post("/api/schedule/:key/pick", slotGuard, async (req, res) => {
    try {
      // Learning signal: the person passed on the draft that was lined up here.
      const passedOn = scheduleOverview().slots.find((sl) => sl.key === req.params.key)?.draftId;
      const out = await schedulePick(req.params.key, { repick: true });
      if (passedOn && out.slot?.draftId && out.slot.draftId !== passedOn) {
        const d = listDrafts().find((x) => x.id === passedOn);
        if (d) addTasteEvent({ event: "repicked", kind: d.kind, postType: d.payload?.postType || "", serviceId: d.payload?.serviceId || "", origin: d.payload?.origin || "", text: d.payload?.title || d.payload?.hook || "", draftId: d.id }, nowISO());
      }
      // Nothing else to pick: say so instead of "succeeding" with no change.
      if (out.unchanged) return res.status(409).json({ error: "nothing_else", message: out.reason });
      if (!out.slot) return res.status(409).json({ error: "no_candidates", message: out.reason });
      if (out.slot?.draftId) addActivity({ actor: "jarvis", event: "schedule.picked", summary: `picked for ${req.params.key}: ${(out.slot.draft?.title || out.slot.draft?.hook || "").slice(0, 70)} (${out.reason})`, ref: { libraryId: out.slot.draftId } }, nowISO());
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/schedule/:key/assign", slotGuard, (req, res) => {
    const slot = scheduleAssign(req.params.key, req.body?.draftId || null, "you");
    if (!slot) return res.status(404).json({ error: "not_found", message: "That draft isn't available: not in the Library, the wrong kind for this slot, or already lined up for another day." });
    res.json({ slot });
  });
  app.post("/api/schedule/:key/status", slotGuard, (req, res) => {
    const slot = scheduleStatus(req.params.key, String(req.body?.status || ""));
    if (!slot) return res.status(400).json({ error: "bad_status" });
    if (slot.status === "skipped" && slot.draftId) {
      const d = listDrafts().find((x) => x.id === slot.draftId);
      if (d) addTasteEvent({ event: "skipped", kind: d.kind, postType: d.payload?.postType || "", serviceId: d.payload?.serviceId || "", origin: d.payload?.origin || "", reason: String(req.body?.reason || ""), text: d.payload?.title || d.payload?.hook || "", draftId: d.id }, nowISO());
    }
    if (slot.status === "published") {
      addActivity({ actor: "you", event: "schedule.published", summary: `published ${slot.kind} for ${slot.date}`, ref: { libraryId: slot.draftId || undefined } }, nowISO());
      // "I posted it" here means the same as marking the draft posted in the
      // Library: do that too, so it can't be picked for another day.
      const draft = slot.draftId ? listDrafts().find((d) => d.id === slot.draftId) : null;
      if (draft && draft.status !== "posted") {
        updateDraft(draft.id, { status: "posted" }, nowISO());
        const p = draft.payload || {};
        addTasteEvent({ event: "posted", kind: draft.kind, postType: p.postType || p.type || "", serviceId: p.serviceId || p.service || "", origin: p.origin || "" }, nowISO());
      }
    }
    res.json({ slot });
  });
  // Builds (and stores on the slot) the reminder email for a slot.
  app.post("/api/schedule/:key/reminder", slotGuard, (req, res) => {
    const out = scheduleReminder(req.params.key);
    if (!out) return res.status(404).json({ error: "not_found" });
    res.json(out);
  });
}
