// What the agents report (agent team, phase 3). An agent that does not edit
// drafts (Strategist, SEO, Measurement) ends its run by filing one report here:
// a headline, the report itself, the concrete actions it proposes, and
// anything that needs a person. Each action also becomes a recommendation, so
// it lands in the same list the team already works from. Reports are shown in
// the app and summarised in the weekly summary.
//
// Nothing here changes the website: an action is a proposal for a person.

import { AGENTS } from "./agent-team.js";
import { sessionWindow, localNow } from "./session.js";
import { load, persist, addActivity, addRecommendation, newId } from "./stores.js";

const KEPT = 80;
const MAX_ACTIONS = 12;
// Where each agent's actions are filed among the recommendations.
const FRONT = { strategist: "messaging", seo: "technical-seo", measurement: "analytics", conversion: "landing-pages", sales: "competitor-gaps" };

const text = (v, max) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);
const line = (v, max) => text(v, max).replace(/\s+/g, " ");

function cleanMetrics(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return {};
  const out = {};
  for (const [k, v] of Object.entries(m).slice(0, 30)) {
    if (typeof v === "number" && Number.isFinite(v)) out[line(k, 40)] = v;
  }
  return out;
}

// Returns { report } or { error }. `input`: title, headline, body (Markdown),
// actions [{ title, detail, why, effort, page }], needs [string],
// pages [paths the agent looked at], metrics { name: number }.
export function fileReport(agentId, input, nowISO, { recommend = true } = {}) {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) return { error: "not_found" };
  const headline = line(input?.headline, 300);
  const body = text(input?.body, 14000);
  if (!headline || !body) return { error: "headline_and_body_required" };
  const dateKey = localNow(sessionWindow(), new Date(nowISO)).dateKey;

  const actions = [];
  for (const a of Array.isArray(input?.actions) ? input.actions.slice(0, MAX_ACTIONS) : []) {
    const title = line(a?.title, 140);
    const detail = text(a?.detail, 900);
    if (!title || !detail) continue;
    const action = { title, detail, why: line(a?.why, 300), effort: ["small", "medium", "large"].includes(a?.effort) ? a.effort : "medium", page: line(a?.page, 200), recId: null };
    if (recommend) {
      const rec = addRecommendation(
        { front: FRONT[agentId] || "messaging", title, detail: `${action.page ? `Page: ${action.page}. ` : ""}${detail}${action.why ? ` Why: ${action.why}` : ""}`, effort: action.effort, evidence: [`agent:${agentId}:${dateKey}`] },
        nowISO
      );
      action.recId = rec?.id || null;
    }
    actions.push(action);
  }

  const report = {
    id: newId("rep", nowISO),
    agentId,
    agentName: agent.name,
    createdAt: nowISO,
    dateKey,
    title: line(input?.title, 140) || `${agent.name} report`,
    headline,
    body,
    actions,
    needs: (Array.isArray(input?.needs) ? input.needs : []).map((n) => line(n, 240)).filter(Boolean).slice(0, 6),
    pages: (Array.isArray(input?.pages) ? input.pages : []).map((p) => line(p, 200)).filter(Boolean).slice(0, 40),
    metrics: cleanMetrics(input?.metrics),
  };
  persist("agentReports", [report, ...(load("agentReports") || [])].slice(0, KEPT));
  addActivity({ actor: "agent", event: "agent.report", summary: `${agent.name}: ${headline}`.slice(0, 240) }, nowISO);
  return { report };
}

export function listReports({ agentId = "", limit = 20 } = {}) {
  return (load("agentReports") || []).filter((r) => !agentId || r.agentId === agentId).slice(0, limit);
}

export function latestReport(agentId) {
  return listReports({ agentId, limit: 1 })[0] || null;
}

// The newest report of each agent, for the app's agent list.
export function latestReports() {
  const out = {};
  for (const r of load("agentReports") || []) if (!out[r.agentId]) out[r.agentId] = r;
  return out;
}

// What an agent needs from its own last report to avoid repeating itself:
// what it said, what it proposed and what became of each proposal.
export function previousReport(agentId) {
  const r = latestReport(agentId);
  if (!r) return null;
  const recs = new Map((load("recommendations") || []).map((x) => [x.id, x.status]));
  return {
    date: r.dateKey,
    headline: r.headline,
    pages: r.pages,
    metrics: r.metrics,
    // "expired": never acted on and aged out of the open list. "gone": no
    // longer on record at all.
    actions: r.actions.map((a) => ({ title: a.title, page: a.page, status: recs.get(a.recId) || "gone" })),
  };
}
