// Small display formatters shared by more than one screen.

// "5m ago" style age of an ISO timestamp. `missing` is what to show when
// there is no timestamp at all.
export function ago(iso, missing = "never") {
  if (!iso) return missing;
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// A grounding source ("File name.docx · sheet") as a short readable label.
export function prettySource(s) {
  return String(s)
    .split(" · ")[0]
    .replace(/\.(docx|xlsx|pptx|csv|txt|md)$/i, "")
    .replace(/Larkwell Consulting/gi, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
