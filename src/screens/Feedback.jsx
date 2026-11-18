import { useState, useEffect, useCallback } from "react";
import {
  ChatCircleText,
  Check,
  X,
  PaperPlaneRight,
  CircleNotch,
  CheckCircle,
  ArrowBendUpLeft,
} from "@phosphor-icons/react";
import { Card, Eyebrow, Button, Badge, IconButton, EmptyState } from "../components/ui.jsx";
import { ago as agoOf } from "../lib/format.js";

const ago = (iso) => agoOf(iso, "");

// The exec suggestion box. Anyone reviewing the marketing (Mara, the C-level,
// a colleague) leaves their name and what they'd like changed; Tobias works
// through the list and marks each one handled. Promoted out of the Jarvis tabs
// so guests can't miss it — on the server this is their front door.
export default function Feedback({ active = true }) {
  const [open, setOpen] = useState([]);
  const [done, setDone] = useState([]);
  const [name, setName] = useState(() => {
    try { return localStorage.getItem("mkt-feedback-name") || ""; } catch { return ""; }
  });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    fetch("/api/feedback")
      .then((r) => r.json())
      .then((d) => {
        const all = d.feedback || [];
        setOpen(all.filter((f) => f.status === "open"));
        // Everything handled stays readable (with its answers), dismissed included;
        // an answer must never scroll out of reach once the note is marked done.
        setDone(all.filter((f) => f.status !== "open"));
        setUnreachable(false);
      })
      .catch(() => setUnreachable(true));
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load, active]);

  async function submit() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, author: name.trim() }),
      });
      if (!res.ok) throw new Error();
      try { localStorage.setItem("mkt-feedback-name", name.trim()); } catch { /* private mode */ }
      setText("");
      setSent(true);
      setTimeout(() => setSent(false), 3500);
      load();
    } catch {
      setUnreachable(true);
    } finally {
      setSending(false);
    }
  }

  async function setStatus(id, status) {
    try {
      const r = await fetch(`/api/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) setUnreachable(true); // the banner is honest enough here
    } catch {
      setUnreachable(true);
    }
    load();
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-8">
        <Eyebrow>Suggestions</Eyebrow>
        <h1 className="mt-2 flex items-center gap-2.5 text-3xl font-semibold tracking-tight text-ink">
          <ChatCircleText size={28} weight="fill" className="text-brand" /> Feedback
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Seen something the marketing should do more of, less of, or differently? Leave it
          here with your name — every note lands with Tobias, and it gets marked off once
          it's been acted on.
        </p>
      </header>

      {unreachable && (
        <Card className="mb-5 p-4 text-[13px] text-muted">
          <span className="font-medium text-ink">Jarvis is starting up.</span> Give it a
          moment, then try again.
        </Card>
      )}

      {/* Leave a note */}
      <Card className="p-5">
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <input
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            rows={3}
            className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
            placeholder='e.g. "More posts about managed services" or "The blog headlines feel too salesy"'
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={submit} disabled={!text.trim() || sending}>
            {sending ? <CircleNotch size={15} className="animate-spin" /> : <PaperPlaneRight size={15} weight="fill" />}
            Send it
          </Button>
          {sent && (
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-good">
              <CheckCircle size={16} weight="fill" /> Got it — thank you.
            </span>
          )}
          <span className="ml-auto text-[11.5px] text-faint">Stays inside Larkwell, like everything here.</span>
        </div>
      </Card>

      {/* Open requests */}
      <section className="mt-8">
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">
          Open · {open.length}
        </h2>
        {open.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={ChatCircleText}
              title="Nothing waiting"
              hint="New suggestions land here until Tobias has acted on them."
            />
          </Card>
        ) : (
          <div className="space-y-2.5">
            {open.map((f) => (
              <FeedbackItem key={f.id} f={f} name={name} onChanged={load} onStatus={setStatus} onError={() => setUnreachable(true)} />
            ))}
          </div>
        )}
      </section>

      {/* Recently handled — proof that notes left here actually change things */}
      {done.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">
            Handled · {done.length}
          </h2>
          <div className="space-y-1.5">
            {done.slice(0, showAll ? done.length : 8).map((f) => (
              <div key={f.id} className="flex items-start gap-2.5 px-1 py-1">
                {f.status === "dismissed" ? (
                  <X size={16} weight="bold" className="mt-0.5 shrink-0 text-faint" title="Dismissed" />
                ) : (
                  <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-good" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-relaxed text-muted">
                    {f.text}
                    {f.author && <span className="text-faint"> — {f.author}</span>}
                  </p>
                  {f.replies?.length > 0 && <Replies replies={f.replies} compact />}
                  <HandledReply f={f} name={name} onChanged={load} onError={() => setUnreachable(true)} onReopen={() => setStatus(f.id, "open")} />
                </div>
              </div>
            ))}
          </div>
          {done.length > 8 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 px-1 text-[12.5px] font-medium text-brand hover:underline">
              {showAll ? "Show fewer" : `Show all ${done.length}`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

// A handled note can still take a follow-up answer, or be reopened.
function HandledReply({ f, name, onChanged, onError, onReopen }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  async function send() {
    const t = reply.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/feedback/${f.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, author: name.trim() }),
      });
      if (!r.ok) throw new Error();
      setReply("");
      setReplying(false);
      onChanged();
    } catch {
      onError();
    } finally {
      setSending(false);
    }
  }
  if (!replying) {
    return (
      <p className="mt-1 flex gap-3 text-[11.5px]">
        <button type="button" onClick={() => setReplying(true)} className="font-medium text-brand hover:underline">Reply</button>
        <button type="button" onClick={onReopen} className="font-medium text-faint hover:text-ink-2 hover:underline">Reopen</button>
      </p>
    );
  }
  return (
    <div className="mt-2">
      <textarea
        rows={2}
        autoFocus
        className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
        placeholder={name.trim() ? `Reply as ${name.trim()}` : "Write a reply (add your name at the top)"}
        value={reply}
        maxLength={4000}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
      />
      <div className="mt-1.5 flex gap-2">
        <Button className="px-3 py-1.5 text-[13px]" onClick={send} disabled={!reply.trim() || sending}>Send reply</Button>
        <Button className="px-3 py-1.5 text-[13px]" variant="ghost" onClick={() => { setReplying(false); setReply(""); }}>Cancel</Button>
      </div>
    </div>
  );
}

// The back-and-forth under a note, oldest first.
function Replies({ replies, compact = false }) {
  return (
    <div className={`space-y-2 border-l-2 border-line pl-3 ${compact ? "mt-1.5" : "mt-3"}`}>
      {replies.map((r) => (
        <div key={r.id}>
          <p className={`whitespace-pre-wrap leading-relaxed ${compact ? "text-[12.5px] text-muted" : "text-[13.5px] text-ink-2"}`}>{r.text}</p>
          <p className="mt-0.5 font-mono text-[10.5px] text-faint">
            {r.author || "Anonymous"} · {ago(r.createdAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

// One open note: the request, its replies, and a reply box, so a question gets
// answered right where it was asked.
function FeedbackItem({ f, name, onChanged, onStatus, onError }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const t = reply.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/feedback/${f.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, author: name.trim() }),
      });
      if (!r.ok) throw new Error();
      try { localStorage.setItem("mkt-feedback-name", name.trim()); } catch { /* private mode */ }
      setReply("");
      setReplying(false);
      onChanged();
    } catch {
      onError();
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex items-start gap-3 p-4">
      <Badge tone="brand" upper className="mt-0.5 shrink-0">{f.author || "Anonymous"}</Badge>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-relaxed text-ink-2">{f.text}</p>
        <p className="mt-1 flex items-center gap-3 font-mono text-[10.5px] text-faint">
          {ago(f.createdAt)}
          {!replying && (
            <button
              type="button"
              onClick={() => setReplying(true)}
              className="flex items-center gap-1 font-sans text-[12px] font-medium text-brand hover:underline"
            >
              <ArrowBendUpLeft size={13} weight="bold" /> Reply
            </button>
          )}
        </p>
        {f.replies?.length > 0 && <Replies replies={f.replies} />}
        {replying && (
          <div className="mt-3">
            <textarea
              rows={3}
              autoFocus
              className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
              placeholder={name.trim() ? `Reply as ${name.trim()}` : "Write a reply (add your name at the top so they know who answered)"}
              value={reply}
              maxLength={4000}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button className="px-3 py-1.5 text-[13px]" onClick={send} disabled={!reply.trim() || sending}>
                {sending ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneRight size={14} weight="fill" />}
                Send reply
              </Button>
              <Button className="px-3 py-1.5 text-[13px]" variant="ghost" onClick={() => { setReplying(false); setReply(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton tone="positive" title="Mark done" onClick={() => onStatus(f.id, "done")}>
          <Check size={15} />
        </IconButton>
        <IconButton tone="negative" title="Dismiss" onClick={() => onStatus(f.id, "dismissed")}>
          <X size={15} />
        </IconButton>
      </div>
    </Card>
  );
}
