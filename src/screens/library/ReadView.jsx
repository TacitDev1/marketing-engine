import Markdown from "../../components/Markdown.jsx";

// Guardrail flags + the reaction's source links, shown to the reviewer in both
// the blog and the post reader (the drafting screens show the same strip).
function ReviewNotes({ p }) {
  const warnings = Array.isArray(p.warnings) ? p.warnings : [];
  const sources = Array.isArray(p.sources) ? p.sources : [];
  const why = p.why ? String(p.why) : "";
  const critique = p.critique && typeof p.critique === "object" ? p.critique : null;
  const editor = p.editor && typeof p.editor === "object" ? p.editor : null;
  if (!warnings.length && !sources.length && !why && !editor) return null;
  return (
    <div className="mt-4 space-y-2">
      {editor && (
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-semibold">Editor agent:</span>{" "}
          {editor.verdict === "reject" ? `rejected (${editor.score}/10). ${editor.reason || ""}` : `passed at ${editor.score}/10.`}
          {editor.changes && <span className="text-muted"> Changed: {editor.changes}</span>}
          {editor.notes && <span className="text-muted"> Note: {editor.notes}</span>}
          {editor.verdict === "pass" && p.publishedUrl ? (
            <span className="text-muted">
              {" "}
              · Published automatically:{" "}
              <a href={p.publishedUrl} target="_blank" rel="noreferrer" className="break-all text-brand hover:underline">
                {p.publishedUrl}
              </a>
            </span>
          ) : editor.cleared ? (
            <span className="text-muted"> · Cleared by the Editor. Mark it Approved and it goes out on the next publishing day.</span>
          ) : (
            Array.isArray(editor.issues) && editor.issues.length > 0 && <span className="text-muted"> · Not cleared to publish: {editor.issues.map((i) => i.note).join("; ")}</span>
          )}
        </div>
      )}
      {why && (
        <div className="rounded-lg border border-brand/20 bg-brand-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-semibold text-brand">Why Jarvis wrote this:</span> {why}
          {Array.isArray(p.evidence) && p.evidence.length > 0 && <span className="text-muted"> (based on: {p.evidence.join("; ")})</span>}
          {critique?.score != null && (
            <span className="text-muted">
              {" "}
              · Passed Jarvis's own review at {critique.score}/10{critique.revisions ? ` after ${critique.revisions} rewrite${critique.revisions === 1 ? "" : "s"}` : ""}.
            </span>
          )}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-warn">
          <span className="font-semibold">Check before posting:</span> {warnings.join(" · ")}
        </div>
      )}
      {sources.length > 0 && (
        <div className="text-[12.5px] text-faint">
          <span className="font-semibold text-muted">Sources (not in the post):</span>{" "}
          {sources.map((u, i) => (
            <span key={u + i}>
              {i > 0 && " · "}
              <a href={u} target="_blank" rel="noreferrer" className="break-all text-brand hover:underline">{u}</a>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReadView({ record }) {
  const isBlog = record.kind === "blog";
  const p = record.payload || {};
  if (isBlog) {
    return (
      <article>
        <h2 className="text-2xl font-semibold leading-tight tracking-tight text-ink">{p.title || "Untitled"}</h2>
        {p.metaDescription && <p className="mt-2 text-[14px] leading-relaxed text-muted">{p.metaDescription}</p>}
        <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-faint">
          {p.slug && <span className="font-mono">/{p.slug}</span>}
          {p.keyword && <span>· keyword: {p.keyword}</span>}
        </div>
        <ReviewNotes p={p} />
        <hr className="my-4 border-line" />
        <Markdown text={p.body || ""} />
      </article>
    );
  }
  return (
    <div>
      <p className="text-[16px] font-medium leading-snug text-ink">{p.hook}</p>
      <div className="mt-3">
        <Markdown text={p.body || ""} />
      </div>
      {Array.isArray(p.hashtags) && p.hashtags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {p.hashtags.map((t) => (
            <span key={t} className="rounded-full bg-brand/10 px-2 py-0.5 text-[12px] font-medium text-brand">
              #{t}
            </span>
          ))}
        </div>
      )}
      <ReviewNotes p={p} />
    </div>
  );
}
