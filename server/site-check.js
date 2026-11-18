// Read-only checks of the live website (agent team, phase 3), for the SEO and
// Measurement agents. An agent that fetches a page through a web tool gets the
// readable text and loses the head: the title tag, meta description, canonical,
// structured data and tracking scripts. These functions fetch the page's HTML
// and report those facts in code, so the agent judges real values.
//
// Only pages of Larkwell's own site are fetched (the host is fixed here, the caller
// passes a path), and only with GET. Nothing on the site is changed.

import { siteUrl } from "./config.js";

// MKT_SITE_URL, or company.site in src/lib/company.js.
const SITE = siteUrl;
const TIMEOUT_MS = 12000;
const MAX_HTML = 1_500_000;

export const siteBase = SITE;

// The site answers on its bare name and on www; both are Larkwell's site.
const bare = (host) => host.replace(/^www\./, "");
const sameSite = (u) => {
  const site = new URL(SITE());
  return bare(u.hostname) === bare(site.hostname) && u.port === site.port;
};
const onSite = (href) => {
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  try {
    return sameSite(new URL(href));
  } catch {
    return false;
  }
};

// A site path ("/services/") from whatever the caller sent, or null if it
// points anywhere else.
export function sitePath(input) {
  const raw = String(input || "/").trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
    try {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol) || !sameSite(u)) return null;
      return u.pathname + u.search;
    } catch {
      return null;
    }
  }
  if (/[\s\\]/.test(raw) || raw.includes("..")) return null;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

async function get(pathname, fetcher = fetch) {
  const url = `${SITE()}${pathname}`;
  const started = Date.now();
  const res = await fetcher(url, { redirect: "follow", headers: { "User-Agent": "marketing-engine-site-check" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = (await res.text()).slice(0, MAX_HTML);
  return { url, finalUrl: res.url || url, status: res.status, ms: Date.now() - started, text, headers: res.headers };
}

// A numeric entity outside the Unicode range is dropped, not thrown on.
const codePoint = (n) => {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
};
const decode = (s) =>
  String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const strip = (html) => decode(String(html || "").replace(/<[^>]+>/g, " "));
const attr = (tag, name) => {
  // Preceded by whitespace, so `name` does not match inside `data-name`.
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : "";
};
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
const meta = (html, key) => {
  for (const t of tags(html, "meta")) {
    if ([attr(t, "name"), attr(t, "property")].some((v) => v.toLowerCase() === key)) return attr(t, "content");
  }
  return "";
};

function jsonLdTypes(html) {
  const types = [];
  let invalid = 0;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        if (node["@type"]) types.push(...[].concat(node["@type"]).map(String));
        if (node["@graph"]) walk(node["@graph"]);
      };
      walk(JSON.parse(m[1]));
    } catch {
      invalid++;
    }
  }
  return { types: [...new Set(types)], invalid };
}

// The tracking and consent tags found in a page's HTML.
export function trackingIn(html) {
  const uniq = (re) => [...new Set(html.match(re) || [])];
  const forms = tags(html, "form");
  return {
    googleTagManager: uniq(/\bGTM-[A-Z0-9]{4,}\b/g),
    ga4MeasurementIds: uniq(/\bG-[A-Z0-9]{8,12}\b/g),
    gtagScript: /googletagmanager\.com\/gtag\/js/i.test(html),
    linkedinInsightTag: /snap\.licdn\.com|_linkedin_partner_id/i.test(html),
    metaPixel: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(/i.test(html),
    hubspot: /js\.hs-scripts\.com|hs-analytics/i.test(html),
    consentBanner: /cookie[-_ ]?consent|cookiebot|onetrust|consent[-_ ]?mode|gtag\(\s*["']consent["']/i.test(html),
    forms: forms.map((f) => ({ name: attr(f, "name") || attr(f, "id") || "", action: attr(f, "action"), netlify: /\b(data-)?netlify\b/i.test(f) })),
  };
}

// On-page facts for one page of the site.
export async function pageFacts(pathInput, { fetcher = fetch } = {}) {
  const pathname = sitePath(pathInput);
  if (!pathname) return { error: "not_this_site" };
  let page;
  try {
    page = await get(pathname, fetcher);
  } catch (err) {
    return { path: pathname, error: `could not fetch: ${String(err.message).slice(0, 120)}` };
  }
  const html = page.text;
  const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [html])[0];
  const bodyHtml = (html.match(/<body\b[\s\S]*<\/body>/i) || [html])[0].replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const main = (bodyHtml.match(/<main\b[\s\S]*<\/main>/i) || [bodyHtml])[0];
  const title = decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const description = meta(head, "description");
  const links = tags(head, "link");
  const canonical = attr(links.find((l) => /\brel\s*=\s*["']?canonical/i.test(l)) || "", "href");
  const heads = (n) => [...bodyHtml.matchAll(new RegExp(`<h${n}\\b[^>]*>([\\s\\S]*?)<\\/h${n}>`, "gi"))].map((m) => strip(m[1])).filter(Boolean);
  const imgs = tags(bodyHtml, "img");
  const hrefs = tags(bodyHtml, "a").map((a) => attr(a, "href")).filter(Boolean);
  const internal = hrefs.filter(onSite);
  const ld = jsonLdTypes(html);
  // Words are tokens with a letter in them: the site draws pictures in text
  // characters, and those are not content.
  const words = strip(main).split(" ").filter((w) => /\p{L}/u.test(w)).length;
  return {
    path: pathname,
    url: page.url,
    finalUrl: page.finalUrl,
    redirected: page.finalUrl.replace(/\/+$/, "") !== page.url.replace(/\/+$/, ""),
    status: page.status,
    responseMs: page.ms,
    title,
    titleLength: title.length,
    metaDescription: description,
    metaDescriptionLength: description.length,
    canonical,
    robotsMeta: meta(head, "robots"),
    lang: attr(tags(html, "html")[0] || "", "lang"),
    hreflang: links.filter((l) => attr(l, "hreflang")).map((l) => `${attr(l, "hreflang")} ${attr(l, "href")}`).slice(0, 12),
    h1: heads(1).slice(0, 5),
    h2: heads(2).slice(0, 20),
    wordCount: words,
    openGraph: { title: meta(head, "og:title"), description: meta(head, "og:description"), image: meta(head, "og:image"), type: meta(head, "og:type") },
    twitterCard: meta(head, "twitter:card"),
    structuredDataTypes: ld.types,
    structuredDataInvalidBlocks: ld.invalid,
    images: imgs.length,
    imagesWithoutAlt: imgs.filter((i) => !/\salt\s*=/i.test(i)).length,
    internalLinks: internal.length,
    externalLinks: hrefs.filter((h) => /^https?:/i.test(h) && !onSite(h)).length,
    internalLinkSample: [...new Set(internal.map((h) => sitePath(h)).filter(Boolean))].slice(0, 40),
    tracking: trackingIn(html),
  };
}

// robots.txt, the sitemap and llms.txt: what crawlers and AI assistants are told.
export async function siteFiles({ fetcher = fetch } = {}) {
  const out = { site: SITE() };
  const safe = async (pathname) => {
    try {
      return await get(pathname, fetcher);
    } catch (err) {
      return { status: 0, text: "", error: String(err.message).slice(0, 120) };
    }
  };
  const robots = await safe("/robots.txt");
  out.robots = { status: robots.status, text: robots.status === 200 ? robots.text.slice(0, 3000) : "", error: robots.error };
  const declared = [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const sitemapPath = sitePath(declared[0] || "/sitemap-index.xml") || "/sitemap-index.xml";
  let map = await safe(sitemapPath);
  const locsIn = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
  // An index points at the real sitemaps; follow the first that is on this site.
  const isIndex = /<sitemapindex/i.test(map.text);
  const child = isIndex ? locsIn(map.text).map((l) => sitePath(l)).find(Boolean) : null;
  const locs = isIndex ? (child ? locsIn((await safe(child)).text) : []) : locsIn(map.text);
  out.sitemap = { declaredInRobots: declared, path: sitemapPath, status: map.status, isIndex, urlCount: locs.length, error: map.error };
  out.sitemapPaths = locs.map((l) => sitePath(l)).filter(Boolean).slice(0, 400);
  const llms = await safe("/llms.txt");
  out.llmsTxt = { status: llms.status, present: llms.status === 200 && !/<html/i.test(llms.text.slice(0, 300)) };
  return out;
}

// The tracking tags on a few pages, side by side: a tag that is on the home
// page but missing from the contact page is the kind of fault this catches.
export async function trackingCheck(paths = ["/"], { fetcher = fetch } = {}) {
  const pages = [];
  for (const p of paths.slice(0, 6)) {
    const pathname = sitePath(p);
    if (!pathname) continue;
    try {
      const page = await get(pathname, fetcher);
      pages.push({ path: pathname, status: page.status, ...trackingIn(page.text) });
    } catch (err) {
      pages.push({ path: pathname, error: `could not fetch: ${String(err.message).slice(0, 120)}` });
    }
  }
  const ok = pages.filter((p) => !p.error && p.status === 200);
  const all = (key) => [...new Set(ok.flatMap((p) => p[key]))];
  return {
    site: SITE(),
    pages,
    googleTagManager: all("googleTagManager"),
    ga4MeasurementIds: all("ga4MeasurementIds"),
    pagesWithoutGoogleTag: ok.filter((p) => !p.googleTagManager.length && !p.gtagScript).map((p) => p.path),
    linkedinInsightTagOn: ok.filter((p) => p.linkedinInsightTag).map((p) => p.path),
    consentBannerOn: ok.filter((p) => p.consentBanner).map((p) => p.path),
    note: "GA4 loaded through Tag Manager does not show a G- id in the page source; an empty ga4MeasurementIds list is normal when a GTM container is present.",
  };
}
