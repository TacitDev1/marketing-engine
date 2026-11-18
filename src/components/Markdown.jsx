// Small dependency-free Markdown renderer for readable previews. Covers what
// the site's blog/news content actually uses so the in-app review matches what
// Astro publishes: headings, ordered + unordered lists, links, images, inline
// and fenced code, blockquotes, bold and italic. Shared by the Blogs screen and
// the Website screen's blog reader.

// http(s), mailto and same-site relative links only. Model output and scraped
// pages flow into this renderer, so a javascript: or data: link stays text.
export function safeHref(href) {
  const h = String(href || "").trim();
  if (/^(\/(?!\/)|#|\.\.?\/)/.test(h)) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(h).protocol);
  } catch {
    return false;
  }
}

export default function Markdown({ text }) {
  const blocks = [];
  const lines = String(text || "").split("\n");
  let list = [];
  let listType = "ul"; // "ul" | "ol"
  let quote = [];
  let code = null; // { lang, lines } while inside a fenced ``` block

  const flushList = (key) => {
    if (!list.length) return;
    const items = list.map((li, i) => (
      <li key={i} className="text-[15px] leading-relaxed">
        {inline(li, `l${key}-${i}-`)}
      </li>
    ));
    blocks.push(
      listType === "ol" ? (
        <ol key={`ol${key}`} className="my-3 ml-5 list-decimal space-y-1.5 text-ink-2">
          {items}
        </ol>
      ) : (
        <ul key={`ul${key}`} className="my-3 ml-5 list-disc space-y-1.5 text-ink-2">
          {items}
        </ul>
      )
    );
    list = [];
  };

  const flushQuote = (key) => {
    if (!quote.length) return;
    blocks.push(
      <blockquote
        key={`bq${key}`}
        className="my-3 border-l-2 border-line-strong pl-4 text-[15px] italic leading-relaxed text-muted"
      >
        {quote.map((q, i) => (
          <p key={i} className="my-1">
            {inline(q, `q${key}-${i}-`)}
          </p>
        ))}
      </blockquote>
    );
    quote = [];
  };

  const flushBlocks = (key) => {
    flushList(key);
    flushQuote(key);
  };

  const pushCode = (key, codeLines) =>
    blocks.push(
      <pre
        key={`pre${key}`}
        className="scroll-quiet my-3 overflow-x-auto rounded-lg border border-line bg-canvas p-3 text-[13px] leading-relaxed text-ink-2"
      >
        <code className="font-mono">{codeLines.join("\n")}</code>
      </pre>
    );

  lines.forEach((raw, i) => {
    // Fenced code block: everything between ``` fences is kept literal.
    const fence = raw.trim().match(/^```(.*)$/);
    if (code) {
      if (fence) {
        pushCode(i, code.lines);
        code = null;
      } else {
        code.lines.push(raw);
      }
      return;
    }
    if (fence) {
      flushBlocks(i);
      code = { lang: fence[1].trim(), lines: [] };
      return;
    }

    const line = raw.trim();
    if (!line) {
      flushBlocks(i);
      return;
    }

    if (/^#{1,6}\s/.test(line)) {
      flushBlocks(i);
      const level = line.match(/^#+/)[0].length;
      const content = line.replace(/^#+\s/, "");
      blocks.push(
        level <= 2 ? (
          <h3 key={i} className="mt-5 mb-2 text-lg font-semibold text-ink">
            {inline(content, `h${i}-`)}
          </h3>
        ) : (
          <h4 key={i} className="mt-4 mb-1.5 text-[15px] font-semibold text-ink-2">
            {inline(content, `h${i}-`)}
          </h4>
        )
      );
    } else if (/^>\s?/.test(line)) {
      flushList(i); // quotes and lists don't nest here
      quote.push(line.replace(/^>\s?/, ""));
    } else if (/^\d+\.\s/.test(line)) {
      flushQuote(i);
      if (listType !== "ol") flushList(i);
      listType = "ol";
      list.push(line.replace(/^\d+\.\s/, ""));
    } else if (/^[-*]\s/.test(line)) {
      flushQuote(i);
      if (listType !== "ul") flushList(i);
      listType = "ul";
      list.push(line.replace(/^[-*]\s/, ""));
    } else {
      flushBlocks(i);
      blocks.push(
        <p key={i} className="my-2.5 text-[15px] leading-relaxed text-ink-2">
          {inline(line, `p${i}-`)}
        </p>
      );
    }
  });

  if (code) pushCode("end", code.lines); // gracefully close an unterminated block
  flushBlocks("end");
  return <div>{blocks}</div>;
}

// Inline spans: `code`, ![img](url), [link](url), **bold**, *italic* / _italic_.
// Scans for the earliest match across patterns so nesting order is predictable;
// inline code is matched first so markup inside it stays literal.
function inline(s, keyPrefix = "") {
  const patterns = [
    {
      re: /`([^`]+)`/,
      render: (m, key) => (
        <code key={key} className="rounded bg-canvas px-1 py-0.5 font-mono text-[13px] text-ink">
          {m[1]}
        </code>
      ),
    },
    {
      re: /!\[([^\]]*)\]\(([^)\s]+)\)/,
      render: (m, key) => (
        <img key={key} src={m[2]} alt={m[1]} className="my-3 max-w-full rounded-lg border border-line" />
      ),
    },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)\)/,
      // Text here comes from the model and from scraped pages: a javascript: or
      // data: link must render as plain text, never as a clickable href.
      render: (m, key) =>
        safeHref(m[2]) ? (
          <a key={key} href={m[2]} target="_blank" rel="noreferrer" className="text-brand underline">
            {m[1]}
          </a>
        ) : (
          <span key={key}>{m[1]}</span>
        ),
    },
    {
      re: /\*\*([^*]+)\*\*/,
      render: (m, key) => (
        <strong key={key} className="font-semibold text-ink">
          {m[1]}
        </strong>
      ),
    },
    {
      re: /\*([^*]+)\*|_([^_]+)_/,
      render: (m, key) => (
        <em key={key} className="italic">
          {m[1] || m[2]}
        </em>
      ),
    },
  ];

  const nodes = [];
  let rest = String(s);
  let k = 0;
  while (rest) {
    let best = null;
    for (const p of patterns) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { p, m };
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    if (best.m.index > 0) nodes.push(rest.slice(0, best.m.index));
    nodes.push(best.p.render(best.m, `${keyPrefix}i${k++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return nodes;
}
