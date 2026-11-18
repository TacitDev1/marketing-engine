// Marketing Engine brain server — routes: Health, knowledge, generators, keywords, content plan, SEO brief, connections, deployment.
// Registered from server/index.js via registerContentRoutes(app).

import {
  generateDraft,
  generateBlog,
  generateFromUrl,
  generateSeoBrief,
  isBrainAvailable,
  brainInfo,
} from "../brain.js";
import { knowledgeStatus, searchKnowledge } from "../knowledge.js";
import { getContentPlan, mergedKeywords } from "../strategy.js";
import { ffmpegStatus } from "../images.js";
import { getSettings } from "../settings.js";
import { listModels } from "../models.js";
import { getAutopilot } from "../stores.js";
import { semrushConfigured } from "../tools/semrush.js";
import { ga4Configured, gscConfigured, googleAuthMode } from "../tools/google.js";

export function registerContentRoutes(app) {
  // Is the local model reachable? The UI uses this to decide whether to show
  // "AI drafts" or fall back to offline templates.
  app.get("/api/health", async (_req, res) => {
    const available = await isBrainAvailable();
    // Which configured models are NOT installed on this Ollama: a missing quality
    // model means every draft fails with "brain unavailable" and nothing said why.
    let missingModels = [];
    if (available) {
      try {
        const installed = new Set((await listModels()).map((m) => m.name || m.model));
        const st = getSettings();
        missingModels = [...new Set([st.textModel, st.qualityModel, st.embedModel].filter(Boolean))].filter((m) => !installed.has(m) && !installed.has(`${m}:latest`));
      } catch { /* model list unavailable; say nothing rather than guess */ }
    }
    res.json({ ok: true, brain: { ...brainInfo(), available, missingModels }, ffmpeg: ffmpegStatus() });
  });

  // What does the agent know? Counts of ingested files/chunks from knowledge/.
  app.get("/api/knowledge/status", async (_req, res) => {
    try {
      res.json(await knowledgeStatus());
    } catch (err) {
      res.json({ files: 0, chunks: 0, bySource: {}, error: err.message });
    }
  });

  // Search the knowledge base. Body: { query, n }. Used by SEO/Blogs screens.
  app.post("/api/knowledge/search", async (req, res) => {
    const { query, n } = req.body || {};
    try {
      res.json({ results: await searchKnowledge(String(query || ""), n || 5) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generate one on-brand draft. Body: { type, serviceId | productId, tone, hashtagStyle, nudge }.
  app.post("/api/generate", async (req, res) => {
    const { type, serviceId, productId, tone, hashtagStyle, nudge } = req.body || {};
    try {
      const draft = await generateDraft({ type, serviceId, productId, tone, hashtagStyle, nudge });
      res.json(draft);
    } catch (err) {
      console.error("generate failed:", err.message);
      res.status(503).json({
        error: "brain_unavailable",
        message: err.message,
      });
    }
  });

  // Real target keywords (with volumes) from the keyword-research file.
  app.get("/api/keywords", (_req, res) => {
    try {
      // Sheet + researcher keywords (measured volumes first). Was the sheet only,
      // so the Blogs picker never offered anything the researcher found.
      res.json({ keywords: mergedKeywords() });
    } catch (err) {
      res.json({ keywords: [], error: err.message });
    }
  });

  // React to one or more real URLs (SAP news, announcements). With several URLs
  // the brain synthesises a single angle. Body: { url | urls, tone, hashtagStyle, nudge }.
  app.post("/api/generate-from-url", async (req, res) => {
    const { url, urls, tone, hashtagStyle, nudge } = req.body || {};
    if (!url && !(Array.isArray(urls) && urls.length)) {
      return res.status(400).json({ error: "url(s) required" });
    }
    try {
      res.json(await generateFromUrl({ url, urls, tone, hashtagStyle, nudge }));
    } catch (err) {
      console.error("generate-from-url failed:", err.message);
      res.status(502).json({ error: "research_failed", message: err.message });
    }
  });

  // Prioritized content plan derived from the real keyword research
  // (content-strategy + seo-audit frameworks). Powers the SEO screen.
  app.get("/api/content-plan", (_req, res) => {
    try {
      res.json(getContentPlan());
    } catch (err) {
      res.json({ total: 0, pillars: [], prioritized: [], stageCounts: {}, error: err.message });
    }
  });

  // Generate an SEO blog draft. Body: { keyword, serviceId, nudge }.
  app.post("/api/blog/generate", async (req, res) => {
    const { keyword, serviceId, nudge } = req.body || {};
    if (!keyword) return res.status(400).json({ error: "keyword required" });
    try {
      res.json(await generateBlog({ keyword, serviceId, nudge }));
    } catch (err) {
      console.error("blog generate failed:", err.message);
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // On-page SEO brief (meta recommendations) for one keyword. Drives the SEO screen.
  app.post("/api/seo/brief", async (req, res) => {
    const { keyword, stage, contentType } = req.body || {};
    if (!keyword) return res.status(400).json({ error: "keyword required" });
    try {
      res.json(await generateSeoBrief({ keyword, stage, contentType }));
    } catch (err) {
      console.error("seo brief failed:", err.message);
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // Which live connectors are wired up? Drives the Connections screen.
  app.get("/api/connections", (_req, res) => {
    res.json({
      semrush: { id: "semrush", label: "SEMrush", connected: semrushConfigured() },
      ga4: { id: "ga4", label: "Google Analytics (GA4)", connected: ga4Configured() },
      gsc: { id: "gsc", label: "Google Search Console", connected: gscConfigured() },
      googleAuthMode: googleAuthMode(),
    });
  });

  // Where and how this copy runs — the UI reads it so it never claims "local only"
  // on the shared server. MKT_DEPLOYMENT=server is set by the service unit on the server.
  app.get("/api/deployment", (_req, res) => {
    const s = getSettings();
    const server = process.env.MKT_DEPLOYMENT === "server";
    res.json({
      mode: server ? "server" : "local",
      label: server ? "Running on the team's private server" : "Running locally on this PC",
      host: s.ollamaHost,
      model: s.textModel,
      qualityModel: s.qualityModel || "",
      // No paid API is wired in; the model runs on the instance's own GPU. Flip
      // this the day a metered provider is added so the money meter stops reading 0.
      priced: false,
      activeHoursEnabled: !!getAutopilot().activeHours?.enabled,
    });
  });
}
