import { useState, useEffect, useRef } from "react";
import {
  Copy,
  Check,
  Trash,
  LinkedinLogo,
  Article,
  CircleNotch,
  PencilSimple,
  X,
  FloppyDisk,
  Image as ImageIcon,
  Sparkle,
  Globe,
} from "@phosphor-icons/react";
import { Button } from "../../components/ui.jsx";
import { STATUSES, copyTextFor } from "./helpers.js";
import { ReadView } from "./ReadView.jsx";
import { Field, inputCls, lenHint } from "./form.jsx";

export function DraftModal({ record, gone = false, mode, setMode, onClose, onStatus, onRemove, onSave, onBrief, onMakeImage }) {
  const isBlog = record.kind === "blog";
  const [form, setForm] = useState(() => ({ ...(record.payload || {}) }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [brief, setBrief] = useState("");
  const [briefing, setBriefing] = useState(false);
  const [briefNote, setBriefNote] = useState(null); // { tone: "good"|"warn", text }
  const [pubState, setPubState] = useState("idle"); // idle | publishing | done | error
  const [pubNote, setPubNote] = useState(null);
  const editing = mode === "edit";

  // Publish a reviewed blog to the website, staged (hidden draft) for a final
  // check. It is NOT pushed live from here — nothing appears on the site until
  // it's reviewed and the site is published.
  async function publish() {
    setPubState("publishing");
    setPubNote(null);
    try {
      const res = await fetch("/api/website/export-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: record.id, publish: false }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setPubState("error");
        // 409 is also "marked To delete": show the server's reason when it gave one.
        setPubNote(out.message || "The website isn't linked on this machine yet, so it can't be published from here.");
        return;
      }
      if (!res.ok || out.ok === false) {
        setPubState("error");
        setPubNote("Couldn't send it to the website. Try again, or let whoever manages the site know.");
        return;
      }
      setPubState("done");
      setPubNote("Sent to the website and staged for review. It won't go live until it's reviewed and the site is published.");
    } catch {
      setPubState("error");
      setPubNote("Couldn't reach the website. Try again in a moment.");
    }
  }

  async function sendBrief() {
    const instruction = brief.trim();
    if (!instruction || briefing) return;
    setBriefing(true);
    setBriefNote(null);
    try {
      const out = await onBrief(record.id, instruction);
      setBrief("");
      setBriefNote(
        out.warnings?.length
          ? { tone: "warn", text: `Applied, with notes: ${out.warnings.join(" ")}` }
          : { tone: "good", text: "Applied and saved. The draft above is the revised version." }
      );
    } catch (e) {
      setBriefNote({ tone: "warn", text: `Couldn't apply the brief (${e.message}). Your instruction is still in the box.` });
    } finally {
      setBriefing(false);
    }
  }

  // Signature of the draft's CONTENT only — excludes `exportedRel`, which our
  // own publish writes back into the payload. Keying the effects below on this
  // (instead of record.updatedAt) means a successful publish's own record bump
  // no longer counts as a change.
  const payloadSig = JSON.stringify(
    Object.fromEntries(Object.entries(record.payload || {}).filter(([k]) => k !== "exportedRel"))
  );

  useEffect(() => {
    // Re-sync from the record whenever the CONTENT changes on the server (e.g. a
    // Brief Jarvis revision) — the read view renders from `form`, and keying on
    // record.id alone left it stale until the modal was reopened. Never resync
    // mid-edit, so typing can't be clobbered.
    if (mode !== "edit") setForm({ ...(record.payload || {}) });
  }, [record.id, payloadSig, mode]);

  useEffect(() => {
    // A revision (or opening a different draft) makes the on-site copy stale, so
    // re-enable Publish. Re-publishing overwrites the same file (no duplicate).
    // NB: this deliberately does NOT fire on our own publish — that only changes
    // exportedRel, which the content signature ignores — so the "Sent to the
    // website" confirmation stays put instead of reverting within ~10s.
    setPubState("idle");
    setPubNote(null);
  }, [record.id, payloadSig]);

  // Guard against losing a mid-edit against a stray Escape / backdrop click.
  const [touched, setTouched] = useState(false);
  const dirty = editing && touched;
  const closeRef = useRef(null);
  closeRef.current = () => {
    if (dirty && !window.confirm("Discard your changes?")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);

  const set = (k, v) => {
    setTouched(true);
    setForm((f) => ({ ...f, [k]: v }));
  };

  async function save() {
    setSaving(true);
    setSaveError(null);
    let payload = { ...form };
    if (!isBlog && typeof form.hashtags === "string") {
      payload.hashtags = form.hashtags
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean);
    }
    if (gone) {
      setSaveError("This draft was deleted by someone else, so it can't be saved. Copy your text before closing.");
      setSaving(false);
      return;
    }
    try {
      await onSave(record.id, payload, record.updatedAt);
      setForm(payload);
      setTouched(false);
      setMode("view");
    } catch (e) {
      // Stay in edit mode with the text intact — never a stuck "Saving…".
      setSaveError(e?.conflict ? e.message : `Couldn't save (${e?.message || "Jarvis isn't responding"}). Your edit is still here, try again.`);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setForm({ ...(record.payload || {}) });
    setSaveError(null);
    setTouched(false);
    setMode("view");
  }

  async function copy() {
    try { await navigator.clipboard.writeText(copyTextFor({ ...record, payload: form })); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const hashtagsValue = Array.isArray(form.hashtags) ? form.hashtags.map((t) => `#${t}`).join(" ") : form.hashtags || "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0e2016]/40 px-4 py-8 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current?.();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-canvas px-2 py-0.5 font-medium text-ink-2">
              {isBlog ? <Article size={14} weight="fill" className="text-brand" /> : <LinkedinLogo size={14} weight="fill" className="text-brand" />}
              {isBlog ? "Blog" : "LinkedIn"}
            </span>
            <span className="text-faint">
              {editing ? "Editing" : "Saved"} · {record.savedAt?.slice(0, 10)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {STATUSES.map((s) => (
              <button
                key={s.id}
                disabled={gone}
                onClick={() => onStatus(record.id, s.id)}
                title={s.tip}
                className={`rounded-md px-2 py-0.5 text-[12px] font-medium transition ${
                  record.status === s.id ? s.cls : "text-faint hover:bg-line/60"
                }`}
              >
                {s.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-line-strong" />
            {/* Delete in the header too (Mara): the footer one is out of view
                on long drafts. Same handler, same confirm. */}
            <button
              disabled={gone}
              onClick={() => onRemove(record.id)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-faint transition hover:bg-crit-soft hover:text-crit disabled:opacity-50"
              title='Delete this draft from the Library right now (asks first). To only flag it, use "To delete".'
            >
              <Trash size={13} /> Delete now
            </button>
            <button onClick={() => closeRef.current?.()} title="Close" className="ml-1 grid h-8 w-8 place-items-center rounded-md text-faint transition hover:bg-line/60 hover:text-ink">
              <X size={18} />
            </button>
          </div>
        </div>
        {gone && (
          <div className="border-b border-warn/30 bg-warn-soft/40 px-5 py-2 text-[13px] text-warn">
            This draft was deleted by someone else while you had it open. It stays on screen so you can copy anything you still need; saving and status changes are off.
          </div>
        )}

        <div className="scroll-quiet flex-1 overflow-y-auto px-6 py-5">
          {editing ? (
            isBlog ? (
              <div className="space-y-4">
                <Field label="Title" hint={lenHint(form.title, 50, 60)}>
                  <input className={inputCls} value={form.title || ""} onChange={(e) => set("title", e.target.value)} />
                </Field>
                <Field label="Meta description" hint={lenHint(form.metaDescription, 140, 160)}>
                  <textarea rows={2} className={inputCls} value={form.metaDescription || ""} onChange={(e) => set("metaDescription", e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Slug">
                    <input className={`${inputCls} font-mono`} value={form.slug || ""} onChange={(e) => set("slug", e.target.value)} />
                  </Field>
                  <Field label="Target keyword">
                    <input className={inputCls} value={form.keyword || ""} onChange={(e) => set("keyword", e.target.value)} />
                  </Field>
                </div>
                <Field label="Body (Markdown)">
                  <textarea rows={18} className={`${inputCls} font-mono text-[13px] leading-relaxed`} value={form.body || ""} onChange={(e) => set("body", e.target.value)} />
                </Field>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Hook">
                  <textarea rows={2} className={inputCls} value={form.hook || ""} onChange={(e) => set("hook", e.target.value)} />
                </Field>
                <Field label="Body">
                  <textarea rows={12} className={`${inputCls} leading-relaxed`} value={form.body || ""} onChange={(e) => set("body", e.target.value)} />
                </Field>
                <Field label="Hashtags" hint="space or comma separated">
                  <input className={inputCls} value={hashtagsValue} onChange={(e) => set("hashtags", e.target.value)} />
                </Field>
              </div>
            )
          ) : (
            <ReadView record={{ ...record, payload: form }} />
          )}
        </div>

        {/* Brief Jarvis: type what should change (e.g. what the boss asked for);
            Jarvis revises THIS draft and saves it in place. */}
        {!editing && (
          <div className="border-t border-line bg-canvas/30 px-5 py-3">
            <div className="flex items-center gap-2">
              <input
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendBrief()}
                disabled={briefing}
                placeholder='Brief Jarvis, e.g. "drop the 70% stat and mention AWS"…'
                className="w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-brand"
              />
              <Button onClick={sendBrief} disabled={briefing || !brief.trim()}>
                {briefing ? <CircleNotch size={15} className="animate-spin" /> : <Sparkle size={15} weight="fill" />}
                {briefing ? "Revising…" : "Brief Jarvis"}
              </Button>
            </div>
            {briefNote && (
              <p className={`mt-2 text-[12px] ${briefNote.tone === "good" ? "text-good" : "text-warn"}`}>{briefNote.text}</p>
            )}
            {(record.payload?.briefs || []).length > 0 && !briefNote && (
              <p className="mt-2 text-[12px] text-faint">
                Last brief: "{record.payload.briefs[record.payload.briefs.length - 1].instruction}"
              </p>
            )}
          </div>
        )}
        {saveError && (
          <div className="border-t border-warn/25 bg-warn-soft px-5 py-2 text-[12px] text-warn">{saveError}</div>
        )}
        {pubNote && (
          <div className={`border-t border-line px-5 py-2 text-[12px] ${pubState === "error" ? "text-crit" : "text-good"}`}>{pubNote}</div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-line bg-canvas/50 px-5 py-3">
          <button
            onClick={() => onRemove(record.id)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-faint transition hover:bg-line/70 hover:text-crit"
          >
            <Trash size={16} /> Delete
          </button>
          <div className="flex items-center gap-2">
            {!editing && onMakeImage && (
              <Button
                variant="ghost"
                onClick={() => {
                  onMakeImage(record.id);
                  onClose();
                }}
                title="Make a LinkedIn image from this draft"
              >
                <ImageIcon size={16} /> Image
              </Button>
            )}
            {!editing && isBlog && record.status !== "delete" && (
              <Button
                onClick={publish}
                disabled={pubState === "publishing" || pubState === "done"}
                title="Send this post to the website, staged for review. It won't go live until it's reviewed and the site is published."
              >
                {pubState === "publishing" ? (
                  <><CircleNotch size={16} className="animate-spin" /> Publishing…</>
                ) : pubState === "done" ? (
                  <><Check size={16} weight="bold" /> Published for review</>
                ) : record.payload?.exportedRel ? (
                  <><Globe size={16} /> Update on website</>
                ) : (
                  <><Globe size={16} /> Publish to website</>
                )}
              </Button>
            )}
            <Button variant="ghost" onClick={copy}>
              {copied ? (
                <>
                  <Check size={16} weight="bold" /> Copied
                </>
              ) : (
                <>
                  <Copy size={16} /> Copy
                </>
              )}
            </Button>
            {editing ? (
              <>
                <Button variant="ghost" onClick={cancel} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <CircleNotch size={16} className="animate-spin" /> : <FloppyDisk size={16} weight="bold" />}
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setMode("edit")}>
                <PencilSimple size={16} /> Edit
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
