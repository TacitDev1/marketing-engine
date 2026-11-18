// Google connectors (read-only): GA4 Analytics Data API + Search Console.
//
// Two auth modes, tried in this order:
//   1. OAuth (your own Google login) — the working path. Google's UI currently
//      rejects newly-created service accounts ("email not found" bug, since
//      Apr 2026), so we log in as Tobias (admin on the property) instead.
//      Run `node server/google-auth.js` once to grant access; it stores a
//      refresh token in .secrets/oauth-token.json. Nothing is ever written to
//      Google — scopes are read-only.
//   2. Service account (GOOGLE_APPLICATION_CREDENTIALS) — kept as a fallback
//      for when Google fixes the service-account bug. Used only if no OAuth
//      token is present.

import fs from "node:fs";
import { google } from "googleapis";

const CREDS = () => process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
const GA4_PROPERTY_ID = () => process.env.GA4_PROPERTY_ID || "";
const GSC_SITE_URL = () => process.env.GSC_SITE_URL || "";

export const OAUTH_CLIENT_PATH = () =>
  process.env.GOOGLE_OAUTH_CLIENT ||
  new URL("../../.secrets/oauth-client.json", import.meta.url).pathname;
export const OAUTH_TOKEN_PATH = () =>
  process.env.GOOGLE_OAUTH_TOKEN ||
  new URL("../../.secrets/oauth-token.json", import.meta.url).pathname;

export const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

function fileExists(p) {
  return Boolean(p) && fs.existsSync(p);
}

export function oauthReady() {
  return fileExists(OAUTH_CLIENT_PATH()) && fileExists(OAUTH_TOKEN_PATH());
}
function serviceAccountReady() {
  return fileExists(CREDS());
}
function authPresent() {
  return oauthReady() || serviceAccountReady();
}

// Which mode is live (for the Connections screen to explain).
export function googleAuthMode() {
  if (oauthReady()) return "oauth";
  if (serviceAccountReady()) return "service_account";
  return "none";
}

export function ga4Configured() {
  return authPresent() && Boolean(GA4_PROPERTY_ID());
}
export function gscConfigured() {
  return authPresent() && Boolean(GSC_SITE_URL());
}

// Build an OAuth2 client from the downloaded client file (Desktop app type).
export function oauthClient() {
  const raw = JSON.parse(fs.readFileSync(OAUTH_CLIENT_PATH(), "utf8"));
  const c = raw.installed || raw.web || raw;
  const redirect = (c.redirect_uris && c.redirect_uris[0]) || "http://localhost";
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirect);
}

let _auth = null;
function auth() {
  if (_auth) return _auth;
  if (oauthReady()) {
    const client = oauthClient();
    const token = JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH(), "utf8"));
    client.setCredentials(token);
    _auth = client;
  } else {
    _auth = new google.auth.GoogleAuth({ keyFile: CREDS(), scopes: SCOPES });
  }
  return _auth;
}

// Search Console returns only FINALIZED data by default, which trails by
// several days (on 2026-10-04 the newest day was 09-29). "all" adds Google's
// fresh, preliminary data so figures run up to about yesterday. Recent days
// can still be revised a little by Google as they finalize.
const GSC_FRESH = { dataState: "all" };

function daysAgoISO(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

// GA4: last 28 days — totals plus top pages.
export async function ga4Summary() {
  const data = google.analyticsdata({ version: "v1beta", auth: auth() });
  const { data: res } = await data.properties.runReport({
    property: `properties/${GA4_PROPERTY_ID()}`,
    requestBody: {
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [
        { name: "sessions" },
        { name: "activeUsers" },
        { name: "screenPageViews" },
      ],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    },
  });

  const rows = (res.rows || []).map((r) => ({
    page: r.dimensionValues?.[0]?.value,
    sessions: Number(r.metricValues?.[0]?.value || 0),
    users: Number(r.metricValues?.[1]?.value || 0),
    views: Number(r.metricValues?.[2]?.value || 0),
  }));
  // The property's REAL totals come from a zero-dimension report. Summing the
  // top-10 pages above undercounted (54 vs 80 sessions on 2026-10-04) and the
  // Connections card showed that as the 28-day total.
  // If that second call fails (quota, blip), fall back to the top-pages sum
  // rather than failing the whole card.
  let totals;
  try {
    const { data: tot } = await data.properties.runReport({
      property: `properties/${GA4_PROPERTY_ID()}`,
      requestBody: {
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }],
      },
    });
    const t = tot.rows?.[0]?.metricValues || [];
    totals = { sessions: Number(t[0]?.value || 0), users: Number(t[1]?.value || 0), views: Number(t[2]?.value || 0) };
  } catch {
    totals = rows.reduce((a, r) => ({ sessions: a.sessions + r.sessions, users: a.users + r.users, views: a.views + r.views }), { sessions: 0, users: 0, views: 0 });
  }
  return { range: "Last 28 days", totals, topPages: rows };
}

// ---------- Analytics screen payload ----------
// Everything the Analytics screen shows, in one call: GA4 real totals + daily
// trend + top pages + traffic sources, and GSC totals + daily trend + top
// queries + top pages. Cached for 60s so the screen's minute-refresh can't
// burn Google API quota (GA4 data itself only updates every few hours anyway).

// GA4 "date" dimension comes back as YYYYMMDD — make it ISO for the frontend.
function ga4DateToISO(v) {
  return v && v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v;
}

// GA4: one batched call → daily trend (real totals come from summing it),
// top pages, and session sources.
async function ga4Analytics() {
  const data = google.analyticsdata({ version: "v1beta", auth: auth() });
  const property = `properties/${GA4_PROPERTY_ID()}`;
  const dateRanges = [{ startDate: "28daysAgo", endDate: "today" }];
  const metrics = [
    { name: "sessions" },
    { name: "activeUsers" },
    { name: "screenPageViews" },
  ];
  const { data: res } = await data.properties.batchRunReports({
    property,
    requestBody: {
      requests: [
        {
          property,
          dateRanges,
          dimensions: [{ name: "date" }],
          metrics,
          orderBys: [{ dimension: { dimensionName: "date" } }],
          limit: 40,
        },
        {
          property,
          dateRanges,
          dimensions: [{ name: "pagePath" }],
          metrics,
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 10,
        },
        {
          property,
          dateRanges,
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics,
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 8,
        },
        // Zero-dimension report = the property's REAL totals. activeUsers is
        // not additive across days (one visitor on 3 days = 3 in a daily sum),
        // so summing the trend overcounts users.
        { property, dateRanges, metrics },
      ],
    },
  });

  const [trendRes, pagesRes, sourcesRes, totalsRes] = res.reports || [];
  const rowsOf = (report, dimMap) =>
    (report?.rows || []).map((r) => ({
      ...dimMap(r.dimensionValues?.[0]?.value),
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      views: Number(r.metricValues?.[2]?.value || 0),
    }));

  const trend = rowsOf(trendRes, (v) => ({ date: ga4DateToISO(v) }));
  const topPages = rowsOf(pagesRes, (v) => ({ page: v }));
  const sources = rowsOf(sourcesRes, (v) => ({ channel: v }));
  // Real property totals from the zero-dimension report; fall back to summing
  // the trend (correct for sessions/views, overcounts users) if it's missing.
  const totalsRow = totalsRes?.rows?.[0];
  const totals = totalsRow
    ? {
        sessions: Number(totalsRow.metricValues?.[0]?.value || 0),
        users: Number(totalsRow.metricValues?.[1]?.value || 0),
        views: Number(totalsRow.metricValues?.[2]?.value || 0),
      }
    : trend.reduce(
        (a, r) => ({
          sessions: a.sessions + r.sessions,
          users: a.users + r.users,
          views: a.views + r.views,
        }),
        { sessions: 0, users: 0, views: 0 }
      );
  return { totals, trend, topPages, sources };
}

// Search Console: daily trend (clicks/impressions — totals summed from it),
// top queries, and top pages.
async function gscAnalytics() {
  const sc = google.searchconsole({ version: "v1", auth: auth() });
  const base = { startDate: daysAgoISO(28), endDate: daysAgoISO(1), ...GSC_FRESH };
  const run = (requestBody) =>
    sc.searchanalytics
      .query({ siteUrl: GSC_SITE_URL(), requestBody: { ...base, ...requestBody } })
      .then(({ data }) =>
        (data.rows || []).map((r) => ({
          key: r.keys?.[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        }))
      );

  const [trendRaw, queriesRaw, pagesRaw] = await Promise.all([
    run({ dimensions: ["date"] }),
    run({ dimensions: ["query"], rowLimit: 25 }),
    run({ dimensions: ["page"], rowLimit: 10 }),
  ]);
  const trend = trendRaw.map(({ key, ...m }) => ({ date: key, ...m }));
  const queries = queriesRaw.map(({ key, ...m }) => ({ query: key, ...m }));
  const pages = pagesRaw.map(({ key, ...m }) => ({ page: key, ...m }));
  const totals = trend.reduce(
    (a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  );
  return { totals, trend, queries, pages };
}

// ---------- SEO opportunity mining (Search Console) ----------
// The two classic GSC quick-win reports, computed server-side:
//   1. Striking distance — queries ranking position 4–15: traffic we're
//      ALMOST getting; a content push can move these onto page-one clicks.
//   2. CTR gaps — queries where we're seen (impressions) but clicked far
//      less than our position should earn: usually a weak title/meta snippet.
// 90-day window (a small site needs the longer window for stable signals),
// cached 10 min — GSC data only updates daily anyway.

// Roughly what share of clicks a Google position earns (industry curve).
// Used only to spot underperformers, never shown as a promise.
const EXPECTED_CTR = [0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.035, 0.03, 0.025];
function expectedCtr(position) {
  const p = Math.round(position);
  if (p >= 1 && p <= 10) return EXPECTED_CTR[p - 1];
  return 0.015; // page two and beyond
}

let _oppsCache = { at: 0, data: null };

export async function gscOpportunities() {
  const now = Date.now();
  if (_oppsCache.data && now - _oppsCache.at < 10 * 60_000) return _oppsCache.data;

  const sc = google.searchconsole({ version: "v1", auth: auth() });
  const { data: res } = await sc.searchanalytics.query({
    siteUrl: GSC_SITE_URL(),
    requestBody: {
      startDate: daysAgoISO(90),
      endDate: daysAgoISO(1),
      ...GSC_FRESH,
      dimensions: ["query", "page"],
      rowLimit: 500,
    },
  });

  const rows = (res.rows || []).map((r) => ({
    query: r.keys?.[0],
    page: r.keys?.[1],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));

  const strikingDistance = rows
    .filter((r) => r.position >= 4 && r.position <= 15 && r.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  const ctrGaps = rows
    .filter((r) => r.position <= 15 && r.impressions >= 30)
    .map((r) => {
      const expected = expectedCtr(r.position);
      // Clicks we'd have at a healthy CTR for this position.
      const missedClicks = Math.round(r.impressions * expected - r.clicks);
      return { ...r, expectedCtr: expected, missedClicks };
    })
    .filter((r) => r.ctr < r.expectedCtr * 0.5 && r.missedClicks >= 3)
    .sort((a, b) => b.missedClicks - a.missedClicks)
    .slice(0, 20);

  const data = { range: "Last 90 days", strikingDistance, ctrGaps, totalRows: rows.length };
  _oppsCache = { at: now, data };
  return data;
}

// The combined payload. Each half degrades independently — a GA4 hiccup
// still returns Search Console data (and vice versa), with the error inline.
// Each half caches its SUCCESSES for 60s (quota safety); errors are never
// cached, so a transient Google blip retries on the very next poll instead
// of being served back for a minute.
async function cachedHalf(cache, configured, fetcher) {
  if (!configured()) return null;
  const now = Date.now();
  if (cache.data && now - cache.at < 60_000) return cache.data;
  try {
    cache.data = await fetcher();
    cache.at = now;
    return cache.data;
  } catch (err) {
    return { error: err.message };
  }
}

const _ga4Half = { at: 0, data: null };
const _gscHalf = { at: 0, data: null };

export async function analyticsSummary() {
  return {
    range: "Last 28 days",
    generatedAt: new Date().toISOString(),
    ga4: await cachedHalf(_ga4Half, ga4Configured, ga4Analytics),
    gsc: await cachedHalf(_gscHalf, gscConfigured, gscAnalytics),
  };
}

// Search Console: last 28 days — top queries by clicks.
export async function gscTopQueries(limit = 25) {
  const sc = google.searchconsole({ version: "v1", auth: auth() });
  const { data: res } = await sc.searchanalytics.query({
    siteUrl: GSC_SITE_URL(),
    requestBody: {
      startDate: daysAgoISO(28),
      endDate: daysAgoISO(1),
      ...GSC_FRESH,
      dimensions: ["query"],
      rowLimit: limit,
    },
  });
  return (res.rows || []).map((r) => ({
    query: r.keys?.[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}
