// Marketing Engine brain server — routes: SEMrush, GA4, Search Console, combined analytics, SEO opportunities.
// Registered from server/index.js via registerAnalyticsRoutes(app).

import { semrushConfigured, domainOverview, topKeywords } from "../tools/semrush.js";
import {
  ga4Configured,
  gscConfigured,
  ga4Summary,
  gscTopQueries,
  analyticsSummary,
  gscOpportunities,
} from "../tools/google.js";

export function registerAnalyticsRoutes(app) {
  // SEMrush data (gated).
  app.get("/api/semrush/overview", async (_req, res) => {
    if (!semrushConfigured()) return res.status(409).json({ error: "not_configured" });
    try {
      res.json(await domainOverview());
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
  app.get("/api/semrush/keywords", async (_req, res) => {
    if (!semrushConfigured()) return res.status(409).json({ error: "not_configured" });
    try {
      res.json({ keywords: await topKeywords() });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Google Analytics + Search Console data (gated).
  app.get("/api/ga4/summary", async (_req, res) => {
    if (!ga4Configured()) return res.status(409).json({ error: "not_configured" });
    try {
      res.json(await ga4Summary());
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
  // GSC opportunity mining for the SEO screen: striking-distance queries
  // (position 4-15, almost winning) + CTR gaps (seen but under-clicked).
  // Cached 10 min inside gscOpportunities.
  app.get("/api/seo/opportunities", async (_req, res) => {
    if (!gscConfigured()) return res.status(409).json({ error: "not_configured" });
    try {
      res.json(await gscOpportunities());
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Combined GA4 + Search Console payload for the Analytics screen.
  // analyticsSummary never throws (each half catches its own errors) and is
  // cached 60s server-side, so the screen's minute-refresh is quota-safe.
  app.get("/api/analytics/summary", async (_req, res) => {
    if (!ga4Configured() && !gscConfigured()) {
      return res.status(409).json({ error: "not_configured" });
    }
    // analyticsSummary is meant never to throw, but the preview/process work it
    // can touch genuinely can — wrap it so a failure returns 500, never hangs.
    try {
      res.json(await analyticsSummary());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/gsc/queries", async (_req, res) => {
    if (!gscConfigured()) return res.status(409).json({ error: "not_configured" });
    try {
      res.json({ queries: await gscTopQueries() });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
}
