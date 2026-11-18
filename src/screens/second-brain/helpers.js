export const slugify = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Parse a wiki `updated` stamp safely — one page carries a literal "<iso date>"
// placeholder, so anything unparseable becomes null and is treated as undated.
export const parseTime = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

// Relative time for the "alive" meta lines (mirrors Jarvis' ago()).
export function ago(iso) {
  const t = parseTime(iso);
  if (t == null) return "undated";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export const DAY = 86400000;
export const prettyType = (t) => (t ? t[0].toUpperCase() + t.slice(1) : "Note");

export const TYPE_COLOR = {
  service: "#14532d",
  topic: "#0ea5a3",
  competitor: "#e11d48",
  campaign: "#7c3aed",
  audience: "#d97706",
  concept: "#64748b",
};
export const typeBadge = {
  service: "bg-brand-soft text-brand",
  topic: "bg-good-soft text-good",
  competitor: "bg-crit-soft text-crit",
  campaign: "bg-violet-soft text-violet",
  audience: "bg-warn-soft text-warn",
  concept: "bg-surface-2 text-muted",
};
