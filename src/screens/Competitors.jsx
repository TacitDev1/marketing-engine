import { useState, useEffect, useCallback } from "react";
import {
  Binoculars,
  Target,
  ArrowsClockwise,
  Sparkle,
  CircleNotch,
  Plus,
  CheckCircle,
  ArrowSquareOut,
  Clock,
} from "@phosphor-icons/react";
import { Card, Eyebrow, Button, Badge, EmptyState } from "../components/ui.jsx";
import { services, company } from "../lib/company.js";

const SERVICE_LABEL = Object.fromEntries(services.map((s) => [s.id, s.label]));

function ago(iso) {
  if (!iso) return "never";
  const d = Math.round((Date.now() - Date.parse(iso)) / 86400000);
  if (d < 1) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}
const isStale = (iso) => !iso || Date.now() - Date.parse(iso) > 30 * 86400000;

// Competitor intelligence, promoted to its own room. Every fact on this screen
// comes from the Researcher's real web sources — the app never invents a claim
// about a named company. The gap lists feed Jarvis's drafting automatically;
// the buttons here let Tobias steer: re-research a firm, or turn one gap
// into a draft that wins it.
export default function Competitors({ onNavigate, active = true }) {
  const [comps, setComps] = useState(null);
  const [unreachable, setUnreachable] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [queuedFlash, setQueuedFlash] = useState({}); // id/name -> true briefly
  const [drafting, setDrafting] = useState({}); // `${id}:${gap}` -> true
  const [drafted, setDrafted] = useState({}); // `${id}:${gap}` -> true (in Library)
  const [gapErr, setGapErr] = useState({});

  const load = useCallback(() => {
    fetch("/api/competitors")
      .then((r) => r.json())
      .then((d) => {
        setComps(d.competitors || []);
        setUnreachable(false);
      })
      .catch(() => setUnreachable(true));
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, active]);

  const [addErr, setAddErr] = useState(null);
  async function requestResearch(compName, compDomain, key) {
    try {
      const r = await fetch("/api/competitors/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: compName, domain: compDomain }),
      });
      const out = await r.json().catch(() => ({}));
      if (r.ok && out.queued === false) {
        setAddErr(out.message || "That competitor is already queued for research.");
        return false;
      }
      if (r.ok) {
        setQueuedFlash((q) => ({ ...q, [key]: true }));
        setTimeout(() => setQueuedFlash((q) => ({ ...q, [key]: false })), 5000);
        load();
        return true;
      }
    } catch {
      /* fall through to the honest failure below */
    }
    setAddErr("That didn't go through — Jarvis may be starting up. Try again in a moment.");
    setTimeout(() => setAddErr(null), 6000);
    return false;
  }

  async function addCompetitor() {
    if (!name.trim() || adding) return;
    setAdding(true);
    const ok = await requestResearch(name.trim(), domain.trim(), "new");
    // Only clear the fields on success — a failed add used to silently eat
    // whatever the user typed, with no message at all.
    if (ok) {
      setName("");
      setDomain("");
    }
    setAdding(false);
  }

  async function draftGap(comp, gap) {
    const key = `${comp.id}:${gap}`;
    setDrafting((d) => ({ ...d, [key]: true }));
    setGapErr((e) => ({ ...e, [key]: null }));
    try {
      const r = await fetch(`/api/competitors/${comp.id}/draft-gap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gap }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.message || "Jarvis may be busy — try again in a moment.");
      }
      setDrafted((d) => ({ ...d, [key]: true }));
    } catch (e) {
      setGapErr((prev) => ({ ...prev, [key]: e.message }));
    } finally {
      setDrafting((d) => ({ ...d, [key]: false }));
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8">
        <Eyebrow>Competitive intelligence</Eyebrow>
        <h1 className="mt-2 flex items-center gap-2.5 text-3xl font-semibold tracking-tight text-ink">
          <Binoculars size={28} weight="fill" className="text-brand" /> Competitors
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Who Larkwell is up against, and where they're weak. Every fact here comes from the
          researcher's real sources — nothing is invented. The gaps feed straight into
          Jarvis's writing, and you can turn any gap into a draft with one click.
        </p>
      </header>

      {unreachable && (
        <Card className="mb-5 p-4 text-[13px] text-muted">
          <span className="font-medium text-ink">Jarvis is starting up.</span> Give it a moment.
        </Card>
      )}

      {/* The baseline: us. A comparison means nothing without what Larkwell actually
          does sitting right above it. Brand-tinted so it never reads as a rival. */}
      <Card className="mb-6 border-brand/30 bg-brand-soft/40 p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[17px] font-semibold text-ink">{company.name}</h2>
          <a
            href={company.site}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[12px] text-brand hover:underline"
          >
            {company.site.replace(/^https?:\/\//, "")} <ArrowSquareOut size={11} />
          </a>
          <span className="ml-auto">
            <Badge tone="brand" upper>That's us</Badge>
          </span>
        </div>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{company.oneLiner}</p>
        <p className="mt-1 text-[12.5px] text-muted">{(company.regions || []).join(" · ")}</p>
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
            What we do — the catalogue every gap below is measured against
          </p>
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <Badge key={s.id} tone="brand">{s.label}</Badge>
            ))}
          </div>
        </div>
      </Card>

      {/* Add / request */}
      <Card className="mb-6 p-5">
        <Eyebrow>Add a competitor</Eyebrow>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Know a firm that belongs here? Add it and the researcher will profile it properly
          on its next rounds (usually within the hour when it's running).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
            placeholder="Company name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
            placeholder="theirdomain.com (optional)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCompetitor()}
          />
          <Button onClick={addCompetitor} disabled={!name.trim() || adding}>
            {adding ? <CircleNotch size={15} className="animate-spin" /> : <Plus size={15} weight="bold" />} Add & research
          </Button>
          {queuedFlash.new && (
            <span className="flex items-center gap-1.5 self-center text-[13px] font-medium text-good">
              <CheckCircle size={15} weight="fill" /> Queued for the researcher.
            </span>
          )}
          {addErr && <span className="self-center text-[13px] text-warn">{addErr}</span>}
        </div>
      </Card>

      {/* Profiles */}
      {comps === null ? (
        <p className="py-10 text-center text-sm text-muted">
          <CircleNotch size={16} className="mr-2 inline animate-spin" /> Loading…
        </p>
      ) : comps.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Binoculars}
            title="No competitors profiled yet"
            hint="The researcher builds these as it works — or add a name above to send it hunting."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {comps.map((c) => {
            const awaiting = !c.positioning && !(c.gaps || []).length;
            const stale = isStale(c.updatedAt);
            return (
              <Card key={c.id} className="p-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-[17px] font-semibold text-ink">{c.name}</h2>
                  <a
                    href={`https://${c.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[12px] text-brand hover:underline"
                  >
                    {c.domain} <ArrowSquareOut size={11} />
                  </a>
                  <span className="ml-auto flex items-center gap-2">
                    {awaiting ? (
                      <Badge tone="neutral" upper icon={Clock}>Awaiting research</Badge>
                    ) : stale ? (
                      <Badge tone="warn" upper title="Last researched over 30 days ago — the picture may have moved.">Stale</Badge>
                    ) : (
                      <Badge tone="good" upper title={`Researched ${c.timesResearched || 1}×, last ${ago(c.updatedAt)}.`}>Fresh</Badge>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-faint">
                  Researched {c.timesResearched || 1}× · last {ago(c.updatedAt)}
                </p>

                {c.positioning && (
                  <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{c.positioning}</p>
                )}

                {(c.strengths || []).length > 0 && (
                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
                    <span className="font-medium text-ink-2">Strong at:</span>{" "}
                    {c.strengths.slice(0, 4).join(" · ")}
                  </p>
                )}

                {(c.gaps || []).length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                      Where Larkwell can win
                    </p>
                    <ul className="space-y-2">
                      {c.gaps.map((g, i) => {
                        const key = `${c.id}:${g}`;
                        return (
                          <li key={i} className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                            <Target size={15} weight="bold" className="mt-0.5 shrink-0 text-good" />
                            <span className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink-2">{g}</span>
                            {drafted[key] ? (
                              <button
                                onClick={() => onNavigate?.("library")}
                                className="shrink-0 self-center text-[12px] font-medium text-good hover:underline"
                                title="A draft on this topic is waiting in your Library"
                              >
                                <CheckCircle size={13} weight="fill" className="mr-1 inline" />
                                In your Library
                              </button>
                            ) : (
                              <button
                                onClick={() => draftGap(c, g)}
                                disabled={drafting[key]}
                                title="Jarvis writes a post that wins this gap (never naming the competitor) and saves it to your Library for review."
                                className="shrink-0 self-center rounded-md border border-line-strong px-2 py-1 text-[12px] font-medium text-ink-2 transition hover:border-brand hover:text-brand disabled:opacity-50"
                              >
                                {drafting[key] ? (
                                  <CircleNotch size={13} className="inline animate-spin" />
                                ) : (
                                  <>
                                    <Sparkle size={12} weight="fill" className="mr-1 inline" /> Draft it
                                  </>
                                )}
                              </button>
                            )}
                            {gapErr[key] && <span className="self-center text-[12px] text-crit">{gapErr[key]}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  {(c.serviceOverlap || []).length > 0 && (
                    <span className="text-[11.5px] text-faint">Competes with us on:</span>
                  )}
                  {(c.serviceOverlap || []).slice(0, 6).map((s) => (
                    <Badge key={s} tone="neutral" title="Service where this firm competes with Larkwell">
                      {SERVICE_LABEL[s] || s}
                    </Badge>
                  ))}
                  <span className="ml-auto flex items-center gap-2">
                    {queuedFlash[c.id] && (
                      <span className="text-[12px] font-medium text-good">
                        <CheckCircle size={13} weight="fill" className="mr-1 inline" />
                        Queued
                      </span>
                    )}
                    <Button variant="outline" onClick={() => requestResearch(c.name, c.domain, c.id)}>
                      <ArrowsClockwise size={14} /> Re-research
                    </Button>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
