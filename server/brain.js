// The agent's "brain" — one swappable module.
//
// Today: a local model via Ollama (free, no API key, nothing leaves the PC).
// To upgrade later (OpenAI / Claude), only this file changes — the rest of the
// app keeps calling generateDraft() and gets the same { hook, body, hashtags }.

import {
  buildMessages,
  buildBlogPlanMessages,
  buildBlogSectionMessages,
  buildBlogClosingMessages,
  buildReactionMessages,
  buildReviseMessages,
} from "./prompts.js";
import { searchKnowledge } from "./knowledge.js";
import { wikiGrounding } from "./wiki-bridge.js";
import { fetchMany } from "./tools/web.js";
import { services, products } from "../src/lib/company.js";
import { applyToPost, applyToBlog, fitTitle, fitMeta, scrubHype, scrubDashes, isAllowedLink } from "./guardrails.js";
import { getSettings, ollamaBase } from "./settings.js";
import { recordUsage } from "./usage.js";

// A clean 3-4 hashtag set per service, for when Tobias wants the restrained
// look instead of Larkwell's big standard block.
// Boss directive (2026-07-07): at most 2 relevant, NICHE hashtags per post —
// never a stuffed block, never broad tags (#SAP alone, #marketing, #technology).
// LinkedIn downplayed hashtags; reach comes from the hook + engagement, not tags.
// One niche pair per service line.
const SERVICE_TAGS = {
  s4hana: ["S4HANA", "SAPMigration"],
  assessment: ["S4HANAReadiness", "SAPAssessment"],
  cloud: ["SAPonCloud", "CloudMigration"],
  cloudgov: ["CloudGovernance", "SAPonCloud"],
  basis: ["SAPBasis", "ManagedServices"],
  abap: ["SAPABAP", "SAPDevelopment"],
  btp: ["SAPBTP", "SAPIntegrationSuite"],
  integration: ["SAPIntegration", "SAPIntegrationSuite"],
  functional: ["SAPFunctional", "SAPFICO"],
  fiori: ["SAPFiori", "SAPUX"],
  datamigration: ["SAPDataMigration", "DataQuality"],
  analytics: ["SAPAnalytics", "SAPDatasphere"],
  industry: ["SAPIndustrySolutions", "SAPTransformation"],
  staffing: ["SAPStaffing", "SAPTalent"],
  poc: ["SAPProofOfConcept", "SAPInnovation"],
  dr: ["SAPDisasterRecovery", "BusinessContinuity"],
  managed: ["ManagedServices", "SAPSupport"],
  news: ["SAPNews", "S4HANA"], // never #SAP alone (boss directive 2026-07-07)
};
function cleanHashtags(serviceId) {
  return (SERVICE_TAGS[serviceId] || SERVICE_TAGS.s4hana).slice(0, 2);
}
// Always returns at most 2 niche tags (or none) — no code path can stuff tags.
function pickHashtags(style, serviceId) {
  if (style === "none") return [];
  return cleanHashtags(serviceId);
}

// Model/host/generation options are now read from the Settings store at
// call-time (see server/settings.js), so the Settings screen can change them
// live without a restart. Defaults there mirror the old env-var behaviour.

// JSON schema we force the model to fill, so output is always parseable.
const FORMAT = {
  type: "object",
  properties: {
    hook: { type: "string" },
    body: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
  required: ["hook", "body", "hashtags"],
};

// Shared call: send messages, force a JSON shape, return the parsed object.
// Exported so other modules (e.g. the wiki maintainer) reuse the one place that
// knows how to talk to the model — swap providers here and everything follows.
export async function chatJSON(messages, format, { numPredict, tier } = {}) {
  const s = getSettings();
  // tier "quality" routes to the bigger model when one is configured (drafting,
  // recommendations, wiki merges). Everything else stays on textModel.
  const model = tier === "quality" && s.qualityModel ? s.qualityModel : s.textModel;
  const res = await fetch(`${ollamaBase()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      // gemma4/qwen3.5 have thinking mode ON by default and would spend the
      // num_predict budget reasoning before emitting JSON. Force it off so the
      // whole budget goes to the structured output. (Every model call routes
      // through chatJSON, so this one line covers drafts, wiki and images.)
      think: false,
      format,
      keep_alive: s.keepAlive,
      options: { temperature: s.temperature, top_p: 0.9, num_predict: numPredict ?? s.numPredict, num_ctx: s.numCtx },
      messages,
    }),
    // Quality-tier calls hit the big model (e.g. gemma3:27b), which can cold-load
    // from disk for minutes on the server, so give them 8 min. Text-tier stays at
    // 120s so a wedged fast-model call still surfaces as a clean 503 rather than a
    // long spin. Without this the wiki merges/drafts silently time out.
    signal: AbortSignal.timeout(tier === "quality" ? 480000 : 120000),
  });
  if (!res.ok) throw new Error(`Ollama responded ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // Track this app's own token usage (Ollama reports prompt/eval counts).
  recordUsage({
    model,
    promptTokens: data.prompt_eval_count || 0,
    outputTokens: data.eval_count || 0,
    kind: "chat",
    nowISO: new Date().toISOString(),
  });
  // Output cut off by the token budget arrives as broken JSON. Name that
  // plainly: a bare "Unexpected end of JSON input" surfaced as "brain
  // unavailable" and sent people off checking whether Ollama was running.
  try {
    return JSON.parse(data.message.content);
  } catch {
    const err = new Error("The model's answer came back cut off or malformed. Try again; if it keeps happening, raise the output length in Settings.");
    err.code = "model_output_malformed";
    throw err;
  }
}

// Enforce the Larkwell voice rule the model sometimes ignores: no em/en dashes.
export const clean = (s) => String(s || "").replace(/\s*[—–]\s*/g, " - ").trim();

export async function isBrainAvailable() {
  try {
    const res = await fetch(`${ollamaBase()}/api/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Hard anti-slop / no-fabricated-client steer, appended to the user prompt on a
// regenerate when the first draft trips the guardrails.
const ANTISLOP_STEER =
  "REWRITE COMPLETELY. Do NOT open with a question or a run of questions. Never use: leverage, " +
  "delve, streamline, robust, unlock, seamless, empower, elevate, \"in today's ...\", \"when it comes to\", " +
  "\"not just X but Y\". Do NOT invent, name, or imply any client, company, or success story. Do NOT " +
  "advocate \"clean core\" or keeping custom code out of the digital core (Larkwell goes the opposite way). " +
  "Open with a concrete SAP-specific fact and a clear point of view. Plain, direct, human language only.";

export async function generateDraft({ type, serviceId, productId, tone = "refined", hashtagStyle = "clean", nudge = "", rules = "" }) {
  // Pull a few relevant snippets from Larkwell's real SEO/content data to ground the
  // draft's themes. Best-effort: if there's no knowledge folder, this is empty.
  let grounding = [];
  try {
    const product = productId ? products.find((p) => p.id === productId) : null;
    const svc = services.find((s) => s.id === serviceId);
    const query = product
      ? `${product.label} ${product.blurb}`
      : svc
      ? `${svc.label} ${svc.blurb} ${svc.pains.join(" ")}`
      : "SAP S/4HANA cloud migration consulting";
    // Larkwell's own documents, plus what the wiki holds on the subject (research
    // findings, what was published, what the team turned down).
    grounding = [...(await searchKnowledge(query, 3)), ...(await wikiGrounding(query, 2))];
  } catch {
    /* grounding is optional */
  }

  // One attempt: build messages (with any steer), call the model, clean+check.
  const attempt = async (extraNudge) => {
    const { system, user, serviceUsed, productUsed } = buildMessages({
      type,
      serviceId,
      productId,
      grounding,
      tone,
      nudge: `${nudge} ${extraNudge}`.trim(),
      rules,
    });
    const parsed = await chatJSON(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      FORMAT,
      { numPredict: 900, tier: "quality" }
    );
    const scrubbed = applyToPost({ hook: clean(parsed.hook), body: clean(parsed.body) });
    // Product posts: check the output against the product's do-not-claim list.
    scrubbed.productClaims = [];
    for (const [src, what] of productUsed?.doNotClaimPatterns || []) {
      if (new RegExp(src, "i").test(`${scrubbed.hook}\n${scrubbed.body}`)) scrubbed.productClaims.push(what);
    }
    return { scrubbed, serviceUsed, productUsed };
  };

  // Guardrails ENFORCED: clean in place, and if the draft still trips the slop /
  // fabricated-client gate, regenerate once with a hard steer and keep the
  // cleaner result (fewer, better — the app's #1 content rule).
  const badScore = (s) =>
    (s.slop ? s.slopHits.length : 0) + s.fabricated.length + s.clientSuccess.length + (s.cleanCore?.length || 0) + (s.productClaims?.length || 0);
  let { scrubbed, serviceUsed, productUsed } = await attempt("");
  if (badScore(scrubbed) > 0) {
    try {
      const retry = await attempt(ANTISLOP_STEER);
      if (badScore(retry.scrubbed) < badScore(scrubbed)) {
        scrubbed = retry.scrubbed;
        serviceUsed = retry.serviceUsed;
      }
    } catch {
      /* keep the first attempt if the retry fails */
    }
  }

  return {
    type,
    postType: type, // label fields the Library facets read (kept alongside `type`)
    service: serviceUsed.id,
    serviceId: serviceUsed.id,
    // A product post shows the product's name where the Library shows the service.
    serviceLabel: productUsed ? productUsed.label : serviceUsed.label,
    productId: productUsed?.id,
    hook: scrubbed.hook,
    body: scrubbed.body,
    hashtags: hashtagStyle === "none" ? [] : productUsed ? productUsed.hashtags.slice(0, 2) : pickHashtags(hashtagStyle, serviceUsed.id),
    source: "model",
    warnings: [
      ...scrubbed.warnings,
      ...(scrubbed.productClaims || []).map((what) => `Mentions ${what}. The product page doesn't back that up: check or cut it before posting.`),
    ],
    grounding: grounding.map((g) => `${g.source} · ${g.label}`),
  };
}

// Revise an existing saved draft per a human brief ("boss wants the 70% stat
// dropped"). Applies ONLY the brief, keeps the rest, and runs the full guardrail
// pipeline before the result lands back on the same Library record.
const POST_REVISE_FORMAT = {
  type: "object",
  properties: { hook: { type: "string" }, body: { type: "string" } },
  required: ["hook", "body"],
};
const BLOG_REVISE_FORMAT = {
  type: "object",
  properties: { title: { type: "string" }, metaDescription: { type: "string" }, body: { type: "string" } },
  required: ["title", "body"],
};

export async function reviseDraft({ kind, payload, instruction }) {
  const isBlog = kind === "blog";
  const { system, user } = buildReviseMessages({ kind, payload, instruction });
  // The prompt carries the whole article and the reply repeats it, so both must
  // fit in the context window (numCtx). ~3.5 chars per token, plus headroom.
  let numPredict = 900;
  if (isBlog) {
    const ctx = getSettings().numCtx || 8192;
    const promptTok = Math.ceil((system.length + user.length) / 3.5);
    const needTok = Math.ceil(String(payload.body || "").length / 3.5) + 300;
    const room = ctx - promptTok - 256;
    if (room < needTok) {
      const err = new Error(`This article is too long to rewrite in one go at the current context size (${ctx}). Raise "Context" in Settings to about ${Math.ceil((promptTok + needTok + 256) / 1024) * 1024}, or brief a shorter piece. The draft was left unchanged.`);
      err.code = "revision_too_long";
      throw err;
    }
    numPredict = Math.min(6000, room);
  }
  const parsed = await chatJSON(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    isBlog ? BLOG_REVISE_FORMAT : POST_REVISE_FORMAT,
    // The reply is the WHOLE rewritten article. The old fixed 1600 tokens was
    // less than a full blog, so the model got cut off or squeezed the article
    // to fit, and that shorter body replaced the real one.
    { numPredict, tier: "quality" }
  );
  // A revision that comes back empty or gutted must never replace the draft.
  // (A real "make it shorter" brief still passes: the floor is 35%.)
  const beforeBody = String(payload.body || "").trim();
  const afterBody = String(parsed.body || "").trim();
  const floor = isBlog ? Math.max(200, beforeBody.length * 0.35) : Math.max(40, beforeBody.length * 0.25);
  if (afterBody.length < floor) {
    const err = new Error(`The model's revision came back ${afterBody.length ? "far too short" : "empty"} (${afterBody.length} vs ${beforeBody.length} characters), so the draft was left unchanged. Try the brief again.`);
    err.code = "revision_gutted";
    throw err;
  }

  // The 8B sometimes compresses what it was told to leave alone. Can't know the
  // brief's intent mechanically, so warn instead of blocking when the revision
  // came back much shorter than the original.
  const shrinkWarning = (before, after) =>
    after.length < before.length * 0.75
      ? [`The revision came back noticeably shorter than the original (${after.length} vs ${before.length} chars) - check nothing you wanted kept was dropped.`]
      : [];

  // The 8B reliably invents a new hook/title even when told not to. Preserve
  // the original mechanically unless the brief explicitly targets it.
  const briefTargetsOpening = /\b(hook|opening|headline|first line|title)\b/i.test(instruction);

  if (isBlog) {
    const scrubbed = applyToBlog({
      title: clean(parsed.title),
      metaDescription: clean(parsed.metaDescription ?? payload.metaDescription),
      body: clean(parsed.body),
    });
    const title = briefTargetsOpening ? scrubbed.title : payload.title || scrubbed.title;
    const meta = /\b(meta|description)\b/i.test(instruction) ? scrubbed.metaDescription : payload.metaDescription || scrubbed.metaDescription;
    return {
      payload: { ...payload, title, metaDescription: meta, body: scrubbed.body },
      changes: { title, metaDescription: meta, body: scrubbed.body },
      warnings: [...scrubbed.warnings, ...shrinkWarning(String(payload.body || ""), scrubbed.body)],
    };
  }
  const scrubbed = applyToPost({ hook: clean(parsed.hook), body: clean(parsed.body) });
  let hook = scrubbed.hook;
  let body = scrubbed.body;
  if (!briefTargetsOpening && payload.hook) {
    hook = payload.hook;
    // …and if the model shuffled the original hook into the body, drop the duplicate.
    const oh = String(payload.hook).trim();
    if (oh && body.trim().startsWith(oh)) body = body.trim().slice(oh.length).replace(/^\s+/, "");
  }
  const before = `${payload.hook || ""}\n${payload.body || ""}`;
  return {
    payload: { ...payload, hook, body },
    changes: { hook, body },
    warnings: [...scrubbed.warnings, ...shrinkWarning(before, `${hook}\n${body}`)],
  };
}

// React to one or several real articles: fetch them, then draft a Larkwell-style
// post. With multiple URLs the model synthesises a single fresh angle across them.
export async function generateFromUrl({ url, urls, tone = "refined", hashtagStyle = "clean", nudge = "", rules = "" }) {
  const requested = urls && urls.length ? urls : url ? [url] : [];
  if (!requested.length) throw new Error("no url provided");

  const { articles, failed } = await fetchMany(requested);
  if (!articles.length) {
    throw new Error(failed[0]?.error || "could not read any of those links");
  }

  const { system, user } = buildReactionMessages({ articles, tone, nudge, rules });
  const parsed = await chatJSON(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    FORMAT,
    { numPredict: 900, tier: "quality" }
  );

  const scrubbed = applyToPost({ hook: clean(parsed.hook), body: clean(parsed.body) });

  const domains = articles.map((a) => {
    try {
      return new URL(a.url).hostname.replace(/^www\./, "");
    } catch {
      return a.url;
    }
  });

  // Real Larkwell reaction posts include the source link(s) in the body, but only when
  // the source is SAP itself. Any other source (a vendor blog, a competitor, a
  // publisher) would send our readers elsewhere, so it stays in `sources` for the
  // reviewer and out of the post (Mara, 2026-09-22).
  const inPost = articles.map((a) => a.url).filter(isAllowedLink);
  const body = inPost.length ? `${scrubbed.body}\n\n${inPost.join("\n")}` : scrubbed.body;
  const warnings = [...scrubbed.warnings];
  if (inPost.length < articles.length) {
    warnings.push(`Source link left out of the post (not Larkwell or SAP): ${domains.filter((_, i) => !isAllowedLink(articles[i].url)).join(", ")}`);
  }

  return {
    type: "reaction",
    service: "news",
    serviceLabel: domains.length > 1 ? `${domains.length} sources` : domains[0],
    hook: scrubbed.hook,
    body,
    hashtags: pickHashtags(hashtagStyle, "news"),
    source: "model",
    warnings,
    grounding: articles.map((a) => `web: ${a.title || a.url}`),
    sources: articles.map((a) => a.url),
    failed,
  };
}

const BLOG_PLAN_FORMAT = {
  type: "object",
  properties: {
    title: { type: "string" },
    metaDescription: { type: "string" },
    slug: { type: "string" },
    outline: { type: "array", items: { type: "string" } },
    intro: { type: "string" },
  },
  required: ["title", "metaDescription", "slug", "outline", "intro"],
};

const SECTION_FORMAT = {
  type: "object",
  properties: { markdown: { type: "string" } },
  required: ["markdown"],
};

// Generate an SEO-targeted blog draft for a real target keyword.
// Staged: a small local model writes a full-length, coherent article far more
// reliably section-by-section than in one shot (where it stops at ~500 words).
export async function generateBlog({ keyword, serviceId, nudge = "", rules = "" }) {
  let grounding = [];
  try {
    grounding = [...(await searchKnowledge(`${keyword} ${serviceId || ""}`, 4)), ...(await wikiGrounding(`${keyword} ${serviceId || ""}`, 3))];
  } catch {
    /* optional */
  }

  const chat = (msgs, format, numPredict) =>
    chatJSON([{ role: "system", content: msgs.system }, { role: "user", content: msgs.user }], format, { numPredict, tier: "quality" });

  // 1) Plan: title, meta, slug, outline, intro.
  const plan = await chat(
    buildBlogPlanMessages({ keyword, serviceId, grounding, nudge, rules }),
    BLOG_PLAN_FORMAT,
    1100
  );
  const outline = (plan.outline || []).map(clean).filter(Boolean).slice(0, 9);

  // 2) Write each section as its own focused call (~250-350 words each).
  const sections = [];
  for (const heading of outline) {
    try {
      const sec = await chat(
        buildBlogSectionMessages({ keyword, serviceId, title: plan.title, heading, outline, grounding, nudge, rules }),
        SECTION_FORMAT,
        1200
      );
      const md = clean(sec.markdown);
      if (md) sections.push(md);
    } catch {
      /* skip a section that fails; keep the article */
    }
  }

  // 3) Closing: how Larkwell helps + takeaway + related reading.
  let closing = "";
  try {
    const c = await chat(
      buildBlogClosingMessages({ keyword, serviceId, title: plan.title }),
      SECTION_FORMAT,
      700
    );
    closing = clean(c.markdown);
  } catch {
    /* optional */
  }

  // Every section call can fail on its own (timeouts on a cold big model,
  // cut-off output). The article used to come back with a title and meta but
  // NO body, which then got saved and scheduled as an empty blog. Refuse that.
  if (!sections.length) {
    const err = new Error("The model planned the article but none of its sections came back (the model may be slow or overloaded). Nothing was saved; try again.");
    err.code = "blog_sections_failed";
    throw err;
  }
  const body = [clean(plan.intro), ...sections, closing].filter(Boolean).join("\n\n");

  const slug = String(plan.slug || keyword)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Guardrails: fit title to 60 chars, meta to 160, soften hype, flag inventions.
  const g = applyToBlog({
    title: clean(plan.title),
    metaDescription: clean(plan.metaDescription),
    body,
  });

  return {
    keyword,
    serviceId: serviceId || null,
    title: g.title,
    metaDescription: g.metaDescription,
    slug,
    outline,
    body: g.body,
    source: "model",
    warnings: g.warnings,
    // The 60-char fit had to cut the model's title; the session critic asks for
    // a new one instead (not saved: the critic removes it).
    titleCut: g.titleCut || undefined,
    grounding: grounding.map((gg) => `${gg.source} · ${gg.label}`),
  };
}

// On-page SEO brief for a single target keyword — the "meta recommendations"
// the SEO screen needs: a ready-to-paste title tag, meta description, slug, H1,
// intent, the H2s to cover, and related keywords. Length-fitted defensively.
const SEO_BRIEF_FORMAT = {
  type: "object",
  properties: {
    titleTag: { type: "string" },
    metaDescription: { type: "string" },
    slug: { type: "string" },
    h1: { type: "string" },
    intent: { type: "string" },
    subtopics: { type: "array", items: { type: "string" } },
    relatedKeywords: { type: "array", items: { type: "string" } },
  },
  required: ["titleTag", "metaDescription", "slug", "h1", "intent", "subtopics", "relatedKeywords"],
};

export async function generateSeoBrief({ keyword, stage = "", contentType = "" }) {
  if (!keyword) throw new Error("keyword required");
  const messages = [
    {
      role: "system",
      content: [
        "You are an SEO strategist for Larkwell Consulting, an SAP technical and functional consultancy for utilities and waste operators (S/4HANA migrations, plant maintenance, billing, Basis, ABAP, managed services).",
        "Produce an on-page SEO brief for ONE target keyword. Return ONLY JSON:",
        '- "titleTag": SEO title tag, 50-60 chars, includes the keyword, compelling but not clickbait.',
        '- "metaDescription": 140-160 chars, includes the keyword, one concrete benefit and a soft CTA.',
        '- "slug": short url slug, lowercase, hyphen-separated, no stop words.',
        '- "h1": the on-page H1 (may differ slightly from the title tag).',
        '- "intent": one short phrase naming the search intent and what the reader wants.',
        '- "subtopics": 4-6 H2 sections the page must cover to satisfy that intent.',
        '- "relatedKeywords": 4-6 secondary keywords to include naturally.',
        "Senior and specific. No hype, no em dashes, no fabricated stats or client names.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Target keyword: "${keyword}"${stage ? `\nBuyer stage: ${stage}` : ""}${contentType ? `\nSuggested content type: ${contentType}` : ""}\n\nWrite the SEO brief now as JSON.`,
    },
  ];
  const out = await chatJSON(messages, SEO_BRIEF_FORMAT, { numPredict: 500, tier: "quality" });
  // Soften Larkwell's banned hype words (the 8B still slips "seamless" in) AND strip
  // em dashes (a hard brand rule) — every field here gets copied straight into
  // the site via the SEO screen, so nothing may skip the scrub. Keyword lists
  // get dashes-only, so a legitimate target keyword isn't reworded by the hype
  // scrub.
  const clean = (v) => scrubDashes(scrubHype(String(v || "")).text).text;
  const dashOnly = (v) => scrubDashes(String(v || "")).text;
  const titleTag = fitTitle(clean(out.titleTag), 60);
  const metaDescription = fitMeta(clean(out.metaDescription), 160);
  const slug = (out.slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return {
    keyword,
    titleTag,
    metaDescription,
    slug,
    h1: clean(out.h1),
    intent: clean(out.intent),
    subtopics: Array.isArray(out.subtopics) ? out.subtopics.slice(0, 8).map(clean) : [],
    relatedKeywords: Array.isArray(out.relatedKeywords) ? out.relatedKeywords.slice(0, 8).map(dashOnly) : [],
    checks: {
      titleLen: titleTag.length,
      metaLen: metaDescription.length,
      titleHasKeyword: titleTag.toLowerCase().includes(String(keyword).toLowerCase()),
    },
  };
}

export function brainInfo() {
  const s = getSettings();
  return { model: s.textModel, host: ollamaBase() };
}
