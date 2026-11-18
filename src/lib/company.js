// ============================================================
// The company this engine writes for. EVERYTHING the drafters,
// guardrails and screens know about "us" lives here, so pointing
// the engine at a different business means editing this one file.
//
// This template ships with an INVENTED company, Larkwell Consulting,
// a fictional SAP consultancy. None of these names, clients, products
// or facts are real.
//
// The server can override a few values from .env (see server/config.js):
// MKT_SITE_URL, MKT_LINK_ALLOWLIST, MKT_COMPANY_NAME.
// ============================================================

export const company = {
  name: "Larkwell Consulting",
  // Short forms the drafts use. The guardrails treat every alias as "us"
  // (a sentence like "<alias> helped <Name>" is checked as a client claim).
  shortName: "Larkwell",
  aliases: ["Larkwell", "Larkwell Consulting"],
  ceo: "Mara",
  site: "https://larkwell.example",
  linkedin: "https://www.linkedin.com/company/larkwell-example",
  // Hosts a draft may link to. Anything else is stripped by the guardrails.
  // A host matches itself and its subdomains.
  linkHosts: ["larkwell.example", "sap.com"],
  // The one LinkedIn path drafts may link to (the company page).
  linkedinPath: "/company/larkwell-example",
  regions: ["United Kingdom", "Netherlands", "South Africa"],
  oneLiner:
    "SAP technical and functional consulting for utilities and waste operators moving to S/4HANA.",
  audience:
    "IT and SAP leaders at mid-sized utilities, waste and field-service operators planning or running an S/4HANA move.",
};

// Service lines. Drafts cite them by name. `demand` is a grounded note for the
// writer (here: invented, round numbers), never a result claim.
export const services = [
  {
    id: "s4hana",
    label: "S/4HANA migrations",
    blurb: "Brownfield and selective moves to SAP S/4HANA, planned around a business that cannot stop.",
    demand: "The largest theme in our keyword list (illustrative: a few thousand searches a month).",
    pains: [
      "ECC support is running out and the migration keeps slipping",
      "Custom code makes the conversion path unclear",
      "The business cannot afford a long freeze or a big-bang weekend",
    ],
  },
  {
    id: "assessment",
    label: "Migration readiness assessment",
    blurb: "A short, evidence-based look at the landscape, custom code and data before choosing a path.",
    pains: [
      "Leadership wants a decision but nobody has costed the options",
      "No clear view of which custom code to keep, fix or retire",
      "Brownfield versus greenfield is being argued on opinion",
    ],
  },
  {
    id: "plant-maintenance",
    label: "Plant maintenance and field service",
    blurb: "SAP PM and field-service processes for operators with fleets, depots and assets spread across a region.",
    demand: "Steady, specific demand from asset-heavy operators.",
    pains: [
      "Work orders are closed on paper and keyed in days later",
      "Nobody trusts the asset register",
      "Preventive maintenance plans drift from what crews actually do",
    ],
  },
  {
    id: "billing",
    label: "Utilities billing and customer service",
    blurb: "SAP IS-U and customer-service processes for meter-to-cash, from move-in to final bill.",
    pains: [
      "Billing exceptions pile up faster than the team can clear them",
      "Customer agents need five screens to answer one question",
      "Tariff changes take weeks of testing",
    ],
  },
  {
    id: "basis",
    label: "SAP Basis and operations",
    blurb: "Monitoring, patching, system copies and stable day-to-day running of the SAP estate.",
    pains: [
      "Basis knowledge sits with one person",
      "Patching and system copies always slip",
      "Out-of-hours incidents land on people with a day job",
    ],
  },
  {
    id: "abap",
    label: "ABAP development",
    blurb: "Custom ABAP build and remediation, written to be read and maintained by the next person.",
    pains: [
      "Years of undocumented Z code block the upgrade",
      "Reports change live data with no test run and no audit trail",
      "Every change needs the one developer who wrote it",
    ],
  },
  {
    id: "integration",
    label: "SAP integration",
    blurb: "Replacing brittle point-to-point interfaces with integrations that are documented and monitored.",
    pains: [
      "Integration is a tangle of interfaces nobody documented",
      "Every new connection is a one-off",
      "The S/4HANA move exposes how fragile the interfaces are",
    ],
  },
  {
    id: "fiori",
    label: "SAP Fiori and UX",
    blurb: "Fiori apps that make SAP faster for the people who use it all day, including crews on tablets.",
    pains: [
      "Users still work in classic screens and productivity suffers",
      "Field crews cannot use SAP on a tablet",
      "Every app looks and behaves differently",
    ],
  },
  {
    id: "datamigration",
    label: "SAP data migration",
    blurb: "Planning and running the data side of a migration so cutover lands with data people trust.",
    pains: [
      "Duplicated master data threatens the migration",
      "Nobody owns the rules for what moves and what is archived",
      "A failed load could stall the cutover",
    ],
  },
  {
    id: "managed",
    label: "Application managed services",
    blurb: "Ongoing SAP support so internal teams can work on the business instead of keeping the lights on.",
    pains: [
      "Keeping the lights on eats the project team",
      "Support gaps appear across holidays and time zones",
      "Leadership wants a predictable run cost",
    ],
  },
];

// Angles for "case-study" posts. Capabilities, NOT invented metrics.
export const proofAngles = [
  "a brownfield S/4HANA conversion delivered without a big-bang weekend cutover",
  "work orders moved from paper to a tablet app the crews actually use",
  "a custom-code estate cleaned up so an upgrade could go ahead",
  "Basis operations taken over so an internal team could stop firefighting",
  "billing exceptions cut by fixing the process, not adding headcount",
];

// Voice guardrails: what the company sounds like, and what to avoid.
export const voice = {
  isLike: [
    "Plain, senior and specific. Talks like an engineer who has done the work.",
    "Honest about trade-offs. Names the risk before the upside.",
    "Calm. No hype, no exclamation marks.",
    "Writes UK English.",
  ],
  avoid: [
    "Revolutionise, unleash, seamless, next-gen, game-changer, elevate",
    "Emoji walls and hashtag spam",
    "Fake-precise metrics",
    "Em dashes as a stylistic crutch",
    "Naming a company as a client, or claiming a named company achieved a result with us, unless it is in knownClients. Never invent case studies.",
  ],
};

// Companies we may publicly name as clients. The drafter is told never to name
// any other company as a client, and the guardrails flag any named-client claim
// that is not on this list.
export const knownClients = ["Brackenfield Waste", "Osterby Utilities"];

// How the company's LinkedIn posts are shaped. The drafter follows it.
export const postStructure = [
  "Open with a specific, current SAP hook: a deadline, an SAP announcement, an analyst note, a security item, or a real client win.",
  "Explain what it means for the buyer in one short paragraph.",
  "Bridge to Larkwell in one short paragraph, naming the concrete service that fits.",
  "About 150-200 words in three short paragraphs. At most one emoji, used with intent.",
];

// The hashtag pool. Guardrails keep at most two specific tags per post.
export const standardHashtags = [
  "SAP", "S4HANA", "SAPPM", "SAPISU", "Utilities", "WasteManagement", "SAPBasis",
  "SAPABAP", "SAPFiori", "SAPIntegration", "SAPMigration", "FieldService",
  "AssetManagement", "ManagedServices", "ERP", "DigitalTransformation", "Larkwell",
];

// Two short invented posts used as style anchors in the prompt.
export const voiceSamples = [
  `SAP teams take note: this month's Security Patch Day includes a critical fix for a component most utilities still run. Unpatched systems risk remote code execution. Larkwell Consulting runs patch windows for SAP estates that cannot go down, with a tested rollback for every change.`,
  `Brackenfield Waste closed 40% of its work orders on paper. Larkwell built a Fiori app the crews use on depot tablets, linked to SAP PM, and kept the old screens for the office. Same process, no double keying, and the asset register is finally current.`,
];

// The company's own PRODUCTS. On the LinkedIn screen they sit next to the
// service lines as anchors. The drafter is told to stay inside `facts` and never
// to say anything in `doNotClaim`.
export const products = [
  {
    id: "copilot",
    label: "Larkwell Copilot",
    serviceId: "abap",
    hashtags: ["SAPAI", "MCP"],
    blurb:
      "A governed AI assistant for SAP teams: ask questions in plain language, diagnose problems and make safe changes in development systems.",
    audience: "ABAP developers, functional and Basis consultants, and SAP support teams.",
    pains: [
      "Diagnosing short dumps and failed interfaces eats hours",
      "Nobody understands the undocumented Z code",
      "The business will not let AI near SAP without governance and an audit trail",
    ],
    facts: [
      "Reads code and explains it, and diagnoses short dumps and failed interfaces",
      "Writes only in development systems, after syntax and quality checks run in code",
      "Only a person can release a transport",
      "Every action is written to an audit trail",
      "Works from a chat screen or from any MCP client",
    ],
    doNotClaim: [
      "support for releases it has not been tested on",
      "that it converts legacy code into finished apps (it scaffolds)",
      "any customer name or customer result",
      "comparisons with other vendors' assistants",
    ],
    // Mechanical backstop for doNotClaim: [regex source, what to check]
    doNotClaimPatterns: [
      ["\\bautomatic(?:ally)?\\s+convert", "automatic conversion (it scaffolds)"],
      ["\\bJoule\\b", "other vendors' assistants (no comparisons)"],
    ],
  },
  {
    id: "plant-builder",
    label: "Plant Builder",
    serviceId: "plant-maintenance",
    hashtags: ["SAPFiori", "SAPMasterData"],
    blurb: "A Fiori app that sets up SAP plants through a guided wizard, with validation, plus bulk set-up from CSV.",
    audience: "SAP master-data and logistics teams running depot or plant rollouts.",
    pains: [
      "Setting up one plant means many screens and org levels in the right order",
      "Plant data keyed by hand fails validation late",
      "Rolling out many depots at once is slow, repetitive work",
    ],
    facts: [
      "Guided wizard covering basic data, address and the related organisational units",
      "Field validation before anything is saved",
      "Bulk import and export by CSV",
      "Runs as a Fiori Launchpad tile",
    ],
    doNotClaim: [
      "specific S/4HANA release support (unverified)",
      "any customer name or customer result",
    ],
    doNotClaimPatterns: [["\\bS/4HANA\\s+(?:19|20)\\d{2}\\b", "specific S/4HANA release support (unverified)"]],
  },
];

export const postTypes = [
  { id: "case-study", label: "Case study", hint: "A real piece of work, framed as problem, approach, outcome." },
  { id: "hot-take", label: "Hot take", hint: "An opinionated, defensible position on an SAP industry topic." },
  { id: "how-to", label: "How-to", hint: "A practical tip the buyer can act on this week." },
  { id: "founder", label: "Founder voice", hint: "First person from the founder: reflective, principled, human." },
];
