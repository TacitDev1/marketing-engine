// The page the server's headless Chrome opens to draw one image unattended
// (server/render.js). It asks the brain for the job, draws it with the SAME
// code the Images screens use (the ASCII engine, the photo card), saves the
// result into the image library and tells the brain it is done. No controls,
// nothing to click: a person never sees this page.

import { useEffect, useRef, useState } from "react";
import { useAsciiEngine } from "../screens/ascii-live/useAsciiEngine.js";
import { ICONS } from "../screens/ascii-live/helpers.js";
import { renderPhotoCard, LOOKS, TEXT_SIZES, DEFAULT_SIZES, loadImage, ensureFonts } from "../components/PhotoCardStudio.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, init, what) {
  const r = await fetch(url, init);
  const out = await r.json().catch(() => ({}));
  if (!r.ok || out.error) throw new Error(`${what}: ${out.message || out.error || `HTTP ${r.status}`}`);
  return out;
}
const postJSON = (url, body, what) => call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, what);

// ---------- ASCII poster: a still (png) or one seamless turn (gif / mp4) ----------
function AsciiJob({ job, onDone }) {
  const previewRef = useRef(null);
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const cbRef = useRef({ setFileName() {}, setLoadError() {} });
  const activeRef = useRef(false); // no live preview loop: frames are drawn on demand
  const stateRef = useRef({
    aspect: job.aspect === "square" ? "square" : "portrait",
    cols: job.cols || 120,
    charset: job.charset || "classic",
    source: "auto",
    color: job.color || "#a3e635",
    contrast: 1.35,
    bright: 0,
    shade: true,
    glow: !!job.glow,
    invert: false,
    float: 0.5,
    rotate: 25,
    layout: !!(job.title || job.kicker || job.body),
    side: job.side === "right" ? "right" : "left",
    kicker: job.kicker || "",
    title: job.title || "",
    body: job.body || "",
  });
  useAsciiEngine({ previewRef, stageRef, stateRef, cbRef, activeRef, engineRef });

  useEffect(() => {
    let alive = true;
    (async () => {
      const engine = engineRef.current;
      if (!engine) throw new Error("The ASCII engine did not start.");
      const icon = ICONS.find((i) => i.name.toLowerCase() === String(job.icon || "").toLowerCase()) || ICONS[1];
      // The artwork loads through an <img>; the engine reports it through setLoadError("").
      const loaded = new Promise((resolve, reject) => {
        let calls = 0;
        cbRef.current.setLoadError = (msg) => {
          if (msg) reject(new Error(msg));
          else if (++calls >= 2) resolve();
        };
        setTimeout(resolve, 4000);
      });
      engine.loadSvg(icon.svg, icon.name);
      await loaded;
      await sleep(60);
      const st = stateRef.current;
      const headline = (st.title || `${icon.name} poster`).slice(0, 80);
      const fmt = job.fmt === "gif" || job.fmt === "mp4" ? job.fmt : "png";
      if (fmt === "png") {
        return postJSON("/api/images/save", { dataUrl: engine.exportDataUrl(), headline, size: st.aspect, draftId: job.draftId || undefined, style: `${icon.name}|${st.color}` }, "Saving the poster");
      }
      const fps = job.fps || 20;
      const seconds = job.seconds || 5;
      const count = Math.max(2, Math.round(fps * seconds));
      const { job: frames } = await postJSON("/api/images/frames/start", { fmt, fps, count, size: st.aspect, headline, draftId: job.draftId || undefined }, "Starting the export");
      await engine.captureFrames({
        fps,
        seconds,
        onFrame: (blob, i) => call(`/api/images/frames/${frames}/${i}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob }, `Frame ${i}`),
      });
      return call(`/api/images/frames/${frames}/finish`, { method: "POST" }, "Encoding");
    })().then(
      (rec) => alive && onDone({ imageId: rec.id }),
      (err) => alive && onDone({ error: err.message })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={stageRef} style={{ width: 540, height: 675 }}>
      <canvas ref={previewRef} />
    </div>
  );
}

// ---------- Photo card: a saved photo with the words and the Larkwell logo on it ----------
function PhotoJob({ job, onDone }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [photo, white, colour] = await Promise.all([loadImage(job.photoUrl), loadImage(`${import.meta.env.BASE_URL}brand/mark-white.svg`).catch(() => null), loadImage(`${import.meta.env.BASE_URL}brand/mark.svg`).catch(() => null), ensureFonts()]);
      const look = LOOKS.find((l) => l.id === job.look) || LOOKS[0];
      const textSize = TEXT_SIZES.find((t) => t.id === job.textSize) || TEXT_SIZES[1];
      const sizeId = DEFAULT_SIZES[job.size] ? job.size : "linkedin";
      await renderPhotoCard(canvasRef.current, {
        photo,
        marks: { white, colour },
        size: DEFAULT_SIZES[sizeId],
        look,
        spot: job.spot || "bottom",
        textSize,
        eyebrow: job.eyebrow || "",
        headline: job.headline || "",
        subline: job.subline || "",
        logo: job.logo !== false,
      });
      return postJSON(
        "/api/images/save",
        {
          dataUrl: canvasRef.current.toDataURL("image/jpeg", 0.92),
          provider: "photo-card",
          kind: "photo",
          style: look.id,
          headline: job.headline || job.eyebrow || "Photo card",
          subline: job.subline || null,
          eyebrow: job.eyebrow || null,
          size: sizeId,
          draftId: job.draftId || null,
          credit: job.credit || null,
          sourceUrl: job.sourceUrl || null,
        },
        "Saving the photo card"
      );
    })().then(
      (rec) => alive && onDone({ imageId: rec.id }),
      (err) => alive && onDone({ error: err.message })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={canvasRef} />;
}

// ---------- Raster: a saved picture (a branded card is an SVG) redrawn as a PNG ----------
function RasterJob({ job, onDone }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const img = await loadImage(job.url);
      const c = canvasRef.current;
      c.width = job.w || img.naturalWidth || 1200;
      c.height = job.h || img.naturalHeight || 627;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return postJSON("/api/images/save", { dataUrl: c.toDataURL("image/png"), provider: job.provider || "cards", kind: "card", style: job.style || null, headline: job.headline || "Card", subline: job.subline || null, size: job.size || "linkedin", draftId: job.draftId || null }, "Saving the picture");
    })().then(
      (rec) => alive && onDone({ imageId: rec.id }),
      (err) => alive && onDone({ error: err.message })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={canvasRef} />;
}

export default function RenderJob({ jobId }) {
  const [job, setJob] = useState(null);
  const [state, setState] = useState("loading");
  const base = `/api/images/render-jobs/${encodeURIComponent(jobId)}`;
  const report = (result) => {
    setState(result.error ? `failed: ${result.error}` : "done");
    postJSON(`${base}/done`, result, "Reporting").catch(() => {});
  };

  useEffect(() => {
    call(base, undefined, "Reading the job").then(
      (j) => setJob(j.job),
      (err) => setState(`failed: ${err.message}`)
    );
    // A drawing error outside our own promises must still reach the server.
    const onError = (e) => report({ error: String(e.message || e.reason?.message || "render page error").slice(0, 300) });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ background: "#000", color: "#9aa3b5", font: "12px monospace" }}>
      <div id="render-state">{state}</div>
      {job?.type === "ascii" && <AsciiJob job={job} onDone={report} />}
      {job?.type === "photo-card" && <PhotoJob job={job} onDone={report} />}
      {job?.type === "raster" && <RasterJob job={job} onDone={report} />}
    </div>
  );
}
