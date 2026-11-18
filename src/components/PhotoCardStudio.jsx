import { useEffect, useMemo, useRef, useState } from "react";
import { X, DownloadSimple, FloppyDisk, Check, CircleNotch } from "@phosphor-icons/react";
import { Button, Pill } from "./ui.jsx";
import { company } from "../lib/company.js";

// Photo card studio — a tiny "Canva" for putting Larkwell words and the Larkwell logo on
// a photo. Everything is drawn on a <canvas> in the browser (no server, no
// third party), in the website's own type and colours: Inter Tight, the
// blue/navy/gold palette, and the hero/loop treatment (dark gradient, gold
// eyebrow, tight headline, light subline). Built to be used by someone who
// has never opened a design tool: three text boxes, four looks, three spots,
// one Save button. Mara (2026-09-28): "a 60 year old should be able to use
// it" — every control is a labelled button or a text box, and the preview
// updates as you type.

// ---- brand tokens (mirror company-website/src/styles/colors_and_type.css) ----
const BLUE = "#14532d";
const BLUE_BRIGHT = "#a3e635";
const NAVY = "#0e2016";
const NAVY_2 = "#08142C";
const GOLD = "#E8C68C";
const GOLD_DEEP = "#C29A5A";
const FG = "#343333";
const FG_3 = "#5B6478";
const FONT = `"Inter Tight", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

// The four looks. `band` = a solid panel behind the words; `fade` = the
// photo darkens towards the words (website hero); `plain` = photo untouched
// apart from a soft shade so the logo reads.
export const LOOKS = [
  {
    id: "dark",
    label: "Dark",
    hint: "Like the website hero: the photo fades to navy behind white words, gold label.",
    swatch: ["#000000", NAVY, GOLD],
    kind: "fade",
    eyebrow: GOLD,
    ink: "#FFFFFF",
    sub: "rgba(255,255,255,0.80)",
    mark: "white",
  },
  {
    id: "blue",
    label: "Larkwell green",
    hint: "A solid Larkwell-green panel behind the words. Bold, reads from far away.",
    swatch: [BLUE, BLUE_BRIGHT, "#FFFFFF"],
    kind: "band",
    band: [BLUE, BLUE_BRIGHT],
    eyebrow: "rgba(255,255,255,0.82)",
    ink: "#FFFFFF",
    sub: "rgba(255,255,255,0.84)",
    mark: "white",
  },
  {
    id: "light",
    label: "Light",
    hint: "A white panel with navy words and the colour logo. Calm and clean.",
    swatch: ["#FFFFFF", NAVY, GOLD_DEEP],
    kind: "band",
    band: ["rgba(255,255,255,0.95)", "rgba(244,246,254,0.95)"],
    eyebrow: GOLD_DEEP,
    ink: NAVY,
    sub: FG_3,
    mark: "colour",
  },
  {
    id: "plain",
    label: "Photo only",
    hint: "Just the photo and the Larkwell logo. Words optional.",
    swatch: ["#9aa3b5", "#d6dbcd", "#FFFFFF"],
    kind: "plain",
    eyebrow: GOLD,
    ink: "#FFFFFF",
    sub: "rgba(255,255,255,0.85)",
    mark: "white",
  },
];

const SPOTS = [
  { id: "bottom", label: "Bottom" },
  { id: "top", label: "Top" },
  { id: "middle", label: "Middle" },
];

export const TEXT_SIZES = [
  { id: "small", label: "Smaller", k: 0.85 },
  { id: "normal", label: "Normal", k: 1 },
  { id: "big", label: "Bigger", k: 1.2 },
];

export const DEFAULT_SIZES = {
  linkedin: { w: 1200, h: 627, label: "LinkedIn link (1200×627)" },
  square: { w: 1080, h: 1080, label: "Square (1080×1080)" },
  portrait: { w: 1080, h: 1350, label: "Portrait (1080×1350)" },
  story: { w: 1080, h: 1920, label: "Story (1080×1920)" },
};

const MARK_RATIO = 360 / 219; // public/brand/mark*.svg

// ---- helpers ----
const imageCache = new Map();
export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve, reject) => {
    const im = new window.Image();
    im.onload = () => resolve(im);
    im.onerror = () => {
      imageCache.delete(src); // a hiccup must not poison later opens
      reject(new Error(`Couldn't load ${src}`));
    };
    im.src = src;
  });
  imageCache.set(src, p);
  return p;
}

// Word-wrap with real glyph widths. Very long single words are broken so
// nothing ever runs off the canvas.
function wrap(ctx, text, maxWidth, maxLines) {
  const fits = (t) => ctx.measureText(t).width <= maxWidth;
  // Break a single word that is wider than the line into pieces that fit.
  const pieces = (word) => {
    if (fits(word)) return [word];
    const out = [];
    let piece = "";
    for (const ch of word) {
      if (piece && !fits(piece + ch)) {
        out.push(piece);
        piece = ch;
      } else piece += ch;
    }
    if (piece) out.push(piece);
    return out;
  };
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).flatMap(pieces);
  const lines = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (!line || fits(candidate)) line = candidate;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[.,;:]?$/, "…");
    return kept;
  }
  return lines;
}

// Width of letter-spaced text, and a version cut to fit with an ellipsis.
function spacedWidth(ctx, text, spacing) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return Math.max(0, w - spacing);
}
function fitSpaced(ctx, text, spacing, maxWidth) {
  if (spacedWidth(ctx, text, spacing) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && spacedWidth(ctx, `${t}…`, spacing) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// Letter-spaced text (canvas letterSpacing isn't everywhere yet).
function spacedText(ctx, text, x, y, spacing) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  return cx - x - spacing;
}

// Cover-crop the photo into the canvas (centre crop, like CSS object-fit).
function drawCover(ctx, img, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// The whole composition. Pure: canvas + inputs in, pixels out.
export async function renderPhotoCard(canvas, { photo, marks, size, look, spot, textSize, eyebrow, headline, subline, logo }) {
  const { w, h } = size;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  drawCover(ctx, photo, w, h);

  const base = Math.min(w, h);
  const k = textSize.k;
  const pad = Math.round(base * 0.075);
  const contentW = Math.min(w - pad * 2, Math.round(w * 0.82));
  const hSize = Math.round(base * 0.074 * k);
  const eSize = Math.round(hSize * 0.34);
  const sSize = Math.round(hSize * 0.44);
  const hLine = Math.round(hSize * 1.08);
  const sLine = Math.round(sSize * 1.35);

  // ---- measure the text block ----
  const hasEyebrow = !!eyebrow.trim();
  const hasHead = !!headline.trim();
  const hasSub = !!subline.trim();
  ctx.font = `600 ${hSize}px ${FONT}`;
  const hLines = hasHead ? wrap(ctx, headline, contentW, 4) : [];
  ctx.font = `300 ${sSize}px ${FONT}`;
  const sLines = hasSub ? wrap(ctx, subline, contentW, 3) : [];
  let blockH = 0;
  if (hasEyebrow) blockH += eSize + Math.round(hSize * 0.55);
  blockH += hLines.length * hLine;
  if (sLines.length) blockH += Math.round(sSize * 0.9) + sLines.length * sLine;
  const hasText = blockH > 0;

  // Logo row (bottom-left) — its height reserves space when words sit at the bottom.
  const logoH = Math.round(hSize * 0.62);
  const logoRow = logo ? logoH + Math.round(hSize * 0.7) : 0;

  // ---- where the block goes ----
  let top;
  if (spot === "top") top = pad;
  else if (spot === "middle") top = Math.round((h - blockH) / 2);
  else top = h - pad - logoRow - blockH;
  top = Math.max(pad, top);

  // ---- backdrop for the words ----
  if (look.kind === "fade") {
    // Website hero: black → navy, fading into the photo. Plus the loop's soft
    // blue glow off to one side.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (spot === "top") {
      g.addColorStop(0, "rgba(0,0,0,0.86)");
      g.addColorStop(Math.min(0.95, (top + blockH + pad) / h), "rgba(8,20,44,0.55)");
      g.addColorStop(1, "rgba(8,20,44,0.15)");
    } else if (spot === "middle") {
      g.addColorStop(0, "rgba(8,20,44,0.55)");
      g.addColorStop(0.5, "rgba(0,0,0,0.72)");
      g.addColorStop(1, "rgba(8,20,44,0.6)");
    } else {
      g.addColorStop(0, "rgba(8,20,44,0.10)");
      g.addColorStop(Math.max(0.05, (top - pad * 1.5) / h), "rgba(8,20,44,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0.88)");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.8, h * 0.62, 0, w * 0.8, h * 0.62, base * 0.7);
    glow.addColorStop(0, "rgba(30,85,242,0.30)");
    glow.addColorStop(1, "rgba(30,85,242,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  } else if (look.kind === "band" && (hasText || (logo && spot === "bottom"))) {
    const inner = Math.round(pad * 0.8);
    let y0, y1;
    if (spot === "top") {
      y0 = 0;
      y1 = top + blockH + inner;
    } else if (spot === "middle") {
      y0 = top - inner;
      y1 = top + blockH + inner;
    } else {
      y0 = top - inner;
      y1 = h;
    }
    const g = ctx.createLinearGradient(0, y0, w, y1);
    g.addColorStop(0, look.band[0]);
    g.addColorStop(1, look.band[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, w, y1 - y0);
    // A thin gold rule on the band's photo edge, like the site's section accents.
    ctx.fillStyle = look.id === "light" ? GOLD_DEEP : GOLD;
    ctx.fillRect(0, spot === "top" ? y1 - 6 : y0, w, 6);
  } else {
    // plain: soft shade where the words/logo are so they stay legible.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (spot === "top") {
      g.addColorStop(0, "rgba(0,0,0,0.55)");
      g.addColorStop(0.5, "rgba(0,0,0,0)");
      g.addColorStop(1, logo ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0)");
    } else {
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.45, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.62)");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (spot === "middle" && hasText) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ---- the words ----
  let y = top;
  if (hasEyebrow) {
    ctx.font = `500 ${eSize}px ${FONT}`;
    ctx.fillStyle = look.eyebrow;
    spacedText(ctx, fitSpaced(ctx, eyebrow.trim().toUpperCase(), eSize * 0.18, contentW), pad, y + eSize, eSize * 0.18);
    y += eSize + Math.round(hSize * 0.55);
  }
  if (hLines.length) {
    ctx.font = `600 ${hSize}px ${FONT}`;
    ctx.fillStyle = look.ink;
    for (const ln of hLines) {
      y += hSize;
      // tight tracking like the site's display type
      spacedText(ctx, ln, pad, y, -hSize * 0.02);
      y += hLine - hSize;
    }
  }
  if (sLines.length) {
    y += Math.round(sSize * 0.9);
    ctx.font = `300 ${sSize}px ${FONT}`;
    ctx.fillStyle = look.sub;
    for (const ln of sLines) {
      y += sSize;
      ctx.fillText(ln, pad, y);
      y += sLine - sSize;
    }
  }

  // ---- logo: wing mark + lowercase wordmark, bottom-left ----
  if (logo) {
    // Colour mark only when it sits on the light band; on the photo the white
    // knockout is the one that reads.
    const onLightBand = look.id === "light" && spot === "bottom";
    const mark = onLightBand ? marks.colour : marks.white;
    const markW = Math.round(logoH * MARK_RATIO);
    const baseline = h - pad;
    if (mark) ctx.drawImage(mark, pad, baseline - logoH, markW, logoH);
    const wmSize = Math.round(logoH * 0.42);
    ctx.font = `600 ${wmSize}px ${FONT}`;
    ctx.fillStyle = onLightBand ? NAVY : "#FFFFFF";
    spacedText(ctx, company.shortName.toLowerCase(), pad + (mark ? markW + Math.round(wmSize * 0.6) : 0), baseline - Math.round(logoH * 0.08), wmSize * 0.12);
  }
}

// Make sure the weights we draw with are actually loaded before the first
// paint, otherwise the canvas falls back to a system font for that render.
export async function ensureFonts() {
  if (!document.fonts?.load) return;
  try {
    await Promise.all(["300", "500", "600"].map((wt) => document.fonts.load(`${wt} 40px "Inter Tight"`)));
  } catch {
    /* draw with the fallback stack */
  }
}

export default function PhotoCardStudio({ img, sizes, initial = {}, draftId = null, onClose, onSaved }) {
  const sizeMap = sizes && Object.keys(sizes).length ? sizes : DEFAULT_SIZES;
  const [eyebrow, setEyebrow] = useState(initial.eyebrow || "");
  const [headline, setHeadline] = useState(initial.headline || "");
  const [subline, setSubline] = useState(initial.subline || "");
  const [lookId, setLookId] = useState("dark");
  const [spot, setSpot] = useState("bottom");
  const [textSizeId, setTextSizeId] = useState("normal");
  const [sizeId, setSizeId] = useState(sizeMap[img.size] ? img.size : "linkedin");
  const [logo, setLogo] = useState(true);

  const [assets, setAssets] = useState(null); // { photo, marks }
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [saveNote, setSaveNote] = useState("");
  const canvasRef = useRef(null);

  const look = useMemo(() => LOOKS.find((l) => l.id === lookId) || LOOKS[0], [lookId]);
  const textSize = useMemo(() => TEXT_SIZES.find((t) => t.id === textSizeId) || TEXT_SIZES[1], [textSizeId]);
  const size = sizeMap[sizeId] || sizeMap.linkedin || DEFAULT_SIZES.linkedin;

  // Load the photo + both logo marks once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [photo, white, colour] = await Promise.all([
          loadImage(img.url),
          loadImage(`${import.meta.env.BASE_URL}brand/mark-white.svg`).catch(() => null),
          loadImage(`${import.meta.env.BASE_URL}brand/mark.svg`).catch(() => null),
          ensureFonts(),
        ]);
        if (alive) setAssets({ photo, marks: { white, colour } });
      } catch (e) {
        if (alive) setLoadError(e.message || "Couldn't load the photo.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [img.url]);

  // Re-draw on every change (cheap: one photo blit + text).
  useEffect(() => {
    if (!assets || !canvasRef.current) return;
    renderPhotoCard(canvasRef.current, { ...assets, size, look, spot, textSize, eyebrow, headline, subline, logo }).catch((e) =>
      setLoadError(e.message)
    );
  }, [assets, size, look, spot, textSize, eyebrow, headline, subline, logo]);

  // Any edit after a save means the saved copy is out of date: offer Save again.
  const savedRef = useRef(false);
  savedRef.current = saveState === "saved";
  // "touched" = something differs from how the studio opened, so closing with
  // no edits (e.g. reopening a saved card just to look) doesn't nag. Compared
  // by value, not by an effect, so StrictMode's double effect run can't fake it.
  const snapshot = JSON.stringify([eyebrow, headline, subline, lookId, spot, textSizeId, sizeId, logo]);
  const openedAs = useRef(snapshot);
  const touched = snapshot !== openedAs.current;
  useEffect(() => {
    if (!savedRef.current) return;
    setSaveState("idle");
    setSaveNote("");
  }, [sizeId, lookId, spot, textSizeId, eyebrow, headline, subline, logo]);

  // Closing: Esc or a click that starts AND ends on the backdrop (a
  // text-selection drag that ends outside the panel must not close it). Typed
  // words that were never saved get a confirm first.
  const closeRef = useRef(null);
  closeRef.current = () => {
    const unsaved = touched && saveState !== "saved";
    if (unsaved && !window.confirm("Close without saving this picture?")) return;
    onClose();
  };
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dataUrl = () => canvasRef.current.toDataURL("image/jpeg", 0.92);
  const fileStem = () => (headline.trim() || "photo-card").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "photo-card";

  function download() {
    const a = document.createElement("a");
    a.href = dataUrl();
    a.download = `${fileStem()}-${sizeId}.jpg`;
    a.click();
  }

  async function save() {
    setSaveState("saving");
    setSaveNote("");
    try {
      const r = await fetch("/api/images/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl: dataUrl(),
          provider: "photo-card",
          kind: "photo",
          style: lookId,
          headline: headline.trim() || eyebrow.trim() || "Photo card",
          subline: subline.trim() || null,
          eyebrow: eyebrow.trim() || null,
          size: sizeId,
          draftId: draftId || img.draftId || null,
          credit: img.credit || null,
          sourceUrl: img.sourceUrl || null,
        }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || out.error) throw new Error(out.message || out.error || `server ${r.status}`);
      setSaveState("saved");
      setSaveNote("Saved. It's in your images, next to the photo it came from.");
      onSaved?.(out);
    } catch (e) {
      setSaveState("error");
      setSaveNote(`Couldn't save: ${e.message}`);
    }
  }

  const input =
    "w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink-2 placeholder:text-faint focus-visible:outline-2 focus-visible:outline-brand";
  const label = "mb-1.5 block text-[13px] font-medium text-ink-2";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0e2016]/40 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) closeRef.current();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo card studio"
    >
      <div className="w-full max-w-6xl rounded-xl border border-line bg-surface shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">Put Larkwell words on this photo</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Type your words, pick a look, then Save. The picture on the left updates as you go.
            </p>
          </div>
          <button onClick={() => closeRef.current()} className="rounded-md p-2 text-muted hover:bg-line/60 hover:text-ink" title="Close" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.9fr)]">
          {/* ---- preview ---- */}
          <div>
            <div className="grid place-items-center overflow-hidden rounded-lg border border-line bg-canvas p-3">
              {loadError ? (
                <p className="px-6 py-16 text-center text-sm text-crit">{loadError}</p>
              ) : (
                <canvas
                  ref={canvasRef}
                  className={`h-auto max-h-[70vh] w-auto max-w-full rounded shadow-card ${assets ? "" : "opacity-0"}`}
                  aria-label="Preview of the finished picture"
                />
              )}
              {!assets && !loadError && (
                <p className="flex items-center gap-2 py-16 text-sm text-muted">
                  <CircleNotch size={16} className="animate-spin" /> Loading the photo…
                </p>
              )}
            </div>
            {img.credit && (
              <p className="mt-2 text-[12px] text-faint">{img.credit}. Paste that line with your post: Unsplash asks for it.</p>
            )}
          </div>

          {/* ---- controls ---- */}
          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">1 · Your words</h3>
              <div className="space-y-3">
                <div>
                  <label className={label} htmlFor="pcs-eyebrow">Small label on top <span className="font-normal text-faint">(optional)</span></label>
                  <input id="pcs-eyebrow" className={input} value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} placeholder="e.g. SAP S/4HANA migration" maxLength={60} />
                </div>
                <div>
                  <label className={label} htmlFor="pcs-headline">Headline</label>
                  <input id="pcs-headline" className={input} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="One strong sentence" maxLength={140} />
                </div>
                <div>
                  <label className={label} htmlFor="pcs-subline">Second line <span className="font-normal text-faint">(optional)</span></label>
                  <input id="pcs-subline" className={input} value={subline} onChange={(e) => setSubline(e.target.value)} placeholder="A short supporting line" maxLength={200} />
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">2 · Look</h3>
              <div className="grid grid-cols-2 gap-2">
                {LOOKS.map((l) => {
                  const on = l.id === lookId;
                  return (
                    <button
                      key={l.id}
                      onClick={() => setLookId(l.id)}
                      title={l.hint}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                        on ? "border-brand bg-brand/5" : "border-line-strong bg-surface hover:border-brand/60"
                      }`}
                    >
                      <span className="flex shrink-0 overflow-hidden rounded border border-line">
                        {l.swatch.map((c) => (
                          <span key={c} className="h-6 w-3" style={{ background: c }} />
                        ))}
                      </span>
                      <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
                        {l.label}
                        {on && <Check size={14} weight="bold" className="text-brand" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{look.hint}</p>
            </section>

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">3 · Where the words sit</h3>
                <div className="flex flex-wrap gap-2">
                  {SPOTS.map((s) => (
                    <Pill key={s.id} active={spot === s.id} onClick={() => setSpot(s.id)}>
                      {s.label}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">Text size</h3>
                <div className="flex flex-wrap gap-2">
                  {TEXT_SIZES.map((t) => (
                    <Pill key={t.id} active={textSizeId === t.id} onClick={() => setTextSizeId(t.id)}>
                      {t.label}
                    </Pill>
                  ))}
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">4 · Shape</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(sizeMap).map(([k, s]) => (
                  <Pill key={k} active={sizeId === k} onClick={() => setSizeId(k)}>
                    {s.label}
                  </Pill>
                ))}
              </div>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-[14px] text-ink-2">
                <input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} className="h-4 w-4 accent-[#14532d]" />
                Show the Larkwell logo
              </label>
            </section>

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button onClick={save} disabled={!assets || saveState === "saving" || saveState === "saved"}>
                {saveState === "saving" ? <CircleNotch size={16} className="animate-spin" /> : saveState === "saved" ? <Check size={16} weight="bold" /> : <FloppyDisk size={16} />}
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save to your images"}
              </Button>
              <Button variant="outline" onClick={download} disabled={!assets}>
                <DownloadSimple size={16} /> Download
              </Button>
              <Button variant="ghost" onClick={() => closeRef.current()}>
                {saveState === "saved" ? "Done" : "Cancel"}
              </Button>
            </div>
            {saveNote && <p className={`text-[13px] ${saveState === "error" ? "text-crit" : "text-good"}`}>{saveNote}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
