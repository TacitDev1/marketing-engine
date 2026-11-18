import { useState, useEffect, useCallback } from "react";
import { CalendarDots } from "@phosphor-icons/react";
import { Button, Card } from "./ui.jsx";
import { ago } from "../lib/format.js";

// The week ahead (server/week-ahead.js): the Monday message that tells
// the team, day by day, what will happen this week and what is waiting for
// their approval. Shown here as it would be sent right now.

const DELIVERY = { sent: "Posted to Teams.", not_configured: "Kept in the app only (no Teams connection).", failed: "Could not be posted to Teams." };

function Line({ text }) {
  const link = /^\[(.+)\]\((https?:\/\/[^)]+)\)(.*)$/.exec(text);
  if (!link) return text;
  return (
    <>
      <a href={link[2]} className="text-brand hover:underline">
        {link[1]}
      </a>
      {link[3]}
    </>
  );
}

export default function WeekAhead({ active }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/week-ahead");
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData(await res.json());
      setError("");
    } catch (err) {
      setError(`Couldn't load the week ahead (${err.message}).`);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const sendNow = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/week-ahead/send", { method: "POST" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await refresh();
    } catch (err) {
      setError(`Couldn't send it (${err.message}).`);
    } finally {
      setBusy(false);
    }
  };

  const w = data?.preview;
  const last = data?.sent?.[0];
  const sections = w
    ? [
        ...(w.focus ? [{ title: "This week's focus", lines: [w.focus] }] : []),
        ...w.days.map((d) => ({ title: `${d.name} ${d.dateKey.slice(8)}/${d.dateKey.slice(5, 7)}`, lines: d.lines })),
        ...(w.questions.length ? [{ title: "Questions from the agents", lines: w.questions }] : []),
      ]
    : [];

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <CalendarDots size={18} className="text-brand" />
        <h2 className="text-[15px] font-semibold text-ink">The week ahead</h2>
        <Button variant="outline" className="ml-auto" disabled={busy} onClick={sendNow}>
          {busy ? "Sending" : "Send it now"}
        </Button>
      </div>
      <p className="mb-3 text-[13px] text-muted">
        Sent to the team every Monday at 15:00, when the server starts: what happens each day this week, and what is waiting for approval, each with a link straight to it.{" "}
        {data && !data.teamsConfigured && "No Teams connection is set up on this copy, so it is kept here only."}
      </p>
      {error && <p className="mb-3 text-[13px] text-crit">{error}</p>}
      {last && (
        <p className="mb-3 text-[12px] text-faint">
          Last sent {ago(last.createdAt)}. {DELIVERY[last.delivery?.status] || ""}
          {last.delivery?.error ? ` (${last.delivery.error})` : ""}
        </p>
      )}
      {w && (
        <div className="grid gap-3 md:grid-cols-2">
          {sections.map((sec) => (
            <div key={sec.title} className={`rounded-lg border border-line bg-surface-2 px-3 py-2 ${sec.title === "This week's focus" || sec.title === "Questions from the agents" ? "md:col-span-2" : ""}`}>
              <p className="text-[12.5px] font-semibold text-ink-2">{sec.title}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted">
                {sec.lines.map((l, i) => (
                  <li key={i}>
                    <Line text={l} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
