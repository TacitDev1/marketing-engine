// Web research tool — fetch a public URL and extract readable text so the brain
// can ground a draft in real, current source material (an SAP announcement,
// a Gartner/IDC note, a competitor post). Read-only; only the URL you give it
// is fetched. No API key needed.

const UA =
  "Mozilla/5.0 (compatible; Larkwell-Marketing/1.0; local research tool)";

function stripHtml(html) {
  let s = html;
  // Pull a title before stripping.
  const titleMatch = s.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? decode(titleMatch[1]).trim() : "";

  // Drop non-content blocks entirely.
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");

  // Keep paragraph/heading breaks as newlines, then strip remaining tags.
  s = s
    .replace(/<\/(p|div|h[1-6]|li|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  s = decode(s)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return { title, text: s };
}

function decode(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, "...");
}

// SSRF guard: this server fetches URLs that people (and the model) hand it. On a
// cloud instance an unchecked fetch reaches the metadata service
// (169.254.169.254 -> IAM credentials), the VPC and localhost. Only public
// http(s) hosts are allowed; every redirect hop is checked again.
import dns from "node:dns/promises";
import net from "node:net";

// net.BlockList, not string checks: the URL parser re-spells an IPv4-mapped
// IPv6 host in hex (http://[::ffff:127.0.0.1]/ becomes ::ffff:7f00:1), which the
// old dotted-quad check read as a public address, so the metadata service and
// localhost were reachable. BlockList matches the address, not its spelling.
const BLOCKED = new net.BlockList();
for (const [addr, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["127.0.0.0", 8], ["169.254.0.0", 16], // incl. AWS IMDS
  ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10], // carrier-grade NAT (100.64/10)
  ["192.0.0.0", 24], ["198.18.0.0", 15], ["224.0.0.0", 3], // special, benchmark, multicast/reserved
]) BLOCKED.addSubnet(addr, bits, "ipv4");
for (const [addr, bits] of [
  // (No ::ffff:0:0/96 rule: Node applies it to plain IPv4 too, blocking every
  // address. Mapped addresses are unpacked in isPrivateIp instead.)
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], // unspecified, loopback, NAT64
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2002::", 16], // ULA, link-local, multicast, 6to4
]) BLOCKED.addSubnet(addr, bits, "ipv6");

function isPrivateIp(ip) {
  const family = net.isIPv6(ip) ? "ipv6" : net.isIPv4(ip) ? "ipv4" : null;
  if (!family) return true; // not an address we understand: refuse
  if (family === "ipv6") {
    const v4 = embeddedV4(ip);
    if (v4) return isPrivateIp(v4);
  }
  return BLOCKED.check(ip, family);
}

// The IPv4 inside an IPv4-mapped (::ffff:a.b.c.d) or -compatible (::a.b.c.d)
// IPv6 address, in either dotted or hex spelling (::ffff:7f00:1). Else null.
function embeddedV4(ip) {
  const v = ip.toLowerCase();
  const dotted = /^(?:0{0,4}:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(v.replace(/^::/, ""));
  if (v.startsWith("::") && dotted) return dotted[1];
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("not a valid URL"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) URLs can be fetched");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("that address is not a public website");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("that address is not a public website");
    return u;
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error(`could not resolve ${host}`); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("that address is not a public website");
  return u;
}

// fetch() that re-checks the target on every redirect (redirect: "follow" would
// happily follow a public URL into a private address).
async function fetchPublic(url, init = {}, hops = 0) {
  const u = await assertPublicUrl(url);
  const res = await fetch(u.href, { ...init, redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get("location");
    if (!loc || hops >= 4) throw new Error(`too many redirects for ${url}`);
    return fetchPublic(new URL(loc, u).href, init, hops + 1);
  }
  return res;
}

export async function fetchReadable(url) {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  const res = await fetchPublic(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);

  const html = await res.text();
  const { title, text } = stripHtml(html);
  if (text.length < 120) {
    throw new Error("could not extract enough readable text from that page");
  }
  return {
    url,
    title,
    text: text.slice(0, 6000), // enough context, keeps the prompt tight
  };
}

// Free, keyless web research: query Google News RSS for fresh SAP news and parse
// the items. The app's Worker uses this to research the web on its own. Returns
// [{ title, sourceName, sourceUrl, link, date }] (newest-ish first).
export async function fetchNews(query, limit = 6) {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=en-US&gl=US&ceid=US:en";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml,*/*" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`news ${res.status} for "${query}"`);
  const xml = await res.text();

  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const rawTitle = decode((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim();
    const link = decode((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
    const srcM = block.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    const sourceUrl = srcM ? decode(srcM[1]) : "";
    const sourceName = srcM ? decode(srcM[2]).trim() : "";
    const date = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    if (!rawTitle) continue;
    // Titles arrive as "Headline - Publisher"; drop the trailing publisher.
    const title =
      sourceName && rawTitle.endsWith(`- ${sourceName}`)
        ? rawTitle.slice(0, rawTitle.length - sourceName.length - 2).trim()
        : rawTitle.replace(/\s-\s[^-]+$/, "").trim();
    items.push({ title, sourceName, sourceUrl, link, date });
  }
  return items.slice(0, limit);
}

// Fetch several URLs, keeping only the ones that read successfully. With more
// than one source we trim each a little so the combined prompt stays tight.
// Returns { articles: [...], failed: [{url, error}] }.
export async function fetchMany(urls) {
  const list = [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))].slice(0, 5);
  const settled = await Promise.allSettled(list.map((u) => fetchReadable(u)));
  const articles = [];
  const failed = [];
  const perSourceCap = list.length > 1 ? 3500 : 6000;
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      articles.push({ ...r.value, text: r.value.text.slice(0, perSourceCap) });
    } else {
      failed.push({ url: list[i], error: r.reason?.message || "failed" });
    }
  });
  return { articles, failed };
}
