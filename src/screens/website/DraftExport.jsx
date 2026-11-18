import { useState } from "react";
import {
  CheckCircle,
  FloppyDisk,
  CircleNotch,
  Eye,
  EyeSlash,
  BookOpen,
} from "@phosphor-icons/react";
import { Card, Button, Badge } from "../../components/ui.jsx";
import BlogReadModal from "./BlogReadModal.jsx";

export default function DraftExport({ drafts, siteReady, onExported }) {
  if (drafts === null) return <Card className="h-20 animate-pulse bg-canvas" />;
  if (drafts.length === 0) {
    return (
      <Card className="p-5 text-[14px] text-muted">
        No blog drafts in your Library yet. Generate one on the Blogs screen, save it
        to the Library, then send it across here.
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {drafts.map((d) => (
        <DraftRow key={d.id} draft={d} siteReady={siteReady} onExported={onExported} />
      ))}
    </div>
  );
}

function DraftRow({ draft, siteReady, onExported }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [publish, setPublish] = useState(false);
  const [reading, setReading] = useState(false);
  const p = draft.payload || {};

  async function exportIt() {
    setBusy(true);
    try {
      const res = await fetch("/api/website/export-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, publish }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setResult({ ok: true, rel: data.rel, published: data.published });
        onExported?.();
      } else {
        setResult({ ok: false, msg: data.message || data.error || "Export failed." });
      }
    } catch {
      setResult({ ok: false, msg: "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setReading(true)}
            className="block w-full truncate text-left text-[15px] font-semibold text-ink hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            title="Read the full blog and ask Jarvis for changes"
          >
            {p.title || "Untitled draft"}
          </button>
          {p.metaDescription && (
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
              {p.metaDescription}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-faint">
            <Badge tone="neutral">{draft.status || "draft"}</Badge>
            {p.keyword && <span>keyword: {p.keyword}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button variant="ghost" onClick={() => setReading(true)} className="w-full">
            <BookOpen size={15} /> Read & edit
          </Button>
          <div className="flex overflow-hidden rounded-md border border-line-strong text-[12px] font-medium">
            <button
              onClick={() => setPublish(false)}
              className={`flex items-center gap-1 px-2.5 py-1 transition ${
                !publish ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas"
              }`}
              title="Lands as draft: true — hidden from the site"
            >
              <EyeSlash size={13} /> Hidden draft
            </button>
            <button
              onClick={() => setPublish(true)}
              className={`flex items-center gap-1 border-l border-line-strong px-2.5 py-1 transition ${
                publish ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas"
              }`}
              title="Lands as draft: false — shows in the preview"
            >
              <Eye size={13} /> Visible
            </button>
          </div>
          <Button onClick={exportIt} disabled={busy || !siteReady} className="w-full">
            {busy ? (
              <CircleNotch size={15} className="animate-spin" />
            ) : (
              <FloppyDisk size={15} weight="bold" />
            )}
            {busy ? "Sending…" : "Send to site"}
          </Button>
        </div>
      </div>
      {result?.ok && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-good">
          <CheckCircle size={14} weight="fill" /> Saved at{" "}
          <code className="rounded bg-canvas px-1 py-0.5 text-ink-2">{result.rel}</code>{" "}
          {result.published
            ? "— visible. It reaches larkwell.example when you press Publish on the Manage the website section."
            : "as a hidden draft. Flip it to Visible (or remove draft: true) to show it."}
        </p>
      )}
      {result && !result.ok && (
        <p className="mt-3 text-[12px] text-crit">{result.msg}</p>
      )}
      {reading && (
        <BlogReadModal draft={draft} onClose={() => setReading(false)} onChanged={onExported} />
      )}
    </Card>
  );
}
