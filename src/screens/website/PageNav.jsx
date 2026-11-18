import { useState, useEffect, useRef } from "react";
import { FileText, CaretDown, MagnifyingGlass } from "@phosphor-icons/react";

// Dropdown that lists every page in the site, grouped + searchable.
export default function PageNav({ routes, current, onPick, open, setOpen }) {
  const [q, setQ] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, setOpen]);

  const filtered = routes.filter(
    (r) =>
      !q ||
      r.label.toLowerCase().includes(q.toLowerCase()) ||
      r.path.toLowerCase().includes(q.toLowerCase())
  );
  const groups = filtered.reduce((acc, r) => {
    (acc[r.group] = acc[r.group] || []).push(r);
    return acc;
  }, {});

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition hover:bg-surface"
        title="Jump to any page"
      >
        <FileText size={14} weight="bold" /> All pages
        {routes.length > 0 && <span className="text-faint">({routes.length})</span>}
        <CaretDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 max-h-[60vh] w-72 overflow-hidden rounded-lg border border-line-strong bg-surface shadow-card-lg">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <MagnifyingGlass size={14} className="text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search pages…"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
            />
          </div>
          <div className="scroll-quiet max-h-[48vh] overflow-auto py-1">
            {Object.keys(groups).length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-muted">No pages match.</p>
            ) : (
              Object.entries(groups).map(([group, items]) => (
                <div key={group} className="py-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                    {group}
                  </div>
                  {items.map((r) => (
                    <button
                      key={r.path}
                      onClick={() => onPick(r.path)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-canvas ${
                        current === r.path ? "text-brand" : "text-ink-2"
                      }`}
                    >
                      <span className="truncate">{r.label}</span>
                      <span className="shrink-0 truncate text-[11px] text-faint">{r.path}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
