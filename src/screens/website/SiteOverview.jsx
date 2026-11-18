import { Globe, FileText, Newspaper, Stack, Buildings, MapPin } from "@phosphor-icons/react";
import { Card, Badge, StatTile, StatusDot } from "../../components/ui.jsx";

// KPI tiles — the shared StatTile row, matching the Jarvis dashboard.
export function SiteKpis({ overview }) {
  if (!overview) {
    return (
      <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl border border-line bg-surface-2" />
        ))}
      </div>
    );
  }
  const c = overview.counts || {};
  const tiles = [
    { icon: Newspaper, label: "Blog posts", value: c.news ?? 0 },
    { icon: Stack, label: "Service pages", value: c.services ?? 0 },
    { icon: Buildings, label: "Industries", value: c.industries ?? 0 },
    { icon: MapPin, label: "Locations", value: c.locations ?? 0 },
    { icon: FileText, label: "Astro pages", value: c.pages ?? 0 },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <StatTile key={t.label} icon={t.icon} label={t.label} value={t.value} />
      ))}
    </div>
  );
}

// Compact identity + status bar — mirrors the Jarvis mission-control cards.
export function SiteStatus({ overview }) {
  if (!overview) {
    return <Card className="mb-4 h-[76px] animate-pulse bg-surface-2" />;
  }
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-4 p-4">
      <div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <Globe size={20} weight="fill" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[14px] font-semibold tracking-[-0.02em] text-ink">{overview.name}</h3>
          <Badge tone="good"><StatusDot tone="good" /> Migrated · Astro</Badge>
          <Badge tone="neutral">{overview.framework}</Badge>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Migrated off Elementor to Astro. Publishing pushes content to main and
          The site host rebuilds larkwell.example within a few minutes.
          {overview.lastBuilt && (
            <>
              {" "}
              Last built{" "}
              {new Date(overview.lastBuilt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
              .
            </>
          )}
        </p>
      </div>
    </Card>
  );
}
