// ---- markdown with [[wiki links]] ----

export default function MD({ text, onLink }) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let list = [];
  const flush = (k) => {
    if (list.length) {
      blocks.push(<ul key={`u${k}`} className="my-3 ml-5 list-disc space-y-1.5">{list.map((li, i) => <li key={i} className="text-[15px] leading-relaxed text-ink-2">{inline(li, onLink)}</li>)}</ul>);
      list = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return flush(i);
    if (/^#{1,3}\s/.test(line)) { flush(i); blocks.push(<h3 key={i} className="mt-5 mb-2 text-lg font-semibold text-ink">{inline(line.replace(/^#+\s/, ""), onLink)}</h3>); }
    else if (/^[-*]\s/.test(line)) list.push(line.replace(/^[-*]\s/, ""));
    else { flush(i); blocks.push(<p key={i} className="my-2.5 text-[15px] leading-relaxed text-ink-2">{inline(line, onLink)}</p>); }
  });
  flush("end");
  return <div>{blocks}</div>;
}

function inline(s, onLink) {
  return String(s).split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (/^\[\[[^\]]+\]\]$/.test(p)) {
      const t = p.slice(2, -2);
      return <button key={i} onClick={() => onLink?.(t)} className="rounded bg-brand/10 px-1 font-medium text-brand hover:bg-brand/20">{t}</button>;
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
    return p;
  });
}
