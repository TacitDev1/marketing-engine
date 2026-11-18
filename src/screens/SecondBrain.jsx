import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Brain,
  MagnifyingGlass,
  Graph as GraphIcon,
  Cards,
  ArrowUDownLeft,
  ArrowURightUp,
  Sparkle,
  CircleNotch,
  LinkSimple,
  Stack,
} from "@phosphor-icons/react";
import { slugify, parseTime, DAY, prettyType, TYPE_COLOR } from "./second-brain/helpers.js";
import { Seg, FilterChip } from "./second-brain/controls.jsx";
import LinkPanel from "./second-brain/LinkPanel.jsx";
import NotePane from "./second-brain/NotePane.jsx";
import AskPane from "./second-brain/AskPane.jsx";
import BrainOverview from "./second-brain/BrainOverview.jsx";
import Tools from "./second-brain/Tools.jsx";
import GraphView from "./second-brain/GraphView.jsx";

export default function SecondBrain({ active = true }) {
  const [pages, setPages] = useState([]);
  const [sel, setSel] = useState(null); // slug
  const [view, setView] = useState("notes"); // notes | graph
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState(null); // null = every type
  const [ask, setAsk] = useState(null); // {question, answer, used} or null
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  const [librarian, setLibrarian] = useState(null);

  const load = useCallback(() => {
    fetch("/api/wiki/all")
      .then((r) => r.json())
      .then((d) => {
        setPages(d.pages || []);
        setUnreachable(false);
      })
      // Keep the last loaded notes on a failed poll — a dead brain must not
      // render as "the wiki is empty".
      .catch(() => setUnreachable(true))
      .finally(() => setLoading(false));
    // The Librarian's status is a nice-to-have — never let it break the load.
    fetch("/api/librarian")
      .then((r) => r.json())
      .then(setLibrarian)
      .catch(() => {});
  }, []);

  async function runLibrarianNow() {
    setLibrarian((prev) => ({ ...prev, running: true }));
    try {
      const r = await fetch("/api/librarian/run", { method: "POST" });
      if (!r.ok && r.status !== 409) setLibrarian((prev) => ({ ...prev, running: false }));
    } catch {
      setLibrarian((prev) => ({ ...prev, running: false }));
    }
  }

  useEffect(() => {
    // Poll only while visible; refreshes on re-activation, so anything the
    // researcher ingested into the wiki shows up the moment you open this screen.
    if (!active) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, active]);

  const bySlug = useMemo(() => Object.fromEntries(pages.map((p) => [p.slug, p])), [pages]);
  const titleToSlug = useCallback(
    (title) => {
      const s = slugify(title);
      if (bySlug[s]) return s;
      const m = pages.find((p) => p.title.toLowerCase() === String(title).toLowerCase());
      return m ? m.slug : s;
    },
    [pages, bySlug]
  );

  // Backlinks: which pages link TO `slug`.
  const backlinks = useMemo(() => {
    const map = {};
    for (const p of pages) {
      for (const l of p.links || []) {
        const target = bySlug[l] ? l : titleToSlug(l);
        (map[target] = map[target] || []).push(p.slug);
      }
    }
    return map;
  }, [pages, bySlug, titleToSlug]);

  // Neighbour sets over REAL [[links]] (existing targets only). One structure
  // gives us: per-note connection count (degree), the total edge count, and the
  // most-connected "hub" notes — everything the overview needs, no extra fetch.
  const neighbors = useMemo(() => {
    const m = {};
    const add = (a, b) => {
      (m[a] = m[a] || new Set()).add(b);
      (m[b] = m[b] || new Set()).add(a);
    };
    for (const p of pages)
      for (const l of p.links || []) {
        const t = bySlug[l] ? l : titleToSlug(l);
        if (bySlug[t] && t !== p.slug) add(p.slug, t);
      }
    return m;
  }, [pages, bySlug, titleToSlug]);

  const degreeOf = useCallback((slug) => neighbors[slug]?.size || 0, [neighbors]);

  // Counts per type, most-populous first — powers both the filter rail and the
  // overview's cluster panel. Only types that actually exist are shown.
  const byType = useMemo(() => {
    const m = {};
    for (const p of pages) m[p.type || "concept"] = (m[p.type || "concept"] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [pages]);

  const connections = useMemo(
    () => Object.values(neighbors).reduce((a, s) => a + s.size, 0) / 2,
    [neighbors]
  );

  const hubs = useMemo(
    () =>
      [...pages]
        .map((p) => ({ p, deg: degreeOf(p.slug) }))
        .filter((x) => x.deg > 0)
        .sort((a, b) => b.deg - a.deg)
        .slice(0, 5),
    [pages, degreeOf]
  );

  // Recently touched notes (the researcher stamps `updated` on every write, so
  // this is the visible pulse of the wiki growing).
  const recent = useMemo(
    () =>
      [...pages]
        .filter((p) => parseTime(p.updated) != null)
        .sort((a, b) => parseTime(b.updated) - parseTime(a.updated))
        .slice(0, 6),
    [pages]
  );

  // This-week pulse + an 8-day growth sparkline (notes touched per day).
  const pulse = useMemo(() => {
    const now = Date.now();
    const week = pages.filter((p) => {
      const t = parseTime(p.updated);
      return t != null && now - t < 7 * DAY;
    }).length;
    const spark = Array.from({ length: 8 }, (_, i) => {
      const end = now - (7 - i) * DAY;
      const start = end - DAY;
      return pages.filter((p) => {
        const t = parseTime(p.updated);
        return t != null && t >= start && t < end;
      }).length;
    });
    return { week, spark };
  }, [pages]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = typeFilter ? pages.filter((p) => (p.type || "concept") === typeFilter) : pages;
    if (s)
      list = list.filter(
        (p) => p.title.toLowerCase().includes(s) || p.summary?.toLowerCase().includes(s) || p.body?.toLowerCase().includes(s)
      );
    return list;
  }, [pages, q, typeFilter]);

  const current = sel ? bySlug[sel] : null;

  function open(slug) {
    setSel(slug);
    setView("notes");
    setAsk(null);
  }

  // Jump into the browse rail filtered to one cluster (from the overview).
  function focusType(t) {
    setTypeFilter(t);
    setSel(null);
    setAsk(null);
    setView("notes");
  }

  async function runAsk() {
    if (!q.trim()) return;
    // One ask at a time: each is a 30-120s model call, and an impatient second
    // Enter used to fire concurrent calls whose answers raced onto the pane.
    if (ask && ask.answer === null) return;
    const question = q.trim();
    setAsk({ question, answer: null });
    try {
      const r = await fetch("/api/wiki/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      setAsk({ question, ...(r.ok ? await r.json() : { answer: "Jarvis isn't responding right now." }) });
    } catch {
      setAsk({ question, answer: "Couldn't reach Jarvis — try again in a moment." });
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-line px-6 py-3">
        <div className="flex items-center gap-2">
          <Brain weight="fill" size={20} className="text-brand" />
          <span className="text-[15px] font-semibold text-ink">Second Brain</span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-faint">{pages.length} notes</span>
        </div>
        <div className="ml-2 flex rounded-lg border border-line-strong bg-surface-2 p-0.5">
          <Seg active={view === "notes"} onClick={() => setView("notes")} icon={Cards}>Notes</Seg>
          <Seg active={view === "graph"} onClick={() => setView("graph")} icon={GraphIcon}>Graph</Seg>
        </div>
        <div className="relative ml-auto w-80 max-w-[40%]">
          <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runAsk()}
            placeholder="Search notes, or press Enter to ask…"
            className="w-full rounded-lg border border-line-strong bg-canvas py-1.5 pl-8 pr-3 text-[14px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
          />
        </div>
        <button onClick={runAsk} title="Ask Jarvis" className="rounded-lg border border-line-strong p-2 text-muted hover:border-brand hover:text-brand">
          <Sparkle size={16} weight="fill" />
        </button>
        <Tools onChanged={load} />
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-[14px] text-muted">
          <CircleNotch size={18} className="mr-2 animate-spin" /> Loading your second brain…
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: browse rail — bundled by type, then a scannable list */}
          <aside className="scroll-quiet w-72 shrink-0 overflow-y-auto border-r border-line">
            <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-3 py-3 backdrop-blur">
              <div className="mb-2 flex items-center gap-1.5 px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                <Stack size={12} weight="bold" /> Browse by type
              </div>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip active={!typeFilter} count={pages.length} onClick={() => setTypeFilter(null)}>
                  All
                </FilterChip>
                {byType.map(([t, n]) => (
                  <FilterChip
                    key={t}
                    active={typeFilter === t}
                    count={n}
                    color={TYPE_COLOR[t] || TYPE_COLOR.concept}
                    onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                  >
                    {prettyType(t)}
                  </FilterChip>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="p-4 text-[13px] leading-relaxed text-faint">
                {unreachable
                  ? "Jarvis is starting up. Give it a moment and it'll reconnect."
                  : q || typeFilter
                    ? "No notes match this filter."
                    : "No notes yet. This fills as Jarvis researches."}
              </p>
            ) : (
              <ul className="py-1">
                {filtered.map((p, i) => (
                  <li key={p.slug} className="reveal px-2" style={{ animationDelay: `${Math.min(i, 8) * 22}ms` }}>
                    <button
                      onClick={() => open(p.slug)}
                      className={`group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        sel === p.slug ? "bg-brand-soft" : "hover:bg-surface-2"
                      }`}
                    >
                      <span
                        className="mt-[5px] h-2 w-2 shrink-0 rounded-full ring-2 ring-surface"
                        style={{ background: TYPE_COLOR[p.type] || TYPE_COLOR.concept }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate text-[13px] font-medium ${sel === p.slug ? "text-brand" : "text-ink-2"}`}>
                            {p.title}
                          </span>
                          {degreeOf(p.slug) > 0 && (
                            <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-faint">
                              <LinkSimple size={10} weight="bold" />
                              {degreeOf(p.slug)}
                            </span>
                          )}
                        </span>
                        {p.summary && <span className="mt-0.5 line-clamp-1 block text-[12px] leading-snug text-faint">{p.summary}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* Center */}
          <main className="scroll-quiet flex-1 overflow-y-auto">
            {view === "graph" ? (
              <GraphView onOpen={open} selected={sel} active={active} />
            ) : ask ? (
              <AskPane ask={ask} onOpen={(t) => open(titleToSlug(t))} onClose={() => setAsk(null)} />
            ) : current ? (
              <NotePane key={current.slug} page={current} onOpenLink={(t) => open(titleToSlug(t))} onChanged={load} onDeleted={() => { setSel(null); load(); }} />
            ) : (
              <BrainOverview
                pages={pages}
                byType={byType}
                connections={connections}
                hubs={hubs}
                recent={recent}
                pulse={pulse}
                neighbors={neighbors}
                unreachable={unreachable}
                librarian={librarian}
                onRunLibrarian={runLibrarianNow}
                onOpen={open}
                onFocusType={focusType}
                onOpenGraph={() => setView("graph")}
              />
            )}
          </main>

          {/* Right: connections rail (notes mode only) */}
          {view === "notes" && current && (
            <aside className="scroll-quiet w-72 shrink-0 overflow-y-auto border-l border-line">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">
                <GraphIcon size={13} weight="bold" /> Connections
                <span className="ml-auto font-mono text-[11px] normal-case tracking-normal text-faint">
                  {degreeOf(current.slug)}
                </span>
              </div>
              <div className="p-4">
                <LinkPanel
                  title="Linked from"
                  icon={ArrowUDownLeft}
                  slugs={backlinks[current.slug] || []}
                  bySlug={bySlug}
                  onOpen={open}
                  empty="Nothing points here yet."
                />
                <div className="mt-5">
                  <LinkPanel
                    title="Links out"
                    icon={ArrowURightUp}
                    slugs={(current.links || []).map((l) => (bySlug[l] ? l : titleToSlug(l)))}
                    bySlug={bySlug}
                    onOpen={open}
                    empty="This note links nowhere yet."
                  />
                </div>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
