// Demo mode: `npm run build:demo` builds a static copy of the app that runs on
// sample data with no server (src/demo/mock-api.js). Only these screens show.
export const DEMO = import.meta.env.VITE_DEMO === "1";
export const DEMO_SCREENS = new Set(["jarvis", "library", "schedule", "wiki", "competitors", "images"]);
export const showScreen = (id) => !DEMO || DEMO_SCREENS.has(id);
