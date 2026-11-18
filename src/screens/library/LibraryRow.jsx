import { useState } from "react";
import {
  Copy,
  Check,
  Trash,
  LinkedinLogo,
  Article,
  PencilSimple,
  Image as ImageIcon,
  CheckSquare,
  Square,
} from "@phosphor-icons/react";
import { Badge } from "../../components/ui.jsx";
import { auditBlog } from "../../lib/blog-audit.js";
import { STATUSES, SERVICE_LABEL, PRODUCT_LABEL, POST_TYPE_LABEL, VOICE_TIP, serviceOf, postTypeOf, copyTextFor } from "./helpers.js";

export function LibraryRow({ record, selected, onToggleSel, onStatus, onRemove, onOpen, onMakePoster, scheduledFor }) {
  const [copied, setCopied] = useState(false);
  const isBlog = record.kind === "blog";
  const p = record.payload || {};
  const title = (isBlog ? p.title : p.hook) || "Untitled draft";
  const preview = (isBlog ? p.metaDescription || p.body : p.body) || "";
  const Icon = isBlog ? Article : LinkedinLogo;
  const voice = POST_TYPE_LABEL[postTypeOf(record)];
  // A product post shows the product's name where a service post shows the
  // service line (the generator also sets payload.serviceLabel to match).
  const svc = PRODUCT_LABEL[p.productId] || SERVICE_LABEL[serviceOf(record)];
  const isAuto = p.origin === "autopilot" || p.origin === "jarvis";
  // Posted blogs are already out: show what's missing, but never as an alarm.
  const blogProblems = isBlog && record.status !== "delete"
    ? auditBlog(p).map((x) => (record.status === "posted" ? { ...x, severity: "warn" } : x))
    : [];

  async function copy(e) {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(copyTextFor(record)); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`group flex items-start gap-3 px-3 py-3 transition-colors hover:bg-surface-2 ${selected ? "bg-brand-soft/40" : ""}`}>
      <button
        onClick={() => onToggleSel(record.id)}
        className="mt-0.5 shrink-0 text-faint transition hover:text-brand"
        aria-label={selected ? "Deselect" : "Select"}
      >
        {selected ? <CheckSquare size={18} weight="fill" className="text-brand" /> : <Square size={18} />}
      </button>

      <button onClick={() => onOpen("view")} className="min-w-0 flex-1 text-left" title="Open to read & edit">
        <div className="flex items-center gap-2">
          <Icon size={14} weight="fill" className="shrink-0 text-brand" />
          <span className="truncate text-[14px] font-medium text-ink">{title}</span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-[13px] leading-relaxed text-muted">{preview}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {voice && (
            <Badge tone="warn" title={VOICE_TIP[p.postType] || "The style this post is written in."}>
              {voice}
            </Badge>
          )}
          {svc && <Badge tone="neutral">{svc}</Badge>}
          {isAuto && (
            <Badge tone="brand" title="Drafted automatically by Jarvis — still needs a human review before it goes anywhere.">
              Jarvis
            </Badge>
          )}
          {p.exportedRel && (
            <Badge tone="good" title={`On the website as ${p.exportedRel}`}>
              On site
            </Badge>
          )}
          {isBlog && blogProblems.length > 0 && (
            <Badge tone={blogProblems.some((x) => x.severity === "critical") ? "crit" : "warn"} title={`Blog audit: ${blogProblems.map((x) => x.label).join(", ")}`}>
              {blogProblems.some((x) => x.severity === "critical") ? `Incomplete: ${blogProblems.filter((x) => x.severity === "critical").map((x) => x.label).join(", ")}` : `${blogProblems.length} missing`}
            </Badge>
          )}
          {p.origin === "jarvis" && p.why && (
            <Badge tone="brand" title={`Why Jarvis wrote this: ${p.why}`}>
              Jarvis{p.critique?.score != null ? ` · ${p.critique.score}/10` : ""}
            </Badge>
          )}
          {Array.isArray(p.warnings) && p.warnings.length > 0 && (
            <Badge tone="warn" title={p.warnings.join("\n")}>
              {p.warnings.length} to check
            </Badge>
          )}
          {scheduledFor && (
            <Badge tone="good" title="Lined up on the Schedule for this day. Review it before then; deleting it frees the slot.">
              Scheduled · {scheduledFor.slice(5)}
            </Badge>
          )}
          {isBlog && p.slug && <span className="font-mono text-[11px] text-faint">/{p.slug}</span>}
          <span className="font-mono text-[11px] text-faint">{record.savedAt?.slice(0, 10)}</span>
        </div>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-2">
        {/* status segmented control — reads as a state stamp, not three actions:
            the current stage carries a check, and every button says plainly that
            clicking only RECORDS the stage (the "Posted" one scared review) */}
        <div
          className="inline-flex overflow-hidden rounded-md border border-line"
          title="Where this draft is in your review flow. Clicking only records the stage — the app never posts anything itself."
        >
          {STATUSES.map((s, i) => (
            <button
              key={s.id}
              title={s.tip}
              onClick={(e) => {
                e.stopPropagation();
                onStatus(record.id, s.id);
              }}
              className={`px-2 py-1 text-[11px] font-medium transition ${i > 0 ? "border-l border-line" : ""} ${
                record.status === s.id ? s.cls : "text-faint hover:bg-surface-2 hover:text-ink-2"
              }`}
            >
              {record.status === s.id ? "✓ " : ""}
              {s.label}
            </button>
          ))}
        </div>
        {/* row actions (appear on hover) */}
        <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <RowAction title="Copy" onClick={copy}>
            {copied ? <Check size={15} weight="bold" className="text-good" /> : <Copy size={15} />}
          </RowAction>
          {onMakePoster && (
            <RowAction
              title="Make an ASCII poster"
              onClick={(e) => {
                e.stopPropagation();
                onMakePoster(record.id);
              }}
            >
              <ImageIcon size={15} />
            </RowAction>
          )}
          <RowAction
            title="Edit"
            onClick={(e) => {
              e.stopPropagation();
              onOpen("edit");
            }}
          >
            <PencilSimple size={15} />
          </RowAction>
          <RowAction
            title="Delete"
            danger
            onClick={(e) => {
              e.stopPropagation();
              onRemove(record.id);
            }}
          >
            <Trash size={15} />
          </RowAction>
        </div>
      </div>
    </div>
  );
}

function RowAction({ title, onClick, danger, children }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md text-faint transition hover:bg-line/70 ${danger ? "hover:text-crit" : "hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
