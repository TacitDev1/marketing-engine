import { Article, LinkedinLogo, ArrowSquareOut } from "@phosphor-icons/react";
import { Badge, SectionHeader, ListRow, EmptyState } from "../../components/ui.jsx";

export function Drafts({ items, onNavigate }) {
  if (!items.length)
    return (
      <EmptyState
        icon={Article}
        title="No drafts yet"
        hint="Approve a recommendation or brief Jarvis and finished drafts collect here."
      />
    );
  return (
    <div>
      <SectionHeader
        className="py-2"
        title="Drafts"
        count={items.length}
        action={
          <button
            onClick={() => onNavigate?.("library")}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
          >
            <ArrowSquareOut size={13} /> Open Library to review &amp; edit
          </button>
        }
      />
      <div className="divide-y divide-line">
        {items.map((d) => {
          const p = d.payload || {};
          const isBlog = d.kind === "blog";
          return (
            <ListRow
              key={d.id}
              leading={
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft text-brand">
                  {isBlog ? <Article size={16} weight="fill" /> : <LinkedinLogo size={16} weight="fill" />}
                </span>
              }
              title={isBlog ? p.title : p.hook}
              meta={p.origin === "autopilot" ? <span>auto · {p.front}</span> : null}
              actions={<Badge tone="neutral">{d.status}</Badge>}
            />
          );
        })}
      </div>
    </div>
  );
}
