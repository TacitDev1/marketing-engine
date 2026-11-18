// Sample data for the screens that read from outside the engine's own stores:
// Google Analytics and Search Console, the local models, token usage, the
// sibling website repository and its Lighthouse audit, plus the exec feedback
// notes. Everything here is invented for Larkwell Consulting (larkwell.example).
// Used by scripts/build-demo-data.mjs; re-exported from demo-fixtures.mjs.

// A small seeded generator, so every rebuild draws the same numbers.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const isWeekend = (t) => [0, 6].includes(new Date(t).getUTCDay());

// ---------- Feedback: notes from the leadership team ----------
export const FEEDBACK = [
  {
    daysAgo: 1,
    author: "Mara",
    status: "open",
    text: "Can the Friday digest show which posts led to an enquiry? I'd like that next to the weekly numbers, not in a separate report.",
    replies: [{ daysAgo: 0, author: "Tobias", text: "The Measurement agent already ties enquiries to landing pages. I've asked Jarvis to add one line per enquiry to the digest from this Friday." }],
  },
  {
    daysAgo: 2,
    author: "Jonas",
    status: "open",
    text: "Anything that names Osterby Utilities needs their sign-off first. Please hold those posts until Anouk confirms.",
    replies: [],
  },
  {
    daysAgo: 6,
    author: "Priya",
    status: "done",
    text: "The blog cards look too dark on the website. Can blogs use the light card style?",
    replies: [{ daysAgo: 5, author: "Tobias", text: "Done. Blog pictures now default to the light style; LinkedIn keeps the green one." }],
  },
  {
    daysAgo: 9,
    author: "Lena",
    status: "done",
    text: "Fewer posts about AI, please. Our buyers want to hear about crews and billing runs.",
    replies: [{ daysAgo: 8, author: "Tobias", text: "Added a playbook rule: at most one AI angle a week, and only with a named process behind it." }],
  },
  {
    daysAgo: 12,
    author: "Sipho",
    status: "dismissed",
    text: "Could the app post to LinkedIn by itself on Fridays?",
    replies: [{ daysAgo: 12, author: "Tobias", text: "No, on purpose: a person always copies a post across. The tool drafts, people publish." }],
  },
];

// ---------- Settings: the local models (Ollama's /api/tags, as listModels returns it) ----------
export const MODELS = [
  { name: "gemma4:12b", size: 8_113_000_000, family: "gemma4", param: "12.2B", quant: "Q4_K_M" },
  { name: "nomic-embed-text:latest", size: 274_302_450, family: "nomic-bert", param: "137M", quant: "F16" },
  { name: "qwen3.5:9b", size: 6_042_000_000, family: "qwen3", param: "9.1B", quant: "Q4_K_M" },
];

// ---------- Connections ----------
export const CONNECTIONS = {
  semrush: { id: "semrush", label: "SEMrush", connected: false },
  ga4: { id: "ga4", label: "Google Analytics (GA4)", connected: true },
  gsc: { id: "gsc", label: "Google Search Console", connected: true },
  googleAuthMode: "oauth",
};

// ---------- Token usage: rows as server/usage.js stores them ----------
export function usageRows(now) {
  const r = rng(7);
  const rows = [];
  for (let d = 89; d >= 0; d--) {
    const day = now - d * DAY;
    const quiet = isWeekend(day);
    const drafts = quiet ? Math.floor(r() * 3) : 14 + Math.floor(r() * 12);
    for (let i = 0; i < drafts; i++) {
      const t = day - Math.floor(r() * 8 * 3600000);
      rows.push({ t, model: "qwen3.5:9b", kind: "chat", p: 2600 + Math.floor(r() * 2400), o: 380 + Math.floor(r() * 620) });
      if (r() < 0.55) rows.push({ t: t + 40000, model: "gemma4:12b", kind: "chat", p: 3400 + Math.floor(r() * 2600), o: 260 + Math.floor(r() * 420) });
      rows.push({ t: t + 60000, model: "nomic-embed-text", kind: "embed", p: 280 + Math.floor(r() * 360), o: 0 });
    }
  }
  return rows.filter((x) => x.t <= now).sort((a, b) => a.t - b.t);
}

// ---------- Analytics: GA4 + Search Console, last 28 days ----------
const PAGES = [
  ["/", 0.24],
  ["/news/master-data-first", 0.13],
  ["/services/plant-maintenance", 0.11],
  ["/industries/waste-management", 0.09],
  ["/services/s4hana", 0.08],
  ["/news/billing-exceptions-have-causes", 0.07],
  ["/about", 0.06],
  ["/services/billing", 0.05],
  ["/contact", 0.04],
  ["/news/three-screens-not-thirty", 0.03],
];
const QUERIES = [
  ["larkwell consulting", 1.6, 0.31],
  ["sap pm mobile work orders", 6.8, 0.042],
  ["sap master data cleanup before migration", 5.2, 0.051],
  ["sap is-u billing exceptions", 7.9, 0.033],
  ["brownfield s/4hana conversion", 14.1, 0.004],
  ["sap plant maintenance consultant", 11.6, 0.009],
  ["s/4hana readiness check", 18.4, 0.002],
  ["sap waste management", 9.3, 0.012],
  ["sap fiori tablet offline", 4.7, 0.061],
  ["meter to cash sap", 12.2, 0.008],
  ["sap custom code migration", 16.9, 0.003],
  ["sap basis managed service", 10.4, 0.011],
];

export function analyticsSummary(now) {
  const r = rng(11);
  const trend = [];
  const gscTrend = [];
  for (let d = 27; d >= 0; d--) {
    const t = now - d * DAY;
    const lift = 1 + (27 - d) * 0.012; // a slow climb since the blog started
    const base = isWeekend(t) ? 18 : 52;
    const sessions = Math.round(base * lift * (0.8 + r() * 0.4));
    const users = Math.round(sessions * (0.78 + r() * 0.08));
    const views = Math.round(sessions * (1.7 + r() * 0.5));
    trend.push({ date: iso(t), sessions, users, views });
    if (d >= 1) {
      const impressions = Math.round((isWeekend(t) ? 260 : 610) * lift * (0.85 + r() * 0.3));
      const clicks = Math.round(impressions * (0.026 + r() * 0.012));
      gscTrend.push({ date: iso(t), clicks, impressions, ctr: clicks / impressions, position: 14.5 - (27 - d) * 0.08 + r() });
    }
  }
  const sum = (list, k) => list.reduce((a, x) => a + x[k], 0);
  const totals = { sessions: sum(trend, "sessions"), users: Math.round(sum(trend, "users") * 0.71), views: sum(trend, "views") };
  const topPages = PAGES.map(([page, share]) => ({
    page,
    sessions: Math.round(totals.sessions * share),
    users: Math.round(totals.sessions * share * 0.8),
    views: Math.round(totals.views * share),
  }));
  const sources = [
    ["Organic Search", 0.46],
    ["Direct", 0.24],
    ["Organic Social", 0.17],
    ["Referral", 0.08],
    ["Email", 0.05],
  ].map(([channel, share]) => ({ channel, sessions: Math.round(totals.sessions * share), users: Math.round(totals.users * share), views: Math.round(totals.views * share) }));
  const gTotals = { clicks: sum(gscTrend, "clicks"), impressions: sum(gscTrend, "impressions") };
  const queries = QUERIES.map(([query, position, ctr], i) => {
    const impressions = Math.round(gTotals.impressions * (0.16 - i * 0.011));
    const clicks = Math.max(0, Math.round(impressions * ctr));
    return { query, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
  }).sort((a, b) => b.clicks - a.clicks);
  const pages = PAGES.slice(0, 8).map(([page, share], i) => {
    const impressions = Math.round(gTotals.impressions * share * 1.4);
    const clicks = Math.round(gTotals.clicks * share);
    return { page: `https://larkwell.example${page}`, clicks, impressions, ctr: clicks / impressions, position: 6 + i * 1.7 };
  });
  return {
    range: "Last 28 days",
    generatedAt: new Date(now).toISOString(),
    ga4: { totals, trend, topPages, sources },
    gsc: { totals: gTotals, trend: gscTrend, queries, pages },
  };
}

// The SEO screen's two quick-win lists (gscOpportunities' shape).
const EXPECTED_CTR = [0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.035, 0.03, 0.025];
export function seoOpportunities() {
  const rows = [
    ["sap pm mobile work orders", "/news/sap-pm-work-orders-closed-at-the-asset", 41, 1120, 5.6],
    ["sap is-u billing exceptions", "/news/billing-exceptions-have-causes", 22, 860, 7.4],
    ["sap waste management", "/industries/waste-management", 9, 1490, 9.1],
    ["sap plant maintenance consultant", "/services/plant-maintenance", 6, 930, 11.2],
    ["meter to cash sap", "/services/billing", 4, 610, 12.8],
    ["sap basis managed service", "/services/basis", 5, 420, 8.9],
    ["sap master data cleanup before migration", "/news/master-data-first", 38, 690, 4.3],
    ["sap fiori tablet offline", "/news/three-screens-not-thirty", 12, 240, 6.1],
    ["brownfield s/4hana conversion", "/services/s4hana", 2, 1310, 14.2],
  ].map(([query, page, clicks, impressions, position]) => ({ query, page: `https://larkwell.example${page}`, clicks, impressions, ctr: clicks / impressions, position }));
  const expected = (p) => (Math.round(p) <= 10 ? EXPECTED_CTR[Math.round(p) - 1] : 0.015);
  const strikingDistance = rows.filter((x) => x.position >= 4 && x.position <= 15).sort((a, b) => b.impressions - a.impressions);
  const ctrGaps = rows
    .map((x) => ({ ...x, expectedCtr: expected(x.position), missedClicks: Math.round(x.impressions * expected(x.position) - x.clicks) }))
    .filter((x) => x.ctr < x.expectedCtr * 0.5 && x.missedClicks >= 3)
    .sort((a, b) => b.missedClicks - a.missedClicks);
  return { range: "Last 90 days", strikingDistance, ctrGaps, totalRows: 214 };
}

// ---------- The website: a small Astro repository the Website screen manages ----------
const fm = (o) =>
  `---\n${Object.entries(o)
    .map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - "${x}"`).join("\n")}` : `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`))
    .join("\n")}\n---\n`;

export function websiteFiles(dateOf) {
  const files = {
    "package.json": JSON.stringify({ name: "larkwell-website", version: "1.6.0", private: true, type: "module", scripts: { dev: "astro dev", build: "astro build" } }, null, 2),
    "src/pages/index.astro": "---\nimport Home from '../layouts/Home.astro';\n---\n<Home />\n",
    "src/pages/about.astro": "---\nimport Page from '../layouts/Page.astro';\n---\n<Page title=\"About Larkwell\" />\n",
    "src/pages/contact.astro": "---\nimport Page from '../layouts/Page.astro';\n---\n<Page title=\"Contact\" />\n",
    "src/pages/news.astro": "---\nimport NewsIndex from '../layouts/NewsIndex.astro';\n---\n<NewsIndex />\n",
    "src/content/services/plant-maintenance.md": fm({ title: "SAP Plant Maintenance" }) + "\nWork orders, maintenance plans and field apps for operators running SAP PM.\n",
    "src/content/services/billing.md": fm({ title: "SAP IS-U billing" }) + "\nBilling exceptions, meter to cash, and the move of billing to S/4HANA.\n",
    "src/content/services/s4hana.md": fm({ title: "S/4HANA migration" }) + "\nBrownfield conversions for utilities and waste operators.\n",
    "src/content/services/basis.md": fm({ title: "SAP Basis" }) + "\nPatch windows, system copies and monitoring for estates that cannot go down.\n",
    "src/content/industries/waste-management.md": fm({ title: "Waste management" }) + "\nFleets, depots and bin lifts on SAP PM.\n",
    "src/content/industries/utilities.md": fm({ title: "Utilities" }) + "\nWater and energy retailers on SAP IS-U and S/4HANA Utilities.\n",
    "src/content/locations/united-kingdom.md": fm({ title: "United Kingdom" }) + "\nOur main office.\n",
    "src/content/locations/netherlands.md": fm({ title: "Netherlands" }) + "\nA small team for Benelux operators.\n",
    "src/content/news/en/master-data-first.md":
      fm({ title: "Master data first: the cutover nobody plans", date: dateOf(6), description: "Why the cutover weekend goes wrong in the material master, and the cleanup plan that starts three months earlier.", author: "Larkwell", categories: ["SAP", "Data migration"] }) +
      "\nMost cutover plans describe the weekend in detail and the three months before it in one line: cleanse master data. That line is where migrations go wrong.\n\n## Start with the records you will move\n\nCount them, then count the ones nobody has touched in five years.\n",
    "src/content/news/en/billing-exceptions-have-causes.md":
      fm({ title: "Billing exceptions have causes", date: dateOf(20), description: "Group a month of billing exceptions by cause, fix the top two where the bad data enters, then automate what is left.", author: "Larkwell", categories: ["SAP IS-U"] }) +
      "\nAdding people to the exception queue clears the backlog for a month and hides why it grew.\n",
    "src/content/news/en/three-screens-not-thirty.md":
      fm({ title: "Three screens, not thirty: SAP PM on the depot tablet", date: dateOf(34), description: "Field crews need three things from SAP. A small offline app gives them exactly that.", author: "Larkwell", categories: ["SAP PM", "Fiori"] }) +
      "\nCrews do three things with SAP: see today's jobs, close a job, and raise a defect.\n",
    "src/content/news/en/brackenfield-depot-tablets.md":
      fm({ title: "Brackenfield Waste closes work orders at the bin lorry", date: dateOf(48), description: "How a waste operator moved work order closing from paper to depot tablets, one depot at a time.", author: "Larkwell", categories: ["Success stories", "SAP PM"] }) +
      "\nBrackenfield Waste ran SAP PM, but work orders were closed on paper and keyed in at the end of the week.\n",
    "src/content/news/en/osterby-billing-review.md":
      fm({ title: "Osterby Utilities: a billing review before S/4HANA", date: dateOf(75), description: "A four-week review of billing exceptions ahead of a move to S/4HANA Utilities.", author: "Larkwell", categories: ["Success stories", "SAP IS-U"] }) +
      "\nBefore moving billing, Osterby Utilities wanted to know which exceptions would follow them.\n",
    "src/content/news/en/patch-day-routine.md":
      fm({ title: "A patch-day routine a small Basis team can keep", date: dateOf(90), description: "Rate the notes against your own landscape, patch development first, write the rollback before you start.", author: "Larkwell", categories: ["SAP Basis"], draft: true }) +
      "\nA critical note for a component you do not run is not urgent for you.\n",
  };
  return files;
}
// Changes made after the last commit: these show as "waiting to go live".
export function websitePending(dateOf) {
  return {
    "src/content/news/en/sap-pm-work-orders-closed-at-the-asset.md":
      fm({ title: "Closing SAP PM work orders at the asset", date: dateOf(0), description: "Why field crews still close SAP PM work orders on paper, and the three-screen tablet app that changes it.", author: "Larkwell", categories: ["SAP PM"] }) +
      "\nMost operators who run SAP PM already have the data model they need.\n",
  };
}

// The Lighthouse result the Website screen shows (tools/lighthouse.js summarise()).
export function siteAudit(finishedAt) {
  const m = (value, display, score) => ({ value, display, score });
  return {
    path: "/",
    finishedAt,
    lighthouseVersion: "12.8.2",
    scores: { performance: 91, accessibility: 96, bestPractices: 100, seo: 92 },
    metrics: {
      fcp: m(1180, "1.2 s", 0.97),
      lcp: m(2310, "2.3 s", 0.86),
      tbt: m(40, "40 ms", 1),
      cls: m(0.04, "0.04", 0.99),
      si: m(1650, "1.7 s", 0.98),
    },
    failures: [
      { id: "uses-responsive-images", title: "Properly size images", score: 0.5, display: "Potential savings of 96 KiB", hint: "Serve images that are appropriately-sized to save cellular data and improve load time" },
      { id: "largest-contentful-paint", title: "Largest Contentful Paint", score: 0.86, display: "2.3 s", hint: "Largest Contentful Paint marks the time at which the largest text or image is painted" },
      { id: "meta-description", title: "Document does not have a meta description", score: 0, display: null, hint: "Meta descriptions may be included in search results to concisely summarize page content" },
      { id: "color-contrast", title: "Background and foreground colors do not have a sufficient contrast ratio", score: 0, display: null, hint: "Low-contrast text is difficult or impossible for many users to read" },
    ],
  };
}
