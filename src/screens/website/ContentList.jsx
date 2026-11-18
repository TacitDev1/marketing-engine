import { useState } from "react";
import { ArrowSquareOut, CircleNotch } from "@phosphor-icons/react";
import { Card, Badge } from "../../components/ui.jsx";

const COLLECTION_LABEL = {
  news: "Blog",
  services: "Service",
  industries: "Industry",
  locations: "Location",
  page: "Page",
};

export default function ContentList({ entries }) {
  const [openRel, setOpenRel] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);

  async function toggle(rel) {
    if (openRel === rel) {
      setOpenRel(null);
      setContent(null);
      return;
    }
    setOpenRel(rel);
    setContent(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/website/page?rel=${encodeURIComponent(rel)}`);
      const data = await res.json();
      // Click A (slow), then B: A's late response must not land in B's panel.
      setOpenRel((cur) => {
        if (cur === rel) setContent(res.ok ? data.content : "Could not load this file.");
        return cur;
      });
    } catch {
      setOpenRel((cur) => {
        if (cur === rel) setContent("Couldn't load this file — try again in a moment.");
        return cur;
      });
    } finally {
      setLoading(false);
    }
  }

  if (entries === null) return <Card className="h-32 animate-pulse bg-canvas" />;
  if (entries.length === 0) {
    return <Card className="p-5 text-[14px] text-muted">No content found.</Card>;
  }

  return (
    <Card className="divide-y divide-line overflow-hidden">
      {entries.map((e) => (
        <div key={e.rel}>
          <button
            onClick={() => toggle(e.rel)}
            className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-canvas"
          >
            <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide text-faint">
              {COLLECTION_LABEL[e.collection] || e.collection}
            </span>
            <span className="flex-1 truncate text-[14px] text-ink-2">{e.title}</span>
            {e.draft && <Badge tone="warn">draft</Badge>}
            <ArrowSquareOut
              size={15}
              className={`shrink-0 text-faint transition ${openRel === e.rel ? "rotate-90 text-brand" : ""}`}
            />
          </button>
          {openRel === e.rel && (
            <div className="border-t border-line bg-canvas px-5 py-4">
              {loading ? (
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <CircleNotch size={15} className="animate-spin" /> Loading…
                </div>
              ) : (
                <pre className="scroll-quiet max-h-96 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-2">
                  {content}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
