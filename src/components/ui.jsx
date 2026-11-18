// Small shared primitives so screens stay consistent.
// One radius scale (rounded-xl for surfaces, rounded-lg for controls),
// one accent (brand blue), restrained elevation via .shadow-card.
//
// EVERYTHING here is token-driven (text-ink, bg-surface, bg-good-soft …),
// so it re-themes light/dark for free. Never hardcode slate/gray/emerald
// palette classes in a screen — use these primitives or the tokens.
//
// Layout language for list-heavy screens (Jarvis is the pilot):
//   SectionHeader  — a title + count + optional action above a list
//   Tabs           — segmented tab bar with per-tab counts
//   ListRow        — the scannable row: leading slot / title+summary / actions / meta
//   Badge          — semantic pastel tag (fronts, services, BUILD/AVOID, status)
//   IconButton     — a real hit-target for the small check / dismiss actions
//   StatusDot      — the one liveness dot, reused everywhere
//   EmptyState     — a proper empty state, not a lonely gray sentence
//
// New in Wave 1 (dashboard foundation):
//   StatTile       — KPI card: label + big tabular value + sub + sparkline
//   Sparkline      — dependency-free inline SVG trend line
//   AgentCard      — mission-control card: avatar + title + status + line + mono meta
//   ActivityFeed   — timeline rail of live events

import { forwardRef, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";

export function Button({ variant = "primary", className = "", ...props }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const variants = {
    primary:
      "bg-brand text-white hover:bg-brand-hover shadow-[0_4px_14px_-2px_color-mix(in_srgb,var(--color-brand)_40%,transparent)]",
    ghost: "text-ink-2 hover:bg-surface-2",
    outline:
      "border border-line-strong bg-surface text-ink-2 hover:border-brand hover:text-brand",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export const Card = forwardRef(function Card({ className = "", ...props }, ref) {
  return (
    <div
      ref={ref}
      className={`rounded-xl border border-line bg-surface shadow-card ${className}`}
      {...props}
    />
  );
});

export function Eyebrow({ children }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-faint">
      {children}
    </span>
  );
}

export function Pill({ active = false, className = "", ...props }) {
  return (
    <button
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active
          ? "bg-brand text-white shadow-[0_4px_14px_-2px_color-mix(in_srgb,var(--color-brand)_35%,transparent)]"
          : "border border-line-strong bg-surface text-muted hover:border-brand hover:text-brand"
      } ${className}`}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Select — themed, accessible dropdown that replaces the native
 * <select>. The browser default ignored our dark theme and truncated
 * long options; this shows full labels, per-option badges (so you can
 * see WHAT KIND of thing you're picking), and an optional search box.
 *
 *   options: [{ value, label, sub?, prefix?, disabled?,
 *               badges?: [{ tone, text }] }]
 *   onChange(value)   — receives the value, not an event
 *   searchable        — adds a filter box (good for long lists)
 *
 * The open list renders in a portal (position: fixed) so it never
 * clips inside scroll containers like the poster controls panel.
 * ------------------------------------------------------------------ */
export function Select({
  value,
  onChange,
  options = [],
  placeholder = "Select…",
  searchable = false,
  disabled = false,
  className = "",
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;
  const q = query.trim().toLowerCase();
  // A row is either a { heading } section title (not selectable) or a normal
  // option. isSel = something the user can actually pick.
  const isSel = (o) => o && o.heading == null && !o.disabled;
  const matchesQ = (o) =>
    `${o.prefix || ""} ${o.label} ${o.sub || ""} ${(o.badges || []).map((b) => b.text).join(" ")}`
      .toLowerCase()
      .includes(q);
  let filtered;
  if (!q) {
    filtered = options;
  } else {
    // Keep matching options; keep a section title only if something under it matched.
    const kept = [];
    let pending = null;
    for (const o of options) {
      if (o.heading != null) {
        pending = o;
        continue;
      }
      if (matchesQ(o)) {
        if (pending) {
          kept.push(pending);
          pending = null;
        }
        kept.push(o);
      }
    }
    filtered = kept;
  }

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const up = below < 260 && above > below;
    const maxH = Math.min(380, Math.max(160, (up ? above : below) - 16));
    setPos({
      left: r.left,
      width: r.width,
      top: up ? undefined : r.bottom + 6,
      bottom: up ? window.innerHeight - r.top + 6 : undefined,
      maxH,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = (e) => {
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : options.findIndex(isSel));
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlight on a real (selectable) row as the filtered list changes.
  useEffect(() => {
    setActive((a) => (isSel(filtered[a]) ? a : Math.max(0, filtered.findIndex(isSel))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filtered.length]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (opt) => {
    if (!isSel(opt)) return;
    onChange?.(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const move = (dir) => {
    if (!filtered.length) return;
    let i = active;
    for (let s = 0; s < filtered.length; s++) {
      i = (i + dir + filtered.length) % filtered.length;
      if (isSel(filtered[i])) return setActive(i);
    }
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[active]);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-left text-[13px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 ${
          open ? "border-brand" : "border-line-strong hover:border-brand/60"
        } ${className}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selected ? (
            <>
              {selected.prefix && (
                <span className="shrink-0 text-[11px] font-semibold text-good">{selected.prefix}</span>
              )}
              <span className="truncate text-ink-2">{selected.label}</span>
              {selected.badges?.map((b, i) => (
                <Badge key={i} tone={b.tone} className="shrink-0">
                  {b.text}
                </Badge>
              ))}
            </>
          ) : (
            <span className="truncate text-faint">{placeholder}</span>
          )}
        </span>
        <CaretDown
          size={14}
          weight="bold"
          className={`shrink-0 text-faint transition ${open ? "rotate-180 text-brand" : ""}`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              zIndex: 1000,
            }}
            className="overflow-hidden rounded-xl border border-line bg-surface shadow-[0_16px_50px_-12px_rgba(0,0,0,0.5)]"
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <MagnifyingGlass size={14} className="shrink-0 text-faint" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search…"
                  className="w-full bg-transparent text-[13px] text-ink-2 outline-none placeholder:text-faint"
                />
              </div>
            )}
            <div ref={listRef} className="scroll-quiet overflow-y-auto py-1" style={{ maxHeight: pos.maxH }}>
              {filtered.length === 0 && <p className="px-3 py-3 text-[12.5px] text-faint">No matches.</p>}
              {filtered.map((o, i) => {
                if (o.heading != null) {
                  return (
                    <div
                      key={`h-${i}`}
                      className="sticky top-0 z-[1] bg-surface px-3 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint"
                    >
                      {o.heading}
                    </div>
                  );
                }
                const on = o.value === value;
                const act = i === active;
                return (
                  <div
                    key={o.value ?? i}
                    data-idx={i}
                    role="option"
                    aria-selected={on}
                    aria-disabled={o.disabled || undefined}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={`flex items-start gap-2.5 px-3 py-2 text-[13px] ${
                      o.disabled ? "cursor-not-allowed opacity-40" : `cursor-pointer ${act ? "bg-surface-2" : ""}`
                    }`}
                  >
                    <span className="mt-0.5 w-3.5 shrink-0 text-brand">{on && <Check size={14} weight="bold" />}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {o.prefix && <span className="text-[11px] font-semibold text-good">{o.prefix}</span>}
                        <span className={on ? "font-semibold text-ink" : "text-ink-2"}>{o.label}</span>
                      </span>
                      {o.badges?.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                          {o.badges.map((b, bi) => (
                            <Badge key={bi} tone={b.tone}>
                              {b.text}
                            </Badge>
                          ))}
                        </span>
                      )}
                      {o.sub && <span className="text-[11.5px] leading-snug text-faint">{o.sub}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Semantic badge — one component for every colored tag. Every tone is
 * a themeable soft/ink pair, so badges keep contrast in dark mode.
 * `upper` for short status labels (BUILD / AVOID), off for identifiers.
 * Legacy tone aliases (emerald/rose/amber) map onto good/crit/warn so
 * older screens keep working AND start theming correctly.
 * ------------------------------------------------------------------ */
const BADGE_TONES = {
  brand: "bg-brand-soft text-brand",
  violet: "bg-violet-soft text-violet",
  sky: "bg-sky-soft text-sky",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  neutral: "bg-surface-2 text-muted border border-line",
  // legacy aliases → semantic tokens
  emerald: "bg-good-soft text-good",
  rose: "bg-crit-soft text-crit",
  amber: "bg-warn-soft text-warn",
};

export function Badge({ tone = "neutral", icon: Icon, upper = false, className = "", children, ...props }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
        upper ? "uppercase tracking-wide" : ""
      } ${BADGE_TONES[tone] || BADGE_TONES.neutral} ${className}`}
      {...props}
    >
      {Icon && <Icon size={11} weight="fill" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * IconButton — a proper 30px hit target for inline row actions.
 * ------------------------------------------------------------------ */
const ICON_BTN_TONES = {
  default: "border-line text-faint hover:border-line-strong hover:text-ink-2",
  positive: "border-line text-faint hover:border-good hover:text-good hover:bg-good-soft",
  negative: "border-line text-faint hover:border-crit hover:text-crit hover:bg-crit-soft",
  brand: "border-line text-faint hover:border-brand hover:text-brand hover:bg-brand-soft",
};

export function IconButton({ tone = "default", className = "", ...props }) {
  return (
    <button
      className={`inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border bg-surface transition active:scale-[0.92] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 disabled:pointer-events-none ${
        ICON_BTN_TONES[tone] || ICON_BTN_TONES.default
      } ${className}`}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ *
 * StatusDot — the single liveness dot. tone + optional pulse ring.
 * ------------------------------------------------------------------ */
const DOT_TONES = {
  live: "bg-good text-good",
  good: "bg-good text-good",
  brand: "bg-brand text-brand",
  violet: "bg-violet text-violet",
  warn: "bg-warn text-warn",
  idle: "bg-faint text-faint",
};

export function StatusDot({ tone = "idle", pulse = false, className = "" }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_TONES[tone] || DOT_TONES.idle} ${
        pulse ? "pulse-ring" : ""
      } ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Tabs — segmented tab bar. tabs: [{ id, label, icon, n }].
 * Active tab reads as a soft-brand chip, matching the panel header.
 * ------------------------------------------------------------------ */
export function Tabs({ tabs, active, onChange, className = "" }) {
  return (
    <div role="tablist" className={`flex flex-wrap gap-0.5 ${className}`}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium whitespace-nowrap transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              on ? "bg-brand-soft text-brand font-semibold" : "text-muted hover:bg-surface-2 hover:text-ink-2"
            }`}
          >
            {t.icon && <t.icon size={15} weight={on ? "fill" : "regular"} />}
            {t.label}
            {typeof t.n === "number" && (
              <span
                className={`rounded-full px-1.5 py-px font-mono text-[10.5px] font-semibold tabular-nums ${
                  on ? "bg-brand/15 text-brand" : "bg-surface-2 text-faint border border-line"
                }`}
              >
                {t.n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SectionHeader — title + count on the left, optional action right.
 * ------------------------------------------------------------------ */
export function SectionHeader({ title, count, action, className = "" }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-baseline gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{title}</h3>
        {typeof count === "number" && <span className="text-[12px] tabular-nums text-faint">{count}</span>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ListRow — the workhorse. Slots:
 *   leading  — badge / icon column (top-aligned)
 *   title    — primary line (14px semibold ink)
 *   summary  — supporting text (13px muted); pass clamp for uniform rows
 *   actions  — right-aligned controls, aligned to the title
 *   meta     — small mono footer line (sources, effort, tags, timestamps)
 * The whole row lights up on hover so actions feel reachable.
 * ------------------------------------------------------------------ */
export function ListRow({ leading, title, summary, actions, meta, clamp = false, className = "", children }) {
  return (
    <div className={`group -mx-2 flex gap-3.5 rounded-xl px-3 py-3.5 transition-colors hover:bg-surface-2 ${className}`}>
      {leading != null && <div className="flex shrink-0 flex-col items-start gap-1.5 pt-0.5">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title != null && <p className="text-[14.5px] font-semibold leading-snug tracking-[-0.015em] text-ink">{title}</p>}
            {summary != null && (
              <p className={`mt-1 text-[13px] leading-relaxed text-muted ${clamp ? "line-clamp-2" : ""}`}>{summary}</p>
            )}
            {children}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-1.5 self-center">{actions}</div>}
        </div>
        {meta != null && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-faint">{meta}</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * EmptyState — a real empty state: icon, one line, optional hint.
 * ------------------------------------------------------------------ */
export function EmptyState({ icon: Icon, title, hint, children, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2.5 px-6 py-14 text-center ${className}`}>
      {Icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-faint ring-1 ring-line">
          <Icon size={22} />
        </div>
      )}
      {title && <p className="text-[14px] font-medium text-ink-2">{title}</p>}
      {hint && <p className="max-w-sm text-[13px] leading-relaxed text-faint">{hint}</p>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sparkline — dependency-free inline SVG trend. data: number[].
 * Draws a soft area fill + line + end dot in `currentColor` (set the
 * color on the parent, e.g. text-brand / text-good). Purely visual.
 * ------------------------------------------------------------------ */
export function Sparkline({ data = [], width = 66, height = 26, className = "" }) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1 || 1)) * width,
    height - 3 - ((v - min) / span) * (height - 6),
  ]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path d={area} fill="currentColor" opacity="0.1" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ex.toFixed(1)} cy={ey.toFixed(1)} r="2.1" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * StatTile — KPI card. label + big tabular value (+ optional unit),
 * a sub line, an optional delta, and a decorative sparkline.
 *   deltaTone: "good" | "crit" | "muted"
 * ------------------------------------------------------------------ */
export function StatTile({ icon: Icon, label, value, unit, sub, delta, deltaTone = "good", spark, sparkTone = "text-brand", className = "" }) {
  const deltaColor = deltaTone === "crit" ? "text-crit" : deltaTone === "muted" ? "text-faint" : "text-good";
  return (
    <div className={`relative overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
        {Icon && <Icon size={14} className="text-brand" weight="regular" />}
        {label}
      </div>
      <div className="mt-2 text-[27px] font-bold leading-none tracking-[-0.04em] tabular-nums text-ink">
        {value}
        {unit && <span className="text-[16px] font-semibold text-faint">{unit}</span>}
      </div>
      {(delta != null || sub) && (
        <div className="mt-1.5 text-[11.5px] text-faint">
          {delta != null && <span className={`font-semibold ${deltaColor}`}>{delta}</span>}
          {delta != null && sub && " "}
          {sub}
        </div>
      )}
      {spark && spark.length > 0 && (
        <div className={`pointer-events-none absolute right-3 bottom-3 h-[26px] w-[66px] opacity-90 ${sparkTone}`}>
          <Sparkline data={spark} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * AgentCard — mission-control card. avatar + name + status pill,
 * a description line, and a mono meta line (+ optional brand hint).
 *   accent: "brand" | "violet"  (avatar tint)
 *   statusTone: "good" | "idle" | "warn"
 * ------------------------------------------------------------------ */
const AGENT_ACCENTS = {
  brand: "bg-brand-soft text-brand",
  violet: "bg-violet-soft text-violet",
};

export function AgentCard({ icon: Icon, name, sub, statusLabel, statusTone = "good", pulse = false, meta, hint, accent = "brand", className = "" }) {
  const statusColor = statusTone === "idle" ? "text-faint" : statusTone === "warn" ? "text-warn" : "text-good";
  return (
    <div className={`flex items-start gap-3.5 rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      <div className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl ${AGENT_ACCENTS[accent] || AGENT_ACCENTS.brand}`}>
        {Icon && <Icon size={20} weight="fill" />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.02em] text-ink">
          {name}
          {statusLabel && (
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${statusColor}`}>
              <StatusDot tone={statusTone === "idle" ? "idle" : statusTone === "warn" ? "warn" : "good"} pulse={pulse} />
              {statusLabel}
            </span>
          )}
        </h3>
        {sub && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{sub}</p>}
        {meta && <p className="mt-1.5 font-mono text-[11px] text-faint">{meta}</p>}
        {hint && <p className="mt-1 font-mono text-[11px] text-brand">{hint}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ActivityFeed — timeline rail of live events.
 * items: [{ id, tone, text (node), time (string) }]
 *   tone: "brand" | "good" | "violet" | "warn" | "idle"
 * ------------------------------------------------------------------ */
const FEED_DOTS = {
  brand: "bg-brand",
  good: "bg-good",
  violet: "bg-violet",
  warn: "bg-warn",
  idle: "bg-faint",
};

export function ActivityFeed({ items = [], className = "" }) {
  return (
    <div className={`px-2 py-1.5 ${className}`}>
      {items.map((ev, i) => {
        const last = i === items.length - 1;
        return (
          <div key={ev.id ?? i} className="flex gap-3 px-2 py-2 text-[12.5px]">
            <div className="flex flex-none flex-col items-center pt-1">
              <span className={`h-2 w-2 rounded-full ${FEED_DOTS[ev.tone] || FEED_DOTS.brand}`} />
              {!last && <span className="mt-1 w-px flex-1 bg-line" />}
            </div>
            <div className="min-w-0 pb-1">
              <p className="leading-snug text-ink-2">{ev.text}</p>
              {ev.time && <time className="font-mono text-[11px] text-faint">{ev.time}</time>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
