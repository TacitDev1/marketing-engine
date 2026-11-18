// Marketing Engine brain server — routes: Settings, models, usage.
// Registered from server/index.js via registerSettingsRoutes(app).

import { getSettings, updateSettings } from "../settings.js";
import { listModels, startPull, getPullStatus } from "../models.js";
import { getUsage } from "../usage.js";

export function registerSettingsRoutes(app) {
  // ---------- Settings (model + generation knobs) ----------
  // Read/write the runtime settings the brain consults. Model changes apply on
  // the next generation — no restart. Local only.
  app.get("/api/settings", (_req, res) => res.json(getSettings()));
  app.put("/api/settings", (req, res) => res.json(updateSettings(req.body || {})));

  // Installed Ollama models (for the model dropdown).
  app.get("/api/models", async (_req, res) => {
    try {
      res.json({ models: await listModels() });
    } catch (err) {
      res.status(502).json({ error: "ollama_unreachable", message: err.message, models: [] });
    }
  });

  // Download a new model (e.g. llama3.1:70b) with polled progress.
  app.post("/api/models/pull", (req, res) => {
    try {
      startPull(req.body?.name);
      res.json(getPullStatus());
    } catch (err) {
      res.status(400).json({ error: "pull_failed", message: err.message });
    }
  });
  app.get("/api/models/pull", (_req, res) => res.json(getPullStatus()));

  // Token usage / cost, parsed from local Claude Code session logs. Local only.
  app.get("/api/usage", (req, res) => {
    const days = req.query.days === "all" ? 0 : Math.max(0, Number(req.query.days) || 30);
    try {
      res.json(getUsage({ days }));
    } catch (err) {
      res.status(500).json({ available: false, message: err.message });
    }
  });
}
