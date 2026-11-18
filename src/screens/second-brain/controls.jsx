export function Seg({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition ${active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink-2"}`}
    >
      <Icon size={14} weight={active ? "fill" : "regular"} />
      {children}
    </button>
  );
}

export function FilterChip({ active, count, color, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] font-medium transition-colors active:scale-[0.97] ${
        active
          ? "border-brand/40 bg-brand-soft text-brand"
          : "border-line-strong bg-surface text-muted hover:border-brand/50 hover:text-ink-2"
      }`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
      <span className={`font-mono text-[10px] tabular-nums ${active ? "text-brand" : "text-faint"}`}>{count}</span>
    </button>
  );
}
