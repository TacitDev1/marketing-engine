// Word-set overlap, shared by every "have we said this before?" check
// (worker variety guard, critic theme cooldown, playbook rule merge,
// recommendation dedupe). Each caller builds its own word set, because the
// stop words and cut-offs differ per use.

// Jaccard index of two Sets: shared words / all words. 0 when either is empty.
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
