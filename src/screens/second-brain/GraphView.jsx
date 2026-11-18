import { useState, useEffect, useRef } from "react";
import {
  Graph as GraphIcon,
  CircleNotch,
  Plus,
  Minus,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { TYPE_COLOR } from "./helpers.js";

// ---- graph view (force-directed, no dependency) ----

// Animated, interactive force graph on a canvas: live spring physics (bouncy),
// scroll/buttons to zoom, drag the background to pan, drag a node to fling it,
// click a node to open it, and a reset button.
export default function GraphView({ onOpen, selected, active = true }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const onOpenRef = useRef(onOpen);
  const selRef = useRef(selected);
  const activeRef = useRef(active);
  onOpenRef.current = onOpen;
  selRef.current = selected;
  activeRef.current = active;
  const sim = useRef(null);
  const [meta, setMeta] = useState({ loading: true, nodes: 0, links: 0, types: [] });
  const [showRel, setShowRel] = useState(true); // draw the faint "suggested" links

  // keep the draw loop's copy of the toggle in sync
  useEffect(() => {
    if (sim.current) sim.current.showRel = showRel;
  }, [showRel]);

  // physics constants — tuned for an organized, spread-out layout:
  // strong repulsion + collision (nodes breathe, never overlap), real [[links]]
  // pull firmly (structure), semantic "suggested" links barely pull (no hairball),
  // and a gentle per-type clustering nudge forms clean colored islands.
  const REP = 5200, SPRING = 0.045, LEN = 95, SPRING_REL = 0.005, LEN_REL = 150;
  const CENTER = 0.004, CLUSTER = 0.022, COLLIDE = 10, DAMP = 0.9, MAXV = 45;

  function reheat(v = 0.7) { if (sim.current) sim.current.alpha = Math.max(sim.current.alpha, v); }

  function fit() {
    const s = sim.current;
    if (!s || !s.nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of s.nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY);
    const pad = 80;
    const scale = Math.min(3, Math.max(0.2, Math.min((s.w - pad) / gw, (s.h - pad) / gh)));
    s.cam.scale = scale;
    s.cam.x = s.w / 2 - ((minX + maxX) / 2) * scale;
    s.cam.y = s.h / 2 - ((minY + maxY) / 2) * scale;
  }

  function zoomAround(px, py, factor) {
    const s = sim.current;
    if (!s) return;
    const ns = Math.min(4, Math.max(0.15, s.cam.scale * factor));
    const wx = (px - s.cam.x) / s.cam.scale, wy = (py - s.cam.y) / s.cam.scale;
    s.cam.scale = ns;
    s.cam.x = px - wx * ns;
    s.cam.y = py - wy * ns;
    s.dirty = true;
  }

  const zoomIn = () => zoomAround(sim.current.w / 2, sim.current.h / 2, 1.25);
  const zoomOut = () => zoomAround(sim.current.w / 2, sim.current.h / 2, 0.8);
  const reset = () => { fit(); reheat(0.6); };

  useEffect(() => {
    let alive = true;
    const canvas = canvasRef.current, wrap = wrapRef.current;
    const ctx = canvas.getContext("2d");
    sim.current = { nodes: [], links: [], adj: new Map(), cam: { x: 0, y: 0, scale: 1 }, alpha: 0, hover: null, drag: null, dragMoved: false, pan: null, w: 0, h: 0, dpr: 1, raf: 0, showRel: true, dirty: true };
    const s = sim.current;

    // Pull the live design tokens so the canvas themes (light + dark) like the rest
    // of the app. Read once on mount; the graph remounts when you leave/return.
    const cssVar = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb);
    const theme = {
      edgeActive: cssVar("--color-brand", "#14532d"),
      edgeRel: cssVar("--color-line", "#c7cede"),
      edge: cssVar("--color-line-strong", "#aeb7ce"),
      nodeStroke: cssVar("--color-surface", "#ffffff"),
      nodeStrokeSel: cssVar("--color-ink", "#0b1210"),
      label: cssVar("--color-muted", "#5b6478"),
      labelHot: cssVar("--color-ink", "#0b1210"),
    };

    function resize() {
      const r = wrap.getBoundingClientRect();
      s.w = r.width; s.h = r.height; s.dpr = window.devicePixelRatio || 1;
      canvas.width = r.width * s.dpr; canvas.height = r.height * s.dpr;
      canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      s.dirty = true; // the canvas was cleared by the resize — force one redraw
    }
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    fetch("/api/wiki/graph")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const nodes = (d.nodes || []).map((n, i) => {
          const a = (i / Math.max(1, (d.nodes || []).length)) * Math.PI * 2;
          const R = Math.min(s.w, s.h) * 0.33 || 250;
          return { ...n, x: Math.cos(a) * R + Math.sin(i * 12.9898) * 6, y: Math.sin(a) * R + Math.cos(i * 78.233) * 6, vx: 0, vy: 0, r: 4 + Math.min(11, (n.deg || 0) * 1.4) };
        });
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const links = (d.links || []).map((l) => ({ a: byId.get(l.source), b: byId.get(l.target), kind: l.kind })).filter((l) => l.a && l.b);
        const adj = new Map(nodes.map((n) => [n.id, new Set()]));
        for (const l of links) { adj.get(l.a.id).add(l.b.id); adj.get(l.b.id).add(l.a.id); }
        s.nodes = nodes; s.links = links; s.adj = adj; s.alpha = 1;
        fit();
        const counts = {};
        for (const n of nodes) counts[n.type || "concept"] = (counts[n.type || "concept"] || 0) + 1;
        const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        setMeta({ loading: false, nodes: nodes.length, links: links.length, types, counts });
      })
      .catch(() => alive && setMeta({ loading: false, nodes: 0, links: 0, error: true }));

    // ---- interaction ----
    const toWorld = (e) => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      return { px, py, wx: (px - s.cam.x) / s.cam.scale, wy: (py - s.cam.y) / s.cam.scale };
    };
    const nodeAt = (wx, wy) => {
      for (let i = s.nodes.length - 1; i >= 0; i--) {
        const n = s.nodes[i];
        const rr = n.r + 6 / s.cam.scale;
        if ((n.x - wx) ** 2 + (n.y - wy) ** 2 <= rr * rr) return n;
      }
      return null;
    };
    const onWheel = (e) => { e.preventDefault(); const { px, py } = toWorld(e); zoomAround(px, py, e.deltaY < 0 ? 1.12 : 0.89); };
    const onDown = (e) => {
      const p = toWorld(e);
      const n = nodeAt(p.wx, p.wy);
      s.down = { px: p.px, py: p.py };
      if (n) { s.drag = n; s.dragMoved = false; n.fixed = true; reheat(0.3); }
      else { s.pan = { px: p.px, py: p.py, camx: s.cam.x, camy: s.cam.y }; }
    };
    const onMove = (e) => {
      // Bound to window (drags must survive leaving the canvas), so guard: a
      // hidden graph must not hit-test every node on every mousemove app-wide.
      if (!activeRef.current) return;
      const p = toWorld(e);
      if (s.drag) { s.drag.x = p.wx; s.drag.y = p.wy; s.drag.vx = 0; s.drag.vy = 0; s.dragMoved = true; reheat(0.25); }
      else if (s.pan) { s.cam.x = s.pan.camx + (p.px - s.pan.px); s.cam.y = s.pan.camy + (p.py - s.pan.py); }
      else { const n = nodeAt(p.wx, p.wy); s.hover = n ? n.id : null; canvas.style.cursor = n ? "pointer" : "grab"; }
      s.dirty = true; // pointer moved → hover/pan/drag may have changed, redraw once
    };
    const onUp = (e) => {
      const p = toWorld(e);
      const moved = s.down && ((p.px - s.down.px) ** 2 + (p.py - s.down.py) ** 2) > 25;
      if (s.drag) { s.drag.fixed = false; if (!moved) onOpenRef.current?.(s.drag.id); }
      else if (!moved) { const n = nodeAt(p.wx, p.wy); if (n) onOpenRef.current?.(n.id); }
      s.drag = null; s.pan = null; s.down = null;
      s.dirty = true;
    };
    const onLeave = () => { s.hover = null; s.drag = null; s.pan = null; s.dirty = true; };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);

    // ---- loop ----
    const step = () => {
      // Screen hidden (keep-alive) → skip physics AND drawing entirely. This
      // was a permanent full-canvas 60fps redraw once the graph had been
      // opened — the app's biggest silent CPU burner.
      if (!activeRef.current) {
        s.raf = requestAnimationFrame(step);
        return;
      }
      const a = s.alpha;
      if (a > 0.01) {
        const N = s.nodes;
        // per-type centroids → gentle clustering into colored islands
        const cen = {}, cnt = {};
        for (const n of N) {
          const t = n.type || "concept";
          (cen[t] = cen[t] || { x: 0, y: 0 }).x += n.x; cen[t].y += n.y; cnt[t] = (cnt[t] || 0) + 1;
        }
        for (const t in cen) { cen[t].x /= cnt[t]; cen[t].y /= cnt[t]; }
        // repulsion + hard collision (no overlaps)
        for (let i = 0; i < N.length; i++) {
          for (let j = i + 1; j < N.length; j++) {
            const dx = N[i].x - N[j].x, dy = N[i].y - N[j].y;
            const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
            const ux = dx / d, uy = dy / d;
            const f = (REP / d2) * a;
            N[i].vx += ux * f; N[i].vy += uy * f; N[j].vx -= ux * f; N[j].vy -= uy * f;
            const minD = N[i].r + N[j].r + COLLIDE;
            if (d < minD) {
              const push = (minD - d) * 0.5;
              N[i].vx += ux * push; N[i].vy += uy * push; N[j].vx -= ux * push; N[j].vy -= uy * push;
            }
          }
        }
        // springs — real [[links]] pull firmly; semantic ones barely (avoids the hairball)
        for (const l of s.links) {
          const rel = l.kind === "related";
          const dx = l.a.x - l.b.x, dy = l.a.y - l.b.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = (rel ? SPRING_REL : SPRING) * (d - (rel ? LEN_REL : LEN)) * a;
          const ux = dx / d, uy = dy / d;
          l.a.vx -= ux * f; l.a.vy -= uy * f; l.b.vx += ux * f; l.b.vy += uy * f;
        }
        for (const n of N) {
          if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
          const c = cen[n.type || "concept"];
          if (c) { n.vx += (c.x - n.x) * CLUSTER * a; n.vy += (c.y - n.y) * CLUSTER * a; }
          n.vx += -CENTER * n.x * a; n.vy += -CENTER * n.y * a;
          n.vx = Math.max(-MAXV, Math.min(MAXV, n.vx * DAMP));
          n.vy = Math.max(-MAXV, Math.min(MAXV, n.vy * DAMP));
          n.x += n.vx; n.y += n.vy;
        }
        s.alpha = a * 0.985;
        if (s.alpha < 0.01) s.alpha = 0;
      }
      // Only repaint when something actually changed: physics still settling
      // (a > 0.01), or an interaction flagged a redraw (hover/pan/zoom/drag/
      // resize). Once the layout settles and the pointer is idle this stops
      // drawing every frame — it used to repaint the whole canvas at 60fps
      // forever while the graph was visible (the app's biggest CPU burner).
      if (a > 0.01 || s.dirty) {
        draw();
        s.dirty = false;
      }
      s.raf = requestAnimationFrame(step);
    };

    const draw = () => {
      ctx.clearRect(0, 0, s.w, s.h);
      const { x: cx, y: cy, scale } = s.cam;
      const hov = s.hover, nb = hov ? s.adj.get(hov) : null;
      // edges — real links solid; suggested links faint/dashed (and hideable + hidden when zoomed out)
      for (const l of s.links) {
        const rel = l.kind === "related";
        const active = hov && (l.a.id === hov || l.b.id === hov);
        if (rel && !s.showRel && !active) continue;
        if (rel && !active && scale < 0.55) continue; // drop the faint mesh when zoomed out
        ctx.beginPath();
        ctx.moveTo(l.a.x * scale + cx, l.a.y * scale + cy);
        ctx.lineTo(l.b.x * scale + cx, l.b.y * scale + cy);
        ctx.strokeStyle = active ? theme.edgeActive : rel ? theme.edgeRel : theme.edge;
        ctx.globalAlpha = hov && !active ? 0.05 : rel ? 0.16 : 0.4;
        ctx.lineWidth = active ? 1.8 : rel ? 0.6 : 0.9;
        if (rel) ctx.setLineDash([2, 4]); else ctx.setLineDash([]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // nodes
      for (const n of s.nodes) {
        const sx = n.x * scale + cx, sy = n.y * scale + cy;
        const r = Math.max(2.5, n.r * scale);
        const isSel = selRef.current === n.id, isHot = hov === n.id || isSel;
        const neighbor = nb && nb.has(n.id);
        const dim = hov && !(hov === n.id || neighbor);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 6.2832);
        ctx.fillStyle = TYPE_COLOR[n.type] || TYPE_COLOR.concept;
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.fill();
        ctx.lineWidth = isSel ? 2.5 : 1.2;
        ctx.strokeStyle = isSel ? theme.nodeStrokeSel : theme.nodeStroke;
        ctx.stroke();
        ctx.globalAlpha = 1;
        // labels only where they won't overlap: hovered node + its neighbours, or
        // (when nothing is hovered) the bigger hubs once zoomed in a little.
        const showLabel = !dim && (isHot || neighbor || (!hov && scale > 1.0 && n.deg >= 5));
        if (showLabel) {
          ctx.font = `${isHot ? "600 " : ""}${isHot ? 13 : 11}px Inter Tight, sans-serif`;
          ctx.fillStyle = isHot ? theme.labelHot : theme.label;
          const t = n.label.length > 28 ? n.label.slice(0, 28) + "…" : n.label;
          ctx.fillText(t, sx + r + 4, sy + 4);
        }
      }
    };

    s.raf = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(s.raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" style={{ cursor: "grab" }} />

      {/* title + reading of the map */}
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2.5 rounded-xl border border-line bg-surface/90 px-3.5 py-2 shadow-card backdrop-blur">
        <GraphIcon size={16} weight="fill" className="text-brand" />
        {meta.loading ? (
          <span className="inline-flex items-center gap-2 text-[12.5px] text-muted"><CircleNotch size={13} className="animate-spin" /> Wiring the graph…</span>
        ) : meta.error ? (
          <span className="text-[12.5px] text-warn">Couldn't load the graph — Jarvis may be starting up. Switch to Notes and back to retry.</span>
        ) : (
          <span className="text-[12.5px] text-muted">
            <span className="font-semibold text-ink">{meta.nodes}</span> notes ·{" "}
            <span className="font-semibold text-ink">{meta.links}</span> connections
            <span className="ml-2 hidden text-faint sm:inline">hover to focus · scroll to zoom · drag to explore</span>
          </span>
        )}
      </div>

      {/* suggested-links toggle */}
      {!meta.loading && (
        <button
          onClick={() => setShowRel((v) => !v)}
          title="Faint dashed links are AI-suggested (by meaning). Toggle them off for a cleaner map."
          className={`absolute left-4 top-[58px] rounded-lg border px-2.5 py-1.5 text-[12px] font-medium shadow-card backdrop-blur transition-colors active:scale-[0.97] ${
            showRel
              ? "border-brand/40 bg-brand-soft text-brand"
              : "border-line-strong bg-surface/90 text-muted hover:text-ink-2"
          }`}
        >
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: showRel ? "var(--color-brand)" : "var(--color-faint)" }} />
          Suggested links {showRel ? "on" : "off"}
        </button>
      )}

      {/* type legend with counts */}
      {!meta.loading && meta.types?.length > 0 && (
        <div className="absolute bottom-4 left-4 rounded-xl border border-line bg-surface/90 px-3 py-2.5 shadow-card backdrop-blur">
          <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-faint">Legend</div>
          <div className="flex flex-col gap-1">
            {meta.types.map((t) => (
              <span key={t} className="flex items-center gap-2 text-[11.5px] text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[t] || TYPE_COLOR.concept }} />
                <span className="capitalize">{t}</span>
                {meta.counts?.[t] != null && <span className="ml-auto pl-2 font-mono text-[10px] text-faint">{meta.counts[t]}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
        <GBtn onClick={zoomIn} title="Zoom in"><Plus size={16} weight="bold" /></GBtn>
        <GBtn onClick={zoomOut} title="Zoom out"><Minus size={16} weight="bold" /></GBtn>
        <GBtn onClick={reset} title="Reset view"><ArrowsClockwise size={15} weight="bold" /></GBtn>
      </div>
    </div>
  );
}

function GBtn({ children, ...props }) {
  return (
    <button {...props} className="grid h-9 w-9 place-items-center rounded-lg border border-line-strong bg-surface text-muted shadow-card transition hover:border-brand hover:text-brand">
      {children}
    </button>
  );
}
