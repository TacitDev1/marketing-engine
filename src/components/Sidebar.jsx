import { useEffect, useState } from "react";
import {
  LinkedinLogo,
  Article,
  MagnifyingGlass,
  Globe,
  ChartLineUp,
  Sparkle,
  PlugsConnected,
  Bookmarks,
  Robot,
  Brain,
  Image as ImageIcon,
  Gear,
  Fire,
  ArrowSquareOut,
  Sun,
  MoonStars,
  ChatCircleText,
  Binoculars,
  CalendarCheck,
} from "@phosphor-icons/react";
import { company } from "../lib/company.js";
import { useDeployment } from "../lib/deployment.js";
import { DEMO, showScreen } from "../lib/demo.js";

// Grouped nav. The first group has no title (Jarvis, the hub); the rest sit
// under small section labels so a long menu reads cleanly.
const SECTIONS = [
  {
    items: [
      { id: "jarvis", label: "Jarvis", icon: Robot },
      { id: "feedback", label: "Feedback", icon: ChatCircleText },
    ],
  },
  {
    title: "Content",
    items: [
      { id: "linkedin", label: "LinkedIn Posts", icon: LinkedinLogo },
      { id: "blogs", label: "Blogs", icon: Article },
      { id: "images", label: "Images", icon: ImageIcon },
      { id: "library", label: "Library", icon: Bookmarks },
      { id: "schedule", label: "Schedule", icon: CalendarCheck },
    ],
  },
  {
    title: "Site & SEO",
    items: [
      { id: "seo", label: "SEO", icon: MagnifyingGlass },
      { id: "website", label: "Website", icon: Globe },
      { id: "analytics", label: "Analytics", icon: ChartLineUp },
    ],
  },
  {
    title: "Knowledge",
    items: [
      { id: "wiki", label: "Second Brain", icon: Brain },
      { id: "competitors", label: "Competitors", icon: Binoculars },
      { id: "connections", label: "Connections", icon: PlugsConnected },
    ],
  },
  {
    title: "System",
    items: [
      { id: "usage", label: "Token Usage", icon: Fire },
      { id: "settings", label: "Settings", icon: Gear },
    ],
  },
];

// Theme control — stamps data-theme on <html>, persists the choice, and
// defaults to the OS preference (no attribute = follow the system).
function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof document === "undefined") return null;
    return document.documentElement.getAttribute("data-theme");
  });
  useEffect(() => {
    const saved = localStorage.getItem("mkt-theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
      setTheme(saved);
    }
  }, []);
  const isDark =
    theme === "dark" ||
    (!theme && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme:dark)").matches);
  const toggle = () => {
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mkt-theme", next);
    setTheme(next);
  };
  return { isDark, toggle };
}

export default function Sidebar({ active, onNavigate }) {
  const dep = useDeployment();
  const { isDark, toggle } = useTheme();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-line bg-surface text-ink">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-gradient-to-br from-brand to-brand-bright text-white shadow-[0_4px_14px_-2px_color-mix(in_srgb,var(--color-brand)_45%,transparent)]">
          <Sparkle weight="fill" size={18} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-[-0.02em] text-ink">Marketing Engine</div>
          <div className="text-[11px] text-faint">Marketing assistant</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="scroll-quiet mt-1 flex-1 space-y-4 overflow-y-auto px-3">
        {SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => showScreen(i.id)) }))
          .filter((s) => s.items.length)
          .map((section, si) => (
          <div key={section.title || si}>
            {section.title && (
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                // External links open in a new tab instead of switching screens.
                if (item.href) {
                  return (
                    <li key={item.id}>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-[13.5px] font-medium text-muted transition hover:bg-surface-2 hover:text-ink-2"
                      >
                        <Icon size={17} />
                        <span className="flex-1 text-left">{item.label}</span>
                        <ArrowSquareOut size={14} className="text-faint group-hover:text-muted" />
                      </a>
                    </li>
                  );
                }
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => onNavigate(item.id)}
                      className={`group relative flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-[13.5px] transition ${
                        isActive
                          ? "bg-brand-soft font-semibold text-brand"
                          : "font-medium text-muted hover:bg-surface-2 hover:text-ink-2"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-brand" />
                      )}
                      <Icon size={17} weight={isActive ? "fill" : "regular"} />
                      <span className="flex-1 text-left">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Theme toggle */}
      <div className="px-3 pb-1">
        <button
          onClick={toggle}
          title={isDark ? "Switch to light" : "Switch to dark"}
          className="flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-[13.5px] font-medium text-muted transition hover:bg-surface-2 hover:text-ink-2"
        >
          {isDark ? <Sun size={17} /> : <MoonStars size={17} />}
          <span className="flex-1 text-left">{isDark ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>

      {/* Footer note */}
      <div className="border-t border-line px-5 py-3.5">
        <p className="text-[11px] leading-relaxed text-faint">
          {DEMO ? "Static demo on sample data." : dep.mode === "server" ? "Private Larkwell server." : "Local only."} Every output is a draft for your review. Nothing posts
          to {company.name} channels automatically.
        </p>
      </div>
    </aside>
  );
}
