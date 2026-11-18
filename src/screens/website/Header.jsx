import { Globe } from "@phosphor-icons/react";

export default function Header() {
  return (
    <header className="mb-6">
      <h1 className="flex items-center gap-2.5 text-[23px] font-bold tracking-[-0.035em] text-ink">
        <Globe weight="fill" size={26} className="text-brand" />
        Website
      </h1>
      <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
        A live window into your migrated Astro site (company-website). Browse the real
        site, see the site-level fixes Jarvis recommends, and push blog drafts
        straight onto it. Nothing goes public until you press Publish and confirm
        twice — publishing always stays in your hands.
      </p>
    </header>
  );
}
