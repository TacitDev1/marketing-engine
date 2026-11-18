// Invented content for the demo and for a fresh install: one fortnight in the
// life of Larkwell Consulting's marketing engine. Larkwell, its clients,
// competitors and people are all made up. scripts/build-demo-data.mjs feeds
// this through the server's own store functions, so the data/ files it writes
// have exactly the shape the real server produces.
//
// Times are "days ago" relative to the moment the script runs.

export const BLOGS = [
  {
    key: "b-workorders",
    daysAgo: 1,
    serviceId: "plant-maintenance",
    keyword: "sap pm mobile work orders",
    slug: "sap-pm-work-orders-closed-at-the-asset",
    title: "Closing SAP PM work orders at the asset",
    metaDescription: "Why field crews still close SAP PM work orders on paper, and the three-screen tablet app that changes it without retraining the office.",
    body: `Most operators who run SAP PM already have the data model they need. The work order, the notification and the equipment record are all there. The problem is where the work order gets closed: on a clipboard in the van, and in SAP on Friday afternoon when someone in the office keys in the week.

## What paper costs you

When a work order is closed days after the job, the details are guessed. Readings are rounded, defects that were noticed but not fixed are forgotten, and the time booked is whatever fits the timesheet. The asset register drifts away from the assets, and preventive maintenance plans start to schedule work that crews know is pointless.

## Three screens, not thirty

Crews do three things with SAP: see today's jobs, close a job with readings and photos, and raise a defect they found on the way. A small Fiori app on a depot tablet can do exactly those three things. It does not need the full transaction, and it should not try to.

Keep the office on the screens they know. Planners and supervisors still schedule, release and settle in the back office. Only the closing moves to the field.

## Roll it out depot by depot

Start with the depot whose supervisor asks for it. Run paper and tablet side by side for a fortnight, then switch. Offline mode matters more than any feature: depots and rural sites often have poor signal, and a tablet that loses the job when the signal drops will be back in the drawer within a week.

## What to measure

Measure the gap between finishing a job and closing it in SAP, and the number of defects raised from the field. Both tell you whether the crews trust the app. Larkwell helps operators plan and build this kind of field app on top of SAP PM.`,
    editor: { verdict: "pass", score: 9, notes: "Strong, specific and practical. Tightened the opening and cut one repeated sentence.", changes: "Shortened the intro; split one long paragraph." },
    outcome: "waiting",
  },
  {
    key: "b-billing",
    daysAgo: 2,
    serviceId: "billing",
    keyword: "sap is-u billing exceptions",
    slug: "sap-billing-exceptions-for-good",
    title: "Clearing SAP billing exceptions for good",
    metaDescription: "Billing exceptions in SAP for utilities are a process symptom. Measure them by cause, fix the top two causes, then automate what is left.",
    body: `Every utility running SAP billing has an exception queue, and most have a team whose job is to work it. When the queue grows, the usual answer is to add people. That clears the backlog for a while and hides the reason it grew.

## Exceptions have causes

Group a month of exceptions by cause before changing anything. In most landscapes a handful of causes account for nearly all of them: meter reads that fail plausibility checks, move-in and move-out dates that cross a billing period, and tariff changes that reached production before anyone tested them against real contracts.

## Fix the process, not the queue

Take the largest cause and trace it back to where the bad data enters. Implausible reads often come from one reading route or one device type. Move-in timing problems usually start in the customer service process, where an agent enters a date the billing run cannot handle. Fix the entry point and that whole class of exception stops arriving.

## Then automate the rest

Once the big causes are fixed, what remains is a smaller, steadier queue. Some of it can be cleared by rules: re-estimate and release, or hold and notify. The rest needs a person, and now that person has time to look properly.

## Test tariffs like code

Tariff changes deserve the same care as a code change: a test system with copies of real contracts, a set of expected bills, and a sign-off before transport. It is slower the first time and much faster after that.

Larkwell works with utilities on billing processes in SAP and on the move to S/4HANA, where these fixes are worth making before the conversion rather than after.`,
    editor: { verdict: "pass", score: 8, notes: "Clear argument. Removed two hype words and a figure with no source.", changes: "Cut an unsourced statistic from the opening." },
    outcome: "waiting",
  },
  {
    key: "b-customcode",
    daysAgo: 5,
    serviceId: "s4hana",
    keyword: "brownfield s/4hana conversion",
    slug: "custom-code-before-a-brownfield-conversion",
    title: "Sorting custom code before a brownfield move",
    metaDescription: "Before a brownfield S/4HANA conversion, sort custom code into keep, fix and retire using real usage data from production.",
    body: `A brownfield conversion keeps your processes and your data, and it also keeps your custom code. That is the point of choosing it, and it is also where most of the surprises come from.

## Start with usage, not with the code

Before anyone reads a line of ABAP, collect usage data from production for a full business cycle, including the year-end close. It tells you which custom programs, reports and enhancements anyone still runs. In older landscapes a large share of custom objects turn out to be unused.

## Three piles

Put every custom object into one of three piles. Retire what nobody uses: delete it before the conversion so nobody has to fix it. Fix what is used and flagged by the conversion checks. Keep and document what is used and passes.

## Fix in the source system

Make the fixes in the current system, transport them through the normal landscape and let them run in production before the conversion. The conversion weekend is the wrong time to find out a fix was wrong.

## Write down why

For every object you keep, write one line on what it does and who asked for it. The next upgrade will be easier, and the team will stop treating custom code as something nobody dares to touch.

Larkwell plans brownfield conversions for operators who cannot stop the depot or the billing run, starting with exactly this kind of inventory.`,
    editor: { verdict: "pass", score: 9, notes: "Good structure and a clear point of view. Light copy edit only." },
    outcome: "approved",
    approvedBy: "Mara",
  },
  {
    key: "b-patching",
    daysAgo: 3,
    serviceId: "basis",
    keyword: "sap basis managed service",
    slug: "a-patch-window-a-small-basis-team-can-keep",
    title: "A patch window a small Basis team can keep",
    metaDescription: "A monthly SAP patch routine for a Basis team of one or two people: rate, patch development first, and keep a written rollback.",
    body: `Small Basis teams rarely skip patching on purpose. It slips because the patch window competes with everything else, and nobody owns the decision of what to patch first.

## Rate notes against your own landscape

Read the security notes on the day they come out and rate each one against what you actually run. A critical note for a component you do not use is not urgent for you.

## Development first, always

Patch development, let it run for a few days, then quality, then production. Write the rollback for each change before you start.

## Put it in the calendar

A fixed monthly window agreed with the business is easier to keep than an ad hoc one. If the team is one person, a managed service can cover the routine and the nights.`,
    editor: { verdict: "pass", score: 7, notes: "Useful but thin. Needs a worked example before it can be cleared." },
    outcome: "draft",
  },
  {
    key: "b-masterdata",
    daysAgo: 11,
    serviceId: "datamigration",
    keyword: "sap master data cleanup before migration",
    slug: "master-data-first",
    title: "Master data first: the cutover nobody plans",
    metaDescription: "Most failed data loads trace back to master data. Give every object an owner and clean it in the source system before the migration.",
    body: `Migration plans spend weeks on the load tools and days on the data. Most failed loads trace back to master data: duplicate equipment records, functional locations nobody owns, and business partners with three addresses.

## One owner per object

Equipment, functional locations, materials, business partners: each needs a named owner in the business, not in IT. The owner decides what is a duplicate and what is real.

## Clean in the source

Fix the data in the current system, where people can see and check it. Cleaning in a spreadsheet between extract and load creates a third version of the truth.

## Rehearse the load

Run at least two full rehearsals with production data. Each one finds problems the last one hid.

Larkwell plans data migration as part of every S/4HANA move, starting with master data.`,
    editor: { verdict: "pass", score: 8, notes: "Clear and useful." },
    outcome: "posted",
  },
  {
    key: "b-generic",
    daysAgo: 4,
    serviceId: "s4hana",
    keyword: "digital transformation utilities",
    slug: "digital-transformation-utilities",
    title: "Why transformation matters for utilities",
    metaDescription: "Utilities face change on every front.",
    body: `Utilities face change on every front, from regulation to customer expectations. Transformation is no longer optional, and every organisation needs a plan for the journey ahead. A clear strategy, strong leadership and the right partner make the difference between success and failure, and the time to start is now. Teams that embrace change will be ready for what comes next, and those that wait will fall behind their peers in a market that keeps moving.`,
    editor: { verdict: "reject", score: 3, reason: "Generic: no SAP thing named and no buyer problem. Nothing a reader could act on." },
    outcome: "rejected",
  },
];

export const POSTS = [
  {
    key: "l-paper",
    daysAgo: 1,
    serviceId: "plant-maintenance",
    postType: "how-to",
    hook: "Crews close work orders on paper, then someone keys them in on Friday.",
    body: `That gap is where the asset register goes wrong: readings get rounded, defects get forgotten, and preventive plans drift away from what crews actually see.

Three things fix most of it: a tablet app with only the three screens crews need, offline mode for depots with poor signal, and a rollout one depot at a time.

Larkwell builds field apps on top of SAP PM for operators who want the register to match the assets.`,
    hashtags: ["SAPPM", "FieldService"],
    editor: { verdict: "pass", score: 8, notes: "Good hook. Cut the closing question." },
    outcome: "waiting",
  },
  {
    key: "l-patchday",
    daysAgo: 2,
    serviceId: "basis",
    postType: "how-to",
    hook: "Patch day is tomorrow. Rate the notes against your own landscape before you panic.",
    body: `A critical note for a component you do not run is not urgent for you. A medium note for your billing system might be.

Read the notes on the day, rate them against what you run, patch development first, and write the rollback before you start.

Larkwell runs monthly patch windows for SAP estates that cannot go down.`,
    hashtags: ["SAPBasis", "SAP"],
    editor: { verdict: "pass", score: 9, notes: "Timely and specific." },
    outcome: "waiting",
  },
  {
    key: "l-brackenfield",
    daysAgo: 6,
    serviceId: "plant-maintenance",
    postType: "case-study",
    hook: "Brackenfield Waste's crews now close work orders at the bin lorry, not in the office.",
    body: `Brackenfield Waste ran SAP PM, but work orders were closed on paper and keyed in at the end of the week. The asset register lagged behind the fleet.

Larkwell built a small Fiori app for the depot tablets: today's jobs, close a job with readings and photos, raise a defect. The office kept its screens. The rollout went one depot at a time.

Same process, no double keying, and the register is current again.`,
    hashtags: ["SAPFiori", "WasteManagement"],
    editor: { verdict: "pass", score: 9, notes: "Named client is on the approved list. Outcome stated without figures." },
    outcome: "approved",
    approvedBy: "Jonas",
  },
  {
    key: "l-exceptions",
    daysAgo: 9,
    serviceId: "billing",
    postType: "hot-take",
    hook: "Billing exceptions are a process problem, not a headcount problem.",
    body: `Adding people to the exception queue clears the backlog for a month and hides why it grew.

Group a month of exceptions by cause. Fix the top two at the point where the bad data enters. Automate what is left.

That is the work Larkwell does with utilities before they move billing to S/4HANA.`,
    hashtags: ["SAPISU", "Utilities"],
    editor: { verdict: "pass", score: 8, notes: "Clear stance." },
    outcome: "posted",
  },
  {
    key: "l-copilot",
    daysAgo: 0,
    serviceId: "abap",
    productId: "copilot",
    postType: "how-to",
    hook: "A short dump at seven in the morning, and the developer who wrote the code left last year.",
    body: `Larkwell Copilot reads the dump, finds the custom code behind it and explains what it does in plain language. It can propose a fix in the development system, after syntax and quality checks run in code.

Only a person releases the transport, and every step is in the audit trail.`,
    hashtags: ["SAPABAP", "SAPAI"],
    outcome: "unedited",
  },
  {
    key: "l-founder",
    daysAgo: 0,
    serviceId: "managed",
    postType: "founder",
    hook: "We said no to a project last month, and it was the right call.",
    body: `The client wanted a big-bang cutover over a bank holiday weekend, with billing and maintenance going live together. We could not make that safe, so we said so.

They found another partner. I would rather lose the work than run a cutover I would not run on my own systems.`,
    hashtags: ["SAP", "S4HANA"],
    outcome: "unedited",
  },
  {
    key: "l-rejected",
    daysAgo: 3,
    serviceId: "integration",
    postType: "hot-take",
    hook: "Is your integration landscape ready for the future?",
    body: `In today's landscape, integration is more important than ever. Organisations must embrace modern approaches to stay ahead. Are you ready?`,
    hashtags: ["SAP"],
    editor: { verdict: "reject", score: 2, reason: "Rhetorical-question hook and no specific SAP point." },
    outcome: "rejected",
  },
];

export const COMPETITORS = [
  {
    name: "Fernhollow Partners",
    domain: "fernhollow.example",
    positioning: "A UK SAP consultancy for water and energy utilities, selling billing and customer service expertise.",
    serviceOverlap: ["billing", "s4hana", "managed"],
    contentThemes: ["IS-U to S/4HANA Utilities", "regulatory reporting", "customer service portals"],
    keywordOverlap: ["sap utilities billing consultant", "sap is-u to s/4hana utilities"],
    gaps: ["Nothing on plant maintenance or field crews", "No practical content on clearing billing exceptions", "No waste-sector references"],
    strengths: ["Deep billing expertise", "Long list of utility references"],
    sources: ["https://fernhollow.example/", "https://fernhollow.example/insights/"],
    note: "Invented competitor for the demo.",
  },
  {
    name: "Quayside Systems",
    domain: "quayside-systems.example",
    positioning: "A mid-market S/4HANA migration boutique with fixed-price conversion packages.",
    serviceOverlap: ["s4hana", "assessment", "abap", "datamigration"],
    contentThemes: ["fixed-price conversions", "readiness checks", "custom code"],
    keywordOverlap: ["s/4hana readiness check", "brownfield s/4hana conversion", "sap custom code migration"],
    gaps: ["Generic across industries, nothing for operators with crews and depots", "No content on cutover around billing runs"],
    strengths: ["Strong migration content", "Clear pricing pages"],
    sources: ["https://quayside-systems.example/"],
    note: "Invented competitor for the demo.",
  },
  {
    name: "Harlow & Penn",
    domain: "harlowpenn.example",
    positioning: "A field-mobility specialist selling crew apps across several ERPs.",
    serviceOverlap: ["plant-maintenance", "fiori"],
    contentThemes: ["mobile workforce", "offline apps", "crew productivity"],
    keywordOverlap: ["sap field service management", "sap fiori tablet offline"],
    gaps: ["Thin on SAP PM configuration and preventive plans", "No content on asset register quality"],
    strengths: ["Polished demos", "Strong offline story"],
    sources: ["https://harlowpenn.example/"],
    note: "Invented competitor for the demo.",
  },
  {
    name: "Brightmoor Digital",
    domain: "brightmoor.example",
    positioning: "An application managed services provider for SAP, sold on round-the-clock cover.",
    serviceOverlap: ["managed", "basis"],
    contentThemes: ["24x7 support", "service levels", "cost predictability"],
    keywordOverlap: ["sap basis managed service", "sap application managed services uk"],
    gaps: ["No industry focus", "Little on patching routines a client could follow"],
    strengths: ["Large support team", "Clear service levels"],
    sources: ["https://brightmoor.example/"],
    note: "Invented competitor for the demo.",
  },
  {
    name: "Kestrel Grid Consulting",
    domain: "kestrelgrid.example",
    positioning: "A Dutch SAP firm for grid operators and energy networks.",
    serviceOverlap: ["plant-maintenance", "s4hana", "integration"],
    contentThemes: ["grid asset management", "integration with GIS", "S/4HANA for networks"],
    keywordOverlap: ["sap plant maintenance consultant", "sap integration monitoring"],
    gaps: ["Nothing for waste operators", "No English-language field service content"],
    strengths: ["Asset management depth", "Integration with GIS systems"],
    sources: ["https://kestrelgrid.example/"],
    note: "Invented competitor for the demo.",
  },
];

export const FINDINGS = [
  { daysAgo: 1, front: "content-seo", title: "Few pages answer 'SAP PM mobile work orders' with SAP detail", summary: "The top results are vendor product pages for generic mobile apps. None explains how work orders, notifications and readings flow back into SAP PM. Larkwell should own this with a practical guide.", url: "https://harlowpenn.example/", sources: ["https://harlowpenn.example/"] },
  { daysAgo: 2, front: "messaging", title: "Utility buyers search for billing exceptions by symptom", summary: "Searches name the symptom (implausible reads, move-in dates), not the module. Larkwell's billing content should lead with the symptom and name the SAP fix second.", url: "https://fernhollow.example/insights/", sources: ["https://fernhollow.example/insights/"] },
  { daysAgo: 3, front: "competitor-gaps", title: "No competitor writes for waste operators", summary: "Of the five firms on file, none has content for waste collection or recycling operators. Brackenfield Waste gives Larkwell a credible angle.", url: "https://quayside-systems.example/", sources: ["https://quayside-systems.example/"] },
  { daysAgo: 4, front: "technical-seo", title: "Service pages have no FAQ structured data", summary: "The plant maintenance and billing service pages answer common questions in prose but carry no FAQ markup. Adding it is a small change.", url: "https://larkwell.example/services/", sources: ["https://larkwell.example/services/"] },
  { daysAgo: 6, front: "social", title: "Patch-day posts get read by Basis leads", summary: "Short, practical posts on the day of the SAP security notes reach Basis leads. Larkwell should post one each month, written the day before.", url: "https://support.sap.com/", sources: ["https://support.sap.com/"] },
  { daysAgo: 8, front: "brand-proof", title: "Buyers want named references from their own sector", summary: "Utility and waste buyers look for a reference in their own sector before booking a call. Larkwell's two named clients should be on the home page.", url: "https://larkwell.example/", sources: ["https://larkwell.example/"] },
];

export const QUEUE = [
  { topic: "How do waste operators schedule preventive maintenance for bin lorries in SAP PM?", front: "content-seo", priority: 5, rationale: "Plan for this week: field service theme", createdBy: "strategist" },
  { topic: "What changes for meter-to-cash when IS-U moves to S/4HANA Utilities?", front: "messaging", priority: 4, rationale: "Billing pillar has one post this month", createdBy: "jarvis" },
  { topic: "Re-profile Harlow & Penn: any new SAP PM content?", front: "competitor-gaps", priority: 3, rationale: "Last researched a fortnight ago", createdBy: "jarvis" },
];

export const DIRECTIVES = [
  { kind: "build", text: "Write for operators with depots and crews: waste, water, grid. Name the sector in the first line.", front: "messaging" },
  { kind: "build", text: "One monthly patch-day post for Basis leads, written the day before.", front: "social" },
  { kind: "avoid", text: "No 'digital transformation' framing. Name the SAP thing instead.", front: "messaging" },
  { kind: "avoid", text: "No rhetorical-question hooks.", front: "social" },
];

export const RECOMMENDATIONS = [
  { front: "landing-pages", title: "Put both named clients on the home page", detail: "Add Brackenfield Waste and Osterby Utilities as short reference cards under the hero, each linking to its case page.", effort: "small" },
  { front: "content-seo", title: "Write the SAP PM mobile work orders guide", detail: "A long-form guide that answers the query in the first paragraph and covers offline, rollout and measurement.", effort: "medium" },
];

// Weekly reports the agents filed. daysAgo picks the day.
export const SEO_REPORT = {
  daysAgo: 1,
  title: "SEO audit: service pages",
  headline: "Service pages are sound; two titles are cut off in search and FAQ markup is missing.",
  body: `## What I checked
Eight service pages and the home page: title, meta description, canonical, headings, structured data, alt text and internal links.

## Findings
- The plant maintenance and billing pages have titles longer than search shows; both are cut mid-phrase.
- No page carries FAQ structured data, though three answer common questions.
- The home page does not link to either case page.

## Not a problem
Canonicals, language tags and headings are correct everywhere.`,
  pages: ["/", "/services/plant-maintenance/", "/services/billing/", "/services/s4hana/", "/services/basis/"],
  actions: [
    { title: "Shorten two service page titles", detail: "Plant maintenance: 'SAP plant maintenance for operators | Larkwell'. Billing: 'SAP utilities billing support | Larkwell'.", why: "Both are cut off in search results.", effort: "small", page: "/services/plant-maintenance/" },
    { title: "Add FAQ markup to three service pages", detail: "Mark up the existing question-and-answer sections on plant maintenance, billing and S/4HANA.", why: "Eligible for richer results at no content cost.", effort: "small", page: "/services/billing/" },
  ],
};

export const MEASUREMENT_REPORT = {
  daysAgo: 5,
  title: "Results for the week",
  headline: "Search clicks steady; the master data blog brought the first enquiry from a waste operator.",
  body: `## Search
Clicks and impressions are steady week on week. The master data blog entered the results for its target query.

## Site
One contact form enquiry, from a waste operator, after reading the master data blog.

## Tracking
The contact form event fires on every page checked. No tag problems found.`,
  metrics: { clicks: 214, impressions: 9120, enquiries: 1, blogViews: 388 },
  actions: [{ title: "Link the master data blog from the S/4HANA page", detail: "Add a short 'read next' link at the end of the S/4HANA service page.", why: "The blog converts; the service page gets more traffic.", effort: "small", page: "/services/s4hana/" }],
};

export const WEEK_PLAN = {
  daysAgo: 5,
  focus: "Field service for operators: own the SAP side of crews, work orders and tablets.",
  themes: [
    { theme: "Work orders closed at the asset", serviceId: "plant-maintenance", why: "High-intent searches with weak SAP-specific answers." },
    { theme: "Billing exceptions by cause", serviceId: "billing", why: "Small but high-intent queries; no competitor answers them well." },
  ],
  pieces: [
    { kind: "blog", keyword: "sap pm mobile work orders", serviceId: "plant-maintenance", angle: "Closing work orders at the asset with a three-screen tablet app", why: "Closest gap to page one", usedBy: "b-workorders" },
    { kind: "blog", keyword: "sap is-u billing exceptions", serviceId: "billing", angle: "Measure exceptions by cause, fix the top two, then automate", why: "No competitor covers it", usedBy: "b-billing" },
    { kind: "linkedin", serviceId: "plant-maintenance", postType: "how-to", angle: "The Friday keying problem and the three-screen fix", why: "Supports the work orders blog", usedBy: "l-paper" },
    { kind: "linkedin", serviceId: "basis", postType: "how-to", angle: "Patch day: rate notes against your own landscape", why: "Monthly patch-day slot", usedBy: "l-patchday" },
    { kind: "linkedin", serviceId: "fiori", postType: "hot-take", angle: "Offline mode matters more than any feature for depot tablets", why: "Differentiates from mobility vendors" },
  ],
  avoid: ["Clean core debates", "Generic transformation framing", "Another S/4HANA deadline post"],
  research: [{ topic: "Preventive maintenance for bin lorries in SAP PM", why: "Waste operators are an open gap" }],
  notes: "Keep the Brackenfield case for a single post this week; it is the strongest proof we have.",
};

// Agent runs: [agentId, daysAgo, status, minutes, summary]
export const RUNS = [
  ["researcher", 0, "ok", 18, "Claimed 2 topics. Filed 3 findings and 12 keywords. Refreshed the Harlow & Penn profile."],
  ["editor", 0, "ok", 9, "Edited 4 drafts: passed 3, rejected 1 (rhetorical hook, no SAP point)."],
  ["researcher", 1, "ok", 22, "Claimed 2 topics. Filed 2 findings on billing exceptions."],
  ["editor", 1, "ok", 11, "Edited 3 drafts: passed 3. Cleared 1 blog for approval (9/10)."],
  ["seo", 1, "ok", 26, "Audited 8 pages. Filed 2 fixes: titles cut off in search, missing FAQ markup."],
  ["researcher", 2, "ok", 15, "Claimed 1 topic. Filed 1 finding; no new competitors."],
  ["editor", 2, "ok", 8, "Edited 2 drafts: passed 2. Cleared 1 blog for approval (8/10)."],
  ["researcher", 3, "failed", 30, "Stopped at the 30 minute limit while reading a slow site. The topic stays queued."],
  ["editor", 3, "ok", 7, "Edited 2 drafts: passed 1, rejected 1 (generic, no buyer problem)."],
  ["measurement", 5, "ok", 14, "Week's results filed. One enquiry from a waste operator."],
  ["strategist", 5, "ok", 17, "Filed next week's plan: field service for operators, 5 pieces."],
  ["researcher", 5, "ok", 20, "Claimed 2 topics. Filed 2 findings."],
  ["editor", 5, "ok", 10, "Edited 3 drafts: passed 3."],
];

export const BRIEF = {
  daysAgo: 0,
  headline: "Wrote 2 pieces for review, threw away 1 that wasn't good enough, 1 playbook change.",
  learned: ["Raised 'Name the sector in the first line' after two approvals that did."],
  discarded: [{ kind: "linkedin", title: "Is your integration landscape ready?", reason: "Rhetorical-question hook; the critic scored it 3/10.", score: 3 }],
  picks: [
    { kind: "linkedin", serviceId: "abap", postType: "how-to", why: "Product anchor: Larkwell Copilot has no post this month." },
    { kind: "linkedin", serviceId: "managed", postType: "founder", why: "Founder voice is under-used; the team approves these." },
  ],
  recommendations: [{ title: "Put both named clients on the home page", why: "Buyers look for a sector reference first" }],
  research: [{ topic: "Preventive maintenance for bin lorries in SAP PM", why: "From this week's plan" }],
  needs: ["Review today's 2 drafts in the Library: approve, edit, or reject with a reason. Every review teaches me."],
};

export const TASTE = [
  ["approved", "linkedin", "case-study", "plant-maintenance", 6],
  ["approved", "blog", "", "s4hana", 5],
  ["posted", "linkedin", "hot-take", "billing", 9],
  ["posted", "blog", "", "datamigration", 11],
  ["rejected", "linkedin", "hot-take", "integration", 3],
  ["rejected", "blog", "", "s4hana", 4],
];
