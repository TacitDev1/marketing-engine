import { useEffect, useState } from "react";
import { useDeployment, placeWords } from "../lib/deployment.js";
import { Fire, ArrowsClockwise, Coins, Lightning, Stack, ChatCircleDots } from "@phosphor-icons/react";
import { Button, Card, Eyebrow, Pill, StatTile, EmptyState } from "../components/ui.jsx";

const RANGES = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "all", label: "All time" },
];

function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
function fmtCost(n) {
  if (!n) return "$0.00";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Usage() {
  const place = placeWords(useDeployment());
  const [range, setRange] = useState("30");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  function load(r = range) {
    setLoading(true);
    fetch(`/api/usage?days=${r}`)
      .then(async (res) => {
        const d = await res.json();
        // A 500 still parses as JSON ({ available:false }); showing its missing
        // totals as "$0.00 / 0 tokens" would state a falsehood as fact.
        if (!res.ok || !d?.totals) throw new Error("usage unavailable");
        return d;
      })
      .then((d) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => {
        setData(null);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(range); /* eslint-disable-next-line */ }, [range]);

  const t = data?.totals;
  const maxDay = Math.max(1, ...(data?.byDay || []).map((d) => d.tokens));
  const empty = t && t.calls === 0;
  const allLocalFree = t && t.calls > 0 && t.cost === 0;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-6 flex items-start justify-between gap-6">
        <div>
          <Eyebrow>System</Eyebrow>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
            <Fire size={22} weight="fill" className="text-brand" /> Token usage
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            This app's own model usage — the drafts, blogs, and embeddings Jarvis generates.
            Just this app, nothing else. Local models are free; the cost estimate turns real if
            you ever point Jarvis at a paid API.
          </p>
        </div>
        <Button variant="outline" onClick={() => load()} className="shrink-0">
          <ArrowsClockwise size={16} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </header>

      {failed && !loading && (
        <Card className="mb-6 p-4 text-[13.5px] text-muted">
          <span className="font-medium text-ink">Jarvis is starting up.</span> Give it a moment and
          it'll reconnect.
        </Card>
      )}

      {/* range */}
      <div className="mb-6 flex gap-1.5">
        {RANGES.map((r) => (
          <Pill key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>
            {r.label}
          </Pill>
        ))}
      </div>

      {!data ? (
        /* A failed load must not render "$0.00 / 0 tokens" as fact — an exec
           reads calm zeros as a real number, not a failure. */
        <Card>
          <EmptyState
            icon={Stack}
            title={failed ? "Couldn't load usage" : "Loading…"}
            hint={failed ? "Jarvis may be starting up — give it a moment, then switch ranges to retry." : ""}
          />
        </Card>
      ) : empty ? (
        <Card>
          <EmptyState
            icon={Stack}
            title="No usage in this range yet"
            hint="As the app generates drafts, blogs, and embeddings, its token usage shows up here. Try “All time”, or generate a post."
          />
        </Card>
      ) : (
        <>
          {/* tiles */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile icon={Coins} label="Est. cost" value={fmtCost(t?.cost)} sub={allLocalFree ? "local model — free" : `${(t?.calls || 0).toLocaleString()} calls`} />
            <StatTile icon={Stack} label="Total tokens" value={fmtTokens(t?.tokens)} sub="prompt + output" />
            <StatTile icon={ChatCircleDots} label="Prompt" value={fmtTokens(t?.prompt)} sub="tokens in" />
            <StatTile icon={Lightning} label="Output" value={fmtTokens(t?.output)} sub="tokens out" />
          </div>

          {allLocalFree && (
            <p className="mt-3 text-[12px] text-muted">
              Cost shows $0 because Jarvis runs on a local model {place.onHere} (no billing). It'll
              populate automatically if you switch to a paid API model in Settings.
            </p>
          )}

          {/* by day */}
          <Card className="mt-6 p-6">
            <Eyebrow>Tokens per day</Eyebrow>
            {data?.byDay?.length ? (
              <div className="mt-4 flex h-40 items-end gap-1">
                {data.byDay.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date} · ${fmtTokens(d.tokens)} tokens${d.cost ? ` · ${fmtCost(d.cost)}` : ""}`}
                    className="flex-1 rounded-t bg-brand/80 transition hover:bg-brand"
                    style={{ height: `${Math.max(2, (d.tokens / maxDay) * 100)}%` }}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-muted">No activity in this range.</p>
            )}
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* by model */}
            <Card className="p-6">
              <Eyebrow>By model</Eyebrow>
              <div className="mt-3 space-y-2">
                {(data?.byModel || []).map((m) => (
                  <div key={m.model} className="flex items-center justify-between gap-3 border-b border-line pb-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{m.model || "(unknown)"}</div>
                      <div className="text-[12px] text-faint">{m.calls.toLocaleString()} calls · {fmtTokens(m.tokens)} tokens</div>
                    </div>
                    <div className="shrink-0 font-medium text-ink-2">{m.priced ? fmtCost(m.cost) : "free"}</div>
                  </div>
                ))}
                {!(data?.byModel || []).length && <p className="text-[13px] text-muted">No data.</p>}
              </div>
            </Card>

            {/* by type */}
            <Card className="p-6">
              <Eyebrow>By type</Eyebrow>
              <div className="mt-3 space-y-2">
                {(data?.byKind || []).map((k) => (
                  <div key={k.kind} className="flex items-center justify-between gap-3 border-b border-line pb-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <div className="truncate font-medium capitalize text-ink">{k.kind === "chat" ? "Drafts & text" : k.kind === "embed" ? "Embeddings (search)" : k.kind}</div>
                      <div className="text-[12px] text-faint">{k.calls.toLocaleString()} calls</div>
                    </div>
                    <div className="shrink-0 font-medium text-ink-2">{fmtTokens(k.tokens)}</div>
                  </div>
                ))}
                {!(data?.byKind || []).length && <p className="text-[13px] text-muted">No data.</p>}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
