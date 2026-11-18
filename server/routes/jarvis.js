// Marketing Engine brain server — routes: Jarvis: planner, sessions, briefs, playbook, fresh start.
// Registered from server/index.js via registerJarvisRoutes(app).

import { planFromBrief } from "../agent.js";
import { runSessionNow, getSession, listBriefs } from "../session.js";
import { listRules, addRule, updateRule, ensureSeeded as ensurePlaybook, RULE_KINDS } from "../playbook.js";
import { freshStartPreview, runFreshStart, restoreFreshStart } from "../fresh-start.js";
import { nowISO } from "./shared.js";

export function registerJarvisRoutes(app) {
  // ---------- Jarvis agent (planner) ----------
  // Turns a plain-language brief into a concrete plan of draft tasks. The frontend
  // executes the tasks through the existing generators and saves them to the
  // Library. The agent NEVER posts. Body: { brief, maxTasks }.
  app.post("/api/agent/plan", async (req, res) => {
    const { brief, maxTasks } = req.body || {};
    if (!brief) return res.status(400).json({ error: "brief required" });
    try {
      res.json(await planFromBrief({ brief: String(brief), maxTasks: Number(maxTasks) || 5 }));
    } catch (err) {
      console.error("agent plan failed:", err.message);
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // ---------- Jarvis sessions, playbook, briefs, fresh start (2026-11-02) ----------
  app.get("/api/session", (_req, res) => {
    try {
      res.json({ session: getSession(), briefs: listBriefs(5) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/session/run", (req, res) => {
    const out = runSessionNow({ minutes: req.body?.minutes, by: String(req.body?.by || "you").slice(0, 40) });
    if (!out.started) return res.status(409).json({ error: "busy", message: out.reason });
    res.json(out);
  });
  app.get("/api/briefs", (req, res) => res.json({ briefs: listBriefs(Math.min(60, Number(req.query.limit) || 20)) }));

  app.get("/api/playbook", (_req, res) => {
    ensurePlaybook(nowISO());
    res.json({ rules: listRules({ includeDormant: true }).filter((r) => r.status !== "deleted"), kinds: RULE_KINDS });
  });
  app.post("/api/playbook", (req, res) => {
    const b = req.body || {};
    if (!String(b.text || "").trim()) return res.status(400).json({ error: "text_required", message: "Write the rule first." });
    const out = addRule({ kind: b.kind, text: String(b.text).slice(0, 400), confidence: b.confidence ?? 0.7, source: "you", evidence: [{ at: nowISO(), note: `added by ${String(b.by || "hand").slice(0, 40)}` }] }, nowISO());
    res.json(out);
  });
  app.patch("/api/playbook/:id", (req, res) => {
    const r = updateRule(req.params.id, req.body || {}, nowISO());
    if (!r) return res.status(404).json({ error: "not_found" });
    res.json(r);
  });

  app.get("/api/fresh-start", (_req, res) => res.json(freshStartPreview()));
  app.post("/api/fresh-start", (req, res) => {
    // Big, reversible, but not something to trigger by accident.
    if (req.body?.confirm !== true) return res.status(400).json({ error: "confirm_required", message: "Confirm the fresh start first." });
    try {
      res.json(runFreshStart(nowISO(), { by: req.body?.by }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/fresh-start/restore", (req, res) => {
    const out = restoreFreshStart(String(req.body?.id || ""), nowISO());
    if (!out) return res.status(404).json({ error: "not_found", message: "That snapshot doesn't exist." });
    res.json(out);
  });
}
