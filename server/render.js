// Drawing images with nobody at the screen.
//
// The ASCII poster and the photo card are drawn by browser code (three.js and
// a canvas). So that the server can make them unattended, it opens its own
// headless Chrome (the one the site audit uses) on a bare page of the app,
// "/?render=<job>" (src/render/RenderJob.jsx). That page reads the job here,
// draws it with the same code the Images screens use, saves the result into
// the image library and reports back. One job at a time; never hangs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listImages } from "./images.js";

const CHROME_DIR = path.join(os.homedir(), ".cache", "mkt-chrome");
const CHROME_BIN = path.join(CHROME_DIR, "chrome-headless-shell-linux64", "chrome-headless-shell");
const CHROME_LIBS = path.join(CHROME_DIR, "libs", "usr", "lib", "x86_64-linux-gnu");
const TIMEOUT_MS = { png: 60_000, gif: 5 * 60_000, mp4: 5 * 60_000 };

export const renderAvailable = () => fs.existsSync(CHROME_BIN);

// Where the app's pages are served: the brain itself in production
// (SERVE_DIST=1), the Vite dev server on a laptop.
const pageBase = () => (process.env.MKT_RENDER_URL || (process.env.SERVE_DIST === "1" ? `http://127.0.0.1:${process.env.PORT || 8787}` : "http://localhost:5180")).replace(/\/+$/, "");

const jobs = new Map(); // id -> { job, resolve }
let seq = 0;
let queue = Promise.resolve();
const chromePids = new Set();
process.on("exit", () => {
  for (const pid of chromePids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
});

export const renderJob = (id) => jobs.get(id)?.job || null;
export function finishRenderJob(id, result) {
  const entry = jobs.get(id);
  if (!entry) return false;
  entry.resolve(result || {});
  return true;
}

async function runOne(job) {
  if (!renderAvailable()) throw new Error("Headless Chrome isn't installed at ~/.cache/mkt-chrome, so the server can't draw this image.");
  const id = `rj-${Date.now()}-${++seq}`;
  const done = new Promise((resolve) => jobs.set(id, { job, resolve }));
  const chromeLauncher = await import("chrome-launcher");
  let chrome = null;
  let timer;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: CHROME_BIN,
      startingUrl: `${pageBase()}/?render=${id}`,
      // No GPU on the server: three.js draws through Chrome's software renderer.
      chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--window-size=1200,1400"],
      envVars: { ...process.env, LD_LIBRARY_PATH: `${CHROME_LIBS}:${process.env.LD_LIBRARY_PATH || ""}` },
    });
    chromePids.add(chrome.pid);
    const ms = TIMEOUT_MS[job.fmt] || TIMEOUT_MS.png;
    const result = await Promise.race([done, new Promise((resolve) => (timer = setTimeout(() => resolve({ error: `The drawing did not finish within ${Math.round(ms / 1000)} seconds.` }), ms)))]);
    if (result.error) throw new Error(result.error);
    const image = listImages().find((i) => i.id === result.imageId);
    if (!image) throw new Error("The drawing finished but no image was saved.");
    return image;
  } finally {
    clearTimeout(timer);
    jobs.delete(id);
    if (chrome) {
      chromePids.delete(chrome.pid);
      try {
        chrome.kill();
      } catch {
        /* already gone */
      }
    }
  }
}

// Draw one image; resolves to its record in the image library, or throws.
//   { type: "ascii", fmt: "png"|"gif"|"mp4", icon, color, aspect, title, kicker, body, side, draftId }
//   { type: "photo-card", photoUrl, look, spot, textSize, size, eyebrow, headline, subline, logo, credit, sourceUrl, draftId }
export function renderImage(job) {
  const run = queue.then(() => runOne(job));
  queue = run.catch(() => {});
  return run;
}
