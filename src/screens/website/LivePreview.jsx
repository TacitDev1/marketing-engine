import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowSquareOut,
  CircleNotch,
  MonitorPlay,
  Play,
  Stop,
  ArrowClockwise,
  Monitor,
  DeviceTablet,
  DeviceMobile,
  ArrowsOut,
  ArrowsIn,
  Warning,
} from "@phosphor-icons/react";
import { Card, Button } from "../../components/ui.jsx";
import PageNav from "./PageNav.jsx";

// A few favourites pinned as one-tap quick-links; the full list comes from
// /api/website/routes (every page in the site's sitemap).
const QUICK_LINKS = [
  { label: "Home", path: "/" },
  { label: "Services", path: "/services/plant-maintenance" },
  { label: "Industries", path: "/industries/waste-management" },
  { label: "News", path: "/news" },
  { label: "About", path: "/about" },
  { label: "Contact", path: "/contact" },
];

const DEVICES = [
  { id: "desktop", label: "Desktop", icon: Monitor, width: null },
  { id: "tablet", label: "Tablet", icon: DeviceTablet, width: 834 },
  { id: "mobile", label: "Mobile", icon: DeviceMobile, width: 390 },
];

export default function LivePreview({ active = true }) {
  const [status, setStatus] = useState(null);
  const [path, setPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [iframeKey, setIframeKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [startErr, setStartErr] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [navOpen, setNavOpen] = useState(false);
  const [device, setDevice] = useState("desktop");
  const [fs, setFs] = useState(false);
  const cardRef = useRef(null);

  const poll = useCallback(() => {
    fetch("/api/website/preview/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Poll only while the Website screen is visible (keep-alive keeps it mounted).
    if (!active) return;
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [poll, active]);

  useEffect(() => {
    fetch("/api/website/routes")
      .then((r) => r.json())
      .then((d) => setRoutes(d.routes || []))
      .catch(() => setRoutes([]));
  }, []);

  // keep our fullscreen flag in sync with the browser (Esc exits)
  useEffect(() => {
    const onFs = () => setFs(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const running = !!status?.running;
  const starting = !!status?.starting || busy;
  // publicUrl is what THIS browser can reach; on the server it is null unless
  // SITE_PREVIEW_PUBLIC_URL is set (status.url is the server's own localhost).
  const unreachablePreview = !!status && status.publicUrl === null;
  const base = status?.publicUrl || status?.url || "http://localhost:4322";
  const src = `${base}${path}`;
  const dev = DEVICES.find((d) => d.id === device) || DEVICES[0];

  async function start() {
    setBusy(true);
    setStartErr(null);
    try {
      const res = await fetch("/api/website/preview/start", { method: "POST" });
      if (!res.ok) {
        // Don't leave the button silently snapping back to "Start preview" — say why.
        const e = await res.json().catch(() => ({}));
        setStartErr(e.message || e.error || "Couldn't start the preview server. Try again in a moment.");
      }
    } catch {
      setStartErr("Couldn't reach the preview server. Is Jarvis running?");
    } finally {
      setBusy(false);
      poll();
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await fetch("/api/website/preview/stop", { method: "POST" });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      poll();
    }
  }

  function go(p) {
    const np = p.startsWith("/") ? p : "/" + p;
    setPath(np);
    setPathInput(np);
    setIframeKey((k) => k + 1);
    setNavOpen(false);
  }

  function toggleFullscreen() {
    const el = cardRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <MonitorPlay size={18} weight="bold" className="text-brand" />
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">Live preview</h2>
        <ServerStatusDot running={running} starting={starting} />
      </div>
      <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-muted">
        The real, rendered company-website running locally — every page. Jump to any page,
        check it on desktop / tablet / mobile, or go fullscreen. Then tell me what to
        change. Blogs you push below show up here.
      </p>

      {startErr && <p className="mb-4 text-[13px] text-warn">{startErr}</p>}

      <Card ref={cardRef} className="flex flex-col overflow-hidden bg-surface">
        {/* browser-style toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-3 py-2">
          {running ? (
            <Button variant="ghost" onClick={stop} disabled={busy || !status?.managed}
              title={status?.managed ? "Stop the preview server" : "Running in your terminal — stop it there"}>
              <Stop size={14} weight="fill" /> Stop
            </Button>
          ) : (
            <Button variant="outline" onClick={start} disabled={starting}>
              {starting ? <CircleNotch size={14} className="animate-spin" /> : <Play size={14} weight="fill" />}
              {starting ? "Starting…" : "Start preview"}
            </Button>
          )}

          {/* All-pages navigator */}
          <PageNav routes={routes} current={path} onPick={go} open={navOpen} setOpen={setNavOpen} />

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <form
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1"
              onSubmit={(e) => {
                e.preventDefault();
                go(pathInput || "/");
              }}
            >
              <span className="shrink-0 text-[12px] text-faint">{base.replace(/^https?:\/\//, "")}</span>
              <input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                spellCheck={false}
                placeholder="/news"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
              />
            </form>

            {/* device sizes */}
            <div className="flex shrink-0 overflow-hidden rounded-md border border-line-strong">
              {DEVICES.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDevice(d.id)}
                  title={d.label}
                  className={`grid h-8 w-8 place-items-center transition ${
                    device === d.id ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  <d.icon size={15} weight={device === d.id ? "fill" : "regular"} />
                </button>
              ))}
            </div>

            <button
              onClick={() => setIframeKey((k) => k + 1)}
              disabled={!running}
              title="Reload"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-ink disabled:opacity-40"
            >
              <ArrowClockwise size={15} weight="bold" />
            </button>
            <button
              onClick={toggleFullscreen}
              disabled={!running}
              title={fs ? "Exit fullscreen" : "Fullscreen"}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-ink disabled:opacity-40"
            >
              {fs ? <ArrowsIn size={15} weight="bold" /> : <ArrowsOut size={15} weight="bold" />}
            </button>
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              title="Open in a new tab"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-ink ${running ? "" : "pointer-events-none opacity-40"}`}
            >
              <ArrowSquareOut size={15} weight="bold" />
            </a>
          </div>
        </div>

        {/* quick links */}
        {running && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
            {QUICK_LINKS.map((l) => (
              <button
                key={l.path}
                onClick={() => go(l.path)}
                className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition ${
                  path === l.path
                    ? "bg-brand-soft text-brand"
                    : "text-muted hover:bg-canvas hover:text-ink"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}

        {/* the preview itself */}
        {running ? (
          <div className={`flex flex-col ${fs ? "flex-1" : ""}`}>
            {unreachablePreview && (
              <p className="mx-4 mt-3 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
                The preview runs on the server and isn't reachable from your browser. Set SITE_PREVIEW_PUBLIC_URL on the server (e.g. a path on the server's HTTPS proxy) to see it here; the the site host live-preview branch is the other option.
              </p>
            )}
          <div
            className={`flex justify-center overflow-auto bg-canvas ${fs ? "flex-1" : "h-[74vh]"}`}
          >
            <iframe
              key={iframeKey}
              src={src}
              title="Larkwell website preview"
              className="h-full w-full border-0 bg-white shadow-card transition-all"
              style={dev.width ? { maxWidth: dev.width } : undefined}
            />
          </div>
          </div>
        ) : (
          <div className="flex h-[40vh] flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
            <MonitorPlay size={32} className="text-faint" weight="duotone" />
            {status?.portBusyByOther ? (
              <p className="max-w-md text-[14px] leading-relaxed text-warn">
                <Warning size={15} weight="fill" className="mr-1 inline align-[-2px]" />
                Another app is running on port {status.port} and it is{" "}
                <span className="font-semibold">not the Larkwell site</span> — refusing to show it
                here. Stop that app (or move it off the port), then start the preview.
              </p>
            ) : (
              <p className="max-w-md text-[14px] leading-relaxed text-muted">
                The preview server isn't running. Hit{" "}
                <span className="font-medium text-ink">Start preview</span> and I'll
                launch the Astro site locally so you can browse it right here.
              </p>
            )}
            {starting && status?.log?.length > 0 && (
              <pre className="scroll-quiet mt-1 max-h-28 w-full max-w-md overflow-auto rounded-md bg-surface px-3 py-2 text-left text-[11px] leading-relaxed text-faint">
                {status.log.join("\n")}
              </pre>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

function ServerStatusDot({ running, starting }) {
  const cfg = starting
    ? { dot: "bg-warn", text: "Starting…", color: "text-warn" }
    : running
      ? { dot: "bg-good", text: "Live", color: "text-good" }
      : { dot: "bg-faint", text: "Stopped", color: "text-faint" };
  return (
    <span className={`ml-1 inline-flex items-center gap-1.5 text-[12px] font-medium ${cfg.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${running && !starting ? "animate-pulse" : ""}`} />
      {cfg.text}
    </span>
  );
}
