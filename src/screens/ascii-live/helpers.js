export const RAMPS = {
  classic: " .:-=+*#%@",
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  minimal: " .:*#",
  binary: " ..::0011",
};

// The artwork library and colours live in src/lib so the server can read them too.
export { ICONS, COLORS } from "../../lib/ascii-art.js";

export const CHARSETS = [
  { value: "classic", label: "Classic  .:-=+*#%@" },
  { value: "detailed", label: "Detailed (fine gradient)" },
  { value: "blocks", label: "Blocks ░▒▓█" },
  { value: "minimal", label: "Minimal  .:*#" },
  { value: "binary", label: "Binary 01" },
];

// Pull a short, clean hook sentence out of a draft for the poster headline.
export function simpleHook(d) {
  const p = d?.payload || {};
  const raw = p.hook || p.title || (p.body || "").split("\n").find((l) => l.trim()) || "";
  const cleaned = raw
    .replace(/[#*_`>]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    // strip most emoji / pictographs
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = cleaned.split(/(?<=[.!?])\s/)[0] || cleaned;
  if (firstSentence.length <= 72) return firstSentence;
  // Too long for a headline — clip at a word boundary.
  const clipped = firstSentence.slice(0, 72);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trim() + "…";
}

// Today's date as a kicker, e.g. "MON · 07 JUL".
export function todayKicker() {
  const d = new Date();
  const day = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()];
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()];
  return `${day} · ${String(d.getDate()).padStart(2, "0")} ${mon}`;
}
