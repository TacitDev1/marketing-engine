import { TYPE_COLOR } from "./helpers.js";

export default function LinkPanel({ title, icon: Icon, slugs, bySlug, onOpen, empty }) {
  const uniq = [...new Set(slugs)].filter((s) => bySlug[s]);
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
        <Icon size={12} weight="bold" /> {title}
        <span className="ml-auto font-mono text-[10.5px] normal-case tracking-normal">{uniq.length}</span>
      </div>
      {uniq.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-faint">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {uniq.map((s) => (
            <li key={s}>
              <button
                onClick={() => onOpen(s)}
                className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: TYPE_COLOR[bySlug[s].type] || TYPE_COLOR.concept }}
                />
                <span className="truncate text-[13px] text-ink-2 group-hover:text-brand">{bySlug[s].title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
