import { useState, useRef } from "react";
import { CircleNotch, UploadSimple } from "@phosphor-icons/react";
import { Button } from "../../components/ui.jsx";


// Upload drafts from the local computer (.md / .txt) straight into the Library.
// Parsing happens in the browser; each file becomes a normal draft record via
// the existing POST /api/drafts — no new backend surface.
const slugifyTitle = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function parseUploadedFile(name, text, kind) {
  let body = String(text || "").replace(/\r\n/g, "\n").trim();
  let title = "";
  let description = "";
  let slug = "";
  // Markdown front-matter, if the file has it.
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = body.slice(fm[0].length).trim();
    for (const line of fm[1].split("\n")) {
      const kv = line.match(/^([\w-]+):\s*(.*)$/);
      if (!kv) continue;
      const val = kv[2].trim().replace(/^["']|["']$/g, "");
      if (kv[1] === "title") title = val;
      else if (kv[1] === "description") description = val;
      else if (kv[1] === "slug") slug = val;
    }
  }
  // A leading `# heading` (first non-empty line only) becomes the title, else
  // the file name. Anchored to the first line so a mid-document `# Section`
  // isn't yanked out and lost.
  if (!title) {
    const lines = body.split("\n");
    const idx = lines.findIndex((l) => l.trim());
    const h = idx >= 0 && lines[idx].match(/^#\s+(.+)$/);
    if (h) {
      title = h[1].trim();
      lines.splice(idx, 1);
      body = lines.join("\n").trim();
    }
  }
  if (!title) title = name.replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]+/g, " ").trim();

  if (kind === "linkedin") {
    // First non-empty line is the hook, the rest is the post.
    const lines = body.split("\n");
    const hookIdx = lines.findIndex((l) => l.trim());
    const hook = hookIdx >= 0 ? lines[hookIdx].trim().replace(/^#+\s*/, "") : title;
    const rest = lines.slice(hookIdx + 1).join("\n").trim();
    // `rest` may be empty for a one-line file — falling back to the full text
    // rendered the same sentence as both hook AND body.
    return { hook, body: rest, hashtags: [], origin: "upload" };
  }
  return {
    title,
    metaDescription: description,
    slug: slug || slugifyTitle(title),
    keyword: "",
    body,
    origin: "upload",
  };
}

export function UploadDrafts({ onUploaded, className = "" }) {
  const inputRef = useRef(null);
  const [kind, setKind] = useState("blog");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { tone, text }

  async function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);
    setNote(null);
    let ok = 0;
    let failed = 0;
    let tooBig = 0;
    for (const file of files) {
      // Files are POSTed inside a JSON body capped at ~1MB server-side; guard
      // client-side so a giant file isn't read into memory then rejected with a
      // confusing "couldn't be read".
      if (file.size > 900_000) {
        tooBig++;
        continue;
      }
      try {
        const text = await file.text();
        if (!text.trim()) throw new Error("empty");
        const payload = parseUploadedFile(file.name, text, kind);
        const res = await fetch("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, payload }),
        });
        if (res.status === 413) {
          tooBig++;
          continue;
        }
        if (!res.ok) throw new Error(`server ${res.status}`);
        ok++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    const parts = [];
    if (ok) parts.push(`Uploaded ${ok} draft${ok === 1 ? "" : "s"}`);
    if (tooBig) parts.push(`${tooBig} too large (max ~900 KB)`);
    if (failed) parts.push(`${failed} couldn't be read`);
    setNote({
      tone: ok && !failed && !tooBig ? "good" : "warn",
      text: parts.join(" · ") || "Nothing uploaded.",
    });
    if (ok) onUploaded?.();
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {note && (
        <span className={`text-[12px] ${note.tone === "good" ? "text-good" : "text-warn"}`}>{note.text}</span>
      )}
      <span className="text-[11px] text-faint">Upload as:</span>
      <div className="flex overflow-hidden rounded-md border border-line-strong text-[12px] font-medium">
        <button
          onClick={() => setKind("blog")}
          className={`px-2.5 py-1 transition ${kind === "blog" ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas"}`}
          title="Uploaded files become blog drafts"
        >
          Blog
        </button>
        <button
          onClick={() => setKind("linkedin")}
          className={`border-l border-line-strong px-2.5 py-1 transition ${kind === "linkedin" ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas"}`}
          title="Uploaded files become LinkedIn post drafts"
        >
          LinkedIn
        </button>
      </div>
      <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <CircleNotch size={15} className="animate-spin" /> : <UploadSimple size={15} />}
        {busy ? "Uploading…" : "Upload drafts"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = ""; // allow re-uploading the same file
        }}
      />
    </div>
  );
}
