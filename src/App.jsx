import { Component, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import { Button } from "./components/ui.jsx";
import LinkedInPosts from "./screens/LinkedInPosts.jsx";
import Blogs from "./screens/Blogs.jsx";
import Images from "./screens/Images.jsx";
import Seo from "./screens/Seo.jsx";
import SecondBrain from "./screens/SecondBrain.jsx";
import Library from "./screens/Library.jsx";
import Jarvis from "./screens/Jarvis.jsx";
import Connections from "./screens/Connections.jsx";
import Website from "./screens/Website.jsx";
import Analytics from "./screens/Analytics.jsx";
import Settings from "./screens/Settings.jsx";
import Usage from "./screens/Usage.jsx";
import Feedback from "./screens/Feedback.jsx";
import Competitors from "./screens/Competitors.jsx";
import Schedule from "./screens/Schedule.jsx";
import { DEMO, showScreen } from "./lib/demo.js";

// The static demo's banner: the data is invented and nothing is running.
function DemoBanner() {
  return (
    <div role="note" className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2 text-[12.5px]" style={{ background: "#14532d", color: "#f6f7f2" }}>
      <span className="font-semibold" style={{ color: "#a3e635" }}>Demo data. No models are running.</span>
      <span>Larkwell Consulting is an invented company. Approve, send back and drop work in memory and reset on reload.</span>
    </div>
  );
}

// Catches a render crash inside ONE screen and shows a friendly recovery card
// there, instead of letting React unmount the whole app to a white page.
class ScreenBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(`screen "${this.props.name}" crashed:`, error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <h2 className="text-lg font-semibold">This screen hit a snag</h2>
        <p className="mt-2 text-sm text-faint">
          Something unexpected broke while drawing this screen. Your drafts and data are safe on disk —
          this is only a display problem.
        </p>
        <p className="mt-2 break-words text-[12px] text-faint">{String(this.state.error?.message || this.state.error)}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
      </div>
    );
  }
}

const SCREEN_IDS = new Set([
  "jarvis", "linkedin", "blogs", "images", "seo", "wiki", "library",
  "connections", "website", "analytics", "settings", "usage", "feedback", "competitors", "schedule",
]);

// ?screen=jarvis opens the app on that screen (bookmarkable deep link).
// Default stays Post drafts — the everyday task, a calmer first impression
// than the busy Jarvis control centre.
function initialSection() {
  try {
    const q = new URLSearchParams(window.location.search).get("screen");
    if (q && SCREEN_IDS.has(q) && showScreen(q)) return q;
  } catch {
    /* no URL access (tests) — fall through */
  }
  return DEMO ? "jarvis" : "linkedin";
}

export default function App() {
  const [section, setSection] = useState(initialSection);
  // Sections you've opened stay MOUNTED (just hidden when inactive) so jumping
  // between them no longer wipes what you were doing — a half-written draft,
  // a generated blog, your filters all survive. Screens mount lazily on first
  // visit, so we don't spin everything up at startup.
  const [visited, setVisited] = useState(() => new Set([initialSection()]));
  const [blogKeyword, setBlogKeyword] = useState(null);
  const [posterDraft, setPosterDraft] = useState(null);

  function go(next) {
    if (!showScreen(next)) return;
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
    setSection(next);
  }

  // Deep-link from the SEO screen: pick a keyword there, jump to Blogs with it.
  function draftBlogFor(keyword) {
    setBlogKeyword({ keyword, ts: Date.now() });
    go("blogs");
  }

  // Deep-links from a Library card into Images: the ASCII poster tab, or the
  // card/photo tab for a LinkedIn image, with the draft preselected.
  function makePosterFor(draftId) {
    setPosterDraft({ draftId, ts: Date.now(), tab: "ascii" });
    go("images");
  }
  function makeImageFor(draftId) {
    setPosterDraft({ draftId, ts: Date.now(), tab: "card" });
    go("images");
  }
  // Deep-link from the Schedule into the Library with one draft opened.
  // ?screen=library&draft=<id> (the link in a Teams message) opens that draft.
  const [libraryDraft, setLibraryDraft] = useState(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("draft");
      return id ? { draftId: id, ts: Date.now() } : null;
    } catch {
      return null;
    }
  });
  function openInLibrary(draftId) {
    setLibraryDraft({ draftId, ts: Date.now() });
    go("library");
  }

  // One entry per section. `active` is passed through so a screen can pause
  // expensive work (e.g. the ASCII poster's animation) while it's hidden.
  const screens = {
    jarvis: <Jarvis onNavigate={go} onOpenDraft={openInLibrary} active={section === "jarvis"} />,
    linkedin: <LinkedInPosts onMakeImage={makeImageFor} active={section === "linkedin"} />,
    blogs: <Blogs incoming={blogKeyword} onMakeImage={makeImageFor} active={section === "blogs"} />,
    images: <Images posterDraft={posterDraft} active={section === "images"} />,
    seo: <Seo onDraftBlog={draftBlogFor} active={section === "seo"} />,
    wiki: <SecondBrain active={section === "wiki"} />,
    library: <Library onMakePoster={makePosterFor} onMakeImage={makeImageFor} incoming={libraryDraft} active={section === "library"} />,
    connections: <Connections active={section === "connections"} />,
    website: <Website active={section === "website"} />,
    analytics: <Analytics active={section === "analytics"} />,
    settings: <Settings active={section === "settings"} />,
    usage: <Usage active={section === "usage"} />,
    feedback: <Feedback active={section === "feedback"} />,
    competitors: <Competitors onNavigate={go} active={section === "competitors"} />,
    schedule: <Schedule onOpenDraft={openInLibrary} active={section === "schedule"} />,
  };

  return (
    <div className="flex h-screen min-h-[100dvh] overflow-hidden">
      <Sidebar active={section} onNavigate={go} />
      <main className="scroll-quiet flex-1 overflow-y-auto">
        {DEMO && <DemoBanner />}
        {Object.entries(screens).map(([id, el]) =>
          visited.has(id) && showScreen(id) ? (
            <div key={id} className={section === id ? "contents" : "hidden"}>
              <ScreenBoundary name={id}>{el}</ScreenBoundary>
            </div>
          ) : null,
        )}
      </main>
    </div>
  );
}
