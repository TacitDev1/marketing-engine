import { useEffect } from "react";
import * as THREE from "three";
import { RAMPS } from "./helpers.js";

// The effect below is the screen's engine, moved here verbatim. The refs it
// reads and writes are owned by the AsciiLive screen and passed in.
export function useAsciiEngine({ previewRef, stageRef, stateRef, cbRef, activeRef, engineRef }) {
  // ---------------- the imperative engine, built once ----------------
  useEffect(() => {
    const st = stateRef.current; // stable reference; props read live
    const preview = previewRef.current;
    const pctx = preview.getContext("2d");
    const sample = document.createElement("canvas");
    const sctx = sample.getContext("2d", { willReadFrequently: true });

    function outDims() {
      return st.aspect === "portrait" ? { W: 1080, H: 1350 } : { W: 1080, H: 1080 };
    }
    function gridRows(cols) {
      const { W, H } = outDims();
      return Math.max(8, Math.round(cols * 0.6 * (H / W)));
    }
    function hexToRgb(h) {
      const n = parseInt(h.slice(1), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    // ---- source artwork ----
    let source = null; // {canvas, w, h, hasAlpha}

    function normalizeSvg(txt) {
      return txt.replace(/<svg([^>]*)>/i, (m, attrs) => {
        let a = attrs;
        const hasW = /\swidth=/i.test(a), hasH = /\sheight=/i.test(a);
        let w = 512, h = 512;
        const vb = /viewBox=["']([\d.\s,-]+)["']/i.exec(a);
        if (vb) { const p = vb[1].trim().split(/[\s,]+/).map(Number); if (p.length === 4) { w = p[2] || 512; h = p[3] || 512; } }
        if (!hasW) a += ` width="${w}"`;
        if (!hasH) a += ` height="${h}"`;
        return `<svg${a}>`;
      });
    }

    function makeSource(img) {
      const cap = 1000;
      let w = img.naturalWidth || img.width || 512;
      let h = img.naturalHeight || img.height || 512;
      const s = Math.min(1, cap / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const cx = c.getContext("2d");
      cx.clearRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      let hasAlpha = false;
      try {
        const d = cx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < d.length; i += 4 * 37) { if (d[i] < 245) { hasAlpha = true; break; } }
      } catch (e) { /* tainted canvas — treat as opaque */ }
      source = { canvas: c, w, h, hasAlpha };
      rebuildObject();
    }

    function loadFile(file) {
      if (!file) return;
      cbRef.current.setLoadError("");
      cbRef.current.setFileName(file.name);
      const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
      const reader = new FileReader();
      if (isSvg) {
        reader.onload = () => {
          const txt = normalizeSvg(reader.result);
          const img = new Image();
          img.onload = () => { cbRef.current.setLoadError(""); makeSource(img); };
          img.onerror = () => cbRef.current.setLoadError("Couldn't read that SVG — try a different file.");
          img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(txt);
        };
        reader.readAsText(file);
      } else {
        reader.onload = () => {
          const img = new Image();
          img.onload = () => { cbRef.current.setLoadError(""); makeSource(img); };
          img.onerror = () => cbRef.current.setLoadError("Couldn't read that image — try a different file.");
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      }
    }

    function loadSvg(svg, name) {
      cbRef.current.setLoadError("");
      const img = new Image();
      img.onload = () => { cbRef.current.setLoadError(""); makeSource(img); };
      img.onerror = () => cbRef.current.setLoadError("Couldn't render that artwork.");
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      cbRef.current.setFileName(name + " (library)");
    }

    function clearSource() {
      source = null;
      cbRef.current.setFileName("");
    }

    // ---- WebGL 3D ----
    const glCanvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 0.8, 0.1, 100);
    camera.position.set(0, 0, 5.0);
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 4, 5); scene.add(key);
    const fillL = new THREE.DirectionalLight(0xffffff, 0.6); fillL.position.set(-4, -1, 3); scene.add(fillL);
    const rimL = new THREE.DirectionalLight(0xffffff, 1.2); rimL.position.set(-2, 3, -4); scene.add(rimL);
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    let mesh = null;
    let recordCtl = null; // {start, dur, turns, dir} while recording a seamless loop
    let phaseInfo = null; // {p, turns, dir} to render one exact frame of the loop

    function buildHeightTexture() {
      let mode = st.source;
      if (mode === "auto") mode = source.hasAlpha ? "silhouette" : "brightness";
      const sw = source.w, sh = source.h;
      const sc = document.createElement("canvas"); sc.width = sw; sc.height = sh;
      const scx = sc.getContext("2d", { willReadFrequently: true });
      scx.drawImage(source.canvas, 0, 0);
      const d = scx.getImageData(0, 0, sw, sh).data;
      const out = scx.createImageData(sw, sh);
      const o = out.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        let h = mode === "silhouette" ? a : a > 0 ? lum : 0;
        if (a > 0.5) h = Math.max(h, 0.4);
        o[i] = Math.round(h * 255);
        o[i + 1] = Math.round(a * 255);
        o[i + 2] = 0;
        o[i + 3] = 255;
      }
      scx.putImageData(out, 0, 0);
      return sc;
    }

    function rebuildObject() {
      if (!source) return;
      const tex = new THREE.CanvasTexture(buildHeightTexture());
      tex.needsUpdate = true;
      const maxd = Math.max(source.w, source.h);
      const pw = 2.6 * source.w / maxd, ph = 2.6 * source.h / maxd;
      const seg = 260;
      const geo = new THREE.PlaneGeometry(pw, ph, Math.round(seg * pw / 2.6), Math.round(seg * ph / 2.6));
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.72, metalness: 0.0,
        alphaMap: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
        displacementMap: tex, displacementScale: 0.5, displacementBias: -0.4,
      });
      if (mesh) {
        scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
        if (mesh.material.displacementMap) mesh.material.displacementMap.dispose();
      }
      mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
    }

    function renderGL(fw, fh, t) {
      if (glCanvas.width !== fw || glCanvas.height !== fh) {
        renderer.setSize(fw, fh, false);
        camera.aspect = fw / fh; camera.updateProjectionMatrix();
      }
      if (mesh) {
        const fl = st.float;
        // Nestle the object into the bottom-right corner (visible-frame relative
        // so it holds for portrait and square), 20% smaller than centered.
        const vH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI / 180) / 2);
        const vW = vH * camera.aspect;
        mesh.position.set(vW * 0.2, -vH * 0.24, 0);
        // Loop phase p∈[0,1): whole turns so frame at p=0 and p=1 are identical
        // → a seamless loop. phaseInfo (explicit frame) wins; else the live
        // record clock; else wall-clock free-running motion.
        let ph = null, turns = 0, dir = 1;
        if (phaseInfo) { ph = phaseInfo.p; turns = phaseInfo.turns; dir = phaseInfo.dir; }
        else if (recordCtl) { ph = ((performance.now() - recordCtl.start) / (recordCtl.dur * 1000)) % 1; turns = recordCtl.turns; dir = recordCtl.dir; }
        if (ph != null) {
          const tau = 2 * Math.PI;
          mesh.rotation.y = dir * tau * turns * ph;
          mesh.rotation.x = Math.sin(tau * ph) * 0.1 * fl;
          mesh.rotation.z = Math.sin(tau * ph + 2) * 0.04 * fl;
          const br = 0.8 * (1 + Math.sin(tau * ph) * 0.03 * fl);
          mesh.scale.set(br, br, 1);
        } else {
          mesh.rotation.y = st.rotate * t * Math.PI / 180;
          mesh.rotation.x = Math.sin(t * 0.5) * 0.1 * fl;
          mesh.rotation.z = Math.sin(t * 0.4 + 2) * 0.04 * fl;
          const br = 0.8 * (1 + Math.sin(t * 0.7) * 0.03 * fl);
          mesh.scale.set(br, br, 1);
        }
      }
      renderer.render(scene, camera);
    }

    function sizePreview() {
      const { W, H } = outDims();
      preview.width = W; preview.height = H;
      const stage = stageRef.current;
      if (!stage) return;
      const availH = stage.clientHeight - 8;
      const availW = stage.clientWidth - 8;
      let h = availH, w = h * W / H;
      if (w > availW) { w = availW; h = w * H / W; }
      preview.style.height = h + "px";
      preview.style.width = w + "px";
    }

    // ---- ASCII render ----
    function wrap(ctx, text, maxW) {
      const words = text.split(/\s+/); const lines = []; let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
        else line = test;
      }
      if (line) lines.push(line);
      return lines;
    }

    function drawLayout(ctx, W, H) {
      if (!st.kicker && !st.title && !st.body) return;
      const left = st.side === "left";
      const colW = W * 0.56;
      const gx = left ? 0 : W - colW;
      const grad = ctx.createLinearGradient(left ? 0 : W, 0, left ? colW : W - colW, 0);
      grad.addColorStop(0, "rgba(0,0,0,0.86)");
      grad.addColorStop(0.7, "rgba(0,0,0,0.6)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad; ctx.fillRect(gx, 0, colW, H);

      const pad = W * 0.07;
      const x = gx + pad;
      const maxW = colW - pad * 1.5;

      const kickerS = Math.round(W * 0.026);
      const bodyS = Math.round(W * 0.032);
      const gapKick = W * 0.045; // space below the kicker
      const gapBody = W * 0.05;  // space between title and body
      const budgetH = H * 0.8;   // text block must fit within 80% of height

      // Auto-fit the headline: shrink until kicker + title + body all fit.
      const maxTitleS = Math.round(W * 0.076);
      const minTitleS = Math.round(W * 0.034);
      let titleS = maxTitleS;
      let titleLines = [], bodyLines = [], titleLH = 0, total = 0;
      const measure = () => {
        titleLH = titleS * 1.08;
        ctx.font = "700 " + titleS + "px ui-monospace, monospace";
        titleLines = st.title ? wrap(ctx, st.title, maxW) : [];
        ctx.font = bodyS + "px ui-monospace, monospace";
        bodyLines = st.body ? wrap(ctx, st.body, maxW) : [];
        const kickH = st.kicker ? kickerS + gapKick : 0;
        const titleH = titleLines.length * titleLH;
        const bodyH = bodyLines.length ? gapBody + bodyLines.length * bodyS * 1.45 : 0;
        total = kickH + titleH + bodyH;
      };
      measure();
      while (total > budgetH && titleS > minTitleS) { titleS -= 2; measure(); }

      // Vertically centre the block.
      let y = Math.max(H * 0.1, (H - total) / 2);
      ctx.textAlign = "left"; ctx.textBaseline = "top";

      if (st.kicker) {
        ctx.fillStyle = st.color;
        ctx.font = "600 " + kickerS + "px ui-monospace, monospace";
        ctx.fillText(st.kicker.toUpperCase(), x, y);
        y += kickerS + gapKick;
      }
      if (st.title) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 " + titleS + "px ui-monospace, monospace";
        for (const ln of titleLines) { ctx.fillText(ln, x, y); y += titleLH; }
      }
      if (st.body) {
        y += gapBody;
        ctx.fillStyle = "rgba(230,232,236,0.82)";
        ctx.font = bodyS + "px ui-monospace, monospace";
        for (const ln of bodyLines) { ctx.fillText(ln, x, y); y += bodyS * 1.45; }
      }
      ctx.textBaseline = "alphabetic";
    }

    function renderAscii(ctx, W, H, t) {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

      if (!source) {
        ctx.fillStyle = st.color;
        ctx.font = Math.round(W * 0.035) + "px ui-monospace, monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const blink = Math.floor(t * 1.5) % 2 ? "_" : " ";
        ctx.fillText("DROP AN SVG OR PNG " + blink, W / 2, H / 2);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        return;
      }

      const cols = st.cols, rows = gridRows(cols);
      const fw = 640, fh = Math.round(640 * H / W);
      renderGL(fw, fh, t);

      sample.width = cols; sample.height = rows;
      sctx.imageSmoothingEnabled = true;
      sctx.clearRect(0, 0, cols, rows);
      sctx.drawImage(glCanvas, 0, 0, cols, rows);
      const data = sctx.getImageData(0, 0, cols, rows).data;

      const ramp = RAMPS[st.charset], rlen = ramp.length;
      const cellW = W / cols, cellH = H / rows, fontSize = cellH;
      ctx.textBaseline = "top";
      ctx.font = fontSize + "px ui-monospace, \"Courier New\", monospace";
      if (st.glow) { ctx.shadowColor = st.color; ctx.shadowBlur = fontSize * 0.6; }
      else ctx.shadowBlur = 0;

      const col = hexToRgb(st.color);
      const chars = new Array(rows), vals = new Array(rows);
      for (let y = 0; y < rows; y++) {
        chars[y] = new Array(cols); vals[y] = new Array(cols);
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 4;
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          let v = lum;
          v = (v - 0.5) * st.contrast + 0.5 + st.bright;
          v = Math.max(0, Math.min(1, v));
          if (st.invert) v = 1 - v;
          vals[y][x] = v;
          chars[y][x] = ramp[Math.min(rlen - 1, Math.floor(v * rlen))];
        }
      }

      if (!st.shade) {
        ctx.fillStyle = st.color;
        for (let y = 0; y < rows; y++) ctx.fillText(chars[y].join(""), 0, y * cellH);
      } else {
        const L = 6;
        for (let y = 0; y < rows; y++) {
          for (let lvl = 0; lvl < L; lvl++) {
            let line = "", any = false;
            for (let x = 0; x < cols; x++) {
              const ch = chars[y][x];
              if (ch === " ") { line += " "; continue; }
              const b = Math.min(L - 1, Math.floor(vals[y][x] * L));
              if (b === lvl) { line += ch; any = true; } else line += " ";
            }
            if (!any) continue;
            const f = 0.4 + 0.6 * (lvl / (L - 1));
            ctx.fillStyle = "rgb(" + Math.round(col.r * f) + "," + Math.round(col.g * f) + "," + Math.round(col.b * f) + ")";
            ctx.fillText(line, 0, y * cellH);
          }
        }
      }
      ctx.shadowBlur = 0;

      if (st.layout) drawLayout(ctx, W, H);
    }

    // ---- loop ----
    const start = performance.now();
    let raf = 0;
    function loop() {
      // Skip the heavy WebGL+canvas render while hidden; keep the loop alive so
      // it resumes instantly (and in sync with real time) when shown again.
      // Also pause while an export is capturing frames (phaseInfo set): the
      // capture yields between frames, and a preview redraw on every yield
      // made the export several times slower.
      if (activeRef.current && !phaseInfo) {
        const t = (performance.now() - start) / 1000;
        renderAscii(pctx, preview.width, preview.height, t);
      }
      raf = requestAnimationFrame(loop);
    }
    sizePreview();
    loop();

    const onResize = () => sizePreview();
    window.addEventListener("resize", onResize);

    engineRef.current = {
      loadFile, loadSvg, clearSource, rebuildObject, sizePreview,
      exportDataUrl() {
        const { W, H } = outDims();
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const t = (performance.now() - start) / 1000;
        renderAscii(c.getContext("2d"), W, H, t);
        return c.toDataURL("image/png");
      },
      // Deterministically render ONE full rotation as PNG frames. Frame i is at
      // phase i/N; since we do whole turns, frame N would equal frame 0, so frames
      // 0..N-1 loop seamlessly. Lossless PNGs = highest quality. Each frame goes to
      // onFrame(blob, i) as soon as it's rendered (and is awaited), so only one
      // frame is ever held in memory instead of the whole rotation.
      async captureFrames({ fps = 24, seconds = 6, onFrame } = {}) {
        const { W, H } = outDims();
        const N = Math.max(2, Math.round(fps * seconds));
        const rot = st.rotate || 0;
        const dir = rot >= 0 ? 1 : -1;
        const turns = Math.abs(rot) < 1 ? 0 : 1; // one clean rotation per loop
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const cx = c.getContext("2d");
        try {
          for (let i = 0; i < N; i++) {
            phaseInfo = { p: i / N, turns, dir };
            renderAscii(cx, W, H, 0);
            const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't render a frame."))), "image/png"));
            await onFrame(blob, i, N);
          }
        } finally {
          phaseInfo = null;
        }
        return { count: N, fps };
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (mesh) {
        mesh.geometry.dispose();
        // alphaMap and displacementMap are the same CanvasTexture — one dispose.
        if (mesh.material.alphaMap) mesh.material.alphaMap.dispose();
        mesh.material.dispose();
      }
      renderer.dispose();
      // Actually release the WebGL context. Without this, flipping the
      // Card/ASCII tabs accumulated live contexts until Chrome killed the oldest.
      renderer.forceContextLoss();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
