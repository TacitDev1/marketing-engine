import { useState, useEffect, useMemo, useRef } from "react";
import {
  Sparkle,
  CircleNotch,
  Copy,
  Check,
  DownloadSimple,
  MagnifyingGlass,
  Database,
  CheckCircle,
  WarningCircle,
  BookmarkSimple,
  ImageSquare,
  Globe,
  Trash,
} from "@phosphor-icons/react";
import { services } from "../lib/company.js";
import { Button, Card, Pill, Eyebrow } from "../components/ui.jsx";
import JarvisBrief from "../components/JarvisBrief.jsx";
import Markdown from "../components/Markdown.jsx";
import { demoSamples } from "../lib/demo.js";
import { prettySource } from "../lib/format.js";

export default function Blogs({ incoming, onMakeImage }) {
  const [keywords, setKeywords] = useState([]);
  const [filter, setFilter] = useState("");
  // The static demo opens with a sample article on show.
  const sample = demoSamples("blogs")[0];
  const [selected, setSelected] = useState(sample ? { keyword: sample.keyword } : null); // { keyword, volume, ... }
  const [serviceId, setServiceId] = useState("");
  const [nudge, setNudge] = useState("");
  const [generating, setGenerating] = useState(false);
  const [blog, setBlog] = useState(sample ? { ...sample, targetKeyword: sample.keyword } : null);
  const [error, setError] = useState(null);

  const [keywordsFailed, setKeywordsFailed] = useState(false);
  useEffect(() => {
    fetch("/api/keywords")
      .then((r) => r.json())
      .then((d) => {
        setKeywords(d.keywords || []);
        setKeywordsFailed(!!d.error);
      })
      // "No keywords match" when the FETCH failed is a lie — flag it instead.
      .catch(() => setKeywordsFailed(true));
  }, []);

  // Deep-linked from the SEO screen: preselect the keyword and draft it. Guard
  // by the deep-link ts so it fires exactly once per click — depending on
  // keywords.length used to fire it a second time when the list finished
  // loading, generating (and clobbering) a second slow draft.
  const appliedTsRef = useRef(null);
  // Live mirror of blog/generating for the deep-link effect (its deps are
  // deliberately just incoming.ts, so direct reads would be stale closures).
  const stateRef = useRef({ blog: null, generating: false });
  useEffect(() => {
    stateRef.current = { blog, generating };
  });
  useEffect(() => {
    if (!incoming?.keyword || appliedTsRef.current === incoming.ts) return;
    appliedTsRef.current = incoming.ts;
    // The deep-link must never silently destroy work: an article on screen may
    // be unsaved (or still being written) — ask before replacing it.
    const cur = stateRef.current;
    if (
      (cur.generating || cur.blog) &&
      !window.confirm(`Draft a new article for "${incoming.keyword}"? The article currently on screen will be replaced${cur.blog ? " — save it to the Library first if you want to keep it" : ""}.`)
    ) {
      return;
    }
    const match = keywords.find((k) => k.keyword === incoming.keyword) || {
      keyword: incoming.keyword,
    };
    setSelected(match);
    generateFor(match.keyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.ts]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? keywords.filter((k) => k.keyword.toLowerCase().includes(q))
      : keywords;
    return list.slice(0, 40);
  }, [keywords, filter]);

  // Sequence counter: with two generations overlapping (deep-link during a
  // slow run), only the LATEST request may touch the screen — the first one
  // finishing used to re-enable the button and then silently swap the article.
  const genSeqRef = useRef(0);

  async function generateFor(keyword, svcId = serviceId, nudgeText = "") {
    if (!keyword) return;
    const seq = ++genSeqRef.current;
    const mine = () => seq === genSeqRef.current;
    setGenerating(true);
    setError(null);
    setBlog(null);
    try {
      const res = await fetch("/api/blog/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, serviceId: svcId || undefined, nudge: nudgeText || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).message || `server ${res.status}`);
      const data = await res.json();
      // The local model occasionally returns a draft with missing fields —
      // normalise here so the result screen can never crash on one.
      if (!data?.body) throw new Error("The model returned an incomplete draft. Generate again.");
      if (!mine()) return; // a newer generation superseded this one
      setBlog({
        ...data,
        title: String(data.title || keyword),
        metaDescription: String(data.metaDescription || ""),
        slug: String(data.slug || ""),
        body: String(data.body),
        targetKeyword: keyword,
      });
    } catch (e) {
      if (!mine()) return;
      setError(
        e?.message && !/failed to fetch/i.test(e.message)
          ? e.message
          : "Jarvis isn't responding right now."
      );
    } finally {
      if (mine()) setGenerating(false);
    }
  }

  const generate = () => generateFor(selected?.keyword, serviceId, nudge);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8">
        <Eyebrow>Website</Eyebrow>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          Blog drafts
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Pick a keyword you actually want to rank for, and the agent drafts an
          SEO-structured article grounded in your own research. Export as Markdown
          for the website. Drafts only - you review and publish.
        </p>
        {keywords.length > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-muted">
            <Database size={15} weight="fill" className="text-brand" />
            <span className="font-medium text-ink-2">{keywords.length}</span> real
            target keywords from your research
          </div>
        )}
      </header>

      <Card className="mb-8 p-6">
        <div className="space-y-5">
          {/* Keyword picker */}
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-2">
              Target keyword
            </label>
            <div className="relative">
              <MagnifyingGlass
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter keywords, e.g. s/4hana, cloud, basis…"
                className="w-full rounded-lg border border-line-strong bg-canvas py-2 pl-9 pr-3 text-[15px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
              />
            </div>

            <div className="scroll-quiet mt-3 max-h-56 overflow-y-auto rounded-lg border border-line">
              {matches.length === 0 ? (
                <p className="px-3 py-4 text-[13px] text-faint">
                  {keywordsFailed
                    ? "Couldn't load your keyword research — Jarvis may be starting up. You can still type any keyword and draft it."
                    : "No keywords match. Type and pick from your research list."}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {matches.map((k) => (
                    <li key={k.keyword}>
                      <button
                        onClick={() => setSelected(k)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-canvas ${
                          selected?.keyword === k.keyword ? "bg-brand/5" : ""
                        }`}
                      >
                        <span className="flex-1 text-[14px] text-ink-2">
                          {k.keyword}
                        </span>
                        {k.theme && (
                          <span className="hidden text-[12px] text-faint sm:inline">
                            {k.theme}
                          </span>
                        )}
                        {k.source === "researched" && (
                          <span className="hidden rounded-md bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand sm:inline" title="Found by your deep researcher">
                            researched
                          </span>
                        )}
                        {k.volume != null && (
                          <span
                            className="rounded-md bg-canvas px-2 py-0.5 font-mono text-[12px] text-muted"
                            title={k.estimated ? "The researcher's estimate, not a measured search volume" : k.volumeSource === "semrush" ? "Measured by SEMrush" : "From the keyword sheet"}
                          >
                            {k.volume.toLocaleString()}/mo{k.estimated ? " est." : ""}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Service anchor */}
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-2">
              Anchor service <span className="text-faint">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Pill active={serviceId === ""} onClick={() => setServiceId("")}>
                None
              </Pill>
              {services.map((s) => (
                <Pill
                  key={s.id}
                  active={serviceId === s.id}
                  onClick={() => setServiceId(s.id)}
                >
                  {s.label}
                </Pill>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-ink-2">
              Tweak <span className="text-faint">(optional)</span>
            </label>
            <input
              value={nudge}
              onChange={(e) => setNudge(e.target.value)}
              placeholder="e.g. more technical, add a migration checklist, lead with cost…"
              className="w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[14px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={generate} disabled={!selected || generating}>
              {generating ? (
                <>
                  <CircleNotch size={17} className="animate-spin" />
                  Writing the article…
                </>
              ) : (
                <>
                  <Sparkle weight="fill" size={17} />
                  Draft blog
                </>
              )}
            </Button>
            {selected && !generating && (
              <span className="text-[13px] text-faint">
                Target: <span className="text-muted">{selected.keyword}</span>
              </span>
            )}
          </div>
          {error && (
            <p className="text-[13px] text-crit">{error}</p>
          )}
        </div>
      </Card>

      {generating && <BlogSkeleton />}
      {blog && !generating && <BlogResult blog={blog} onMakeImage={onMakeImage} onBlogChange={setBlog} onDiscard={() => setBlog(null)} />}
      {!blog && !generating && !error && <EmptyState />}
    </div>
  );
}

function BlogResult({ blog, onMakeImage, onBlogChange, onDiscard }) {
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [libId, setLibId] = useState(null);
  const [pubState, setPubState] = useState("idle"); // idle | publishing | done | error
  const [pubNote, setPubNote] = useState(null);
  const [saveNote, setSaveNote] = useState(null); // why the last save was refused

  // Discard, same meaning as the bin on LinkedIn drafts: it clears the article
  // off this screen. A saved article stays in the Library — deleting or
  // marking "To delete" happens there, where reviewers work (one meaning per
  // icon across screens, so nobody learns "the bin is safe" on one screen and
  // loses work on the other). Confirms first when it was never saved.
  function discard() {
    const msg = libId
      ? "Clear this article from the screen? It stays in the Library."
      : "Discard this article? It was never saved, so this can't be undone.";
    if (!window.confirm(msg)) return;
    onDiscard?.();
  }

  // Returns the library id on success (so makeImage can chain), null on failure.
  async function save() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "blog", payload: { ...blog, libraryId: libId || undefined } }),
      });
      // fetch only rejects on network failure — a 500 must not show "Saved".
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setSaveNote(e.message || null);
        setSaveState("error");
        return null;
      }
      setSaveNote(null);
      const rec = await res.json();
      setLibId(rec.id);
      // Surface the brain's "reads like an existing draft" flag on this card too.
      if (rec.duplicateOf && onBlogChange) {
        const twin = `Reads like an existing draft (${Math.round(rec.duplicateOf.score * 100)}%): "${rec.duplicateOf.title}"`;
        onBlogChange({ ...blog, warnings: [...(blog.warnings || []).filter((w) => !/^Reads like an existing draft/.test(w)), twin] });
      }
      setSaveState("saved");
      return rec.id;
    } catch {
      setSaveState("error");
      return null;
    }
  }

  // Image workflow: save to the Library first (an image should always trace
  // back to a saved draft), then Images auto-completes a hero image from it.
  async function makeImage() {
    const id = libId || (await save());
    if (id && onMakeImage) onMakeImage(id);
  }

  // Publish = stage the finished post into the website for review. It's written
  // as a hidden draft and is NOT pushed live, so nothing appears on the site
  // until it's reviewed and the site is published.
  async function publish() {
    setPubState("publishing");
    setPubNote(null);
    const id = libId || (await save());
    if (!id) {
      setPubState("error");
      setPubNote("Couldn't save the post first. Try again in a moment.");
      return;
    }
    try {
      const res = await fetch("/api/website/export-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, publish: false }),
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

  // If the post is edited (e.g. via Ask Jarvis) after being published, clear the
  // "Published" state so it can be sent again with the changes.
  useEffect(() => {
    setPubState("idle");
    setPubNote(null);
  }, [blog.title, blog.body]);

  const markdown = useMemo(() => {
    return [
      "---",
      `title: "${blog.title.replace(/"/g, "'")}"`,
      `description: "${blog.metaDescription.replace(/"/g, "'")}"`,
      `slug: ${blog.slug}`,
      "---",
      "",
      blog.body,
    ].join("\n");
  }, [blog]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (non-secure context) — don't throw an unhandled rejection */
    }
  }

  function download() {
    const blobUrl = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown" })
    );
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${blog.slug || "blog"}.md`;
    a.click();
    // Revoking synchronously after click() occasionally kills the save in some
    // browsers — let the download grab the blob first.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  const kw = blog.targetKeyword.toLowerCase();
  const titleHasKw = blog.title.toLowerCase().includes(kw);
  const bodyHasKw = blog.body.toLowerCase().includes(kw);
  const titleLen = blog.title.length;
  const metaLen = blog.metaDescription.length;

  return (
    <Card className="reveal overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-ink">
            {blog.title}
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            {blog.metaDescription}
          </p>
          <p className="mt-2 font-mono text-[12px] text-faint">/blog/{blog.slug}</p>
        </div>
        <button
          onClick={discard}
          disabled={saveState === "saving" || pubState === "publishing"}
          title={libId ? "Clear from the screen (it stays in the Library)" : "Discard this article"}
          className="shrink-0 rounded-md p-1.5 text-faint transition hover:bg-line/70 hover:text-crit disabled:opacity-50"
        >
          <Trash size={17} />
        </button>
      </div>

      {saveNote && (
        <div className="border-b border-warn/25 bg-warn-soft px-6 py-2 text-[12.5px] text-warn">{saveNote}</div>
      )}
      {!String(blog.body || "").trim() && (
        <div className="border-b border-crit/25 bg-crit-soft px-6 py-2 text-[12.5px] text-crit">
          This article came back with no body text. Generate it again before saving.
        </div>
      )}

      {/* SEO checks */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-line bg-canvas/50 px-6 py-3">
        <SeoCheck
          ok={titleLen >= 50 && titleLen <= 60}
          label={`Title ${titleLen} chars`}
          hint="50-60 ideal"
        />
        <SeoCheck
          ok={metaLen >= 140 && metaLen <= 160}
          label={`Meta ${metaLen} chars`}
          hint="140-160 ideal"
        />
        <SeoCheck ok={titleHasKw} label="Keyword in title" />
        <SeoCheck ok={bodyHasKw} label="Keyword in body" />
      </div>

      {blog.warnings?.length > 0 && (
        <div className="flex items-start gap-2 border-b border-line bg-warn-soft px-6 py-2.5 text-[12px] text-warn">
          <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0 text-warn" />
          <span>{blog.warnings.join(" · ")}</span>
        </div>
      )}

      {/* Body */}
      <div className="px-6 py-5">
        <Markdown text={blog.body} />
      </div>

      {blog.grounding?.length > 0 && (
        <div className="flex items-start gap-2 border-t border-line px-6 py-3 text-[12px] text-faint">
          <Database size={14} weight="fill" className="mt-0.5 text-brand/60" />
          <span>
            Grounded on your data:{" "}
            <span className="text-muted">
              {[...new Set(blog.grounding.map((g) => prettySource(g)))].join(", ")}
            </span>
          </span>
        </div>
      )}

      <div className="border-t border-line bg-canvas/30 px-6 py-3">
        <JarvisBrief
          ensureSaved={save}
          disabled={saveState === "saving"}
          onRevised={(payload) =>
            onBlogChange({ ...blog, ...payload, targetKeyword: blog.targetKeyword })
          }
          lastBrief={blog.briefs?.length ? blog.briefs[blog.briefs.length - 1].instruction : ""}
          placeholder='Ask Jarvis to change this article, e.g. "add a migration checklist, cut the intro"…'
        />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas/50 px-6 py-3">
        {onMakeImage && (
          <Button variant="ghost" onClick={makeImage} disabled={saveState === "saving"} title="Save to library and make a hero image from this blog">
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
        <Button variant="outline" onClick={copy}>
          {copied ? (
            <>
              <Check size={16} weight="bold" /> Copied
            </>
          ) : (
            <>
              <Copy size={16} /> Copy Markdown
            </>
          )}
        </Button>
        <Button variant="outline" onClick={download}>
          <DownloadSimple size={16} /> Download .md
        </Button>
        <Button
          onClick={publish}
          disabled={pubState === "publishing" || pubState === "done" || saveState === "saving"}
          title="Send this post to the website, staged for review. It won't go live until it's reviewed and the site is published."
        >
          {pubState === "publishing" ? (
            <><CircleNotch size={16} className="animate-spin" /> Publishing…</>
          ) : pubState === "done" ? (
            <><Check size={16} weight="bold" /> Published for review</>
          ) : (
            <><Globe size={16} /> Publish to website</>
          )}
        </Button>
      </div>
      {pubNote && (
        <p className={`border-t border-line px-6 py-2.5 text-[12px] ${pubState === "error" ? "text-crit" : "text-good"}`}>
          {pubNote}
        </p>
      )}
    </Card>
  );
}

function SeoCheck({ ok, label, hint }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      {ok ? (
        <CheckCircle size={16} weight="fill" className="text-good" />
      ) : (
        <WarningCircle size={16} weight="fill" className="text-warn" />
      )}
      <span className={ok ? "text-ink-2" : "text-muted"}>{label}</span>
      {hint && <span className="text-faint">· {hint}</span>}
    </span>
  );
}

function BlogSkeleton() {
  return (
    <Card className="reveal p-6">
      <div className="mb-4 h-6 w-2/3 animate-pulse rounded bg-line" />
      <div className="mb-5 h-3 w-full animate-pulse rounded bg-line" />
      <div className="space-y-2.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-line"
            style={{ width: `${70 + ((i * 7) % 30)}%` }}
          />
        ))}
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
      <h3 className="text-[15px] font-medium text-ink">No draft yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-[14px] leading-relaxed text-muted">
        Pick a target keyword above and draft an article. Higher search volume
        means more potential traffic if you rank.
      </p>
    </div>
  );
}
