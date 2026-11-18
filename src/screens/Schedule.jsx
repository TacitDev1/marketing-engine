import { useState, useEffect, useCallback } from "react";
import {
  CalendarCheck,
  Sparkle,
  Check,
  X,
  ArrowCounterClockwise,
  LinkedinLogo,
  Article,
  CircleNotch,
} from "@phosphor-icons/react";
import { Card, Eyebrow, Button, Badge, IconButton, EmptyState, Select } from "../components/ui.jsx";

// The publishing calendar (Mara, 2026-09-22). A LinkedIn post every N days and
// a blog on one weekday; Jarvis picks the best Library draft for each slot and,
// on the day, sends the reminder email (once a mailer is wired in). A human still
// publishes; the app never posts.
export default function Schedule({ active = true, onOpenDraft }) {
  const [data, setData] = useState(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(""); // slot key currently being worked on
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch("/api/schedule")
      .then((r) => r.json())
      .then((d) => { setData(d); setUnreachable(false); })
      .catch(() => setUnreachable(true));
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load, active]);

  async function call(url, body, key) {
    setBusy(key || url);
    setError("");
    try {
      const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });
      const out = await r.json().catch(() => null);
      if (!r.ok) setError(out?.message || `That didn't work (HTTP ${r.status}).`);
      load();
      return r.ok ? out : null;
    } catch {
      setUnreachable(true);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function saveSettings(patch) {
    try {
      await fetch("/api/schedule/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    } catch {
      setUnreachable(true);
    }
    load();
  }

  const settings = data?.settings;
  const slots = data?.slots || [];
  const upcoming = slots.filter((s) => !s.past);
  const past = slots.filter((s) => s.past);
  const todays = upcoming.filter((s) => s.today);
  const due = data?.dueToday || [];
  const byDate = groupByDate(upcoming);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8">
        <Eyebrow>Publishing</Eyebrow>
        <h1 className="mt-2 flex items-center gap-2.5 text-3xl font-semibold tracking-tight text-ink">
          <CalendarCheck size={28} weight="fill" className="text-brand" /> Schedule
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          The publishing rhythm. Jarvis fills every slot from the Library ahead of time and
          reminds you on the day; you post it. Nothing here publishes by itself.
        </p>
      </header>

      {unreachable && (
        <Card className="mb-5 p-4 text-[13px] text-muted">
          <span className="font-medium text-ink">Jarvis is starting up.</span> Give it a moment, then try again.
        </Card>
      )}
      {error && <Card className="mb-5 p-4 text-[13px] text-warn">{error}</Card>}

      {/* Cadence */}
      {settings && (
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="LinkedIn post">
              <Select
                value={String(settings.linkedinEveryDays)}
                onChange={(v) => saveSettings({ linkedinEveryDays: Number(v) })}
                options={[
                  { value: "0", label: "Off" },
                  { value: "1", label: settings.workWeekOnly ? "Every working day" : "Every day" },
                  { value: "2", label: settings.workWeekOnly ? "Every second working day" : "Every second day" },
                  { value: "3", label: settings.workWeekOnly ? "Every third working day" : "Every third day" },
                  { value: "5", label: settings.workWeekOnly ? "Once a week" : "Every fifth day" },
                  ...([0, 1, 2, 3, 5].includes(settings.linkedinEveryDays) ? [] : [{ value: String(settings.linkedinEveryDays), label: `Every ${settings.linkedinEveryDays} days` }]),
                ]}
              />
              <label className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
                <input type="checkbox" className="accent-brand" checked={!!settings.workWeekOnly} onChange={(e) => saveSettings({ workWeekOnly: e.target.checked })} />
                Work week only (Mon-Fri)
              </label>
            </Field>
            <Field label="Blog post">
              <Select
                value={String(settings.blogWeekday)}
                onChange={(v) => saveSettings({ blogWeekday: Number(v) })}
                options={[{ value: "-1", label: "Off" }, ...(data.labels?.weekdays || []).map((w, i) => ({ value: String(i), label: `Every ${w}` }))]}
              />
            </Field>
            <Field label={`Reminder (${data.tz})`}>
              <Select
                value={String(settings.reminderHour)}
                onChange={(v) => saveSettings({ reminderHour: Number(v) })}
                options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }))}
              />
            </Field>
          </div>
          <p className="mt-3 text-[11.5px] text-faint">
            The LinkedIn count starts from {settings.anchorDate}. At the reminder hour Jarvis fills
            today's slot and sends the reminder email once a mailbox is connected.
          </p>
        </Card>
      )}

      {/* Due today */}
      <section className="mt-8">
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">
          Today · {due.length} due
        </h2>
        {todays.length === 0 ? (
          <Card className="p-6">
            <EmptyState icon={CalendarCheck} title="Nothing scheduled today" hint="The next slots are lined up below." />
          </Card>
        ) : (
          <div className="space-y-2.5">
            {todays.map((s) => (
              <SlotCard key={s.key} slot={s} busy={busy} call={call} onOpenDraft={onOpenDraft} highlight />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming */}
      <section className="mt-8">
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">Next two weeks</h2>
        {upcoming.filter((s) => !s.today).length === 0 ? (
          <Card className="p-6">
            <EmptyState icon={CalendarCheck} title="No slots" hint="Turn on a cadence above." />
          </Card>
        ) : (
          <div className="space-y-5">
            {byDate.filter(([date]) => date !== data.today).map(([date, list]) => (
              <div key={date}>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-faint">{prettyDate(date)}</p>
                <div className="space-y-2">
                  {list.map((s) => <SlotCard key={s.key} slot={s} busy={busy} call={call} onOpenDraft={onOpenDraft} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Past week */}
      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">Past week</h2>
          <div className="space-y-1.5">
            {past.map((s) => (
              <div key={s.key} className="flex items-center gap-2.5 px-1 py-1 text-[13px]">
                {s.status === "published" ? (
                  <Check size={15} weight="bold" className="shrink-0 text-good" />
                ) : s.status === "skipped" ? (
                  <X size={15} weight="bold" className="shrink-0 text-faint" />
                ) : (
                  <span className="h-[15px] w-[15px] shrink-0 rounded-full border-2 border-warn" title="Missed" />
                )}
                <span className="font-mono text-[11px] text-faint">{s.date}</span>
                <KindBadge kind={s.kind} />
                <span className="min-w-0 flex-1 truncate text-muted">
                  {s.draft ? s.draft.title || s.draft.hook : s.status === "skipped" ? "skipped" : s.status === "published" ? "published (draft since deleted)" : "nothing was lined up"}
                </span>
                {s.status !== "published" && s.status !== "skipped" && (
                  <button type="button" className="text-[12px] font-medium text-brand hover:underline" onClick={() => call(`/api/schedule/${s.key}/status`, { status: "published" }, s.key)}>
                    I posted it
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      {children}
    </label>
  );
}

function KindBadge({ kind }) {
  return kind === "blog" ? (
    <Badge tone="violet" icon={Article} upper>Blog</Badge>
  ) : (
    <Badge tone="brand" icon={LinkedinLogo} upper>LinkedIn</Badge>
  );
}

function groupByDate(list) {
  const m = new Map();
  for (const s of list) m.set(s.date, [...(m.get(s.date) || []), s]);
  return [...m.entries()];
}

function prettyDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

// One slot: what's lined up, who picked it and why, and the actions.
function SlotCard({ slot, busy, call, onOpenDraft, highlight = false }) {
  const [choosing, setChoosing] = useState(false);
  const [options, setOptions] = useState(null);
  const working = busy === slot.key;
  const d = slot.draft;

  async function openChooser() {
    setChoosing(true);
    setOptions(null); // always fresh: a draft may have been assigned elsewhere since
    try {
      const r = await fetch(`/api/schedule/candidates?kind=${slot.kind}&except=${encodeURIComponent(slot.key)}`);
      const j = await r.json();
      setOptions((j.candidates || []).map((c) => ({ value: c.id, label: `${c.status === "approved" ? "✓ " : ""}${(c.title || c.hook || c.id).slice(0, 80)}` })));
    } catch {
      setOptions([]);
    }
  }

  const done = slot.status === "published" || slot.status === "skipped";

  return (
    <Card className={`p-4 ${highlight ? "border-brand/40" : ""} ${done ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <KindBadge kind={slot.kind} />
        <div className="min-w-0 flex-1">
          {d ? (
            <>
              <p className="text-[14px] leading-relaxed text-ink-2">{d.title || d.hook}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] text-faint">
                {d.serviceLabel && <span>{d.serviceLabel}</span>}
                {d.postType && <span>· {d.postType}</span>}
                <span>· {d.status}</span>
                {slot.pickedBy === "jarvis" && slot.reason && <span className="text-brand">· Jarvis: {slot.reason}</span>}
                {slot.pickedBy === "you" && <span>· chosen by hand</span>}
              </p>
              {d.problems?.length > 0 && (
                <p className={`mt-1 text-[12px] font-medium ${d.problems.some((x) => x.severity === "critical") ? "text-crit" : "text-warn"}`}>
                  {d.problems.some((x) => x.severity === "critical") ? "Not ready to publish: " : "Missing: "}
                  {d.problems.map((x) => x.label).join(", ")}. Open it in the Library to fix, or let Jarvis re-pick.
                </p>
              )}
              {d.warnings?.length > 0 && <p className="mt-1 text-[12px] text-warn">Check before posting: {d.warnings.join(" · ")}</p>}
            </>
          ) : (
            <p className="text-[14px] text-muted">
              {slot.status === "skipped"
                ? "Skipped."
                : slot.status === "published"
                  ? "Published (the draft has since been deleted from the Library)."
                  : "Nothing lined up yet - Jarvis picks as soon as the Library has a draft for this."}
            </p>
          )}

          {slot.status === "published" && d && <p className="mt-1 text-[12px] font-medium text-good">Published.</p>}

          {!done && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button className="px-3 py-1.5 text-[13px]" onClick={() => call(`/api/schedule/${slot.key}/pick`, null, slot.key)} disabled={working}>
                {working ? <CircleNotch size={14} className="animate-spin" /> : <Sparkle size={14} weight="fill" />}
                {d ? "Let Jarvis re-pick" : "Let Jarvis pick"}
              </Button>
              <Button variant="outline" className="px-3 py-1.5 text-[13px]" onClick={openChooser} disabled={working}>
                Choose a draft
              </Button>
              {d && onOpenDraft && (
                <button type="button" className="text-[12.5px] font-medium text-brand hover:underline" onClick={() => onOpenDraft(d.id)}>
                  Open in Library
                </button>
              )}
            </div>
          )}
          {!done && slot.passed?.length > 0 && <p className="mt-1.5 text-[11.5px] text-faint">Passed over: {slot.passed.length}</p>}

          {choosing && !done && (
            <div className="mt-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                {options === null ? (
                  <p className="text-[12.5px] text-faint">Loading drafts…</p>
                ) : options.length === 0 ? (
                  <p className="text-[12.5px] text-faint">No {slot.kind} drafts free in the Library. Generate or approve one first.</p>
                ) : (
                  <Select
                    searchable
                    placeholder={`Pick a ${slot.kind} draft…`}
                    value={d?.id || ""}
                    options={options}
                    onChange={(v) => { setChoosing(false); call(`/api/schedule/${slot.key}/assign`, { draftId: v }, slot.key); }}
                  />
                )}
              </div>
              <Button variant="ghost" className="px-3 py-1.5 text-[13px]" onClick={() => setChoosing(false)}>Cancel</Button>
            </div>
          )}

        </div>

        {!done ? (
          <div className="flex shrink-0 items-center gap-1">
            <IconButton tone="positive" title="I posted it" disabled={!d} onClick={() => call(`/api/schedule/${slot.key}/status`, { status: "published" }, slot.key)}>
              <Check size={15} />
            </IconButton>
            <IconButton tone="negative" title="Skip this slot" onClick={() => call(`/api/schedule/${slot.key}/status`, { status: "skipped" }, slot.key)}>
              <X size={15} />
            </IconButton>
          </div>
        ) : (
          <IconButton title="Reopen" onClick={() => call(`/api/schedule/${slot.key}/status`, { status: d ? "ready" : "planned" }, slot.key)}>
            <ArrowCounterClockwise size={15} />
          </IconButton>
        )}
      </div>
    </Card>
  );
}
