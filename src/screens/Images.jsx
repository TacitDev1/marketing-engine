import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  Image as ImageIcon,
  Sparkle,
  DownloadSimple,
  Trash,
  ArrowsClockwise,
  Lightning,
  ShieldCheck,
  Globe,
  Cards,
  TextT,
} from "@phosphor-icons/react";
import { Button, Card, Eyebrow, Pill, Select } from "../components/ui.jsx";
import PhotoCardStudio from "../components/PhotoCardStudio.jsx";
import { groupedDraftOptions } from "../lib/draft-options.js";
// AsciiLive pulls in Three.js (~670 KB). It's only used in the poster tab, so
// load it on demand to keep it out of the main bundle.
const AsciiLive = lazy(() => import("./AsciiLive.jsx"));

// Build a plain-text view of a saved draft, for image direction.
function draftText(d) {
  const p = d.payload || {};
  if (d.kind === "blog") return [p.title, p.metaDescription, p.body].filter(Boolean).join("\n\n");
  return [p.hook, p.body].filter(Boolean).join("\n\n");
}
export default function Images({ posterDraft, active = true }) {
  const [meta, setMeta] = useState({ images: [], providers: [], sizes: {}, cardStyles: {} });
  const [drafts, setDrafts] = useState([]);
  const [draftId, setDraftId] = useState("");
  const [source, setSource] = useState(""); // post text the image is based on

  const [mode, setMode] = useState("generate"); // "generate" | "ascii"
  const [provider, setProvider] = useState("cards");

  // Deep-link from the Library: "Make poster" jumps to the ASCII tab; the draft
  // modal's "Image" button jumps to the card/photo tab for a LinkedIn image.
  useEffect(() => {
    if (posterDraft?.ts) setMode(posterDraft.tab === "card" ? "generate" : "ascii");
  }, [posterDraft?.ts, posterDraft?.tab]);
  // For the card tab, complete the whole flow from the deep-linked draft: select
  // it, ask the brain for headline + image idea, and generate the image — one
  // click on "Image" in the Library gives a finished first image to react to.
  const autoRanTs = useRef(0);
  const refetchedTs = useRef(0);
  useEffect(() => {
    if (posterDraft?.tab !== "card" || !posterDraft?.draftId) return;
    // Wait until providers are loaded, otherwise `isCard` (derived from
    // providerMeta) is false and the one-click flow would post a photo prompt
    // to the default card provider, producing a blank/wrong card. The effect
    // re-runs when meta.providers lands.
    if (!meta.providers.length) return;
    const d = drafts.find((x) => x.id === posterDraft.draftId);
    if (!d) {
      // The draft was probably saved seconds ago (Image button on a fresh
      // LinkedIn/blog draft) and our list predates it — refetch once per click.
      if (refetchedTs.current !== posterDraft.ts) {
        refetchedTs.current = posterDraft.ts;
        fetch("/api/drafts")
          .then((r) => r.json())
          .then((x) => setDrafts(x.drafts || []))
          .catch(() => {});
      }
      return; // effect re-runs when the refreshed list lands
    }
    if (autoRanTs.current === posterDraft.ts) return; // already ran for this click
    autoRanTs.current = posterDraft.ts;
    selectDraft(d.id);
    completeFromDraft(draftText(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posterDraft?.ts, drafts, meta.providers]);

  // Suggest + generate in one pass, using explicit values (not state, which
  // hasn't committed yet when this runs right after the deep-link).
  async function completeFromDraft(text) {
    setSuggesting(true);
    setError("");
    let direction = null;
    try {
      const r = await fetch("/api/images/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const out = await r.json();
      if (out.error) throw new Error(out.message || out.error);
      direction = out;
      setHeadline(out.headline || "");
      setSubline(out.subline || "");
      setVisualPrompt(out.visualPrompt || "");
    } catch (e) {
      setError(`Couldn't suggest from the draft: ${e.message}`);
      setSuggesting(false);
      return;
    }
    setSuggesting(false);
    setGenerating(true);
    try {
      const body = isCard
        ? { provider, headline: direction.headline || "", subline: direction.subline || "", style, size, draftId: posterDraft?.draftId || null }
        : { provider, prompt: direction.visualPrompt || "", size, draftId: posterDraft?.draftId || null };
      const r = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      if (!r.ok || out.error) throw new Error(out.message || out.error || "generation failed");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }
  const [headline, setHeadline] = useState("");
  const [subline, setSubline] = useState("");
  const [visualPrompt, setVisualPrompt] = useState("");
  const [style, setStyle] = useState("brand");
  const [size, setSize] = useState("linkedin");

  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  // Show a short note explaining why the screen changed when you arrive here via
  // the "Image" / "Make poster" button on a post (the jump is otherwise abrupt).
  const [jumpNote, setJumpNote] = useState(false);
  useEffect(() => {
    if (posterDraft?.ts) setJumpNote(true);
  }, [posterDraft?.ts]);

  const providerMeta = useMemo(
    () => meta.providers.find((p) => p.id === provider) || meta.providers[0],
    [meta.providers, provider]
  );
  const isCard = providerMeta?.kind === "card";

  // Photo card studio: the gallery image being written on, or null.
  const [studio, setStudio] = useState(null);

  const [unreachable, setUnreachable] = useState(false);
  async function refresh() {
    try {
      const m = await (await fetch("/api/images")).json();
      setMeta(m);
      setUnreachable(false);
      if (!m.providers.find((p) => p.id === provider)) setProvider(m.providers[0]?.id || "cards");
    } catch {
      // "No images yet" when the brain is down is a lie — say so instead.
      setUnreachable(true);
    }
  }

  useEffect(() => {
    refresh();
    fetch("/api/drafts")
      .then((r) => r.json())
      .then((d) => {
        const list = d.drafts || [];
        setDrafts(list);
        // Default to the most recent posted draft (the one launching today), else newest.
        const live = list.filter((x) => x.status !== "delete" && x.status !== "archived");
        const posted = live.find((x) => x.status === "posted");
        const pick = posted || live[0];
        if (pick) selectDraft(pick.id, list);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectDraft(id, list = drafts) {
    setDraftId(id);
    const d = list.find((x) => x.id === id);
    if (d) setSource(draftText(d));
  }

  async function suggest() {
    setSuggesting(true);
    setError("");
    try {
      const r = await fetch("/api/images/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source }),
      });
      const out = await r.json();
      if (!r.ok || out.error) throw new Error(out.message || out.error || `server ${r.status}`);
      setHeadline(out.headline || "");
      setSubline(out.subline || "");
      setVisualPrompt(out.visualPrompt || "");
    } catch (e) {
      setError(`Couldn't suggest: ${e.message}`);
    } finally {
      setSuggesting(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const body = isCard
        ? { provider, headline, subline, style, size, draftId: draftId || null }
        : { provider, prompt: visualPrompt, size, draftId: draftId || null };
      const r = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      if (!r.ok || out.error) throw new Error(out.message || out.error || "generation failed");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this image? This can't be undone.")) return;
    try {
      const r = await fetch(`/api/images/${id}`, { method: "DELETE" });
      if (!r.ok) setError("Couldn't delete that image just now — try again in a moment.");
    } catch {
      setError("Couldn't reach Jarvis to delete that image — try again in a moment.");
    }
    refresh();
  }

  const canGenerate = isCard ? headline.trim().length > 0 : visualPrompt.trim().length > 0;

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      {jumpNote && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-brand/25 bg-brand-soft px-4 py-2.5 text-[13px] text-ink-2">
          <span>
            {mode === "ascii"
              ? "Started from your saved post. Your poster is below."
              : "Started from your saved post. Jarvis is making a first image below, adjust the style or size and regenerate anytime."}
          </span>
          <button onClick={() => setJumpNote(false)} className="shrink-0 rounded px-2 py-0.5 text-[12px] text-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" title="Dismiss">
            Dismiss
          </button>
        </div>
      )}

      <header className="mb-6 flex items-start justify-between gap-6">
        <div>
          <Eyebrow>Images</Eyebrow>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Generate post imagery</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Build an image from the post you're about to publish — a branded Larkwell card, a real
            photo from Unsplash, or a live ASCII poster. Drafts only; download and add it to
            LinkedIn yourself.
          </p>
        </div>
        {mode === "generate" && (
          <Button variant="outline" onClick={refresh} className="shrink-0">
            <ArrowsClockwise size={16} /> Refresh
          </Button>
        )}
      </header>

      {/* Mode tabs */}
      <div className="mb-8 flex gap-1 border-b border-line">
        {[
          ["generate", "Card / photo"],
          ["ascii", "ASCII poster"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              mode === id
                ? "border-brand text-brand"
                : "border-transparent text-muted hover:text-ink-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "ascii" ? (
        <Suspense fallback={<Card className="p-6 text-sm text-muted">Loading the poster studio…</Card>}>
          <AsciiLive onSaved={refresh} incomingDraftId={posterDraft?.draftId} incomingTs={posterDraft?.ts} active={active && mode === "ascii"} />
        </Suspense>
      ) : (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ---- config ---- */}
        <Card className="p-6">
          {/* Source post */}
          <Eyebrow>1 · Base it on a post</Eyebrow>
          <div className="mt-3 space-y-3">
            <Select
              value={draftId}
              onChange={selectDraft}
              searchable
              placeholder="Paste / write your own below"
              options={[
                { value: "", label: "Paste / write your own below" },
                ...groupedDraftOptions(drafts),
              ]}
            />
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={4}
              placeholder="The LinkedIn post this image is for…"
              className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
            />
            <Button variant="outline" onClick={suggest} disabled={suggesting || !source.trim()}>
              <Sparkle size={16} weight="fill" />
              {suggesting ? "Thinking…" : "Suggest headline + image idea"}
            </Button>
          </div>

          {/* Provider */}
          <div className="mt-7">
            <Eyebrow>2 · How to make it</Eyebrow>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {meta.providers.map((p) => {
                const active = p.id === provider;
                const Icon = p.kind === "card" ? Cards : p.local ? Lightning : Globe;
                return (
                  <button
                    key={p.id}
                    disabled={!p.available}
                    onClick={() => setProvider(p.id)}
                    title={p.note}
                    className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-brand bg-brand/5"
                        : "border-line-strong bg-surface hover:border-brand/60"
                    } ${!p.available ? "cursor-not-allowed opacity-45" : ""}`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <Icon size={15} weight={active ? "fill" : "regular"} className={active ? "text-brand" : "text-muted"} />
                      {p.label}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-faint">
                      {p.local ? (
                        <><ShieldCheck size={12} /> Local</>
                      ) : (
                        <><Globe size={12} /> Online</>
                      )}
                      {!p.available && " · set up later"}
                    </span>
                  </button>
                );
              })}
            </div>
            {providerMeta && (
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{providerMeta.note}</p>
            )}
            {providerMeta?.kind === "photo" && (
              <p className="mt-2 rounded-md border border-brand/25 bg-brand-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
                Once the photo appears on the right, press <span className="font-semibold">Add text</span> on it to put your
                headline and the Larkwell logo on the photo in the website's colours.
              </p>
            )}
            {/* A disabled provider can't be selected, so its one-time setup
                steps would be invisible — show them here instead. */}
            {meta.providers.filter((p) => !p.available).map((p) => (
              <p key={p.id} className="mt-2 text-[12px] leading-relaxed text-faint">
                <span className="font-medium text-muted">{p.label} (to set up):</span> {p.note}
              </p>
            ))}
          </div>

          {/* Card or photo controls */}
          <div className="mt-7">
            <Eyebrow>3 · {isCard ? "Card content" : "Image prompt"}</Eyebrow>
            {isCard ? (
              <div className="mt-3 space-y-3">
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Headline (short, punchy)"
                  className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
                />
                <input
                  value={subline}
                  onChange={(e) => setSubline(e.target.value)}
                  placeholder="Subline (optional)"
                  className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
                />
                <div>
                  <div className="mb-1.5 text-[12px] text-muted">Style</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(meta.cardStyles).map(([k, label]) => (
                      <Pill key={k} active={style === k} onClick={() => setStyle(k)}>
                        {label}
                      </Pill>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <textarea
                value={visualPrompt}
                onChange={(e) => setVisualPrompt(e.target.value)}
                rows={4}
                placeholder="Describe the picture you want (no text in the image)…"
                className="mt-3 w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
              />
            )}
          </div>

          {/* Size */}
          <div className="mt-6">
            <div className="mb-1.5 text-[12px] text-muted">Size</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(meta.sizes).map(([k, s]) => (
                <Pill key={k} active={size === k} onClick={() => setSize(k)}>
                  {s.label}
                </Pill>
              ))}
            </div>
          </div>

          <div className="mt-7 flex items-center gap-3">
            <Button onClick={generate} disabled={generating || !canGenerate}>
              <ImageIcon size={16} weight="fill" />
              {generating ? "Generating…" : "Generate image"}
            </Button>
            {error && <span className="text-[12px] text-crit">{error}</span>}
          </div>
        </Card>

        {/* ---- gallery ---- */}
        <div>
          <Eyebrow>Your images</Eyebrow>
          {generating && (
            <Card className="mt-3 grid h-44 place-items-center text-sm text-muted">
              <span className="flex items-center gap-2">
                <ArrowsClockwise size={16} className="animate-spin" /> Rendering…
              </span>
            </Card>
          )}
          {!meta.images.length && !generating ? (
            <Card className="mt-3 grid h-44 place-items-center px-6 text-center text-sm text-muted">
              {unreachable
                ? "Jarvis is starting up — your images will appear once it's reachable."
                : "No images yet. Pick a post, choose a style, and hit Generate."}
            </Card>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {meta.images.map((img) => (
                <ImageTile key={img.id} img={img} onDelete={() => remove(img.id)} onAddText={() => setStudio(img)} />
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {studio && (
        <PhotoCardStudio
          img={studio}
          sizes={meta.sizes}
          initial={
            studio.provider === "photo-card"
              ? // reopening a card: its own words, exactly as saved
                { eyebrow: studio.eyebrow || "", headline: studio.eyebrow && studio.headline === studio.eyebrow ? "" : studio.headline || "", subline: studio.subline || "" }
              : { headline, subline }
          }
          draftId={draftId || null}
          onClose={() => setStudio(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function ImageTile({ img, onDelete, onAddText }) {
  const canvasRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const isVideo = (img.mime || "").startsWith("video");
  // Raster stills (Unsplash photos, saved photo cards, ASCII frames) can go
  // into the Photo card studio. Cards are SVG and already carry their words.
  const canAddText = !isVideo && /^image\/(jpeg|jpg|png|webp)$/i.test(img.mime || "");

  // Cards are SVG -> rasterise to PNG client-side for download. Photos/videos download direct.
  async function download() {
    if (isVideo) {
      const a = document.createElement("a");
      a.href = img.url;
      a.download = `${img.id}.mp4`;
      a.click();
      return;
    }
    if (img.mime !== "image/svg+xml") {
      const ext = img.mime.includes("gif") ? "gif" : img.mime.includes("png") ? "png" : "jpg";
      const a = document.createElement("a");
      a.href = img.url;
      a.download = `${img.id}.${ext}`;
      a.click();
      return;
    }
    setBusy(true);
    try {
      const svgText = await (await fetch(img.url)).text();
      const m = svgText.match(/width="(\d+)"\s+height="(\d+)"/);
      const w = m ? +m[1] : 1200;
      const h = m ? +m[2] : 627;
      const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => {
          const c = canvasRef.current;
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          ctx.drawImage(image, 0, 0, w, h);
          c.toBlob((png) => {
            const a = document.createElement("a");
            const pngUrl = URL.createObjectURL(png);
            a.href = pngUrl;
            a.download = `${img.id}.png`;
            a.click();
            URL.revokeObjectURL(url);
            // The PNG url was never revoked (a small leak per download), and a
            // synchronous revoke can beat the download — do it after a beat.
            setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
            resolve();
          }, "image/png");
        };
        image.onerror = reject;
        image.src = url;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="grid place-items-center bg-canvas">
        {isVideo ? (
          <video src={img.url} className="max-h-64 w-full object-contain" autoPlay loop muted playsInline />
        ) : (
          <img src={img.url} alt={img.headline || img.prompt || "generated"} className="max-h-64 w-full object-contain" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-ink">
            {img.headline || img.prompt || "Image"}
          </div>
          <div className="truncate text-[11px] text-faint">
            {img.provider} · {img.local ? "local" : "online"}
            {img.credit && (
              <>
                {" · "}
                {img.sourceUrl ? (
                  <a href={img.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-brand hover:underline" title="Unsplash asks that the photographer is credited — this text is ready to paste with the post.">
                    {img.credit}
                  </a>
                ) : (
                  img.credit
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canAddText && onAddText && (
            <button
              onClick={onAddText}
              title="Put your headline and the Larkwell logo on this photo"
              className="mr-1 inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand-soft px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand hover:text-white"
            >
              <TextT size={14} weight="bold" /> Add text
            </button>
          )}
          <button onClick={download} disabled={busy} title="Download" className="rounded-md p-1.5 text-muted hover:bg-line/60 hover:text-brand">
            <DownloadSimple size={17} />
          </button>
          <button onClick={onDelete} title="Delete" className="rounded-md p-1.5 text-muted hover:bg-line/60 hover:text-crit">
            <Trash size={17} />
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </Card>
  );
}
