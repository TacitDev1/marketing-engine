import { useState } from "react";
import { CircleNotch, Sparkle } from "@phosphor-icons/react";
import { Button } from "./ui.jsx";

// On-the-spot "Ask Jarvis to change this" for any draft that can be persisted.
// This is the same revise-in-place mechanism the Library draft modal uses
// (POST /api/drafts/:id/brief → "edit, don't rewrite"), lifted into a shared
// component so blogs and LinkedIn posts can be tweaked right where they appear.
//
// Props:
//   ensureSaved: async () => libraryId | null
//     Persist the current content if needed and return its Library id. The
//     revision runs against whatever is on the server, so this must push any
//     local edits first (see the two call sites).
//   onRevised: (revisedPayload, warnings) => void
//     Apply the returned, revised payload in place.
//   lastBrief: string   — the previous instruction, shown as a subtle reminder.
//   placeholder, className — presentation.
export default function JarvisBrief({ ensureSaved, onRevised, lastBrief, placeholder, className = "", disabled = false }) {
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { tone: "good" | "warn", text }

  async function send() {
    const instruction = brief.trim();
    if (!instruction || busy || disabled) return;
    setBusy(true);
    setNote(null);
    try {
      const id = await ensureSaved();
      if (!id) throw new Error("couldn't save this first");
      const res = await fetch(`/api/drafts/${id}/brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || e.error || `server ${res.status}`);
      }
      const out = await res.json();
      onRevised(out.draft?.payload || {}, out.warnings || [], id);
      setBrief("");
      setNote(
        out.warnings?.length
          ? { tone: "warn", text: `Done, with a note: ${out.warnings.join(" ")}` }
          : { tone: "good", text: "Done — the version above is Jarvis's revision." }
      );
    } catch (e) {
      setNote({ tone: "warn", text: `Couldn't make that change (${e.message}). Your request is still in the box.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <input
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={busy || disabled}
          placeholder={placeholder || 'Ask Jarvis to change something…'}
          className="w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        />
        <Button onClick={send} disabled={busy || disabled || !brief.trim()}>
          {busy ? <CircleNotch size={15} className="animate-spin" /> : <Sparkle size={15} weight="fill" />}
          {busy ? "Revising…" : "Ask Jarvis"}
        </Button>
      </div>
      {note && (
        <p className={`mt-2 text-[12px] ${note.tone === "good" ? "text-good" : "text-warn"}`}>{note.text}</p>
      )}
      {lastBrief && !note && (
        <p className="mt-2 text-[12px] text-faint">Last change asked: "{lastBrief}"</p>
      )}
    </div>
  );
}
