// SEMrush connector (read-only). Activates when SEMRUSH_API_KEY is set in .env.
// Uses the SEMrush Standard API (api.semrush.com). Costs API units per call on
// your SEMrush plan. Nothing is written back to SEMrush.

const KEY = () => process.env.SEMRUSH_API_KEY || "";
const DEFAULT_DOMAIN = () => process.env.SEMRUSH_DOMAIN || "larkwell.example";
const DB = () => process.env.SEMRUSH_DB || "us";

export function semrushConfigured() {
  return Boolean(KEY());
}

// SEMrush returns ';'-delimited CSV with a header row.
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(";");
  return lines.slice(1).map((line) => {
    const cells = line.split(";");
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

async function call(params) {
  const url = new URL("https://api.semrush.com/");
  url.searchParams.set("key", KEY());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok || text.startsWith("ERROR")) {
    throw new Error(`SEMrush: ${text.slice(0, 120)}`);
  }
  return parseCsv(text);
}

// Domain overview: organic keywords, traffic, etc.
export async function domainOverview(domain = DEFAULT_DOMAIN()) {
  const rows = await call({
    type: "domain_ranks",
    domain,
    database: DB(),
    export_columns: "Dn,Rk,Or,Ot,Oc,Ad,At",
  });
  const r = rows[0] || {};
  return {
    domain: r.Dn || domain,
    rank: num(r.Rk),
    organicKeywords: num(r.Or),
    organicTraffic: num(r.Ot),
    organicCost: num(r.Oc),
    adwordsKeywords: num(r.Ad),
  };
}

// Top organic keywords the domain ranks for.
export async function topKeywords(domain = DEFAULT_DOMAIN(), limit = 25) {
  const rows = await call({
    type: "domain_organic",
    domain,
    database: DB(),
    display_limit: String(limit),
    export_columns: "Ph,Po,Nq,Cp,Tr",
  });
  return rows.map((r) => ({
    keyword: r.Ph,
    position: num(r.Po),
    volume: num(r.Nq),
    cpc: num(r.Cp),
    trafficShare: num(r.Tr),
  }));
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
