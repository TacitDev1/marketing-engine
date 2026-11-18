// Server-side company config: src/lib/company.js plus the .env overrides.
// Everything that used to be hard-wired to one company (its name, website,
// link allowlist, the sibling website repository) is read from here.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { company } from "../src/lib/company.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
const escapeRe = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

export const COMPANY_NAME = process.env.MKT_COMPANY_NAME || company.name;

// The public website the SEO and Measurement agents read, and the base of
// published blog links.
export const siteUrl = () => (process.env.MKT_SITE_URL || company.site || "https://larkwell.example").replace(/\/+$/, "");
export const siteHost = () => {
  try {
    return new URL(siteUrl()).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// Names that mean "us" in a draft.
export const SELF_NAMES = [...new Set([COMPANY_NAME, company.shortName, ...(company.aliases || [])].filter(Boolean))];
// One regex that matches any of them as a whole word.
export const SELF_RE_SOURCE = `(?:${SELF_NAMES.sort((a, b) => b.length - a.length).map(escapeRe).join("|")})`;

// Hosts a draft may link to (a host also allows its subdomains).
export const linkHosts = () => {
  const fromEnv = list(process.env.MKT_LINK_ALLOWLIST);
  return [...new Set([siteHost(), ...(fromEnv.length ? fromEnv : company.linkHosts || [])].filter(Boolean))];
};
export const linkedinPath = () => process.env.MKT_LINKEDIN_PATH || company.linkedinPath || "";

// The company website repository the Website screen manages. Default: a
// folder named company-website next to this repository.
export const WEBSITE_REPO = path.resolve(process.env.MKT_WEBSITE_REPO || path.join(HERE, "..", "..", "company-website"));

// A page "looks like our site" when its first bytes name the company or its host.
export const looksLikeOurSite = (html) => {
  const s = String(html || "");
  const host = siteHost();
  return new RegExp(SELF_RE_SOURCE, "i").test(s) || (!!host && s.includes(host));
};
