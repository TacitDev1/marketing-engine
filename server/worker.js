// The in-app Worker — the free, continuous half of Autopilot. On a cadence it:
//   1. sifts new research findings (classifies each with the local model),
//   2. curates the wiki (ingests anything not yet ingested),
//   3. drafts a CAPPED amount of content into the Library,
//   4. writes improvement recommendations across marketing fronts,
//   5. generates the NEXT research topics and enqueues them for the Researcher.
//
// It never posts and never touches the parked company-website. All state is in JSON
// (data/), so it is restart-safe. Model calls are the local 8B via brain.js.

import { chatJSON, clean, generateDraft, generateBlog, generateFromUrl, isBrainAvailable } from "./brain.js";
import { detectClientSuccess, isClientSuccessGrounded, findFabricatedClientClaims, detectSlop } from "./guardrails.js";
import { ingestText, relevantPages, listPages } from "./wiki.js";
import { getKeywords } from "./knowledge.js";
import { fetchNews } from "./tools/web.js";
import { saveDraft, listDrafts } from "./drafts.js";
import { findNearDuplicate } from "./draft-dedupe.js";
import { jaccard } from "./similarity.js";
import { services, postTypes } from "../src/lib/company.js";
import { ALL_FRONTS, SEED_TOPICS, NEWS_QUERIES } from "./seeds.js";
import {
  addActivity,
  getWorkerState,
  setWorkerState,
  getAutopilot,
  setAutopilot,
  addFinding,
  unprocessedFindings,
  updateFinding,
  addRecommendation,
  enqueueTopic,
  listQueue,
  listDirectives,
  tasteSummary,
  listCompetitors,
  load,
} from "./stores.js";

// Open build/avoid directives the Researcher gave the Worker, as prompt lines.
// HARD BUDGET: the store caps open directives, but the prompt must stay small
// regardless of store state — an unbounded block here overflowed numCtx (8192)
// on 2026-07-10 and every model call returned truncated JSON. Newest first,
// a few per kind, each clipped, whole block capped.
const DIR_PROMPT_PER_KIND = 10;
const DIR_PROMPT_TEXT_CHARS = 240;
const DIR_PROMPT_BLOCK_CHARS = 4000;
// The three prompt blocks below are rebuilt from full store reads for EVERY
// finding classified — six times per tick over data that changes rarely. A
// 60s memo keeps them fresh across ticks while cutting the hot-loop file I/O.
const _blockMemo = new Map();
function memo60(key, build) {
  const hit = _blockMemo.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  const v = build();
  _blockMemo.set(key, { at: Date.now(), v });
  return v;
}

function directiveLines() {
  return memo60("directives", buildDirectiveLines);
}
function buildDirectiveLines() {
  const dirs = listDirectives({ status: "open" }); // already newest first
  if (!dirs.length) return "";
  const pick = (kind) =>
    dirs
      .filter((d) => d.kind === kind)
      .slice(0, DIR_PROMPT_PER_KIND)
      .map((d) => d.text.slice(0, DIR_PROMPT_TEXT_CHARS));
  const build = pick("build");
  const avoid = pick("avoid");
  return [
    build.length ? `BUILD priorities (from the researcher, newest first): ${build.join("; ")}` : "",
    avoid.length ? `AVOID (from the researcher, newest first): ${avoid.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, DIR_PROMPT_BLOCK_CHARS);
}

// What Tobias actually keeps vs kills in the Library, as a small prompt block.
// Same hard-budget discipline as directiveLines — this must never blow numCtx.
function tasteLines() {
  return memo60("taste", buildTasteLines);
}
function buildTasteLines() {
  try {
    const t = tasteSummary(3);
    const fmt = (rows, label) =>
      rows.length
        ? `${label}: ${rows
            .sort((a, b) => b.keep + b.kill - (a.keep + a.kill))
            .slice(0, 6)
            .map((r) => `${r.key} (kept ${r.keep}, killed ${r.kill})`)
            .join("; ")}`
        : "";
    const pt = fmt(t.postTypes, "THE TEAM'S TRACK RECORD by post type");
    const svc = fmt(t.services, "by service");
    if (!pt && !svc) return "";
    return `${[pt, svc].filter(Boolean).join(" | ")}. Favour what gets kept; avoid repeating what gets killed.`.slice(0, 700);
  } catch {
    return "";
  }
}

// Competitor gaps (from the Researcher's structured profiles) as a prompt block.
// Only the gap fields — that's the actionable part for content decisions.
function competitorLines() {
  return memo60("competitors", buildCompetitorLines);
}
function buildCompetitorLines() {
  try {
    const comps = listCompetitors().slice(0, 5);
    const withGaps = comps.filter((c) => (c.gaps || []).length);
    if (!withGaps.length) return "";
    return `COMPETITOR GAPS (where Larkwell can win): ${withGaps
      .map((c) => `${c.name}: ${c.gaps.slice(0, 3).join("; ")}`)
      .join(" | ")}`.slice(0, 900);
  } catch {
    return "";
  }
}

const BATCH = 6; // findings sifted per tick
const TOPIC_CAP = 5; // new topics per tick — the optimised Researcher clears ~20-30/h, 3/tick starved it
const NEWS_PER_TICK = 3; // fresh news findings the Worker researches per tick
const serviceIds = new Set(services.map((s) => s.id));
const now = () => new Date().toISOString();

// ---------- content variety: spread drafts across all services + post types ----------
// The local 8B, left to run, defaults to the loudest SAP story (S/4HANA + the 2027
// deadline) and rewrites it endlessly, so the Library becomes a migration monoculture.
// These helpers force fresh topics: refuse a draft too similar to recent ones, and
// rotate the service + post type toward whatever is under-covered.

const VARIETY_WINDOW = 30; // recent autopilot drafts we measure coverage over
const DUP_THRESHOLD = 0.4; // topic-overlap (Jaccard) above which a finding is a near-duplicate
const SVC_OVER = 3; // a service seen this many times recently counts as over-covered
// Generic/brand words that appear in almost every draft — they must not drive the
// similarity signature (but SAP topic words like "migration"/"4hana" MUST stay, so
// migration reruns are detected as duplicates).
const SIG_STOP = new Set(
  "the a an and or but to of in for with your you our we is are be on at as it its how what why that this from into can will would should could help helps helping guide global sap larkwell has have get more most when where who".split(
    " "
  )
);

function sigOf(text) {
  const words = String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !SIG_STOP.has(w));
  return new Set(words.slice(0, 14));
}

// Coverage over recent autopilot drafts: counts per service + post type, plus the
// topic signatures we test new findings against.
function recentCoverage() {
  const recent = listDrafts()
    // A draft a reviewer marked "To delete" doesn't count as coverage.
    .filter((d) => (d.payload || {}).origin === "autopilot" && d.status !== "delete")
    .slice(0, VARIETY_WINDOW);
  const svc = {};
  const pt = {};
  const sigs = [];
  for (const d of recent) {
    const p = d.payload || {};
    if (p.serviceId) svc[p.serviceId] = (svc[p.serviceId] || 0) + 1;
    if (p.postType) pt[p.postType] = (pt[p.postType] || 0) + 1;
    sigs.push(sigOf(`${p.title || p.hook || ""} ${p.keyword || ""}`));
  }
  return { svc, pt, sigs };
}

// Least-covered id, ties broken by a rotating cursor so we cycle through everything.
function leastCovered(counts, ids, cursor) {
  const min = Math.min(...ids.map((id) => counts[id] || 0));
  const pool = ids.filter((id) => (counts[id] || 0) === min);
  return pool[cursor % pool.length];
}

// Post types the AUTOPILOT is allowed to write. "case-study" is deliberately excluded:
// a real case study needs a real, verified client win, and the 8B only ever fabricates
// them. Client stories come from Tobias via manual generation, never the autopilot.
// (Products are anchors, not post types, and the autopilot only ever anchors on
// services: product claims need a human eye.)
const AUTOPILOT_POST_TYPES = postTypes.filter((p) => p.id !== "case-study").map((p) => p.id);

// Decide the service + post type + whether this finding is a near-duplicate of recent
// output. On a duplicate (or a missing/over-covered service) we pivot to an
// under-covered service so the Library spreads across Larkwell's full catalogue.
function chooseVariety(route, f, cov, cursor) {
  const allSvc = services.map((s) => s.id);
  const allPt = AUTOPILOT_POST_TYPES;
  const findingSig = sigOf(`${f.title} ${route.nudge} ${route.keyword}`);
  const dup = cov.sigs.some((s) => jaccard(findingSig, s) >= DUP_THRESHOLD);

  let serviceId = route.serviceId;
  const overCoveredSvc = serviceId && (cov.svc[serviceId] || 0) >= SVC_OVER;
  if (dup || !serviceId || overCoveredSvc) serviceId = leastCovered(cov.svc, allSvc, cursor);

  let postType = route.postType;
  const ptCap = Math.ceil(VARIETY_WINDOW / allPt.length) + 1;
  const overCoveredPt = postType && (cov.pt[postType] || 0) >= ptCap;
  const bannedPt = !allPt.includes(postType); // e.g. classifier picked "case-study"
  if (dup || !postType || overCoveredPt || bannedPt) postType = leastCovered(cov.pt, allPt, cursor);

  return { serviceId, postType, dup };
}

let timer = null;

// ---------- scheduling ----------

export function startWorker() {
  const nowISO = now();
  plantSeedsOnce(nowISO);
  // Reset a stale running flag left by a crash mid-tick.
  if (getWorkerState().running) setWorkerState({ running: false });
  // OFF by default at every boot (Tobias, 2026-07-12): the engine should only
  // draft when he has deliberately switched it on in Jarvis THIS session — a
  // launch must never silently resume the firehose from a previous one.
  if (getAutopilot().workerEnabled) {
    setAutopilot({ workerEnabled: false }, nowISO);
    addActivity(
      { actor: "system", event: "autopilot.off", summary: "engine starts OFF by default — switch it on in Jarvis when you want it drafting" },
      nowISO
    );
  }
  scheduleNext();
  console.log("Autopilot worker armed but OFF (enable it from the Jarvis screen).");
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function rescheduleWorker() {
  stopWorker();
  scheduleNext();
}

function scheduleNext() {
  const { cadenceMs } = getAutopilot();
  timer = setInterval(tickGuarded, Math.max(60000, Number(cadenceMs) || 600000));
}

// Active hours: is `date` inside the configured window (in the window's own
// time zone)? Always true when the feature is off or misconfigured, so a bad
// setting can never silently stop drafting.
export function withinActiveHours(ap, date = new Date()) {
  const ah = ap?.activeHours;
  if (!ah || !ah.enabled) return true;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: ah.tz || "UTC", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.find((p) => p.type === "weekday")?.value];
    const days = Array.isArray(ah.days) && ah.days.length ? ah.days : [1, 2, 3, 4, 5];
    if (!days.includes(wd)) return false;
    const start = Number.isFinite(Number(ah.start)) ? Number(ah.start) : 7;
    const end = Number.isFinite(Number(ah.end)) ? Number(ah.end) : 19;
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
  } catch {
    return true;
  }
}

// Fires on the interval; respects the on/off switch without needing a restart.
// Log "paused" once per pause, not every 10 minutes — with OFF as the default
// state a per-tick entry would flood the capped activity feed.
let pausedLogged = false;
let topicSkipLogged = ""; // last topic-generation skip reason already logged (reset when generation resumes)
let idleLogged = false;
async function tickGuarded() {
  // Everything inside the try: even getAutopilot/addActivity do file I/O, and a
  // throw BEFORE the try (disk full) would reject with no awaiter — which on
  // modern Node terminates the whole process.
  try {
    const ap = getAutopilot();
    if (!ap.workerEnabled) {
      if (!pausedLogged) {
        addActivity({ actor: "worker", event: "worker.skipped", summary: "paused (autopilot off)" }, now());
        pausedLogged = true;
      }
      return;
    }
    pausedLogged = false;
    if (!withinActiveHours(ap)) {
      if (!idleLogged) {
        const ah = ap.activeHours;
        addActivity({ actor: "worker", event: "worker.idle", summary: `idle: outside active hours (${ah.start}:00-${ah.end}:00 ${ah.tz}); no model calls until then` }, now());
        idleLogged = true;
      }
      return;
    }
    idleLogged = false;
    // Ollama down? Skip the whole tick instead of failing every finding — three
    // failed ticks during one outage used to burn findings' 3-strike retry
    // budget on infrastructure errors and abandon them forever.
    if (!(await isBrainAvailable())) {
      addActivity({ actor: "worker", event: "worker.skipped", summary: "skipped: the local model isn't reachable (findings keep their retries)" }, now());
      return;
    }
    await runTick();
  } catch (err) {
    console.error("worker tick error:", err.message);
  }
}

function plantSeedsOnce(nowISO) {
  const state = getWorkerState();
  if (state.seedsPlanted) return;
  let n = 0;
  for (const s of SEED_TOPICS) {
    if (enqueueTopic({ ...s, rationale: "seed", createdBy: "seed" }, nowISO)) n++;
  }
  setWorkerState({ seedsPlanted: true });
  addActivity({ actor: "system", event: "topic.enqueued", summary: `planted ${n} seed topics` }, nowISO);
}

// ---------- one tick ----------

export async function runTick(nowISO = now()) {
  const state = getWorkerState();
  if (state.running) return { skipped: "already-running" };
  setWorkerState({ running: true });
  // A failed activity write must not leave "running" stuck on (every later tick
  // would skip until a restart).
  try {
    addActivity({ actor: "worker", event: "worker.tick.start", summary: "tick started" }, nowISO);
  } catch (err) {
    setWorkerState({ running: false });
    throw err;
  }

  const result = { researched: 0, sifted: 0, drafts: 0, recs: 0, topics: 0, errors: 0 };
  // TIME BUDGET: a tick must finish well inside its own interval. Without this a
  // slow model turned "10-minute cadence" into continuous GPU load (each finding
  // can take minutes). Whatever is left waits for the next tick — nothing is lost.
  const tickStart = Date.now();
  const tickBudgetMs = Math.max(5 * 60000, 0.8 * (Number(getAutopilot().cadenceMs) || 600000));
  const overBudget = () => Date.now() - tickStart > tickBudgetMs;
  try {
    const ap = getAutopilot();
    const today = nowISO.slice(0, 10);
    let draftsToday = state.draftsToday;
    if (draftsToday.date !== today) draftsToday = { date: today, count: 0 };
    // GENERATION BUDGET: dailyDraftCap counts SAVED drafts, but a rejected draft
    // still cost 1-3 generator runs (a blog run is ~11 model calls). Cap the
    // number of generator RUNS per day at 3x the draft cap so a slop-prone day
    // can't burn unbounded GPU time on drafts that never land.
    genToday = state.genToday && state.genToday.date === today ? { ...state.genToday } : { date: today, count: 0 };
    genBudget = Math.max(0, Number(ap.dailyDraftCap) || 0) * 3;
    const seenDraftKeys = new Set(state.seenDraftKeys || []);

    // 0: research the web for free (Google News) — Autopilot's own researcher.
    result.researched = await researchNews(nowISO);

    // 1-4: sift each new finding.
    for (const f of unprocessedFindings(BATCH)) {
      if (overBudget()) {
        addActivity({ actor: "worker", event: "worker.tick.budget", summary: `stopped early: tick time budget (${Math.round(tickBudgetMs / 60000)} min) reached; the rest waits for the next tick` }, nowISO);
        break;
      }
      try {
        // curate wiki: ingest anything that wasn't ingested at submit time.
        if (!f.ingestedToWiki?.length && f.summary) {
          try {
            const { written, skipped } = await ingestText({
              text: `${f.title}\n${f.summary}\n${(f.sources || []).join("\n")}`,
              sourceLabel: `research: ${f.front}`,
              nowISO,
            });
            updateFinding(f.id, { ingestedToWiki: written.map((w) => w.slug) });
            if (skipped?.length) {
              // An update the wiki REFUSED (would have lost content) — visible, not silent.
              addActivity(
                { actor: "worker", event: "wiki.ingest.kept", summary: `kept ${skipped.length} page(s) intact instead of a lossy rewrite: ${skipped.map((s) => s.title).join(", ").slice(0, 120)}`, ref: { findingId: f.id } },
                nowISO
              );
            }
          } catch (err) {
            // Best-effort, but never SILENT — a finding whose knowledge missed
            // the wiki must be visible in the activity stream.
            addActivity({ actor: "worker", event: "wiki.ingest.failed", summary: `${String(f.title).slice(0, 60)} — ${String(err.message).slice(0, 80)}`, ref: { findingId: f.id } }, nowISO);
          }
        }

        const route = await classifyFinding(f);
        result.sifted++;

        const canDraft = route.action.startsWith("draft") && draftsToday.count < ap.dailyDraftCap;
        if (canDraft) {
          const key = `${route.action}|${route.serviceId || ""}|${f.hash}`;
          if (!seenDraftKeys.has(key)) {
            const made = await draftFromFinding(f, route, nowISO);
            if (made) {
              result.drafts++;
              draftsToday.count++;
              seenDraftKeys.add(key);
              addActivity(
                { actor: "worker", event: "draft.created", summary: `drafted: ${made.label}`, ref: { libraryId: made.libraryId, findingId: f.id } },
                nowISO
              );
            }
          }
        } else {
          // recommendation path (also the fallback when the draft cap is hit)
          const rec = await recommendFromFinding(f, route, nowISO);
          if (rec) {
            result.recs++;
            addActivity({ actor: "worker", event: "rec.created", summary: rec.title, ref: { recId: rec.id, findingId: f.id } }, nowISO);
          }
        }

        updateFinding(f.id, { processed: true, processedAt: nowISO });
      } catch (err) {
        // The model went away MID-tick (Ollama restart, OOM, instance stopping):
        // that is an infrastructure failure, not the finding's fault. Stop the
        // tick without burning the finding's retry budget; the next tick's
        // availability check decides whether to resume.
        if (/ECONNREFUSED|ECONNRESET|fetch failed|ETIMEDOUT|socket hang up|aborted|timeout/i.test(String(err?.message)) && !(await isBrainAvailable())) {
          addActivity({ actor: "worker", event: "worker.skipped", summary: `model became unreachable mid-tick (${String(err.message).slice(0, 60)}); stopping, findings keep their retries` }, nowISO);
          result.errors++;
          break;
        }
        const attempts = (f.attempts || 0) + 1;
        updateFinding(f.id, { attempts, lastError: err.message });
        result.errors++;
        console.error(`worker: finding ${f.id} failed:`, err.message);
        // Third strike = the retry filter drops it forever; say so out loud
        // instead of letting it vanish (54 findings died silently on 2026-07-10).
        if (attempts >= 3) {
          addActivity(
            { actor: "worker", event: "finding.abandoned", summary: `gave up after 3 attempts: ${f.title} (${err.message})`, ref: { findingId: f.id } },
            nowISO
          );
        }
      }
    }

    // (Wiki curation moved to the standalone Librarian agent — server/librarian.js.
    // It runs on its own schedule, so the wiki stays tidy even with the Worker off.)
    const tickCount = (state.tickCount || 0) + 1;

    // 5: generate the next research topics for the Researcher — but only when
    // someone will consume them. With the queue full, or the Researcher not
    // seen for 24h, a topics model call just churns the queue (new in, oldest
    // staled, net zero) — pure wasted compute, forever, on the server.
    const queuedNow = listQueue({ status: "queued" }).length;
    const researcherSeen = ap.researcherLastSeenAt ? Date.parse(ap.researcherLastSeenAt) : 0;
    const researcherRecent = Date.now() - researcherSeen < 24 * 3600000;
    if (queuedNow >= 45 || !researcherRecent) {
      // Log the reason once, not once per tick (197 identical lines drowned the feed).
      const why = queuedNow >= 45 ? "topic generation skipped: queue is full" : "topic generation skipped: researcher hasn't run in 24h";
      if (topicSkipLogged !== why) {
        topicSkipLogged = why;
        addActivity({ actor: "worker", event: "worker.skipped", summary: `${why} (logged once; the Jarvis Queue tab explains how to restart it)` }, nowISO);
      }
    } else
    try {
      topicSkipLogged = "";
      for (const t of await generateTopics(nowISO)) {
        if (enqueueTopic({ ...t, createdBy: "worker" }, nowISO)) {
          result.topics++;
          addActivity({ actor: "worker", event: "topic.enqueued", summary: t.topic }, nowISO);
        }
      }
    } catch (err) {
      console.error("worker: topic generation failed:", err.message);
    }

    setWorkerState({
      lastRunAt: nowISO,
      lastResult: result,
      draftsToday,
      tickCount,
      seenDraftKeys: [...seenDraftKeys].slice(-300),
      running: false,
    });
    addActivity(
      {
        actor: "worker",
        event: result.errors ? "worker.tick.errors" : "worker.tick.end",
        summary:
          `researched ${result.researched}, sifted ${result.sifted}, drafts ${result.drafts}, recs ${result.recs}, topics ${result.topics}` +
          (result.errors ? `, ERRORS ${result.errors}` : ""),
      },
      nowISO
    );
  } catch (err) {
    // Persist what this tick actually did — a mid-tick crash must not leave the
    // previous tick's result showing as current in the status endpoint, and the
    // drafts already made this tick must still count toward the daily cap.
    const st = getWorkerState();
    const today = nowISO.slice(0, 10);
    const madeThisTick = result.drafts || 0;
    const draftsToday =
      st.draftsToday?.date === today
        ? { date: today, count: (st.draftsToday.count || 0) + madeThisTick }
        : { date: today, count: madeThisTick };
    setWorkerState({ running: false, lastRunAt: nowISO, lastResult: { ...result, crashed: err.message }, draftsToday });
    addActivity({ actor: "worker", event: "worker.error", summary: err.message }, nowISO);
  }
  return result;
}

// ---------- the Worker's own web research (free, no model, no API key) ----------

// Pull fresh SAP news via Google News RSS (one rotating query per tick) and turn
// new headlines into findings the sift step then drafts/recommends from.
async function researchNews(nowISO) {
  const st = getWorkerState();
  const cursor = st.newsCursor || 0;
  // Alternate: even ticks use the static query list, odd ticks query the news
  // for whichever Larkwell service the Library covers LEAST. The static list skews
  // S/4HANA-migration, which is exactly the over-coverage the variety guard
  // fights downstream — this diversifies the pipeline at the source instead.
  let pick;
  if (cursor % 2 === 1) {
    const svcCounts = recentCoverage().svc;
    const thinId = leastCovered(svcCounts, services.map((s) => s.id), cursor);
    const svc = services.find((s) => s.id === thinId);
    pick = { q: `SAP ${svc?.label || "consulting"}`, front: ["content-seo", "social", "messaging"][cursor % 3] };
  } else {
    pick = NEWS_QUERIES[(cursor / 2) % NEWS_QUERIES.length];
  }
  setWorkerState({ newsCursor: cursor + 1 });

  let made = 0;
  try {
    const items = await fetchNews(pick.q, 6);
    for (const it of items) {
      if (made >= NEWS_PER_TICK) break;
      const { record, duplicate } = addFinding(
        {
          front: pick.front,
          title: it.title,
          summary: `SAP news${it.sourceName ? ` (${it.sourceName})` : ""}: ${it.title}. A current item worth a Larkwell angle.`,
          url: it.sourceUrl || it.link,
          sources: [it.sourceUrl || it.link].filter(Boolean),
          kind: "web",
        },
        nowISO
      );
      if (!duplicate) {
        made++;
        addActivity({ actor: "worker", event: "finding.submitted", summary: `news: ${it.title}`, ref: { findingId: record.id } }, nowISO);
      }
    }
  } catch (err) {
    console.error("worker: news research failed:", err.message);
  }
  return made;
}

// ---------- model steps (all forced-JSON, all try/caught by caller) ----------

const CLASSIFY_FORMAT = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["draft-linkedin", "draft-blog", "draft-reaction", "recommendation", "wiki-only"] },
    postType: { type: "string", enum: ["case-study", "hot-take", "how-to", "founder"] },
    serviceId: { type: "string" },
    keyword: { type: "string" },
    nudge: { type: "string" },
    recTitle: { type: "string" },
    recDetail: { type: "string" },
    effort: { type: "string", enum: ["small", "medium", "large"] },
  },
  required: ["action"],
};

async function classifyFinding(f) {
  const system = [
    "You route a marketing research finding for Larkwell Consulting (SAP consulting + cloud).",
    "Decide the single best action and fill ONLY the relevant fields:",
    "- draft-linkedin: set postType + serviceId + a short nudge (the angle).",
    "- draft-blog: set keyword + serviceId + nudge.",
    "- draft-reaction: a reaction to the finding's source URL (set nudge).",
    "- recommendation: set recTitle, recDetail (1-3 sentences), effort.",
    "- wiki-only: ONLY if there is truly nothing worth drafting.",
    "DEFAULT TO BUILDING: prefer a draft (draft-linkedin, draft-blog, or draft-reaction)",
    "whenever the finding could plausibly become content. Use recommendation mainly for",
    "purely backend/technical fronts (technical-seo, schema, performance, site-health,",
    "analytics). Avoid wiki-only unless the finding is not content-worthy at all.",
    "Return ONLY JSON.",
  ].join("\n");
  const user = [
    `FRONT: ${f.front}`,
    `FINDING: ${f.title}`,
    f.summary,
    f.url ? `SOURCE: ${f.url}` : "",
    "",
    directiveLines(),
    tasteLines(),
    competitorLines(),
    `Service ids: ${services.map((s) => s.id).join(", ")}`,
    "Decide now as JSON (honour the BUILD/AVOID directives above).",
  ]
    .filter(Boolean)
    .join("\n");

  const out = await chatJSON(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    CLASSIFY_FORMAT,
    { numPredict: 400 }
  );
  return {
    action: out.action || "recommendation",
    postType: postTypes.find((p) => p.id === out.postType)?.id || "hot-take",
    serviceId: serviceIds.has(out.serviceId) ? out.serviceId : "",
    keyword: clean(out.keyword || "").replace(/\s*\([^)]*\)\s*$/, ""),
    nudge: clean(out.nudge || ""),
    recTitle: clean(out.recTitle || ""),
    recDetail: clean(out.recDetail || ""),
    effort: out.effort || "medium",
  };
}

// Build a draft via the proven generators and file it to the Library. Applies the
// variety guard so the Library spreads across Larkwell's services + post types instead of
// re-running the S/4HANA-migration story.
// Per-day generator-run budget (set by runTick; see GENERATION BUDGET there).
let genToday = { date: "", count: 0 };
let genBudget = Infinity;
function spendGeneration(nowISO) {
  if (genToday.count >= genBudget) return false;
  genToday.count++;
  setWorkerState({ genToday });
  return true;
}

async function draftFromFinding(f, route, nowISO) {
  if (!spendGeneration(nowISO)) {
    addActivity({ actor: "worker", event: "draft.budget", summary: `daily generation budget reached (${genBudget} runs); no more drafting today` }, nowISO);
    return null;
  }
  const cov = recentCoverage();
  const cursor = getWorkerState().varietyCursor || 0;
  const variety = chooseVariety(route, f, cov, cursor);
  // Advance the rotation so ties cycle through the whole catalogue next time.
  setWorkerState({ varietyCursor: cursor + 1 });

  const svcName = services.find((s) => s.id === variety.serviceId)?.label || variety.serviceId;
  let kind = "linkedin";
  let payload;
  let label;

  // Only react to a directly-fetchable article URL (news findings carry a
  // publisher homepage or a Google redirect, which won't read as an article).
  const fetchable = f.url && !/news\.google\.com/.test(f.url) && /^https?:\/\/[^/]+\/.+/.test(f.url);

  if (route.action === "draft-blog" && route.keyword && !variety.dup) {
    kind = "blog";
    payload = await generateBlog({ keyword: route.keyword, serviceId: variety.serviceId || undefined, nudge: route.nudge || `informed by: ${f.title}` });
    label = `Blog: ${route.keyword}`;
  } else if (route.action === "draft-reaction" && fetchable && !variety.dup) {
    payload = await generateFromUrl({ urls: [f.url], nudge: route.nudge || `informed by: ${f.title}` });
    label = `Reaction: ${f.front}`;
  } else {
    // LinkedIn post. On a near-duplicate finding, pivot to the under-covered service
    // and steer the model off the over-covered migration/deadline angle.
    const nudge = variety.dup
      ? `Write specifically about Larkwell's "${svcName}" service. Do NOT centre this on the 2027 ECC deadline or S/4HANA migration timing — that angle is already over-covered. Find a fresh, distinct angle for this service.`
      : route.nudge || `informed by: ${f.title}`;
    payload = await generateDraft({ type: variety.postType, serviceId: variety.serviceId || undefined, nudge });
    label = `${variety.postType} post (${variety.serviceId || "any"})${variety.dup ? " [variety pivot]" : ""}`;
  }
  if (!payload || (!payload.hook && !payload.title)) return null;

  // HARD RULE: never let the autopilot publish a fabricated client story. If the draft
  // tells a client-success/outcome story that isn't grounded in a verified Larkwell win,
  // regenerate once with an explicit no-client-stories steer; if it still fabricates,
  // drop the draft entirely (better an empty tick than an invented client win).
  const fabricates = (pl) => {
    const text = `${pl.title || ""}\n${pl.hook || ""}\n${pl.body || ""}`;
    // A NAMED invented client is fabrication no matter what else the text says —
    // "we helped Brackenfield Waste… we also guided Northwind" must not ride in on the real win.
    if (findFabricatedClientClaims(text).length > 0) return true;
    return detectClientSuccess(text).length > 0 && !isClientSuccessGrounded(text);
  };
  if (fabricates(payload)) {
    if (!spendGeneration(nowISO)) {
      addActivity({ actor: "worker", event: "draft.rejected", summary: `dropped a fabricated client story (${variety.serviceId || f.front}); no budget left to regenerate` }, nowISO);
      return null;
    }
    const strictNudge = `Write about Larkwell's "${svcName}" service in GENERAL terms only. Do NOT describe or imply any client, customer, or client outcome — no "a client", "our client", "a leading manufacturer", no success stories. Focus on the problem and Larkwell's capability.`;
    if (kind === "blog" && route.keyword) {
      payload = await generateBlog({ keyword: route.keyword, serviceId: variety.serviceId || undefined, nudge: strictNudge });
    } else {
      kind = "linkedin";
      payload = await generateDraft({ type: variety.postType, serviceId: variety.serviceId || undefined, nudge: strictNudge });
    }
    if (!payload || (!payload.hook && !payload.title) || fabricates(payload)) {
      addActivity({ actor: "worker", event: "draft.rejected", summary: `dropped a fabricated client story (${variety.serviceId || f.front})`, ref: { findingId: f.id } }, nowISO);
      return null;
    }
  }

  // #1 CONTENT RULE: no AI-slop. If the draft reads like generic AI writing,
  // regenerate once with a hard anti-slop steer; if it STILL reads as slop, drop
  // it (fewer, better — an empty tick beats shipping slop).
  const isSlop = (pl) => detectSlop(`${pl.title || ""}\n${pl.hook || ""}\n${pl.body || ""}`).isSlop;
  if (isSlop(payload)) {
    if (!spendGeneration(nowISO)) {
      addActivity({ actor: "worker", event: "draft.rejected", summary: `dropped an AI-slop draft (${variety.serviceId || f.front}); no budget left to regenerate` }, nowISO);
      return null;
    }
    const antiSlop = `Rewrite with ZERO AI-slop. NEVER use: leverage, robust, seamless, cutting-edge, game-changer, unlock, elevate, empower, streamline, delve, "in today's landscape", "when it comes to", "it's important to note", "in conclusion", moreover, furthermore, "not just X but Y", or a rhetorical-question opener. Be concrete about Larkwell's "${svcName}" service: name the actual SAP thing, take one clear stance, and cut any sentence that could apply to any company. Short, plain, confident sentences.`;
    if (kind === "blog" && route.keyword) {
      payload = await generateBlog({ keyword: route.keyword, serviceId: variety.serviceId || undefined, nudge: antiSlop });
    } else {
      kind = "linkedin";
      payload = await generateDraft({ type: variety.postType, serviceId: variety.serviceId || undefined, nudge: antiSlop });
    }
    if (!payload || (!payload.hook && !payload.title) || isSlop(payload)) {
      addActivity({ actor: "worker", event: "draft.rejected", summary: `dropped an AI-slop draft (${variety.serviceId || f.front})`, ref: { findingId: f.id } }, nowISO);
      return null;
    }
  }

  payload.origin = "autopilot";
  payload.findingId = f.id;
  payload.front = f.front;
  payload.serviceId = variety.serviceId || route.serviceId || "";
  // Reaction posts are their OWN style — labelling them with the variety pick
  // (e.g. "hot-take") would credit the wrong style in the taste feedback loop.
  payload.postType = kind === "blog" ? undefined : route.action === "draft-reaction" ? "reaction" : variety.postType;

  // Last gate: the same post reworded is still a duplicate. Compare by meaning with
  // the whole Library (not just the recent window) and drop it rather than file it.
  try {
    const dup = await findNearDuplicate({ kind, payload }, listDrafts());
    if (dup) {
      const other = String(dup.draft.payload?.title || dup.draft.payload?.hook || dup.draft.id).slice(0, 70);
      addActivity(
        { actor: "worker", event: "draft.rejected", summary: `dropped a near-duplicate (${Math.round(dup.score * 100)}% like "${other}")`, ref: { libraryId: dup.draft.id, findingId: f.id } },
        nowISO
      );
      return null;
    }
  } catch (err) {
    console.error("worker: duplicate check failed (saving anyway):", err.message);
  }
  const rec = saveDraft({ kind, payload, nowISO });
  return { libraryId: rec?.id, label };
}

const REC_FORMAT = {
  type: "object",
  properties: {
    title: { type: "string" },
    detail: { type: "string" },
    effort: { type: "string", enum: ["small", "medium", "large"] },
  },
  required: ["title", "detail"],
};

async function recommendFromFinding(f, route, nowISO) {
  // If the classifier already produced a recommendation, use it directly.
  if (route.recTitle && route.recDetail) {
    return addRecommendation({ front: f.front, title: route.recTitle, detail: route.recDetail, effort: route.effort, evidence: [f.id] }, nowISO);
  }
  let context = "";
  try {
    context = (await relevantPages(`${f.title} ${f.summary}`, 2)).map((p) => p.summary).join(" ");
  } catch {
    /* optional */
  }
  const out = await chatJSON(
    [
      {
        role: "system",
        content:
          "Turn a marketing research finding into ONE concrete improvement recommendation for Larkwell Consulting (SAP consulting + cloud). Be specific and actionable. Plain senior voice, no hype, no em dashes. Return ONLY JSON: { title, detail, effort }.",
      },
      { role: "user", content: `FRONT: ${f.front}\nFINDING: ${f.title}\n${f.summary}\n${context ? `RELATED: ${context}` : ""}\nRecommend now as JSON.` },
    ],
    REC_FORMAT,
    { numPredict: 350, tier: "quality" }
  );
  if (!out.title) return null;
  return addRecommendation({ front: f.front, title: clean(out.title), detail: clean(out.detail), effort: out.effort, evidence: [f.id] }, nowISO);
}

const TOPICS_FORMAT = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          front: { type: "string", enum: ALL_FRONTS },
          priority: { type: "number" },
          rationale: { type: "string" },
        },
        required: ["topic", "front"],
      },
    },
  },
  required: ["topics"],
};

// Generate the next things to research, grounded in recent findings + the real
// keywords + wiki titles, biased toward fronts that are under-covered.
async function generateTopics(nowISO) {
  const findings = load("findings").slice(-12);
  const covered = {};
  for (const f of findings) covered[f.front] = (covered[f.front] || 0) + 1;
  const thinFronts = ALL_FRONTS.filter((fr) => !covered[fr]);
  const titles = listPages().slice(0, 20).map((p) => p.title);
  const kws = getKeywords().slice(0, 15).map((k) => k.keyword);

  // Service coverage: which Larkwell service lines are under-represented in the Library.
  // Steering research toward these builds variety UPSTREAM, so the pipeline stops
  // funnelling everything into the S/4HANA-migration story.
  const svcCounts = recentCoverage().svc;
  const thinServices = services
    .slice()
    .sort((a, b) => (svcCounts[a.id] || 0) - (svcCounts[b.id] || 0))
    .slice(0, 6)
    .map((s) => s.label);

  const out = await chatJSON(
    [
      {
        role: "system",
        content: [
          "You set the research agenda for Larkwell Consulting's marketing (SAP consulting + cloud).",
          `Propose up to ${TOPIC_CAP} specific, researchable topics that would most improve Larkwell's marketing`,
          "across BOTH frontend (messaging, content-seo, landing-pages, social, brand-proof) and",
          "backend (technical-seo, site-health, schema, performance, analytics, competitor-gaps) fronts.",
          "CRITICAL — spread across Larkwell's FULL service catalogue, not just S/4HANA migration.",
          "Each topic should let Larkwell show expertise in a SPECIFIC service line (Basis, ABAP, BTP,",
          "Fiori/UX, Integration Suite, functional consulting, cloud, security, managed services, etc.).",
          "Avoid proposing yet another S/4HANA/2027-deadline topic unless it is a genuinely new angle.",
          "Favour under-covered services and fronts. Each topic is a concrete question worth searching for.",
          "Return ONLY JSON: { topics: [ { topic, front, priority(1-5), rationale } ] }.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          directiveLines(),
          tasteLines(),
          competitorLines(),
          thinFronts.length ? `Fronts with NO findings yet (prioritise): ${thinFronts.join(", ")}` : `Coverage so far: ${Object.keys(covered).join(", ")}`,
          `UNDER-COVERED Larkwell services (prioritise these — the Library is too S/4HANA-heavy): ${thinServices.join(", ")}`,
          `Recent findings: ${findings.map((f) => f.title).slice(-6).join(" | ") || "(none yet)"}`,
          `Real target keywords: ${kws.join(", ")}`,
          `Existing wiki pages: ${titles.join(", ") || "(none)"}`,
          "Propose the next research topics now as JSON — make them span different services.",
        ].join("\n"),
      },
    ],
    TOPICS_FORMAT,
    { numPredict: 700 }
  );
  return (out.topics || [])
    .slice(0, TOPIC_CAP)
    .filter((t) => t.topic)
    .map((t) => ({
      topic: clean(t.topic),
      front: ALL_FRONTS.includes(t.front) ? t.front : "messaging",
      priority: Math.min(5, Math.max(1, Number(t.priority) || 3)),
      rationale: clean(t.rationale || ""),
    }));
}
