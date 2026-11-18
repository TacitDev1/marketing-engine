#!/usr/bin/env node
// Tests for phase 3 of the agent team (2026-11-16): the reports agents file
// (server/agent-reports.js), the Strategist's week plan (server/week-plan.js),
// the read-only site checks (server/site-check.js), the routes the Strategist,
// SEO and Measurement agents call, and their place in the weekly summary.
//
// Runs against a throwaway copy of server/ + src/lib/ in a temp folder. The
// "website" is a tiny local server started here, so nothing real is fetched.
//
//   node scripts/test-agent-work.mjs
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const box = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-agent-work-"));
fs.cpSync(path.join(root, "server"), path.join(box, "server"), { recursive: true });
fs.cpSync(path.join(root, "src/lib"), path.join(box, "src/lib"), { recursive: true });
fs.symlinkSync(path.join(root, "node_modules"), path.join(box, "node_modules"), process.platform === "win32" ? "junction" : "dir");
fs.writeFileSync(path.join(box, "package.json"), JSON.stringify({ type: "module" }));
fs.mkdirSync(path.join(box, "data"));
fs.mkdirSync(path.join(box, "wiki"));

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures++;
};
const read = (f) => JSON.parse(fs.readFileSync(path.join(box, "data", f), "utf8"));

// ---------- a fake website ----------
const SITE_PORT = 8795;
const HOME = `<!doctype html><html lang="en-GB"><head>
<title>SAP consulting &amp; cloud&#1114112; | Larkwell Consulting</title>
<meta data-name="x" name="description" content="Larkwell Consulting runs, migrates and supports SAP landscapes for enterprises.">
<link rel="canonical" href="http://127.0.0.1:${SITE_PORT}/">
<link rel="alternate" hreflang="de" href="http://127.0.0.1:${SITE_PORT}/de/">
<meta property="og:title" content="Larkwell &#38; friends &amp;amp;">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Larkwell"},{"@type":["WebSite","Thing"]}]}</script>
<script type="application/ld+json">{not json}</script>
<script>(function(w,d,s,l,i){})(window,document,'script','dataLayer','GTM-TEST123');</script>
</head><body><nav><a href="/sap-services">Services</a><a href="https://example.com/x">Out</a><a href="//evil.example/y">Out too</a></nav>
<main><h1>SAP, run properly</h1><h2>What we do</h2><p>One two three four five.</p><pre>.. -= :* #+ .-. ... -- ++ ** ## .. -= :* #+ .-. ... -- ++ ** ##</pre>
<img src="a.png" data-alt="x"><img src="b.png" alt="A diagram">
<a href="http://127.0.0.1:${SITE_PORT}/contact-us">Talk to us</a></main>
<script>var hidden = "words that are not content";</script></body></html>`;
const CONTACT = `<html><head><title>Contact</title></head><body><h1>Contact</h1><form name="contact" data-netlify="true" action="/thanks"></form><script>_linkedin_partner_id = "1";</script></body></html>`;
const PAGES = {
  "/": HOME,
  "/contact-us": CONTACT,
  "/sap-services": "<html><head><title>Services</title></head><body><h1>Services</h1></body></html>",
  "/robots.txt": `User-agent: *\nAllow: /\nSitemap: http://127.0.0.1:${SITE_PORT}/sitemap-index.xml\n`,
  "/sitemap-index.xml": `<sitemapindex><sitemap><loc>http://127.0.0.1:${SITE_PORT}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
  "/sitemap-0.xml": `<urlset><url><loc>http://127.0.0.1:${SITE_PORT}/</loc></url><url><loc>http://127.0.0.1:${SITE_PORT}/contact-us</loc></url><url><loc>https://elsewhere.example/x</loc></url></urlset>`,
};
const site = http.createServer((req, res) => {
  const body = PAGES[req.url.split("?")[0]];
  res.writeHead(body ? 200 : 404, { "Content-Type": "text/html" });
  res.end(body || "<html><body>Not found</body></html>");
});
await new Promise((r) => site.listen(SITE_PORT, "127.0.0.1", r));

process.env.MKT_SITE_URL = `http://127.0.0.1:${SITE_PORT}`;
process.env.JARVIS_TZ = "UTC";
delete process.env.GA4_PROPERTY_ID;
delete process.env.GSC_SITE_URL;

const now = "2026-11-16T15:10:00.000Z"; // a Monday
let brain = null;
try {
  // ---------- site checks ----------
  console.log("# site checks");
  const SC = await import(pathToFileURL(path.join(box, "server/site-check.js")).href);
  check(SC.sitePath("/a/b") === "/a/b" && SC.sitePath("contact-us") === "/contact-us" && SC.sitePath(`http://127.0.0.1:${SITE_PORT}/x?y=1`) === "/x?y=1", "a path or a URL on Larkwell's site is accepted");
  check(SC.sitePath("https://evil.example/x") === null && SC.sitePath("//evil.example/x") === null && SC.sitePath("/a/../../etc") === null && SC.sitePath("file:///etc/passwd") === null, "another host, a protocol-relative URL, a file URL and .. are refused");
  check((await SC.pageFacts("https://evil.example/")).error === "not_this_site", "page facts are refused for another site");
  const f = await SC.pageFacts("/");
  check(f.status === 200 && f.title === "SAP consulting & cloud | Larkwell Consulting" && f.titleLength === 44 && /^Larkwell Consulting runs/.test(f.metaDescription), "the title and meta description are read, with entities decoded, an impossible entity dropped and data- attributes ignored");
  check(f.canonical.endsWith(`:${SITE_PORT}/`) && f.lang === "en-GB" && f.hreflang.length === 1 && f.openGraph.title === "Larkwell & friends &amp;", "canonical, language, hreflang and Open Graph are read");
  check(f.h1.join() === "SAP, run properly" && f.h2.join() === "What we do" && f.wordCount > 8 && f.wordCount < 20, `headings and a word count that leaves out scripts and text-character art (got ${f.wordCount})`);
  check(f.structuredDataTypes.join() === "Organization,WebSite,Thing" && f.structuredDataInvalidBlocks === 1, "structured data types are listed and a broken block is counted");
  check(f.images === 2 && f.imagesWithoutAlt === 1 && f.internalLinks === 2 && f.externalLinks === 1 && f.internalLinkSample.join() === "/sap-services,/contact-us", "images without alt text and internal and external links are counted");
  check(f.tracking.googleTagManager.join() === "GTM-TEST123" && !f.tracking.linkedinInsightTag, "the Tag Manager container is found");
  check((await SC.pageFacts("/nope")).status === 404, "a missing page reports its status");
  const files = await SC.siteFiles();
  check(files.robots.status === 200 && files.sitemap.isIndex && files.sitemap.urlCount === 3 && files.sitemapPaths.join() === "/,/contact-us" && files.llmsTxt.present === false, "robots.txt, the sitemap behind its index and llms.txt are checked; other hosts are left out");
  PAGES["/sitemap-index.xml"] = "<sitemapindex><sitemap><loc>https://elsewhere.example/s.xml</loc></sitemap></sitemapindex>";
  const off = await SC.siteFiles();
  check(off.sitemap.isIndex && off.sitemap.urlCount === 0 && off.sitemapPaths.length === 0, "a sitemap index that points at another host is reported as an index with no pages");
  PAGES["/sitemap-index.xml"] = `<sitemapindex><sitemap><loc>http://127.0.0.1:${SITE_PORT}/sitemap-0.xml</loc></sitemap></sitemapindex>`;
  const tr = await SC.trackingCheck(["/", "/contact-us", "https://evil.example/"]);
  check(tr.pages.length === 2 && tr.pagesWithoutGoogleTag.join() === "/contact-us" && tr.linkedinInsightTagOn.join() === "/contact-us", "the tracking check names the page with no Google tag and where the LinkedIn tag is");
  check(tr.pages[1].forms[0].name === "contact" && tr.pages[1].forms[0].netlify, "forms are listed with their name");

  // ---------- reports ----------
  console.log("\n# reports");
  const AR = await import(pathToFileURL(path.join(box, "server/agent-reports.js")).href);
  const ST = await import(pathToFileURL(path.join(box, "server/stores.js")).href);
  check(AR.fileReport("nope", { headline: "x", body: "y" }, now).error === "not_found", "a report for an unknown agent is refused");
  check(AR.fileReport("seo", { headline: "x" }, now).error === "headline_and_body_required", "a report needs a headline and a body");
  const rep = AR.fileReport(
    "seo",
    {
      headline: "The services page title does not match its best query.",
      body: "## Audited\n\nTwo pages.",
      pages: ["/", "/sap-services"],
      actions: [
        { title: "Rewrite the services page title", page: "/sap-services", detail: "Current: Services. Proposed: SAP Basis managed services | Larkwell Consulting", why: "Position 8, 400 impressions.", effort: "small" },
        { title: "No detail, so dropped" },
        { title: "Add Organization schema to the contact page", detail: "Add the JSON-LD block.", effort: "enormous" },
      ],
      needs: ["Decide whether /de/ stays."],
      metrics: { pages: 2, bad: "x" },
    },
    now
  ).report;
  const recs = read("recommendations.json");
  check(rep.actions.length === 2 && rep.actions[1].effort === "medium" && recs.length === 2 && recs.every((r) => r.front === "technical-seo" && r.status === "open"), "each complete action becomes an open recommendation on the agent's front");
  check(/^Page: \/sap-services\. Current: Services/.test(recs[0].detail) && /Why: Position 8/.test(recs[0].detail) && recs[0].evidence[0] === "agent:seo:2026-11-16", "the recommendation carries the page, the fix, the reason and where it came from");
  check(rep.metrics.pages === 2 && !("bad" in rep.metrics), "only numbers are kept as metrics");
  ST.updateRecommendation(rep.actions[0].recId, { status: "done" });
  const prev = AR.previousReport("seo");
  check(prev.pages.length === 2 && prev.actions[0].status === "done" && prev.actions[1].status === "open" && AR.previousReport("strategist") === null, "the next run is told what became of each fix");
  check(AR.latestReports().seo.id === rep.id && AR.listReports({ agentId: "measurement" }).length === 0, "reports are listed per agent");

  // ---------- the week plan ----------
  console.log("\n# the week plan");
  const WP = await import(pathToFileURL(path.join(box, "server/week-plan.js")).href);
  check(WP.saveWeekPlan({ pieces: [] }, now).error === "focus_required" && WP.saveWeekPlan({ focus: "x", pieces: [{ kind: "blog", angle: "a", why: "b" }] }, now).error === "pieces_required", "a plan needs a focus and a usable piece (a blog needs a keyword)");
  check(WP.planLinesForJarvis(new Date(now)).length === 0, "with no plan Jarvis gets no plan lines");
  const fridayPlan = WP.saveWeekPlan({ focus: "Filed on a Friday.", pieces: [{ kind: "linkedin", angle: "a", why: "b" }] }, "2026-11-13T15:20:00.000Z").plan;
  const saved = WP.saveWeekPlan(
    {
      focus: "Own the Basis support cost question.",
      themes: [{ theme: "Basis cost", serviceId: "basis", why: "Position 8." }, { theme: "" }],
      pieces: [
        { kind: "blog", keyword: "sap basis managed services cost", serviceId: "basis", angle: "What drives the cost", why: "Position 8, 400 impressions." },
        { kind: "linkedin", postType: "case-study", serviceId: "made-up", angle: "The hidden cost of on-call", why: "Supports the blog." },
        { kind: "video", angle: "x", why: "y" },
      ],
      avoid: ["Clean Core"],
      research: [{ topic: "What do buyers pay for Basis support?", why: "No pricing evidence." }],
      needs: ["Confirm the day rate may be mentioned."],
    },
    now
  );
  const plan = saved.plan;
  check(plan.pieces.length === 2 && plan.themes.length === 1 && plan.pieces[1].postType === "how-to" && plan.pieces[1].serviceId === "", "unusable pieces are dropped; a case study becomes a how-to and an unknown service is cleared");
  check(read("research-queue.json").some((t) => t.createdBy === "strategist" && /Basis support/.test(t.topic)), "the plan's research questions are queued for the Researcher");
  check(saved.report.agentId === "strategist" && /## Pieces to write/.test(saved.report.body) && saved.report.needs.length === 1, "the plan is filed as the Strategist's report");
  const lines = WP.planLinesForJarvis(new Date(now)).join("\n");
  check(lines.includes(plan.pieces[0].id) && /Own the Basis support cost/.test(lines) && /Clean Core/.test(lines), "Jarvis is given the focus, the open pieces with their ids and what to avoid");
  check(WP.markPieceUsed(plan.pieces[0].id, "d-1", now) && !WP.markPieceUsed(plan.pieces[0].id, "d-2", now) && WP.openPieces(new Date(now)).length === 1, "a piece is marked written once");
  check(!WP.planLinesForJarvis(new Date(now)).join("\n").includes(plan.pieces[0].id), "a written piece is no longer offered");
  WP.noteAttempt(plan.pieces[1].id);
  check(WP.openPieces(new Date(now)).length === 1, "a piece Jarvis tried once and lost to the critic is offered again");
  WP.noteAttempt(plan.pieces[1].id);
  check(WP.openPieces(new Date(now)).length === 0 && /No piece of the plan is left to write/.test(WP.planLinesForJarvis(new Date(now)).join("\n")), "after two failed attempts a piece is dropped");
  check(WP.currentPlan(new Date("2026-11-26T15:00:00Z")) && !WP.currentPlan(new Date("2026-11-28T15:00:00Z")), "a plan guides Jarvis for eleven days, then stops");
  check(plan.weekOf === "2026-11-16" && fridayPlan.weekOf === "2026-11-16", "a plan filed on Monday is for that week; one filed on Friday is for the week after");
  const brief = await WP.strategistBrief(new Date(now));
  check(brief.capacity.blogsPerDay >= 0 && brief.services.length >= 8 && brief.lastPlan.pieces[0].written === true && brief.latestSeo.openActions.length === 1 && brief.missing.length === 2, "the Strategist's brief gathers capacity, services, the last plan, the SEO report and what is missing");
  check(!brief.linkedinPostTypes.includes("case-study"), "case studies are not offered to the Strategist");

  // ---------- the wiki ----------
  console.log("\n# the wiki");
  const WB = await import(pathToFileURL(path.join(box, "server/wiki-bridge.js")).href);
  const WK = await import(pathToFileURL(path.join(box, "server/wiki.js")).href);
  ST.addTasteEvent({ event: "rejected", kind: "blog", serviceId: "basis", reason: "Editor: repeats last week's piece on kernel patching.", text: "Patching kernels again" }, now);
  const wrote = WB.syncWiki(now);
  check(wrote.join() === "Larkwell marketing plan by week,larkwell.example SEO audit findings,What the Larkwell team turns down and why", `the plan, the SEO audit and the reasons for rejections are written to the wiki (got: ${wrote.join()})`);
  const planWiki = WK.getPage("Larkwell marketing plan by week");
  check(planWiki.type === "campaign" && /Own the Basis support cost question/.test(planWiki.body) && /\(written\)/.test(planWiki.body) && /Earlier weeks/.test(planWiki.body), "the plan page holds this week's focus, which pieces are written, and earlier weeks");
  check(/Rewrite the services page title.*done/.test(WK.getPage("larkwell.example SEO audit findings").body), "the SEO page lists each proposed fix with what became of it");
  check(/repeats last week's piece on kernel patching/.test(WK.getPage("What the Larkwell team turns down and why").body), "the reason a piece was rejected is on the wiki");
  check(WB.syncWiki(now).length === 0, "nothing is rewritten when nothing changed");
  AR.fileReport("measurement", { headline: "Too little traffic to judge.", body: "## Numbers", metrics: { sessions7d: 6, searchClicks7d: 12 } }, now);
  check(WB.syncWiki(now).join() === "Larkwell marketing results by week" && /\| 2026-11-16 \| 6 \| not measured \| 12 \|/.test(WK.getPage("Larkwell marketing results by week").body), "a new report updates only its own page, with the week's numbers in a table");
  const found = await WB.searchWiki("what did the SEO audit find about the services page title", 3);
  check(found.some((p) => p.title === "larkwell.example SEO audit findings" && p.sources.join() === "Marketing Engine app records" && p.text.length > 50), "an agent searching the wiki finds the audit, with where it came from");
  check((await WB.wikiGrounding("basis support cost plan", 2)).every((g) => g.source.startsWith("wiki: ") && !/kept up to date automatically/.test(g.text)), "the writers get wiki pages as short grounding lines");

  // ---------- the weekly summary ----------
  console.log("\n# the weekly summary");
  const WS = await import(pathToFileURL(path.join(box, "server/weekly-summary.js")).href);
  const sum = await WS.buildWeeklySummary("2026-11-20T16:30:00.000Z", { traffic: async () => null });
  const text = WS.summaryText(sum);
  check(/The week's plan\n- Own the Basis support cost question\.\n- 1 of 2 planned pieces written so far\./.test(text), "the summary shows the week's focus and progress");
  check(/What the agents found/.test(text) && /SEO: The services page title does not match its best query\. \(2 proposed fixes in the app\)/.test(text), "the summary carries each reporting agent's headline");
  check(sum.needs.includes("SEO: Decide whether /de/ stays.") && sum.needs.includes("Strategist: Confirm the day rate may be mentioned."), "what the agents need from a person is listed under Needs you");
  check(WS.summarySections({ ...sum, reports: undefined, plan: undefined }).length > 0, "a summary stored before phase 3 still renders");

  // ---------- over HTTP ----------
  console.log("\n# routes");
  const PORT = 8796;
  fs.writeFileSync(path.join(box, "data/worker-state.json"), JSON.stringify({ seedsPlanted: true }));
  brain = spawn(process.execPath, ["server/index.js"], { cwd: box, env: { ...process.env, PORT: String(PORT), JARVIS_SESSION: "off" }, stdio: "ignore" });
  const url = (p) => `http://127.0.0.1:${PORT}${p}`;
  const get = async (p) => {
    const r = await fetch(url(p));
    return { status: r.status, body: await r.json() };
  };
  const post = async (p, body) => {
    const r = await fetch(url(p), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  let up = false;
  for (let i = 0; i < 160 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    up = await fetch(url("/api/agents")).then((r) => r.ok, () => false);
  }
  check(up, "the brain is up");
  if (up) {
    const agents = (await get("/api/agents")).body;
    check(agents.reports.seo && agents.reports.strategist && agents.plan.pieces.length === 2, "the agent list carries each agent's newest report and the week's plan");
    check(["strategist", "seo", "measurement"].every((id) => agents.agents.find((a) => a.id === id).status === "live") && ["conversion", "sales"].every((id) => agents.agents.find((a) => a.id === id).status === "planned"), "Strategist, SEO and Measurement are live; Conversion and Sales are still planned");

    const bad = await post("/api/strategist/plan", { focus: "x" });
    check(bad.status === 400 && /needs a focus/.test(bad.body.message), "a plan with no pieces is refused with a message the agent can act on");
    const ok = await post("/api/strategist/plan", { focus: "Second plan.", pieces: [{ kind: "linkedin", angle: "a", why: "b" }] });
    check(ok.status === 200 && ok.body.plan.pieces === 1 && (await get("/api/strategist/plan")).body.plan.focus === "Second plan.", "a plan filed over the API becomes the current plan");
    check((await get("/api/strategist/brief")).body.lastPlan.focus === "Second plan.", "the Strategist's brief is served");

    const page = await get("/api/seo/page?path=/contact-us");
    check(page.status === 200 && page.body.h1[0] === "Contact" && page.body.tracking.linkedinInsightTag, "the SEO agent gets one page's facts");
    check((await get("/api/seo/page?path=https://evil.example/")).status === 400, "and is refused a page on another site");
    const seo = (await get("/api/seo/brief")).body;
    check(seo.siteFiles.sitemap.urlCount === 3 && seo.previous.pages.length === 2 && seo.search === null && seo.missing.some((m) => /Search Console is not connected/.test(m)) && seo.openSeoRecommendations.length === 1, "the SEO brief has the site files, last time's audit, open fixes and what is missing");

    const meas = (await get("/api/measurement/brief")).body;
    check(meas.analytics === null && meas.missing.length === 2 && meas.tracking.googleTagManager.join() === "GTM-TEST123" && meas.tracking.pagesWithoutGoogleTag.includes("/contact-us") && meas.previous.metrics.sessions7d === 6, "the Measurement brief has the tracking check, last week's numbers and what is missing");
    const filed = await post("/api/agents/measurement/reports", { headline: "Still too little traffic to judge.", body: "## Numbers", metrics: { sessions7d: 9 } });
    check(filed.status === 200 && (await get("/api/measurement/brief")).body.previous.metrics.sessions7d === 9, "a filed report's metrics come back as next week's baseline");
    check((await post("/api/agents/nope/reports", { headline: "x", body: "y" })).status === 404 && (await post("/api/agents/seo/reports", { headline: "x" })).status === 400, "bad reports are refused over the API");
    check((await get("/api/agents/reports?agent=measurement")).body.reports.length === 2, "reports can be listed for one agent");
    const ws = await get("/api/wiki/search?q=" + encodeURIComponent("weekly results sessions search clicks"));
    check(ws.status === 200 && ws.body.pages.some((p) => p.title === "Larkwell marketing results by week") && (await get("/api/wiki/search")).status === 400, "the wiki search endpoint serves the agents and refuses an empty question");
    check(/Second plan\./.test(fs.readFileSync(path.join(box, "wiki/larkwell-marketing-plan-by-week.md"), "utf8")), "a plan filed over the API reaches the wiki at once");
  }
} finally {
  brain?.kill();
  site.close();
  await new Promise((r) => (brain && brain.exitCode === null && brain.signalCode === null ? brain.once("exit", r) : r()));
  fs.rmSync(box, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
