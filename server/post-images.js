// Pictures for a LinkedIn post, made with nobody at the screen (2026-11-16).
//
// People approve in Teams and will not open the Images screens, so before a
// LinkedIn post is put to them Jarvis makes its pictures: an ASCII poster (a
// still for the chat, and the moving GIF as a file) and a branded Larkwell card. A
// photo card from Unsplash is made only when a person asks for one on the
// approval card (Unsplash's API is for photos a person asked for).
// The options are numbered; the approval card asks which one to use.
//
// Settings a person can change from the card: the poster's icon and colour,
// the card's style, and whether to add a photo.

import fs from "node:fs";
import { listDrafts, updateDraft } from "./drafts.js";
import { generateImage, buildImageDirection, imageFilePath, listProviders, CARD_STYLES, SIZES } from "./images.js";
import { renderImage, renderAvailable } from "./render.js";
import { addActivity, load } from "./stores.js";
import { services } from "../src/lib/company.js";
import { ICONS, COLORS } from "../src/lib/ascii-art.js";

const SERVICE_LABEL = Object.fromEntries(services.map((s) => [s.id, s.label]));
export const ICON_NAMES = ICONS.map((i) => i.name);
export const COLOUR_CHOICES = COLORS;
export const CARD_STYLE_CHOICES = Object.entries(CARD_STYLES).map(([id, s]) => ({ id, label: s.label }));
export const photoAvailable = () => listProviders().some((p) => p.id === "unsplash" && p.available);
export const postImagesAvailable = () => renderAvailable();

const DEFAULT_COLOUR = "#a3e635"; // Larkwell green

// The icon that suits what the post is about; first match wins.
const ICON_FOR = [
  [/secur|authori[sz]|\bgrc\b|audit|complian|risk|sox\b|segregation/i, "Shield"],
  [/role|user experience|\bux\b|fiori|people|team|adoption|training/i, "Users / Roles"],
  [/migrat|cloud|aws|azure|rise with sap|hyperscal|hosting/i, "Cloud"],
  [/\bbtp\b|integrat|\bapi\b|interface|cpi\b|pi\/po|middleware/i, "Integration"],
  [/abap|custom code|clean core|extension|develop/i, "Code"],
  [/hana|database|data migration|master data|archiv/i, "Database"],
  [/analytic|report|dashboard|\bbw\b|datasphere|insight|kpi/i, "Analytics"],
  [/managed service|support|basis|monitor|operations|\bams\b/i, "Server"],
  [/process|workflow|automat|order-to-cash|procure/i, "Workflow"],
  [/s\/4hana|landscape|architecture|upgrade|ecc/i, "Layers"],
];
// Words in the hook count three times those in the body, so a post about
// user experience that mentions "roles" once does not get the security icon.
export function iconFor(hook, body = "") {
  let best = { name: "Layers", score: 0 };
  for (const [re, name] of ICON_FOR) {
    const g = new RegExp(re.source, "gi");
    const score = (String(hook).match(g) || []).length * 3 + (String(body).match(g) || []).length;
    if (score > best.score) best = { name, score };
  }
  return best.name;
}

// A short, clean headline from the post's hook.
function headlineOf(p) {
  const raw = p.hook || p.title || String(p.body || "").split("\n").find((l) => l.trim()) || "";
  const cleaned = raw
    .replace(/[#*_`>]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const first = (cleaned.split(/(?<=[.!?])\s/)[0] || cleaned).replace(/[.]$/, "");
  if (first.length <= 60) return first;
  // Too long for a picture: stop at the first natural break, so the headline
  // is a whole thought ("Standardising the user experience across your SAP
  // landscape") and never a sentence cut off mid-way.
  const breaks = [...first.matchAll(/[:;,]| [–—-] | (?:is|are|was|can|will|should|means|often|but|because|when|while|so) /g)].map((m) => m.index).filter((i) => i >= 18 && i <= 66);
  const fits = breaks.filter((i) => i <= 60);
  if (breaks.length) return first.slice(0, fits.length ? fits[fits.length - 1] : breaks[0]).trim();
  const cut = first.slice(0, 60);
  const sp = cut.lastIndexOf(" ");
  return (sp > 30 ? cut.slice(0, sp) : cut).trim();
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// Read what a person chose on the card ("Change the pictures") into settings.
// Unknown values are ignored, so a stale card can never break the drawing.
export function settingsFrom(change = {}, prior = {}) {
  const colour = COLORS.find((c) => c.hex === change.colour || c.label.toLowerCase() === String(change.colour || "").toLowerCase());
  return {
    icon: pick(change.icon, ICON_NAMES, prior.icon),
    colour: colour ? colour.hex : prior.colour || DEFAULT_COLOUR,
    cardStyle: pick(change.cardStyle, Object.keys(CARD_STYLES), prior.cardStyle || "brand"),
    photo: change.photo === true || change.photo === "yes" || change.photo === "true" || (change.photo === undefined && !!prior.photo),
  };
}

// What people keep choosing on the approval cards, from their newest picture
// choices and redraw requests: a colour and card style to start from, and the
// kinds of picture in the order people pick them. A value counts once it has
// MIN_VOTES and leads outright; the post's own topic still picks the icon, and
// a photo is still only made when someone asks for one.
const LEARN_FROM = 20;
const MIN_VOTES = 2;
export function learnedPictureTaste(events = load("taste") || []) {
  const recent = (Array.isArray(events) ? events : []).filter((e) => (e.event === "picture" || e.event === "redraw") && e.detail).slice(-LEARN_FROM);
  const counts = (values) => {
    const m = new Map();
    for (const v of values) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const leader = (values, allowed) => {
    const [first, second] = counts(values.filter((v) => allowed.includes(v)));
    return first && first[1] >= MIN_VOTES && (!second || first[1] > second[1]) ? first[0] : undefined;
  };
  const picks = recent.filter((e) => e.event === "picture").map((e) => e.detail.pick);
  return {
    colour: leader(recent.map((e) => e.detail.colour), COLORS.map((c) => c.hex)),
    cardStyle: leader(recent.map((e) => e.detail.cardStyle), Object.keys(CARD_STYLES)),
    order: counts(picks.filter((k) => ["ascii", "card", "photo"].includes(k))).filter(([, n]) => n >= MIN_VOTES).map(([k]) => k),
  };
}

// Put the kinds people pick most first, and number the options 1, 2, 3 again.
export function orderOptions(options, order = []) {
  const rank = (o) => (order.includes(o.kind) ? order.indexOf(o.kind) : order.length);
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i)
    .map(({ o }, i) => ({ ...o, n: i + 1 }));
}

export const imageBytes = (file) => {
  const full = file && imageFilePath(file);
  return full && fs.existsSync(full) ? fs.readFileSync(full) : null;
};

// Make (or remake) the pictures for one LinkedIn draft and store them on it.
// Returns { status: "made" | "not_a_post" | "unavailable" | "failed", options?, errors? }.
// One kind failing does not lose the others.
export async function makePostImages(draftId, nowISO, change = {}) {
  const draft = listDrafts().find((d) => d.id === draftId);
  if (!draft || draft.kind === "blog") return { status: "not_a_post" };
  if (!renderAvailable()) return { status: "unavailable" };
  const p = draft.payload || {};
  const text = [p.hook, p.body, SERVICE_LABEL[p.serviceId]].filter(Boolean).join("\n");
  const prior = p.images?.settings || {};
  // A first drawing starts from what people keep choosing; a redraw keeps the post's own settings.
  const learned = learnedPictureTaste();
  const base = { icon: iconFor(`${p.hook || ""} ${SERVICE_LABEL[p.serviceId] || ""}`, p.body), colour: learned.colour, cardStyle: learned.cardStyle };
  const settings = settingsFrom(change, { ...base, ...Object.fromEntries(Object.entries(prior).filter(([, v]) => v != null)) });
  const headline = headlineOf(p);
  const kicker = (SERVICE_LABEL[p.serviceId] || "Larkwell Consulting").toUpperCase().slice(0, 40);
  const options = [];
  const errors = [];
  const attempt = async (kind, fn) => {
    try {
      const made = await fn();
      if (made) options.push({ n: options.length + 1, kind, ...made });
    } catch (err) {
      errors.push(`${kind}: ${String(err.message).slice(0, 160)}`);
    }
  };

  await attempt("ascii", async () => {
    const job = { type: "ascii", icon: settings.icon, color: settings.colour, aspect: "portrait", title: headline, kicker, draftId };
    const still = await renderImage({ ...job, fmt: "png" });
    // The moving version is the one to post; the chat can only show the still.
    const loop = await renderImage({ ...job, fmt: "gif", fps: 15, seconds: 5 }).catch((err) => (errors.push(`ascii gif: ${String(err.message).slice(0, 120)}`), null));
    return { label: `ASCII poster (${settings.icon})`, imageId: still.id, file: still.file, gifId: loop?.id || null, gifFile: loop?.file || null };
  });

  await attempt("card", async () => {
    const svg = await generateImage({ providerId: "cards", headline, subline: SERVICE_LABEL[p.serviceId] || "", style: settings.cardStyle, size: "linkedin", draftId, nowISO });
    const png = await renderImage({ type: "raster", url: svg.url, w: SIZES.linkedin.w, h: SIZES.linkedin.h, style: settings.cardStyle, headline, size: "linkedin", draftId });
    return { label: `Branded card (${CARD_STYLES[settings.cardStyle].label})`, imageId: png.id, file: png.file };
  });

  if (settings.photo && photoAvailable()) {
    await attempt("photo", async () => {
      const direction = await buildImageDirection({ text });
      const photo = await generateImage({ providerId: "unsplash", prompt: direction.visualPrompt || headline, size: "linkedin", draftId, nowISO });
      const card = await renderImage({ type: "photo-card", photoUrl: photo.url, look: "dark", headline, eyebrow: kicker, size: "linkedin", credit: photo.credit, sourceUrl: photo.sourceUrl, draftId });
      return { label: "Photo card", imageId: card.id, file: card.file, credit: photo.credit || null };
    });
  }

  if (!options.length) {
    addActivity({ actor: "system", event: "images.failed", summary: `could not make pictures for "${headline}": ${errors.join("; ")}`, ref: { libraryId: draftId } }, nowISO);
    return { status: "failed", errors };
  }
  const ordered = orderOptions(options, learned.order);
  const fresh = listDrafts().find((d) => d.id === draftId);
  updateDraft(draftId, { payload: { ...(fresh?.payload || p), images: { options: ordered, settings, madeAt: nowISO, chosen: null } } }, nowISO);
  const fromTaste = [!prior.colour && learned.colour && settings.colour === learned.colour ? `${COLORS.find((c) => c.hex === learned.colour)?.label || learned.colour} text` : "", !prior.cardStyle && learned.cardStyle && settings.cardStyle === learned.cardStyle ? `the ${CARD_STYLES[learned.cardStyle].label} card` : "", learned.order[0] ? `the ${learned.order[0]} picture first` : ""].filter(Boolean);
  addActivity({ actor: "agent", event: "images.made", summary: `made ${ordered.length} picture${ordered.length === 1 ? "" : "s"} for "${headline}" (${ordered.map((o) => o.kind).join(", ")})${fromTaste.length ? `; from what people usually choose: ${fromTaste.join(", ")}` : ""}`, ref: { libraryId: draftId } }, nowISO);
  return { status: "made", options: ordered, errors };
}
