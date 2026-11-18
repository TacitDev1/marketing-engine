// Marketing Engine brain server — routes: The LLM-Wiki.
// Registered from server/index.js via registerWikiRoutes(app).

import {
  listPages,
  getPage,
  deletePage,
  unlinkTitle,
  savePage,
  ingestText,
  buildFromKnowledge,
  query as wikiQuery,
  lint as wikiLint,
  crosslinkOrphans,
  wikiStatus,
  graphData,
  ensureSchema,
} from "../wiki.js";
import { nowISO } from "./shared.js";

export function registerWikiRoutes(app) {
  // ---------- LLM-Wiki (Karpathy pattern): the AI-maintained knowledge base ----------

  app.get("/api/wiki/status", (_req, res) => {
    try {
      res.json(wikiStatus());
    } catch (err) {
      res.json({ pages: 0, byType: {}, links: 0, error: err.message });
    }
  });

  app.get("/api/wiki/pages", (_req, res) => {
    try {
      // Send list metadata only (no full bodies) to keep it light.
      res.json({
        pages: listPages().map(({ slug, title, type, updated, summary, links, sources }) => ({
          slug, title, type, updated, summary, links, sources,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/wiki/page/:slug", (req, res) => {
    const page = getPage(req.params.slug);
    if (!page) return res.status(404).json({ error: "not_found" });
    res.json(page);
  });

  // Knowledge graph: nodes + explicit & semantic edges for the Second Brain graph.
  app.get("/api/wiki/graph", async (_req, res) => {
    try {
      res.json(await graphData());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // All pages WITH bodies — powers the Second Brain (search, graph, backlinks).
  app.get("/api/wiki/all", (_req, res) => {
    try {
      res.json({ pages: listPages() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save hand-edits to a page. Body: { title, type, summary, body }.
  app.put("/api/wiki/page/:slug", (req, res) => {
    const { title, type, summary, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    try {
      const existing = getPage(req.params.slug);
      const saved = savePage(
        { slug: req.params.slug, title, type, summary, body, sources: existing?.sources || [] },
        nowISO()
      );
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/wiki/page/:slug", (req, res) => {
    // Turn every [[link]] to the deleted page into plain text first, so the
    // graph never keeps edges to a page that no longer exists.
    const page = getPage(req.params.slug);
    const unlinked = page ? unlinkTitle(page.title, nowISO()) : 0;
    res.json({ deleted: deletePage(req.params.slug), unlinked });
  });

  // Ingest pasted/sourced text into the wiki. Body: { text, sourceLabel }.
  app.post("/api/wiki/ingest", async (req, res) => {
    const { text, sourceLabel } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: "text required" });
    try {
      res.json(await ingestText({ text: String(text), sourceLabel: sourceLabel || "pasted note", nowISO: nowISO() }));
    } catch (err) {
      console.error("wiki ingest failed:", err.message);
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // Seed the wiki from the ingested knowledge files. Long-running.
  app.post("/api/wiki/build-from-knowledge", async (req, res) => {
    const perSource = Number(req.body?.perSource) || 2;
    try {
      ensureSchema(nowISO());
      res.json(await buildFromKnowledge({ nowISO: nowISO(), perSource }));
    } catch (err) {
      console.error("wiki build failed:", err.message);
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // Ask the wiki a question. Body: { question, fileAnswer }.
  app.post("/api/wiki/query", async (req, res) => {
    const { question, fileAnswer } = req.body || {};
    if (!question) return res.status(400).json({ error: "question required" });
    try {
      res.json(await wikiQuery({ question: String(question), fileAnswer: !!fileAnswer, nowISO: nowISO() }));
    } catch (err) {
      console.error("wiki query failed:", err.message);
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // Health-check the wiki (orphans, stale, contradictions, gaps).
  app.post("/api/wiki/lint", async (_req, res) => {
    try {
      res.json(await wikiLint({ nowISO: nowISO() }));
    } catch (err) {
      console.error("wiki lint failed:", err.message);
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // Batch cross-link every orphan page into the graph (clears the orphan backlog).
  app.post("/api/wiki/crosslink", async (req, res) => {
    try {
      res.json(await crosslinkOrphans({ nowISO: nowISO(), max: Number(req.body?.max) || 500 }));
    } catch (err) {
      console.error("wiki crosslink failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
