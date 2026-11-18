// Blog audit: is anything missing from a blog draft?
//
// Why this exists (2026-10-02): a blog on the server reached the Schedule with
// a title and meta but NO body; even the .bak copy was empty, so nobody saw it
// until the day it was due. Shared by the server (periodic audit + activity
// feed + scripts/audit-blogs.mjs) and the browser (Library badge, Schedule
// warning), so every place agrees on what "incomplete" means.
//
// Each problem: { id, label, severity }. severity "critical" = not publishable
// as is (no body, cut off); "warn" = publishable but worth fixing.

const words = (s) => (String(s || "").trim().match(/\S+/g) || []).length;

export function auditBlog(payload = {}) {
  const p = payload || {};
  const body = String(p.body || "").trim();
  const out = [];
  const add = (id, label, severity = "warn") => out.push({ id, label, severity });

  if (!String(p.title || "").trim()) add("title", "no title", "critical");
  if (!body) add("body", "no article text", "critical");
  else {
    const n = words(body);
    if (n < 300) add("thin", `only ${n} words`, n < 120 ? "critical" : "warn");
    // A body that stops mid-sentence: last character isn't sentence-ending
    // punctuation, a closing bracket/quote, or the end of a list/heading.
    const last = body.split("\n").filter((l) => l.trim()).pop() || "";
    const tidyEnd =
      /[.!?)"'”’*`\]:|]\s*$/.test(last) ||        // sentence end, bracket, quote, bold, code, colon, table row
      /^\s*([-*+]|\d+\.|#|>|\|)/.test(last) ||      // list item, heading, quote, table
      /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(last) ||   // horizontal rule
      /https?:\/\/\S+\s*$/.test(last);              // ends on a link
    if (!tidyEnd) add("cutoff", "ends mid-sentence", "critical");
    if (!/^#{2,3}\s+\S/m.test(body)) add("headings", "no section headings");
  }
  if (!String(p.metaDescription || "").trim()) add("meta", "no meta description");
  if (!String(p.slug || "").trim()) add("slug", "no URL slug");
  if (!String(p.keyword || p.targetKeyword || "").trim()) add("keyword", "no target keyword");
  if (!p.serviceId && !p.productId) add("service", "no service line");
  return out;
}

export const isCritical = (problems) => problems.some((x) => x.severity === "critical");

// One line for a person: "no article text, no meta description".
export const describeProblems = (problems) => problems.map((x) => x.label).join(", ");
