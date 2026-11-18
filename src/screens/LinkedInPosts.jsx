import { useState, useEffect } from "react";
import {
  Sparkle,
  Copy,
  Check,
  ArrowsClockwise,
  Trash,
  PencilSimple,
  CircleNotch,
  Brain,
  Database,
  LinkSimple,
  Newspaper,
  WarningCircle,
  BookmarkSimple,
  ImageSquare,
} from "@phosphor-icons/react";
import { postTypes, services, products } from "../lib/company.js";
import { requestDraft, draftToText } from "../lib/generators.js";
import { Button, Card, Pill, Eyebrow, Badge } from "../components/ui.jsx";
import JarvisBrief from "../components/JarvisBrief.jsx";
import { prettySource } from "../lib/format.js";
import { demoSamples } from "../lib/demo.js";

const LINKEDIN_LIMIT = 3000;

const TONES = [
  { id: "refined", label: "Refined" },
  { id: "punchy", label: "Punchy" },
];
const HASHTAG_STYLES = [
  { id: "clean", label: "2 relevant" },
  { id: "none", label: "None" },
];

export default function LinkedInPosts({ onMakeImage }) {
  const [type, setType] = useState("case-study");
  const [serviceId, setServiceId] = useState("");
  const [productId, setProductId] = useState(""); // a product anchor replaces the service anchor
  const [tone, setTone] = useState("refined");
  const [hashtagStyle, setHashtagStyle] = useState("clean");
  // The static demo opens with two sample drafts on show.
  const [drafts, setDrafts] = useState(() =>
    demoSamples("linkedin").slice(0, 2).map((d, i) => ({ ...d, id: `sample-${i}`, source: "model", createdAt: new Date().toISOString() }))
  );
  const [generating, setGenerating] = useState(false);
  // A SET, not a single id: two overlapping 30-120s regenerations used to share
  // one flag — starting B stopped A's spinner, and A finishing killed B's,
  // re-enabling a busy button mid-flight.
  const [regenIds, setRegenIds] = useState(() => new Set());
  const [knowledge, setKnowledge] = useState(null);
  const [urls, setUrls] = useState("");
  const [reacting, setReacting] = useState(false);
  const [reactError, setReactError] = useState(null);
  const [reactNote, setReactNote] = useState(null);

  useEffect(() => {
    fetch("/api/knowledge/status")
      .then((r) => r.json())
      .then(setKnowledge)
      .catch(() => setKnowledge(null));
  }, []);

  const opts = () => ({ tone, hashtagStyle, productId });

  // A failed generation (e.g. a product post with the model down: there is no
  // honest template for those) must be said, not swallowed by the spinner.
  const [genError, setGenError] = useState("");
  async function handleGenerate() {
    setGenerating(true);
    setGenError("");
    try {
      const draft = await requestDraft(type, serviceId || undefined, opts());
      setDrafts((prev) => [draft, ...prev]);
    } catch (e) {
      setGenError(e?.message || "Couldn't generate a draft.");
    } finally {
      setGenerating(false);
    }
  }

  async function react() {
    const list = urls.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
    if (!list.length) return;
    setReacting(true);
    setReactError(null);
    setReactNote(null);
    try {
      const res = await fetch("/api/generate-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: list, ...opts() }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || `server ${res.status}`);
      }
      const d = await res.json();
      // generate-from-url returns a normal draft shape ({ hook, body, hashtags,
      // failed[] }) — there is no single `post` field, so validate on the real
      // draft text and keep the draft as-is. (The old `d.post` check made every
      // successful reaction throw and show a misleading "couldn't read" error.)
      if (!d?.hook && !d?.body) throw new Error("empty draft");
      setDrafts((prev) => [
        // isReaction: this draft came from links, not a postType/service, so
        // "Regenerate" (which redraws from type+service) can't reproduce it and
        // would silently swap in an unrelated post — the card disables it.
        { hashtags: [], ...d, id: `r-${Date.now()}`, createdAt: new Date().toISOString(), isReaction: true },
        ...prev,
      ]);
      setUrls("");
      // Some of the pasted links may have been unreadable — say which, so the
      // draft isn't silently based on fewer sources than the user expected.
      if (Array.isArray(d.failed) && d.failed.length) {
        setReactNote(
          `Drafted from the links that could be read. Couldn't read: ${d.failed.map((f) => (f && f.url) || f).join(", ")}`
        );
      }
    } catch (e) {
      // Say what actually failed: the brain being down is not the websites' fault.
      const msg = String(e?.message || "");
      setReactError(
        /failed to fetch|networkerror|load failed/i.test(msg) || !msg
          ? "Jarvis isn't responding (is the app server running?)."
          : /brain_unavailable|ollama|model/i.test(msg)
            ? `The model didn't answer: ${msg}`
            : `Could not read those links (${msg}). Some sites block automated reading - try different ones.`
      );
    } finally {
      setReacting(false);
    }
  }

  async function regenerate(oldDraft, nudge = "") {
    if (regenIds.has(oldDraft.id)) return; // already regenerating this card
    setRegenIds((s) => new Set(s).add(oldDraft.id));
    try {
      const fresh = await requestDraft(oldDraft.type, oldDraft.service, { ...opts(), productId: oldDraft.productId || "", nudge });
      // Keep the library id if it was already saved, so re-save updates in place
      // instead of creating a duplicate record.
      setDrafts((prev) =>
        prev.map((d) => (d.id === oldDraft.id ? { ...fresh, id: oldDraft.id, libraryId: oldDraft.libraryId } : d))
      );
    } catch (e) {
      setGenError(`Couldn't regenerate: ${e?.message || "the model didn't answer"}. The previous draft is kept.`);
    } finally {
      setRegenIds((s) => {
        const n = new Set(s);
        n.delete(oldDraft.id);
        return n;
      });
    }
  }

  function update(id, next) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? next : d)));
  }

  function remove(id) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }

  const activeType = postTypes.find((t) => t.id === type);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8">
        <Eyebrow>LinkedIn</Eyebrow>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Post drafts</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          On-brand drafts grounded in real Larkwell services. Pick an angle, generate,
          edit anything you like, then copy it across to LinkedIn yourself. Drafts
          stay inside Larkwell: nothing is sent to LinkedIn or any outside service.
        </p>
        {knowledge && knowledge.files > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-muted">
            <Database size={15} weight="fill" className="text-brand" />
            Grounded on{" "}
            <span className="font-medium text-ink-2">{knowledge.files} of your marketing files</span>
            <span className="text-faint">· {knowledge.chunks} sections</span>
            {knowledge.retrieval === "semantic" && <Badge tone="good">semantic</Badge>}
          </div>
        )}
      </header>

      {/* Controls */}
      <Card className="mb-8 p-6">
        <div className="space-y-5">
          <Field label="Post type">
            <div className="flex flex-wrap gap-2">
              {postTypes.map((t) => (
                <Pill key={t.id} active={type === t.id} onClick={() => setType(t.id)}>
                  {t.label}
                </Pill>
              ))}
            </div>
            {activeType && <p className="mt-2 text-[13px] text-faint">{activeType.hint}</p>}
          </Field>

          <Field label="Anchor">
            <div className="flex flex-wrap gap-2">
              <Pill active={serviceId === "" && productId === ""} onClick={() => { setServiceId(""); setProductId(""); }}>
                Surprise me
              </Pill>
              {services.map((s) => (
                <Pill key={s.id} active={productId === "" && serviceId === s.id} onClick={() => { setServiceId(s.id); setProductId(""); }}>
                  {s.label}
                </Pill>
              ))}
            </div>
            <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">Larkwell products</p>
            <div className="flex flex-wrap gap-2">
              {products.map((pr) => (
                <Pill key={pr.id} active={productId === pr.id} onClick={() => { setProductId(pr.id); setServiceId(""); }}>
                  {pr.label}
                </Pill>
              ))}
            </div>
            {productId && (
              <p className="mt-2 text-[13px] text-faint">
                Anchored on {products.find((pr) => pr.id === productId)?.label}: the post states only its verified facts.
              </p>
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Voice">
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <Pill key={t.id} active={tone === t.id} onClick={() => setTone(t.id)}>
                    {t.label}
                  </Pill>
                ))}
              </div>
            </Field>
            <Field label="Hashtags">
              <div className="flex flex-wrap gap-2">
                {HASHTAG_STYLES.map((h) => (
                  <Pill key={h.id} active={hashtagStyle === h.id} onClick={() => setHashtagStyle(h.id)}>
                    {h.label}
                  </Pill>
                ))}
              </div>
            </Field>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? (
                <><CircleNotch size={17} className="animate-spin" /> Thinking…</>
              ) : (
                <><Sparkle weight="fill" size={17} /> Generate draft</>
              )}
            </Button>
            {genError && <p className="mt-2 text-[13px] text-warn">{genError}</p>}
            {drafts.length > 0 && !generating && (
              <span className="text-[13px] text-faint">
                {drafts.length} draft{drafts.length === 1 ? "" : "s"} in this session
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* React to link(s) */}
      <Card className="mb-8 p-6">
        <div className="mb-2 flex items-center gap-2">
          <Newspaper size={18} weight="fill" className="text-brand" />
          <h2 className="text-[15px] font-semibold text-ink">React to a link</h2>
        </div>
        <p className="mb-3 text-[13px] text-faint">
          Paste an SAP news article, announcement, or analyst note - one per line. With
          several, the agent finds the common thread and drafts one synthesis post.
        </p>
        <div className="flex flex-col gap-2">
          <div className="relative">
            <LinkSimple size={16} className="absolute left-3 top-3 text-faint" />
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              rows={urls.split("\n").length > 1 ? 3 : 1}
              placeholder="https://news.sap.com/…  (one link per line)"
              className="w-full resize-y rounded-lg border border-line-strong bg-canvas py-2 pl-9 pr-3 text-[15px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <Button onClick={react} disabled={reacting || !urls.trim()}>
              {reacting ? (
                <><CircleNotch size={17} className="animate-spin" /> Reading…</>
              ) : (
                <><Newspaper weight="fill" size={16} /> Draft reaction</>
              )}
            </Button>
          </div>
        </div>
        {reactError && <p className="mt-2 text-[13px] text-crit">{reactError}</p>}
        {reactNote && <p className="mt-2 text-[13px] text-warn">{reactNote}</p>}
      </Card>

      {/* Drafts */}
      {drafts.length === 0 && !generating ? (
        <EmptyState />
      ) : (
        <div className="space-y-5">
          {generating && <ThinkingCard />}
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              regenerating={regenIds.has(draft.id)}
              onRegenerate={(nudge) => regenerate(draft, nudge)}
              onRemove={() => remove(draft.id)}
              onChange={(next) => update(draft.id, next)}
              onMakeImage={onMakeImage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-ink-2">{label}</label>
      {children}
    </div>
  );
}

function DraftCard({ draft, regenerating, onRegenerate, onRemove, onChange, onMakeImage }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState(draft.libraryId ? "saved" : "idle");

  const text = draftToText(draft);
  const overLimit = text.length > LINKEDIN_LIMIT;
  const typeLabel = postTypes.find((t) => t.id === draft.type)?.label || draft.type;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (non-secure context) — don't throw an unhandled rejection */
    }
  }

  // Returns the library id on success (so makeImage can chain), null on failure.
  async function save() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "linkedin", payload: draft }),
      });
      // fetch only rejects on network failure — a 500 must not show "Saved"
      // (and its error body has no id to store as libraryId).
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || `server ${res.status}`);
      }
      const rec = await res.json();
      // The brain flags a save that reads like a draft already in the Library;
      // show it here, on the card, not only later in the Library.
      const twin = rec.duplicateOf ? `Reads like an existing draft (${Math.round(rec.duplicateOf.score * 100)}%): "${rec.duplicateOf.title}"` : null;
      const warnings = twin ? [...(draft.warnings || []).filter((w) => !/^Reads like an existing draft/.test(w)), twin] : draft.warnings;
      onChange({ ...draft, libraryId: rec.id, warnings });
      setSaveState("saved");
      return rec.id;
    } catch {
      setSaveState("error");
      return null;
    }
  }

  // Image workflow from a fresh draft: it lands in the Library first (an image
  // should always trace back to a saved draft), then Images auto-completes.
  async function makeImage() {
    const libId = draft.libraryId || (await save());
    if (libId && onMakeImage) onMakeImage(libId);
  }

  // Persist the current text, then return its Library id, so "Ask Jarvis"
  // revises exactly what's on screen. First save creates the record; after
  // that we PATCH (save() would create a duplicate).
  async function ensureSavedForBrief() {
    if (!draft.libraryId) return await save();
    try {
      const res = await fetch(`/api/drafts/${draft.libraryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: draft }),
      });
      return res.ok ? draft.libraryId : null;
    } catch {
      return null;
    }
  }

  return (
    <Card className="reveal overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <Badge tone="brand">{typeLabel}</Badge>
          <span className="text-faint">{draft.serviceLabel}</span>
          {draft.source === "offline" && (
            <Badge tone="warn" title="Local model unavailable — generated from offline templates.">
              offline
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <IconBtn title="Edit" onClick={() => setEditing((e) => !e)}>
            <PencilSimple size={17} />
          </IconBtn>
          <IconBtn
            title={draft.isReaction
              ? "Regenerate isn't available for link reactions — paste the link(s) again above to redraft"
              : "Regenerate"}
            onClick={() => { setSaveState("idle"); onRegenerate(""); }}
            disabled={regenerating || draft.isReaction}
          >
            <ArrowsClockwise size={17} className={regenerating ? "animate-spin" : ""} />
          </IconBtn>
          <IconBtn
            title="Discard"
            onClick={() => {
              // A draft costs 30-120s of model time and may be hand-edited —
              // one mis-click must not throw it away (Library's delete confirms;
              // this now matches).
              const msg = draft.libraryId ? "Remove this draft from the screen? It stays in the Library." : "Discard this draft? This can't be undone.";
              if (window.confirm(msg)) onRemove();
            }}
          >
            <Trash size={17} />
          </IconBtn>
        </div>
      </div>

      <div className="px-5 py-5">
        {draft.source === "offline" && (
          <p className="mb-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[13px] leading-relaxed text-warn">
            This is a canned offline template, not written by the model.
            {draft.offlineReason ? ` Reason: ${draft.offlineReason}.` : " The model didn't answer."} Fix that,
            then Regenerate for a real draft.
          </p>
        )}
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draft.hook}
              onChange={(e) => { setSaveState("idle"); onChange({ ...draft, hook: e.target.value }); }}
              className="w-full resize-none rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[15px] font-medium text-ink focus:border-brand focus:outline-none"
              rows={2}
            />
            <textarea
              value={draft.body}
              onChange={(e) => { setSaveState("idle"); onChange({ ...draft, body: e.target.value }); }}
              className="w-full resize-y rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[15px] leading-relaxed text-ink-2 focus:border-brand focus:outline-none"
              rows={10}
            />
          </div>
        ) : (
          <>
            <p className="text-[15px] font-medium leading-snug text-ink">{draft.hook}</p>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{draft.body}</p>
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {draft.hashtags.map((t) => (
            <Badge key={t} tone="neutral">#{t}</Badge>
          ))}
        </div>

        {draft.warnings?.length > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12px] text-warn">
            <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0 text-warn" />
            <span>{draft.warnings.join(" · ")}</span>
          </div>
        )}

        {draft.grounding?.length > 0 && (
          <div className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-[12px] text-faint">
            <Database size={14} weight="fill" className="mt-0.5 text-brand/60" />
            <span>
              Grounded on your data:{" "}
              <span className="text-muted">{[...new Set(draft.grounding.map(prettySource))].join(", ")}</span>
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-line bg-canvas/30 px-5 py-3">
        <JarvisBrief
          ensureSaved={ensureSavedForBrief}
          disabled={saveState === "saving"}
          onRevised={(payload, _warnings, savedId) => {
            onChange({ ...draft, ...payload, id: draft.id, libraryId: draft.libraryId ?? savedId });
            setSaveState("saved");
          }}
          lastBrief={draft.briefs?.length ? draft.briefs[draft.briefs.length - 1].instruction : ""}
          placeholder='Ask Jarvis to change this post, e.g. "make it shorter, lead with security"…'
        />
      </div>

      <div className="flex items-center justify-between border-t border-line bg-canvas/50 px-5 py-3">
        <span className={`font-mono text-[12px] ${overLimit ? "text-crit" : "text-faint"}`}>
          {text.length.toLocaleString()} / {LINKEDIN_LIMIT.toLocaleString()}
          {overLimit ? " · over limit" : ""}
        </span>
        <div className="flex items-center gap-2">
          {onMakeImage && (
            <Button variant="ghost" onClick={makeImage} disabled={saveState === "saving"} title="Save to library and make a LinkedIn image from this draft">
              <ImageSquare size={16} /> Image
            </Button>
          )}
          <Button variant="ghost" onClick={save} disabled={saveState === "saving"}>
            {saveState === "saved" ? (
              <><Check size={16} weight="bold" /> Saved</>
            ) : saveState === "saving" ? (
              <><CircleNotch size={16} className="animate-spin" /> Saving…</>
            ) : saveState === "error" ? (
              <><BookmarkSimple size={16} /> Save failed, retry</>
            ) : (
              <><BookmarkSimple size={16} /> Save to library</>
            )}
          </Button>
          <Button variant="outline" onClick={copy} title="Copies the post so you can paste it straight into LinkedIn">
            {copied ? <><Check size={16} weight="bold" /> Copied, paste it into LinkedIn</> : <><Copy size={16} /> Copy for LinkedIn</>}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function IconBtn({ children, title, ...props }) {
  return (
    <button
      title={title}
      className="grid h-8 w-8 place-items-center rounded-md text-faint transition hover:bg-line/70 hover:text-ink-2 disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}

function ThinkingCard() {
  return (
    <Card className="reveal p-5">
      <div className="mb-4 flex items-center gap-2 text-[13px] text-muted">
        <Brain size={17} weight="fill" className="text-brand" />
        <span>Jarvis is writing a draft…</span>
        <CircleNotch size={15} className="animate-spin text-faint" />
      </div>
      <div className="space-y-2.5">
        <div className="h-4 w-3/4 animate-pulse rounded bg-line" />
        <div className="h-3 w-full animate-pulse rounded bg-line" />
        <div className="h-3 w-full animate-pulse rounded bg-line" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-line" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-line" />
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-8 py-16 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-brand">
        <Sparkle weight="fill" size={24} />
      </div>
      <h3 className="text-[15px] font-medium text-ink">No drafts yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-[14px] leading-relaxed text-muted">
        Choose a post type and a service above, then generate your first draft.
        Re-run it as many times as you like to see different angles.
      </p>
    </div>
  );
}
