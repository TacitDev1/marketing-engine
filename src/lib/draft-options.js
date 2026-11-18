// Draft picker options (a Select grouped by service line), shared by the
// Images screen and the live ASCII poster.
import { services, postTypes } from "./company.js";

const SERVICE_LABEL = Object.fromEntries(services.map((s) => [s.id, s.label]));
const POST_TYPE_LABEL = Object.fromEntries(postTypes.map((p) => [p.id, p.label]));

// One draft → a rich Select option: full hook + voice badge (+ service badge
// unless the list is already grouped by service).
export function draftOption(d, { service = true } = {}) {
  const p = d.payload || {};
  const hook = (p.hook || p.title || "Untitled").replace(/[#*]/g, "").trim();
  const badges = [];
  if (p.postType && POST_TYPE_LABEL[p.postType]) badges.push({ tone: "warn", text: POST_TYPE_LABEL[p.postType] });
  if (service && p.serviceId && SERVICE_LABEL[p.serviceId]) badges.push({ tone: "brand", text: SERVICE_LABEL[p.serviceId] });
  return { value: d.id, label: hook, prefix: d.status === "posted" ? "posted" : null, badges };
}

// Group drafts under service-line section headings so the list is scannable.
export function groupedDraftOptions(drafts) {
  const groups = new Map();
  // Drafts a reviewer marked "To delete" aren't worth an image.
  for (const d of drafts.filter((x) => x.status !== "delete" && x.status !== "archived")) {
    const sid = d.payload?.serviceId;
    const label = (sid && SERVICE_LABEL[sid]) || "Other / unlabeled";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(draftOption(d, { service: false }));
  }
  const order = services.map((s) => s.label);
  const sorted = [...groups.keys()].sort(
    (a, b) => (order.indexOf(a) < 0 ? 999 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 999 : order.indexOf(b)),
  );
  const out = [];
  for (const label of sorted) {
    out.push({ heading: `${label} (${groups.get(label).length})` });
    out.push(...groups.get(label));
  }
  return out;
}
