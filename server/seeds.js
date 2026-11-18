// Seed research topics — planted once so the queue is warm on first run and the
// Researcher has work covering every marketing front (frontend + backend) the
// moment the loop starts. The Worker generates more topics from there.

export const FRONTS = {
  frontend: ["messaging", "content-seo", "landing-pages", "social", "brand-proof"],
  backend: ["technical-seo", "site-health", "schema", "performance", "analytics", "competitor-gaps"],
};
export const ALL_FRONTS = [...FRONTS.frontend, ...FRONTS.backend];

// Rotating Google News queries the Worker researches on its own (free, no key).
// One per tick, round-robin — a steady stream of fresh SAP news to react to.
export const NEWS_QUERIES = [
  { q: "SAP S/4HANA migration", front: "messaging" },
  { q: "SAP S/4HANA 2027 deadline ECC", front: "messaging" },
  { q: "SAP on AWS", front: "content-seo" },
  { q: "SAP on Azure cloud", front: "content-seo" },
  { q: "SAP cloud migration enterprise", front: "content-seo" },
  { q: "SAP security patch vulnerability", front: "social" },
  { q: "SAP BTP business technology platform", front: "content-seo" },
  { q: "SAP Basis managed services", front: "social" },
  { q: "SAP S/4HANA Gartner OR IDC analyst", front: "brand-proof" },
  { q: "SAP RISE with SAP", front: "messaging" },
];

export const SEED_TOPICS = [
  // --- frontend / demand-side ---
  { front: "messaging", priority: 5, topic: "How do the top SAP migration consultancies position the 2027 ECC end-of-maintenance deadline, and where can Larkwell Consulting differentiate?" },
  { front: "content-seo", priority: 5, topic: "Highest-intent S/4HANA migration and SAP-on-cloud questions buyers search that larkwell.example has no dedicated page for yet." },
  { front: "landing-pages", priority: 4, topic: "Best-practice structure and proof elements for a high-converting B2B SAP consulting service page in 2026." },
  { front: "social", priority: 3, topic: "Which SAP topics and post formats are driving the most engagement on LinkedIn for SAP consultancies right now?" },
  { front: "brand-proof", priority: 3, topic: "What proof, certifications, and trust signals do enterprise SAP buyers look for when choosing a migration partner?" },
  // --- backend / technical-side ---
  { front: "technical-seo", priority: 4, topic: "Current technical-SEO issues and quick wins for larkwell.example (crawlability, internal linking, indexation, multilingual targeting)." },
  { front: "schema", priority: 3, topic: "Which schema.org structured-data types should an SAP consulting site use (Organization, Service, FAQ, Article) and how do competitors apply them?" },
  { front: "performance", priority: 3, topic: "Core Web Vitals and page-speed benchmarks for B2B enterprise-service sites in 2026, and what 'good' looks like." },
  { front: "site-health", priority: 3, topic: "Common site-health problems that quietly suppress organic rankings for B2B service sites, and how to audit for them." },
  { front: "analytics", priority: 2, topic: "Which marketing signals and conversion events Larkwell should track to know what content actually drives SAP leads." },
  { front: "competitor-gaps", priority: 5, topic: "Keyword and content gaps between larkwell.example and its top 3 SAP-consulting competitors (use SEMrush where available)." },
];
