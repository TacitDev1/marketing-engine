import { useState, useEffect, useMemo } from "react";
import {
  MagnifyingGlass,
  Database,
  PenNib,
  Stack,
  ListChecks,
  Note,
  Copy,
  Check,
  X,
  CaretUp,
  CaretDown,
  CircleNotch,
  Robot,
  Lightbulb,
  TrendUp,
  CursorClick,
  Target,
  Crosshair,
} from "@phosphor-icons/react";
import { Card, Eyebrow, Pill, Button, Badge, StatTile } from "../components/ui.jsx";
import { safeHref } from "../components/Markdown.jsx";
import { prettySource } from "../lib/format.js";

const STAGES = ["All", "Awareness", "Consideration", "Decision", "Implementation"];

// The research "fronts" that are SEO work — used to surface the researcher's
// live SEO findings/recs on this screen (the rest show on Jarvis).
const SEO_FRONTS = new Set([
  "content-seo", "technical-seo", "schema", "performance", "site-health", "analytics", "competitor-gaps",
]);

export default function Seo({ onDraftBlog, active = true }) {
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(false);
  const [findings, setFindings] = useState([]);
  const [research, setResearch] = useState({ findings: [], recs: [] });
  const [competitors, setCompetitors] = useState([]);
  const [filter, setFilter] = useState("");
  const [stage, setStage] = useState("All");
  const [sort, setSort] = useState({ key: "score", dir: "desc" });
  const [brief, setBrief] = useState(null); // { keyword, stage, contentType }
  // GSC opportunity mining: undefined = loading, null = GSC not connected,
  // { error } = API hiccup, otherwise { strikingDistance, ctrGaps, range }.
  const [opps, setOpps] = useState(undefined);

  useEffect(() => {
    // Fetch + poll only while visible; re-running on activation keeps it fresh.
    if (!active) return;
    fetch("/api/content-plan")
      .then((r) => r.json())
      .then((d) => {
        // The server returns 200 + zeros + an error field on failure — showing
        // "Keywords 0" as fact would read as "our SEO pipeline is empty".
        if (d.error) {
          setPlan(null);
          setPlanError(true);
          return;
        }
        setPlan(d);
        setPlanError(false);
      })
      .catch(() => {
        setPlan(null);
        setPlanError(true);
      });
    fetch("/api/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "SEO audit findings recommendations issues technical fixes overall score",
        n: 6,
      }),
    })
      .then((r) => r.json())
      .then((d) => setFindings(d.results || []))
      .catch(() => setFindings([]));

    // Real Search Console wins (striking distance + CTR gaps). Fetched once
    // per activation — GSC data only changes daily, and the brain caches it.
    fetch("/api/seo/opportunities")
      .then((r) => (r.status === 409 ? null : r.json()))
      .then((d) => setOpps(d))
      .catch(() => setOpps({ error: "unreachable" }));

    // Live: what the researcher/Worker has surfaced on the SEO fronts.
    const loadResearch = () =>
      Promise.all([
        fetch("/api/autopilot/findings?limit=200").then((r) => r.json()).catch(() => ({})),
        fetch("/api/autopilot/recommendations").then((r) => r.json()).catch(() => ({})),
        fetch("/api/competitors").then((r) => r.json()).catch(() => ({})),
      ]).then(([f, r, c]) => {
        setResearch({
          findings: (f.findings || []).filter((x) => SEO_FRONTS.has(x.front)),
          recs: (r.recommendations || []).filter((x) => SEO_FRONTS.has(x.front)),
        });
        setCompetitors(c.competitors || []);
      });
    loadResearch();
    const t = setInterval(loadResearch, 15000);
    return () => clearInterval(t);
  }, [active]);

  // Headline numbers across the WHOLE plan (not just the visible rows).
  const stats = useMemo(() => {
    const all = plan?.prioritized || [];
    return {
      keywords: plan?.total || all.length,
      volume: all.reduce((a, k) => a + (k.volume || 0), 0),
      high: all.filter((k) => k.priority === "High").length,
      pillars: plan?.pillars?.length || 0,
      researched: all.filter((k) => k.source === "researched").length,
    };
  }, [plan]);

  const rows = useMemo(() => {
    if (!plan?.prioritized) return [];
    const q = filter.trim().toLowerCase();
    const filtered = plan.prioritized
      .filter((k) => (stage === "All" ? true : k.stage === stage))
      .filter((k) => (q ? k.keyword.toLowerCase().includes(q) : true));
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (typeof av === "string") return av.localeCompare(bv) * mul;
      return ((av ?? 0) - (bv ?? 0)) * mul;
    });
  }, [plan, filter, stage, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "keyword" ? "asc" : "desc" }));
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8">
        <Eyebrow>Search</Eyebrow>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">SEO opportunities</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Your real keyword research turned into a prioritized content plan, with on-page
          briefs you can paste straight in. Honest note: the writing lives here, but ranking
          ultimately needs these pages published on the company-website.
        </p>
      </header>

      {/* Real Search Console wins — independent of the content plan, so a
          plan hiccup can't hide the screen's most honest data. */}
      <GscOpportunities opps={opps} onBrief={setBrief} onDraftBlog={onDraftBlog} />

      {planError ? (
        <Card className="p-6 text-[14px] text-muted">
          <span className="font-medium text-ink">Jarvis is starting up.</span> Give it a moment and
          it'll reconnect.
        </Card>
      ) : !plan ? (
        <PlanSkeleton />
      ) : (
        <>
          {/* Overview stats */}
          <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile icon={MagnifyingGlass} label="Keywords" value={stats.keywords.toLocaleString()} />
            <StatTile icon={TrendUp} label="Monthly searches" value={stats.volume.toLocaleString()} />
            <StatTile icon={ListChecks} label="High priority" value={stats.high.toLocaleString()} />
            <StatTile icon={Stack} label="Content pillars" value={stats.pillars} />
            <StatTile icon={Robot} label="From researcher" value={stats.researched.toLocaleString()} />
          </section>

          {/* Pillars */}
          <section className="mb-8">
            <SectionLabel icon={Stack}>Content pillars</SectionLabel>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plan.pillars.map((p) => (
                <Card key={p.name} className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-semibold leading-snug text-ink">{p.name}</h3>
                    <span className="shrink-0 rounded-md bg-brand-soft px-2 py-0.5 font-mono text-[12px] text-brand">
                      {p.volume.toLocaleString()}/mo
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-faint">{p.count} keywords</p>
                  <ul className="mt-3 space-y-1">
                    {p.top.map((kw) => (
                      <li key={kw} className="text-[13px] text-muted">{kw}</li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </section>

          {/* Buyer-stage distribution */}
          {plan.stageCounts && (
            <section className="mb-8">
              <SectionLabel icon={ListChecks}>Keywords by buyer stage</SectionLabel>
              <div className="flex flex-wrap gap-3">
                {["Awareness", "Consideration", "Decision", "Implementation"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStage(stage === s ? "All" : s)}
                    className={`rounded-lg border px-4 py-3 text-left transition ${
                      stage === s ? "border-brand bg-brand/5" : "border-line bg-surface hover:border-brand/50"
                    }`}
                  >
                    <div className="text-2xl font-semibold text-ink">{plan.stageCounts[s] || 0}</div>
                    <div className="text-[12px] text-faint">{s}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Prioritized opportunities */}
          <section className="mb-8">
            <SectionLabel icon={MagnifyingGlass}>Prioritized opportunities</SectionLabel>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter keywords…"
                  className="w-full rounded-lg border border-line-strong bg-surface py-2 pl-9 pr-3 text-[14px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
                />
              </div>
              {STAGES.map((s) => (
                <Pill key={s} active={stage === s} onClick={() => setStage(s)}>{s}</Pill>
              ))}
            </div>

            <Card className="overflow-hidden">
              <div className="scroll-quiet max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left text-[14px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-line bg-canvas text-[12px] uppercase tracking-wide text-faint">
                      <Th onClick={() => toggleSort("keyword")} sort={sort} col="keyword" className="px-4">Keyword</Th>
                      <Th onClick={() => toggleSort("volume")} sort={sort} col="volume" align="right" className="px-3">Vol/mo</Th>
                      <Th onClick={() => toggleSort("stage")} sort={sort} col="stage" className="hidden px-3 md:table-cell">Stage</Th>
                      <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Suggested content</th>
                      <Th onClick={() => toggleSort("score")} sort={sort} col="score" className="px-3">Priority</Th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((k) => (
                      <tr key={k.keyword} className="hover:bg-canvas/60">
                        <td className="px-4 py-2.5 text-ink-2">
                          {k.keyword}
                          {k.source === "researched" && (
                            <span title={k.volumeSource === "semrush" ? "Found by your deep researcher, volume measured by SEMrush" : k.estimated ? "Found by your deep researcher; its volume is an estimate" : "Found by your deep researcher; no search volume yet"}>
                              <Badge tone="brand" upper className="ml-2 align-middle">researched</Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[13px] text-muted">
                          {k.volume != null ? k.volume.toLocaleString() : "-"}
                          {k.estimated && (
                            <span className="ml-1 text-[11px] text-faint" title="The researcher's estimate, not a measured search volume">est.</span>
                          )}
                        </td>
                        <td className="hidden px-3 py-2.5 text-muted md:table-cell">{k.stage}</td>
                        <td className="hidden px-3 py-2.5 text-[13px] text-faint lg:table-cell">{k.contentType}</td>
                        <td className="px-3 py-2.5"><PriorityBadge band={k.priority} /></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setBrief({ keyword: k.keyword, stage: k.stage, contentType: k.contentType })}
                              title="Generate an on-page SEO brief (meta, slug, H1, subtopics)"
                              className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink-2 transition hover:border-brand hover:text-brand"
                            >
                              <Note size={13} /> Brief
                            </button>
                            <button
                              onClick={() => onDraftBlog?.(k.keyword)}
                              title="Draft a full blog targeting this keyword"
                              className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink-2 transition hover:border-brand hover:text-brand"
                            >
                              <PenNib size={13} /> Draft
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && (
                  <p className="px-4 py-6 text-center text-[13px] text-faint">No keywords match this filter.</p>
                )}
              </div>
            </Card>
            <p className="mt-2 text-[12px] text-faint">
              Showing {rows.length.toLocaleString()} keyword{rows.length === 1 ? "" : "s"}. Priority blends
              search volume with commercial intent. Click a column to sort; scroll for the full list.
              Volumes come from the keyword sheet{plan?.sheetDate ? ` (${plan.sheetDate})` : ""}, or SEMrush where measured;
              "est." marks the researcher's estimate, used only where nothing was measured.
            </p>
          </section>

          {/* Live research from the SEO fronts (researcher + Worker) */}
          {(research.recs.length > 0 || research.findings.length > 0) && (
            <section className="mb-8">
              <SectionLabel icon={Robot}>From your researcher (live SEO)</SectionLabel>
              <p className="mb-3 -mt-1 text-[12px] text-faint">
                What the researcher and Worker have surfaced on the SEO fronts (keyword/competitor gaps,
                technical SEO, schema, performance, analytics). Updates live.
              </p>

              {research.recs.length > 0 && (
                <div className="mb-3 space-y-2">
                  {research.recs.slice(0, 12).map((r) => (
                    <Card key={r.id} className="flex items-start gap-2.5 p-4">
                      <Lightbulb size={15} weight="fill" className="mt-0.5 shrink-0 text-warn" />
                      <div className="flex-1">
                        <p className="text-[14px] font-medium text-ink">{r.title}</p>
                        {r.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{r.detail}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone="violet">{r.front}</Badge>
                          {r.effort && <Badge tone="neutral">effort: {r.effort}</Badge>}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {research.findings.slice(0, 12).map((f) => (
                  <Card key={f.id} className="p-4">
                    <div className="flex items-center gap-2">
                      <Badge tone="violet">{f.front}</Badge>
                      <span className="text-[14px] font-medium text-ink">{f.title}</span>
                    </div>
                    {f.summary && <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.summary}</p>}
                    {f.url && safeHref(f.url) && (
                      <a href={f.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-brand hover:underline">
                        {(f.sources?.[0] || f.url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                      </a>
                    )}
                  </Card>
                ))}
              </div>
              {(research.recs.length > 12 || research.findings.length > 12) && (
                <p className="mt-2 text-[12px] text-faint">Showing the latest; the rest live on the Jarvis tabs.</p>
              )}
            </section>
          )}

          {/* Competitor profiles (the researcher keeps these current) */}
          {competitors.length > 0 && (
            <section className="mb-8">
              <SectionLabel icon={Crosshair}>Competitor landscape</SectionLabel>
              <p className="mb-3 -mt-1 text-[12px] text-faint">
                Structured profiles the researcher maintains from real sources. The gaps feed
                straight into Jarvis's drafting, so content leans where Larkwell can win.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {competitors.slice(0, 8).map((c) => (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[14px] font-semibold text-ink">{c.name}</p>
                      <a
                        href={`https://${c.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-mono text-[11px] text-brand hover:underline"
                      >
                        {c.domain}
                      </a>
                    </div>
                    {c.positioning && (
                      <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{c.positioning}</p>
                    )}
                    {(c.gaps || []).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {c.gaps.slice(0, 3).map((g, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-2">
                            <Target size={13} weight="bold" className="mt-0.5 shrink-0 text-good" />
                            {g}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(c.serviceOverlap || []).slice(0, 4).map((s) => (
                        <Badge key={s} tone="neutral">{s}</Badge>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Audit findings */}
          {findings.length > 0 && (
            <section>
              <SectionLabel icon={Database}>From your organic audits</SectionLabel>
              <div className="space-y-3">
                {findings.map((f, i) => (
                  <Card key={i} className="p-4">
                    <p className="text-[12px] font-medium text-faint">{prettySource(f.source)}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{f.text.slice(0, 320)}</p>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {brief && <BriefModal target={brief} onClose={() => setBrief(null)} onDraftBlog={onDraftBlog} />}
    </div>
  );
}

// ---- GSC opportunity mining: real Google data, the screen's best signal ----

// "https://www.larkwell.example/sap/foo/" -> "/sap/foo/" (keeps tables readable).
function pagePath(url) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url || "";
  }
}

function GscOpportunities({ opps, onBrief, onDraftBlog }) {
  // Search Console not connected: one honest line, so the section is discoverable.
  if (opps === null) {
    return (
      <p className="mb-6 text-[12.5px] text-faint">
        Connect Search Console on the Connections screen to see real search wins here (queries
        within striking distance and pages losing clicks).
      </p>
    );
  }

  if (opps === undefined) {
    return (
      <section className="mb-8">
        <SectionLabel icon={Target}>Real search wins (Search Console)</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="h-48 animate-pulse bg-surface-2" />
          <Card className="h-48 animate-pulse bg-surface-2" />
        </div>
      </section>
    );
  }

  if (opps.error) {
    return (
      <section className="mb-8">
        <SectionLabel icon={Target}>Real search wins (Search Console)</SectionLabel>
        <Card className="p-4 text-[13px] text-muted">
          Couldn't load Search Console opportunities right now ({String(opps.error).slice(0, 120)}).
          The rest of the screen still works — try again in a minute.
        </Card>
      </section>
    );
  }

  const actions = (query) => (
    <div className="flex items-center justify-end gap-1.5">
      <button
        onClick={() => onBrief({ keyword: query })}
        title="Generate on-page recommendations (title, meta, H1) for this query"
        className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink-2 transition hover:border-brand hover:text-brand"
      >
        <Note size={13} /> Brief
      </button>
      <button
        onClick={() => onDraftBlog?.(query)}
        title="Draft a full blog targeting this query"
        className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink-2 transition hover:border-brand hover:text-brand"
      >
        <PenNib size={13} /> Draft
      </button>
    </div>
  );

  return (
    <section className="mb-8">
      <SectionLabel icon={Target}>Real search wins (Search Console)</SectionLabel>
      <p className="mb-3 -mt-1 max-w-2xl text-[12px] text-faint">
        Actual Google data for larkwell.example, {opps.range?.toLowerCase()}. This is the most
        honest signal on this screen — these queries are already showing your site.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Striking distance */}
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <TrendUp size={15} weight="bold" className="text-brand" />
              <h3 className="text-[14px] font-semibold text-ink">Almost winning</h3>
              <Badge tone="brand" upper>pos 4–15</Badge>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Queries where you rank just off the top spots. The cheapest traffic to win —
              strengthen or create the page and these tip into clicks.
            </p>
          </div>
          {opps.strikingDistance?.length ? (
            <div className="scroll-quiet max-h-80 overflow-y-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-line bg-canvas text-[11px] uppercase tracking-wide text-faint">
                    <th className="px-4 py-2 font-medium">Query</th>
                    <th className="px-2 py-2 text-right font-medium">Pos</th>
                    <th className="px-2 py-2 text-right font-medium">Seen</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {opps.strikingDistance.map((r, i) => (
                    <tr key={i} className="hover:bg-canvas/60">
                      <td className="px-4 py-2">
                        <div className="font-medium text-ink-2">{r.query}</div>
                        <div className="truncate text-[11px] text-faint" title={r.page}>
                          {pagePath(r.page)}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted">
                        {r.position.toFixed(1)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted">
                        {r.impressions.toLocaleString()}
                      </td>
                      <td className="px-4 py-2">{actions(r.query)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-[13px] text-muted">
              Nothing in striking distance yet — as the site earns more impressions,
              near-miss queries will show up here.
            </p>
          )}
        </Card>

        {/* CTR gaps */}
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <CursorClick size={15} weight="bold" className="text-warn" />
              <h3 className="text-[14px] font-semibold text-ink">Seen but not clicked</h3>
              <Badge tone="warn" upper>fix the snippet</Badge>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              You show up, people pick someone else. Usually a weak page title or meta
              description — a Brief gives you a better one to paste into the site.
            </p>
          </div>
          {opps.ctrGaps?.length ? (
            <div className="scroll-quiet max-h-80 overflow-y-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-line bg-canvas text-[11px] uppercase tracking-wide text-faint">
                    <th className="px-4 py-2 font-medium">Query</th>
                    <th className="px-2 py-2 text-right font-medium">Pos</th>
                    <th className="px-2 py-2 text-right font-medium">CTR</th>
                    <th className="px-2 py-2 text-right font-medium" title="Clicks a healthy snippet would earn at this position">Missing</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {opps.ctrGaps.map((r, i) => (
                    <tr key={i} className="hover:bg-canvas/60">
                      <td className="px-4 py-2">
                        <div className="font-medium text-ink-2">{r.query}</div>
                        <div className="truncate text-[11px] text-faint" title={r.page}>
                          {pagePath(r.page)}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted">
                        {r.position.toFixed(1)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted">
                        {(r.ctr * 100).toFixed(1)}%
                        <span className="text-faint"> / {(r.expectedCtr * 100).toFixed(0)}%</span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-warn">
                        ~{r.missedClicks}
                      </td>
                      <td className="px-4 py-2">{actions(r.query)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-[13px] text-muted">
              No snippet problems found — every query that shows your site is clicking
              about as well as its position allows.
            </p>
          )}
        </Card>
      </div>
      <p className="mt-2 text-[12px] text-faint">
        "Seen" = impressions on Google. "CTR" shows actual vs. what that position usually earns.
        Ranking fixes ultimately land on the company-website — draft here, publish there.
      </p>
    </section>
  );
}

function Th({ children, onClick, sort, col, align = "left", className = "" }) {
  const active = sort.key === col;
  return (
    <th className={`py-2.5 font-medium ${className}`}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-ink-2 ${
          active ? "text-brand" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {children}
        {active && (sort.dir === "asc" ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />)}
      </button>
    </th>
  );
}

// ---- SEO brief modal (meta recommendations for one keyword) ----
function BriefModal({ target, onClose, onDraftBlog }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    fetch("/api/seo/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.message || d.error || "failed");
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, [target]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-rail/60 px-4 py-8 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-line bg-surface shadow-card-lg">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2">
            <Note size={16} weight="fill" className="text-brand" />
            <h2 className="text-[15px] font-semibold text-ink">SEO brief</h2>
            <span className="text-[13px] text-faint">— {target.keyword}</span>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          {error ? (
            <p className="text-[14px] text-crit">Couldn't generate: {error}</p>
          ) : !data ? (
            <div className="flex items-center gap-2 py-10 text-[14px] text-muted">
              <CircleNotch size={16} className="animate-spin" /> Writing the brief on your GPU…
            </div>
          ) : (
            <div className="space-y-4">
              <BriefField label="Title tag" value={data.titleTag} hint={lenHint(data.checks.titleLen, 50, 60)} ok={data.checks.titleLen >= 50 && data.checks.titleLen <= 60} />
              <BriefField label="Meta description" value={data.metaDescription} hint={lenHint(data.checks.metaLen, 140, 160)} ok={data.checks.metaLen >= 140 && data.checks.metaLen <= 160} multiline />
              <div className="grid grid-cols-2 gap-4">
                <BriefField label="URL slug" value={`/${data.slug}`} mono />
                <BriefField label="H1" value={data.h1} />
              </div>
              <div>
                <FieldLabel>Search intent</FieldLabel>
                <p className="text-[14px] text-ink-2">{data.intent}</p>
              </div>
              {data.subtopics?.length > 0 && (
                <div>
                  <FieldLabel>Sections to cover (H2s)</FieldLabel>
                  <ul className="mt-1 ml-5 list-disc space-y-1 text-[14px] text-ink-2">
                    {data.subtopics.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {data.relatedKeywords?.length > 0 && (
                <div>
                  <FieldLabel>Related keywords to include</FieldLabel>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {data.relatedKeywords.map((k) => (
                      <span key={k} className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] text-brand">{k}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line bg-canvas/50 px-5 py-3">
          <CopyAllButton data={data} keyword={target.keyword} />
          <Button onClick={() => { onDraftBlog?.(target.keyword); onClose(); }} disabled={!data}>
            <PenNib size={16} /> Draft full blog
          </Button>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-faint">{children}</div>;
}

function BriefField({ label, value, hint, ok, mono, multiline }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked (non-secure context) — don't throw an unhandled rejection */
    }
  }
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <FieldLabel>{label}</FieldLabel>
        {hint && <span className={`text-[11px] ${ok ? "text-good" : "text-warn"}`}>{hint}</span>}
      </div>
      <div className="flex items-start gap-2">
        <p className={`flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-[14px] text-ink-2 ${mono ? "font-mono text-[13px]" : ""} ${multiline ? "leading-relaxed" : "truncate"}`}>
          {value}
        </p>
        <button onClick={copy} title="Copy" className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-brand">
          {copied ? <Check size={15} weight="bold" className="text-good" /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}

function CopyAllButton({ data, keyword }) {
  const [copied, setCopied] = useState(false);
  if (!data) return <span className="text-[12px] text-faint">drafts only · nothing publishes</span>;
  async function copyAll() {
    const text = [
      `Keyword: ${keyword}`,
      `Title tag: ${data.titleTag}`,
      `Meta description: ${data.metaDescription}`,
      `Slug: /${data.slug}`,
      `H1: ${data.h1}`,
      `Intent: ${data.intent}`,
      `Sections: ${(data.subtopics || []).join("; ")}`,
      `Related keywords: ${(data.relatedKeywords || []).join(", ")}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (non-secure context) — don't throw an unhandled rejection */
    }
  }
  return (
    <Button variant="ghost" onClick={copyAll}>
      {copied ? <><Check size={16} weight="bold" /> Copied</> : <><Copy size={16} /> Copy all</>}
    </Button>
  );
}

function lenHint(n, min, max) {
  const ok = n >= min && n <= max;
  return `${n} chars · best ${min}–${max}${ok ? " ✓" : ""}`;
}

function SectionLabel({ icon: Icon, children }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon size={17} weight="fill" className="text-brand" />
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
    </div>
  );
}

function PriorityBadge({ band }) {
  const tones = { High: "good", Medium: "warn", Low: "neutral" };
  return <Badge tone={tones[band] || "neutral"}>{band}</Badge>;
}

function PlanSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-line" />
      ))}
    </div>
  );
}
