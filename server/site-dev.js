// server/site-dev.js
// Runs a LIVE PREVIEW of the migrated Astro site (../company-website) for the
// Website screen. It can:
//   - detect a dev server already running on the preview port (e.g. one you
//     started in a terminal) and just use it,
//   - start one itself if none is running (`astro build && astro preview`),
//   - stop the one IT started (it never kills a server it didn't start).
// It NEVER edits the site's SOURCE — it only builds + serves the site.

import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WEBSITE_REPO, looksLikeOurSite } from "./config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The company website repository: MKT_WEBSITE_REPO, or ../company-website.
const SITE_ROOT = WEBSITE_REPO;
// The Website section treats this as the production site (Tobias runs the
// production build here). Override with SITE_PREVIEW_PORT if needed.
const PORT = Number(process.env.SITE_PREVIEW_PORT) || 4322;
const PREVIEW_URL = `http://localhost:${PORT}`;
const ASTRO_BIN = path.join(SITE_ROOT, "node_modules", ".bin", "astro");

let child = null; // the dev server WE started (if any)
let startedAt = null;
let starting = false;
const logBuf = []; // ring buffer of recent output lines

function pushLog(chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue;
    logBuf.push(line.replace(/\[[0-9;]*m/g, "")); // strip ANSI colours
    if (logBuf.length > 60) logBuf.shift();
  }
}

// Is something answering on the preview port — and is it OUR site?
// Any local dev server can grab this port (bit us 2026-07-13: another local app
// was on :4322 and the preview/iframe/Lighthouse all trusted it blindly), so
// we read the homepage and check it actually looks like the Larkwell site.
function probe(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path: "/", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
          if (body.length > 16384) res.destroy(); // first 16KB is plenty
        });
        // The company name or site host is in the title, canonical and og tags
        // within the first few hundred bytes (see server/config.js).
        const done = () =>
          resolve({ up: (res.statusCode || 0) > 0, ours: looksLikeOurSite(body) });
        res.on("end", done);
        res.on("close", done);
      }
    );
    req.on("error", () => resolve({ up: false, ours: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ up: false, ours: false });
    });
  });
}

async function waitForUp(tries = 40, gapMs = 750) {
  for (let i = 0; i < tries; i++) {
    const p = await probe(1500);
    if (p.up && p.ours) return true;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return false;
}

export function siteRootExists() {
  try {
    return fs.existsSync(SITE_ROOT);
  } catch {
    return false;
  }
}

export async function siteDevStatus() {
  const p = await probe();
  return {
    running: p.up && p.ours,
    // Something ELSE is on our port — surface it honestly instead of
    // iframing/auditing a stranger's app.
    portBusyByOther: p.up && !p.ours,
    managed: !!child, // did we start it? (vs. running in a terminal)
    starting,
    port: PORT,
    url: PREVIEW_URL,
    // The address a person's BROWSER can open. On a laptop that is the localhost
    // URL; on the server it is whatever the HTTPS reverse proxy publishes for the
    // preview port (SITE_PREVIEW_PUBLIC_URL in .env), or null = not reachable.
    publicUrl: process.env.SITE_PREVIEW_PUBLIC_URL || (process.env.MKT_DEPLOYMENT === "server" ? null : PREVIEW_URL),
    startedAt,
    siteRoot: SITE_ROOT,
    siteAvailable: siteRootExists(),
    log: logBuf.slice(-12),
  };
}

export async function startSiteDev() {
  if (!siteRootExists()) {
    return { ...(await siteDevStatus()), note: "site_not_found" };
  }
  // Already up (maybe started in a terminal) — just use it. But only if it's
  // actually the Larkwell site; a foreign app on the port is an error, not a win.
  const p = await probe();
  if (p.up && p.ours) {
    return { ...(await siteDevStatus()), note: "already_running" };
  }
  if (p.up && !p.ours) {
    pushLog(`Port ${PORT} is taken by ANOTHER app (not the Larkwell site) — stop it first.`);
    return { ...(await siteDevStatus()), note: "port_busy_other_app" };
  }
  if (starting) return { ...(await siteDevStatus()), note: "starting" };

  starting = true;
  logBuf.length = 0;
  pushLog(`Building + serving the production site in ${SITE_ROOT} on :${PORT} ...`);
  try {
    // Serve the PRODUCTION build (astro build && astro preview) so the Website
    // section shows the real production site, not the dev server. detached:true
    // gives the child its own process group so we can stop the whole tree later.
    const astro = fs.existsSync(ASTRO_BIN) ? ASTRO_BIN : "npx astro";
    child = spawn(
      "sh",
      ["-c", `${astro} build && ${astro} preview --port ${PORT}`],
      { cwd: SITE_ROOT, env: process.env, detached: true }
    );
    startedAt = new Date().toISOString();
    child.stdout?.on("data", (d) => pushLog(d.toString()));
    child.stderr?.on("data", (d) => pushLog(d.toString()));
    // A spawn failure (missing sh/astro) fires 'error' asynchronously — without
    // this listener Node would throw it as an uncaught exception. Log and reset.
    // Both handlers only clear state if `child` still points at THIS process —
    // a stop→start pair can swap in a replacement before the old process's
    // delayed 'exit' fires, and clearing unconditionally would orphan it.
    const proc = child;
    proc.on("error", (err) => {
      pushLog(`spawn error: ${err.message}`);
      if (child === proc) {
        child = null;
        startedAt = null;
        starting = false;
      }
    });
    proc.on("exit", (code) => {
      pushLog(`dev server exited (code ${code})`);
      if (child === proc) {
        child = null;
        startedAt = null;
      }
    });

    const up = await waitForUp();
    starting = false;
    return { ...(await siteDevStatus()), note: up ? "started" : "start_timeout" };
  } catch (err) {
    starting = false;
    pushLog(`failed to start: ${err.message}`);
    child = null;
    return { ...(await siteDevStatus()), note: "start_failed", error: err.message };
  }
}

function killChild() {
  if (!child) return;
  const pid = child.pid;
  try {
    // negative pid -> kill the whole process group (astro + esbuild helper)
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  child = null;
  startedAt = null;
}

export async function stopSiteDev() {
  if (!child) {
    // We didn't start it (it's running in a terminal) — don't kill it.
    return { ...(await siteDevStatus()), note: "not_managed" };
  }
  killChild();
  await new Promise((r) => setTimeout(r, 500)); // let the port release
  return { ...(await siteDevStatus()), note: "stopped" };
}

// Never leave an orphan preview server when the brain exits.
process.on("exit", killChild);
process.on("SIGINT", () => {
  killChild();
  process.exit(0);
});
process.on("SIGTERM", () => {
  killChild();
  process.exit(0);
});
