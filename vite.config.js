import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `vite` / `vite build`: the real app, talking to the brain on :8787.
// `vite build --mode demo`: a static demo on sample data (src/demo/), served
// from a sub-path such as GitHub Pages' /marketing-engine/ (DEMO_BASE overrides).
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    base: demo ? process.env.DEMO_BASE || "/marketing-engine/" : "/",
    define: { "import.meta.env.VITE_DEMO": JSON.stringify(demo ? "1" : "") },
    plugins: [react(), tailwindcss()],
    server: {
      port: 5180,
      open: false,
      // The React app calls /api/* — proxy that to the local brain server.
      proxy: demo ? undefined : { "/api": "http://127.0.0.1:8787" },
    },
    build: {
      outDir: demo ? "dist-demo" : "dist",
      rollupOptions: {
        output: {
          // Split stable vendors into their own chunks so a one-line app change
          // doesn't bust the whole cache. (Three.js is lazy-loaded in Images.jsx.)
          manualChunks: {
            react: ["react", "react-dom"],
            icons: ["@phosphor-icons/react"],
          },
        },
      },
    },
  };
});
