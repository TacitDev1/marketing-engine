
// One tone map for actor → timeline dot, shared by the rail and Activity tab.
// Humans read as "warn" (orange = a person acted); the app's own actors get
// their own colours so a scheduler pick doesn't look like a warning.
export const actorTone = (actor) =>
  actor === "researcher" || actor === "agent" ? "brand" : actor === "worker" ? "violet" : actor === "librarian" ? "good" : actor === "jarvis" || actor === "system" ? "idle" : "warn";

// An activity line whose ref points at a Library draft opens that draft.
export function activityText(a, onOpenDraft) {
  const id = a.ref?.libraryId;
  if (!id || !onOpenDraft) return a.summary;
  return (
    <button type="button" onClick={() => onOpenDraft(id)} className="text-left hover:text-brand hover:underline" title="Open this draft in the Library">
      {a.summary}
    </button>
  );
}

export function focusBrief() {
  const el = document.getElementById("jarvis-brief");
  if (el) {
    el.focus();
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
