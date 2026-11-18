// The Librarian — a standalone maintenance agent for the wiki (Second Brain).
//
// Promoted out of the Worker (it used to be one curate() call every 6th Worker
// tick, i.e. a single merge-or-link per hour, and ONLY while the Worker was on —
// Worker off (the default) meant no curation at all). Now it runs on its own
// schedule regardless of the Worker, and does a batch of work per pass:
//   1. curate() repeatedly — merge near-duplicate pages / link an orphan —
//      until the wiki reports "tidy" or the per-run cap is hit,
//   2. crosslinkOrphans() — pull remaining orphans into the [[link]] graph
//      (embeddings only, no model call, fast),
//   3. lint() — health-check the wiki and keep the latest report on state
//      so the UI can show it.
//
// It NEVER writes content, drafts, or posts — wiki maintenance only. Model
// calls happen only inside curate()'s merge step (tier "quality", so the big
// model does the judgement work when one is configured). If Ollama is down,
// curate/lint degrade gracefully and the pass records what it could do.

import { curate, crosslinkOrphans, lint, wikiSignature } from "./wiki.js";
import { addActivity, getLibrarianState, setLibrarianState } from "./stores.js";

const CADENCE_MS = 3 * 3600000; // every 3 hours — 6h couldn't keep up once the ingest leak was fixed and inflow jumped
const FIRST_RUN_DELAY_MS = 10 * 60000; // 10 min after boot (let the box settle)
const CURATE_CAP = 15; // max merge/link actions per pass — bounded work, no marathons

const now = () => new Date().toISOString();

let timer = null;

// `force` (the "Tidy now" button) skips the unchanged-wiki shortcut: a person who
// presses the button expects a pass, not "everything was already tidy".
export async function runLibrarian(nowISO = now(), { force = false } = {}) {
  const state = getLibrarianState();
  if (state.running) return { skipped: "already-running" };
  // Nothing changed since the last pass? Skip the whole thing — a no-op pass
  // still costs embeddings plus a lint model call, 8x a day on an idle box
  // (exactly the by-the-second server waste Tobias wants gone).
  const sig = wikiSignature();
  if (!force && sig && sig === state.lastWikiSig) {
    setLibrarianState({ lastRunAt: nowISO, lastResult: { skipped: "wiki unchanged" } });
    return { skipped: "wiki-unchanged" };
  }
  setLibrarianState({ running: true });

  const result = { merged: 0, linked: 0, orphansLinked: 0, lintIssues: null, errors: 0 };
  try {
    // 1: batch curation — keep going until the wiki says "tidy" or we hit the cap.
    // One `seen` Set for the whole pass: curate() marks each page it merges or
    // declines so no page is touched twice (no chain merges).
    const seen = new Set();
    for (let i = 0; i < CURATE_CAP; i++) {
      let c;
      try {
        c = await curate(nowISO, seen);
      } catch (err) {
        result.errors++;
        console.error("librarian: curate failed:", err.message);
        break;
      }
      if (c.action === "merged") {
        result.merged++;
        addActivity({ actor: "librarian", event: "wiki.curated", summary: `merged: ${c.detail}` }, nowISO);
      } else if (c.action === "linked") {
        result.linked++;
        addActivity({ actor: "librarian", event: "wiki.curated", summary: `linked: ${c.detail}` }, nowISO);
      } else {
        if (c.action === "error") {
          result.errors++;
          // Surface refused merges on the Second Brain screen, not only in the log.
          addActivity({ actor: "librarian", event: "wiki.merge.refused", summary: c.detail || "merge refused" }, nowISO);
        }
        break; // "none" (tidy) or error — stop the pass
      }
    }

    // 2: sweep remaining orphans into the graph (no model call).
    try {
      const o = await crosslinkOrphans({ nowISO, max: 50 });
      result.orphansLinked = o.linked || 0;
      if (o.linked) {
        addActivity({ actor: "librarian", event: "wiki.crosslinked", summary: `linked ${o.linked} orphan note${o.linked === 1 ? "" : "s"}` }, nowISO);
      }
    } catch (err) {
      result.errors++;
      console.error("librarian: crosslink failed:", err.message);
    }

    // 3: health report — kept on state for the Second Brain screen.
    try {
      const l = await lint({ nowISO });
      result.lintIssues = (l.orphans?.length || 0) + (l.stale?.length || 0) + (l.contradictions?.length || 0);
    } catch {
      /* lint is best-effort; the pass still counts */
    }

    setLibrarianState({
      running: false,
      lastRunAt: nowISO,
      lastResult: result,
      runCount: (getLibrarianState().runCount || 0) + 1,
      // Fingerprint AFTER a CLEAN pass only (the pass itself changes pages) so the
      // next scheduled run can skip if nothing else touched the wiki. If the pass
      // had errors (e.g. a model timeout), leave lastWikiSig untouched so the next
      // run retries instead of marking a failed pass "done" and skipping forever.
      ...(result.errors === 0 ? { lastWikiSig: wikiSignature() } : {}),
    });
    const did = result.merged + result.linked + result.orphansLinked;
    addActivity(
      {
        actor: "librarian",
        event: result.errors ? "librarian.run.errors" : "librarian.run.end",
        summary:
          did || result.errors
            ? `merged ${result.merged}, linked ${result.linked}, orphans ${result.orphansLinked}` +
              (result.errors ? `, ERRORS ${result.errors}` : "")
            : "wiki already tidy",
      },
      nowISO
    );
  } catch (err) {
    setLibrarianState({ running: false, lastRunAt: nowISO, lastResult: { ...result, crashed: err.message } });
    addActivity({ actor: "librarian", event: "librarian.error", summary: err.message }, nowISO);
  }
  return result;
}

function scheduleNext(delay) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (getLibrarianState().enabled !== false) {
      try {
        await runLibrarian();
      } catch (err) {
        console.error("librarian: run failed:", err.message);
      }
    }
    scheduleNext(CADENCE_MS);
  }, delay);
  timer.unref?.(); // never keep the process alive just for the librarian
}

export function startLibrarian() {
  // A crash mid-run must not wedge the flag forever.
  if (getLibrarianState().running) setLibrarianState({ running: false });
  scheduleNext(FIRST_RUN_DELAY_MS);
}

export function stopLibrarian() {
  clearTimeout(timer);
  timer = null;
}
