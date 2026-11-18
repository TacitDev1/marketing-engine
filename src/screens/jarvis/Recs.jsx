import { CircleNotch, Check, X, Sparkle, Lightbulb } from "@phosphor-icons/react";
import { Button, Badge, IconButton, ListRow, EmptyState } from "../../components/ui.jsx";
import { FrontBadge } from "./FrontBadge.jsx";

export function Recs({ items, onSet, onDraft, drafting = {}, errors = {} }) {
  if (!items.length)
    return (
      <EmptyState
        icon={Lightbulb}
        title="No open recommendations"
        hint="When the Worker spots something worth acting on, it lands here ready to draft."
      />
    );
  return (
    <div className="divide-y divide-line">
      {items.map((r) => {
        const busy = !!drafting[r.id];
        const err = errors[r.id];
        const isBlog = /seo|schema|performance|site-health|analytics|technical|competitor|content/.test(r.front || "");
        return (
          <ListRow
            key={r.id}
            leading={<FrontBadge front={r.front} />}
            title={r.title}
            summary={
              err ? (
                <>
                  {r.detail}
                  <span className="mt-1 block text-[12px] text-crit">{err}</span>
                </>
              ) : (
                r.detail
              )
            }
            meta={r.effort ? <Badge tone="neutral">effort: {r.effort}</Badge> : null}
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={() => onDraft?.(r.id)}
                  disabled={busy}
                  title={`Approve and draft now (${isBlog ? "blog" : "LinkedIn post"})`}
                  className="px-2.5 py-1.5 text-[12px]"
                >
                  {busy ? <CircleNotch size={13} className="animate-spin" /> : <Sparkle size={13} weight="fill" />}
                  {busy ? "Drafting…" : "Approve & draft"}
                </Button>
                <IconButton tone="positive" title="Mark done (no draft)" onClick={() => onSet(r.id, "done")}>
                  <Check size={15} />
                </IconButton>
                <IconButton tone="negative" title="Dismiss" onClick={() => onSet(r.id, "dismissed")}>
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
