#!/usr/bin/env node
// Tests for the agent team (2026-11-12): the register (server/agent-team.js)
// and the window runner (scripts/agents-window.mjs).
//
// Runs against a throwaway copy of the app in a temp folder, with a fake
// `claude` command, so the real data/ is never touched and no tokens are spent.
//
//   node scripts/test-agent-team.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const box = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-agents-"));
for (const dir of ["server", "src/lib", "scripts"]) fs.cpSync(path.join(root, dir), path.join(box, dir), { recursive: true });
fs.symlinkSync(path.join(root, "node_modules"), path.join(box, "node_modules"), process.platform === "win32" ? "junction" : "dir");
fs.writeFileSync(path.join(box, "package.json"), JSON.stringify({ type: "module" }));
fs.mkdirSync(path.join(box, "data"));
fs.mkdirSync(path.join(box, "wiki"));

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures++;
};
const iso = (d) => d.toISOString();

// ---------- the register ----------
process.env.JARVIS_TZ = "UTC";
process.env.JARVIS_WINDOW_START = "15";
process.env.JARVIS_WINDOW_END = "17";
const team = await import(pathToFileURL(path.join(box, "server/agent-team.js")).href);

const monday1510 = new Date("2026-11-09T15:10:00Z"); // a Monday
const monday1640 = new Date("2026-11-09T16:40:00Z");
const saturday = new Date("2026-11-14T15:10:00Z");

let due = team.dueAgents(monday1510);
check(due.agents.map((a) => a.id).join() === "editor,researcher", "on a Monday the Editor is due ahead of the Researcher; planned agents never are");
const friday1510 = new Date("2026-11-13T15:10:00Z");
check(team.dueAgents(new Date("2026-11-10T15:10:00Z")).agents[0].id === "seo", "the SEO agent goes first on Tuesday");
check(team.dueAgents(friday1510).agents.map((a) => a.id).join() === "measurement,strategist,editor,researcher", "on Friday Measurement reports first, then the Strategist plans next week");
const editor = (d) => d.agents.find((a) => a.id === "editor");
const researcher = (d) => d.agents.find((a) => a.id === "researcher");
check(due.secondsLeft === 85 * 60, `window has 85 min left at 15:10 (stops 25 min before 17:00), got ${due.secondsLeft / 60}`);
check(researcher(due).model === "claude-sonnet-5-5" && researcher(due).precheck === "research-queue" && editor(due).precheck === "editor-queue", "the runner gets the model and each agent's precheck");
check(/Read\(\.claude\/skills\/\*\*\)/.test(editor(due).tools) && !/WebFetch/.test(editor(due).tools), "the Editor may read the skills and the context file, and has no web tools");
check(/WebFetch/.test(team.dueAgents(friday1510).agents[1].tools) && !/WebFetch/.test(team.dueAgents(friday1510).agents[0].tools), "the Strategist has web tools; Measurement works from the brain alone");
check(team.dueAgents(monday1640).secondsLeft === 0, "no time left after the agents' stop time");
check(team.dueAgents(saturday).secondsLeft === 0 && team.dueAgents(saturday).agents.length === 0, "nothing is due on a weekend");
check(team.dueAgents(saturday, { only: "researcher" }).agents.length === 1, "a manual run of one agent ignores the day");
check(team.dueAgents(monday1510, { only: "conversion" }).agents.length === 0, "a planned agent cannot be run by hand");

check(team.setAgentEnabled("conversion", true, iso(monday1510)) === false, "a planned agent cannot be switched on");
check(team.setAgentEnabled("nope", true, iso(monday1510)) === null, "an unknown agent is reported as not found");
team.setAgentEnabled("researcher", false, iso(monday1510));
check(!researcher(team.dueAgents(monday1510)), "a switched-off agent is not due");
check(team.dueAgents(monday1510, { only: "researcher" }).agents.length === 0, "and cannot be run by hand either");
team.setAgentEnabled("researcher", true, iso(monday1510));

const rec = team.recordAgentRun("researcher", { status: "ok", exitCode: 0, startedAt: iso(monday1510), model: "claude-sonnet-5-5", summary: "x".repeat(5000) }, iso(new Date("2026-11-09T15:22:00Z")));
check(rec.dateKey === "2026-11-09" && rec.summary.length === 2000, "a run is stored with its local date and a trimmed summary");
check(team.recordAgentRun("researcher", { status: "weird" }, iso(monday1510)).status === "failed", "an unknown run status is stored as failed");
check(team.recordAgentRun("nope", {}, iso(monday1510)) === null, "a run for an unknown agent is refused");
check(!!researcher(team.dueAgents(monday1510)), "a looping agent stays due after a successful run");
team.recordAgentRun("editor", { status: "ok", startedAt: iso(monday1510) }, iso(monday1510));
check(!!editor(team.dueAgents(monday1510)), "the Editor stays due too: it runs whenever drafts are waiting");
team.recordAgentRun("measurement", { status: "failed", startedAt: iso(friday1510) }, iso(friday1510));
check(team.dueAgents(friday1510).agents[0].id === "measurement", "a once-a-day agent whose run failed is still due");
team.recordAgentRun("measurement", { status: "ok", startedAt: iso(friday1510) }, iso(friday1510));
check(team.dueAgents(friday1510).agents[0].id === "strategist", "and is not due again that day once a run succeeded");
const listed = team.listAgents();
check(listed.length === 7 && listed.find((a) => a.id === "researcher").lastRun.status === "failed", "the list shows every agent with its latest run");
process.env.MKT_AGENT_MODEL_RESEARCHER = "claude-haiku-5-5";
check(researcher(team.dueAgents(monday1510)).model === "claude-haiku-5-5", "the model can be overridden per agent");
delete process.env.MKT_AGENT_MODEL_RESEARCHER;

// Claude signed out: every run fails the same way; say so once a day.
delete process.env.MKT_TEAMS_WEBHOOK; // nothing leaves the test
const expired = "Failed to authenticate: OAuth session expired and could not be refreshed";
check(!team.agentsSignedOut(), "agents are not reported signed out after a good run");
team.recordAgentRun("seo", { status: "failed", exitCode: 1, startedAt: iso(monday1510), summary: expired }, iso(monday1510));
team.recordAgentRun("strategist", { status: "failed", exitCode: 1, startedAt: iso(monday1510), summary: expired }, iso(monday1510));
const outs = JSON.parse(fs.readFileSync(path.join(box, "data/activity.json"), "utf8")).filter((a) => a.event === "agent.signed_out");
check(team.agentsSignedOut() && outs.length === 1, "a sign-in failure is reported once that day, however many runs fail");
check(!team.signedOut({ status: "failed", summary: "Tool error: file not found" }), "an ordinary failure is not taken for a sign-in problem");
team.recordAgentRun("measurement", { status: "ok", startedAt: iso(monday1640) }, iso(monday1640));
check(!team.agentsSignedOut(), "and the warning clears once a run succeeds again");

// ---------- the runner, against a real brain and a fake claude ----------
const PORT = 8797;
// A Node script, so the test runs on Windows too (the runner runs a .mjs
// CLAUDE_BIN with Node).
const fake = path.join(box, "fake-claude.mjs");
// The fake prints --help with the effort flag, records its arguments, and does
// what a research run does: claims the queued topic and marks it done.
fs.writeFileSync(
  fake,
  `import fs from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--help") { console.log("  --effort <level>"); process.exit(0); }
fs.writeFileSync(${JSON.stringify(path.join(box, "claude-args.txt"))}, argv.join(" ") + "\\n");
const post = (p, body) => fetch("http://127.0.0.1:${PORT}" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const j = await post("/api/research/claim", { count: 1 });
await post("/api/research/topic-done", { topicId: j.topics[0].id, claimToken: j.claimToken });
console.log("Researched 1 topic: test topic");
`
);
fs.writeFileSync(path.join(box, "data/agent-team.json"), JSON.stringify({ enabled: {}, runs: [] }));
// Stop the laptop-mode Worker planting its seed topics into the test queue.
fs.writeFileSync(path.join(box, "data/worker-state.json"), JSON.stringify({ seedsPlanted: true }));
fs.writeFileSync(
  path.join(box, "data/research-queue.json"),
  JSON.stringify([{ id: "rq-test", topic: "test topic", front: "messaging", rationale: "", priority: 3, status: "queued", claimToken: null, claimedAt: null, createdBy: "jarvis", createdAt: new Date().toISOString(), doneAt: null, findingIds: [] }])
);

const brainEnv = { ...process.env, PORT: String(PORT), JARVIS_TZ: "UTC", JARVIS_WINDOW_START: "0", JARVIS_WINDOW_END: "0", JARVIS_SESSION: "off" };
const brain = spawn(process.execPath, ["server/index.js"], { cwd: box, env: brainEnv, stdio: "ignore" });
const get = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
let up = false;
for (let i = 0; i < 160 && !up; i++) {
  await new Promise((r) => setTimeout(r, 250));
  up = await get("/api/agents").then(() => true, () => false);
}
check(up, "the brain serves /api/agents");

const runnerEnv = { ...process.env, MKT_BRAIN_URL: `http://127.0.0.1:${PORT}`, CLAUDE_BIN: fake };
try {
  if (up) {
    const patch = await fetch(`http://127.0.0.1:${PORT}/api/agents/conversion`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    check(patch.status === 409, "switching on a planned agent over the API is refused (409)");

    const win = spawnSync(process.execPath, ["scripts/agents-window.mjs"], { cwd: box, env: runnerEnv, encoding: "utf8", timeout: 60000 });
    check(/outside the agents' window/.test(win.stdout) && !fs.existsSync(path.join(box, "claude-args.txt")), "outside the window the runner starts nothing");

    const once = spawnSync(process.execPath, ["scripts/agents-window.mjs", "--once", "researcher"], { cwd: box, env: runnerEnv, encoding: "utf8", timeout: 60000 });
    const args = fs.existsSync(path.join(box, "claude-args.txt")) ? fs.readFileSync(path.join(box, "claude-args.txt"), "utf8") : "";
    check(/-p \/mkt-research --model claude-sonnet-5-5 --allowedTools Bash\(curl:\*\),Bash\(printenv:\*\),Edit\(\.agent-out\/\*\*\),WebFetch,WebSearch --max-turns 80 --output-format text --disallowedTools Read\(\.env\),\S*Read\(data\/\*\*\) --effort medium/.test(args), `a manual run calls claude with the agent's command, model, tools and effort (got: ${args.trim() || once.stdout + once.stderr})`);
    check(!/dangerously/.test(args), "the runner never skips permissions");
    check(fs.existsSync(path.join(box, ".agent-out")), "the runner makes the folder the agent writes its JSON in");
    const after = await get("/api/agents");
    const r = after.agents.find((a) => a.id === "researcher").lastRun;
    check(r && r.status === "ok" && /Researched 1 topic/.test(r.summary), "the run is reported back with the agent's closing report");
    check((await get("/api/research/queue")).queue.length === 0, "the fake run emptied the queue");

    const idle = spawnSync(process.execPath, ["scripts/agents-window.mjs", "--once", "researcher"], { cwd: box, env: runnerEnv, encoding: "utf8", timeout: 60000 });
    check(/nothing to do/.test(idle.stdout) && (await get("/api/agents")).agents.find((a) => a.id === "researcher").runCount === 1, "with an empty queue no Claude run is spent");

    const planned = spawnSync(process.execPath, ["scripts/agents-window.mjs", "--once", "sales"], { cwd: box, env: runnerEnv, encoding: "utf8", timeout: 60000 });
    check(/planned, not built yet/.test(planned.stdout), "a planned agent is not run");
  }
} finally {
  brain.kill();
  await new Promise((r) => (brain && brain.exitCode === null && brain.signalCode === null ? brain.once("exit", r) : r()));
  fs.rmSync(box, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
