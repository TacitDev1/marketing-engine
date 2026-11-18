import { CheckCircle, XCircle } from "@phosphor-icons/react";
import { Card, Button, Badge } from "../../components/ui.jsx";

export default function Recommendations({ recs, onChange }) {
  async function setStatus(id, status) {
    try {
      await fetch(`/api/autopilot/recommendations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } finally {
      onChange(); // re-sync to truth whether it worked or not
    }
  }

  if (recs === null) return <Card className="h-20 animate-pulse bg-canvas" />;
  if (recs.length === 0) {
    return (
      <Card className="p-5 text-[14px] text-muted">
        No open site recommendations right now. Turn on Jarvis (Play on the Jarvis
        screen) and it'll research technical-SEO and competitor gaps for the site.
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {recs.map((rec) => (
        <Card key={rec.id} className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge tone="violet">{rec.front}</Badge>
                {rec.effort && (
                  <span className="text-[11px] uppercase tracking-wide text-faint">
                    {rec.effort} effort
                  </span>
                )}
              </div>
              <h3 className="text-[15px] font-semibold leading-snug text-ink">{rec.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{rec.detail}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={() => setStatus(rec.id, "done")}>
              <CheckCircle size={15} weight="bold" /> Done
            </Button>
            <Button variant="ghost" onClick={() => setStatus(rec.id, "dismissed")}>
              <XCircle size={15} /> Dismiss
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
