// ============================================================
// Local LinkedIn draft composer.
//
// No network calls — drafts are assembled on-device from the Larkwell
// knowledge base (company.js) plus the angle templates below. Re-running
// rotates the hook and angle so you get fresh variations to choose
// from. Everything is a DRAFT for manual review; nothing posts.
//
// Later: this is the seam where an LLM call would slot in. Keep the
// same return shape ({ id, type, service, hook, body, hashtags }) and
// the UI keeps working.
// ============================================================

import { services, proofAngles } from "./company.js";

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) =>
  [...arr].sort(() => Math.random() - 0.5).slice(0, n);

let counter = 0;
const nextId = () => `draft-${Date.now()}-${counter++}`;

// ---- Hashtag pools, kept tasteful (3–4 per post) ----
const baseTags = ["SAP", "S4HANA", "SAPonCloud", "ERP", "DigitalTransformation"];
const serviceTags = {
  s4hana: ["S4HANA", "SAPMigration", "ECC"],
  cloud: ["SAPonAWS", "SAPonAzure", "CloudMigration"],
  basis: ["SAPBasis", "ManagedServices"],
  abap: ["ABAP", "SAPDevelopment"],
  btp: ["SAPBTP", "SAPIntegration"],
  managed: ["ManagedServices", "SAPSupport"],
};

function tagsFor(service) {
  const set = new Set(["SAP", ...(serviceTags[service.id] || [])]);
  for (const t of pickN(baseTags, 2)) set.add(t);
  return [...set].slice(0, 4);
}

// ---- Per-type composers. Each returns { hook, body }. ----

function caseStudy(service) {
  const pain = pick(service.pains);
  const angle = pick(proofAngles);
  const hook = `${capitalize(pain)}. That is where most ${service.label} conversations actually start.`;
  const body = [
    `We see it often: ${pain}.`,
    ``,
    `The work that fixes it is rarely dramatic. For ${service.label.toLowerCase()}, it looks like ${angle}.`,
    ``,
    `What made the difference was sequencing the risk, not the slideware: agree the cutover approach early, prove it on a copy, and keep the business running while the change happens behind it.`,
    ``,
    `If you are weighing ${service.label.toLowerCase()} and the timeline keeps slipping, the bottleneck is usually a decision nobody has been asked to make yet. Happy to compare notes.`,
  ].join("\n");
  return { hook, body };
}

function hotTake(service) {
  const pain = pick(service.pains);
  const hook = `Unpopular view on ${service.label.toLowerCase()}: the technology is the easy part.`;
  const body = [
    `Most ${service.label.toLowerCase()} projects do not stall on tooling. They stall because ${pain.toLowerCase()}.`,
    ``,
    `Buying a faster migration tool does not fix an unmade decision. The teams that move fastest are the ones who name the trade-off out loud, pick an owner, and accept that "good enough and live" beats "perfect and parked".`,
    ``,
    `Curious whether others see the same pattern, or whether your blockers really are technical.`,
  ].join("\n");
  return { hook, body };
}

function howTo(service) {
  const pain = pick(service.pains);
  const steps = howToSteps(service);
  const hook = `A practical way to get ahead of one ${service.label.toLowerCase()} headache this week.`;
  const body = [
    `If ${pain.toLowerCase()}, you do not need a programme to make progress. You need one afternoon.`,
    ``,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `None of this is the full answer, but it turns a vague worry into a list you can act on. That is usually the hard part.`,
  ].join("\n");
  return { hook, body };
}

function founder(service) {
  const angle = pick(proofAngles);
  const hook = `A short reflection after another year of ${service.label.toLowerCase()} work.`;
  const body = [
    `When we started Larkwell, I was sure clients wanted certainty. What they actually want is honesty about risk, and a team that stays when it gets hard.`,
    ``,
    `The work I am proudest of this year was quiet: ${angle}. No drama, no heroics. Just careful sequencing and people who pick up the phone.`,
    ``,
    `Across our teams in the US, South Africa, and the Netherlands, that is the standard we hold. Grateful to the people who live it.`,
  ].join("\n");
  return { hook, body };
}

function howToSteps(service) {
  const generic = [
    `List the three decisions that are blocking progress, and who owns each one.`,
    `Take one system copy and prove your riskiest assumption on it before committing.`,
    `Write down the one outcome that means "done" so scope cannot drift.`,
  ];
  const byService = {
    s4hana: [
      `Run the SAP Readiness Check against a recent copy and read the simplification items, not just the score.`,
      `Sort your custom code into keep, fix, and retire before you cost the conversion.`,
      `Pick brownfield or greenfield on evidence from the check, not on a vendor preference.`,
    ],
    cloud: [
      `Right-size on real utilisation data, not the spec of your current hardware.`,
      `Model run-cost over three years including support and backup, not just compute.`,
      `Prove the security sign-off path with one non-production system first.`,
    ],
    abap: [
      `Run a clean-core / ATC scan and triage findings by upgrade-blocking severity.`,
      `For any report that changes data: add a selection screen, a test run, and a SALV log of changes.`,
      `Retire the Z-code nobody can explain before you spend a day remediating it.`,
    ],
  };
  return byService[service.id] || generic;
}

const composers = {
  "case-study": caseStudy,
  "hot-take": hotTake,
  "how-to": howTo,
  founder: founder,
};

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Public API ----

// Generate one draft. If serviceId is omitted, a service is chosen at
// random so "surprise me" still produces something grounded.
export function generateDraft(typeId, serviceId) {
  const service = serviceId
    ? services.find((s) => s.id === serviceId) || pick(services)
    : pick(services);
  const composer = composers[typeId] || caseStudy;
  const { hook, body } = composer(service);
  return {
    id: nextId(),
    type: typeId,
    service: service.id,
    serviceLabel: service.label,
    hook,
    body,
    hashtags: tagsFor(service),
    createdAt: new Date().toISOString(),
  };
}

export function draftToText(draft) {
  return `${draft.hook}\n\n${draft.body}\n\n${draft.hashtags
    .map((t) => `#${t}`)
    .join(" ")}`;
}

// Ask the local brain server for a model-written draft. Falls back to the
// offline template generator above if the server or model is unavailable, so
// the app always produces something. Returns the same draft shape plus a
// `source` of "model" or "offline".
export async function requestDraft(typeId, serviceId, opts = {}) {
  const { tone = "refined", hashtagStyle = "clean", nudge = "", productId = "" } = opts;
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: typeId,
        serviceId: productId ? undefined : serviceId || undefined,
        productId: productId || undefined,
        tone,
        hashtagStyle,
        nudge: nudge || undefined,
      }),
    });
    if (!res.ok) {
      // The brain's error body says what actually failed (model not installed,
      // Ollama down, timeout); "server 503" alone sends people to the wrong fix.
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || e.error || `server ${res.status}`);
    }
    const d = await res.json();
    if (!d.hook || !d.body) throw new Error("the model returned an empty draft");
    return {
      id: nextId(),
      type: d.type,
      // The Library's Style + Service filters read postType/serviceId; without
      // them hand-made posts landed under "Unlabeled".
      postType: d.postType || d.type,
      service: d.service,
      serviceId: d.serviceId || d.service,
      serviceLabel: d.serviceLabel,
      productId: d.productId,
      hook: d.hook,
      body: d.body,
      hashtags: d.hashtags || [],
      grounding: d.grounding || [],
      warnings: d.warnings || [],
      source: "model",
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    // Offline fallback — still grounded, just template-based. Carry the real
    // reason so the card can say what to fix instead of guessing "start Ollama".
    const offlineReason = String(err?.message || "").slice(0, 200) || "the app server didn't answer";
    // There is no template that could honestly describe a PRODUCT; better an
    // explicit failure than a random-service case study under the product's badge.
    if (productId) throw new Error(`Couldn't draft the product post: ${offlineReason}`);
    return { ...generateDraft(typeId, serviceId), postType: typeId, serviceId, source: "offline", offlineReason };
  }
}
