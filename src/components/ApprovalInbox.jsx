import { useState, useEffect, useCallback } from "react";
import { CheckCircle, ArrowUUpLeft, Trash, HandPalm, Tray, Article, LinkedinLogo } from "@phosphor-icons/react";
import { Button, Card, Badge, EmptyState } from "./ui.jsx";
import { ago } from "../lib/format.js";

// The Approvals inbox (server/approvals.js: approvalInbox, decideInApp).
// The default way a person decides: every blog the Editor cleared and every
// LinkedIn post it passed waits here for Approve, Send back with a note, or
// Drop it. An approved piece can be stopped until it goes out. Teams is an
// optional extra (MKT_APPROVAL_REQUEST_WEBHOOK); this inbox works without it.

async function call(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.result || `status ${res.status}`);
  return body;
}

const RESULT_TEXT = {
  approved: "Approved.",
  sent_back: "Sent back to the Editor with your note.",
  dropped: "Dropped and archived. Jarvis learns from the reason.",
  stopped: "Stopped. It is held in the Library and will not go out.",
};

function Row({ item, onDecide, busy, approved }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const Icon = item.kind === "blog" ? Article : LinkedinLogo;
  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start gap-3">
        <Icon size={18} className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium leading-snug text-ink">{item.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
            <Badge tone="neutral">{item.kind === "blog" ? "Blog" : "LinkedIn post"}</Badge>
            {item.score != null && <Badge tone={item.score >= 8 ? "good" : "warn"}>Editor {item.score}/10</Badge>}
            {item.revised && <Badge tone="violet">Revised after a note</Badge>}
            {approved && item.approval?.by && <span>approved by {item.approval.by}</span>}
            {item.savedAt && <span>· written {ago(item.savedAt)}</span>}
          </div>
          {item.editorReason && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">Editor: {item.editorReason}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {approved ? (
            <Button variant="outline" className="px-3 py-1.5 text-[12.5px]" disabled={busy} onClick={() => onDecide(item.id, "stop")}>
              <HandPalm size={14} /> Stop it
            </Button>
          ) : (
            <>
              <Button className="px-3 py-1.5 text-[12.5px]" disabled={busy} onClick={() => onDecide(item.id, "approve")}>
                <CheckCircle size={14} weight="fill" /> Approve
              </Button>
              <Button variant="outline" className="px-3 py-1.5 text-[12.5px]" disabled={busy} onClick={() => setNoting((v) => !v)}>
                <ArrowUUpLeft size={14} /> Send back
              </Button>
              <Button variant="ghost" className="px-3 py-1.5 text-[12.5px]" disabled={busy} onClick={() => onDecide(item.id, "drop", "Not right for us")}>
                <Trash size={14} /> Drop it
              </Button>
            </>
          )}
        </div>
      </div>
      {noting && !approved && (
        <form
          className="mt-2.5 flex flex-wrap gap-2 pl-[30px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) onDecide(item.id, "revise", note.trim());
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should the Editor change?"
            aria-label="Note for the Editor"
            className="min-w-[240px] flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] text-ink outline-none focus:border-brand"
          />
          <Button type="submit" className="px-3 py-1.5 text-[12.5px]" disabled={busy || !note.trim()}>
            Send it back
          </Button>
        </form>
      )}
    </li>
  );
}

export default function ApprovalInbox({ active }) {
  const [inbox, setInbox] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInbox(await call("/api/approvals/inbox"));
      setError("");
    } catch (err) {
      setError(`Couldn't load the approvals (${err.message}).`);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const decide = async (id, decision, reason = "") => {
    setBusy(true);
    try {
      const out = await call(`/api/approvals/${encodeURIComponent(id)}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      setInbox(out.inbox);
      setNotice(RESULT_TEXT[out.result] || "Done.");
      setError("");
    } catch (err) {
      setError(`That didn't go through (${err.message}).`);
    } finally {
      setBusy(false);
    }
  };

  const waiting = inbox?.waiting || [];
  const approved = inbox?.approved || [];
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3.5 text-[13px] font-semibold tracking-[-0.01em] text-ink">
        <Tray size={16} className="text-brand" />
        Approvals
        <Badge tone={waiting.length ? "brand" : "neutral"}>{waiting.length} waiting</Badge>
        <span className="ml-auto text-[12px] font-normal text-faint">
          {inbox?.teams?.request ? "Also sent to Teams" : "Decided here. Teams is optional."}
        </span>
      </div>
      {(error || notice) && (
        <p role="status" className={`border-b border-line px-4 py-2 text-[12.5px] ${error ? "text-crit" : "text-good"}`}>
          {error || notice}
        </p>
      )}
      {waiting.length ? (
        <ul>
          {waiting.map((item) => (
            <Row key={item.id} item={item} onDecide={decide} busy={busy} />
          ))}
        </ul>
      ) : (
        inbox && <EmptyState icon={CheckCircle} title="Nothing waiting" hint="Blogs the Editor clears and posts it passes land here for a person to approve." />
      )}
      {approved.length > 0 && (
        <>
          <p className="border-y border-line bg-surface-2 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Approved, not out yet
          </p>
          <ul>
            {approved.map((item) => (
              <Row key={item.id} item={item} onDecide={decide} busy={busy} approved />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
