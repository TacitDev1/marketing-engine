// The "Jarvis" planner — the orchestration layer over the brain's tools.
//
// Tobias briefs it in plain language ("draft a few posts about the S/4HANA
// 2027 deadline, lead with risk"). The model turns that into a small set of
// CONCRETE draft tasks, grounded in Larkwell's real services, target keywords, and
// the marketing wiki. The frontend then executes each task through the existing
// (proven) generators and drops every result into the Library review queue.
//
// HARD RULE: the agent only ever DRAFTS. It never posts anywhere.

import { chatJSON, clean } from "./brain.js";
import { services, postTypes } from "../src/lib/company.js";
import { getKeywords } from "./knowledge.js";
import { relevantPages } from "./wiki.js";

const PLAN_FORMAT = {
  type: "object",
  properties: {
    interpretation: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["linkedin", "blog"] },
          label: { type: "string" },
          postType: { type: "string", enum: ["case-study", "hot-take", "how-to", "founder"] },
          serviceId: { type: "string" },
          keyword: { type: "string" },
          nudge: { type: "string" },
          why: { type: "string" },
        },
        required: ["kind", "label", "why"],
      },
    },
    notes: { type: "string" },
  },
  required: ["interpretation", "tasks"],
};

const serviceIds = new Set(services.map((s) => s.id));

// Turn a free-text brief into a grounded, concrete plan of draft tasks.
export async function planFromBrief({ brief, maxTasks = 5 }) {
  const b = String(brief || "").trim();
  if (!b) throw new Error("brief required");

  // Ground the plan: relevant wiki pages + the real target keywords.
  let wikiTitles = [];
  try {
    wikiTitles = (await relevantPages(b, 6)).map((p) => `${p.title} (${p.type})`);
  } catch {
    /* wiki optional */
  }
  let allKeywords = [];
  try {
    allKeywords = getKeywords();
  } catch {
    /* keywords optional */
  }
  const topKeywords = allKeywords
    .slice(0, 25)
    .map((k) => (k.volume ? `${k.keyword} (${k.volume}/mo)` : k.keyword));

  const system = [
    "You are the marketing planner for Larkwell Consulting (SAP technical and functional",
    "consulting, plus cloud, for enterprises modernising and migrating SAP).",
    "",
    "Turn the user's brief into a SMALL, concrete plan of draft tasks. You only plan",
    "and draft - you NEVER post anything. Rules:",
    `- At most ${maxTasks} tasks. Fewer is better if that serves the brief.`,
    "- Each task is either a LinkedIn post (kind:linkedin) or a blog draft (kind:blog).",
    "- CRITICAL: put each choice in its OWN field. Do NOT describe choices inside nudge.",
    "  - postType: one of case-study | hot-take | how-to | founder (LinkedIn only).",
    "  - serviceId: ONE real service id from the list (or empty for any).",
    "  - keyword: for blogs, ONE keyword, preferably from the real keyword list.",
    "  - nudge: ONLY a short angle, under 15 words (e.g. 'lead with the 2027 deadline risk').",
    "- 'why' explains in one line how the task serves the brief.",
    "",
    "EXAMPLE (copy this structure exactly):",
    JSON.stringify(
      {
        interpretation: "Two posts on the 2027 deadline plus a cloud-cost blog.",
        tasks: [
          {
            kind: "linkedin",
            label: "S/4HANA 2027 risk post",
            postType: "hot-take",
            serviceId: "s4hana",
            keyword: "",
            nudge: "lead with the cost of waiting past 2027",
            why: "Frames the deadline as urgent.",
          },
          {
            kind: "blog",
            label: "Cloud migration cost blog",
            postType: "",
            serviceId: "cloud",
            keyword: "sap on aws",
            nudge: "focus on 3-year run cost",
            why: "Answers a real buyer cost question.",
          },
        ],
        notes: "",
      },
      null,
      0
    ),
    "",
    "Return ONLY JSON in that shape: { interpretation, tasks: [...], notes }.",
  ].join("\n");

  const user = [
    `BRIEF: ${b}`,
    "",
    "REAL Larkwell SERVICES (id - label):",
    services.map((s) => `- ${s.id} - ${s.label}`).join("\n"),
    "",
    "POST TYPES: " + postTypes.map((t) => t.id).join(", "),
    "",
    topKeywords.length ? "REAL TARGET KEYWORDS (prefer these for blogs):" : "",
    topKeywords.length ? topKeywords.map((k) => `- ${k}`).join("\n") : "",
    "",
    wikiTitles.length ? "RELEVANT WIKI TOPICS (for grounding):" : "",
    wikiTitles.length ? wikiTitles.map((t) => `- ${t}`).join("\n") : "",
    "",
    "Produce the plan now as JSON.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const plan = await chatJSON(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    PLAN_FORMAT,
    { numPredict: 1200, tier: "quality" }
  );

  // Normalise + sanitise, with recovery for the 8B's habit of stuffing structured
  // choices into the nudge text instead of the dedicated fields.
  const tasks = (plan.tasks || []).slice(0, maxTasks).map((t, i) => {
    const kind = t.kind === "blog" ? "blog" : "linkedin";
    const hay = `${t.nudge || ""} ${t.label || ""} ${t.why || ""}`.toLowerCase();

    // serviceId: use the field, else recover by id or label mention.
    let serviceId = serviceIds.has(t.serviceId) ? t.serviceId : "";
    if (!serviceId) {
      const svc = services.find(
        (s) => hay.includes(` ${s.id}`) || hay.includes(s.label.toLowerCase())
      );
      if (svc) serviceId = svc.id;
    }

    // postType: use the field, else recover from a mention, else case-study.
    let postType = postTypes.find((p) => p.id === t.postType)?.id || "";
    if (!postType) {
      postType = ["hot-take", "how-to", "founder", "case-study"].find((p) => hay.includes(p)) || "case-study";
    }

    // keyword: use the field, else (for blogs) recover the best real keyword mention.
    // Strip any "(1234/mo)" volume annotation the model copied from the prompt list.
    let keyword = clean(t.keyword || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!keyword && allKeywords.length) {
      const match = allKeywords.find((k) => hay.includes(k.keyword.toLowerCase()));
      if (match) keyword = match.keyword;
    }

    // Strip the boilerplate the model tends to write into nudge, plus dangling tails.
    let nudge = clean(t.nudge || "")
      .replace(/use\s+'?[a-z-]+'?\s+format\.?/gi, "")
      .replace(/use\s+serviceid:?\s*[a-z]+\.?/gi, "")
      .replace(/use\s+keyword\s+'[^']+'\.?/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    // Trim a dangling lead-in the model sometimes leaves ("... For instance,").
    nudge = nudge.replace(/[\s,.-]*(for instance|e\.?g\.?|such as|including)[\s,:.-]*$/i, "").trim();
    if (nudge.length > 220) nudge = nudge.slice(0, 220).replace(/\s+\S*$/, "") + "…";

    return {
      id: `t${i + 1}`,
      kind,
      label: clean(t.label) || (kind === "blog" ? `Blog: ${keyword || "draft"}` : `Post ${i + 1}`),
      postType,
      serviceId,
      keyword,
      nudge,
      why: clean(t.why || ""),
    };
  });

  // A blog task with no recoverable keyword can't run; downgrade it to a LinkedIn
  // post so the plan is always executable rather than silently failing later.
  for (const t of tasks) {
    if (t.kind === "blog" && !t.keyword) {
      t.kind = "linkedin";
      t.label = t.label.replace(/^blog:?\s*/i, "") + " (as a post - no keyword)";
    }
  }

  return {
    interpretation: clean(plan.interpretation || ""),
    notes: clean(plan.notes || ""),
    tasks,
  };
}
