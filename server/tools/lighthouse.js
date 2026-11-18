// Local Lighthouse audits of the migrated company-website (read-only).
//
// Runs Google's Lighthouse (the engine behind PageSpeed Insights) against the
// LOCAL Astro preview — free, no API key, works before the site ever deploys.
// Uses a self-contained Chrome headless shell in ~/.cache/mkt-chrome (no
// system install, no sudo): binary downloaded from Chrome for Testing, its
// four missing shared libs extracted from .debs into ./libs and injected via
// LD_LIBRARY_PATH. See PROGRESS.md (2026-07-13) for how this was set up.
//
// One audit at a time; the last result is persisted to data/site-audit.json
// so it survives brain restarts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteDevStatus, startSiteDev } from "../site-dev.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(HERE, "..", "..", "data", "site-audit.json");

const CHROME_DIR = path.join(os.homedir(), ".cache", "mkt-chrome");
const CHROME_BIN = path.join(CHROME_DIR, "chrome-headless-shell-linux64", "chrome-headless-shell");
const CHROME_LIBS = path.join(CHROME_DIR, "libs", "usr", "lib", "x86_64-linux-gnu");

export function chromeAvailable() {
  return fs.existsSync(CHROME_BIN);
}

// ---- state ----
let running = false;
let startedAt = null;
let currentPath = null;
let lastError = null;
let activeChromePid = null; // for last-resort cleanup on process death

// chrome-launcher only self-cleans on SIGINT; a SIGTERM (our own restart
// script!) or crash mid-audit would strand a headless Chrome eating RAM.
// 'exit' handlers must be synchronous — a raw kill(pid) is exactly that.
// (site-dev.js's SIGTERM/SIGINT handlers call process.exit, which fires this.)
process.on("exit", () => {
  if (activeChromePid) {
    try {
      process.kill(activeChromePid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
});

function loadLast() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveLast(result) {
  // Atomic write, matching the app's store hygiene.
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(result, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

export function auditStatus() {
  return {
    running,
    startedAt,
    path: currentPath,
    error: lastError,
    chromeAvailable: chromeAvailable(),
    lastResult: loadLast(),
  };
}

// Wait (up to ~2 min) for the preview server — startSiteDev builds the site
// first, which can take a while on a cold run.
async function ensurePreview() {
  let status = await siteDevStatus();
  if (status.running) return status;
  if (status.portBusyByOther) {
    throw new Error(
      `Another app is using port ${status.port} — it is NOT the Larkwell site, so auditing it would be meaningless. Stop that app first.`
    );
  }
  status = await startSiteDev();
  if (status.running) return status;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    status = await siteDevStatus();
    if (status.running) return status;
    // A foreign app can grab the port mid-wait — bail with the clear message
    // instead of polling a port that can never become ours.
    if (status.portBusyByOther) {
      throw new Error(
        `Another app took port ${status.port} while waiting — it is NOT the Larkwell site. Stop that app first.`
      );
    }
  }
  throw new Error("The site preview didn't come up — check the Website screen's preview log.");
}

// Trim a full Lighthouse report down to what the UI shows. The raw report is
// megabytes; we keep scores, key metrics, and the failing audits that matter.
function summarise(lhr, pagePath) {
  const cat = (id) => {
    const c = lhr.categories?.[id];
    // A null category score means Lighthouse itself errored on that category —
    // report "unknown" (null), not a catastrophic-looking 0.
    return c && c.score != null ? Math.round(c.score * 100) : null;
  };

  const metric = (id) => {
    const a = lhr.audits?.[id];
    return a ? { value: a.numericValue ?? null, display: a.displayValue || null, score: a.score } : null;
  };

  // Failing / improvable audits, worst first. Skip informational noise.
  const failures = Object.values(lhr.audits || {})
    .filter(
      (a) =>
        typeof a.score === "number" &&
        a.score < 0.9 &&
        !["informative", "notApplicable", "manual"].includes(a.scoreDisplayMode)
    )
    .sort((a, b) => a.score - b.score)
    .slice(0, 25)
    .map((a) => ({
      id: a.id,
      title: a.title,
      score: a.score,
      display: a.displayValue || null,
      // First sentence only — the full text links Lighthouse docs we don't need.
      hint: (a.description || "").split(/\.\s/)[0].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"),
    }));

  return {
    path: pagePath,
    finishedAt: new Date().toISOString(),
    lighthouseVersion: lhr.lighthouseVersion,
    scores: {
      performance: cat("performance"),
      accessibility: cat("accessibility"),
      bestPractices: cat("best-practices"),
      seo: cat("seo"),
    },
    metrics: {
      fcp: metric("first-contentful-paint"),
      lcp: metric("largest-contentful-paint"),
      tbt: metric("total-blocking-time"),
      cls: metric("cumulative-layout-shift"),
      si: metric("speed-index"),
    },
    failures,
  };
}

// Kick off an audit of one page. Resolves when DONE (the route fires it
// without await and polls auditStatus instead).
export async function runAudit(pagePath = "/") {
  if (running) throw new Error("An audit is already running.");
  if (!chromeAvailable()) {
    throw new Error("Headless Chrome isn't installed at ~/.cache/mkt-chrome — re-run the setup.");
  }

  running = true;
  startedAt = new Date().toISOString();
  currentPath = pagePath;
  lastError = null;

  let chrome = null;
  try {
    const preview = await ensurePreview();
    const url = `${preview.url}${pagePath.startsWith("/") ? pagePath : `/${pagePath}`}`;

    // Lazy imports: lighthouse is heavy and only needed here.
    const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
      import("lighthouse"),
      import("chrome-launcher"),
    ]);

    // Chrome needs its extracted shared libs on the library path. Scope the
    // injection to THIS launch via envVars — mutating process.env would leak
    // Chrome's NSS/ALSA libs into every later child (ffmpeg, astro, …).
    chrome = await chromeLauncher.launch({
      chromePath: CHROME_BIN,
      chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      envVars: {
        ...process.env,
        LD_LIBRARY_PATH: `${CHROME_LIBS}:${process.env.LD_LIBRARY_PATH || ""}`,
      },
    });
    activeChromePid = chrome.pid;

    // Never hang: a stuck Chrome used to leave `running` true (every later
    // audit got 409) and Chrome resident until restart.
    const LH_TIMEOUT_MS = Number(process.env.LIGHTHOUSE_TIMEOUT_MS) || 3 * 60000;
    let timer;
    const { lhr } = await Promise.race([
      lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Lighthouse gave up after ${Math.round(LH_TIMEOUT_MS / 60000)} minutes`)), LH_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));

    const result = summarise(lhr, pagePath);
    saveLast(result);
    return result;
  } catch (err) {
    lastError = err.message;
    throw err;
  } finally {
    try {
      await chrome?.kill();
    } catch {
      /* ignore */
    }
    activeChromePid = null;
    running = false;
    currentPath = null;
  }
}
