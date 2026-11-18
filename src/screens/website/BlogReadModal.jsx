import { useState, useEffect } from "react";
import { X } from "@phosphor-icons/react";
import JarvisBrief from "../../components/JarvisBrief.jsx";
import Markdown from "../../components/Markdown.jsx";

// Full-blog reader with an Ask Jarvis bar — read the whole draft and revise it
// in place without leaving the Website screen. The draft is already a Library
// record, so the same revise endpoint the other screens use applies here.
export default function BlogReadModal({ draft, onClose, onChanged }) {
  // Local copy so a Jarvis revision shows instantly, before the parent refetch.
  const [p, setP] = useState({ ...(draft.payload || {}) });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0e2016]/40 px-4 py-8 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight tracking-tight text-ink">{p.title || "Untitled"}</h2>
            {p.metaDescription && (
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{p.metaDescription}</p>
            )}
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint transition hover:bg-line/60 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="scroll-quiet flex-1 overflow-y-auto px-6 py-5">
          <Markdown text={p.body || ""} />
        </div>

        <div className="border-t border-line bg-canvas/30 px-5 py-3">
          <JarvisBrief
            ensureSaved={async () => draft.id}
            onRevised={(payload) => {
              setP((prev) => ({ ...prev, ...payload }));
              onChanged?.();
            }}
            lastBrief={p.briefs?.length ? p.briefs[p.briefs.length - 1].instruction : ""}
            placeholder='Ask Jarvis to change this blog, e.g. "shorter intro, add a checklist at the end"…'
          />
        </div>
      </div>
    </div>
  );
}
