// The ASCII poster's artwork and colours. Shared by the poster screen and by
// the server, which draws posters unattended (server/post-images.js).

// ---------- SAP artwork library (plain line icons) ----------
const H0 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><g fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">';
const H1 = "</g></svg>";
const ic = (inner) => H0 + inner + H1;
export const ICONS = [
  { name: "Cloud", svg: ic('<path d="M30 68 a13 13 0 0 1 3 -25 a17 17 0 0 1 33 -2 a12 12 0 0 1 4 27 Z"/>') },
  { name: "Database", svg: ic('<ellipse cx="50" cy="26" rx="28" ry="10"/><path d="M22 26 V74 a28 10 0 0 0 56 0 V26"/><path d="M22 44 a28 10 0 0 0 56 0"/><path d="M22 60 a28 10 0 0 0 56 0"/>') },
  { name: "Server", svg: ic('<rect x="22" y="24" width="56" height="15" rx="4"/><rect x="22" y="43" width="56" height="15" rx="4"/><rect x="22" y="62" width="56" height="15" rx="4"/><circle cx="31" cy="31.5" r="2.6" fill="#fff" stroke="none"/><circle cx="31" cy="50.5" r="2.6" fill="#fff" stroke="none"/><circle cx="31" cy="69.5" r="2.6" fill="#fff" stroke="none"/>') },
  { name: "Globe", svg: ic('<circle cx="50" cy="50" r="27"/><ellipse cx="50" cy="50" rx="12" ry="27"/><line x1="23" y1="50" x2="77" y2="50"/><path d="M28 36 H72"/><path d="M28 64 H72"/>') },
  { name: "Layers", svg: ic('<path d="M50 24 L76 38 L50 52 L24 38 Z"/><path d="M24 50 L50 64 L76 50"/><path d="M24 62 L50 76 L76 62"/>') },
  { name: "Shield", svg: ic('<path d="M50 20 L75 29 V50 C75 66 64 75 50 81 C36 75 25 66 25 50 V29 Z"/><path d="M40 50 l7 7 l14 -15"/>') },
  { name: "Lock", svg: ic('<rect x="28" y="46" width="44" height="33" rx="6"/><path d="M37 46 V37 a13 13 0 0 1 26 0 V46"/><circle cx="50" cy="60" r="4" fill="#fff" stroke="none"/><line x1="50" y1="63" x2="50" y2="71"/>') },
  { name: "Key", svg: ic('<circle cx="37" cy="40" r="12"/><line x1="46" y1="49" x2="74" y2="77"/><line x1="66" y1="69" x2="73" y2="62"/><line x1="59" y1="62" x2="65" y2="56"/>') },
  { name: "Users / Roles", svg: ic('<circle cx="39" cy="40" r="11"/><path d="M21 74 a19 17 0 0 1 36 0"/><circle cx="64" cy="43" r="8.5"/><path d="M60 61 a15 13 0 0 1 21 12"/>') },
  { name: "Gear", svg: ic('<circle cx="50" cy="50" r="15"/><circle cx="50" cy="50" r="6"/><line x1="67" y1="50" x2="75" y2="50"/><line x1="33" y1="50" x2="25" y2="50"/><line x1="50" y1="33" x2="50" y2="25"/><line x1="50" y1="67" x2="50" y2="75"/><line x1="62" y1="38" x2="68" y2="32"/><line x1="38" y1="62" x2="32" y2="68"/><line x1="62" y1="62" x2="68" y2="68"/><line x1="38" y1="38" x2="32" y2="32"/>') },
  { name: "Code", svg: ic('<path d="M40 34 L24 50 L40 66"/><path d="M60 34 L76 50 L60 66"/><line x1="55" y1="30" x2="45" y2="70"/>') },
  { name: "Integration", svg: ic('<line x1="32" y1="33" x2="68" y2="37"/><line x1="33" y1="38" x2="47" y2="64"/><line x1="67" y1="42" x2="53" y2="64"/><circle cx="28" cy="30" r="8"/><circle cx="72" cy="34" r="8"/><circle cx="50" cy="70" r="8"/>') },
  { name: "Network", svg: ic('<line x1="50" y1="50" x2="28" y2="30"/><line x1="50" y1="50" x2="72" y2="30"/><line x1="50" y1="50" x2="28" y2="70"/><line x1="50" y1="50" x2="72" y2="70"/><circle cx="50" cy="50" r="8"/><circle cx="28" cy="30" r="6"/><circle cx="72" cy="30" r="6"/><circle cx="28" cy="70" r="6"/><circle cx="72" cy="70" r="6"/>') },
  { name: "Document", svg: ic('<path d="M33 20 H60 L71 31 V80 H33 Z"/><path d="M60 20 V31 H71"/><line x1="42" y1="46" x2="62" y2="46"/><line x1="42" y1="56" x2="62" y2="56"/><line x1="42" y1="66" x2="54" y2="66"/>') },
  { name: "Analytics", svg: ic('<path d="M27 22 V76 H79"/><rect x="35" y="54" width="9" height="18"/><rect x="51" y="44" width="9" height="28"/><rect x="67" y="34" width="9" height="38"/>') },
  { name: "Workflow", svg: ic('<path d="M31 44 a20 20 0 0 1 36 -10"/><path d="M69 56 a20 20 0 0 1 -36 10"/><path d="M60 28 l8 5 l-4 8"/><path d="M40 72 l-8 -5 l4 -8"/>') },
];

export const COLORS = [
  { hex: "#3fff8f", label: "Green" },
  { hex: "#a3e635", label: "Larkwell green" },
  { hex: "#ffb63d", label: "Amber" },
  { hex: "#eaeef3", label: "White" },
  { hex: "#2dd4ef", label: "Cyan" },
  { hex: "#ff5db1", label: "Magenta" },
];
