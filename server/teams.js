// Posting to the team's Teams channel (a "Workflows" incoming webhook, set as
// MKT_TEAMS_WEBHOOK on the server). One card per message: a title, sections of
// plain lines, and optional buttons that open a page of the app.
//
// The app's address for those buttons is MKT_APP_URL. A link only works for
// someone who can reach the app at that address.

export const appUrl = () => (process.env.MKT_APP_URL || "http://localhost:5180").replace(/\/+$/, "");
// Opens the Library on one draft, ready to read and approve.
export const draftLink = (id) => `${appUrl()}/?screen=library&draft=${encodeURIComponent(id)}`;
export const teamsConfigured = () => !!process.env.MKT_TEAMS_WEBHOOK;

// A Teams webhook takes a message carrying one Adaptive Card.
export function teamsCard({ title, sections = [], actions = [] }) {
  const body = [{ type: "TextBlock", size: "Medium", weight: "Bolder", wrap: true, text: title }];
  for (const sec of sections) {
    if (sec.title) body.push({ type: "TextBlock", weight: "Bolder", wrap: true, spacing: "Medium", text: sec.title });
    body.push({ type: "TextBlock", wrap: true, spacing: "Small", text: sec.lines.map((l) => (sec.plain ? l : `- ${l}`)).join(sec.plain ? "\n\n" : "\n") });
  }
  const content = { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body };
  if (actions.length) content.actions = actions.slice(0, 5).map((a) => ({ type: "Action.OpenUrl", title: a.title, url: a.url }));
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content }] };
}

// Returns { channel, status: "sent" | "not_configured" | "failed", error? }; never throws.
export async function postToTeams(card, { fetcher = fetch } = {}) {
  const url = process.env.MKT_TEAMS_WEBHOOK;
  if (!url) return { channel: "teams", status: "not_configured" };
  try {
    const res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(teamsCard(card)), signal: AbortSignal.timeout(20000) });
    return res.ok ? { channel: "teams", status: "sent" } : { channel: "teams", status: "failed", error: `Teams answered ${res.status}` };
  } catch (err) {
    return { channel: "teams", status: "failed", error: String(err.message).slice(0, 160) };
  }
}
