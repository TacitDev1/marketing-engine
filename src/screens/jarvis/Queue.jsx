import { useState } from "react";
import { Queue as QueueIcon } from "@phosphor-icons/react";
import { Button, StatusDot, ListRow, EmptyState } from "../../components/ui.jsx";
import { FrontBadge } from "./FrontBadge.jsx";
import { ago } from "../../lib/format.js";

export function Queue({ items, status, onAdded }) {
  if (!items.length)
    return (
      <QueueEmpty status={status} onAdded={onAdded} />
    );
  return (
    <div className="divide-y divide-line">
      {items.map((t) => (
        <ListRow
          key={t.id}
          leading={<FrontBadge front={t.front} />}
          title={t.topic}
          actions={
            t.status === "claimed" ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-good">
                <StatusDot tone="good" pulse /> researching
              </span>
            ) : null
          }
        />
      ))}
    </div>
  );
}

// The empty Queue with the real reason and a way to add a topic by hand. The
// Worker only tops the queue up while the Researcher has been seen in the last
// 24h; otherwise "it refills itself" would be a lie.
function QueueEmpty({ status, onAdded }) {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const seen = status?.researcherLastSeenAt;
  const stale = !seen || Date.now() - Date.parse(seen) > 24 * 3600000;
  async function add() {
    const t = topic.trim();
    if (!t || busy) return;
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/autopilot/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: t, front: "messaging", priority: 2 }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`);
      setNote(out.enqueued ? "Queued for the Researcher." : "That topic is already in the queue.");
      setTopic("");
      onAdded?.();
    } catch (e) {
      setNote(`Couldn't add it: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="px-1 py-2">
      <EmptyState
        icon={QueueIcon}
        title="Queue is empty"
        hint={
          stale
            ? `The Worker only adds topics while the Researcher is active, and it was last seen ${seen ? ago(seen) : "never"}. Run /mkt-research (or the server timer) to get it going, or add a topic below.`
            : "New research topics get added automatically as fronts run dry. You can also add one below."
        }
      />
      <div className="mx-auto mt-3 flex max-w-xl gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
          placeholder='Add a research topic, e.g. "SAP Joule pricing for mid-size manufacturers"'
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <Button className="px-3 py-1.5 text-[13px]" onClick={add} disabled={!topic.trim() || busy}>Add topic</Button>
      </div>
      {note && <p className="mt-2 text-center text-[12.5px] text-muted">{note}</p>}
    </div>
  );
}
