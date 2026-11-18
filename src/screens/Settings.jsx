import { useEffect, useRef, useState } from "react";
import { useDeployment, placeWords } from "../lib/deployment.js";
import {
  Gear,
  DownloadSimple,
  CheckCircle,
  X,
  ArrowsClockwise,
  Warning,
  CaretRight,
  CaretDown,
} from "@phosphor-icons/react";
import { Button, Card, Eyebrow, Select } from "../components/ui.jsx";

// Turn a model-name list into Select options, guaranteeing the current
// value is present so the control never shows a blank.
const modelOpts = (names, current) => {
  const all = names.includes(current) || !current ? names : [current, ...names];
  return all.map((n) => ({ value: n, label: n }));
};

const inputCls =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink-2 focus-visible:outline-2 focus-visible:outline-brand";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium uppercase tracking-wide text-faint">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function prettyBytes(n) {
  if (!n) return "";
  const gb = n / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

export default function Settings() {
  const dep = useDeployment();
  const place = placeWords(dep);
  const [s, setS] = useState(null); // settings
  const [models, setModels] = useState([]);
  const [modelsErr, setModelsErr] = useState("");
  const [cadenceMin, setCadenceMin] = useState(10);
  const [dailyCap, setDailyCap] = useState(4);
  // The two fields above start at UI defaults. We must only push them back to
  // the server if we actually loaded the real schedule, or the user changed
  // them — otherwise Save would silently overwrite the true cadence/cap with
  // the defaults whenever the status fetch failed (e.g. Jarvis still starting).
  const [cadenceTouched, setCadenceTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [pullName, setPullName] = useState("");
  const [pull, setPull] = useState(null); // {active, name, status, percent, error, done}
  const pollRef = useRef(null);

  async function loadModels() {
    try {
      const r = await fetch("/api/models");
      const d = await r.json();
      setModels(d.models || []);
      setModelsErr(d.error ? d.message || "Ollama unreachable" : "");
    } catch {
      setModelsErr("Couldn't reach Ollama.");
    }
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setS(d);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
    fetch("/api/autopilot/status")
      .then((r) => r.json())
      .then((a) => {
        if (a.cadenceMs) setCadenceMin(Math.round(a.cadenceMs / 60000));
        if (a.dailyDraftCap != null) setDailyCap(a.dailyDraftCap);
      })
      .catch(() => {});
    loadModels();
    return () => clearInterval(pollRef.current);
  }, []);

  const set = (k, v) => setS((prev) => ({ ...prev, [k]: v }));

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      // Clamp the numeric knobs — a cleared field yields NaN/0 which the min=
      // attribute doesn't enforce and which would poison generation.
      const t = Number(s.temperature);
      const payload = {
        ...s,
        numCtx: Math.max(512, Number(s.numCtx) || 4096),
        numPredict: Math.max(64, Number(s.numPredict) || 1024),
        temperature: Math.min(2, Math.max(0, Number.isFinite(t) ? t : 0.7)),
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`server ${res.status}`);
      const next = await res.json();
      setS(next);
      // Only touch the autopilot schedule if we hold real values (loaded from
      // the server, or edited here) — never blindly re-post the UI defaults.
      // Only when the cadence fields were actually edited: re-posting the same
      // values restarts the Worker's interval and delays its next tick.
      if (cadenceTouched) {
        const cad = await fetch("/api/autopilot/cadence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cadenceMs: Math.max(1, cadenceMin) * 60000, dailyDraftCap: Math.max(0, dailyCap) }),
        });
        if (!cad.ok) throw new Error(`server ${cad.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch {
      setSaveError("Couldn't save just now. Jarvis may be starting up, try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  function startPull() {
    const name = pullName.trim();
    if (!name) return;
    fetch("/api/models/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json())
      .then((p) => {
        if (p.error) { setPull({ done: true, error: p.message }); return; }
        setPull(p);
        clearInterval(pollRef.current);
        // Failures counted: an unguarded await here used to throw every tick
        // during a brain restart, freeze the progress bar, and hammer a dead
        // server forever (screens stay mounted, so unmount cleanup never runs).
        let pollFails = 0;
        pollRef.current = setInterval(async () => {
          try {
            const st = await (await fetch("/api/models/pull")).json();
            pollFails = 0;
            setPull(st);
            if (st.done || !st.active) {
              clearInterval(pollRef.current);
              loadModels();
              if (st.status === "success") setPullName("");
            }
          } catch {
            pollFails += 1;
            if (pollFails >= 10) {
              clearInterval(pollRef.current);
              setPull({ done: true, error: "Lost contact with Jarvis during the download. It may still be running — reload to check." });
            }
          }
        }, 1200);
      })
      .catch(() => setPull({ done: true, error: "Couldn't start the download." }));
  }

  if (!s) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10 text-sm text-muted">
        {loadError ? (
          <Card className="p-6">
            <p className="text-[14px] text-ink">
              <span className="font-medium">Jarvis is starting up.</span> Settings will load
              once it's ready.
            </p>
            <p className="mt-1.5 text-[13px] text-muted">Give it a moment, then reload.</p>
            <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
              <ArrowsClockwise size={15} /> Reload
            </Button>
          </Card>
        ) : (
          <>
            <ArrowsClockwise size={16} className="mr-2 inline animate-spin" /> Loading settings…
          </>
        )}
      </div>
    );
  }

  // Make sure the currently-selected models are always options, even if not (yet) installed.
  const modelNames = models.map((m) => m.name);
  const isInstalled = (name) => !name || modelNames.includes(name) || modelNames.includes(`${name}:latest`);
  const missingModels = [...new Set([s.textModel, s.qualityModel, s.embedModel])].filter((n) => n && !isInstalled(n));
  const textOptions = [...new Set([s.textModel, ...modelNames])];
  const embedOptions = [...new Set([s.embedModel, ...modelNames])];

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <Eyebrow>Settings</Eyebrow>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
            <Gear size={22} weight="fill" className="text-brand" /> Jarvis settings
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            How Jarvis writes. For everyday use there's nothing to change here. The
            technical options live under Advanced.
          </p>
        </div>
      </header>

      <div className="space-y-6">
        <Card className="p-6">
          <p className="text-[14px] leading-relaxed text-ink-2">
            Jarvis writes with a local model {place.onHere}. Nothing here needs changing
            for day-to-day work.
          </p>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className="mt-3 inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {advancedOpen ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
            Advanced settings (for administrators)
          </button>
        </Card>

        {advancedOpen && (
        <>
        {/* Model */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <Eyebrow>Model</Eyebrow>
            <Button variant="outline" onClick={loadModels} className="shrink-0">
              <ArrowsClockwise size={15} /> Refresh
            </Button>
          </div>
          {modelsErr && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-warn">
              <Warning size={14} /> {modelsErr}. You can still type a model name.
            </p>
          )}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Text model" hint={s.qualityModel ? "plumbing: classifying, topics, checks" : "drives all drafts"}>
              <Select
                value={s.textModel}
                onChange={(v) => set("textModel", v)}
                searchable
                placeholder="Choose a model"
                options={modelOpts(textOptions, s.textModel)}
              />
            </Field>
            <Field label="Embedding model" hint="powers search / grounding">
              <Select
                value={s.embedModel}
                onChange={(v) => set("embedModel", v)}
                searchable
                placeholder="Choose a model"
                options={modelOpts(embedOptions, s.embedModel)}
              />
            </Field>
            <Field label="Quality model" hint="optional — big model for the writing">
              <Select
                value={s.qualityModel || ""}
                onChange={(v) => set("qualityModel", v)}
                searchable
                placeholder="Same as text model"
                options={[
                  { value: "", label: "Same as text model (off)" },
                  ...modelOpts(modelNames, s.qualityModel).filter((o) => o.value),
                ]}
              />
            </Field>
          </div>
          {models.length > 0 && missingModels.length > 0 && (
            <p className="mt-3 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-warn">
              Not installed on this Ollama: <span className="font-mono">{missingModels.join(", ")}</span>. Every call that
              needs {missingModels.length > 1 ? "them" : "it"} fails as "brain unavailable" until you download
              {missingModels.length > 1 ? " them" : " it"} below or pick an installed model.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            When set, drafts, blogs, revisions, SEO briefs, recommendations and wiki merges
            run on the quality model; quick classification stays on the text model. Leave
            off to use the text model for everything.
          </p>
          {models.length > 0 && (
            <p className="mt-2 text-[11px] text-faint">
              Installed: {models.map((m) => `${m.name}${m.size ? ` (${prettyBytes(m.size)})` : ""}`).join(" · ")}
            </p>
          )}

          {/* Downloader */}
          <div className="mt-5 border-t border-line pt-4">
            <Field label="Download a model" hint="runs on the Ollama box">
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="e.g. gemma4:12b, qwen3.5:9b"
                  value={pullName}
                  onChange={(e) => setPullName(e.target.value)}
                  disabled={pull?.active}
                />
                <Button onClick={startPull} disabled={!pullName.trim() || pull?.active} className="shrink-0">
                  <DownloadSimple size={16} /> {pull?.active ? "Downloading…" : "Download"}
                </Button>
              </div>
            </Field>
            {pull && (
              <div className="mt-2 text-[12px]">
                {pull.error ? (
                  <p className="flex items-center gap-1.5 text-crit"><X size={14} /> {pull.error}</p>
                ) : pull.status === "success" ? (
                  <p className="flex items-center gap-1.5 text-good"><CheckCircle size={14} weight="fill" /> {pull.name} ready — pick it above.</p>
                ) : (
                  <div>
                    <div className="mb-1 flex justify-between text-faint">
                      <span>{pull.name} · {pull.status}</span>
                      <span>{pull.percent}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
                      <div className="h-full bg-brand transition-all" style={{ width: `${pull.percent}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              Bigger models (70B+) need a lot of VRAM, great on a GPU server, too heavy for a
              laptop. The download runs on whatever machine Ollama is on.
            </p>
          </div>
        </Card>

        {/* Generation */}
        <Card className="p-6">
          <Eyebrow>Generation</Eyebrow>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label="Context window" hint="tokens">
              <input type="number" min={512} max={131072} step={512} className={inputCls}
                value={s.numCtx} onChange={(e) => set("numCtx", Number(e.target.value))} />
            </Field>
            <Field label="Max output" hint="tokens">
              <input type="number" min={64} max={8192} step={64} className={inputCls}
                value={s.numPredict} onChange={(e) => set("numPredict", Number(e.target.value))} />
            </Field>
            <Field label="Temperature" hint="0–2">
              <input type="number" min={0} max={2} step={0.05} className={inputCls}
                value={s.temperature} onChange={(e) => set("temperature", Number(e.target.value))} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Keep model loaded" hint="e.g. 60s, 5m, -1 for always">
              <input className={inputCls} value={s.keepAlive} onChange={(e) => set("keepAlive", e.target.value)} />
            </Field>
            <p className="mt-1.5 text-[11px] text-faint">
              Longer = faster repeat drafts but holds RAM/VRAM. Shorter = frees memory between runs.
            </p>
          </div>
        </Card>

        {/* Auto-drafting */}
        <Card className="p-6">
          <Eyebrow>Auto-drafting</Eyebrow>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Run every" hint="minutes">
              <input type="number" min={1} max={1440} className={inputCls}
                value={cadenceMin} onChange={(e) => { setCadenceTouched(true); setCadenceMin(Number(e.target.value)); }} />
            </Field>
            <Field label="Daily draft cap" hint="0 = pause drafting">
              <input type="number" min={0} max={200} className={inputCls}
                value={dailyCap} onChange={(e) => { setCadenceTouched(true); setDailyCap(Number(e.target.value)); }} />
            </Field>
          </div>
        </Card>

        {/* Ollama connection */}
        <Card className="p-6">
          <Eyebrow>Ollama connection</Eyebrow>
          <div className="mt-3">
            <Field label="Ollama host" hint={place.server ? "locked by the server's environment" : "point at a separate GPU box if needed"}>
              <input className={`${inputCls} font-mono`} value={s.ollamaHost} disabled={place.server} onChange={(e) => set("ollamaHost", e.target.value)} />
            </Field>
            <p className="mt-1.5 text-[11px] text-faint">
              {place.server
                ? "On the shared server the model host is fixed by its environment (OLLAMA_HOST), so nobody on the network can redirect prompts. Change it in the server's .env."
                : "Default is this machine (127.0.0.1:11434). You could run Ollama on a separate GPU box and point the app here."}
            </p>
          </div>
        </Card>
        </>
        )}

        {advancedOpen && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saved ? <><CheckCircle size={16} weight="fill" /> Saved</> : saving ? "Saving…" : "Save settings"}
          </Button>
          <span className="text-[12px] text-faint">Applies to the next draft, no restart needed.</span>
          {saveError && <span className="text-[12px] text-crit">{saveError}</span>}
        </div>
        )}
      </div>
    </div>
  );
}
