// Marketing Engine brain server — routes: The Researcher-facing API.
// Registered from server/index.js via registerResearchRoutes(app).

import { getKeywords } from "../knowledge.js";
import { listPages, ingestText, relevantPages as wikiRelevantPages } from "../wiki.js";
import { company, services as companyServices } from "../../src/lib/company.js";
import { ALL_FRONTS } from "../seeds.js";
import {
  addActivity,
  listQueue,
  claimTopics,
  markTopicDone,
  addFinding,
  updateFinding,
  addDirective,
  setAutopilot,
  listResearchedKeywords,
  addResearchedKeywords,
  tasteSummary,
  upsertCompetitor,
  listCompetitors,
  load as loadStore,
  persist as persistStore,
} from "../stores.js";
import { nowISO } from "./shared.js";

// Only the calls that mean real research work (claim, findings, topic-done...)
// count as "seen". The read-only queue/context GETs run every 2h from the
// server timer even when it then exits with nothing to do, and used to make
// the Jarvis screen show the Researcher as active for 35 min each time.
function touchResearcher() {
  setAutopilot({ researcherLastSeenAt: nowISO() }, nowISO());
}

export function registerResearchRoutes(app) {
  // ----- Researcher-facing (the Claude /loop calls these) -----

  app.get("/api/research/context", (_req, res) => {
    // Standing competitor duty — computed HERE because the research loop is
    // stateless between iterations: every iteration gets one unambiguous
    // instruction instead of re-deriving cadence itself.
    //   refresh:  any profile untouched for 14+ days -> re-research the stalest
    //   discover: roster fresh but under 15 firms, and no new firm added in the
    //             last 12h -> hunt ONE new competitor (~2 discoveries/day max,
    //             so topic research never starves)
    //   none:     roster full and fresh
    const comps = listCompetitors();
    const nowMs = Date.now();
    const stale = comps
      .filter((c) => nowMs - Date.parse(c.updatedAt || 0) > 14 * 86400000)
      .sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")));
    const newestCreated = Math.max(0, ...comps.map((c) => Date.parse(c.createdAt || 0)));
    const competitorDuty = stale.length
      ? { mode: "refresh", name: stale[0].name, domain: stale[0].domain, lastResearched: stale[0].updatedAt }
      : comps.length < 15 && nowMs - newestCreated > 12 * 3600000
        ? { mode: "discover" }
        : { mode: "none" };
    res.json({
      competitorDuty,
      company: { name: company.name, oneLiner: company.oneLiner, site: company.site, audience: company.audience },
      services: companyServices.map((s) => ({ id: s.id, label: s.label })),
      topKeywords: getKeywords().slice(0, 25).map((k) => ({ keyword: k.keyword, volume: k.volume })),
      wikiTitles: listPages().slice(0, 120).map((p) => p.title),
      fronts: ALL_FRONTS,
      // What Tobias actually keeps vs kills — research toward what survives review.
      taste: tasteSummary(2),
      // Competitors already profiled (refresh stale ones instead of re-discovering).
      competitorsKnown: listCompetitors().map((c) => ({ name: c.name, domain: c.domain, updatedAt: c.updatedAt, gaps: (c.gaps || []).length })),
    });
  });

  // Fast grounding: "what does the brain already know about X?" Embedding search
  // only (no model call), so the Researcher can afford it every iteration before
  // deciding whether a topic needs fresh research or just a gap filled.
  app.get("/api/research/known", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    try {
      const pages = await wikiRelevantPages(q, 4);
      res.json({
        pages: pages.map((p) => ({ title: p.title, type: p.type, summary: p.summary, body: String(p.body || "").slice(0, 700) })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/research/queue", (req, res) => {
    res.json({ queue: listQueue({ status: req.query.status || "queued", limit: Number(req.query.limit) || 3 }) });
  });

  app.post("/api/research/claim", (req, res) => {
    touchResearcher();
    const { token, topics } = claimTopics(Number(req.body?.count) || 1, nowISO());
    for (const t of topics) addActivity({ actor: "researcher", event: "topic.claimed", summary: t.topic, ref: { topicId: t.id } }, nowISO());
    res.json({ claimToken: token, topics });
  });

  // Submit a finding. Ingests into the wiki (unless ingest:false) and dedups by hash.
  app.post("/api/research/findings", async (req, res) => {
    touchResearcher();
    const b = req.body || {};
    if (!b.title || !b.summary) return res.status(400).json({ error: "title and summary required" });
    const { record, duplicate } = addFinding(b, nowISO());
    addActivity({ actor: "researcher", event: "finding.submitted", summary: record.title, ref: { findingId: record.id } }, nowISO());

    if (!duplicate && b.ingest !== false) {
      try {
        const { written } = await ingestText({
          text: `${record.title}\n${record.summary}\n${(record.sources || []).join("\n")}`,
          sourceLabel: `research: ${record.front}`,
          nowISO: nowISO(),
        });
        updateFinding(record.id, { ingestedToWiki: written.map((w) => w.slug) });
        addActivity({ actor: "researcher", event: "finding.ingested", summary: `${record.title} -> ${written.map((w) => w.title).join(", ")}`, ref: { findingId: record.id } }, nowISO());
      } catch (err) {
        console.error("research finding ingest failed:", err.message);
      }
    }
    // Link the finding back onto its topic.
    if (record.topicId) {
      const q = loadStore("queue");
      const t = q.find((x) => x.id === record.topicId);
      if (t && !t.findingIds.includes(record.id)) {
        t.findingIds.push(record.id);
        persistStore("queue", q);
      }
    }
    res.json({ finding: record, duplicate });
  });

  // Researcher -> Worker steer: "build this" / "don't build that".
  app.post("/api/research/directive", (req, res) => {
    touchResearcher();
    const { kind, text, front } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    const rec = addDirective({ kind, text, front }, nowISO());
    if (rec) addActivity({ actor: "researcher", event: "directive.added", summary: `${rec.kind}: ${rec.text}`, ref: { directiveId: rec.id } }, nowISO());
    res.json({ added: !!rec, directive: rec });
  });

  app.post("/api/research/topic-done", (req, res) => {
    touchResearcher();
    const { topicId, claimToken } = req.body || {};
    const t = markTopicDone(topicId, claimToken, nowISO());
    if (!t) return res.status(404).json({ error: "not_found_or_wrong_token" });
    res.json(t);
  });

  // File / refresh a structured competitor profile (upserted by domain, so
  // profiles stay current instead of piling up). The Worker feeds the "gaps"
  // field into its drafting prompts. All content must come from real research.
  app.post("/api/research/competitor", (req, res) => {
    touchResearcher();
    const result = upsertCompetitor(req.body || {}, nowISO());
    if (result.error) return res.status(400).json(result);
    addActivity(
      {
        actor: "researcher",
        event: "competitor.profiled",
        summary: `${result.record.name} (${result.record.domain})${result.updated ? " updated" : " profiled"}`,
      },
      nowISO()
    );
    res.json(result);
  });

  // Submit SEMrush (or other structured) data as a finding + a wiki digest.
  app.post("/api/research/semrush", async (req, res) => {
    touchResearcher();
    const { front = "competitor-gaps", rows, note = "" } = req.body || {};
    const summary = note || `SEMrush data: ${Array.isArray(rows) ? rows.length : 0} rows.`;
    const { record, duplicate } = addFinding({ front, title: `SEMrush data (${front})`, summary, kind: "semrush", data: rows || null }, nowISO());
    if (!duplicate) {
      try {
        await ingestText({ text: `SEMrush research (${front})\n${summary}`, sourceLabel: `research: ${front}`, nowISO: nowISO() });
      } catch {
        /* best-effort */
      }
    }
    res.json({ finding: record, duplicate });
  });

  // The SEO keyword knowledge base. The deep researcher files discovered keywords here
  // (from SEMrush keyword_research / organic_research); they accumulate, dedupe, and
  // merge into the SEO screen's opportunity table. GET lists the whole KB.
  app.get("/api/research/keywords", (_req, res) => {
    touchResearcher();
    res.json({ keywords: listResearchedKeywords() });
  });

  app.post("/api/research/keywords", async (req, res) => {
    touchResearcher();
    const b = req.body || {};
    // Keep only plain objects — one malformed row (null, a string) used to throw
    // inside addResearchedKeywords and, uncaught in an Express 4 async handler,
    // HANG the request forever instead of returning an error.
    const rows = (Array.isArray(b.keywords) ? b.keywords : Array.isArray(b.rows) ? b.rows : []).filter(
      (r) => r && typeof r === "object" && !Array.isArray(r)
    );
    if (!rows.length) return res.status(400).json({ error: "keywords[] required (objects with a keyword field)" });
    const meta = {
      front: b.front || "content-seo",
      serviceId: b.serviceId || "",
      // No default "semrush": the researcher had no SEMrush access for most runs,
      // so an unlabelled volume is a guess, not a measurement.
      source: b.source || "unverified",
      database: b.database || "",
      note: b.note || "",
    };
    let result;
    try {
      result = addResearchedKeywords(rows, meta, nowISO());
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    addActivity(
      { actor: "researcher", event: "keywords.filed", summary: `SEO keywords: ${result.added} new, ${result.updated} updated (${meta.front}), KB now ${result.total}` },
      nowISO()
    );
    // Also drop a digest into the wiki so the keyword research lands in the knowledge base.
    if (result.added || result.updated) {
      try {
        const top = rows
          .slice(0, 25)
          .map((r) => `${r.keyword}${r.volume ? ` (${r.volume}/mo)` : ""}`)
          .join(", ");
        await ingestText({
          text: `SEO keyword research (${meta.front}${meta.serviceId ? `, ${meta.serviceId}` : ""})\nTarget keywords: ${top}\n${meta.note}`,
          sourceLabel: `research: ${meta.front}`,
          nowISO: nowISO(),
        });
      } catch {
        /* best-effort */
      }
    }
    res.json(result);
  });
}
