import { useState, useEffect, useMemo } from "react";
import { Copy, Check, X, ArrowSquareOut } from "@phosphor-icons/react";
import { Card, Button, Badge } from "../../components/ui.jsx";

// ---- Read-through views of the research collections ----
// Full text, no truncation: this is where Tobias reads what Jarvis gathered
// before deciding what to work on. Read-only — acting on records stays in Jarvis.

const RESEARCH_META = {
  findings: {
    empty: "No findings yet. They arrive as Jarvis works.",
    hint: "What Jarvis dug up. Newest first.",
  },
  directives: {
    empty: "No open build/avoid steers right now.",
    hint: "Standing instructions for Jarvis: build this, avoid that.",
  },
  recs: {
    empty: "No open recommendations right now.",
    hint: "Suggested marketing actions. Approve or dismiss them on the Jarvis screen.",
  },
  queue: {
    empty: "The research queue is empty.",
    hint: "Topics waiting for Jarvis to pick up.",
  },
};

export function ResearchList({ kind, research, query, unreachable }) {
  const [openItem, setOpenItem] = useState(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list;
    if (kind === "findings") {
      list = research.findings.map((f) => ({
        id: f.id,
        badges: [
          { tone: "brand", text: f.front || "messaging" },
          ...(f.processed ? [] : [{ tone: "warn", text: "unprocessed" }]),
        ],
        title: f.title,
        body: f.summary,
        links: [f.url, ...(f.sources || [])].filter(Boolean),
        date: f.createdAt,
        raw: f,
      }));
    } else if (kind === "directives") {
      list = research.directives.map((d) => ({
        id: d.id,
        badges: [{ tone: d.kind === "avoid" ? "warn" : "brand", text: d.kind === "avoid" ? "AVOID" : "BUILD" }, ...(d.front ? [{ tone: "neutral", text: d.front }] : [])],
        title: null,
        body: d.text,
        links: [],
        date: d.createdAt,
        raw: d,
      }));
    } else if (kind === "recs") {
      list = research.recs.map((r) => ({
        id: r.id,
        badges: [
          { tone: "brand", text: r.front || "messaging" },
          { tone: "neutral", text: `effort: ${r.effort || "medium"}` },
        ],
        title: r.title,
        body: r.detail,
        links: r.evidence || [],
        date: r.createdAt,
        raw: r,
      }));
    } else {
      list = research.queue.map((t) => ({
        id: t.id,
        badges: [
          { tone: t.status === "claimed" ? "warn" : "brand", text: t.status },
          ...(t.front ? [{ tone: "neutral", text: t.front }] : []),
          { tone: "neutral", text: `priority ${t.priority ?? 3}` },
        ],
        title: t.topic,
        body: t.rationale,
        links: [],
        date: t.createdAt,
        raw: t,
      }));
    }
    if (q) {
      list = list.filter((x) => `${x.title || ""} ${x.body || ""}`.toLowerCase().includes(q));
    }
    return list;
  }, [kind, research, query]);

  const meta = RESEARCH_META[kind];

  return (
    <>
      {unreachable && (
        <div className="mb-3 rounded-lg border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          Jarvis is catching up, so these may be a moment behind. Your work is safe.
        </div>
      )}
      <p className="mb-3 px-1 text-[13px] text-faint">
        {meta.hint} Showing {items.length}. Click a card to see every field.
      </p>
      {items.length === 0 ? (
        <Card className="px-6 py-10 text-center text-[14px] text-muted">{query ? "Nothing matches your search." : meta.empty}</Card>
      ) : (
        <div className="space-y-3">
          {items.map((x) => (
            <ResearchCard key={x.id} item={x} onOpen={() => setOpenItem(x)} />
          ))}
        </div>
      )}
      {openItem && <ResearchModal item={openItem} onClose={() => setOpenItem(null)} />}
    </>
  );
}

function ResearchCard({ item, onOpen }) {
  const [copied, setCopied] = useState(false);
  async function copy(e) {
    e.stopPropagation();
    try { await navigator.clipboard.writeText([item.title, item.body].filter(Boolean).join("\n\n")); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <Card className="cursor-pointer px-5 py-4 transition hover:border-brand/40" onClick={onOpen}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {item.badges.map((b, i) => (
              <Badge key={i} tone={b.tone}>{b.text}</Badge>
            ))}
            {item.date && <span className="ml-1 text-[11px] text-faint">{String(item.date).slice(0, 10)}</span>}
          </div>
          {item.title && <h3 className="text-[14px] font-semibold leading-snug text-ink">{item.title}</h3>}
          {item.body && <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{item.body}</p>}
          {item.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.links.map((l, i) => (
                <a
                  key={i}
                  href={l}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex max-w-full items-center gap-1 truncate text-[12px] text-brand hover:underline"
                >
                  <ArrowSquareOut size={12} className="shrink-0" />
                  <span className="truncate">{l.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
        <button onClick={copy} title="Copy text" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-ink-2">
          {copied ? <Check size={15} weight="bold" className="text-good" /> : <Copy size={15} />}
        </button>
      </div>
    </Card>
  );
}

// Every field of the raw record, readable — for digging into a finding, steer,
// recommendation, or queue topic before working from it.
const FIELD_LABELS = { createdAt: "created", processedAt: "processed at", updatedAt: "updated" };
function ResearchModal({ item, onClose }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function copyJson() {
    try { await navigator.clipboard.writeText(JSON.stringify(item.raw, null, 2)); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const fmtValue = (v) => {
    if (v == null || v === "") return "·";
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("\n") : "·";
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          {item.badges.map((b, i) => (
            <Badge key={i} tone={b.tone}>{b.text}</Badge>
          ))}
          <span className="ml-auto text-[11px] text-faint">{item.id}</span>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-ink-2">
            <X size={16} />
          </button>
        </div>
        <div className="scroll-quiet flex-1 overflow-y-auto px-5 py-4">
          {item.title && <h3 className="text-[15px] font-semibold leading-snug text-ink">{item.title}</h3>}
          {item.body && <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{item.body}</p>}
          <h4 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-faint">All fields</h4>
          <div className="overflow-hidden rounded-lg border border-line">
            {Object.entries(item.raw).map(([k, v], i) => (
              <div key={k} className={`flex gap-3 px-3 py-2 text-[12.5px] ${i % 2 ? "" : "bg-canvas/50"}`}>
                <span className="w-32 shrink-0 text-faint">{FIELD_LABELS[k] || k}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words text-ink-2">{fmtValue(v)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas/50 px-5 py-3">
          <Button variant="ghost" onClick={copyJson}>
            {copied ? <><Check size={16} weight="bold" /> Copied</> : <><Copy size={16} /> Copy as JSON</>}
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
