import { useState } from "react";
import { PencilSimple, FloppyDisk, X, CircleNotch, Trash, Clock } from "@phosphor-icons/react";
import { Button } from "../../components/ui.jsx";
import { parseTime, ago, TYPE_COLOR, typeBadge } from "./helpers.js";
import MD from "./MD.jsx";

// ---- note view + editor ----

export default function NotePane({ page, onOpenLink, onChanged, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/wiki/page/${page.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type: page.type, summary: page.summary, body }),
      });
      if (!res.ok) throw new Error(`Jarvis couldn't do that (error ${res.status})`);
      setEditing(false);
      onChanged();
    } catch (e) {
      // Stay in edit mode with the text intact — exiting on a failed save let
      // the next poll silently revert the note while showing success.
      setSaveError(`Couldn't save (${e?.message || "Jarvis isn't responding"}). Your edit is still here, try again.`);
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!window.confirm(`Delete the note "${page.title}"? This can't be undone.`)) return;
    try {
      const r = await fetch(`/api/wiki/page/${page.slug}`, { method: "DELETE" });
      if (!r.ok) {
        setSaveError("Couldn't delete the note just now — try again in a moment.");
        return; // don't pretend it's gone; the poll would resurrect it confusingly
      }
    } catch {
      setSaveError("Couldn't reach Jarvis to delete the note — try again in a moment.");
      return;
    }
    onDeleted();
  }

  return (
    <div className="reveal mx-auto max-w-2xl px-8 py-8">
      <div className="mb-4 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${typeBadge[page.type] || typeBadge.concept}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TYPE_COLOR[page.type] || TYPE_COLOR.concept }} />
          {page.type || "note"}
        </span>
        {!editing && page.updated && parseTime(page.updated) != null && (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-faint">
            <Clock size={12} /> updated {ago(page.updated)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {editing ? (
            <>
              <Button onClick={save} disabled={saving}>
                {saving ? <CircleNotch size={15} className="animate-spin" /> : <FloppyDisk size={15} weight="fill" />} Save
              </Button>
              <button onClick={() => { setEditing(false); setSaveError(null); setTitle(page.title); setBody(page.body); }} className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2"><X size={16} /></button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} title="Edit" className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-ink-2"><PencilSimple size={16} /></button>
              <button onClick={del} title="Delete" className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-crit"><Trash size={16} /></button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <div className="mb-3 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12px] text-warn">{saveError}</div>
      )}

      {editing ? (
        <>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mb-3 w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-xl font-semibold text-ink focus:border-brand focus:outline-none" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={20} className="w-full resize-y rounded-lg border border-line-strong bg-canvas px-3 py-2 font-mono text-[13px] leading-relaxed text-ink-2 focus:border-brand focus:outline-none" />
          <p className="mt-2 text-[12px] text-faint">Tip: link another note with [[Note Title]].</p>
        </>
      ) : (
        <>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-ink">{page.title}</h1>
          {page.summary && <p className="mt-2 text-[15px] leading-relaxed text-muted">{page.summary}</p>}
          <div className="mt-5 border-t border-line pt-5"><MD text={page.body} onLink={onOpenLink} /></div>
          {page.sources?.length > 0 && (
            <p className="mt-8 border-t border-line pt-3 text-[12px] text-faint">
              Sources: {page.sources.join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
