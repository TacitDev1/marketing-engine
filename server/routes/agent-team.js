// Marketing Engine brain server — routes: the agent team.
// Registered from server/index.js via registerAgentTeamRoutes(app).

import { listAgents, agentRuns, dueAgents, recordAgentRun, setAgentEnabled } from "../agent-team.js";
import { latestReports } from "../agent-reports.js";
import { currentPlan } from "../week-plan.js";
import { nowISO } from "./shared.js";

export function registerAgentTeamRoutes(app) {
  // ---------- The agent team (register + run log; see server/agent-team.js) ----------
  app.get("/api/agents", (req, res) => {
    // Each agent's newest report, and the plan Jarvis is following this week.
    res.json({ agents: listAgents(), runs: agentRuns(null, Math.min(100, Number(req.query.runs) || 30)), reports: latestReports(), plan: currentPlan() });
  });

  // What the runner (scripts/agents-window.mjs) should start now.
  // ?only=<id> is a manual run of one agent, outside the daily rota.
  app.get("/api/agents/due", (req, res) => res.json(dueAgents(new Date(), { only: String(req.query.only || "") })));

  // Switch a live agent on or off.
  app.patch("/api/agents/:id", (req, res) => {
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled_required" });
    const agent = setAgentEnabled(req.params.id, req.body.enabled, nowISO());
    if (agent === null) return res.status(404).json({ error: "not_found" });
    if (agent === false) return res.status(409).json({ error: "not_live", message: "This agent is planned and cannot be switched on yet." });
    res.json({ agent });
  });

  // The runner reports a finished run.
  app.post("/api/agents/:id/runs", (req, res) => {
    const run = recordAgentRun(req.params.id, req.body || {}, nowISO());
    if (!run) return res.status(404).json({ error: "not_found" });
    res.json({ run });
  });
}
