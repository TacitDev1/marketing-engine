// Marketing Engine — the backend ("the brain server").
//
// Runs on a laptop for development and on the team's server (MKT_DEPLOYMENT=server),
// always bound to loopback. This file wires the app together: the routes live in
// server/routes/, one module per area. The brain drafts and schedules; it never
// posts to LinkedIn or publishes the website on its own.

import path from "node:path";
import express from "express";
import { brainInfo } from "./brain.js";
import { ffmpegStatus } from "./images.js";
import { startWorker } from "./worker.js";
import { startLibrarian } from "./librarian.js";
import { startSessionScheduler } from "./session.js";
import { startScheduler } from "./schedule.js";
import { registerContentRoutes } from "./routes/content.js";
import { registerWebsiteRoutes } from "./routes/website.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerWikiRoutes } from "./routes/wiki.js";
import { registerLibrarianRoutes } from "./routes/librarian.js";
import { registerCompetitorRoutes } from "./routes/competitors.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerDraftRoutes, runBlogAudit } from "./routes/drafts.js";
import { registerScheduleRoutes } from "./routes/schedule.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerImageRoutes, JSON_EXEMPT } from "./routes/images.js";
import { registerJarvisRoutes } from "./routes/jarvis.js";
import { registerAutopilotRoutes } from "./routes/autopilot.js";
import { registerResearchRoutes } from "./routes/research.js";
import { registerAgentTeamRoutes } from "./routes/agent-team.js";
import { registerAgentWorkRoutes } from "./routes/agent-work.js";
import { registerEditorRoutes } from "./routes/editor.js";
import { registerPublishingRoutes } from "./routes/publishing.js";
import { startAutoPublisher } from "./autopublish.js";
import { startSummaryScheduler } from "./weekly-summary.js";
import { startWeekAheadScheduler } from "./week-ahead.js";
import { startApprovalCollector } from "./approvals.js";

// Never let one stray async error take the whole brain down. A background
// worker tick or a connector that rejects should be logged, not fatal — the
// server stays up so the UI keeps working. (Local, single-user; logging and
// continuing is the right call here.)
process.on("unhandledRejection", (err) => {
  console.error("[brain] unhandled rejection (ignored):", err?.message || err);
});
process.on("uncaughtException", (err) => {
  console.error("[brain] uncaught exception (ignored):", err?.message || err);
});

const app = express();
// Global JSON parser, EXCEPT for routes that mount their own with a bigger
// limit — a global parser runs first and would 413 their payloads at 1 MB
// before the route-level one is ever reached (this silently broke saving
// posters over 1 MB).
// The exempt paths are declared next to the routes that need them.
const jsonParser = express.json({ limit: "1mb" });
app.use((req, res, next) => (JSON_EXEMPT.has(req.path) ? next() : jsonParser(req, res, next)));

const PORT = process.env.PORT || 8787;

// Routes, by area (server/routes/). Order is the original registration order.
registerContentRoutes(app);
registerWebsiteRoutes(app);
registerAnalyticsRoutes(app);
registerWikiRoutes(app);
registerLibrarianRoutes(app);
registerCompetitorRoutes(app);
registerFeedbackRoutes(app);
registerDraftRoutes(app);
registerScheduleRoutes(app);
registerSettingsRoutes(app);
registerImageRoutes(app);
registerJarvisRoutes(app);
registerAutopilotRoutes(app);
registerResearchRoutes(app);
registerAgentTeamRoutes(app);
registerAgentWorkRoutes(app);
registerEditorRoutes(app);
registerPublishingRoutes(app);

// PRODUCTION SERVE: with SERVE_DIST=1 the brain also serves the built frontend
// (dist/), so one loopback port carries the whole app and the server's HTTPS
// front door (a reverse proxy) exposes it. Dev keeps using Vite's proxy. API routes above win;
// any other GET falls back to index.html for the React router.
if (process.env.SERVE_DIST === "1") {
  const DIST = path.resolve(import.meta.dirname, "../dist");
  app.use(express.static(DIST, { index: "index.html", maxAge: "1h", etag: true }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(`${DIST}/index.html`, { maxAge: 0 }));
  console.log(`Serving the built frontend from ${DIST}`);
}

// Bind address. 127.0.0.1 by default and ALSO on the server: people reach the
// app through the server's HTTPS reverse proxy (HTTPS -> loopback), so the app
// itself never listens on a network interface. HOST exists only for unusual setups.
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`Larkwell brain server on http://${HOST}:${PORT}${process.env.MKT_DEPLOYMENT === "server" ? " (server mode)" : ""}`);
  console.log(`Model: ${brainInfo().model} via ${brainInfo().host}`);
  const ff = ffmpegStatus();
  if (ff.available) console.log(`ffmpeg: ${ff.path}`);
  else console.warn(`WARNING: ${ff.hint}`);
  // On the server Jarvis works in one daily session (server/session.js); the
  // old 10-minute Worker tick only runs on a laptop (and still starts OFF).
  if (process.env.MKT_DEPLOYMENT !== "server") startWorker();
  startSessionScheduler();
  runBlogAudit();
  setInterval(runBlogAudit, 6 * 3600 * 1000).unref();
  startLibrarian();
  startScheduler();
  startAutoPublisher();
  startSummaryScheduler();
  startWeekAheadScheduler();
  startApprovalCollector();
});
