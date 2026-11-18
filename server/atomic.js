// Crash-safe JSON persistence. The old code wrote JSON straight onto the live
// file, so a crash or power-loss mid-write could leave a half-written,
// unparseable file — and because load() falls back to an empty default on a
// parse error, the NEXT save would then overwrite it with nothing. One bad
// moment could wipe every draft.
//
// writeJsonAtomic writes to a temp file first, then renames it over the target.
// rename() is atomic on the same volume: the target is only ever the old
// (good) file or the new (complete) file — never a half-written one.
//
// `backup: true` also keeps a .bak copy of the last good file (used for
// drafts.json), and readJsonSafe can fall back to that .bak if the main file
// is ever unreadable.

import fs from "node:fs";
import path from "node:path";

export function writeJsonAtomic(file, value, { backup = false, pretty = true } = {}) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (backup && fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, file + ".bak");
    } catch {
      /* a failed backup must never block the actual save */
    }
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
  fs.renameSync(tmp, file);
  return value;
}

// Read + parse JSON, returning `fallback` if the file is missing/unreadable.
// If `backup` is set and the main file is corrupt, try the .bak before giving
// up — so a rare bad file restores the last good copy instead of losing data.
export function readJsonSafe(file, fallback, { backup = false } = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    if (backup) {
      try {
        return JSON.parse(fs.readFileSync(file + ".bak", "utf8"));
      } catch {
        /* fall through to fallback */
      }
    }
    return typeof fallback === "function" ? fallback() : fallback;
  }
}
