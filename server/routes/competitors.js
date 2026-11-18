// Marketing Engine brain server — routes: Competitor profiles.
// Registered from server/index.js via registerCompetitorRoutes(app).

import { generateDraft, isBrainAvailable } from "../brain.js";
import { saveDraft } from "../drafts.js";
import { addActivity, enqueueTopic, upsertCompetitor, listCompetitors } from "../stores.js";
import { nowISO } from "./shared.js";

export function registerCompetitorRoutes(app) {
  // ---------- Competitor profiles (maintained by the Researcher) ----------

  app.get("/api/competitors", (_req, res) => {
    try {
      res.json({ competitors: listCompetitors() });
    } catch (err) {
      res.json({ competitors: [], error: err.message });
    }
  });

  // Queue a (re-)research of one competitor for the Researcher. Body: { name, domain? }.
  // Used by the Competitors screen's "Re-research" and "Add competitor" actions.
  app.post("/api/competitors/research", (req, res) => {
    const name = String(req.body?.name || "").trim();
    const domain = String(req.body?.domain || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const rec = enqueueTopic(
      {
        topic: `Profile the competitor ${name}${domain ? ` (${domain})` : ""}: current positioning, content themes, strengths, and concrete gaps where Larkwell can win. File the structured profile via /api/research/competitor.`,
        front: "competitor-gaps",
        priority: 3,
        rationale: "requested from the Competitors screen",
        createdBy: "human",
      },
      nowISO()
    );
    // A hand-added competitor gets a bare card immediately (name + domain only,
    // marked awaiting research) so the screen reflects the request — the profile
    // CONTENT only ever comes from the Researcher's real sources.
    if (domain && !listCompetitors().some((c) => c.domain.includes(domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]))) {
      upsertCompetitor({ name, domain, note: "Added by hand — awaiting research." }, nowISO());
    }
    if (rec) addActivity({ actor: "human", event: "competitor.research-queued", summary: name }, nowISO());
    res.json({ queued: !!rec, topic: rec, message: rec ? undefined : "That competitor is already in the research queue." });
  });

  // Turn one competitor gap into a Library draft ("draft the piece that wins it").
  // Never names the competitor in the content — the gap is the topic, not the rival.
  app.post("/api/competitors/:id/draft-gap", async (req, res) => {
    const comp = listCompetitors().find((c) => c.id === req.params.id);
    if (!comp) return res.status(404).json({ error: "not_found" });
    const gap = String(req.body?.gap || "").trim();
    if (!gap) return res.status(400).json({ error: "gap required" });
    if (!(await isBrainAvailable())) return res.status(503).json({ error: "brain_unavailable" });
    const nudge = `Topic: ${gap}. Context: this is underserved in the market and Larkwell covers it well — position Larkwell as the credible answer, concretely. Do NOT name, quote, or disparage any competitor.`;
    try {
      const payload = await generateDraft({ type: "how-to", nudge });
      if (!payload || !payload.hook) return res.status(502).json({ error: "draft_failed" });
      payload.origin = "competitor-gap";
      payload.front = "competitor-gaps";
      payload.competitorId = comp.id;
      const draft = saveDraft({ kind: "linkedin", payload, nowISO: nowISO() });
      addActivity(
        { actor: "human", event: "competitor.gap-drafted", summary: `${comp.name}: ${gap.slice(0, 60)}`, ref: { libraryId: draft?.id } },
        nowISO()
      );
      res.json({ draft });
    } catch (err) {
      res.status(503).json({ error: "draft_failed", message: err.message });
    }
  });
}
