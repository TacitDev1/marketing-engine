// Marketing Engine brain server — routes: what the agents read and file
// (reports, the Strategist's week plan, the SEO and Measurement briefs).
// Registered from server/index.js via registerAgentWorkRoutes(app).

import { fileReport, listReports, previousReport } from "../agent-reports.js";
import { strategistBrief, saveWeekPlan, currentPlan, listPlans } from "../week-plan.js";
import { pageFacts, siteFiles, trackingCheck, siteBase } from "../site-check.js";
import { gscConfigured, ga4Configured, gscOpportunities, analyticsSummary } from "../tools/google.js";
import { auditStatus } from "../tools/lighthouse.js";
import { listRecommendations, load } from "../stores.js";
import { listDrafts } from "../drafts.js";
import { syncWiki, searchWiki } from "../wiki-bridge.js";
import { nowISO } from "./shared.js";

const WEEK_MS = 7 * 86400000;
const soft = async (fn, missing, label) => {
  try {
    return await fn();
  } catch (err) {
    missing.push(`${label} failed: ${String(err.message).slice(0, 120)}`);
    return null;
  }
};
const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};
const publishedSince = (ms) =>
  (load("publishing")?.log || [])
    .filter((e) => e.status === "published" && Date.now() - Date.parse(e.at) < ms)
    .map((e) => ({ title: e.title, url: e.url, path: pathOf(e.url), date: e.dateKey }));

// Express 4 does not catch a rejected async handler: without this a thrown
// error would leave the agent's request hanging until it timed out.
const guarded = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(`${req.method} ${req.path}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: "failed", message: String(err.message).slice(0, 200) });
  }
};

export function registerAgentWorkRoutes(app) {
  // ---------- Reports (any agent) ----------
  app.get("/api/agents/reports", (req, res) => {
    res.json({ reports: listReports({ agentId: String(req.query.agent || ""), limit: Math.min(50, Number(req.query.limit) || 20) }) });
  });
  app.post("/api/agents/:id/reports", (req, res) => {
    const out = fileReport(req.params.id, req.body || {}, nowISO());
    if (out.error === "not_found") return res.status(404).json(out);
    if (out.error) return res.status(400).json({ ...out, message: "A report needs a headline and a body." });
    syncWiki(nowISO());
    res.json({ report: { id: out.report.id, actions: out.report.actions.length }, ok: true });
  });

  // ---------- The wiki, for agents ----------
  // The pages most relevant to a question (?q=...&n=5): research findings,
  // competitor notes, and the pages the agents' own work is recorded on.
  app.get("/api/wiki/search", guarded(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q_required", message: "Pass the question as ?q=..." });
    res.json({ query: q, pages: await searchWiki(q, Number(req.query.n) || 5) });
  }));

  // ---------- Strategist ----------
  app.get("/api/strategist/brief", guarded(async (_req, res) => res.json(await strategistBrief())));
  app.get("/api/strategist/plan", (_req, res) => res.json({ plan: currentPlan(), plans: listPlans() }));
  app.post("/api/strategist/plan", (req, res) => {
    const out = saveWeekPlan(req.body || {}, nowISO());
    if (out.error) {
      return res.status(400).json({ ...out, message: "A plan needs a focus and at least one piece; each piece needs kind (blog or linkedin), angle and why, and a blog needs a keyword." });
    }
    syncWiki(nowISO());
    res.json({ ok: true, plan: { id: out.plan.id, weekOf: out.plan.weekOf, pieces: out.plan.pieces.length, research: out.plan.research.length } });
  });

  // ---------- SEO ----------
  // Where to look this week: what search data says, what was checked and
  // proposed last time, and the site's own crawl files.
  app.get("/api/seo/brief", guarded(async (_req, res) => {
    const missing = [];
    let search = null;
    if (gscConfigured()) {
      const o = await soft(gscOpportunities, missing, "Search Console");
      const a = await soft(analyticsSummary, missing, "Search Console pages");
      if (o) search = { range: o.range, closeToPageOne: o.strikingDistance, seenButNotClicked: o.ctrGaps, topPages: (a?.gsc?.pages || []).slice(0, 20), topQueries: (a?.gsc?.queries || []).slice(0, 20) };
    } else missing.push("Search Console is not connected on this machine.");
    const files = await soft(siteFiles, missing, "Fetching the site");
    const lh = auditStatus().lastResult;
    res.json({
      site: siteBase(),
      search,
      siteFiles: files,
      publishedInLast14Days: publishedSince(2 * WEEK_MS),
      lastSpeedAudit: lh ? { path: lh.path, date: String(lh.finishedAt || "").slice(0, 10), scores: lh.scores, metrics: lh.metrics } : null,
      previous: previousReport("seo"),
      openSeoRecommendations: listRecommendations({ status: "open" })
        .filter((r) => ["technical-seo", "content-seo", "schema", "site-health", "performance"].includes(r.front))
        .slice(0, 30)
        .map((r) => r.title),
      missing,
    });
  }));
  // On-page facts for one page of Larkwell's site (?path=/sap-services/). Read-only.
  app.get("/api/seo/page", guarded(async (req, res) => {
    const facts = await pageFacts(req.query.path);
    if (facts.error === "not_this_site") return res.status(400).json({ ...facts, message: `Only pages of ${siteBase()} can be checked; pass a path such as /contact-us.` });
    res.json(facts);
  }));

  // ---------- Measurement ----------
  app.get("/api/measurement/brief", guarded(async (_req, res) => {
    const missing = [];
    let analytics = null;
    if (ga4Configured() || gscConfigured()) {
      const a = await soft(analyticsSummary, missing, "Analytics");
      if (a) {
        const half = (h, keep) => (!h ? null : h.error ? { error: h.error } : keep(h));
        analytics = {
          range: a.range,
          ga4: half(a.ga4, (g) => ({ totals: g.totals, dailyTrend: g.trend, topPages: g.topPages.slice(0, 15), sources: g.sources })),
          searchConsole: half(a.gsc, (g) => ({ totals: g.totals, dailyTrend: g.trend, topQueries: g.queries.slice(0, 20), topPages: g.pages.slice(0, 15) })),
        };
      }
    }
    if (!ga4Configured()) missing.push("GA4 is not connected on this machine.");
    if (!gscConfigured()) missing.push("Search Console is not connected on this machine.");
    const published = publishedSince(4 * WEEK_MS);
    // Home, the contact page (where the conversion happens), one service page
    // and one article from the sitemap, and the newest published blogs.
    const inSitemap = (await soft(siteFiles, missing, "Fetching the sitemap"))?.sitemapPaths || [];
    const sample = [/^\/sap\/.+/, /^\/news\/.+/].map((re) => inSitemap.find((p) => re.test(p)));
    const paths = [...new Set(["/", "/contact-us", ...sample, ...published.slice(0, 2).map((p) => p.path)].filter(Boolean))];
    const tracking = await soft(() => trackingCheck(paths), missing, "Tracking check");
    const weekAgo = Date.now() - WEEK_MS;
    const drafts = listDrafts();
    res.json({
      site: siteBase(),
      conversion: "A submitted contact form on /contact-us (the site's contact form). The brain cannot read form submissions; treat the count as unknown unless GA4 shows it.",
      analytics,
      tracking,
      publishedInLast4Weeks: published,
      thisWeek: {
        written: drafts.filter((d) => Date.parse(d.savedAt || 0) > weekAgo).length,
        blogsPublished: published.filter((p) => Date.parse(p.date) > weekAgo - 86400000).length,
        linkedinPostedByPeople: drafts.filter((d) => d.kind === "linkedin" && d.status === "posted" && Date.parse(d.updatedAt || 0) > weekAgo).length,
      },
      previous: previousReport("measurement"),
      missing,
    });
  }));
}
