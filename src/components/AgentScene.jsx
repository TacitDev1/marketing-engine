import { useMemo, useSyncExternalStore } from "react";

// SMIL ignores CSS media queries, so reduced-motion has to be a render-time
// decision: with it on we simply don't render the moving dots (the CSS bob
// is handled by the media query below). Live-updates if the OS setting flips.
const rmQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const q = rmQuery();
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => rmQuery().matches
  );
}

// How the AI team works, as a picture anyone can read in ten seconds:
// bubble nodes (one per agent) wired together graph-style — same visual
// language as the Second Brain graph — with the work itself flowing along
// the lines as little dots. Pure inline SVG + SMIL: no libraries, no JS
// animation loop, nothing to poll. The dots run off the main thread and
// cost effectively nothing; with prefers-reduced-motion everything holds
// still and the picture still explains itself.

// One soft "3D ball" gradient per agent tone. Gradients live per-instance
// (ids are namespaced) so two scenes on one page couldn't clash.
const AGENTS = {
  researcher: { color: "var(--color-brand)", label: "Researcher" },
  brain: { color: "var(--color-sky)", label: "Second Brain" },
  worker: { color: "var(--color-violet)", label: "Jarvis Worker" },
  librarian: { color: "var(--color-good)", label: "Librarian" },
  you: { color: "var(--color-warn)", label: "You" },
};

// A flowing dot along a path: three per edge, evenly staggered, linear
// (constant motion reads as "conveyor belt", which is exactly the story).
function FlowDots({ pathId, color, dur = 5, count = 3, r = 4 }) {
  // Negative begin = the animation starts mid-flight, so every dot is ON its
  // path from the first frame (a positive stagger parks waiting dots at the
  // SVG origin until their turn — a stray blob in the corner).
  return Array.from({ length: count }, (_, i) => (
    <circle key={i} r={r} fill={color} opacity="0.9">
      <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${-(i * dur) / count}s`} rotate="0">
        <mpath href={`#${pathId}`} />
      </animateMotion>
    </circle>
  ));
}

// One agent bubble: shaded sphere + white glyph + name/role beneath.
// The bob is CSS (transform-only), staggered so the group feels alive
// rather than mechanical.
function Bubble({ x, y, r, id, name, role, color, glyph, delay = 0 }) {
  return (
    <g>
      {/* ground shadow stays put while the ball bobs — that contrast is
          what makes the float read as depth instead of the image wobbling */}
      <ellipse cx={x} cy={y + r + 16} rx={r * 0.72} ry={r * 0.16} fill="var(--color-ink)" opacity="0.10" />
      <g className="ag-bob" style={{ animationDelay: `${delay}s` }}>
        <circle cx={x} cy={y} r={r} fill={`url(#ag-ball-${id})`} />
        <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1" />
        <g transform={`translate(${x} ${y})`} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          {glyph}
        </g>
      </g>
      <text x={x} y={y + r + 34} textAnchor="middle" fontSize="14.5" fontWeight="650" fill="var(--color-ink)">
        {name}
      </text>
      <text x={x} y={y + r + 51} textAnchor="middle" fontSize="11.5" fill="var(--color-muted)">
        {role}
      </text>
    </g>
  );
}

// Tiny hand-drawn glyphs (centered on 0,0) — friendlier than icon fonts
// inside a sphere, and they scale with the viewBox for free.
const GLYPHS = {
  // magnifying glass
  researcher: (
    <>
      <circle cx="-4" cy="-4" r="11" />
      <path d="M 4 4 L 14 14" />
    </>
  ),
  // a brain-ish cloud of linked nodes
  brain: (
    <>
      <circle cx="-11" cy="-6" r="3.4" fill="#fff" stroke="none" />
      <circle cx="9" cy="-11" r="3.4" fill="#fff" stroke="none" />
      <circle cx="12" cy="7" r="3.4" fill="#fff" stroke="none" />
      <circle cx="-7" cy="11" r="3.4" fill="#fff" stroke="none" />
      <path d="M -11 -6 L 9 -11 M 9 -11 L 12 7 M 12 7 L -7 11 M -7 11 L -11 -6 M -11 -6 L 12 7" strokeWidth="2" strokeOpacity="0.85" />
    </>
  ),
  // pencil
  worker: (
    <>
      <path d="M -10 10 L 8 -8 L 13 -3 L -5 15 L -11 16 Z" />
      <path d="M 8 -8 L 13 -3" />
    </>
  ),
  // broom
  librarian: (
    <>
      <path d="M 10 -12 L -2 0" />
      <path d="M -2 0 L -12 4 L -6 12 L 4 6 Z" />
    </>
  ),
  // person
  you: (
    <>
      <circle cx="0" cy="-8" r="7" />
      <path d="M -13 15 C -13 4 13 4 13 15" />
    </>
  ),
};

export default function AgentScene() {
  const reduced = useReducedMotion();
  // Bubble centers. One glance-order: left → right is the journey of a post;
  // the Librarian sits under the Brain because that's all it ever touches.
  const P = useMemo(
    () => ({
      researcher: { x: 120, y: 150, r: 50 },
      brain: { x: 400, y: 130, r: 60 },
      worker: { x: 670, y: 150, r: 50 },
      you: { x: 900, y: 170, r: 54 },
      librarian: { x: 250, y: 322, r: 38 },
    }),
    []
  );

  return (
    <div className="px-4 pb-4 pt-1">
      {/* Local styles: transform-only bob + a hard stop for reduced motion
          (SMIL ignores media queries, so the CSS rule pauses those too). */}
      <style>{`
        .ag-bob { animation: ag-bob 3.4s ease-in-out infinite alternate; }
        @keyframes ag-bob { from { transform: translateY(0); } to { transform: translateY(-6px); } }
        @media (prefers-reduced-motion: reduce) { .ag-bob { animation: none; } }
      `}</style>

      <svg viewBox="0 0 1050 420" className="ag-scene w-full" role="img" aria-label="How the agents work together: the Researcher reads the web and files what it learns into the Second Brain; the Worker writes drafts grounded in that knowledge; you review every draft, and only you post. The Librarian keeps the Second Brain tidy.">
        <defs>
          {Object.entries(AGENTS).map(([id, a]) => (
            <radialGradient key={id} id={`ag-ball-${id}`} cx="0.34" cy="0.28" r="0.85">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="28%" stopColor={a.color} stopOpacity="0.85" />
              <stop offset="100%" stopColor={a.color} />
            </radialGradient>
          ))}
        </defs>

        {/* ---- edges first (under the bubbles) ---- */}
        <g fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round">
          <path id="ag-e-find" d={`M ${P.researcher.x + 54} ${P.researcher.y - 6} Q 260 100 ${P.brain.x - 64} ${P.brain.y}`} />
          <path id="ag-e-write" d={`M ${P.brain.x + 64} ${P.brain.y + 4} Q 540 110 ${P.worker.x - 54} ${P.worker.y}`} />
          <path id="ag-e-review" d={`M ${P.worker.x + 54} ${P.worker.y + 4} Q 790 130 ${P.you.x - 58} ${P.you.y - 4}`} />
          {/* the Librarian's little maintenance loop around the Brain */}
          <path id="ag-e-tidy" d={`M ${P.librarian.x + 30} ${P.librarian.y - 24} Q 330 240 ${P.brain.x - 36} ${P.brain.y + 52} Q 300 290 ${P.librarian.x + 40} ${P.librarian.y + 8}`} />
        </g>

        {/* the one thing that must never be misunderstood: the outside world
            is only reachable through Tobias, by hand */}
        <g>
          <path id="ag-e-post" d={`M ${P.you.x + 56} ${P.you.y - 8} Q 985 150 990 122`} fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" strokeLinecap="round" />
          <text x={P.you.x + 88} y={78} textAnchor="middle" fontSize="11.5" fontWeight="650" fill="var(--color-ink-2)">
            LinkedIn · website
          </text>
          <text x={P.you.x + 88} y={94} textAnchor="middle" fontSize="10.5" fill="var(--color-muted)">
            posted by hand,
          </text>
          <text x={P.you.x + 88} y={108} textAnchor="middle" fontSize="10.5" fill="var(--color-muted)">
            only ever by you
          </text>
        </g>

        {/* ---- what travels on each line (held still under reduced motion) ---- */}
        {!reduced && (
          <g>
            <FlowDots pathId="ag-e-find" color="var(--color-brand)" dur={5} />
            <FlowDots pathId="ag-e-write" color="var(--color-sky)" dur={5} />
            <FlowDots pathId="ag-e-review" color="var(--color-violet)" dur={5} />
            <FlowDots pathId="ag-e-tidy" color="var(--color-good)" dur={7} count={2} r={3.2} />
          </g>
        )}

        {/* edge captions — plain words, placed on the journey */}
        <g fontSize="11.5" fill="var(--color-muted)" textAnchor="middle">
          <text x="258" y="86">files what it learns</text>
          <text x="536" y="94">grounds every draft</text>
          <text x="787" y="112">drafts, for your review</text>
          <text x="452" y="296">tidies &amp; connects notes</text>
        </g>

        {/* ---- the team ---- */}
        <Bubble {...P.researcher} id="researcher" name="Researcher" role="reads the live web" color={AGENTS.researcher.color} glyph={GLYPHS.researcher} delay={0} />
        <Bubble {...P.brain} id="brain" name="Second Brain" role="everything it knows" color={AGENTS.brain.color} glyph={GLYPHS.brain} delay={0.6} />
        <Bubble {...P.worker} id="worker" name="Jarvis Worker" role="writes the drafts" color={AGENTS.worker.color} glyph={GLYPHS.worker} delay={1.1} />
        <Bubble {...P.you} id="you" name="You" role="approve · edit · post" color={AGENTS.you.color} glyph={GLYPHS.you} delay={1.6} />
        <Bubble {...P.librarian} id="librarian" name="Librarian" role="keeps it tidy" color={AGENTS.librarian.color} glyph={GLYPHS.librarian} delay={0.3} />
      </svg>

      {/* the same story in one line of words, for people who read first */}
      <p className="mt-1 text-center text-[12.5px] leading-relaxed text-muted">
        The Researcher learns, the Second Brain remembers, the Worker writes, the Librarian tidies —
        and <span className="font-semibold text-ink-2">nothing ever goes out unless you post it yourself</span>.
      </p>
    </div>
  );
}
