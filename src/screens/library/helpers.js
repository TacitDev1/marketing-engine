import { services, postTypes, products } from "../../lib/company.js";

export const STATUSES = [
  { id: "draft", label: "Draft", cls: "bg-surface-2 text-ink-2", tone: "neutral", tip: "Still waiting for your review." },
  { id: "approved", label: "Approved", cls: "bg-good-soft text-good", tone: "good", tip: "You've read it and it's good to go." },
  {
    id: "posted",
    label: "Posted",
    cls: "bg-brand-soft text-brand",
    tone: "brand",
    tip: "Records that YOU already posted it yourself. This button never posts anything anywhere.",
  },
  {
    id: "delete",
    label: "To delete",
    cls: "bg-crit-soft text-crit",
    tone: "crit",
    tip: "Marks it for deletion while you read through. Nothing is removed yet: open the \"To delete\" filter and press \"Delete all marked\" when you're ready.",
  },
  {
    id: "archived",
    label: "Archived",
    cls: "bg-surface-2 text-faint",
    tone: "neutral",
    tip: "Out of sight but kept (Fresh start). Not in \"All\", never scheduled. Set it back to Draft to bring it back.",
  },
];

// Marking a draft "To delete" asks why: the reason is what Jarvis learns from.
// Returns null when the person cancels (the action is cancelled too).
export function askRejectReason(n = 1) {
  const r = window.prompt(
    `${n === 1 ? "Why isn't this one good enough?" : `Why aren't these ${n} good enough?`} (optional, but Jarvis learns from it: e.g. "wrong topic for our buyers", "made-up stat", "we covered this last week")`,
    ""
  );
  return r === null ? null : r.trim();
}

export const KINDS = [
  { id: "all", label: "All types" },
  { id: "blog", label: "Blogs" },
  { id: "linkedin", label: "LinkedIn" },
];

export const SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "az", label: "Title A → Z" },
];

// Drafts carry payload.postType + payload.serviceId; older ones may not.
export const SERVICE_LABEL = Object.fromEntries(services.map((s) => [s.id, s.label]));
export const PRODUCT_LABEL = Object.fromEntries(products.map((p) => [p.id, p.label]));
// A product-anchored post carries payload.productId next to its nearest
// serviceId. The Service filter lists products as their own section (value
// "product:<id>") — Mara: "Services seems to be missing the products".
export const PRODUCT_PREFIX = "product:";
export const POST_TYPE_LABEL = Object.fromEntries(postTypes.map((p) => [p.id, p.label]));

// Plain-words tooltips for the style chips ("Hot take" is internet slang, and
// "Founder voice" needs its one reassuring sentence for a first-time reader).
export const VOICE_TIP = {
  "case-study": "A real piece of work told as problem, approach, outcome.",
  "hot-take": "A bold, defensible opinion piece.",
  "how-to": "Practical steps the reader can apply.",
  founder: "Written for the founder's own LinkedIn, in his voice. He still reviews and posts it himself.",
};
// Older hand-made posts only carry `service` / `type` (the fields got dropped
// on the way in); fall back to them when they name a real service line / style.
export const serviceOf = (d) => {
  const p = d.payload || {};
  return p.serviceId || (SERVICE_LABEL[p.service] ? p.service : "");
};
export const productOf = (d) => (d.payload || {}).productId || "";
// One matcher for the list and the facet counts so they can't drift apart.
export const matchesService = (d, sel) =>
  sel === "none"
    ? serviceOf(d) === "" && productOf(d) === ""
    : sel === "all" ||
      (sel.startsWith(PRODUCT_PREFIX) ? productOf(d) === sel.slice(PRODUCT_PREFIX.length) : serviceOf(d) === sel);
export const postTypeOf = (d) => {
  const p = d.payload || {};
  return p.postType || (POST_TYPE_LABEL[p.type] ? p.type : "");
};
export const titleOf = (d) => ((d.kind === "blog" ? d.payload?.title : d.payload?.hook) || "").toLowerCase();

export function copyTextFor(record) {
  const p = record.payload || {};
  if (record.kind === "blog") return `${p.title || ""}\n\n${p.body || ""}`;
  const tags = (Array.isArray(p.hashtags) ? p.hashtags : []).map((t) => `#${t}`).join(" ");
  return `${p.hook || ""}\n\n${p.body || ""}${tags ? `\n\n${tags}` : ""}`;
}
