import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  PushPin,
  Lightning,
} from "@phosphor-icons/react";
import { Card } from "../components/ui.jsx";
import ManageSite from "../components/ManageSite.jsx";
import LivePreview from "./website/LivePreview.jsx";
import SiteHealth from "./website/SiteHealth.jsx";
import Header from "./website/Header.jsx";
import { SiteKpis, SiteStatus } from "./website/SiteOverview.jsx";
import Section from "./website/Section.jsx";
import Recommendations from "./website/Recommendations.jsx";
import DraftExport from "./website/DraftExport.jsx";
import ContentList from "./website/ContentList.jsx";

// Recommendation fronts that target the website itself (vs. social/LinkedIn).
const SITE_FRONTS = new Set([
  "technical-seo",
  "site-health",
  "schema",
  "performance",
  "analytics",
  "competitor-gaps",
  "landing-pages",
]);

export default function Website({ active = true }) {
  const [overview, setOverview] = useState(null);
  const [pages, setPages] = useState(null);
  const [recs, setRecs] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [brainDown, setBrainDown] = useState(false);

  // Bumped on every refresh so "Manage the website" reloads too (a blog just
  // sent to the site must show up there without leaving the screen).
  const [manageKey, setManageKey] = useState(0);
  const refresh = useCallback(() => {
    setManageKey((k) => k + 1);
    fetch("/api/website/overview")
      .then((r) => r.json())
      .then((d) => {
        setOverview(d);
        setBrainDown(false);
      })
      .catch(() => setBrainDown(true));
    // On a failed poll keep what we already have — a hiccup must not blank
    // the lists (SecondBrain's rule, applied here too).
    fetch("/api/website/pages").then((r) => r.json()).then((d) => setPages(d.entries || [])).catch(() => {});
    fetch("/api/autopilot/recommendations")
      .then((r) => r.json())
      .then((d) => setRecs((d.recommendations || []).filter((r) => SITE_FRONTS.has(r.front))))
      .catch(() => {});
    fetch("/api/drafts")
      .then((r) => r.json())
      .then((d) => setDrafts((d.drafts || []).filter((x) => x.kind === "blog" && x.status !== "delete" && x.status !== "archived")))
      .catch(() => {});
  }, []);

  // Poll while visible. This also makes the "Jarvis is starting up… it'll
  // reconnect" card TRUE — before, one failed boot-race fetch froze that card
  // until a hard reload, and new blog drafts never appeared without one.
  useEffect(() => {
    if (!active) return;
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh, active]);

  if (brainDown) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-6 py-6 sm:px-8 lg:px-10">
        <Header />
        <Card className="p-6 text-[14px] leading-relaxed text-muted">
          <span className="font-medium text-ink">Jarvis is starting up.</span> Give it a moment and
          it'll reconnect. Your website itself is fine.
        </Card>
      </div>
    );
  }

  if (overview && overview.available === false) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-6 py-6 sm:px-8 lg:px-10">
        <Header />
        <Card className="p-6 text-[14px] leading-relaxed text-muted">
          Couldn't find the parked Astro site. It should live at{" "}
          <code className="rounded bg-canvas px-1.5 py-0.5 text-[12px] text-ink-2">
            {overview.root || "../company-website (set MKT_WEBSITE_REPO)"}
          </code>
          . Nothing else in the app depends on it.
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-6 sm:px-8 lg:px-10">
      <Header />

      {/* KPI row — what's on the site right now */}
      <SiteKpis overview={overview} />

      {/* Site identity + status */}
      <SiteStatus overview={overview} />

      {/* Blog drafts first — read, edit with Jarvis, send to the site */}
      <Section
        icon={PushPin}
        title="Push a blog draft onto the site"
        sub="Your blog drafts from the Library. Open one to read it in full and ask Jarvis for changes, then send it to the site. It only goes live when you press the big button under Manage the website."
      >
        <DraftExport drafts={drafts} siteReady={overview?.available} onExported={refresh} />
      </Section>

      {/* Manage the website — the built-in CMS for posts + success stories */}
      <Section
        icon={FileText}
        title="Manage the website"
        sub="Edit a blog post or success story, show or hide it, then press the big button to publish. It goes straight to larkwell.example, so you will be asked to confirm twice."
      >
        <ManageSite active={active} refreshKey={manageKey} />
      </Section>

      {/* Live preview of the migrated site */}
      <LivePreview active={active} />

      {/* Local Lighthouse audit — free site health, before deploy */}
      <SiteHealth active={active} />

      {/* Recommendations targeting the site */}
      <Section
        icon={Lightning}
        title="What to fix on the site"
        sub="Site-level recommendations Jarvis has surfaced — technical SEO, schema, performance, competitor gaps. Mark them done as you action them on the company-website."
      >
        <Recommendations recs={recs} onChange={refresh} />
      </Section>

      {/* Existing content */}
      <Section
        icon={FileText}
        title="What's already on the site"
        sub="The site's content collections and pages, read-only. Click any item to preview its source."
      >
        <ContentList entries={pages} />
      </Section>
    </div>
  );
}
