import { useState, useEffect, useCallback, useRef } from "react";
import {
  PencilSimple,
  Eye,
  EyeSlash,
  CircleNotch,
  Check,
  X,
  RocketLaunch,
  CheckCircle,
  Warning,
  Sparkle,
} from "@phosphor-icons/react";
import { Card, Button, Badge, Pill } from "./ui.jsx";

// The built-in CMS: lets a non-technical user edit blog posts and success
// stories, show/hide them, and put the changes on the live website with one
// clearly-worded button. Everything is written in plain language on purpose —
// the audience is C-level and not technical.

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "posts", label: "Blog posts" },
  { id: "stories", label: "Success stories" },
];

function friendlyDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return String(iso).slice(0, 10);
  }
}

export default function ManageSite({ active = true, refreshKey = 0 }) {
  const [data, setData] = useState(null); // { entries, changes }
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null); // full entry being edited
  const [busyRel, setBusyRel] = useState(null); // row-level spinner for show/hide
  const [note, setNote] = useState(null); // { tone, text } — screen-level feedback
  const [goingLive, setGoingLive] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/website/manage")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => {
        setFailed(true);
        setData((prev) => prev || { entries: [], changes: [] });
      });
  }, []);

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh, refreshKey]);

  async function toggleVisible(entry) {
    setBusyRel(entry.rel);
    setNote(null);
    try {
      const res = await fetch("/api/website/entry/visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel: entry.rel, visible: entry.draft }),
      });
      if (!res.ok) throw new Error();
      setNote({
        tone: "good",
        text: entry.draft
          ? `"${entry.title}" will be shown. Press "Publish to larkwell.example" when you're ready — it goes live.`
          : `"${entry.title}" will be hidden. Press "Publish to larkwell.example" when you're ready — it goes live.`,
      });
      refresh();
    } catch {
      setNote({ tone: "warn", text: "That didn't work just now. Try again in a moment." });
    } finally {
      setBusyRel(null);
    }
  }

  // "Publish to larkwell.example": commits the confirmed content files and pushes
  // them to main. the site host deploys the live site from that within minutes, so
  // this is THE production step — hence two separate confirmations.
  async function goLive() {
    setGoingLive(true);
    setNote(null);
    // Re-read what is pending RIGHT NOW. The list on screen was loaded when the
    // screen opened, and other people use this app too — the confirm must name
    // exactly what will be sent, and only that gets sent.
    let fresh;
    try {
      const r = await fetch("/api/website/manage");
      if (!r.ok) throw new Error();
      fresh = await r.json();
      setData(fresh);
      setFailed(false);
    } catch {
      setNote({ tone: "warn", text: "Couldn't check the latest changes just now, so nothing was sent. Try again in a moment." });
      setGoingLive(false);
      return;
    }
    const list = fresh.changes || [];
    const stuck = fresh.unpushed || 0;
    if (!list.length && stuck) {
      // Only a failed earlier push to retry: one confirm names that plainly.
      if (!window.confirm(`Send the ${stuck === 1 ? "change" : `${stuck} changes`} that didn't reach larkwell.example last time?\n\nThis goes straight to the LIVE website.`)) {
        setGoingLive(false);
        return;
      }
    } else if (!list.length) {
      setNote({ tone: "good", text: "Nothing is waiting — larkwell.example already has everything." });
      setGoingLive(false);
      return;
    }
    const n = list.length || stuck; // what the success note counts
    if (list.length) {
    const titles = list.slice(0, 8).map((c) => `• ${c.title} (${c.kind})`).join("\n") + (n > 8 ? `\n…and ${n - 8} more` : "");
    // Two separate confirmations, on purpose: this is the live website.
    const sure = window.confirm(
      `Are you sure?\n\nPublish ${n} change${n === 1 ? "" : "s"} to larkwell.example:\n\n${titles}\n\nThis goes straight to the LIVE website. There is no review step.`
    );
    if (!sure) {
      setGoingLive(false);
      return;
    }
    const doubleSure = window.confirm(
      `Are you double sure?\n\nThe public will see ${n === 1 ? "this change" : "these changes"} on larkwell.example within a few minutes. Press OK to publish, or Cancel to stop.`
    );
    if (!doubleSure) {
      setNote({ tone: "warn", text: "Nothing was published." });
      setGoingLive(false);
      return;
    }
    }
    try {
      const res = await fetch("/api/website/golive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rels: list.map((c) => c.rel) }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 409 && out.error === "nothing_to_publish") {
        setNote({ tone: "good", text: "Everything is already on larkwell.example — nothing to publish." });
      } else if (res.status === 409 && out.message) {
        setNote({ tone: "warn", text: `Nothing was sent. ${out.message}` });
      } else if (!res.ok || out.ok === false) {
        setNote({
          tone: "warn",
          text: `Couldn't publish just now. Your changes are safe — try again in a few minutes, or let Tobias know.${out?.message ? ` (${out.message})` : ""}`,
        });
      } else {
        const sent = (out.committed || []).length || n;
        setNote({
          tone: "good",
          text: `Published ${sent} change${sent === 1 ? "" : "s"} to larkwell.example. The site host rebuilds the site now — allow a few minutes, then check the live page.`,
        });
      }
      refresh();
    } catch {
      setNote({ tone: "warn", text: "Couldn't reach the website just now. Your changes are safe — try again in a moment." });
    } finally {
      setGoingLive(false);
    }
  }

  if (!data) return <Card className="h-40 animate-pulse bg-canvas" />;

  const entries = data.entries || [];
  const changes = data.changes || [];
  // Saved in the site repo but never pushed (a Go Live whose push failed).
  const unpushed = data.unpushed || 0;
  const posts = entries.filter((e) => !e.story);
  const stories = entries.filter((e) => e.story);
  const shown = filter === "posts" ? posts : filter === "stories" ? stories : entries;

  return (
    <div className="space-y-4">
      {/* Go Live: the one big button. Amber while changes wait, green when clean. */}
      {failed || data.changesError ? (
        <p className="flex items-center gap-1.5 text-[13px] text-warn">
          <Warning size={16} weight="fill" /> Couldn't reach Jarvis just now, so this list may be out of date. Leave and reopen this screen to refresh it.
        </p>
      ) : changes.length > 0 || unpushed > 0 ? (
        <Card className="border-warn/30 bg-warn-soft/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-semibold text-ink">
                {changes.length > 0
                  ? `${changes.length} change${changes.length === 1 ? "" : "s"} not on larkwell.example yet`
                  : "Your last publish didn't reach larkwell.example"}
              </p>
              {unpushed > 0 && (
                <p className="mt-1 text-[13px] text-warn">
                  {unpushed === 1 ? "One earlier change is" : `${unpushed} earlier changes are`} saved but not sent yet. Press Publish to try again.
                </p>
              )}
              <ul className="mt-1.5 space-y-0.5 text-[13px] text-muted">
                {changes.slice(0, 5).map((c) => (
                  <li key={c.rel}>
                    · {c.title} <span className="text-faint">({c.kind})</span>
                  </li>
                ))}
                {changes.length > 5 && <li className="text-faint">…and {changes.length - 5} more</li>}
              </ul>
            </div>
            <Button onClick={goLive} disabled={goingLive} className="px-5 py-2.5 text-[15px]">
              {goingLive ? (
                <><CircleNotch size={18} className="animate-spin" /> Publishing to larkwell.example…</>
              ) : (
                <><RocketLaunch size={18} weight="fill" /> Publish to larkwell.example</>
              )}
            </Button>
          </div>
        </Card>
      ) : (
        <p className="flex items-center gap-1.5 text-[13px] text-good">
          <CheckCircle size={16} weight="fill" /> larkwell.example has all your changes.
        </p>
      )}

      {note && (
        <p className={`text-[13px] ${note.tone === "good" ? "text-good" : "text-warn"}`}>{note.text}</p>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Pill key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label} ({f.id === "posts" ? posts.length : f.id === "stories" ? stories.length : entries.length})
          </Pill>
        ))}
      </div>

      {/* The list */}
      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <p className="p-5 text-[14px] text-muted">Nothing here yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((e) => (
              <li key={e.rel} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{e.title}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {friendlyDate(e.date)}
                    {e.story && <span className="ml-2 text-brand">Success story</span>}
                  </p>
                </div>
                {e.draft ? (
                  <Badge tone="neutral">Hidden</Badge>
                ) : (
                  <Badge tone="good">On the website</Badge>
                )}
                {e.unmanaged ? (
                  <span
                    className="text-[12px] text-muted"
                    title="This page uses formatting the simple editor can't safely change. It can only be edited in the website code."
                  >
                    Can't be edited here
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      onClick={() => toggleVisible(e)}
                      disabled={busyRel === e.rel}
                      title={e.draft ? "Show this on the website" : "Hide this from the website"}
                    >
                      {busyRel === e.rel ? (
                        <CircleNotch size={16} className="animate-spin" />
                      ) : e.draft ? (
                        <><Eye size={16} /> Show</>
                      ) : (
                        <><EyeSlash size={16} /> Hide</>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const res = await fetch(`/api/website/entry?rel=${encodeURIComponent(e.rel)}`);
                        if (res.ok) setEditing(await res.json());
                        else setNote({ tone: "warn", text: "Couldn't open that one just now. Try again in a moment." });
                      }}
                    >
                      <PencilSimple size={16} /> Edit
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <EditorModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={(title) => {
            setEditing(null);
            setNote({
              tone: "good",
              text: `"${title}" saved. Press "Publish to larkwell.example" when you're ready for it to go live.`,
            });
            refresh();
          }}
        />
      )}
    </div>
  );
}

function EditorModal({ entry, onClose, onSaved }) {
  const [title, setTitle] = useState(entry.title || "");
  const [description, setDescription] = useState(entry.description || "");
  const [body, setBody] = useState(entry.body || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Ask Jarvis to change the page: revises the FORM only — the human still
  // reviews and presses Save, and nothing is live until Go Live.
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState(null); // { tone: "good"|"warn", text }

  async function askJarvis() {
    const instruction = ask.trim();
    if (!instruction || asking) return;
    setAsking(true);
    setAskNote(null);
    try {
      const res = await fetch("/api/website/entry/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, body, instruction }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "");
      const d = await res.json();
      setTitle(d.title || title);
      setDescription(d.description ?? description);
      setBody(d.body || body);
      setAsk("");
      setAskNote({
        tone: "good",
        text: (d.warnings || []).length
          ? `Applied, with a note: ${d.warnings.join("; ")}. Review below, then Save.`
          : "Applied — review the result below, then Save.",
      });
    } catch (err) {
      setAskNote({ tone: "warn", text: err?.message ? `${err.message}` : "Jarvis couldn't do that just now — your text is untouched. Try again in a moment." });
    } finally {
      setAsking(false);
    }
  }

  const dirty =
    title !== (entry.title || "") ||
    description !== (entry.description || "") ||
    body !== (entry.body || "");
  // Keep the latest close logic in a ref so the Escape listener (bound once)
  // always sees the current dirty state.
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

  async function save() {
    if (!title.trim()) {
      setError("The title can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/website/entry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel: entry.rel, title, description, body }),
      });
      if (!res.ok) throw new Error();
      onSaved(title.trim());
    } catch {
      setError("Couldn't save just now. Your changes are still here — try again in a moment.");
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[15px] text-ink focus:border-brand focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0e2016]/40 px-4 py-8 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current?.();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <p className="text-[14px] font-semibold text-ink">Edit this {entry.categories?.some((c) => /case stud|success/i.test(c)) ? "success story" : "blog post"}</p>
          <button
            onClick={() => closeRef.current?.()}
            title="Close without saving"
            className="grid h-8 w-8 place-items-center rounded-md text-faint transition hover:bg-line/60 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="scroll-quiet flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Title</span>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">
              Short description <span className="font-normal text-faint">(what Google shows under the title)</span>
            </span>
            <textarea rows={2} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">
              The article <span className="font-normal text-faint">(a blank line starts a new paragraph; ### makes a heading; **bold**)</span>
            </span>
            <textarea
              rows={16}
              className={`${inputCls} leading-relaxed`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
        </div>

        {/* Ask Jarvis — the same revise-in-place the drafts have, for site pages */}
        <div className="border-t border-line px-5 py-3">
          <div className="flex gap-2">
            <input
              className="w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[13.5px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
              placeholder='Ask Jarvis to change this page, e.g. "shorten the intro, add a bullet list of benefits"…'
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askJarvis()}
              disabled={asking}
            />
            <Button variant="outline" onClick={askJarvis} disabled={!ask.trim() || asking} className="shrink-0">
              {asking ? <CircleNotch size={15} className="animate-spin" /> : <Sparkle size={15} weight="fill" />}
              {asking ? "Working…" : "Ask Jarvis"}
            </Button>
          </div>
          {askNote && (
            <p className={`mt-1.5 text-[12px] ${askNote.tone === "good" ? "text-good" : "text-warn"}`}>{askNote.text}</p>
          )}
        </div>

        {error && <p className="border-t border-warn/25 bg-warn-soft px-5 py-2 text-[12px] text-warn">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas/50 px-5 py-3">
          <Button variant="ghost" onClick={() => closeRef.current?.()} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <><CircleNotch size={16} className="animate-spin" /> Saving…</> : <><Check size={16} weight="bold" /> Save changes</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
