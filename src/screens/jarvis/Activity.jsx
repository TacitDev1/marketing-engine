import { Broadcast } from "@phosphor-icons/react";
import { EmptyState, ActivityFeed } from "../../components/ui.jsx";
import { actorTone, activityText } from "./helpers.jsx";
import { ago } from "../../lib/format.js";

export function Activity({ items, onOpenDraft }) {
  if (!items.length)
    return <EmptyState icon={Broadcast} title="No activity yet" hint="Live steps from both agents will stream in here." />;
  return (
    <ActivityFeed
      items={items.map((a) => ({
        id: a.id,
        tone: actorTone(a.actor),
        text: activityText(a, onOpenDraft),
        time: ago(a.ts),
      }))}
    />
  );
}
