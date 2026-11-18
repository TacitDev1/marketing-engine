import { useState, useEffect, useCallback } from "react";
import { PaperPlaneTilt, Newspaper, CircleNotch } from "@phosphor-icons/react";
import { Button, Card, Badge } from "./ui.jsx";
import { ago } from "../lib/format.js";

// Automatic blog publishing and the weekly summary (2026-11-12).
// Server side: server/autopublish.js and server/weekly-summary.js.

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DELIVERY = { sent: "Posted to Teams", not_configured: "Saved here only (no Teams connection yet)", failed: "Could not post to Teams" };

async function call(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function Publishing({ active, onOpenDraft }) {
  const [pub, setPub] = useState(null);
  const [sum, setSum] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([call("/api/publishing"), call("/api/summary")]);
      setPub(p);
      setSum(s);
      setError("");
    } catch (err) {
      setError(`Couldn't load publishing (${err.message}).`);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const change = async (patch, what) => {
    setBusy(what);
    try {
      setPub(await call("/api/publishing", json("PATCH", patch)));
      setError("");
    } catch (err) {
      setError(`Couldn't save that (${err.message}).`);
    } finally {
      setBusy("");
    }
  };

  const sendNow = async () => {
    setBusy("summary");
    try {
      await call("/api/summary/send", { method: "POST" });
      await refresh();
    } catch (err) {
      setError(`Couldn't send the summary (${err.message}).`);
    } finally {
      setBusy("");
    }
  };

  const toggleDay = (d) => change({ days: pub.days.includes(d) ? pub.days.filter((x) => x !== d) : [...pub.days, d] }, `day${d}`);
  const last = sum?.summaries?.[0];

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Newspaper size={18} className="text-brand" />
        <h2 className="text-[15px] font-semibold text-ink">Blog publishing</h2>
        {pub && <Badge tone={pub.enabled ? "good" : "warn"}>{pub.enabled ? "On" : "Off"}</Badge>}
      </div>
      <p className="mb-3 text-[13px] text-muted">
        A blog goes live on larkwell.example only after the Editor agent has cleared it and a person has approved it in the Library. Approved blogs then go out on the days
        below, one a day at most. LinkedIn posts and ads are never published from here.
      </p>
      {error && <p className="mb-3 text-[13px] text-crit">{error}</p>}
      {!pub && !error && (
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <CircleNotch size={14} className="animate-spin" /> Loading
        </p>
      )}
      {pub && (
        <>
          {!pub.canPublish && (
            <p className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
              This copy of the app never publishes: only the server does. The settings below are this copy's own.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={busy === "enabled"} onClick={() => change({ enabled: !pub.enabled }, "enabled")}>
              {pub.enabled ? "Switch off" : "Switch on"}
            </Button>
            <span className="ml-2 text-[12.5px] text-faint">Days:</span>
            {[1, 2, 3, 4, 5].map((d) => (
              <button
                key={d}
                type="button"
                disabled={busy === `day${d}`}
                onClick={() => toggleDay(d)}
                aria-pressed={pub.days.includes(d)}
                className={`rounded-md border px-2 py-1 text-[12px] font-medium transition ${pub.days.includes(d) ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:border-brand"}`}
              >
                {DAY[d]}
              </button>
            ))}
            <span className="text-[12.5px] text-faint">from {pub.afterHour}:00</span>
          </div>
          <p className="mt-3 text-[13px] text-ink-2">
            {pub.next ? (
              <>
                Next to go out: <span className="font-medium">{pub.next.title}</span> (Editor {pub.next.score}/10){pub.waiting > 1 ? `, and ${pub.waiting - 1} more approved` : ""}.
              </>
            ) : (
              "No approved blog is waiting to go out."
            )}
          </p>
          {pub.awaitingApproval?.length > 0 && (
            <div className="mt-3 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2">
              <p className="text-[13px] font-medium text-ink">
                {pub.awaitingApproval.length === 1 ? "1 blog is" : `${pub.awaitingApproval.length} blogs are`} ready for your approval
              </p>
              <ul className="mt-1 space-y-1 text-[13px] text-ink-2">
                {pub.awaitingApproval.slice(0, 6).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span>{d.title}</span>
                    <span className="text-[12px] text-faint">Editor {d.score}/10</span>
                    {onOpenDraft && (
                      <button type="button" className="text-[12.5px] text-brand hover:underline" onClick={() => onOpenDraft(d.id)}>
                        Read and approve
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[12px] text-muted">Mark a blog Approved in the Library and it goes out on the next publishing day.</p>
            </div>
          )}
          {pub.recent.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12.5px] text-muted">
              {pub.recent.slice(0, 5).map((e) => (
                <li key={`${e.at}${e.draftId}`}>
                  {e.dateKey}:{" "}
                  {e.status === "published" ? (
                    <a href={e.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      {e.title}
                    </a>
                  ) : (
                    <span className="text-crit">
                      could not publish "{e.title}" ({e.error})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <PaperPlaneTilt size={18} className="text-brand" />
          <h2 className="text-[15px] font-semibold text-ink">Weekly summary</h2>
          <Button variant="outline" className="ml-auto" disabled={busy === "summary"} onClick={sendNow}>
            {busy === "summary" ? "Sending" : "Send one now"}
          </Button>
        </div>
        <p className="mb-2 text-[13px] text-muted">
          Every Friday afternoon: what was published, what the agents did, and what needs you.{" "}
          {sum && !sum.teamsConfigured && "No Teams connection is set up on this copy, so summaries are kept here only."}
        </p>
        {last ? (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="text-[12px] text-faint">
              Week ending {last.weekEnding}, sent {ago(last.createdAt)}. {DELIVERY[last.delivery?.status] || ""}
              {last.delivery?.error ? ` (${last.delivery.error})` : ""}
            </p>
            {(last.sections || []).map((sec) => (
              <div key={sec.title} className="mt-2">
                <p className="text-[12.5px] font-semibold text-ink-2">{sec.title}</p>
                <ul className="list-disc pl-5 text-[12.5px] text-muted">
                  {sec.lines.map((l, i) => {
                    const link = /^\[(.+)\]\((https?:\/\/[^)]+)\)$/.exec(l);
                    return (
                      <li key={i}>
                        {link ? (
                          <a href={link[2]} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                            {link[1]}
                          </a>
                        ) : (
                          l
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-faint">No summary has been sent yet.</p>
        )}
      </div>
    </Card>
  );
}
