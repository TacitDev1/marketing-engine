// Marketing Engine brain server — routes: The Librarian.
// Registered from server/index.js via registerLibrarianRoutes(app).

import { runLibrarian } from "../librarian.js";
import { addActivity, getLibrarianState, setLibrarianState } from "../stores.js";
import { nowISO } from "./shared.js";

export function registerLibrarianRoutes(app) {
  // ---------- The Librarian (standalone wiki-maintenance agent) ----------
  // Runs on its own 6-hour schedule (see librarian.js) so the wiki stays tidy
  // even with the Worker off. These endpoints let the UI see and steer it.

  app.get("/api/librarian", (_req, res) => res.json(getLibrarianState()));

  // Kick off a pass now. Long-running (model calls), so it runs in the background
  // and the UI polls GET /api/librarian for the result.
  app.post("/api/librarian/run", (_req, res) => {
    if (getLibrarianState().running) return res.status(409).json({ error: "already_running" });
    runLibrarian(nowISO(), { force: true }).catch((err) => console.error("librarian manual run failed:", err.message));
    res.json({ ok: true, started: true });
  });

  app.post("/api/librarian/toggle", (req, res) => {
    const enabled = !!req.body?.enabled;
    setLibrarianState({ enabled });
    addActivity({ actor: "librarian", event: "librarian.toggled", summary: enabled ? "turned ON" : "turned OFF" }, nowISO());
    res.json(getLibrarianState());
  });
}
