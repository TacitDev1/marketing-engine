import { useState, useEffect } from "react";
import { useDeployment, placeWords } from "../lib/deployment.js";
import {
  ChartLine,
  MagnifyingGlass,
  TrendUp,
} from "@phosphor-icons/react";
import { Card, Eyebrow, Button, Badge, StatusDot } from "../components/ui.jsx";

const CONNECTORS = [
  {
    id: "semrush",
    icon: TrendUp,
    what: "Keyword, domain, competitor and backlink data for larkwell.example.",
    setup: [
      "Open SEMrush → Profile → Subscription info → API (needs API units on your plan).",
      "Copy your API key into SEMRUSH_API_KEY in the app's .env file.",
      "Restart the app. That's it.",
    ],
    dataEndpoint: "/api/semrush/overview",
  },
  {
    id: "ga4",
    icon: ChartLine,
    what: "Real website traffic and behaviour for larkwell.example (last 28 days).",
    setup: [
      "Server (the way it's set up on a server): a Google Cloud service account JSON at GOOGLE_APPLICATION_CREDENTIALS, added as Viewer on the GA4 property and as Restricted user in Search Console; GA4_PROPERTY_ID + GSC_SITE_URL in .env.",
      "Laptop alternative (OAuth): Credentials → Create OAuth client ID → Desktop app → Download JSON → save as .secrets/oauth-client.json.",
      "Then run once: node server/google-auth.js — open the printed URL, approve with your @larkwell.example login.",
    ],
    dataEndpoint: "/api/ga4/summary",
  },
  {
    id: "gsc",
    icon: MagnifyingGlass,
    what: "What people actually search to find Larkwell (queries, clicks, positions).",
    setup: [
      "Uses the same one-time Google login as GA4 — no separate setup.",
      "Just make sure GSC_SITE_URL is set (e.g. sc-domain:larkwell.example).",
      "Once the GA4 login is done, this turns green too.",
    ],
    dataEndpoint: "/api/gsc/queries",
  },
];

export default function Connections({ active = true }) {
  const place = placeWords(useDeployment());
  const [status, setStatus] = useState(null);
  const [failed, setFailed] = useState(false);
  // null = probe not run/needed yet; true/false = does Google data actually flow?
  const [googleLive, setGoogleLive] = useState(null);

  // Refetch each time the screen becomes active (the shell keeps screens
  // mounted, so a mount-only fetch would show stale "Not connected" until a
  // hard reload after adding a key).
  useEffect(() => {
    if (!active) return;
    fetch("/api/connections")
      .then((r) => r.json())
      .then((d) => {
        setStatus(d);
        setFailed(false);
        // Don't ASSUME the service-account grant is broken — probe it. The
        // summary endpoint is cached server-side, so this is one cheap call:
        // if real data comes back, the cards show Connected; only a genuine
        // failure shows the parked note.
        // Probe BOTH auth modes: an OAuth token file can exist and be revoked, and
        // "connected" from the server is only "the file is there".
        if ((d.googleAuthMode === "service_account" || d.googleAuthMode === "oauth") && (d.ga4?.connected || d.gsc?.connected)) {
          fetch("/api/analytics/summary")
            .then((r) => setGoogleLive(r.ok))
            .catch(() => setGoogleLive(false));
        } else {
          setGoogleLive(null);
        }
      })
      .catch(() => setFailed(true));
  }, [active]);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8">
        <Eyebrow>Data</Eyebrow>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          Connections
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Plug in your live marketing data. Every connection is read-only - the
          agent can look, never change anything. Keys live in the .env file {place.onHere}{" "}
          and are never sent anywhere else. Add a key, restart, and it turns green.
        </p>
      </header>

      {failed && (
        <div className="mb-6 rounded-lg border border-line bg-canvas p-4 text-[13px] leading-relaxed text-muted">
          <strong className="text-ink">Jarvis is starting up.</strong> Connection status will
          load once it's ready. Give it a moment, then refresh.
        </div>
      )}

      {status?.googleAuthMode === "service_account" && googleLive === false && (
        <div className="mb-6 rounded-lg border border-line bg-canvas p-4 text-[13px] leading-relaxed text-muted">
          <strong className="text-ink">Google connectors aren't answering right now.</strong>{" "}
          The service-account keys are in place but Google refused the last data request.
          Usually this fixes itself; if it persists, re-check the property access grants
          for the service account. The rest of the app works fully without it.
        </div>
      )}

      <div className="space-y-4">
        {CONNECTORS.map((c) => {
          const connected = status?.[c.id]?.connected;
          const label = status?.[c.id]?.label || c.id;
          // GA4/GSC only show "Parked" when the live probe above actually
          // failed — configured AND answering means Connected, exactly as it
          // looks. (An earlier version assumed service-account mode = broken,
          // which showed "Parked" over a working connection.)
          const parked =
            status?.googleAuthMode === "service_account" &&
            googleLive === false &&
            (c.id === "ga4" || c.id === "gsc");
          return (
            <ConnectorCard
              key={c.id}
              def={c}
              label={label}
              connected={connected}
              parked={parked}
              loading={status === null && !failed}
            />
          );
        })}
      </div>
    </div>
  );
}

function ConnectorCard({ def, label, connected, parked, loading }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const Icon = def.icon;

  async function loadData() {
    setBusy(true);
    try {
      const res = await fetch(def.dataEndpoint);
      setData(res.ok ? await res.json() : { error: "Could not load - check the setup." });
    } catch {
      setData({ error: "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <Icon size={20} weight="fill" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{label}</h3>
            {!loading &&
              (parked ? (
                <Badge tone="warn"><StatusDot tone="idle" /> Parked</Badge>
              ) : connected ? (
                <Badge tone="good"><StatusDot tone="good" /> Connected</Badge>
              ) : (
                <Badge tone="neutral"><StatusDot tone="idle" /> Not connected</Badge>
              ))}
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{def.what}</p>

          {parked && (
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Configured, but the last data request was refused — see the note above.
            </p>
          )}

          {!connected && !parked && (
            <ol className="mt-3 space-y-1.5">
              {def.setup.map((step, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-muted">
                  <span className="font-mono text-faint">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          )}

          {connected && !parked && (
            <div className="mt-3">
              <Button variant="outline" onClick={loadData} disabled={busy}>
                {busy ? "Loading…" : "Check it's working"}
              </Button>
              {data && (
                data.error ? (
                  <p className="mt-3 text-[13px] text-warn">{data.error}</p>
                ) : (
                  <div className="mt-3">
                    <p className="flex items-center gap-1.5 text-[13px] text-good">
                      <StatusDot tone="good" /> Live data is coming through.
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[12px] text-faint hover:text-muted">
                        Technical detail
                      </summary>
                      <pre className="scroll-quiet mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-canvas p-3 text-[12px] leading-relaxed text-ink-2">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    </details>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
