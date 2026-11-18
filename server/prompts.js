// Builds the model prompts from the SAME knowledge base the UI uses
// (src/lib/company.js) so drafts stay factual and on-voice. No facts are
// duplicated here — only the instructions that shape them.

import {
  company,
  services,
  proofAngles,
  voice,
  postTypes,
  products,
  postStructure,
  voiceSamples,
  knownClients,
} from "../src/lib/company.js";

// Hard rule shared by every drafter: the 8B likes to invent named client wins
// (e.g. "Northwind achieved X with Larkwell Consulting"). Larkwell may only name a real, verified
// client. Stated explicitly here AND enforced by the guardrails as a backstop.
const clientRule = `NEVER write about a client success, client win, client project, or client outcome unless it is a VERIFIED Larkwell win from this list: ${knownClients.join(", ")}. This means: do NOT invent case studies; do NOT describe "a client", "our client", "a leading/mid-sized manufacturer", "a global enterprise" etc. doing anything or achieving anything with Larkwell; do NOT imply Larkwell delivered a specific result for anyone. Client stories only ever come from Larkwell directly. Instead, write about the PROBLEM SPACE, SAP itself, and Larkwell's capabilities in GENERAL terms ("Larkwell helps organisations migrate to S/4HANA"), never a specific client instance or outcome. If you have no verified win, do not tell a client story at all.`;

// The #1 content rule: NO AI-slop. Ban the tells that scream "written by an AI",
// demand specifics and a real point of view. Stated in the prompt AND enforced by
// detectSlop() in guardrails.js (autopilot regenerates once, then drops slop).
const slopRule = `Write like a real SAP expert with an opinion, NOT like an AI. This is the most important rule. BANNED words and phrases — never use any of them: leverage, robust, seamless(ly), cutting-edge, state-of-the-art, game-changer, unlock, elevate, empower, revolutionize, streamline, delve, dive in, navigate the complexities, "in today's fast-paced/ever-evolving/digital landscape", "in the world of", "when it comes to", "it's important to note", "at the end of the day", "in conclusion", "moreover", "furthermore", "additionally", "not just X, but Y", "the key is", "one thing is clear". Do NOT open with a generic scene-setter or a rhetorical question. Do NOT hedge (can/may/might/arguably) and do NOT pad with rule-of-three lists.
HOW TO WRITE (behaviours, not adjectives): Lead with the point in the first line - no wind-up. Vary sentence length; short sentences are good. Keep paragraphs to 1-3 sentences. Every claim must name a specific SAP thing (a version, module, transaction, migration step, real constraint) or a concrete situation - if you can't, cut the claim. No preamble, no filler openers, no summary/closer clichés. Read each sentence and delete it if it could appear in ANY vendor's post about ANY product. Plain, confident, human.`;

// A contrastive NEGATIVE example. Small models recognise a pattern faster when
// shown what to AVOID next to what to imitate.
const slopExample = `NEVER write like this (it is exactly the AI-slop to avoid): "In today's fast-paced digital landscape, organisations must leverage cutting-edge solutions to seamlessly navigate the complexities of S/4HANA migration and unlock transformative value. It's not just about technology, but about people."`;

// The 2-3 non-negotiables, restated as the LAST thing the model reads before it
// writes. Instruction recency matters a lot for an 8B — the final block is the
// most reliably obeyed.
const finalCheck = `FINAL CHECK before you write - all three are non-negotiable:
1) Zero banned AI-slop words/phrases, and never "not just X, but Y". No rhetorical-question or scene-setting opener.
2) Do NOT invent or imply any client, company, "our client", or success story. Speak in general terms unless naming a VERIFIED Larkwell client (${knownClients.join(", ")}).
3) Never advocate "clean core" / keeping custom code out of the digital core. Larkwell's view is the opposite: custom code is valuable business IP to modernise (not purge), and clean core is impractical purism for real estates.
4) Open with a concrete, SAP-specific fact and a clear point of view.`;

// Larkwell positioning (leadership, 2026-07-08) — Larkwell's REAL, contrarian view on clean
// core. Write FROM this stance; do not hedge it. Two pillars: (1) custom code is
// valuable business IP to modernise, not debt to purge; (2) clean core is
// impractical purism for complex real-world estates.
const positioningRule = `Larkwell POSITIONING (this is Larkwell's real view - argue FROM it, do not hedge): Larkwell rejects the "clean core" orthodoxy. Two points to make when custom code, extensions, ABAP, or the digital core come up: (1) A company's custom ABAP and in-core customisation is valuable business IP - it encodes how the business actually runs. It should be modernised and kept, NOT stripped out to chase a "clean" ideal. (2) "Clean core" is impractical dogma for complex, real-world SAP estates; Larkwell meets clients where they are with pragmatic customisation, not a purist rulebook. NEVER advocate clean core, "keep the digital core clean", or moving custom code out of the core, and never call clean core the goal, best practice, or "the modern way".`;

const typeInstructions = {
  "case-study": `Write a CASE-STUDY style post: a real piece of work framed as problem then approach then outcome. Concrete, not boastful. If you reference a result, keep it qualitative unless given a real number.`,
  "hot-take": `Write a HOT-TAKE: one opinionated, defensible position on an SAP industry topic. Senior and provocative but never glib. End by inviting discussion.`,
  "how-to": `Write a HOW-TO: a practical tip the buyer can act on this week. Use a short numbered list of 3 concrete steps inside the body.`,
  founder: `Write in FOUNDER VOICE as Mara, first person, reflective and principled. Human, not corporate.`,
};

// Extra rule when the anchor is one of Larkwell's own products (any post type).
const productRule = `The anchor is one of Larkwell's OWN PRODUCTS. Lead with the buyer's problem, then show, concretely, what the product does about it, using ONLY the listed verified facts. Never a feature dump, never a sales pitch. One clear next step at the end (learn more / talk to Larkwell).`;

// A product post anchors on the product's verified facts instead of a service.
function productBlock(product) {
  return [
    `Anchor the post on this Larkwell PRODUCT:`,
    `- Product: ${product.label}`,
    `- What it is: ${product.blurb}`,
    `- Who it is for: ${product.audience}`,
    `- Buyer pains it speaks to:`,
    ...product.pains.map((p) => `  - ${p}`),
    `- VERIFIED FACTS - the only capabilities you may state (pick the 2-3 that fit; do not list them all):`,
    ...product.facts.map((f) => `  - ${f}`),
    `- DO NOT CLAIM, imply or hint at any of these:`,
    ...product.doNotClaim.map((d) => `  - ${d}`),
  ];
}

// Tone presets — Tobias can switch between Larkwell's refined house voice and a
// punchier, more marketing-forward energy (closer to the real published feed).
const toneInstructions = {
  refined: [
    `TONE: refined and senior. Calm, specific, no hype, no exclamation marks, no emoji.`,
  ],
  punchy: [
    `TONE: punchy and marketing-forward (still senior, never glib). A bolder, more`,
    `confident hook is welcome. At most one tasteful emoji, used with intent. Energetic`,
    `but never hypey - keep Larkwell's credibility. Still no fake metrics, still no em dashes.`,
  ],
};

export function buildMessages({ type, serviceId, productId, grounding = [], tone = "refined", nudge = "", rules = "" }) {
  const service =
    services.find((s) => s.id === serviceId) ||
    services[Math.floor(Math.random() * services.length)];
  const typeMeta = postTypes.find((t) => t.id === type) || postTypes[0];
  const product = productId ? products.find((p) => p.id === productId) || null : null;
  // A product post still reports a service (the nearest line) so coverage
  // stats and hashtags keep working.
  const anchorService = product ? services.find((s) => s.id === product.serviceId) || service : service;

  const system = [
    `You are the in-house LinkedIn copywriter for ${company.name}, ${company.oneLiner}`,
    `Audience: ${company.audience}`,
    `Regions: ${company.regions.join(", ")}. CEO: ${company.ceo}.`,
    ``,
    ...(toneInstructions[tone] || toneInstructions.refined),
    ``,
    `VOICE — sound like this:`,
    ...voice.isLike.map((v) => `- ${v}`),
    ``,
    `HOW Larkwell STRUCTURES A POST (follow this shape):`,
    ...postStructure.map((s) => `- ${s}`),
    ``,
    `Two real Larkwell posts to match for tone and structure:`,
    ...voiceSamples.map((s, i) => `Example ${i + 1}: ${s}`),
    ``,
    slopExample,
    ``,
    `Keep these quality guardrails:`,
    ...voice.avoid.map((v) => `- avoid ${v}`),
    `- Do not use em dashes. Use a normal hyphen, comma, or period.`,
    `- Do not invent statistics. No fake-precise numbers.`,
    `- ${slopRule}`,
    `- ${clientRule}`,
    `- ${positioningRule}`,
    ``,
    `Return ONLY a JSON object with exactly these fields:`,
    `- "hook": one strong opening line (the scroll-stopper), no hashtags.`,
    `- "body": the post body, 90 to 180 words, real line breaks between paragraphs, no hashtags inside it.`,
    `- "hashtags": an array of 3 to 4 short hashtags WITHOUT the # symbol.`,
  ].join("\n");

  const anchor = product
    ? productBlock(product)
    : [
        `Anchor the post on this Larkwell service:`,
        `- Service: ${service.label}`,
        `- What it is: ${service.blurb}`,
        ...(service.demand
          ? [
              `- Internal note for topic choice only - do NOT mention search volumes or these numbers in the post: ${service.demand}`,
            ]
          : []),
        `- Buyer pains it speaks to:`,
        ...service.pains.map((p) => `  - ${p}`),
        `- Realistic proof angles you may draw on (do not fabricate metrics):`,
        ...proofAngles.slice(0, 3).map((a) => `  - ${a}`),
      ];

  const user = [
    typeInstructions[type] || typeInstructions["case-study"],
    ...(product ? [``, productRule] : []),
    ``,
    ...anchor,
    ``,
    ...groundingBlock(grounding),
    ...rulesBlock(rules),
    ...nudgeBlock(nudge),
    finalCheck,
    ``,
    `Write the post now as JSON. Post type: ${typeMeta.label}.`,
  ].join("\n");

  return { system, user, serviceUsed: anchorService, productUsed: product };
}

// Build prompts for a "news reaction" LinkedIn post grounded in a real article.
// Mirrors Larkwell's best-performing real posts (reactions to SAP announcements,
// Gartner/IDC notes, security news).
export function buildReactionMessages({ article, articles = null, tone = "refined", nudge = "", rules = "" }) {
  // Single source (legacy) or several sources synthesised into one angle.
  const sources = articles && articles.length ? articles : article ? [article] : [];
  const multi = sources.length > 1;

  const system = [
    `You are the in-house LinkedIn copywriter for ${company.name}, ${company.oneLiner}`,
    `Audience: ${company.audience}`,
    ``,
    ...(toneInstructions[tone] || toneInstructions.refined),
    ``,
    multi
      ? `Write ONE LinkedIn post that synthesises a single fresh angle across the ${sources.length} source articles below, in Larkwell's voice.`
      : `Write a LinkedIn post REACTING to the source article below, in Larkwell's voice.`,
    `Follow this exact shape (it is how Larkwell's best posts are built):`,
    ...postStructure.map((s) => `- ${s}`),
    ``,
    `Two real Larkwell posts to match for tone and structure:`,
    ...voiceSamples.map((s, i) => `Example ${i + 1}: ${s}`),
    ``,
    `Rules:`,
    `- Summarise the news accurately. Do NOT invent facts or quotes not in the source(s).`,
    `- Do NOT put any URL or link in the post. Never point readers to the source's product, trial or demo; the post sends readers to Larkwell, not to another company.`,
    multi ? `- Find the common thread; do not just list the articles one by one.` : ``,
    `- Connect it to a relevant Larkwell service in the "Larkwell Consulting helps..." bridge.`,
    ...voice.avoid.map((v) => `- avoid ${v}`),
    `- No em dashes. No fabricated statistics.`,
    `- ${slopRule}`,
    `- ${clientRule}`,
    `- ${positioningRule}`,
    ``,
    `Return ONLY a JSON object with these fields:`,
    `- "hook": one strong opening line tied to the news, no hashtags.`,
    `- "body": 90 to 180 words, real line breaks, no hashtags inside.`,
    `- "hashtags": array of 3 to 4 short hashtags without the # symbol.`,
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    multi ? `SOURCE ARTICLES (${sources.length})` : `SOURCE ARTICLE`,
    ...sources.map((a, i) =>
      [
        multi ? `--- Source ${i + 1} ---` : "",
        `Title: ${a.title || "(untitled)"}`,
        `URL: ${a.url}`,
        "",
        a.text,
        "",
      ].join("\n")
    ),
    ...rulesBlock(rules),
    ...nudgeBlock(nudge),
    finalCheck,
    ``,
    `Write the ${multi ? "synthesis" : "reaction"} post now as JSON.`,
  ].join("\n");

  return { system, user };
}

// Blog generation is done in stages (a small local model writes a full-length,
// coherent article far more reliably section-by-section than in one shot):
//   1. buildBlogPlanMessages  -> title, meta, slug, outline (6-9), intro
//   2. buildBlogSectionMessages -> one ## section of ~250-350 words, per heading
//   3. buildBlogClosingMessages -> "How Larkwell Consulting helps" + takeaway + related reading
// The brain assembles intro + sections + closing into the final body.

const BLOG_VOICE = [
  `NEVER do this:`,
  ...voice.avoid.map((v) => `- ${v}`),
  `- Do not use em dashes. Do not keyword-stuff. Do not invent statistics or clients.`,
  `- ${slopRule}`,
  `- ${slopExample}`,
  `- ${clientRule}`,
  `- ${positioningRule}`,
  `- Show first-hand SAP expertise (E-E-A-T): concrete, specific, real examples.`,
];

export function buildBlogPlanMessages({ keyword, serviceId, grounding = [], nudge = "", rules = "" }) {
  const service = services.find((s) => s.id === serviceId);
  const system = [
    `You are the SEO content writer for ${company.name}, ${company.oneLiner}`,
    `Audience: ${company.audience}`,
    ``,
    `Plan an in-depth, expert blog article for the Larkwell website targeting the keyword.`,
    `Senior, plain, specific. Honest about trade-offs.`,
    ...BLOG_VOICE,
    ``,
    `SEO: match the search intent exactly; the keyword goes in the title and the intro.`,
    `Plan enough sections to cover the topic AND its follow-up questions comprehensively`,
    `(this will become a ~1,500 word article, so 6 to 9 substantial sections).`,
    ``,
    `Return ONLY a JSON object with exactly these fields:`,
    `- "title": SEO title, 50 to 60 characters, keyword near the start.`,
    `- "metaDescription": 140 to 160 characters, compelling, contains the keyword.`,
    `- "slug": url-slug, lowercase words separated by hyphens.`,
    `- "outline": array of 6 to 9 distinct, non-overlapping section headings (strings,`,
    `  no "Introduction" or "Conclusion" - those are handled separately).`,
    `- "intro": a 2 to 3 sentence opening paragraph in Markdown (NO heading) that frames`,
    `  the problem and previews the article. The exact keyword must appear in it.`,
  ].join("\n");

  const user = [
    `Target keyword: "${keyword}"`,
    service
      ? `Relevant Larkwell service to weave in: ${service.label} - ${service.blurb}`
      : `Relevant Larkwell services: ${services.map((s) => s.label).join(", ")}.`,
    ``,
    ...groundingBlock(grounding),
    ...rulesBlock(rules),
    ...nudgeBlock(nudge),
    finalCheck,
    ``,
    `Plan the article now as JSON.`,
  ].join("\n");

  return { system, user };
}

export function buildBlogSectionMessages({
  keyword,
  serviceId,
  title,
  heading,
  outline = [],
  grounding = [],
  nudge = "",
  rules = "",
}) {
  const service = services.find((s) => s.id === serviceId);
  const system = [
    `You are the SEO content writer for ${company.name}, ${company.oneLiner}`,
    `You are writing ONE section of a larger SAP blog article. Write only this section.`,
    ...BLOG_VOICE,
    ``,
    `Rules for this section:`,
    `- Start with the exact heading as a Markdown H2: "## ${heading}"`,
    `- Then 2 to 4 substantial paragraphs (250 to 350 words total) of real explanation.`,
    `- Use ### sub-headings or "- " bullet lists ONLY where they genuinely help.`,
    `- Be concrete and specific to SAP (versions, components, steps, trade-offs, criteria).`,
    `- Do NOT repeat the article's intro or other sections; stay on THIS heading.`,
    `- Do NOT add a conclusion or CTA here.`,
    ``,
    `Return ONLY a JSON object: { "markdown": "## ${heading}\\n\\n..." }`,
  ].join("\n");

  const user = [
    `Article title: "${title}"`,
    `Target keyword (weave in naturally, do not stuff): "${keyword}"`,
    service ? `Larkwell service context: ${service.label} - ${service.blurb}` : ``,
    `Full outline (for context - write ONLY the one section below):`,
    ...outline.map((h) => `  - ${h}${h === heading ? "   <-- write this one" : ""}`),
    ``,
    ...groundingBlock(grounding),
    ...rulesBlock(rules),
    ...nudgeBlock(nudge),
    `Write the "${heading}" section now as JSON.`,
  ].join("\n");

  return { system, user };
}

export function buildBlogClosingMessages({ keyword, serviceId, title }) {
  const service = services.find((s) => s.id === serviceId);
  const system = [
    `You are the SEO content writer for ${company.name}, ${company.oneLiner}`,
    `Write the CLOSING of a SAP blog article. Keep it tight and genuine.`,
    ...BLOG_VOICE,
    ``,
    `Return ONLY a JSON object: { "markdown": "..." } containing, in Markdown:`,
    `- A "## How Larkwell Consulting helps" heading + ONE short paragraph (2-3 sentences) on how`,
    `  ${company.name} helps with this, grounded in real services. No fabricated clients.`,
    `- A final one-line takeaway / soft call to action (e.g. talk to Larkwell Consulting).`,
    `- A final "Related reading:" line suggesting 1 to 2 internal-link anchor topics.`,
  ].join("\n");

  const user = [
    `Article title: "${title}"`,
    `Target keyword: "${keyword}"`,
    service ? `Primary Larkwell service: ${service.label} - ${service.blurb}` : `Larkwell services: ${services.slice(0, 6).map((s) => s.label).join(", ")}.`,
    `Write the closing now as JSON.`,
  ].join("\n");

  return { system, user };
}

// Revise an EXISTING saved draft per a human brief ("boss wants X changed").
// Change only what the brief asks; keep everything that already works. Used by
// the Library's "Brief Jarvis" box, so edits land back on the same record.
export function buildReviseMessages({ kind, payload, instruction }) {
  const isBlog = kind === "blog";
  const system = [
    `You are the in-house ${isBlog ? "SEO content writer" : "LinkedIn copywriter"} for ${company.name}, ${company.oneLiner}`,
    `You are REVISING an existing ${isBlog ? "blog draft" : "LinkedIn post"} following the editor's brief.`,
    `THE MOST IMPORTANT RULE: this is an EDIT, not a rewrite. Reproduce the current draft`,
    `word-for-word and change ONLY what the brief explicitly asks for. Every sentence,`,
    `paragraph, opening line and closing line that the brief does not mention must appear`,
    `UNCHANGED in your output. If the brief ADDS something, keep everything and insert the`,
    `addition where it fits; delete or rephrase nothing else. Never shorten, summarise,`,
    `restructure or "improve" the rest.`,
    `Do not add new claims, clients, or statistics that were not there or in the brief.`,
    ``,
    slopExample,
    ``,
    `Keep these quality guardrails:`,
    `- Do not use em dashes. Use a normal hyphen, comma, or period.`,
    `- ${slopRule}`,
    `- ${clientRule}`,
    `- ${positioningRule}`,
    ``,
    isBlog
      ? `Return ONLY a JSON object with exactly: "title" (max 60 chars), "metaDescription" (140-160 chars), "body" (the full revised article in Markdown, keep the heading structure unless the brief says otherwise).`
      : `Return ONLY a JSON object with exactly: "hook" (one strong opening line, no hashtags) and "body" (the revised post body, real line breaks, no hashtags inside it).`,
  ].join("\n");

  const user = [
    `THE CURRENT DRAFT:`,
    isBlog
      ? `Title: ${payload.title || ""}\nMeta description: ${payload.metaDescription || ""}\n\n${payload.body || ""}`
      : `${payload.hook || ""}\n\n${payload.body || ""}`,
    ``,
    `EDITOR'S BRIEF (apply this, change nothing else): ${instruction}`,
    ``,
    finalCheck,
    ``,
    `LAST REMINDER, the one that matters most: output the current draft word-for-word`,
    `with ONLY the brief applied. Same opening, same paragraphs, same closing, unless the`,
    `brief names them. Nothing dropped, nothing shortened, nothing rephrased.`,
    ``,
    `Output the revised ${isBlog ? "article" : "post"} now as JSON.`,
  ].join("\n");

  return { system, user };
}

// Real Larkwell marketing intelligence (from the keyword and content data) used to
// steer themes and terminology — NOT to be quoted as if it were a client result.
function groundingBlock(grounding) {
  if (!grounding || !grounding.length) return [];
  return [
    `Larkwell's own marketing data (use ONLY to pick resonant themes and accurate`,
    `terminology — do NOT quote these numbers as project results or stuff keywords):`,
    ...grounding.map((g) => `  - [${g.source}] ${g.text.slice(0, 280)}`),
    ``,
  ];
}

// The playbook (server/playbook.js): rules learned from the team's reviews.
// Passed in as a ready-made block so prompts.js stays free of store reads.
function rulesBlock(rules) {
  const r = String(rules || "").trim();
  return r ? [r, ``] : [];
}

// A free-text editing instruction from Tobias ("shorter", "more technical",
// "lead with the security angle"). Applied on top of everything else.
function nudgeBlock(nudge) {
  const n = String(nudge || "").trim();
  if (!n) return [];
  return [`EDITOR'S ADJUSTMENT (apply this, keep everything else on-brand): ${n}`, ``];
}
