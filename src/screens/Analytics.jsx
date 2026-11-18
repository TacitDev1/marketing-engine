import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChartLineUp,
  Users,
  Eye,
  CursorClick,
  Path,
  MagnifyingGlass,
  FileText,
  TreeStructure,
  Clock,
  WarningCircle,
  PlugsConnected,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { Card, StatTile } from "../components/ui.jsx";

/* ------------------------------------------------------------------ *
 * Analytics — a calm, honest read on GA4 + Search Console for the
 * live larkwell.example site. One endpoint (/api/analytics/summary),
 * hand-rolled inline-SVG charts (no chart lib), fully token-themed so
 * it re-skins light/dark for free. Every half (GA4 / GSC) degrades on
 * its own — one being down never hides the other, and a dead engine
 * keeps the last-loaded numbers on screen with an honest stale banner.
 *
 * dataviz discipline applied here:
 *   · one y-axis per chart, never a dual scale (clicks and impressions
 *     differ by ~150x, so impressions live in a KPI, not a shared axis)
 *   · magnitude → sequential single hue (source bars, table meters)
 *   · 2-series trend → a legend is always present; identity comes from
 *     the colored mark beside the label, never the text colour
 *   · thin 2px lines, ~10% area wash, hairline recessive grid
 *   · a crosshair + tooltip hover layer on every line chart
 * ------------------------------------------------------------------ */

// ---- date helpers (UTC, so the sparse trend fill can't drift a day) ----
const parseYMD = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toYMD = (dt) => dt.toISOString().slice(0, 10);
const prettyDay = (s) =>
  parseYMD(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Build a continuous [days]-long calendar ending `backOffset` days before `endYMD`.
// GA4 spans 28daysAgo→today (backOffset 0); GSC reports 28→1 days ago
// (backOffset 1), including Google's preliminary data for the newest days.
function buildWindow(endYMD, days, backOffset) {
  const end = parseYMD(endYMD);
  end.setUTCDate(end.getUTCDate() - backOffset);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    out.push(toYMD(d));
  }
  return out;
}

// Sparse trend → dense: every calendar day present, zero-filled where the API
// omitted a no-traffic day. Without this a quiet day collapses and the trend lies.
function fillTrend(trend, dates, keys) {
  const map = Object.fromEntries((trend || []).map((r) => [r.date, r]));
  return dates.map((date) => {
    const r = map[date] || {};
    const row = { date };
    for (const k of keys) row[k] = r[k] ?? 0;
    return row;
  });
}

const nf = (n) => (n ?? 0).toLocaleString("en-US");
const half = (x) => x && typeof x === "object" && !x.error; // a usable GA4/GSC half
const errText = (x) => (x && x.error ? x.error : null);

export default function Analytics({ active = true }) {
  const [data, setData] = useState(null); // last good summary — never wiped
  const [notConfigured, setNotConfigured] = useState(false);
  const [stale, setStale] = useState(false); // engine unreachable, showing last data
  const [loading, setLoading] = useState(true); // first-load skeletons only
  const [fetchedAt, setFetchedAt] = useState(null);

  const load = useCallback(() => {
    fetch("/api/analytics/summary")
      .then(async (r) => {
        if (r.status === 409) return { __notConfigured: true };
        if (!r.ok) throw new Error(`engine answered ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d.__notConfigured) {
          setNotConfigured(true);
          setStale(false);
          return;
        }
        setData(d);
        setNotConfigured(false);
        setStale(false);
        setFetchedAt(Date.now());
      })
      // Keep the last-loaded data on a failed poll — a dead engine must never
      // render as "no traffic". Just flag it stale.
      .catch(() => setStale(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Poll every 60s, but ONLY while this screen is the active one. Re-activating
    // re-runs this effect, so the numbers refresh the instant you open the tab.
    if (!active) return;
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load, active]);

  // Re-render every 30s (while visible) so "Updated Xs ago" actually ticks
  // instead of freezing until the next poll.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setClockTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [active]);

  const wrap = "mx-auto w-full max-w-[1200px] px-6 py-6 sm:px-8 lg:px-10";

  // First load, nothing yet.
  if (loading && !data) {
    return (
      <div className={wrap}>
        <Header />
        <LoadingSkeleton />
      </div>
    );
  }

  // Endpoint says not configured (409) — even if we have older data, showing
  // it under a fresh "Updated Xm ago" would be a lie: credentials are gone
  // and every poll will 409 until they're back. Show the setup card.
  if (notConfigured) {
    return (
      <div className={wrap}>
        <Header />
        <SetupCard />
      </div>
    );
  }

  // Engine unreachable and we never got any data: say THAT — falling through
  // would render "isn't connected yet", which reads as a config problem.
  if (!data) {
    return (
      <div className={wrap}>
        <Header />
        <div className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-warn">
          <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            Jarvis is starting up. Give it a moment and it'll reconnect.
          </span>
        </div>
      </div>
    );
  }

  const ga4 = data?.ga4;
  const gsc = data?.gsc;
  const today = (data?.generatedAt || new Date().toISOString()).slice(0, 10);
  const range = data?.range || "Last 28 days";

  // Dense, zero-filled trends on their own calendars. GA4's "28daysAgo→today"
  // is 29 calendar days INCLUSIVE — a 28-day window silently dropped the first
  // day of every chart. GSC's 28→1 days-ago range really is 28 days; end the
  // window at the last day GSC actually reported (usually yesterday now that
  // we ask for preliminary data), so the chart never ends on a fake dip.
  const ga4Days = buildWindow(today, 29, 0);
  // (max, not last row — the GSC API doesn't guarantee date-sorted rows)
  const gscLastDay =
    half(gsc) && gsc.trend?.length
      ? gsc.trend.reduce((m, r) => (r.date > m ? r.date : m), "")
      : null;
  const gscDays = gscLastDay ? buildWindow(gscLastDay, 28, 0) : buildWindow(today, 28, 1);
  const ga4Trend = half(ga4) ? fillTrend(ga4.trend, ga4Days, ["sessions", "users", "views"]) : [];
  const gscTrend = half(gsc) ? fillTrend(gsc.trend, gscDays, ["clicks", "impressions"]) : [];

  return (
    <div className={wrap}>
      <Header range={range} fetchedAt={fetchedAt} stale={stale} onRefresh={load} />

      {stale && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
          <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
          <span>Jarvis is catching up, so these may be a moment behind. Your work is safe.</span>
        </div>
      )}

      {/* Hero KPI row — the vitals for the window */}
      <Kpis ga4={ga4} gsc={gsc} ga4Trend={ga4Trend} gscTrend={gscTrend} range={range} />

      {/* Trends — GA4 traffic + GSC clicks, side by side, one y-axis each */}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Panel icon={ChartLineUp} title="Site traffic" hint="GA4 · by day">
          {half(ga4) ? (
            <LineChart
              dates={ga4Trend.map((r) => r.date)}
              series={[
                { key: "sessions", label: "Sessions", color: "var(--color-brand)", values: ga4Trend.map((r) => r.sessions), area: true },
                { key: "views", label: "Views", color: "var(--color-violet)", values: ga4Trend.map((r) => r.views) },
              ]}
            />
          ) : (
            <HalfNotice error={errText(ga4)} name="Google Analytics" />
          )}
        </Panel>

        <Panel icon={MagnifyingGlass} title="Search clicks" hint="Search Console · by day">
          {half(gsc) ? (
            <LineChart
              dates={gscTrend.map((r) => r.date)}
              series={[
                { key: "clicks", label: "Clicks", color: "var(--color-brand)", values: gscTrend.map((r) => r.clicks), area: true },
              ]}
            />
          ) : (
            <HalfNotice error={errText(gsc)} name="Search Console" />
          )}
        </Panel>
      </div>

      {/* Where the traffic comes from */}
      <Panel icon={Path} title="Where visitors come from" hint="GA4 · by sessions" className="mb-8">
        {half(ga4) ? (
          <SourceBars sources={ga4.sources || []} />
        ) : (
          <HalfNotice error={errText(ga4)} name="Google Analytics" />
        )}
      </Panel>

      {/* Top pages + top queries */}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Panel icon={FileText} title="Most-visited pages" hint="GA4">
          {half(ga4) ? (
            <TopPages pages={ga4.topPages || []} />
          ) : (
            <HalfNotice error={errText(ga4)} name="Google Analytics" />
          )}
        </Panel>

        <Panel icon={TreeStructure} title="Top search queries" hint="Search Console">
          {half(gsc) ? (
            <TopQueries queries={gsc.queries || []} />
          ) : (
            <HalfNotice error={errText(gsc)} name="Search Console" />
          )}
        </Panel>
      </div>

      <FreshnessNote />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */
function Header({ range, fetchedAt, stale, onRefresh }) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-[23px] font-bold tracking-[-0.035em] text-ink">
            <ChartLineUp weight="fill" size={26} className="text-brand" />
            Analytics
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
            How the live larkwell.example is actually doing — visitors from Google Analytics and
            search performance from Search Console, read-only and refreshed for you.
          </p>
        </div>
        {range && (
          <div className="flex items-center gap-2 text-[12px] text-faint">
            <span className="rounded-lg border border-line bg-surface px-2.5 py-1 font-medium text-muted">
              {range}
            </span>
            <button
              onClick={onRefresh}
              title="Refresh now"
              className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line-strong bg-surface text-muted transition hover:border-brand hover:text-brand"
            >
              <ArrowClockwise size={15} weight="bold" />
            </button>
          </div>
        )}
      </div>
      {fetchedAt && !stale && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          Updated {timeAgo(fetchedAt)} · refreshes every minute
        </p>
      )}
    </header>
  );
}

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

/* ------------------------------------------------------------------ *
 * KPI row — GA4 (sessions / users / views) + GSC (clicks / impressions).
 * Each tile carries its own zero-filled sparkline. No delta / no
 * percentage-change theatre: the traffic is double-digit and a fake
 * "+12%" would be noise, not signal.
 * ------------------------------------------------------------------ */
function Kpis({ ga4, gsc, ga4Trend, gscTrend, range }) {
  const tiles = [];
  if (half(ga4)) {
    tiles.push(
      { icon: Users, label: "Sessions", value: nf(ga4.totals?.sessions), spark: ga4Trend.map((r) => r.sessions), tone: "text-brand" },
      { icon: Users, label: "Users", value: nf(ga4.totals?.users), spark: ga4Trend.map((r) => r.users), tone: "text-violet" },
      { icon: Eye, label: "Page views", value: nf(ga4.totals?.views), spark: ga4Trend.map((r) => r.views), tone: "text-brand" },
    );
  }
  if (half(gsc)) {
    tiles.push(
      { icon: CursorClick, label: "Search clicks", value: nf(gsc.totals?.clicks), spark: gscTrend.map((r) => r.clicks), tone: "text-brand" },
      { icon: MagnifyingGlass, label: "Impressions", value: nf(gsc.totals?.impressions), spark: gscTrend.map((r) => r.impressions), tone: "text-violet" },
    );
  }

  if (tiles.length === 0) {
    return (
      <Card className="mb-8 p-5 text-[13.5px] leading-relaxed text-muted">
        Neither Google Analytics nor Search Console returned any figures for {range?.toLowerCase() || "this window"}.
      </Card>
    );
  }

  return (
    <div className="mb-8 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <StatTile
          key={t.label}
          icon={t.icon}
          label={t.label}
          value={t.value}
          sub={range}
          spark={t.spark}
          sparkTone={t.tone}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel — a titled chart/table card, matching SecondBrain's OverviewCard.
 * ------------------------------------------------------------------ */
function Panel({ icon: Icon, title, hint, className = "", children }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-line bg-surface shadow-card ${className}`}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
        {Icon && <Icon size={13} weight="bold" className="text-brand" />}
        {title}
        {hint && <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-faint">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// Inline honest message when one half is null / errored — the other half stays live.
function HalfNotice({ error, name }) {
  return (
    <div className="flex items-start gap-2.5 px-1 py-6 text-[13px] leading-relaxed text-muted">
      <WarningCircle size={17} weight="fill" className="mt-0.5 shrink-0 text-faint" />
      {error ? (
        <span>
          {name} answered with an error, so this is blank for now. It usually clears itself on the next
          refresh. <span className="font-mono text-[11.5px] text-faint">({error})</span>
        </span>
      ) : (
        <span>
          {name} isn't connected yet, so there's nothing to show here. Hook it up on the{" "}
          <span className="font-medium text-ink-2">Connections</span> screen and it'll fill in.
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * LineChart — dependency-free, responsive inline SVG.
 *   dates:  string[] (YYYY-MM-DD)
 *   series: [{ key, label, color, values:number[], area?:bool }]
 * One y-axis (never dual). Hairline grid, 2px lines, ~10% area wash,
 * a crosshair + tooltip on hover, and a legend for 2+ series.
 * ------------------------------------------------------------------ */
function LineChart({ dates, series, height = 210 }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState(null); // index

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = dates.length;
  const H = height;
  const PL = 34, PR = 14, PT = 12, PB = 24;
  const innerW = Math.max(0, w - PL - PR);
  const innerH = H - PT - PB;

  const rawMax = Math.max(1, ...series.flatMap((s) => s.values));
  const max = niceMax(rawMax);
  const x = (i) => PL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => PT + innerH - (v / max) * innerH;

  const yTicks = [0, max / 2, max];
  // ~5 evenly spaced date ticks
  const xTickIdx = n <= 1 ? [0] : [0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1];

  function onMove(e) {
    if (!svgRef.current || n === 0) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const frac = (px - PL) / (innerW || 1);
    const idx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    setHover(idx);
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {w > 0 && (
        <svg
          ref={svgRef}
          width={w}
          height={H}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          className="block touch-none"
        >
          {/* horizontal gridlines + y labels */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={PL} x2={w - PR} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={PL - 6} y={y(v) + 3.5} textAnchor="end" className="fill-faint" style={{ fontSize: 10 }}>
                {compact(Math.round(v))}
              </text>
            </g>
          ))}

          {/* x date labels */}
          {xTickIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 7} textAnchor="middle" className="fill-faint" style={{ fontSize: 10 }}>
              {prettyDay(dates[i])}
            </text>
          ))}

          {/* series: area wash then 2px line */}
          {series.map((s) => {
            const line = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
            const area = `${line} L${x(n - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;
            return (
              <g key={s.key}>
                {s.area && <path d={area} fill={s.color} opacity="0.1" />}
                <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })}

          {/* crosshair + focused markers */}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PT} y2={PT + innerH} stroke="var(--color-line-strong)" strokeWidth="1" />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(s.values[hover])}
                  r="4"
                  fill={s.color}
                  stroke="var(--color-surface)"
                  strokeWidth="2"
                />
              ))}
            </g>
          )}
        </svg>
      )}

      {/* tooltip */}
      {hover != null && w > 0 && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface px-2.5 py-1.5 shadow-card"
          style={{
            left: Math.min(Math.max(x(hover), 60), Math.max(w - 60, 60)),
            top: 2,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-[10.5px] font-medium text-faint">{prettyDay(dates[hover])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-muted">{s.label}</span>
              <span className="ml-auto pl-3 font-mono font-semibold tabular-nums text-ink">{nf(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceMax(m) {
  if (m <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(m)));
  const n = m / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
// compact axis labels: 1,000 → 1k
function compact(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return String(v);
}

/* ------------------------------------------------------------------ *
 * SourceBars — part-to-whole by channel. Magnitude job → sequential
 * single hue (brand); identity comes from the labels, not colour.
 * ------------------------------------------------------------------ */
function SourceBars({ sources }) {
  const rows = [...(sources || [])].sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  const total = rows.reduce((a, r) => a + (r.sessions || 0), 0) || 1;
  const max = Math.max(1, ...rows.map((r) => r.sessions || 0));

  if (rows.length === 0) return <p className="px-1 py-4 text-[13px] text-faint">No sources recorded yet.</p>;

  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const pct = Math.round(((r.sessions || 0) / total) * 100);
        return (
          <div key={r.channel} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-[12.5px] font-medium text-ink-2" title={r.channel}>
              {r.channel}
            </span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${Math.max(3, ((r.sessions || 0) / max) * 100)}%`, opacity: 0.85 }}
              />
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink">{nf(r.sessions)}</span>
            <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * TopPages — GA4. A scannable table with an inline magnitude meter on
 * the primary metric (sessions).
 * ------------------------------------------------------------------ */
function TopPages({ pages }) {
  const rows = pages || [];
  const max = Math.max(1, ...rows.map((p) => p.sessions || 0));
  if (rows.length === 0) return <p className="px-1 py-4 text-[13px] text-faint">No page data yet.</p>;

  return (
    <div className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
        <span className="flex-1">Page</span>
        <span className="w-14 text-right">Sessions</span>
        <span className="w-12 text-right">Users</span>
        <span className="w-12 text-right">Views</span>
      </div>
      <ul>
        {rows.map((p) => (
          <li key={p.page} className="group flex items-center gap-3 border-b border-line/60 px-1 py-2 last:border-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink-2" title={p.page}>
                {prettyPath(p.page)}
              </span>
              <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full rounded-full bg-brand/60" style={{ width: `${((p.sessions || 0) / max) * 100}%` }} />
              </span>
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-[12.5px] font-semibold tabular-nums text-ink">{nf(p.sessions)}</span>
            <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">{nf(p.users)}</span>
            <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">{nf(p.views)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Strip the origin and collapse "/" → "Home" so paths read cleanly.
function prettyPath(url) {
  let p = String(url || "");
  p = p.replace(/^https?:\/\/[^/]+/, "");
  if (p === "" || p === "/") return "/ (home)";
  return p;
}

/* ------------------------------------------------------------------ *
 * TopQueries — GSC. Clicks / impressions / CTR (%) / position (1 dp).
 * Junk queries (e.g. a school that shares the company name) are real
 * data and shown as-is — no cleansing.
 * ------------------------------------------------------------------ */
function TopQueries({ queries }) {
  const rows = (queries || []).slice(0, 15);
  if (rows.length === 0) return <p className="px-1 py-4 text-[13px] text-faint">No search queries yet.</p>;

  return (
    <div className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
        <span className="flex-1">Query</span>
        <span className="w-10 text-right">Clicks</span>
        <span className="w-14 text-right">Impr.</span>
        <span className="w-12 text-right">CTR</span>
        <span className="w-10 text-right">Pos.</span>
      </div>
      <ul>
        {rows.map((q, i) => (
          <li key={`${q.query}-${i}`} className="flex items-center gap-3 border-b border-line/60 px-1 py-2 last:border-0">
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2" title={q.query}>
              {q.query}
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[12.5px] font-semibold tabular-nums text-ink">{nf(q.clicks)}</span>
            <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">{nf(q.impressions)}</span>
            <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">{fmtCtr(q.ctr)}</span>
            <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">{fmtPos(q.position)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const fmtCtr = (c) => `${((c || 0) * 100).toFixed(1)}%`;
const fmtPos = (p) => (p == null ? "—" : Number(p).toFixed(1));

/* ------------------------------------------------------------------ *
 * Small print — honest data-freshness caveats.
 * ------------------------------------------------------------------ */
function FreshnessNote() {
  return (
    <p className="mb-2 flex items-start gap-2 text-[11.5px] leading-relaxed text-faint">
      <Clock size={13} className="mt-0.5 shrink-0" />
      <span>
        A read-only mirror of the live site. Analytics lags a few hours. Search Console runs up to
        yesterday, but its last day or two are preliminary and Google may still revise them. Numbers
        refresh every minute while this screen is open.
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Setup card — shown only when neither source is configured (409).
 * ------------------------------------------------------------------ */
function SetupCard() {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand">
        <PlugsConnected size={24} weight="fill" />
      </div>
      <h2 className="text-[16px] font-semibold text-ink">No analytics connected yet</h2>
      <p className="max-w-md text-[13.5px] leading-relaxed text-muted">
        Once you link Google Analytics and Search Console on the{" "}
        <span className="font-medium text-ink-2">Connections</span> screen, this page fills in with the
        live site's visitors, sources, top pages and search queries. Nothing here changes the site — it's a
        read-only window.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * First-load skeleton — mirrors the real layout so nothing jumps.
 * ------------------------------------------------------------------ */
function LoadingSkeleton() {
  return (
    <div>
      <div className="mb-8 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl border border-line bg-surface-2" />
        ))}
      </div>
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-[280px] animate-pulse rounded-xl border border-line bg-surface-2" />
        ))}
      </div>
      <div className="mb-8 h-[220px] animate-pulse rounded-xl border border-line bg-surface-2" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-[320px] animate-pulse rounded-xl border border-line bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
