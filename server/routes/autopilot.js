// Marketing Engine brain server — routes: Autopilot: UI-facing control + views for the Worker.
// Registered from server/index.js via registerAutopilotRoutes(app).

import { generateDraft, generateBlog, isBrainAvailable } from "../brain.js";
import { listDrafts, saveDraft } from "../drafts.js";
import { rescheduleWorker, runTick, withinActiveHours } from "../worker.js";
import { services as companyServices } from "../../src/lib/company.js";
import {
  addActivity,
  recentActivity,
  enqueueTopic,
  listQueue,
  recentFindings,
  listRecommendations,
  updateRecommendation,
  listDirectives,
  updateDirective,
  getWorkerState,
  getAutopilot,
  setAutopilot,
  load as loadStore,
} from "../stores.js";
import { nowISO } from "./shared.js";

// Best-guess service line for free text (recs carry none): the service whose
// label words appear most. undefined when nothing matches, so a vague rec
// stays unlabeled rather than mislabeled.
const STOP_WORDS = new Set(["sap", "services", "service", "and", "the", "for", "with"]);
function serviceForText(text) {
  const t = String(text || "").toLowerCase();
  let best;
  let bestScore = 0;
  for (const s of companyServices) {
    const words = s.label.toLowerCase().split(/[^a-z0-9/]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    const score = words.filter((w) => t.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = s.id;
    }
  }
  return best;
}

export function registerAutopilotRoutes(app) {
  // ---------- Autopilot: the two-agent research loop ----------
  // UI-facing control + views for the Worker, plus the Researcher-facing API the
  // Claude /loop calls. The Worker never posts; the Researcher only researches.

  // ----- UI / control -----

  app.get("/api/autopilot/status", (_req, res) => {
    const ap = getAutopilot();
    const ws = getWorkerState();
    res.json({
      workerEnabled: ap.workerEnabled,
      workerRunning: !!ws.running,
      cadenceMs: ap.cadenceMs,
      dailyDraftCap: ap.dailyDraftCap,
      activeHours: ap.activeHours,
      withinActiveHours: withinActiveHours(ap),
      generationsToday: ws.genToday || null,
      researcherLastSeenAt: ap.researcherLastSeenAt,
      lastRunAt: ws.lastRunAt,
      lastResult: ws.lastResult,
      draftsToday: ws.draftsToday,
      counts: {
        queued: listQueue({ status: "queued" }).length,
        findingsUnprocessed: loadStore("findings").filter((f) => !f.processed && f.attempts < 3).length,
        // Abandoned = failed 3 times, the worker will never retry them. Surfaced
        // so a systemic failure can't hide behind a small "unprocessed" number.
        findingsAbandoned: loadStore("findings").filter((f) => !f.processed && f.attempts >= 3).length,
        recsOpen: listRecommendations({ status: "open" }).length,
      },
    });
  });

  // Real KPI numbers + real 7-day trend series for the Jarvis dashboard tiles.
  // (The tiles used hardcoded sparkline seeds and fetch-limit-capped counts — this
  // gives them true totals and actual per-day history, computed from the
  // timestamps already on every record.)
  app.get("/api/autopilot/stats", (_req, res) => {
    const DAYS = 7;
    const keys = [];
    const now = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      keys.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD, oldest -> newest
    }
    const todayKey = keys[keys.length - 1];
    const series = (list, field) => {
      const counts = Object.fromEntries(keys.map((k) => [k, 0]));
      for (const item of list) {
        const k = String(item?.[field] || "").slice(0, 10);
        if (k in counts) counts[k]++;
      }
      return keys.map((k) => counts[k]);
    };

    const drafts = listDrafts();
    const findings = loadStore("findings");
    const openFindings = findings.filter((f) => !f.processed && f.attempts < 3);
    const recsAll = loadStore("recommendations");
    const recsOpen = listRecommendations({ status: "open" });
    const activity = loadStore("activity");

    res.json({
      draftsToday: drafts.filter((d) => String(d.savedAt || "").slice(0, 10) === todayKey).length,
      openFindings: openFindings.length,
      abandonedFindings: findings.filter((f) => !f.processed && f.attempts >= 3).length,
      lastTickErrors: getWorkerState()?.lastResult?.errors || 0,
      recsOpen: recsOpen.length,
      activityTotal: activity.length,
      trends: {
        drafts: series(drafts, "savedAt"),
        findings: series(findings, "createdAt"),
        recs: series(recsAll, "createdAt"),
        activity: series(activity, "ts"),
      },
    });
  });

  app.post("/api/autopilot/toggle", (req, res) => {
    const enabled = !!req.body?.enabled;
    // `expect` = the state the button showed when clicked. With several people on
    // the same Jarvis, two of them both pressing "Pause" within one poll interval
    // used to turn the worker back ON (each sent the negation of a stale status).
    if (req.body?.expect !== undefined && !!req.body.expect !== !!getAutopilot().workerEnabled) {
      return res.status(409).json({ error: "state_changed", ...getAutopilot() });
    }
    if (enabled === !!getAutopilot().workerEnabled) return res.json(getAutopilot());
    setAutopilot({ workerEnabled: enabled }, nowISO());
    addActivity({ actor: "system", event: "autopilot.toggled", summary: enabled ? "turned ON" : "turned OFF" }, nowISO());
    res.json(getAutopilot());
  });

  app.post("/api/autopilot/cadence", (req, res) => {
    // Number.isFinite guards: Math.max(0, NaN) is NaN, which JSON persists as
    // null — and `count < null` is always false, silently stopping ALL drafting.
    const patch = {};
    const cad = Number(req.body?.cadenceMs);
    if (req.body?.cadenceMs != null && Number.isFinite(cad)) patch.cadenceMs = Math.max(60000, cad);
    const cap = Number(req.body?.dailyDraftCap);
    if (req.body?.dailyDraftCap != null && Number.isFinite(cap)) patch.dailyDraftCap = Math.max(0, cap);
    // Active hours (see stores.js DEFAULTS). Every field validated; a bad value
    // keeps the current one rather than disabling drafting by accident.
    const ah = req.body?.activeHours;
    if (ah && typeof ah === "object") {
      const cur = getAutopilot().activeHours || {};
      const next = { ...cur };
      if (typeof ah.enabled === "boolean") next.enabled = ah.enabled;
      const s = Number(ah.start), e = Number(ah.end);
      if (ah.start != null && Number.isInteger(s) && s >= 0 && s <= 23) next.start = s;
      if (ah.end != null && Number.isInteger(e) && e >= 1 && e <= 24) next.end = e;
      if (Array.isArray(ah.days)) {
        const days = [...new Set(ah.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
        if (days.length) next.days = days;
      }
      if (typeof ah.tz === "string" && ah.tz.trim()) {
        try { new Intl.DateTimeFormat("en-US", { timeZone: ah.tz.trim() }); next.tz = ah.tz.trim(); } catch { /* keep current tz */ }
      }
      patch.activeHours = next;
    }
    setAutopilot(patch, nowISO());
    if (patch.cadenceMs) rescheduleWorker();
    addActivity({ actor: "system", event: "cadence.changed", summary: JSON.stringify(patch) }, nowISO());
    res.json(getAutopilot());
  });

  app.get("/api/autopilot/activity", (req, res) => res.json({ activity: recentActivity(Number(req.query.limit) || 50) }));
  app.get("/api/autopilot/queue", (_req, res) => res.json({ queue: listQueue() }));
  app.get("/api/autopilot/findings", (req, res) => res.json({ findings: recentFindings(Number(req.query.limit) || 20) }));
  app.get("/api/autopilot/recommendations", (_req, res) => res.json({ recommendations: listRecommendations({ status: "open" }) }));
  app.get("/api/autopilot/directives", (_req, res) => res.json({ directives: listDirectives({ status: "open" }) }));
  app.patch("/api/autopilot/directives/:id", (req, res) => {
    const updated = updateDirective(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json(updated);
  });

  app.patch("/api/autopilot/recommendations/:id", (req, res) => {
    const updated = updateRecommendation(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json(updated);
  });

  // Approve a recommendation -> instantly draft from it and drop it in the Library,
  // then mark the rec done. SEO/content fronts become a blog draft; everything else
  // becomes a LinkedIn post. Closes the loop from "the engine suggested this" to
  // "here's a draft to review". Still NEVER posts — it only writes a draft.
  app.post("/api/autopilot/recommendations/:id/draft", async (req, res) => {
    const rec = listRecommendations().find((r) => r.id === req.params.id);
    if (!rec) return res.status(404).json({ error: "not_found" });
    if (!(await isBrainAvailable())) return res.status(503).json({ error: "brain_unavailable" });

    const blogFront = /seo|schema|performance|site-health|analytics|technical|competitor|content/.test(rec.front || "");
    const nudge = `Recommendation: ${rec.title}. ${rec.detail}`.trim();
    try {
      let kind, payload;
      if (blogFront) {
        kind = "blog";
        // Carry the rec's service line so the blog is findable under the Library's
        // Service filter (it landed under "Unlabeled" before).
        payload = await generateBlog({ keyword: rec.title, nudge, serviceId: rec.serviceId || serviceForText(`${rec.title} ${rec.detail || ""}`) });
      } else {
        kind = "linkedin";
        const typeByFront = { "brand-proof": "case-study", messaging: "hot-take", social: "how-to" };
        payload = await generateDraft({ type: typeByFront[rec.front] || "how-to", nudge });
      }
      if (!payload || (!payload.hook && !payload.title)) return res.status(502).json({ error: "draft_failed" });
      payload.origin = "rec-approved";
      payload.recId = rec.id;
      payload.front = rec.front;
      const draft = saveDraft({ kind, payload, nowISO: nowISO() });
      updateRecommendation(rec.id, { status: "done" });
      addActivity(
        { actor: "system", event: "rec.drafted", summary: `approved -> ${kind} draft: ${rec.title}`, ref: { recId: rec.id, libraryId: draft?.id } },
        nowISO()
      );
      res.json({ draft, kind, recId: rec.id });
    } catch (err) {
      res.status(503).json({ error: "draft_failed", message: err.message });
    }
  });

  // Run one Worker tick now (the "Run now" button / a test hook).
  app.post("/api/autopilot/tick", async (_req, res) => {
    try {
      res.json(await runTick(nowISO()));
    } catch (err) {
      res.status(503).json({ error: "tick_failed", message: err.message });
    }
  });

  // Hand-feed a research topic from the UI.
  app.post("/api/autopilot/enqueue", (req, res) => {
    const { topic, front, priority, rationale } = req.body || {};
    if (!topic) return res.status(400).json({ error: "topic required" });
    const rec = enqueueTopic({ topic, front, priority, rationale, createdBy: "human" }, nowISO());
    if (rec) addActivity({ actor: "system", event: "topic.enqueued", summary: topic }, nowISO());
    res.json({ enqueued: !!rec, topic: rec });
  });
}
