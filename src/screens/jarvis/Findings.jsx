import { Notepad } from "@phosphor-icons/react";
import { ListRow, EmptyState } from "../../components/ui.jsx";
import { safeHref } from "../../components/Markdown.jsx";
import { FrontBadge } from "./FrontBadge.jsx";

// ---- "What it found" panels ----

export function Findings({ items }) {
  if (!items.length)
    return (
      <EmptyState
        icon={Notepad}
        title="Nothing researched yet"
        hint="The Researcher runs on the server's timer (or `/mkt-research` from a laptop) — Play here only starts the Worker. Brief Jarvis above for a one-off."
      />
    );
  return (
    <div className="divide-y divide-line">
      {items.map((f) => (
        <ListRow
          key={f.id}
          leading={<FrontBadge front={f.front} />}
          title={f.title}
          summary={f.summary}
          clamp
          meta={
            <>
              {f.url && safeHref(f.url) && (
                <a href={f.url} target="_blank" rel="noreferrer" className="hover:text-brand">
                  {(f.sources?.[0] || f.url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                </a>
              )}
              {f.ingestedToWiki?.length > 0 && <span>→ wiki: {f.ingestedToWiki.slice(0, 2).join(", ")}</span>}
            </>
          }
        />
      ))}
    </div>
  );
}
