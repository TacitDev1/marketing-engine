import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Trash,
  Article,
  CircleNotch,
  X,
  MagnifyingGlass,
  CheckSquare,
  Square,
  Notepad,
  Flag,
  Lightbulb,
  Queue as QueueIcon,
} from "@phosphor-icons/react";
import { Card, Eyebrow, Pill, Button } from "../components/ui.jsx";
import { services, postTypes, products } from "../lib/company.js";
import { STATUSES, askRejectReason, KINDS, SORTS, PRODUCT_PREFIX, serviceOf, productOf, matchesService, postTypeOf, titleOf } from "./library/helpers.js";
import { UploadDrafts } from "./library/UploadDrafts.jsx";
import { ResearchList } from "./library/Research.jsx";
import { FilterSelect, BulkBtn } from "./library/controls.jsx";
import { LibraryRow } from "./library/LibraryRow.jsx";
import { DraftModal } from "./library/DraftModal.jsx";
import { EmptyState } from "./library/form.jsx";

export default function Library({ onMakePoster, onMakeImage, incoming = null, active = true }) {
  const [drafts, setDrafts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [scheduled, setScheduled] = useState({}); // draftId -> { date, kind } from the Schedule
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // status
  const [kind, setKind] = useState("all"); // type (blog/linkedin)
  const [postType, setPostType] = useState("all"); // voice
  const [service, setService] = useState("all"); // Larkwell service line
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState(() => new Set());
  const [open, setOpen] = useState(null); // { id, mode: 'view'|'edit' }
  // Which collection is being read: the drafts library (full editing UI) or one
  // of the research collections (read-through views of what Jarvis gathered).
  const [collection, setCollection] = useState("drafts");
  const [research, setResearch] = useState({ findings: [], directives: [], recs: [], queue: [] });

  const [unreachable, setUnreachable] = useState(false);
  // Last raw payloads, so a poll that returns identical data skips setState and
  // avoids re-rendering the whole list (and up to 200 findings cards) every
  // 10-15s while nothing has changed — including while a modal is open.
  const lastDraftsRef = useRef("");
  const lastResearchRef = useRef("");
  const refresh = useCallback(() => {
    fetch("/api/drafts")
      .then((r) => r.text())
      .then((text) => {
        setUnreachable(false);
        if (text === lastDraftsRef.current) return; // unchanged — no re-render
        lastDraftsRef.current = text;
        const d = JSON.parse(text);
        setDrafts(d.drafts || []);
        setSummary(d.summary || null);
        setScheduled(d.scheduled || {});
      })
      // Keep the last loaded list on screen — wiping it made a dead brain look
      // like every draft had been deleted.
      .catch(() => setUnreachable(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Poll only while visible (keep-alive keeps hidden screens mounted).
    if (!active) return;
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh, active]);

  // Deep link from another screen (Schedule's "Open in Library"): show the drafts
  // collection with no filters in the way and open that draft. Waits for the
  // list if it hasn't loaded yet; the ts makes the same id clickable twice.
  const incomingTsRef = useRef(0);
  useEffect(() => {
    if (!incoming?.draftId || incoming.ts === incomingTsRef.current) return;
    if (!drafts.some((d) => d.id === incoming.draftId)) {
      if (!loading) incomingTsRef.current = incoming.ts; // not in the Library (deleted); give up quietly
      return;
    }
    incomingTsRef.current = incoming.ts;
    setCollection("drafts");
    setFilter("all");
    setKind("all");
    setPostType("all");
    setService("all");
    setQuery("");
    setOpen({ id: incoming.draftId, mode: "view" });
  }, [incoming, drafts, loading]);

  // The research collections (findings / directives / recs / queue) — fetched
  // while visible so the tab counts are live too. Read-only here; acting on
  // them (approve, dismiss…) stays on the Jarvis screen.
  useEffect(() => {
    if (!active) return;
    const loadResearch = () =>
      Promise.all([
        fetch("/api/autopilot/findings?limit=200").then((r) => r.text()).catch(() => ""),
        fetch("/api/autopilot/directives").then((r) => r.text()).catch(() => ""),
        fetch("/api/autopilot/recommendations").then((r) => r.text()).catch(() => ""),
        fetch("/api/autopilot/queue").then((r) => r.text()).catch(() => ""),
      ]).then((texts) => {
        const sig = texts.join("\0");
        if (sig === lastResearchRef.current) return; // unchanged — no re-render
        lastResearchRef.current = sig;
        const [f, dir, r, q] = texts.map((t) => {
          try {
            return JSON.parse(t);
          } catch {
            return {};
          }
        });
        setResearch({
          findings: f.findings || [],
          directives: dir.directives || [],
          recs: r.recommendations || [],
          queue: (q.queue || []).filter((t) => ["queued", "claimed"].includes(t.status)),
        });
      });
    loadResearch();
    const t = setInterval(loadResearch, 15000);
    return () => clearInterval(t);
  }, [active]);

  // Force the next refresh to re-render even if the server text is unchanged.
  // Every optimistic mutation MUST call this before refresh(): if the request
  // failed, the server list is byte-identical to the pre-mutation one, and the
  // dedupe would skip the setState that corrects the lie — forever.
  const forceRefresh = () => {
    lastDraftsRef.current = "";
    refresh();
  };

  // A status click that the brain refuses must say so, not silently snap back on
  // the next poll.
  const [actionError, setActionError] = useState("");
  // Deleting a draft never touches the website. If one was already sent there,
  // say so, so nobody assumes the site post went with it.
  const siteNote = (ids) => {
    const onSite = ids.map((id) => drafts.find((d) => d.id === id)?.payload?.exportedRel).filter(Boolean);
    if (!onSite.length) return "";
    return `\n\n${onSite.length === 1 ? "It is" : `${onSite.length} of them are`} also on the website. Deleting here does NOT remove ${onSite.length === 1 ? "it" : "them"} from the site: hide or remove ${onSite.length === 1 ? "it" : "them"} under Website > Manage the website.`;
  };

  // Marking a scheduled draft "to delete" frees its calendar slot (the server
  // does it), so say so first, like the real delete does.
  const confirmMarkScheduled = (ids) => {
    const dates = ids.map((id) => scheduled[id]?.date).filter(Boolean);
    if (!dates.length) return true;
    return window.confirm(
      `${dates.length === 1 ? `This draft is on the Schedule for ${dates[0]}` : `${dates.length} of these are on the Schedule (${dates.join(", ")})`}. Marking it to delete frees that slot and Jarvis picks another. Carry on?`
    );
  };

  async function setStatus(id, status) {
    if (status === "delete" && !confirmMarkScheduled([id])) return;
    let reason = "";
    if (status === "delete") {
      reason = askRejectReason(1);
      if (reason === null) return;
    }
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
    setActionError("");
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) setActionError(`Couldn't change the status (HTTP ${res.status}). Try again.`);
    } catch {
      setActionError("Couldn't reach Jarvis to change the status. Try again.");
    } finally {
      forceRefresh();
    }
  }

  // `ifUpdatedAt` = the record's updatedAt when the editor opened. The brain
  // refuses (409) if someone else saved in between, instead of overwriting them.
  async function saveEdit(id, payload, ifUpdatedAt) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, payload } : d)));
    let res;
    try {
      res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, ifUpdatedAt }),
      });
    } finally {
      forceRefresh(); // restores the truth if the optimistic update didn't stick
    }
    if (res && res.status === 409) {
      const e = new Error("Someone else saved this draft while you were editing, so your version was NOT saved over theirs. Your text is still here: copy it, close, reopen the draft and paste what you want to keep.");
      e.conflict = true;
      throw e;
    }
    if (!res || !res.ok) {
      const e = res ? await res.json().catch(() => ({})) : {};
      throw new Error(e.message || `Jarvis couldn't do that${res ? ` (error ${res.status})` : ""}`);
    }
  }

  // "Brief Jarvis": send a human instruction to the brain, which revises this
  // draft and saves it back onto the same record. Returns guardrail warnings.
  async function briefJarvis(id, instruction) {
    const res = await fetch(`/api/drafts/${id}/brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Jarvis couldn't do that (error ${res.status})`);
    }
    const out = await res.json();
    refresh();
    return out;
  }

  async function remove(id) {
    // Same guard the bulk delete has — one mis-click must not destroy a draft.
    const onSchedule = scheduled[id] ? ` It is on the Schedule for ${scheduled[id].date}; deleting frees that slot and Jarvis picks another.` : "";
    if (!window.confirm(`Delete this draft? This can't be undone.${onSchedule}${siteNote([id])}`)) return;
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setSelected((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setOpen((o) => (o?.id === id ? null : o));
    try {
      await fetch(`/api/drafts/${id}`, { method: "DELETE" });
    } finally {
      forceRefresh(); // a failed delete must resurface the row, not lie
    }
  }

  // ---- bulk actions over the current selection ----
  // Scoped to VISIBLE rows: a selection made under one filter must not act on
  // drafts hidden by the current filter (select 5 in "Draft", switch to
  // "Approved", delete 2 → only the 2 on screen are touched, never 7).
  const visibleSelected = () => shown.filter((d) => selected.has(d.id)).map((d) => d.id);

  // Clears everything currently shown under the Delete filter (respects the
  // other filters/search, so "Delete marked LinkedIn only" works too).
  async function removeMarked() {
    const ids = shown.filter((d) => d.status === "delete").map((d) => d.id);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length === 1 ? "this draft" : `these ${ids.length} drafts`} for good? This can't be undone.${siteNote(ids)}`)) return;
    const target = new Set(ids);
    setDrafts((prev) => prev.filter((d) => !target.has(d.id)));
    setSelected(new Set());
    setOpen((o) => (o && target.has(o.id) ? null : o));
    setActionError("");
    try {
      const results = await Promise.all(ids.map((id) => fetch(`/api/drafts/${id}`, { method: "DELETE" }).catch(() => ({ ok: false }))));
      const failed = results.filter((r) => !r.ok).length;
      if (failed) setActionError(`${failed} of ${ids.length} deletions failed. Try again.`);
    } finally {
      forceRefresh();
    }
  }

  // Archived drafts go back to the status they had before (usually Draft).
  async function restoreShown() {
    const rows = shown.filter((d) => d.status === "archived");
    if (!rows.length) return;
    if (!window.confirm(`Bring ${rows.length === 1 ? "this draft" : `these ${rows.length} drafts`} back into the Library?`)) return;
    setActionError("");
    try {
      const results = await Promise.all(
        rows.map((d) =>
          fetch(`/api/drafts/${d.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: d.archivedFrom && d.archivedFrom !== "archived" ? d.archivedFrom : "draft" }),
          }).catch(() => ({ ok: false }))
        )
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed) setActionError(`${failed} of ${rows.length} restores failed. Try again.`);
    } finally {
      forceRefresh();
    }
  }

  async function bulkStatus(status) {
    const ids = visibleSelected();
    if (!ids.length) return;
    if (status === "delete" && !confirmMarkScheduled(ids)) return;
    let reason = "";
    if (status === "delete") {
      reason = askRejectReason(ids.length);
      if (reason === null) return;
    }
    const target = new Set(ids);
    setDrafts((prev) => prev.map((d) => (target.has(d.id) ? { ...d, status } : d)));
    setSelected(new Set());
    setActionError("");
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/drafts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
          }).catch(() => ({ ok: false })),
        ),
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed) setActionError(`${failed} of ${ids.length} status changes failed. Try again.`);
    } finally {
      forceRefresh();
    }
  }

  async function bulkRemove() {
    const ids = visibleSelected();
    if (!ids.length) return;
    const nSched = ids.filter((id) => scheduled[id]).length;
    const onSchedule = nSched ? ` ${nSched} of them ${nSched > 1 ? "are" : "is"} on the Schedule; those slots open again and Jarvis picks others.` : "";
    if (!window.confirm(`Delete ${ids.length} draft${ids.length > 1 ? "s" : ""}? This can't be undone.${onSchedule}${siteNote(ids)}`)) return;
    const doomed = new Set(ids);
    setDrafts((prev) => prev.filter((d) => !doomed.has(d.id)));
    setSelected(new Set());
    try {
      await Promise.all(ids.map((id) => fetch(`/api/drafts/${id}`, { method: "DELETE" })));
    } finally {
      forceRefresh();
    }
  }

  const toggleSel = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = drafts.filter((d) => {
      if (filter === "all" && d.status === "archived") return false;
      if (filter !== "all" && d.status !== filter) return false;
      if (kind !== "all" && d.kind !== kind) return false;
      if (postType === "none" ? postTypeOf(d) !== "" : postType !== "all" && postTypeOf(d) !== postType) return false;
      if (!matchesService(d, service)) return false;
      if (!q) return true;
      const p = d.payload || {};
      const hay = [p.title, p.metaDescription, p.hook, p.body, p.slug, p.keyword]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    if (sort === "oldest") arr.sort((a, b) => (a.savedAt || "").localeCompare(b.savedAt || ""));
    else if (sort === "az") arr.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    else arr.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    return arr;
  }, [drafts, filter, kind, postType, service, query, sort]);

  const facetCounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inScope = (d) => {
      if (filter === "all" && d.status === "archived") return false;
      if (filter !== "all" && d.status !== filter) return false;
      if (kind !== "all" && d.kind !== kind) return false;
      if (!q) return true;
      const p = d.payload || {};
      return [p.title, p.metaDescription, p.hook, p.body, p.slug, p.keyword]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    };
    const matchService = (d) => matchesService(d, service);
    const matchVoice = (d) => (postType === "none" ? postTypeOf(d) === "" : postType === "all" || postTypeOf(d) === postType);
    const pt = {};
    const svc = {};
    let ptTotal = 0;
    let svcTotal = 0;
    for (const d of drafts) {
      if (!inScope(d)) continue;
      if (matchService(d)) {
        const k = postTypeOf(d) || "none";
        pt[k] = (pt[k] || 0) + 1;
        ptTotal++;
      }
      if (matchVoice(d)) {
        const k = serviceOf(d) || "none";
        svc[k] = (svc[k] || 0) + 1;
        // Product posts also count under their product (they keep their
        // nearest service line too, so the service totals stay honest).
        if (productOf(d)) {
          const pk = PRODUCT_PREFIX + productOf(d);
          svc[pk] = (svc[pk] || 0) + 1;
        }
        svcTotal++;
      }
    }
    return { pt, svc, ptTotal, svcTotal };
  }, [drafts, filter, kind, query, postType, service]);

  // The modal renders from the LIVE record so Jarvis revisions show up, but if
  // someone else deletes the draft while it is open, keep the last copy on
  // screen (flagged `gone`) instead of vanishing with the person's typing.
  const liveRecord = open ? drafts.find((d) => d.id === open.id) : null;
  const heldRef = useRef(null);
  if (liveRecord) heldRef.current = liveRecord;
  const openRecord = liveRecord || (open && heldRef.current?.id === open.id ? heldRef.current : null);
  const recordGone = !!open && !liveRecord && !!openRecord && !unreachable && !loading;

  const shownIds = shown.map((d) => d.id);
  const allShownSelected = shown.length > 0 && shownIds.every((id) => selected.has(id));
  const toggleSelectAll = () =>
    setSelected((s) => {
      if (allShownSelected) {
        const n = new Set(s);
        shownIds.forEach((id) => n.delete(id));
        return n;
      }
      return new Set([...s, ...shownIds]);
    });

  const voiceOptions = [
    { value: "all", label: `All voices (${facetCounts.ptTotal})` },
    ...postTypes.map((p) => ({ value: p.id, label: `${p.label} (${facetCounts.pt[p.id] || 0})` })),
    ...((facetCounts.pt.none || 0) > 0 ? [{ value: "none", label: `Unlabeled (${facetCounts.pt.none})` }] : []),
  ];
  const serviceOptions = [
    { value: "all", label: `All services (${facetCounts.svcTotal})` },
    { heading: "Service lines" },
    ...services.map((s) => ({ value: s.id, label: `${s.label} (${facetCounts.svc[s.id] || 0})`, disabled: (facetCounts.svc[s.id] || 0) === 0 })),
    { heading: "Larkwell products" },
    ...products.map((pr) => {
      const n = facetCounts.svc[PRODUCT_PREFIX + pr.id] || 0;
      return { value: PRODUCT_PREFIX + pr.id, label: `${pr.label} (${n})`, disabled: n === 0 };
    }),
    ...((facetCounts.svc.none || 0) > 0 ? [{ value: "none", label: `Unlabeled (${facetCounts.svc.none})` }] : []),
  ];
  const anyFilter = filter !== "all" || kind !== "all" || postType !== "all" || service !== "all" || query;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-6">
        <Eyebrow>Review queue</Eyebrow>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Library</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Everything you and Jarvis draft lands here. Open one to read and edit it, move it Draft →
          Approved → Posted, or select several to act on at once. Reading through and spotting one
          that should go? Mark it "To delete", then clear them all at once under that filter.
          Nothing posts automatically.
        </p>
      </header>

      {/* Collection switcher — the Library is also the reading room for what
          Jarvis gathered (findings, build/avoid steers, recs, research queue). */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          { id: "drafts", label: "Drafts", icon: Article, count: drafts.length },
          { id: "findings", label: "Findings", icon: Notepad, count: research.findings.length },
          { id: "directives", label: "Build / Avoid", icon: Flag, count: research.directives.length },
          { id: "recs", label: "Recommendations", icon: Lightbulb, count: research.recs.length },
          { id: "queue", label: "Queue", icon: QueueIcon, count: research.queue.length },
        ].map((c) => (
          <button
            key={c.id}
            onClick={() => setCollection(c.id)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition ${
              collection === c.id
                ? "border-brand/40 bg-brand-soft text-brand"
                : "border-line-strong bg-surface text-muted hover:border-brand/40 hover:text-ink-2"
            }`}
          >
            <c.icon size={15} weight={collection === c.id ? "fill" : "regular"} />
            {c.label}
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] tabular-nums ${collection === c.id ? "bg-brand/10" : "bg-surface-2"}`}>
              {c.count}
            </span>
          </button>
        ))}
        <UploadDrafts onUploaded={refresh} className="ml-auto" />
      </div>

      {/* One plain sentence per collection, so a first-time (or fifty-plus)
          reader knows what they're looking at without the backstory. */}
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        {
          {
            drafts: "Posts and blogs waiting for your eyes. Open one to read or edit it — nothing goes anywhere until you post it yourself.",
            findings: "What the researcher learned out on the web — the raw insights the drafts above are built from.",
            directives: "Standing advice the researcher gave the writer: build this, avoid that. Tick each one off once it's been handled.",
            recs: "Suggestions for Larkwell's marketing, most-repeated first. Approve one and Jarvis writes a draft from it for your review.",
            queue: "Topics waiting for the researcher to pick up next.",
          }[collection]
        }
      </p>

      {/* Search */}
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2">
        <MagnifyingGlass size={16} className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={collection === "drafts" ? "Search drafts by title, body, keyword…" : "Search these records…"}
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
        />
        {query && (
          <button onClick={() => setQuery("")} className="text-faint hover:text-ink" title="Clear">
            <X size={15} />
          </button>
        )}
      </div>

      {collection !== "drafts" && (
        <ResearchList kind={collection} research={research} query={query} unreachable={unreachable} />
      )}

      {collection === "drafts" && (<>
      {/* Status pills */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>
          All{summary ? ` (${summary.total - (summary.byStatus?.archived || 0)})` : ""}
        </Pill>
        {STATUSES.filter((s) => s.id !== "archived" || summary?.byStatus?.archived || filter === "archived").map((s) => (
          <Pill key={s.id} active={filter === s.id} onClick={() => setFilter(s.id)}>
            {s.label}
            {summary ? ` (${summary.byStatus?.[s.id] || 0})` : ""}
          </Pill>
        ))}
      </div>

      {filter === "archived" && shown.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-[13px] text-ink-2">
          <span>
            {shown.length === 1 ? "1 draft is" : `${shown.length} drafts are`} archived: kept, but out of sight and never scheduled. Jarvis still checks them so it doesn't write the same thing again.
          </span>
          <Button variant="outline" className="ml-auto" onClick={restoreShown}>
            Restore {shown.length === 1 ? "it" : `these ${shown.length}`}
          </Button>
        </div>
      )}

      {filter === "delete" && shown.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-crit/30 bg-crit-soft/50 px-4 py-2.5 text-[13px] text-ink-2">
          <span>
            {shown.length === 1 ? "1 draft is" : `${shown.length} drafts are`} marked for deletion. Read them once more if you like, then clear them here.
          </span>
          <Button variant="outline" className="ml-auto border-crit/40 text-crit hover:border-crit hover:text-crit" onClick={removeMarked}>
            <Trash size={15} /> Delete all marked
          </Button>
        </div>
      )}

      {/* Compact filter/sort row */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px]">
        <FilterSelect label="Type" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.id, label: k.label }))} />
        <FilterSelect label="Style" value={postType} onChange={setPostType} options={voiceOptions} searchable />
        <FilterSelect label="Service" value={service} onChange={setService} options={serviceOptions} searchable />
        <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} />
        {anyFilter && (
          <button
            onClick={() => {
              setFilter("all");
              setKind("all");
              setPostType("all");
              setService("all");
              setQuery("");
            }}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-faint transition hover:text-ink"
          >
            <X size={13} /> Clear filters
          </button>
        )}
      </div>

      {actionError && <Card className="mb-4 p-3 text-[13px] text-warn">{actionError}</Card>}

      {unreachable && (
        <div className="mb-3 rounded-lg border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          Jarvis is catching up, so these may be a moment behind. Your work is safe.
          {drafts.length > 0 ? " Showing the last loaded list." : ""}
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-2 px-1 py-10 text-[14px] text-muted">
          <CircleNotch size={16} className="animate-spin" /> Loading your library…
        </div>
      ) : shown.length === 0 ? (
        unreachable ? null : <EmptyState filter={filter} query={query} />
      ) : (
        <>
          {/* Selection / bulk bar */}
          {selected.size > 0 ? (
            <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-[13px] shadow-card">
              <span className="font-semibold text-brand">{selected.size} selected</span>
              <span className="mx-1 h-4 w-px bg-brand/30" />
              <BulkBtn onClick={() => bulkStatus("approved")}>Approve</BulkBtn>
              <BulkBtn onClick={() => bulkStatus("posted")}>Mark posted</BulkBtn>
              <BulkBtn onClick={() => bulkStatus("draft")}>Set draft</BulkBtn>
              <BulkBtn onClick={() => bulkStatus("delete")}>Mark to delete</BulkBtn>
              <BulkBtn onClick={bulkRemove} danger>
                <Trash size={14} /> Delete
              </BulkBtn>
              <button onClick={() => setSelected(new Set())} className="ml-auto text-[12px] text-brand/80 hover:text-brand">
                Clear selection
              </button>
            </div>
          ) : (
            <div className="mb-2 flex items-center justify-between px-1 text-[12px] text-faint">
              <button onClick={toggleSelectAll} className="inline-flex items-center gap-2 hover:text-ink-2">
                <Square size={16} /> Select all ({shown.length})
              </button>
              <span>
                Showing {shown.length}
                {shown.length !== drafts.length ? ` of ${drafts.length}` : ""}
              </span>
            </div>
          )}

          <Card className="overflow-hidden">
            {selected.size > 0 && (
              <button
                onClick={toggleSelectAll}
                className="flex w-full items-center gap-2 border-b border-line bg-canvas/50 px-3 py-2 text-[12px] text-muted hover:text-ink-2"
              >
                {allShownSelected ? <CheckSquare size={16} weight="fill" className="text-brand" /> : <Square size={16} />}
                {allShownSelected ? "Deselect all shown" : `Select all ${shown.length} shown`}
              </button>
            )}
            <div className="divide-y divide-line">
              {shown.map((d) => (
                <LibraryRow
                  key={d.id}
                  record={d}
                  selected={selected.has(d.id)}
                  onToggleSel={toggleSel}
                  onStatus={setStatus}
                  onRemove={remove}
                  onOpen={(mode) => setOpen({ id: d.id, mode })}
                  scheduledFor={scheduled[d.id]?.date}
                  onMakePoster={onMakePoster}
                />
              ))}
            </div>
          </Card>
        </>
      )}
      </>)}

      {openRecord && (
        <DraftModal
          record={openRecord}
          gone={recordGone}
          mode={open.mode}
          setMode={(mode) => setOpen((o) => ({ ...o, mode }))}
          onClose={() => setOpen(null)}
          onStatus={setStatus}
          onRemove={remove}
          onSave={saveEdit}
          onBrief={briefJarvis}
          onMakeImage={onMakeImage}
        />
      )}
    </div>
  );
}
