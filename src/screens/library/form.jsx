import { Bookmarks } from "@phosphor-icons/react";

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] font-medium uppercase tracking-wide text-faint">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[14px] text-ink outline-none transition focus:border-brand focus:bg-surface";

export function lenHint(s, min, max) {
  const n = (s || "").length;
  const ok = n >= min && n <= max;
  return `${n} chars · best ${min}–${max}${ok ? " ✓" : ""}`;
}

export function EmptyState({ filter, query }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-8 py-16 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-brand">
        <Bookmarks weight="fill" size={24} />
      </div>
      <h3 className="text-[15px] font-medium text-ink">
        {query ? "No drafts match your search" : filter === "all" ? "Nothing saved yet" : filter === "delete" ? "Nothing marked for deletion" : `No ${filter} drafts`}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-[14px] leading-relaxed text-muted">
        {query ? (
          "Try a different search, or clear it."
        ) : (
          <>
            Generate a LinkedIn post or a blog, then hit <span className="font-medium text-ink-2">Save to library</span> — or let Jarvis draft into here.
          </>
        )}
      </p>
    </div>
  );
}
