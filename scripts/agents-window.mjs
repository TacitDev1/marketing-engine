#!/usr/bin/env node
// Runs Larkwell's marketing agents inside the server's daily window.
//
// Prod starts this once per boot (for example a systemd timer; see the README). It asks the
// brain which agents are due (GET /api/agents/due, see server/agent-team.js),
// runs each with the Claude CLI under the tools that agent is allowed, and
// reports every run back (POST /api/agents/:id/runs). Once-a-day agents go
// first; looping agents (the Researcher) then run back to back until the
// brain says the window has under ten minutes left.
//
//   node scripts/agents-window.mjs               the whole window (prod)
//   node scripts/agents-window.mjs --once seo    one agent now, any time (testing)
//
// Env: MKT_BRAIN_URL (default http://127.0.0.1:8787), CLAUDE_BIN (default
// "claude"), MKT_AGENT_EFFORT (default "medium"; empty leaves the flag out).
// It never uses --dangerously-skip-permissions: an agent can only use the
// tools its entry in the register lists, may write only inside .agent-out/,
// and is denied the .env files and the data folder.

import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAIN = (process.env.MKT_BRAIN_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const CLAUDE = process.env.CLAUDE_BIN || "claude";
// A .js/.mjs CLAUDE_BIN (a stand-in, as in the tests) is run with this Node.
const [CLAUDE_EXE, CLAUDE_PRE] = /\.[cm]?js$/i.test(CLAUDE) ? [process.execPath, [CLAUDE]] : [CLAUDE, []];
const EFFORT = process.env.MKT_AGENT_EFFORT ?? "medium";
const OUT_DIR = path.join(ROOT, ".agent-out");
const MIN_LEFT_S = 600; // don't start a run with under ten minutes left
const IDLE_WAIT_MS = 60_000;
const MAX_ATTEMPTS = 2; // per once-a-day agent, per window

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(pathname, { method = "GET", body } = {}) {
  const res = await fetch(`${BRAIN}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}`);
  return res.json();
}

// The brain starts a little after boot; give it three minutes.
async function waitForBrain() {
  for (let i = 0; i < 36; i++) {
    try {
      if ((await api("/api/health")).ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(5000);
  }
  return false;
}

// True when the agent has something to do. A failed check counts as "no" so
// a broken endpoint never spends a Claude run.
async function hasWork(agent) {
  try {
    if (agent.precheck === "research-queue") return ((await api("/api/research/queue")).queue || []).length > 0;
    if (agent.precheck === "editor-queue") return (await api("/api/editor/queue?limit=1")).waiting > 0;
    return true;
  } catch {
    return false;
  }
}

// Older CLIs have no --effort flag; passing it would fail every run.
function cliHasEffort() {
  const help = spawnSync(CLAUDE_EXE, [...CLAUDE_PRE, "--help"], { encoding: "utf8" });
  return !help.error && /--effort\b/.test(`${help.stdout}${help.stderr}`);
}

function runClaude(agent, timeoutS, withEffort) {
  const args = ["-p", agent.command, "--model", agent.model, "--allowedTools", agent.tools, "--max-turns", String(agent.maxTurns), "--output-format", "text"];
  if (agent.deniedTools) args.push("--disallowedTools", agent.deniedTools);
  if (withEffort && EFFORT) args.push("--effort", EFFORT);
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_EXE, [...CLAUDE_PRE, ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (d) => {
      out = (out + d).slice(-6000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, timeoutS * 1000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: "failed", exitCode: null, summary: `could not start ${CLAUDE}: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: timedOut ? "timeout" : code === 0 ? "ok" : "failed", exitCode: code, summary: out.trim() });
    });
  });
}

async function runAgent(agent, secondsLeft, withEffort) {
  const startedAt = new Date().toISOString();
  // Where the agent writes the JSON it posts to the brain; emptied before each run.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const timeoutS = Math.max(60, Math.min(agent.maxMinutes * 60, secondsLeft));
  log(`${agent.name}: starting (${agent.model}, up to ${Math.round(timeoutS / 60)} min)`);
  const result = await runClaude(agent, timeoutS, withEffort);
  log(`${agent.name}: ${result.status}${result.exitCode ? ` (exit ${result.exitCode})` : ""}`);
  try {
    await api(`/api/agents/${agent.id}/runs`, { method: "POST", body: { ...result, startedAt, model: agent.model } });
  } catch (err) {
    log(`${agent.name}: could not report the run: ${err.message}`);
  }
  return result;
}

async function main() {
  if (!(await waitForBrain())) {
    log(`brain not reachable at ${BRAIN}`);
    return;
  }
  const withEffort = cliHasEffort();
  const onceId = process.argv[2] === "--once" ? process.argv[3] : null;

  if (onceId) {
    // A manual run: any registered agent with a command, whatever the day.
    const all = (await api("/api/agents")).agents;
    const found = all.find((a) => a.id === onceId);
    if (!found) return log(`no agent called "${onceId}". Known: ${all.map((a) => a.id).join(", ")}`);
    if (found.status !== "live") return log(`${found.name} is planned, not built yet`);
    const due = (await api(`/api/agents/due?only=${encodeURIComponent(onceId)}`)).agents[0];
    if (!due) return log(`${found.name} is switched off`);
    if (!(await hasWork(due))) return log(`${found.name}: nothing to do`);
    await runAgent(due, due.maxMinutes * 60, withEffort);
    return;
  }

  const attempts = new Map();
  for (;;) {
    let due;
    try {
      due = await api("/api/agents/due");
    } catch (err) {
      log(`brain stopped answering: ${err.message}`);
      break;
    }
    if (due.secondsLeft < MIN_LEFT_S) {
      log(due.secondsLeft ? "under ten minutes left in the window; stopping" : "outside the agents' window; nothing to run");
      break;
    }
    let ran = false;
    for (const agent of due.agents) {
      if (agent.repeat !== "loop" && (attempts.get(agent.id) || 0) >= MAX_ATTEMPTS) continue;
      if (!(await hasWork(agent))) continue;
      // The clock moved while earlier agents ran: ask again how long is left.
      const left = (await api("/api/agents/due").catch(() => ({ secondsLeft: 0 }))).secondsLeft;
      if (left < MIN_LEFT_S) break;
      attempts.set(agent.id, (attempts.get(agent.id) || 0) + 1);
      await runAgent(agent, left, withEffort);
      ran = true;
    }
    // Nothing had work (the Researcher's queue is empty until Jarvis plans):
    // wait a minute instead of spinning.
    if (!ran) await sleep(IDLE_WAIT_MS);
  }
  log("agents window closed");
}

main().catch((err) => {
  console.error("agents window failed:", err);
  process.exitCode = 1;
});
