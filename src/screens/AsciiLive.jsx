import { useEffect, useRef, useState } from "react";
import {
  UploadSimple,
  DownloadSimple,
  FloppyDisk,
  VideoCamera,
  X,
  CheckCircle,
} from "@phosphor-icons/react";
import { Button, Card, Eyebrow, Select } from "../components/ui.jsx";
import { ICONS, COLORS, CHARSETS, simpleHook, todayKicker } from "./ascii-live/helpers.js";
import { groupedDraftOptions } from "../lib/draft-options.js";
import { Seg, Toggle, Slider, ExportState } from "./ascii-live/controls.jsx";
import { useAsciiEngine } from "./ascii-live/useAsciiEngine.js";

// ============================================================================
// ASCII Live — a logo becomes a live, 3D-displaced ASCII object that floats as
// a post background. Ported from the standalone tool into the app: same engine
// (three.js height-field + canvas ASCII sampler), restyled controls, three.js
// bundled locally (no CDN) and an extra "Save to library" that drops the frame
// into the Images gallery. Fully local; nothing posts.
// ============================================================================

export default function AsciiLive({ onSaved, incomingDraftId, incomingTs, active = true }) {
  const previewRef = useRef(null);
  const stageRef = useRef(null);
  const fileInputRef = useRef(null);
  const engineRef = useRef(null);
  const cbRef = useRef({});
  // Pause the live render loop while this screen is hidden (kept mounted for
  // state, but no need to burn GPU animating something nobody's looking at).
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Live values the render loop reads (mutated in place, never replaced).
  const stateRef = useRef({
    aspect: "portrait", cols: 120, charset: "classic", source: "auto", color: "#3fff8f",
    contrast: 1.35, bright: 0, shade: true, glow: false, invert: false,
    float: 0.5, rotate: 25,
    layout: false, side: "left", kicker: "", title: "", body: "",
  });

  // UI mirror so the panel re-renders.
  const [ui, setUi] = useState({ ...stateRef.current });
  const [fileName, setFileName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [activeIcon, setActiveIcon] = useState(1); // default: Database
  const [dragging, setDragging] = useState(false);
  const [saveState, setSaveState] = useState(""); // "", "saving", "saved", "error"
  const [rec, setRec] = useState(""); // "", "recording", "encoding", "error"
  const [recLeft, setRecLeft] = useState(0); // countdown seconds while recording
  const [recProgress, setRecProgress] = useState(0); // 0..1 frames uploaded
  // null = unknown yet; {available:false, hint} = the server can't encode video.
  const [ffmpeg, setFfmpeg] = useState(null);
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((h) => setFfmpeg(h.ffmpeg || null)).catch(() => {});
  }, []);
  const noFfmpeg = ffmpeg && ffmpeg.available === false;
  const [recError, setRecError] = useState(""); // why the last export failed
  const [vfmt, setVfmt] = useState("gif"); // "gif" | "mp4" — GIF loops on LinkedIn; video plays once
  const [drafts, setDrafts] = useState([]);
  const [draftId, setDraftId] = useState("");

  const EXPORT_FPS = 24;
  const EXPORT_SECONDS = 6; // one full rotation, rendered as a seamless loop

  // Update a live value + its UI mirror; opts can trigger engine rebuilds.
  function set(key, val, opts = {}) {
    stateRef.current[key] = val;
    setUi((u) => ({ ...u, [key]: val }));
    if (opts.rebuild) engineRef.current?.rebuildObject();
    if (opts.resize) engineRef.current?.sizePreview();
  }

  cbRef.current.setFileName = setFileName;
  cbRef.current.setLoadError = setLoadError;

  // The imperative engine, built once (./ascii-live/useAsciiEngine.js).
  useAsciiEngine({ previewRef, stageRef, stateRef, cbRef, activeRef, engineRef });

  // Load the default artwork once the engine exists.
  useEffect(() => {
    const t = setTimeout(() => {
      engineRef.current?.loadSvg(ICONS[activeIcon].svg, ICONS[activeIcon].name);
    }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load drafts for the poster workflow — refreshed on every "Make poster"
  // deep-link (a mount-only fetch went stale: a draft made AFTER the first
  // visit never appeared in the list, so its deep-link silently did nothing).
  useEffect(() => {
    fetch("/api/drafts")
      .then((r) => r.json())
      .then((d) => setDrafts(d.drafts || []))
      .catch(() => {});
  }, [incomingTs]);

  // Deep-link from a Library card ("Make poster"): auto-select that draft once
  // the drafts list has loaded. appliedTs guards against re-applying.
  const appliedTs = useRef(0);
  useEffect(() => {
    if (!incomingTs || appliedTs.current === incomingTs || !incomingDraftId) return;
    if (!drafts.some((d) => d.id === incomingDraftId)) return; // wait for the list
    appliedTs.current = incomingTs;
    pickDraft(incomingDraftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingTs, incomingDraftId, drafts]);

  function pickIcon(idx) {
    setActiveIcon(idx);
    engineRef.current?.loadSvg(ICONS[idx].svg, ICONS[idx].name);
  }

  // Pick a draft: its hook becomes the poster headline, layout turns on, date fills the kicker.
  function pickDraft(id) {
    setDraftId(id);
    const d = drafts.find((x) => x.id === id);
    if (!d) return;
    set("title", simpleHook(d));
    set("layout", true);
    if (!stateRef.current.kicker) set("kicker", todayKicker());
  }

  function onFile(file) {
    if (!file) return;
    setActiveIcon(-1);
    engineRef.current?.loadFile(file);
  }

  function clearArtwork() {
    setActiveIcon(-1);
    engineRef.current?.clearSource();
  }

  // Render one full rotation as deterministic PNG frames and encode them into a
  // seamless-looping GIF or MP4 on the backend. No screen-recording, so the loop
  // is exact and quality is maximal (lossless frames). Frames upload one at a time
  // (a few in flight) while the next ones render. Saves + downloads.
  async function exportLoop(fmt) {
    if (rec || !engineRef.current) return;
    setVfmt(fmt);
    setRecError("");
    setRec("rendering");
    setRecProgress(0);
    await new Promise((r) => setTimeout(r, 30)); // let the button repaint first
    const fail = (msg) => {
      setRec("error");
      setRecError(msg || "Export failed.");
      setTimeout(() => setRec(""), 4000);
    };
    const readError = async (r, what) => {
      let msg = "";
      try { msg = (await r.json()).message || ""; } catch { /* not JSON */ }
      return msg || `${what} (HTTP ${r.status}).`;
    };
    const post = async (url, init, what) => {
      let r;
      try { r = await fetch(url, init); } catch { throw new Error("Couldn't reach the app server. Is it running?"); }
      if (!r.ok) throw new Error(await readError(r, what));
      return r.json();
    };
    try {
      const count = Math.max(2, Math.round(EXPORT_FPS * EXPORT_SECONDS));
      const { job } = await post("/api/images/frames/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fmt,
          fps: EXPORT_FPS,
          count,
          size: stateRef.current.aspect,
          headline: (stateRef.current.title || fileName || "ASCII Live").slice(0, 80),
          draftId: draftId || undefined, // so the image traces back to the post it's for
        }),
      }, "Couldn't start the export");
      // Uploads run a few at a time while the next frames render. An upload
      // that fails while nothing awaits it is remembered and stops the loop at
      // the next frame, so the real cause reaches the user (not "143 of 144").
      const inFlight = new Set();
      let sent = 0;
      let firstErr = null;
      await engineRef.current.captureFrames({
        fps: EXPORT_FPS,
        seconds: EXPORT_SECONDS,
        onFrame: async (blob, i, n) => {
          if (firstErr) throw firstErr;
          const p = post(`/api/images/frames/${job}/${i}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob }, `Frame ${i} upload failed`)
            .then(() => { sent++; setRecProgress(sent / n); })
            .catch((e) => { firstErr = firstErr || e; })
            .finally(() => inFlight.delete(p));
          inFlight.add(p);
          if (inFlight.size >= 4) await Promise.race(inFlight);
        },
      });
      await Promise.all(inFlight);
      if (firstErr) throw firstErr;
      setRec("encoding");
      const recd = await post(`/api/images/frames/${job}/finish`, { method: "POST" }, "Encoding failed");
      onSaved?.();
      const a = document.createElement("a");
      a.href = recd.url;
      a.download = `${recd.id}.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      setRec("");
    } catch (err) {
      fail(err?.message);
    }
  }

  async function saveToLibrary() {
    const url = engineRef.current?.exportDataUrl();
    if (!url) return;
    setSaveState("saving");
    try {
      const r = await fetch("/api/images/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl: url,
          headline: (stateRef.current.title || fileName || "ASCII Live frame").slice(0, 80),
          size: stateRef.current.aspect,
          draftId: draftId || undefined,
        }),
      });
      if (!r.ok) throw new Error("save failed");
      setSaveState("saved");
      onSaved?.();
      setTimeout(() => setSaveState(""), 2200);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState(""), 2600);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ---- live preview ---- */}
      <div
        ref={stageRef}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
        className="relative grid min-h-[420px] place-items-center rounded-2xl border border-line bg-rail p-4 lg:min-h-[calc(100vh-13rem)]"
        style={{ backgroundImage: "radial-gradient(900px 500px at 30% 0%, #14213d 0%, #0b1210 60%)" }}
      >
        <canvas ref={previewRef} className="block rounded-md shadow-[0_20px_80px_rgba(0,0,0,0.7)]" />
        {dragging && (
          <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-bright bg-brand/10 text-sm font-medium tracking-widest text-brand-bright">
            DROP SVG OR PNG
          </div>
        )}
      </div>

      {/* ---- controls ---- */}
      <Card className="scroll-quiet max-h-[calc(100vh-11rem)] overflow-y-auto p-5">
        {/* Base on a post */}
        <Eyebrow>Base on a post</Eyebrow>
        <Select
          className="mt-2.5"
          value={draftId}
          onChange={pickDraft}
          searchable
          placeholder="Pick a draft — its hook becomes the poster text"
          options={[
            { value: "", label: "Pick a draft — its hook becomes the poster text" },
            ...groupedDraftOptions(drafts),
          ]}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Pulls a clean hook sentence from the draft, turns on the text layout, and dates it.
          Tweak the wording under “Carousel text layout” below.
        </p>

        <div className="my-5 h-px bg-line" />

        {/* Artwork */}
        <Eyebrow>Artwork</Eyebrow>
        <div
          onClick={() => fileInputRef.current?.click()}
          className="mt-2.5 cursor-pointer rounded-lg border border-dashed border-line-strong bg-canvas px-3 py-4 text-center transition hover:border-brand"
        >
          <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-ink-2">
            <UploadSimple size={15} /> Click or drop a file
          </div>
          <div className="mt-0.5 text-[11px] text-faint">SVG · PNG (transparent works best)</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,.png,image/svg+xml,image/png,image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {fileName && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
            <span className="min-w-0 flex-1 truncate text-ink-2">{fileName}</span>
            <button onClick={clearArtwork} className="text-faint hover:text-brand">clear</button>
          </div>
        )}
        {loadError && <p className="mt-2 text-[11px] text-crit">{loadError}</p>}

        {/* SAP artwork library */}
        <div className="mt-5">
          <Eyebrow>SAP artwork library</Eyebrow>
          <div className="mt-2.5 grid grid-cols-4 gap-1.5">
            {ICONS.map((it, idx) => (
              <button
                key={it.name}
                title={it.name}
                onClick={() => pickIcon(idx)}
                className={`grid aspect-square place-items-center overflow-hidden rounded-md border p-2.5 transition [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${
                  activeIcon === idx ? "border-brand bg-brand/10" : "border-line-strong bg-canvas hover:border-brand/50"
                }`}
                dangerouslySetInnerHTML={{ __html: it.svg.replace('stroke="#fff"', 'stroke="#2b3147"').replace(/fill="#fff"/g, 'fill="#2b3147"') }}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">Line icons for common SAP concepts. Click to load, or drop your own above.</p>
        </div>

        {/* Format */}
        <div className="mt-5">
          <Eyebrow>Format</Eyebrow>
          <div className="mt-2.5 flex gap-1.5">
            <Seg active={ui.aspect === "portrait"} onClick={() => set("aspect", "portrait", { resize: true })}>Portrait 4:5</Seg>
            <Seg active={ui.aspect === "square"} onClick={() => set("aspect", "square", { resize: true })}>Square 1:1</Seg>
          </div>
        </div>

        {/* Detail */}
        <div className="mt-5">
          <Slider label="Detail (columns)" value={ui.cols} min={60} max={200} step={2} onChange={(v) => set("cols", v)} />
        </div>

        {/* Character set */}
        <div className="mt-5">
          <Eyebrow>Character set</Eyebrow>
          <Select
            className="mt-2.5"
            value={ui.charset}
            onChange={(v) => set("charset", v)}
            options={CHARSETS.map((c) => ({ value: c.value, label: c.label }))}
          />
        </div>

        {/* Source */}
        <div className="mt-5">
          <Eyebrow>Source</Eyebrow>
          <div className="mt-2.5 flex gap-1.5">
            {["auto", "brightness", "silhouette"].map((s) => (
              <Seg key={s} active={ui.source === s} onClick={() => set("source", s, { rebuild: true })}>
                {s[0].toUpperCase() + s.slice(1)}
              </Seg>
            ))}
          </div>
        </div>

        {/* Color */}
        <div className="mt-5">
          <Eyebrow>Color</Eyebrow>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c.hex}
                onClick={() => set("color", c.hex)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition ${
                  ui.color === c.hex ? "border-brand text-ink" : "border-line-strong text-muted hover:border-brand/60"
                }`}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: c.hex }} />
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contrast / Brightness */}
        <div className="mt-5 space-y-4">
          <Slider label="Contrast" value={ui.contrast} min={0.5} max={3} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => set("contrast", v)} />
          <Slider label="Brightness" value={ui.bright} min={-0.4} max={0.4} step={0.02} fmt={(v) => v.toFixed(2)} onChange={(v) => set("bright", v)} />
        </div>

        {/* Toggles */}
        <div className="mt-5 space-y-3">
          {[
            ["shade", "Depth shading"],
            ["glow", "Phosphor glow"],
            ["invert", "Invert"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-[13px] text-ink-2">{label}</span>
              <Toggle checked={ui[k]} onChange={(v) => set(k, v)} />
            </div>
          ))}
        </div>

        <div className="my-5 h-px bg-line" />

        {/* Motion */}
        <div className="space-y-4">
          <Slider label="Float" value={ui.float} min={0} max={1} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => set("float", v)} />
          <Slider label="3D turn (° / sec)" value={ui.rotate} min={-60} max={60} step={1} onChange={(v) => set("rotate", v)} />
        </div>

        <div className="my-5 h-px bg-line" />

        {/* Carousel text layout */}
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink-2">Carousel text layout</span>
          <Toggle checked={ui.layout} onChange={(v) => set("layout", v)} />
        </div>
        {ui.layout && (
          <div className="mt-4 space-y-3">
            <div className="flex gap-1.5">
              <Seg active={ui.side === "left"} onClick={() => set("side", "left")}>Text left</Seg>
              <Seg active={ui.side === "right"} onClick={() => set("side", "right")}>Text right</Seg>
            </div>
            <input
              value={ui.kicker}
              onChange={(e) => set("kicker", e.target.value)}
              placeholder="Kicker / date  ·  e.g. MON · 07 JUL"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
            />
            <input
              value={ui.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Title  ·  e.g. Data that speaks."
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
            />
            <textarea
              value={ui.body}
              onChange={(e) => set("body", e.target.value)}
              rows={3}
              placeholder="One or two lines of supporting copy for today's post."
              className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-brand"
            />
          </div>
        )}

        <div className="my-5 h-px bg-line" />

        {/* Export */}
        <div className="space-y-2.5">
          <Button onClick={() => exportLoop("gif")} disabled={!!rec || noFfmpeg} title={noFfmpeg ? "ffmpeg is missing on the server" : undefined} className="w-full">
            {rec && vfmt === "gif" ? <ExportState rec={rec} fmt="gif" progress={recProgress} /> : <><DownloadSimple size={16} weight="bold" /> Download .gif</>}
          </Button>
          <Button variant="outline" onClick={() => exportLoop("mp4")} disabled={!!rec || noFfmpeg} title={noFfmpeg ? "ffmpeg is missing on the server" : undefined} className="w-full">
            {rec && vfmt === "mp4" ? <ExportState rec={rec} fmt="mp4" progress={recProgress} /> : <><VideoCamera size={16} weight="fill" /> Download .mp4</>}
          </Button>
          {noFfmpeg && (
            <p className="text-[12px] leading-relaxed text-warn">
              Animated exports are off: ffmpeg isn't installed on the machine running the app.
              Install it there (Ubuntu: <code>sudo apt install ffmpeg</code>) or set FFMPEG_PATH, then restart.
            </p>
          )}
          {rec === "error" && recError && (
            <p className="text-[12px] leading-relaxed text-warn">{recError}</p>
          )}
          <p className="-mt-0.5 text-[11px] leading-relaxed text-faint">
            Renders one full rotation as exact frames and encodes a seamless loop, so it
            loops perfectly at top quality. The GIF loops forever in the LinkedIn feed; an
            MP4 is sharper, but LinkedIn plays videos once.
          </p>
          <div className="h-px bg-line" />
          <Button variant="outline" onClick={saveToLibrary} disabled={saveState === "saving"} className="w-full">
            {saveState === "saved" ? (
              <><CheckCircle size={16} weight="fill" /> Saved to library</>
            ) : saveState === "error" ? (
              <><X size={16} /> Save failed</>
            ) : (
              <><FloppyDisk size={16} weight="fill" /> {saveState === "saving" ? "Saving…" : "Save to library"}</>
            )}
          </Button>
          <p className="text-[11px] leading-relaxed text-faint">
            Saves the current frame as a still 1080px image in the image library.
          </p>
        </div>
      </Card>
    </div>
  );
}
