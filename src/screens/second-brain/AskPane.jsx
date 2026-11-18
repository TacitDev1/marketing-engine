import { X, Sparkle, CircleNotch } from "@phosphor-icons/react";

export default function AskPane({ ask, onOpen, onClose }) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-faint">
        <Sparkle size={13} weight="fill" className="text-brand" /> Answer
        <button onClick={onClose} className="ml-auto text-faint hover:text-ink-2"><X size={15} /></button>
      </div>
      <p className="text-[15px] font-medium text-ink">{ask.question}</p>
      <div className="mt-3 rounded-lg border border-line bg-canvas/50 p-4">
        {ask.answer === null ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-muted"><CircleNotch size={15} className="animate-spin" /> Thinking…</span>
        ) : (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{ask.answer}</p>
        )}
        {ask.used?.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-[12px] text-faint">
            From:
            {ask.used.map((t) => (
              <button key={t} onClick={() => onOpen(t.replace(/\s*\([^)]*\)$/, ""))} className="rounded bg-surface px-2 py-0.5 text-muted hover:text-brand">{t}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
