// List the Ollama models installed on this machine, and download new ones with
// live progress. On a bigger GPU server this is how Tobias pulls a bigger model
// (e.g. llama3.1:70b) and then picks it in Settings. Local only.

import { ollamaBase } from "./settings.js";

// What's installed right now (for the model dropdown).
export async function listModels() {
  const res = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = await res.json();
  return (data.models || [])
    .map((m) => ({
      name: m.name || m.model || "",
      size: m.size || 0,
      family: m.details?.family || "",
      param: m.details?.parameter_size || "",
      quant: m.details?.quantization_level || "",
    }))
    .filter((m) => m.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A single in-flight pull, tracked in memory and polled by the UI.
let pull = { active: false, name: "", status: "idle", percent: 0, error: "", done: false };

export function getPullStatus() {
  return pull;
}

export function startPull(name) {
  if (pull.active) throw new Error("A model download is already in progress.");
  const clean = String(name || "").trim();
  if (!clean || !/^[a-zA-Z0-9._:/-]+$/.test(clean)) throw new Error("Enter a valid model name, e.g. llama3.1:70b");
  pull = { active: true, name: clean, status: "starting", percent: 0, error: "", done: false };

  // Fire-and-forget: stream Ollama's NDJSON progress into `pull`.
  // Inactivity watchdog: a connection that dies without RST would stall the
  // stream forever, leaving pull.active=true and blocking every future
  // download until a brain restart. No progress for 3 minutes = abort.
  (async () => {
    const ctrl = new AbortController();
    let watchdog = setTimeout(() => ctrl.abort(), 180000);
    const kick = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => ctrl.abort(), 180000);
    };
    try {
      const res = await fetch(`${ollamaBase()}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: clean, stream: true }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Ollama /api/pull returned ${res.status}`);
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of res.body) {
        kick();
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let j;
          try { j = JSON.parse(line); } catch { continue; }
          if (j.error) { pull = { active: false, name: clean, status: "error", percent: pull.percent, error: j.error, done: true }; return; }
          const percent = j.total && j.completed != null ? Math.round((j.completed / j.total) * 100) : pull.percent;
          pull = { active: true, name: clean, status: j.status || pull.status, percent, error: "", done: false };
        }
      }
      pull = { active: false, name: clean, status: "success", percent: 100, error: "", done: true };
    } catch (e) {
      const msg = ctrl.signal.aborted ? "Download stalled (no progress for 3 minutes) — try again." : e.message;
      pull = { active: false, name: clean, status: "error", percent: pull.percent, error: msg, done: true };
    } finally {
      clearTimeout(watchdog);
    }
  })();
}
