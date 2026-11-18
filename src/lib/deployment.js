import { useEffect, useState } from "react";

// Where is this app running? The brain answers once (/api/deployment) and every
// screen reads it from here, so copy like "on this PC" vs "on Larkwell's private
// server" is true wherever the app is opened. Fetched once per page load.
let cached = null;
let inflight = null;
const FALLBACK = { mode: "local", label: "Running locally on this PC" };

export function fetchDeployment() {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch("/api/deployment")
      .then((r) => (r.ok ? r.json() : FALLBACK))
      .then((d) => (cached = { ...FALLBACK, ...d }))
      .catch(() => FALLBACK)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useDeployment() {
  const [dep, setDep] = useState(cached || FALLBACK);
  useEffect(() => {
    let live = true;
    fetchDeployment().then((d) => live && setDep(d));
    return () => { live = false; };
  }, []);
  return dep;
}

// Short phrases for the copy that used to say "this machine".
export function placeWords(dep) {
  const server = dep?.mode === "server";
  return {
    server,
    here: server ? "Larkwell's private server" : "this PC",
    onHere: server ? "on Larkwell's private server" : "on this PC",
    staysHere: server ? "stays on Larkwell's private server" : "stays on this PC",
  };
}
