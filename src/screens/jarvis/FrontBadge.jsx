import { Badge } from "../../components/ui.jsx";

// Which pastel a "front" gets. Technical/SEO fronts read violet, everything
// else reads brand blue — so the eye can group them at a glance.
export const frontTone = (front) =>
  /seo|schema|performance|site-health|analytics|technical|competitor/.test(front || "")
    ? "violet"
    : "brand";

export function FrontBadge({ front }) {
  return <Badge tone={frontTone(front)}>{front}</Badge>;
}
