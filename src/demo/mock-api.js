// The static demo's API. Only in `npm run build:demo` / `npm run dev:demo`.
//
// It answers the app's fetch("/api/...") calls from snapshot.json, which
// scripts/build-demo-data.mjs recorded from the real server running on the
// invented sample data. A few actions (approve, send back, drop, change a
// status, switch an agent off) work in memory so the flow can be tried; they
// reset on reload. Anything that needs a model answers with a polite "demo" note.
import snapshot from "./snapshot.json";

const WEEK = 7 * 86400000;

// Move every date by whole weeks so the sample always looks recent and the
// weekdays (blog on Wednesday, agents on Tuesday and Friday) still line up.
const shiftMs = Math.max(0, Math.round((Date.now() - Date.parse(snapshot.takenAt)) / WEEK)) * WEEK;
function shiftDates(text) {
  if (!shiftMs) return text;
  return text.replace(/\b(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?/g, (m, date, time) => {
    const t = Date.parse(time ? m : `${date}T12:00:00.000Z`);
    if (Number.isNaN(t)) return m;
    const iso = new Date(t + shiftMs).toISOString();
    return time ? iso : iso.slice(0, 10);
  });
}

// Pictures are bundled; point the gallery at them.
const PICTURES = import.meta.glob("./images/*.svg", { eager: true, query: "?url", import: "default" });
const pictureUrl = (file) => PICTURES[`./images/${file}`] || "";

const db = JSON.parse(shiftDates(JSON.stringify(snapshot.get)));
for (const img of db["/api/images"]?.images || []) img.url = pictureUrl(img.file);

const DEMO_NOTE = "This is a static demo with sample data. No models are running, so this needs the real app.";
const nowISO = () => new Date().toISOString();
const drafts = () => db["/api/drafts"].drafts;
const findDraft = (id) => drafts().find((d) => d.id === id);

// Mirrors approvalInbox() in server/approvals.js.
function inbox() {
  const item = (d) => {
    const p = d.payload || {};
    return { id: d.id, kind: d.kind, title: p.title || p.hook || d.id, score: p.editor?.score ?? null, editorReason: p.editor?.notes || p.editor?.reason || "", revised: !!p.revision, revisionNote: p.revision?.note || "", savedAt: d.savedAt, approval: p.approval || null };
  };
  const byScore = (x, y) => (y.payload?.editor?.score ?? 0) - (x.payload?.editor?.score ?? 0) || String(y.savedAt).localeCompare(String(x.savedAt));
  return {
    teams: { request: false, fetch: false },
    waiting: drafts().filter((d) => d.status === "draft" && d.payload?.editor?.verdict === "pass" && (d.kind !== "blog" || d.payload.editor.cleared)).sort(byScore).map(item),
    approved: drafts().filter((d) => d.status === "approved").sort(byScore).map(item),
  };
}

function publishing() {
  const pub = db["/api/publishing"];
  const cleared = (status) => drafts().filter((d) => d.kind === "blog" && d.status === status && d.payload?.editor?.cleared);
  pub.awaitingApproval = cleared("draft").map((d) => ({ id: d.id, title: d.payload.title, score: d.payload.editor.score }));
  const next = cleared("approved")[0];
  pub.waiting = cleared("approved").length;
  pub.next = next ? { id: next.id, title: next.payload.title, score: next.payload.editor.score } : null;
  return pub;
}

function setStatus(d, status) {
  if (status === "archived" && d.status !== "archived") d.archivedFrom = d.status;
  d.status = status;
  d.updatedAt = nowISO();
  return d;
}

function activity(summary, ref = {}) {
  const list = db["/api/autopilot/activity?limit=300"]?.activity;
  if (Array.isArray(list)) list.unshift({ id: `a-demo-${Date.now()}`, ts: nowISO(), actor: "you", event: "demo", summary, ref });
}

function decide(id, { decision, reason = "" }) {
  const d = findDraft(id);
  if (!d) return [404, { result: "unknown_draft" }];
  const label = d.payload.title || d.payload.hook;
  const stamp = { decision, by: "you", reason, decidedAt: nowISO(), appliedAt: nowISO(), via: "app" };
  if (decision === "stop") {
    if (d.status !== "approved") return [409, { result: "already_decided" }];
    setStatus(d, "draft");
    d.payload = { ...d.payload, approval: stamp, held: { by: "you", reason, at: nowISO() } };
    activity(`you stopped "${label}" in the app. It is held in the Library and will not go out`, { libraryId: id });
    return [200, { result: "stopped" }];
  }
  if (d.status !== "draft") return [409, { result: "already_decided" }];
  if (decision === "approve") {
    setStatus(d, "approved");
    d.payload = { ...d.payload, approval: stamp };
    activity(`you approved "${label}" in the app`, { libraryId: id });
    return [200, { result: "approved" }];
  }
  if (decision === "revise") {
    if (!reason.trim()) return [400, { result: "note_required" }];
    const { editor, ...rest } = d.payload;
    d.payload = { ...rest, revision: { note: reason, by: "you", at: nowISO(), editorBefore: editor ? { score: editor.score, at: editor.at } : null }, approval: stamp };
    activity(`you sent "${label}" back in the app: ${reason}. The Editor will rework it`, { libraryId: id });
    return [200, { result: "sent_back" }];
  }
  setStatus(d, "archived");
  d.payload = { ...d.payload, approval: stamp };
  activity(`you dropped "${label}" in the app${reason ? `: ${reason}` : ""}`, { libraryId: id });
  return [200, { result: "dropped" }];
}

function slotByKey(key) {
  return (db["/api/schedule"].slots || []).find((s) => s.key === key);
}
const summarise = (d) => (d ? { id: d.id, kind: d.kind, status: d.status, title: d.payload.title, hook: d.payload.hook, score: d.payload.editor?.score ?? null } : null);

// [method, regex, handler(match, body, url)] -> [status, json]
const ROUTES = [
  ["GET", /^\/api\/approvals\/inbox$/, () => [200, inbox()]],
  ["GET", /^\/api\/publishing$/, () => [200, publishing()]],
  ["GET", /^\/api\/schedule\/candidates$/, (_m, _b, url) => [200, db[`/api/schedule/candidates?kind=${url.searchParams.get("kind") === "blog" ? "blog" : "linkedin"}`] || { candidates: [] }]],
  ["POST", /^\/api\/approvals\/([^/]+)\/decide$/, (m, body) => {
    const [status, out] = decide(decodeURIComponent(m[1]), body || {});
    return [status, { ...out, inbox: inbox() }];
  }],
  ["PATCH", /^\/api\/drafts\/([^/]+)$/, (m, body) => {
    const d = findDraft(m[1]);
    if (!d) return [404, { error: "not_found" }];
    if (body?.status) setStatus(d, body.status);
    if (body?.payload) d.payload = { ...d.payload, ...body.payload };
    return [200, d];
  }],
  ["DELETE", /^\/api\/drafts\/([^/]+)$/, (m) => {
    db["/api/drafts"].drafts = drafts().filter((d) => d.id !== m[1]);
    return [200, { ok: true }];
  }],
  ["PATCH", /^\/api\/agents\/([^/]+)$/, (m, body) => {
    const a = (db["/api/agents"].agents || []).find((x) => x.id === m[1]);
    if (!a) return [404, { error: "not_found" }];
    if (a.status !== "live") return [409, { error: "not_live", message: "This agent is planned and cannot be switched on yet." }];
    a.enabled = !!body?.enabled;
    return [200, { agent: a }];
  }],
  ["PATCH", /^\/api\/autopilot\/(recommendations|directives)\/([^/]+)$/, (m, body) => {
    const key = `/api/autopilot/${m[1]}`;
    const list = db[key]?.[m[1]] || [];
    const r = list.find((x) => x.id === m[2]);
    if (!r) return [404, { error: "not_found" }];
    Object.assign(r, body || {});
    return [200, r];
  }],
  ["PATCH", /^\/api\/playbook\/([^/]+)$/, (m, body) => {
    const r = (db["/api/playbook"].rules || []).find((x) => x.id === m[1]);
    if (!r) return [404, { error: "not_found" }];
    Object.assign(r, body || {});
    return [200, r];
  }],
  ["POST", /^\/api\/schedule\/([^/]+)\/status$/, (m, body) => {
    const slot = slotByKey(decodeURIComponent(m[1]));
    if (!slot) return [404, { error: "not_found" }];
    slot.status = String(body?.status || slot.status);
    if (slot.status === "published") {
      slot.publishedAt = nowISO();
      const d = slot.draftId && findDraft(slot.draftId);
      if (d) setStatus(d, "posted");
    }
    return [200, { slot }];
  }],
  ["POST", /^\/api\/schedule\/([^/]+)\/assign$/, (m, body) => {
    const slot = slotByKey(decodeURIComponent(m[1]));
    const d = body?.draftId ? findDraft(body.draftId) : null;
    if (!slot) return [404, { error: "not_found" }];
    Object.assign(slot, { draftId: d?.id || null, draft: summarise(d), status: d ? "ready" : "planned", pickedBy: "you", reason: "chosen by hand" });
    return [200, { slot }];
  }],
];

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function answer(method, url, init) {
  let body = null;
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = null;
    }
  }
  for (const [m, re, fn] of ROUTES) {
    const match = m === method && url.pathname.match(re);
    if (match) {
      const [status, out] = fn(match, body, url);
      return json(status, out);
    }
  }
  if (method === "GET") {
    const key = url.pathname + url.search;
    if (key in db) return json(200, db[key]);
    if (url.pathname in db) return json(200, db[url.pathname]);
    // Not recorded: an empty, valid answer keeps the screen calm.
    return json(200, {});
  }
  // A real action that needs the brain or a model. 503 with a message the
  // screens show as they would show a busy server.
  return json(503, { error: "demo", message: DEMO_NOTE });
}

export function installMockApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === "string" ? input : input?.url || String(input);
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = String(init.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    // A short pause, so loading states look like the real thing.
    await new Promise((r) => setTimeout(r, 120));
    return answer(method, url, init);
  };
}
