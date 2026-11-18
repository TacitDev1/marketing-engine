// Marketing Engine brain server — routes: Images.
// Registered from server/index.js via registerImageRoutes(app).

import express from "express";
import {
  listImages,
  deleteImage,
  imageFilePath,
  listProviders,
  buildImageDirection,
  generateImage,
  saveImageBytes,
  startFrameJob,
  addFrame,
  finishFrameJob,
  SIZES,
  CARD_STYLES,
} from "../images.js";
import { nowISO } from "./shared.js";
import { renderJob, finishRenderJob, renderImage, renderAvailable } from "../render.js";

// This path mounts its own express.json with a bigger limit (see the route
// below), so index.js skips its global 1 MB JSON parser for it.
export const JSON_EXEMPT = new Set(["/api/images/save"]);

export function registerImageRoutes(app) {
  // ---------- Images ----------

  // Generate post imagery through a pluggable provider seam (see images.js).
  // Branded cards are fully local; photo providers light up per env. Never posts.

  app.get("/api/images", (_req, res) => {
    try {
      res.json({
        images: listImages(),
        providers: listProviders(),
        sizes: SIZES,
        cardStyles: Object.fromEntries(Object.entries(CARD_STYLES).map(([k, v]) => [k, v.label])),
      });
    } catch (err) {
      res.json({ images: [], providers: [], sizes: {}, cardStyles: {}, error: err.message });
    }
  });

  // Turn a post (draft text) into image direction: headline + subline + visual prompt.
  app.post("/api/images/prompt", async (req, res) => {
    const { text } = req.body || {};
    try {
      res.json(await buildImageDirection({ text: String(text || "") }));
    } catch (err) {
      res.status(503).json({ error: "brain_unavailable", message: err.message });
    }
  });

  // Render an image with the chosen provider and save it locally.
  app.post("/api/images/generate", async (req, res) => {
    const { provider, prompt, headline, subline, style, size, draftId } = req.body || {};
    try {
      const rec = await generateImage({ providerId: provider, prompt, headline, subline, style, size, draftId, nowISO: nowISO() });
      res.json(rec);
    } catch (err) {
      console.error("image generate failed:", err.message);
      const status = err.code === "provider_unavailable" ? 409 : 502;
      res.status(status).json({ error: err.code || "image_failed", message: err.message });
    }
  });

  // Save a browser-rendered frame (e.g. the ASCII Live tool) into the local
  // image library. Body: { dataUrl (base64 PNG), headline, size }. Never posts.
  app.post("/api/images/save", express.json({ limit: "8mb" }), (req, res) => {
    const { dataUrl, headline, subline, eyebrow, size, draftId, provider, kind, style, credit, sourceUrl } = req.body || {};
    try {
      const rec = saveImageBytes({ dataUrl, headline, subline, eyebrow, size, draftId, provider, kind, style, credit, sourceUrl, nowISO: nowISO() });
      res.json(rec);
    } catch (err) {
      const status = err.code === "bad_data_url" ? 400 : 500;
      res.status(status).json({ error: err.code || "save_failed", message: err.message });
    }
  });

  // Assemble a deterministic frame sequence (one full rotation) into a seamless
  // looping GIF or MP4, uploaded one frame per request so no single request is
  // big: start { fmt, fps, count, size, headline } -> { job }; then each frame as
  // raw PNG bytes to /frames/:job/:index; then /frames/:job/finish encodes it.
  const frameError = (res, err, fallback) => {
    if (err.code !== "bad_frames") console.error(`${fallback}:`, err.message);
    res.status(err.code === "bad_frames" ? 400 : err.code === "ffmpeg_missing" ? 503 : 500).json({ error: err.code || fallback, message: err.message });
  };
  app.post("/api/images/frames/start", (req, res) => {
    try {
      res.json(startFrameJob({ ...(req.body || {}), nowISO: nowISO() }));
    } catch (err) {
      frameError(res, err, "frames_start_failed");
    }
  });
  app.post("/api/images/frames/:job/finish", async (req, res) => {
    try {
      res.json(await finishFrameJob(req.params.job, nowISO()));
    } catch (err) {
      frameError(res, err, "assemble_failed");
    }
  });
  app.post("/api/images/frames/:job/:index", express.raw({ type: "*/*", limit: "16mb" }), (req, res) => {
    try {
      addFrame(req.params.job, req.params.index, req.body);
      res.json({ ok: true });
    } catch (err) {
      frameError(res, err, "frame_upload_failed");
    }
  });

  // The server drawing an image itself (see server/render.js): its headless
  // Chrome reads the job, draws it and reports back here.
  app.get("/api/images/render-jobs/:id", (req, res) => {
    const job = renderJob(req.params.id);
    return job ? res.json({ job }) : res.status(404).json({ error: "not_found" });
  });
  app.post("/api/images/render-jobs/:id/done", (req, res) => res.json({ ok: finishRenderJob(req.params.id, req.body) }));
  // Draw one now: an ASCII poster (still or loop) or a photo card. Never posts.
  app.post("/api/images/render", async (req, res) => {
    if (!renderAvailable()) return res.status(503).json({ error: "no_chrome", message: "Headless Chrome isn't installed on this machine." });
    try {
      res.json(await renderImage(req.body || {}));
    } catch (err) {
      res.status(502).json({ error: "render_failed", message: err.message });
    }
  });

  // Serve a saved image file (path-traversal guarded inside imageFilePath).
  app.get("/api/images/file/:name", (req, res) => {
    const full = imageFilePath(req.params.name);
    if (!full) return res.status(404).json({ error: "not_found" });
    res.sendFile(full);
  });

  app.delete("/api/images/:id", (req, res) => {
    res.json({ deleted: deleteImage(req.params.id) });
  });
}
