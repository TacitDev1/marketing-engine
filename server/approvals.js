// Approvals. By default a person decides in the app: the Approvals inbox on
// the Jarvis screen lists every blog the Editor cleared and every LinkedIn post
// it passed, with Approve, Send back with a note, Drop it, and Stop it after an
// approval (approvalInbox() and decideInApp() below, GET /api/approvals/inbox and
// POST /api/approvals/:id/decide).
//
// Optional: "connect your own Teams". When the webhook addresses below are set,
// the same decision also goes to the team's chat, for people who will not open
// the app or cannot reach it outside the server's hours: when the Editor clears a blog or passes a LinkedIn post, the brain sends
// a card to a Power Automate workflow, which posts it in the team's chat with
// Approve and Reject buttons and waits. Whoever clicks, at any time of day, the
// workflow records it. When the server is next on, the brain asks a second
// workflow for the recorded decisions and applies them:
//   approve  the draft is marked Approved (a blog then publishes on its next
//            publishing day; a LinkedIn post waits for a person to post it),
//            and the chat gets a follow-up card with a "Stop it" button
//   stop     an approved draft that has not gone out yet is held back
//   revise   "send back with a note": the Editor reworks it using the note
//            and it comes back once as a new card; a second send-back drops it
//   drop     the draft is archived with the reason, and Jarvis learns from it
//
// A card can be answered once: the first click decides. Only clicks from the
// named approvers count (MKT_APPROVERS); anyone else's click is ignored and the
// card is sent again. A card nobody answers gets one reminder, then expires.
//
// Two addresses, both set in .env and both secrets:
//   MKT_APPROVAL_REQUEST_WEBHOOK  the workflow that posts the card and waits
//   MKT_APPROVAL_FETCH_WEBHOOK    the workflow that returns recorded decisions
// Without the first, nothing is sent and approving stays in the Library.
//
// Nothing is ever posted to LinkedIn from here: approving a LinkedIn post only
// marks it ready for a person.
//
// A LinkedIn post comes with pictures (server/post-images.js). They are posted
// in the chat at full size just above the card, by a third workflow that posts
// as the flow's owner (a card can only hold tiny previews):
//   MKT_PICTURE_WEBHOOK     the workflow that posts a message with pictures
//   MKT_APPROVAL_CHAT_ID    the Teams chat it posts into (19:...@thread.v2)
// The card then asks which picture to use, and "Change the pictures" redraws
// them with another icon, colour or style and asks again.
// After an approval with the ASCII poster, its moving version (a GIF, which a
// chat message cannot carry) is saved to a file store (SharePoint, for example) by a fourth workflow and
// linked in the chat:
//   MKT_PICTURE_FILE_WEBHOOK  saves a file to the file store and answers with its path
//   MKT_FILE_SITE_URL   the site the path belongs to, for the link

import { listDrafts, updateDraft } from "./drafts.js";
import { unassignDraft } from "./schedule.js";
import { postToTeams } from "./teams.js";
import { syncWiki } from "./wiki-bridge.js";
import { sessionWindow, localNow } from "./session.js";
import { load, persist, addActivity, addTasteEvent } from "./stores.js";
import { makePostImages, postImagesAvailable, photoAvailable, imageBytes, settingsFrom, ICON_NAMES, COLOUR_CHOICES, CARD_STYLE_CHOICES } from "./post-images.js";

const CHECK_EVERY_MS = 3 * 60 * 1000;
const APPLIED_KEPT = 400;
// A card's text is limited by Teams (about 28 KB for the whole card).
const MAX_CARD_TEXT = 14000;
const DAY_MS = 86400000;
const REMIND_AFTER_WORKDAYS = 2;
const EXPIRE_AFTER_DAYS = 7;
// An approved blog that has still not gone out after this long is asked about again.
const STALE_APPROVAL_DAYS = 14;

// Who may decide. First names, matched against the name Teams reports for the
// person who clicked. Set MKT_APPROVERS to change the list.
const approvers = () =>
  String(process.env.MKT_APPROVERS || "Mara,Jonas,Lena,Tobias")
    .split(",")
    .map((n) => fold(n.trim()))
    .filter(Boolean);
// Lower case with accents removed, so "Léna" in Teams matches "Lena" here.
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
// A click with no name recorded cannot be checked; it is accepted (only members
// of the chat can click) and shows as "someone".
export const isNamedApprover = (name) => !String(name || "").trim() || approvers().some((a) => fold(name).split(/[^\p{L}]+/u).includes(a));

const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ""));
const picturesConfigured = () => !!process.env.MKT_PICTURE_WEBHOOK && !!process.env.MKT_APPROVAL_CHAT_ID;
export const approvalsConfigured = () => ({ request: !!process.env.MKT_APPROVAL_REQUEST_WEBHOOK, fetch: !!process.env.MKT_APPROVAL_FETCH_WEBHOOK });

function state() {
  const s = load("approvals") || {};
  return { requests: s.requests && typeof s.requests === "object" ? s.requests : {}, applied: Array.isArray(s.applied) ? s.applied : [], lastCollect: s.lastCollect || null };
}

// Markdown headings and emphasis read badly in a card's plain text block.
const plain = (md) =>
  String(md || "")
    .replace(/^#{1,6}\s+(.*)$/gm, "**$1**")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// The card a person sees in Teams. The buttons submit the draft id with the
// decision; the reason box is read for a rejection.
export function approvalCard(draft) {
  const p = draft.payload || {};
  const blog = draft.kind === "blog";
  const title = blog ? p.title : p.hook;
  const body = [
    { type: "TextBlock", size: "Small", isSubtle: true, wrap: true, text: blog ? "Blog for larkwell.example: approve to publish" : "LinkedIn post: approve to mark it ready to post" },
    { type: "TextBlock", size: "Medium", weight: "Bolder", wrap: true, text: clip(title, 200) },
  ];
  // A piece that was sent back and reworked says so, with the note it answers.
  if (p.revision?.note) body.push({ type: "TextBlock", wrap: true, color: "Accent", text: `Revised after ${p.revision.by || "a reviewer"}'s note: "${clip(p.revision.note, 240)}"` });
  if (blog && p.metaDescription) body.push({ type: "TextBlock", wrap: true, isSubtle: true, text: clip(p.metaDescription, 300) });
  body.push({ type: "TextBlock", wrap: true, spacing: "Medium", text: clip(plain(p.body), MAX_CARD_TEXT) });
  const notes = [`Editor's mark: ${p.editor?.score ?? "?"}/10.`, p.editor?.notes ? `The Editor's reservations: ${clip(p.editor.notes, 300)}` : "", p.editor?.changes ? `What the Editor changed: ${clip(p.editor.changes, 240)}` : "", p.why ? `Why Jarvis wrote it: ${clip(p.why, 240)}` : ""].filter(Boolean);
  body.push({ type: "TextBlock", wrap: true, spacing: "Medium", isSubtle: true, text: notes.join("\n\n") });
  const data = (decision) => ({ decision, draftId: draft.id });
  // A LinkedIn post's pictures are in the chat just above this card, numbered.
  const pics = !blog && Array.isArray(p.images?.options) ? p.images.options : [];
  if (pics.length) {
    body.push({
      type: "Input.ChoiceSet",
      id: "picture",
      style: "expanded",
      label: "Which picture goes with it? (They are in the message above.)",
      value: "1",
      choices: [...pics.map((o) => ({ title: `${o.n} · ${o.label}`, value: String(o.n) })), { title: "No picture", value: "0" }],
    });
  }
  body.push({ type: "Input.Text", id: "reason", isMultiline: true, placeholder: "Sending it back or dropping it? Say why in a sentence. The rewrite and Jarvis both work from this." });
  const keep = { title: "Keep as it is", value: "" };
  const changePictures = pics.length
    ? [
        {
          type: "Action.ShowCard",
          title: "Change the pictures",
          card: {
            type: "AdaptiveCard",
            body: [
              { type: "TextBlock", wrap: true, isSubtle: true, text: "Choose what to change. The pictures are redrawn and this card comes back with the new ones." },
              { type: "Input.ChoiceSet", id: "icon", label: "ASCII poster: icon", value: "", choices: [keep, ...ICON_NAMES.map((n) => ({ title: n, value: n }))] },
              { type: "Input.ChoiceSet", id: "colour", label: "ASCII poster: colour", value: "", choices: [keep, ...COLOUR_CHOICES.map((c) => ({ title: c.label, value: c.hex }))] },
              { type: "Input.ChoiceSet", id: "cardStyle", label: "Branded card: style", value: "", choices: [keep, ...CARD_STYLE_CHOICES.map((c) => ({ title: c.label, value: c.id }))] },
              ...(photoAvailable() && !pics.some((o) => o.kind === "photo") ? [{ type: "Input.Toggle", id: "photo", title: "Also make a photo card (a stock photo with the headline on it)", valueOn: "yes", valueOff: "", value: "" }] : []),
            ],
            actions: [{ type: "Action.Submit", title: "Redraw", data: data("pictures") }],
          },
        },
      ]
    : [];
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body,
    actions: [
      { type: "Action.Submit", title: blog ? "Approve and publish" : "Approve", style: "positive", data: data("approve") },
      ...changePictures,
      // A piece already reworked once cannot be sent back again: approve it or drop it.
      ...(p.revision ? [] : [{ type: "Action.Submit", title: "Send back with a note", data: data("revise") }]),
      { type: "Action.Submit", title: "Drop it", style: "destructive", data: data("drop") },
    ],
  };
}

// After an approval with the ASCII poster: save its GIF to the file store and say
// where it is in the chat. Returns the link, or "" when it could not be done.
export async function deliverGif(draftId, nowISO, fetcher = fetch) {
  const fileUrl = process.env.MKT_PICTURE_FILE_WEBHOOK;
  const draft = listDrafts().find((d) => d.id === draftId);
  const images = draft?.payload?.images;
  const chosen = images?.options?.find((o) => o.n === images.chosen);
  if (!fileUrl || !chosen?.gifFile) return "";
  const bytes = imageBytes(chosen.gifFile);
  if (!bytes) return "";
  const stem = clip(String(draft.payload.hook || draft.payload.title || "linkedin-post"), 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "linkedin-post";
  const name = `${stem}-${chosen.gifFile}`;
  try {
    const text = await post(fileUrl, { name, content: bytes.toString("base64") }, fetcher);
    let out = {};
    try {
      out = JSON.parse(text);
    } catch {
      /* the workflow answered with no body */
    }
    const site = String(process.env.MKT_FILE_SITE_URL || "").replace(/\/+$/, "");
    const link = out.link || out.url || (out.path && site ? `${site}${encodeURI(out.path)}` : "");
    if (!link) throw new Error("the workflow did not say where it saved the file");
    const fresh = listDrafts().find((d) => d.id === draftId);
    updateDraft(draftId, { payload: { ...fresh.payload, images: { ...fresh.payload.images, gifLink: link } } }, nowISO);
    const chatId = process.env.MKT_APPROVAL_CHAT_ID;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    if (process.env.MKT_PICTURE_WEBHOOK && chatId) {
      await post(process.env.MKT_PICTURE_WEBHOOK, { chatId, message: { body: { contentType: "html", content: `<div>The moving picture for <b>${esc(clip(draft.payload.hook || draft.payload.title, 120))}</b>, ready to post on LinkedIn: <a href="${esc(link)}">${esc(name)}</a></div>` } } }, fetcher);
    }
    addActivity({ actor: "system", event: "images.gif_saved", summary: `saved the moving picture for "${clip(draft.payload.hook, 80)}" to the file store`, ref: { libraryId: draftId } }, nowISO);
    return link;
  } catch (err) {
    addActivity({ actor: "system", event: "images.failed", summary: `could not save the moving picture for "${clip(draft.payload.hook, 80)}" to the file store: ${String(err.message).slice(0, 160)}`, ref: { libraryId: draftId } }, nowISO);
    return "";
  }
}

// The pictures for a LinkedIn post, as one chat message at full size. Posted
// through the picture workflow (as the flow's owner). Returns true when sent.
export async function postPictures(draft, fetcher = fetch) {
  const url = process.env.MKT_PICTURE_WEBHOOK;
  const chatId = process.env.MKT_APPROVAL_CHAT_ID;
  const options = draft.payload?.images?.options || [];
  if (!url || !chatId || !options.length) return false;
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const hostedContents = [];
  const parts = [`<div><b>Pictures for: ${esc(clip(draft.payload.hook || draft.payload.title, 140))}</b></div>`];
  for (const o of options) {
    const bytes = imageBytes(o.file);
    if (!bytes) continue;
    const id = String(hostedContents.length + 1);
    // Teams takes JPG and PNG here, nothing else (a GIF is refused).
    hostedContents.push({ "@microsoft.graph.temporaryId": id, contentBytes: bytes.toString("base64"), contentType: /\.jpe?g$/i.test(o.file) ? "image/jpeg" : "image/png" });
    const moving = o.gifFile ? " The version to post moves (a GIF); the chat can only show a still." : "";
    parts.push(`<div><br><b>${o.n} · ${esc(o.label)}</b>${moving}${o.credit ? ` ${esc(o.credit)}.` : ""}</div><div><img src="../hostedContents/${id}/$value" style="width:${o.kind === "ascii" ? 320 : 460}px"></div>`);
  }
  if (!hostedContents.length) return false;
  await post(url, { chatId, message: { body: { contentType: "html", content: parts.join("") }, hostedContents } }, fetcher);
  return true;
}

// The follow-up after an approval: anyone may still stop it before it goes out.
export function stopCard(draft, by, when) {
  const p = draft.payload || {};
  const blog = draft.kind === "blog";
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      { type: "TextBlock", weight: "Bolder", wrap: true, text: `${by || "Someone"} approved: ${clip(p.title || p.hook, 160)}` },
      { type: "TextBlock", wrap: true, text: blog ? `It publishes to larkwell.example ${when}. If it should not go out, stop it here before then.` : "It is marked ready for a person to post on LinkedIn. If it should not be posted, stop it here." },
      { type: "Input.Text", id: "reason", isMultiline: true, placeholder: "Why should it not go out?" },
    ],
    actions: [{ type: "Action.Submit", title: "Stop it", style: "destructive", data: { decision: "stop", draftId: draft.id } }],
  };
}

async function post(url, body, fetcher) {
  const res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`the workflow answered ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  return text;
}

// Ask the team to approve one draft. Sent once per draft unless `again`.
// Returns { status: "sent" | "not_configured" | "already_sent" | "not_waiting" | "failed", error? }.
export async function requestApproval(draftId, nowISO, { fetcher = fetch, again = false, pictures = true, pictureLeadMs = 4000 } = {}) {
  const url = process.env.MKT_APPROVAL_REQUEST_WEBHOOK;
  if (!url) return { status: "not_configured" };
  const draft = listDrafts().find((d) => d.id === draftId);
  if (!draft || draft.status !== "draft") return { status: "not_waiting" };
  const s = state();
  // A draft that was sent back and reworked is asked about again; one that
  // was stopped is held until a person deals with it in the Library.
  if (s.requests[draftId]?.status === "sent" && !again) return { status: "already_sent" };
  if (draft.payload?.held && !again) return { status: "held" };
  const title = clip(draft.payload?.title || draft.payload?.hook, 140);
  // A LinkedIn post goes out with its pictures: make them the first time, post
  // them into the chat, then the card. Without pictures the card still goes.
  let asked = draft;
  if (draft.kind !== "blog" && pictures && picturesConfigured()) {
    try {
      if (!draft.payload?.images?.options?.length && postImagesAvailable()) await makePostImages(draftId, nowISO);
      asked = listDrafts().find((d) => d.id === draftId) || draft;
      const shown = await postPictures(asked, fetcher);
      if (!shown && asked.payload?.images) asked = { ...asked, payload: { ...asked.payload, images: null } };
      // The pictures and the card travel through different workflows: give the pictures a head start.
      if (shown) await new Promise((r) => setTimeout(r, pictureLeadMs));
    } catch (err) {
      addActivity({ actor: "system", event: "images.failed", summary: `could not post the pictures for "${title}" to Teams: ${String(err.message).slice(0, 160)}`, ref: { libraryId: draftId } }, nowISO);
      asked = { ...asked, payload: { ...asked.payload, images: null } };
    }
  }
  let rec;
  try {
    await post(url, { draftId, kind: draft.kind, title, card: approvalCard(asked) }, fetcher);
    rec = { status: "sent", at: nowISO, title, kind: draft.kind };
    addActivity({ actor: "system", event: "approval.requested", summary: `asked the team in Teams to approve "${title}"`, ref: { libraryId: draftId } }, nowISO);
  } catch (err) {
    rec = { status: "failed", at: nowISO, title, kind: draft.kind, error: String(err.message).slice(0, 200) };
    addActivity({ actor: "system", event: "approval.request_failed", summary: `could not send "${title}" to Teams for approval: ${rec.error}`, ref: { libraryId: draftId } }, nowISO);
  }
  const cur = state();
  cur.requests[draftId] = rec;
  persist("approvals", cur);
  return { status: rec.status, error: rec.error };
}

// One decision as the workflow recorded it. Field names vary with how the
// workflow stores them (a SharePoint list capitalises its columns), so read
// them loosely.
function normalise(raw) {
  if (!raw || typeof raw !== "object") return null;
  const get = (...keys) => {
    for (const k of Object.keys(raw)) if (keys.includes(k.toLowerCase())) return raw[k];
    return undefined;
  };
  const draftId = String(get("draftid", "draft", "title") || "").trim();
  const word = String(get("decision", "outcome") || "").trim().toLowerCase();
  // "reject" is the two-button card's word for what is now "drop".
  const decision = /^approv/.test(word) ? "approve" : /^stop/.test(word) ? "stop" : /^revis|^send/.test(word) ? "revise" : /^pictur|^image/.test(word) ? "pictures" : /^drop|^reject|^disapprov|^declin/.test(word) ? "drop" : "";
  if (!draftId || !decision) return null;
  // The workflow stores everything the card sent (the note, the picture chosen,
  // the picture changes) as JSON in the reason column; an older row holds just the note.
  let answers = {};
  let reason = String(get("reason", "comments", "comment") || "").trim();
  if (reason.startsWith("{")) {
    try {
      answers = JSON.parse(reason) || {};
      reason = String(answers.reason || "").trim();
    } catch {
      /* a note that happens to start with a brace */
    }
  }
  const by = get("by", "responder", "respondername", "approver");
  const at = String(get("at", "created", "decidedat") || "");
  return {
    // The workflow's own record id when it has one; otherwise the decision itself.
    key: String(get("id", "itemid") ?? `${draftId}:${decision}:${at}`),
    draftId,
    decision,
    reason: reason.slice(0, 400),
    // Which picture (a number, "0" for none), and what to change about the pictures.
    picture: /^\d$/.test(String(answers.picture ?? "")) ? Number(answers.picture) : null,
    change: { icon: answers.icon || undefined, colour: answers.colour || undefined, cardStyle: answers.cardStyle || undefined, photo: answers.photo === "yes" ? true : undefined },
    by: String((by && typeof by === "object" ? by.displayName || by.DisplayName || by.email : by) || "").slice(0, 80),
    at,
  };
}

// When the next blog would go out, in words, for the follow-up card.
function nextPublishingWords(nowISO) {
  const pub = load("publishing") || {};
  const days = Array.isArray(pub.days) && pub.days.length ? pub.days : [1, 3, 5];
  const hour = Number.isFinite(pub.afterHour) ? pub.afterHour : 16;
  const win = sessionWindow();
  const NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let i = 0; i < 8; i++) {
    const t = localNow(win, new Date(Date.parse(nowISO) + i * DAY_MS));
    if (days.includes(t.weekday) && (i > 0 || t.minutes < hour * 60)) return `on ${i === 0 ? "today" : NAME[t.weekday]} from ${hour}:00 (or the publishing day after, if others are ahead of it)`;
  }
  return "on the next publishing day";
}

// Apply one decision to its draft. Returns { result, followUp? }: `followUp`
// is a card to send next ("stop" after an approval, the same card again after
// a click that did not count).
export function applyDecision(d, nowISO) {
  const draft = listDrafts().find((x) => x.id === d.draftId);
  const via = d.via || "teams";
  const where = via === "teams" ? "in Teams" : "in the app";
  // In the app, whoever has the app open decides (as in the Library); the
  // named-approver rule applies to clicks that arrive from the chat.
  const isApprover = (name) => via !== "teams" || isNamedApprover(name);
  if (!draft) return { result: "unknown_draft" };
  const p = draft.payload || {};
  const label = clip(p.title || p.hook || draft.id, 80);
  const who = d.by || "someone";
  const ref = { libraryId: draft.id };
  const stamp = { decision: d.decision, by: d.by, reason: d.reason, decidedAt: d.at || nowISO, appliedAt: nowISO, via };
  const taste = (event, reason = "") => addTasteEvent({ event, kind: draft.kind, postType: p.postType || "", serviceId: p.serviceId || "", origin: p.origin || "", reason, text: label, draftId: draft.id }, nowISO);

  // "Stop it" acts on a draft someone approved that has not gone out yet.
  if (d.decision === "stop") {
    if (draft.status !== "approved") return { result: draft.status === "posted" ? "too_late" : "already_decided" };
    if (!isApprover(d.by)) {
      addActivity({ actor: "system", event: "approval.ignored", summary: `${who} pressed Stop on "${label}" ${where} but is not an approver; it stays approved`, ref }, nowISO);
      return { result: "not_an_approver", followUp: "stop" };
    }
    updateDraft(draft.id, { status: "draft", payload: { ...p, approval: stamp, held: { by: d.by, reason: d.reason, at: nowISO } } }, nowISO);
    unassignDraft(draft.id);
    addActivity({ actor: "you", event: "approval.stopped", summary: `${who} stopped "${label}" ${where}${d.reason ? `: ${d.reason}` : ""}. It is held in the Library and will not go out`, ref }, nowISO);
    return { result: "stopped" };
  }

  // Everything else decides a draft that is still waiting.
  if (draft.status !== "draft") return { result: "already_decided" };
  if (!isApprover(d.by)) {
    addActivity({ actor: "system", event: "approval.ignored", summary: `${who} clicked on "${label}" ${where} but is not an approver; asking again`, ref }, nowISO);
    return { result: "not_an_approver", followUp: "again" };
  }
  // "Change the pictures": redraw them and ask again. The post itself is not decided.
  if (d.decision === "pictures") {
    if (draft.kind === "blog") return { result: "ignored" };
    addActivity({ actor: "you", event: "approval.pictures", summary: `${who} asked ${where} for different pictures for "${label}"`, ref }, nowISO);
    // Only what the person actually picked ("Keep as it is" leaves a field out).
    const asked = settingsFrom(d.change || {}, { icon: null, colour: null, cardStyle: null });
    const detail = {};
    if (asked.icon) detail.icon = asked.icon;
    if (d.change?.colour && COLOUR_CHOICES.some((c) => c.hex === d.change.colour || c.label.toLowerCase() === String(d.change.colour).toLowerCase())) detail.colour = asked.colour;
    if (d.change?.cardStyle && CARD_STYLE_CHOICES.some((c) => c.id === d.change.cardStyle)) detail.cardStyle = d.change.cardStyle;
    if (asked.photo) detail.photo = true;
    addTasteEvent({ event: "redraw", kind: draft.kind, postType: p.postType || "", serviceId: p.serviceId || "", origin: p.origin || "", text: label, draftId: draft.id, detail }, nowISO);
    return { result: "pictures", followUp: "pictures" };
  }
  if (d.decision === "approve") {
    // The picture chosen on the card: its number, 0 for none. An older card has no choice.
    const options = p.images?.options || [];
    const chosen = options.length && d.picture != null ? (options.some((o) => o.n === d.picture) ? d.picture : 0) : null;
    const images = p.images ? { ...p.images, chosen } : p.images;
    updateDraft(draft.id, { status: "approved", payload: { ...p, images, approval: stamp, held: undefined } }, nowISO);
    taste("approved");
    const picked = options.find((o) => o.n === chosen);
    if (options.length && chosen != null) {
      const set = p.images?.settings || {};
      const detail = picked ? { pick: picked.kind, ...(picked.kind === "ascii" ? { icon: set.icon, colour: set.colour } : picked.kind === "card" ? { cardStyle: set.cardStyle } : {}) } : { pick: "none" };
      addTasteEvent({ event: "picture", kind: draft.kind, postType: p.postType || "", serviceId: p.serviceId || "", origin: p.origin || "", reason: picked ? `chose the ${picked.kind} picture` : "chose no picture", text: label, draftId: draft.id, detail }, nowISO);
    }
    addActivity({ actor: "you", event: "approval.approved", summary: `${who} approved "${label}" ${where}${draft.kind === "blog" ? "; it publishes on the next publishing day" : picked ? ` with picture ${picked.n} (${picked.label})` : options.length && chosen === 0 ? " with no picture" : ""}`, ref }, nowISO);
    return { result: "approved", followUp: "stop" };
  }
  // Send back with a note: once. The Editor reworks it (it rejoins the
  // Editor's queue carrying the note) and it is asked about again.
  if (d.decision === "revise" && !p.revision && d.reason) {
    const { editor: before, approvalAnnouncedAt, ...rest } = p;
    updateDraft(draft.id, { payload: { ...rest, revision: { note: d.reason, by: d.by, at: nowISO, editorBefore: before ? { score: before.score, at: before.at } : null }, approval: stamp } }, nowISO);
    addActivity({ actor: "you", event: "approval.sent_back", summary: `${who} sent "${label}" back ${where}: ${d.reason}. The Editor will rework it`, ref }, nowISO);
    return { result: "sent_back" };
  }
  // Drop it. Also where a send-back lands when there is no note to work from,
  // or the piece was already reworked once.
  const why = d.decision === "revise" ? (p.revision ? `Sent back a second time${d.reason ? `: ${d.reason}` : ""}` : "Sent back with no note") : d.reason;
  updateDraft(draft.id, { status: "archived", payload: { ...p, approval: stamp } }, nowISO);
  unassignDraft(draft.id);
  taste("rejected", why);
  addActivity({ actor: "you", event: "approval.dropped", summary: `${who} dropped "${label}" ${where}${why ? `: ${why}` : " (no reason given)"}`, ref }, nowISO);
  return { result: "dropped" };
}

// Send the "Stop it" card for a draft that was just approved.
async function sendStopCard(draftId, by, nowISO, fetcher) {
  const url = process.env.MKT_APPROVAL_REQUEST_WEBHOOK;
  const draft = listDrafts().find((d) => d.id === draftId);
  if (!url || !draft) return;
  try {
    await post(url, { draftId, kind: draft.kind, title: `Approved: ${clip(draft.payload?.title || draft.payload?.hook, 120)}`, card: stopCard(draft, by, draft.kind === "blog" ? nextPublishingWords(nowISO) : "") }, fetcher);
  } catch (err) {
    addActivity({ actor: "system", event: "approval.request_failed", summary: `could not send the Stop card to Teams: ${String(err.message).slice(0, 160)}`, ref: { libraryId: draftId } }, nowISO);
  }
}

// What to tell the chat when a click could not take effect, or "" when
// nothing needs saying (a plain double click).
function lateNote(d, result) {
  const draft = listDrafts().find((x) => x.id === d.draftId);
  if (!draft) return "";
  const label = clip(draft.payload?.title || draft.payload?.hook, 90);
  const who = d.by || "Someone";
  if (result === "too_late") return `${who} pressed Stop on "${label}", but it had already been published. Taking it down has to be done on the website.`;
  if (result === "already_decided" && draft.payload?.approval?.decision === "expired") return `${who} answered the card for "${label}", but it had expired after a week with no answer and was archived. It can be restored from the Library.`;
  return "";
}

function markRequest(draftId, status) {
  const s = state();
  if (!s.requests[draftId]) return;
  s.requests[draftId].status = status;
  persist("approvals", s);
}

// Fetch the recorded decisions and apply the ones not applied before.
// One collection at a time: a decision's follow-ups (redrawing pictures, the
// next card) take a while, and a second collection started meanwhile would
// read the same rows and apply them again. A call that arrives during a
// collection waits for it and applies nothing itself.
let collecting = null;
export function collectDecisions(nowISO, opts = {}) {
  if (collecting) return collecting.then(() => ({ status: "ok", received: 0, applied: [], note: "a collection was already running" }));
  collecting = collectOnce(nowISO, opts).finally(() => {
    collecting = null;
  });
  return collecting;
}

async function collectOnce(nowISO, { fetcher = fetch, tell = postToTeams } = {}) {
  const url = process.env.MKT_APPROVAL_FETCH_WEBHOOK;
  if (!url) return { status: "not_configured", applied: [] };
  let rows;
  try {
    const text = await post(url, { since: state().lastCollect?.at || null }, fetcher);
    const json = text ? JSON.parse(text) : [];
    rows = Array.isArray(json) ? json : json.decisions || json.value || json.items || [];
    if (!Array.isArray(rows)) throw new Error("the workflow did not return a list of decisions");
  } catch (err) {
    const error = String(err.message).slice(0, 200);
    const s = state();
    // Say so once, not every three minutes.
    if (s.lastCollect?.error !== error) addActivity({ actor: "system", event: "approval.collect_failed", summary: `could not collect approvals from Teams: ${error}` }, nowISO);
    persist("approvals", { ...s, lastCollect: { at: s.lastCollect?.at || null, triedAt: nowISO, error } });
    return { status: "failed", error, applied: [] };
  }
  const s = state();
  const seen = new Set(s.applied);
  const applied = [];
  for (const d of rows.map(normalise).filter(Boolean)) {
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    const out = applyDecision(d, nowISO);
    applied.push({ draftId: d.draftId, decision: d.decision, by: d.by, result: out.result });
    // The card has been answered: it is no longer waiting, whatever the answer.
    if (["approved", "dropped", "sent_back", "stopped"].includes(out.result)) markRequest(d.draftId, out.result);
    // A click that came too late still showed "recorded" in Teams: say what
    // actually happened, so nobody believes they stopped or approved something.
    const late = lateNote(d, out.result);
    if (late) await tell({ title: late, sections: [] }).catch(() => {});
    if (out.followUp === "stop") await sendStopCard(d.draftId, d.by, nowISO, fetcher);
    if (out.result === "approved") await deliverGif(d.draftId, nowISO, fetcher);
    if (out.followUp === "again") await requestApproval(d.draftId, nowISO, { fetcher, again: true });
    if (out.followUp === "pictures") {
      await makePostImages(d.draftId, nowISO, d.change).catch(() => {});
      await requestApproval(d.draftId, nowISO, { fetcher, again: true });
    }
  }
  persist("approvals", { ...state(), applied: [...seen].slice(-APPLIED_KEPT), lastCollect: { at: nowISO, triedAt: nowISO, error: null, received: rows.length } });
  // What was dropped or sent back, and why, goes onto the wiki.
  if (applied.some((a) => a.result === "dropped" || a.result === "sent_back")) syncWiki(nowISO);
  return { status: "ok", received: rows.length, applied };
}

// Working days between two moments (the server's days), for the reminder.
function workdaysBetween(fromISO, nowISO) {
  const win = sessionWindow();
  let n = 0;
  for (let t = Date.parse(fromISO) + DAY_MS; t <= Date.parse(nowISO); t += DAY_MS) if (win.days.includes(localNow(win, new Date(t)).weekday)) n++;
  return n;
}

// Cards nobody has answered: one reminder in the chat after two working days,
// and after a week the piece is archived as not reviewed (which teaches Jarvis
// nothing: silence is not a rejection). Approved blogs that have waited too
// long to go out are asked about again.
export async function chaseApprovals(nowISO, { send = postToTeams, fetcher = fetch } = {}) {
  const s = state();
  const drafts = new Map(listDrafts().map((d) => [d.id, d]));
  const out = { reminded: [], expired: [], reasked: [] };
  const remind = [];
  for (const [id, r] of Object.entries(s.requests)) {
    const draft = drafts.get(id);
    if (r.status !== "sent" || !draft || draft.status !== "draft") continue;
    if (Date.parse(nowISO) - Date.parse(r.at) > EXPIRE_AFTER_DAYS * DAY_MS) {
      updateDraft(id, { status: "archived", payload: { ...draft.payload, approval: { decision: "expired", appliedAt: nowISO, via: "teams" } } }, nowISO);
      unassignDraft(id);
      r.status = "expired";
      addActivity({ actor: "system", event: "approval.expired", summary: `nobody answered the approval card for "${r.title}" in ${EXPIRE_AFTER_DAYS} days; it is archived as not reviewed`, ref: { libraryId: id } }, nowISO);
      out.expired.push(id);
    } else if (!r.remindedAt && workdaysBetween(r.at, nowISO) >= REMIND_AFTER_WORKDAYS) {
      r.remindedAt = nowISO;
      remind.push(r.title);
      out.reminded.push(id);
    }
  }
  persist("approvals", { ...state(), requests: s.requests });
  if (remind.length) {
    await send({
      title: remind.length === 1 ? "1 piece is still waiting for a decision" : `${remind.length} pieces are still waiting for a decision`,
      sections: [{ lines: remind.map((t) => `"${clip(t, 110)}"`) }, { lines: ["Scroll up to the card and choose Approve, Send back with a note, or Drop it. A card nobody answers expires after a week."], plain: true }],
    });
  }
  for (const d of drafts.values()) {
    const at = d.payload?.approval?.appliedAt;
    if (d.kind !== "blog" || d.status !== "approved" || d.payload?.approval?.via !== "teams" || !at || Date.parse(nowISO) - Date.parse(at) < STALE_APPROVAL_DAYS * DAY_MS) continue;
    updateDraft(d.id, { status: "draft", payload: { ...d.payload, approval: { ...d.payload.approval, decision: "lapsed" } } }, nowISO);
    addActivity({ actor: "system", event: "approval.lapsed", summary: `"${clip(d.payload.title, 80)}" was approved ${STALE_APPROVAL_DAYS} days ago and has not gone out; asking again`, ref: { libraryId: d.id } }, nowISO);
    await requestApproval(d.id, nowISO, { fetcher, again: true });
    out.reasked.push(d.id);
  }
  return out;
}

// For the app: what was sent, what is still waiting, and whether collecting works.
export function approvalsStatus() {
  const s = state();
  const waiting = new Set(listDrafts().filter((d) => d.status === "draft").map((d) => d.id));
  return {
    configured: approvalsConfigured(),
    lastCollect: s.lastCollect,
    waiting: Object.entries(s.requests)
      .filter(([id, r]) => r.status === "sent" && waiting.has(id))
      .map(([id, r]) => ({ id, ...r })),
    failed: Object.entries(s.requests)
      .filter(([id, r]) => r.status === "failed" && waiting.has(id))
      .map(([id, r]) => ({ id, ...r })),
  };
}

let timer = null;
let running = false;
// Server only: a laptop holding the same addresses must not consume the
// decisions the server is waiting for.
export function startApprovalCollector() {
  if (timer || process.env.MKT_DEPLOYMENT !== "server" || !process.env.MKT_APPROVAL_FETCH_WEBHOOK) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date().toISOString();
      await collectDecisions(now);
      await chaseApprovals(now);
    } catch (err) {
      console.error("approvals:", err.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  // Soon after boot, well before the 16:00 publishing check.
  setTimeout(tick, 30000).unref();
}

// ---------- The in-app Approvals inbox (the default) ----------

// What waits for a person: blogs the Editor cleared, LinkedIn posts it passed,
// and approved pieces that have not gone out yet (they can still be stopped).
export function approvalInbox() {
  const all = listDrafts();
  const item = (d) => {
    const p = d.payload || {};
    return {
      id: d.id,
      kind: d.kind,
      title: p.title || p.hook || d.id,
      score: p.editor?.score ?? null,
      editorReason: p.editor?.notes || p.editor?.reason || "",
      revised: !!p.revision,
      revisionNote: p.revision?.note || "",
      savedAt: d.savedAt,
      approval: p.approval || null,
    };
  };
  const waiting = all.filter((d) => d.status === "draft" && d.payload?.editor?.verdict === "pass" && (d.kind !== "blog" || d.payload.editor.cleared));
  const approved = all.filter((d) => d.status === "approved");
  const byScore = (x, y) => (y.payload?.editor?.score ?? 0) - (x.payload?.editor?.score ?? 0) || String(y.savedAt).localeCompare(String(x.savedAt));
  return {
    teams: approvalsConfigured(),
    waiting: waiting.sort(byScore).map(item),
    approved: approved.sort(byScore).slice(0, 20).map(item),
  };
}

// A decision made in the app. decision: approve | revise | drop | stop.
export function decideInApp(draftId, { decision, reason = "", by = "", picture = null } = {}, nowISO) {
  if (!["approve", "revise", "drop", "stop"].includes(decision)) return { result: "bad_decision" };
  if (decision === "revise" && !String(reason).trim()) return { result: "note_required" };
  return applyDecision({ draftId, decision, reason: String(reason).slice(0, 1000), by: String(by).slice(0, 60) || "you", picture, at: nowISO, via: "app" }, nowISO);
}
