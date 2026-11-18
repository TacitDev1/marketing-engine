import { useState, useEffect, useCallback } from "react";
import { CircleNotch, Gauge, Warning } from "@phosphor-icons/react";
import { Card, Button } from "../../components/ui.jsx";
import Section from "./Section.jsx";

// ---- Site health: local Lighthouse audit (free, keyless, pre-deploy) ----

function scoreTone(score) {
  if (score == null) return "faint";
  if (score >= 90) return "good";
  if (score >= 50) return "warn";
  return "crit";
}
// Tailwind needs literal class names (no `text-${tone}` interpolation).
const TONE_TEXT = { good: "text-good", warn: "text-warn", crit: "text-crit", faint: "text-faint" };
const TONE_BG = { good: "bg-good", warn: "bg-warn", crit: "bg-crit", faint: "bg-faint" };

// PSI-style ring gauge: score 0-100 with the familiar colour bands.
function ScoreRing({ label, score }) {
  const tone = scoreTone(score);
  const R = 26;
  const C = 2 * Math.PI * R;
  const frac = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-[68px] w-[68px]">
        <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
          <circle cx="34" cy="34" r={R} fill="none" strokeWidth="5" className="stroke-line" />
          <circle
            cx="34"
            cy="34"
            r={R}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${C * frac} ${C}`}
            className={`stroke-current ${TONE_TEXT[tone]} transition-all duration-700`}
          />
        </svg>
        <span
          className={`absolute inset-0 grid place-items-center text-[17px] font-semibold ${TONE_TEXT[tone]}`}
        >
          {score ?? "–"}
        </span>
      </div>
      <span className="text-[11px] font-medium text-muted">{label}</span>
    </div>
  );
}

export default function SiteHealth({ active = true }) {
  const [audit, setAudit] = useState(null); // GET /api/website/audit payload
  const [pathInput, setPathInput] = useState("/");
  const [kickError, setKickError] = useState("");

  const poll = useCallback(() => {
    fetch("/api/website/audit")
      .then((r) => r.json())
      .then(setAudit)
      .catch(() => {});
  }, []);

  // Light poll while visible; faster while an audit is running.
  useEffect(() => {
    if (!active) return;
    poll();
    const id = setInterval(poll, audit?.running ? 3000 : 12000);
    return () => clearInterval(id);
  }, [poll, active, audit?.running]);

  async function run() {
    setKickError("");
    try {
      const res = await fetch("/api/website/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathInput || "/" }),
      });
      const d = await res.json();
      if (!res.ok) {
        setKickError(
          d.error === "already_running"
            ? "An audit is already running."
            : d.error === "chrome_missing"
              ? "Headless Chrome isn't set up on this machine yet."
              : d.error || "Couldn't start the audit."
        );
      }
    } catch {
      setKickError("Jarvis isn't responding right now.");
    } finally {
      poll();
    }
  }

  const r = audit?.lastResult;
  const running = !!audit?.running;

  return (
    <Section
      icon={Gauge}
      title="Site health (Lighthouse)"
      sub="Google's real audit engine, run by the app against the preview — free, no API key, and it works before the site is deployed. Scores are lab numbers from the machine running the app, so treat trends and the fix list as the signal, not the exact digits."
    >
      <Card className="p-5">
        {/* run bar */}
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!running) run();
            }}
          >
            <span className="shrink-0 text-[12px] text-faint">audit page</span>
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              spellCheck={false}
              placeholder="/"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
            />
          </form>
          <Button onClick={run} disabled={running || !audit?.chromeAvailable}>
            {running ? <CircleNotch size={15} className="animate-spin" /> : <Gauge size={15} weight="bold" />}
            {running ? "Auditing…" : "Run audit"}
          </Button>
        </div>
        {running && (
          <p className="mt-2 text-[12px] text-muted">
            Running Lighthouse on <code className="rounded bg-canvas px-1 text-ink-2">{audit.path}</code> —
            takes about a minute. If the preview isn't up it builds the site first, which adds a few more.
          </p>
        )}
        {!running && audit === null && (
          <p className="mt-2 text-[12px] text-warn">
            Jarvis isn't reachable right now, so audits can't start. Give it a moment.
          </p>
        )}
        {!running && audit && !audit.chromeAvailable && (
          <p className="mt-2 text-[12px] text-warn">
            Headless Chrome isn't installed at <code>~/.cache/mkt-chrome</code> on the machine running the
            app — run <code>scripts/setup-lighthouse-chrome.sh</code> there, then try again.
          </p>
        )}
        {(kickError || (!running && audit?.error)) && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-crit">
            <Warning size={13} weight="fill" /> {kickError || `Last audit failed: ${audit.error}`}
          </p>
        )}

        {/* results */}
        {r ? (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-around gap-4 rounded-lg border border-line bg-canvas px-4 py-4">
              <ScoreRing label="Performance" score={r.scores.performance} />
              <ScoreRing label="Accessibility" score={r.scores.accessibility} />
              <ScoreRing label="Best practices" score={r.scores.bestPractices} />
              <ScoreRing label="SEO" score={r.scores.seo} />
            </div>
            <p className="mt-2 text-[12px] text-faint">
              Audited <code className="rounded bg-canvas px-1 text-ink-2">{r.path}</code>{" "}
              {new Date(r.finishedAt).toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {" · "}first run after a restart can under-score performance — run it again to confirm.
            </p>

            {r.failures?.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">
                  What to fix ({r.failures.length})
                </p>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {r.failures.map((f) => (
                    <li key={f.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_BG[scoreTone(Math.round((f.score ?? 0) * 100))]}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-ink-2">
                          {f.title}
                          {f.display && <span className="ml-2 text-[12px] font-normal text-warn">{f.display}</span>}
                        </p>
                        {f.hint && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{f.hint}.</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          !running && (
            <p className="mt-4 text-[13px] leading-relaxed text-muted">
              No audit yet. Hit <span className="font-medium text-ink">Run audit</span> and Lighthouse
              will score the page for performance, accessibility, best practices and SEO, plus a
              concrete fix list — all locally, before anything is deployed.
            </p>
          )
        )}
      </Card>
    </Section>
  );
}
