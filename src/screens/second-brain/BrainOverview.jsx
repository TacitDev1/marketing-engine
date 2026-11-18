import { useMemo } from "react";
import {
  Brain,
  Graph as GraphIcon,
  CircleNotch,
  LinkSimple,
  Clock,
  TrendUp,
  Fire,
  Stack,
  CaretRight,
  ArrowRight,
  Broom,
} from "@phosphor-icons/react";
import { StatTile } from "../../components/ui.jsx";
import { ago, prettyType, TYPE_COLOR } from "./helpers.js";

// ---- the living "brain" overview (shown when no note is open) ----

export default function BrainOverview({ pages, byType, connections, hubs, recent, pulse, neighbors, unreachable, librarian, onRunLibrarian, onOpen, onFocusType, onOpenGraph }) {
  // Empty (genuine cold start) gets the friendly welcome, not a wall of zeros.
  if (pages.length === 0) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div className="reveal">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Brain weight="fill" size={28} />
          </div>
          <h2 className="text-lg font-semibold text-ink">Your marketing second brain</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted">
            {unreachable
              ? "Jarvis is starting up. Give it a moment and it'll reconnect."
              : "This fills itself as Jarvis researches. Each finding becomes an interconnected note here."}
          </p>
        </div>
      </div>
    );
  }

  const maxType = byType[0]?.[1] || 1;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      {unreachable && (
        <div className="reveal mb-5 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
          <Clock size={15} weight="fill" className="mt-0.5 shrink-0" />
          <span>Jarvis is catching up, so these may be a moment behind. Your work is safe.</span>
        </div>
      )}

      <header className="reveal mb-6">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
          <Brain size={13} weight="fill" className="text-brand" /> Knowledge base
        </div>
        <h1 className="mt-1.5 text-[24px] font-bold tracking-[-0.035em] text-ink">Your marketing second brain</h1>
        <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-relaxed text-muted">
          A living, interconnected map of everything Jarvis has learned. It grows and cross-links itself
          as Jarvis works. Pick a note on the left, or explore the whole thing below.
        </p>
      </header>

      {/* Stat row — the vitals */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4" style={{ animationDelay: "40ms" }}>
        <div className="reveal"><StatTile icon={Brain} label="Notes" value={pages.length} sub="in the knowledge base" /></div>
        <div className="reveal" style={{ animationDelay: "80ms" }}>
          <StatTile icon={LinkSimple} label="Connections" value={connections} sub="links between notes" sparkTone="text-violet" />
        </div>
        <div className="reveal" style={{ animationDelay: "120ms" }}>
          <StatTile icon={TrendUp} label="Grown this week" value={pulse.week} sub="notes added or refreshed" spark={pulse.spark} sparkTone="text-good" />
        </div>
        <div className="reveal" style={{ animationDelay: "160ms" }}>
          <StatTile icon={Stack} label="Clusters" value={byType.length} sub="types of knowledge" />
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_300px]">
        {/* Main column: recently grown */}
        <div className="reveal min-w-0" style={{ animationDelay: "120ms" }}>
          <OverviewCard icon={Clock} title="Recently grown" hint="newest first">
            {recent.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-faint">No timestamps yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((p) => (
                  <li key={p.slug}>
                    <button onClick={() => onOpen(p.slug)} className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2">
                      <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full ring-2 ring-surface" style={{ background: TYPE_COLOR[p.type] || TYPE_COLOR.concept }} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-medium text-ink-2 group-hover:text-brand">{p.title}</span>
                          <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">{ago(p.updated)}</span>
                        </span>
                        {p.summary && <span className="mt-0.5 line-clamp-1 block text-[12.5px] leading-snug text-faint">{p.summary}</span>}
                      </span>
                      <CaretRight size={13} className="mt-1 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </OverviewCard>

          {/* Graph teaser — the centerpiece invitation */}
          <button
            onClick={onOpenGraph}
            className="reveal group relative mt-4 block w-full overflow-hidden rounded-xl border border-line bg-surface text-left shadow-card transition-colors hover:border-brand/40"
            style={{ animationDelay: "200ms" }}
          >
            <MiniGraph pages={pages} neighbors={neighbors} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-surface via-surface/85 to-transparent px-4 pb-3.5 pt-10">
              <div>
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <GraphIcon size={15} weight="fill" className="text-brand" /> Knowledge graph
                </div>
                <p className="mt-0.5 text-[12px] text-muted">{pages.length} notes · {connections} connections, wired together</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[12px] font-medium text-brand transition-colors group-hover:border-brand group-hover:bg-brand-soft">
                Open graph <ArrowRight size={13} weight="bold" />
              </span>
            </div>
          </button>
        </div>

        {/* Side column: clusters + hubs */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="reveal" style={{ animationDelay: "160ms" }}>
            <OverviewCard icon={Stack} title="Explore by type">
              <ul className="p-2">
                {byType.map(([t, n]) => (
                  <li key={t}>
                    <button onClick={() => onFocusType(t)} className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TYPE_COLOR[t] || TYPE_COLOR.concept }} />
                      <span className="w-16 shrink-0 truncate text-left text-[12.5px] font-medium text-ink-2 group-hover:text-brand">{prettyType(t)}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(6, (n / maxType) * 100)}%`, background: TYPE_COLOR[t] || TYPE_COLOR.concept, opacity: 0.55 }} />
                      </span>
                      <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </OverviewCard>
          </div>

          <div className="reveal" style={{ animationDelay: "220ms" }}>
            <OverviewCard icon={Fire} title="Most connected">
              {hubs.length === 0 ? (
                <p className="px-4 py-5 text-center text-[12.5px] leading-relaxed text-faint">No links yet. The Librarian cross-links notes as it tidies.</p>
              ) : (
                <ul className="p-2">
                  {hubs.map(({ p, deg }) => (
                    <li key={p.slug}>
                      <button onClick={() => onOpen(p.slug)} className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[p.type] || TYPE_COLOR.concept }} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-2 group-hover:text-brand">{p.title}</span>
                        <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10.5px] text-faint">
                          <LinkSimple size={10} weight="bold" />{deg}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </OverviewCard>
          </div>

          {librarian && (
            <div className="reveal" style={{ animationDelay: "260ms" }}>
              <OverviewCard icon={Broom} title="The Librarian">
                <div className="px-4 py-3.5">
                  <p className="text-[12.5px] leading-relaxed text-muted">
                    {librarian.running ? (
                      <span className="flex items-center gap-1.5 text-ink-2">
                        <CircleNotch size={13} className="animate-spin text-brand" /> Tidying the wiki…
                      </span>
                    ) : librarian.lastRunAt ? (
                      <>
                        Last tidied {ago(librarian.lastRunAt)}
                        {librarian.lastResult && (
                          <span className="mt-0.5 block text-faint">
                            {librarian.lastResult.merged + librarian.lastResult.linked + (librarian.lastResult.orphansLinked || 0) > 0
                              ? `merged ${librarian.lastResult.merged}, linked ${librarian.lastResult.linked + (librarian.lastResult.orphansLinked || 0)}`
                              : "everything was already tidy"}
                            {librarian.lastResult.errors ? ` · ${librarian.lastResult.errors} error${librarian.lastResult.errors === 1 ? "" : "s"}` : ""}
                          </span>
                        )}
                      </>
                    ) : (
                      "Hasn't run yet — it tidies the wiki every 3 hours on its own."
                    )}
                  </p>
                  <button
                    onClick={onRunLibrarian}
                    disabled={librarian.running}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                  >
                    <Broom size={13} weight="bold" /> Tidy now
                  </button>
                </div>
              </OverviewCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewCard({ icon: Icon, title, hint, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
        {Icon && <Icon size={13} weight="bold" className="text-brand" />}
        {title}
        {hint && <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// A calm, decorative constellation preview of the real graph — a golden-angle
// scatter of the best-connected notes, with the actual [[links]] drawn between
// any two that made the sample. Pure SVG, no physics, no extra fetch: it just
// invites you into the full force-graph. Colours track the note types.
function MiniGraph({ pages, neighbors }) {
  const { dots, edges } = useMemo(() => {
    const W = 600, H = 190, cx = W / 2, cy = H / 2;
    const ranked = [...pages].sort((a, b) => (neighbors[b.slug]?.size || 0) - (neighbors[a.slug]?.size || 0)).slice(0, 60);
    const pos = {};
    const dots = ranked.map((p, i) => {
      const deg = neighbors[p.slug]?.size || 0;
      const ang = i * 2.399963; // golden angle → even, organic spread
      const rad = Math.sqrt(i / ranked.length) * (W * 0.46);
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad * 0.62; // squash to the wide card
      pos[p.slug] = { x, y };
      return { x, y, r: 2.4 + Math.min(4.5, deg * 0.7), color: TYPE_COLOR[p.type] || TYPE_COLOR.concept, i };
    });
    const seen = new Set();
    const edges = [];
    for (const p of ranked) {
      for (const nb of neighbors[p.slug] || []) {
        if (!pos[nb]) continue;
        const key = [p.slug, nb].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a: pos[p.slug], b: pos[nb] });
        if (edges.length > 90) break;
      }
      if (edges.length > 90) break;
    }
    return { dots, edges };
  }, [pages, neighbors]);

  return (
    <svg viewBox="0 0 600 190" preserveAspectRatio="xMidYMid slice" className="block h-[190px] w-full" aria-hidden="true">
      <g stroke="var(--color-line-strong)" strokeWidth="0.6" opacity="0.55">
        {edges.map((e, i) => (
          <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
        ))}
      </g>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.color} opacity={0.9}>
          {i % 11 === 0 && (
            <animate attributeName="opacity" values="0.9;0.4;0.9" dur={`${3 + (i % 5)}s`} repeatCount="indefinite" />
          )}
        </circle>
      ))}
    </svg>
  );
}
