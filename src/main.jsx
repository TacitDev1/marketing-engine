import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { DEMO } from "./lib/demo.js";

// "?render=<job>" is the bare page the server's own headless Chrome opens to
// draw an image nobody is watching (src/render/RenderJob.jsx). Everything else
// is the app.
const renderJob = new URLSearchParams(window.location.search).get("render");
const root = ReactDOM.createRoot(document.getElementById("root"));

async function start() {
  // The static demo answers /api/* from recorded sample data.
  if (DEMO) (await import("./demo/mock-api.js")).installMockApi();
  if (renderJob && !DEMO) {
    const { default: RenderJob } = await import("./render/RenderJob.jsx");
    root.render(<RenderJob jobId={renderJob} />);
    return;
  }
  const { default: App } = await import("./App.jsx");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
start();
