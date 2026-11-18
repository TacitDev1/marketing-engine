// Demo mode: `npm run build:demo` builds a static copy of the app that runs on
// sample data with no server (src/demo/mock-api.js). Every screen shows.
export const DEMO = import.meta.env.VITE_DEMO === "1";

// Sample outputs the mock API carries ({ linkedin: [...], blogs: [...] }), so a
// screen that drafts on request can open with one on show instead of empty.
export function demoSamples(kind) {
  if (!DEMO || typeof window === "undefined") return [];
  return window.__DEMO_SAMPLES__?.[kind] || [];
}
