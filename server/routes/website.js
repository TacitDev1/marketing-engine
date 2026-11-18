// Marketing Engine brain server — routes: The website window + built-in CMS, Go Live, Lighthouse audit, live preview.
// Registered from server/index.js via registerWebsiteRoutes(app).

import { reviseDraft } from "../brain.js";
import { listDrafts, updateDraft } from "../drafts.js";
import { markPublished as scheduleMarkPublished } from "../schedule.js";
import { addActivity, addTasteEvent } from "../stores.js";
import {
  siteAvailable,
  overview as websiteOverview,
  listPages as websitePages,
  readEntry as websiteEntry,
  exportBlogDraft,
  siteRoutes,
  listManaged,
  readManaged,
  updateEntry,
  setEntryVisibility,
  siteChanges,
  goLive,
} from "../website.js";
import { siteDevStatus, startSiteDev, stopSiteDev } from "../site-dev.js";
import { auditStatus, runAudit } from "../tools/lighthouse.js";
import { nowISO } from "./shared.js";

// After a successful push: every committed file that is visible on the site is
// now public, so its Library draft is "posted" and its schedule slot closes.
function markLiveDrafts(committed) {
  const drafts = listDrafts();
  for (const c of committed || []) {
    const draft = drafts.find((d) => d.payload?.exportedRel === c.rel);
    if (!draft || draft.status === "posted" || draft.status === "delete" || draft.status === "archived") continue;
    const meta = readManaged(c.rel);
    if (!meta || meta.draft) continue; // still hidden on the site
    updateDraft(draft.id, { status: "posted" }, nowISO());
    const p = draft.payload || {};
    addTasteEvent({ event: "posted", kind: draft.kind, postType: p.postType || p.type || "", serviceId: p.serviceId || p.service || "", origin: p.origin || "" }, nowISO());
    scheduleMarkPublished(draft.id, nowISO());
  }
}

export function registerWebsiteRoutes(app) {
  // ----- Website (read-only window into the parked company-website) -----
  // We never rebuild the site here; we report its state, preview content, and
  // export blog drafts into src/content/news/en as draft:true markdown.
  app.get("/api/website/overview", (_req, res) => res.json(websiteOverview()));
  app.get("/api/website/pages", (_req, res) => res.json(websitePages()));
  app.get("/api/website/routes", (_req, res) => res.json(siteRoutes()));
  app.get("/api/website/page", (req, res) => {
    const entry = websiteEntry(String(req.query.rel || ""));
    if (!entry) return res.status(404).json({ error: "not_found" });
    res.json(entry);
  });
  // Push an approved blog draft from the Library onto the migrated site.
  // publish:true writes draft:false (visible in the preview); default is hidden.
  app.post("/api/website/export-draft", (req, res) => {
    if (!siteAvailable()) return res.status(409).json({ error: "site_not_found" });
    const body = req.body || {};
    const draft = listDrafts().find((d) => d.id === body.draftId);
    if (!draft) return res.status(404).json({ error: "draft_not_found" });
    if (draft.status === "delete") {
      return res.status(409).json({ error: "marked_for_deletion", message: "This draft is marked \"To delete\" in the Library. Un-mark it there first if it should go on the website." });
    }
    if (draft.status === "archived") {
      return res.status(409).json({ error: "archived", message: "This draft is archived. Restore it in the Library first if it should go on the website." });
    }
    // Re-publishing overwrites the same file instead of duplicating it: pass the
    // rel this draft was published to before, and remember the result.
    const result = exportBlogDraft(draft, {
      publish: !!body.publish,
      overwriteRel: draft.payload?.exportedRel || null,
    });
    if (!result.ok) return res.status(400).json(result);
    // Writing the file only stages it in the site repo. The draft becomes
    // "posted" when Go Live actually pushes it (see markLiveDrafts), so the
    // Library and the Schedule never claim a post the public can't see yet.
    updateDraft(draft.id, { payload: { ...draft.payload, exportedRel: result.rel } }, nowISO());
    addActivity(
      {
        actor: "human",
        event: "website.draft-exported",
        summary: `${result.rel}${result.overwritten ? " (updated)" : ""}${result.published ? " (visible)" : " (hidden draft)"}`,
      },
      nowISO()
    );
    res.json(result);
  });

  // ----- Manage the website (the built-in CMS: posts + success stories) -----
  // List everything manageable + what's waiting to go live, in one call.
  app.get("/api/website/manage", async (_req, res) => {
    try {
      const [{ entries }, changes] = [listManaged(), await siteChanges()];
      res.json({
        available: siteAvailable(),
        entries,
        changes: changes.changes || [],
        unpushed: changes.unpushed || 0,
        changesError: changes.error || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // One entry with its body, for the editor.
  app.get("/api/website/entry", (req, res) => {
    const entry = readManaged(String(req.query.rel || ""));
    if (!entry) return res.status(404).json({ error: "not_found" });
    res.json(entry);
  });

  // Edit title / description / body in place (backed up first).
  app.patch("/api/website/entry", (req, res) => {
    const { rel, title, description, body } = req.body || {};
    const result = updateEntry(String(rel || ""), { title, description, body });
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    addActivity(
      { actor: "human", event: "website.entry-edited", summary: result.rel },
      nowISO()
    );
    res.json(result);
  });

  // Revise page content per a plain-language instruction WITHOUT saving anything:
  // the Manage-site editor applies the result to its form fields, the human
  // reviews, and only their Save writes to disk (and only Go Live publishes).
  // Same edit-don't-rewrite mechanism as the Library's Brief Jarvis.
  app.post("/api/website/entry/revise", async (req, res) => {
    const { title, description, body, instruction } = req.body || {};
    if (!String(instruction || "").trim()) return res.status(400).json({ error: "instruction required" });
    if (!String(body || "").trim()) return res.status(400).json({ error: "body required" });
    try {
      const { payload, warnings } = await reviseDraft({
        kind: "blog",
        payload: { title: title || "", metaDescription: description || "", body },
        instruction: String(instruction),
      });
      res.json({
        title: payload.title ?? title,
        description: payload.metaDescription ?? description,
        body: payload.body ?? body,
        warnings: warnings || [],
      });
    } catch (err) {
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // Show / hide a post on the site.
  app.post("/api/website/entry/visibility", (req, res) => {
    const { rel, visible } = req.body || {};
    const result = setEntryVisibility(String(rel || ""), !!visible);
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    // Making it visible only changes the file; the Library draft is marked
    // posted when Go Live pushes it (markLiveDrafts), not here.
    addActivity(
      { actor: "human", event: "website.entry-visibility", summary: `${result.rel} → ${visible ? "visible" : "hidden"}` },
      nowISO()
    );
    res.json(result);
  });

  // Go Live: commit + push content changes straight to PRODUCTION (main);
  // The site host builds a branch deploy, the team reviews, then merges on GitHub.
  // Body: { rels?: [...] } — the exact files the person confirmed.
  app.post("/api/website/golive", async (req, res) => {
    try {
      const result = await goLive({ rels: req.body?.rels });
      if (!result.ok) {
        const status = ["nothing_to_publish", "changes_moved", "wrong_branch", "merge_commits", "non_content_commits", "already_running"].includes(result.error) ? 409 : 502;
        return res.status(status).json(result);
      }
      try {
        markLiveDrafts(result.committed);
      } catch (err) {
        console.error("markLiveDrafts:", err.message); // the push itself succeeded
      }
      const titles = (result.committed || []).map((c) => c.title).slice(0, 4).join(", ");
      addActivity(
        {
          actor: "human",
          event: "website.golive",
          summary: `${(result.committed || []).length || "pending"} content change(s) published to larkwell.example (branch ${result.branch})${titles ? `: ${titles}` : ""}`,
        },
        nowISO()
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ----- Site health: local Lighthouse audit of the Astro preview -----
  // Free, keyless, runs the real Google audit engine against the LOCAL site.
  // POST kicks it off in the background (starts the preview if needed, then
  // ~30-60s of auditing); GET reports progress + the persisted last result.
  app.get("/api/website/audit", (_req, res) => res.json(auditStatus()));
  app.post("/api/website/audit", (req, res) => {
    const status = auditStatus();
    if (status.running) return res.status(409).json({ error: "already_running" });
    if (!status.chromeAvailable) return res.status(409).json({ error: "chrome_missing" });
    const pagePath = String(req.body?.path || "/");
    runAudit(pagePath)
      .then((r) => {
        addActivity(
          {
            actor: "human",
            event: "website.audit",
            summary: `${pagePath} — perf ${r.scores.performance}, a11y ${r.scores.accessibility}, seo ${r.scores.seo}`,
          },
          nowISO()
        );
      })
      .catch((err) => console.error("lighthouse audit failed:", err.message));
    res.json({ ok: true, started: true, path: pagePath });
  });

  // ----- Website live preview (runs the migrated Astro site for the iframe) -----
  // Read-only: starts/stops `astro dev`; never edits the site's files.
  // Express 4 doesn't forward async-handler rejections, so an unwrapped throw
  // here hangs the request (no 500) instead of failing fast. Wrap each.
  app.get("/api/website/preview/status", async (_req, res) => {
    try { res.json(await siteDevStatus()); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post("/api/website/preview/start", async (_req, res) => {
    try { res.json(await startSiteDev()); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post("/api/website/preview/stop", async (_req, res) => {
    try { res.json(await stopSiteDev()); } catch (err) { res.status(500).json({ error: err.message }); }
  });
}
