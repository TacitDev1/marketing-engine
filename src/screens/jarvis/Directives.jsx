import { Check, X, Flag, Prohibit } from "@phosphor-icons/react";
import { Badge, IconButton, ListRow, EmptyState } from "../../components/ui.jsx";
import { FrontBadge } from "./FrontBadge.jsx";

export function Directives({ items, onSet }) {
  if (!items.length)
    return (
      <EmptyState
        icon={Flag}
        title="No directives yet"
        hint='The Researcher posts "build this / avoid that" here to steer the Worker.'
      />
    );
  return (
    <div className="divide-y divide-line">
      {items.map((d) => {
        const build = d.kind === "build";
        return (
          <ListRow
            key={d.id}
            leading={
              <Badge tone={build ? "good" : "crit"} upper icon={build ? Flag : Prohibit}>
                {build ? "Build" : "Avoid"}
              </Badge>
            }
            title={d.text}
            meta={d.front ? <FrontBadge front={d.front} /> : null}
            actions={
              <>
                <IconButton tone="positive" title="Mark done" onClick={() => onSet(d.id, "done")}>
                  <Check size={15} />
                </IconButton>
                <IconButton tone="negative" title="Dismiss" onClick={() => onSet(d.id, "dismissed")}>
                  <X size={15} />
                </IconButton>
              </>
            }
          />
        );
      })}
    </div>
  );
}
