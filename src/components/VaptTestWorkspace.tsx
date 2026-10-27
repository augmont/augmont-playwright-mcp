'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { McpLiveView } from '@/components/McpLiveView';
import { isVaptReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import type {
  RunReport,
  RunSnapshot,
  TestStep,
  VaptFinding,
  VaptLiveMetrics,
  VaptNetworkCapture,
  VaptTestCase,
} from '@/lib/types';
import { countAttacks } from '@/lib/vapt-attacks';
import { vaptProfileHint, vaptProfileLabel } from '@/lib/vapt-profile';
import { aiKeysForRun } from '@/lib/ai-keys';

function formatWhen(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function screenshotUrl(runId: string, screenshotPath?: string) {
  if (!screenshotPath) return null;
  const file = screenshotPath.split(/[/\\]/).pop();
  if (!file) return null;
  return `/api/reports/${encodeURIComponent(runId)}/screenshot/${encodeURIComponent(file)}`;
}

function AttackStepsPanel({
  steps,
  attackTotal,
}: {
  steps: TestStep[];
  attackTotal: number;
}) {
  const attackSteps = steps.filter((s) => s.id.startsWith('vapt-check-'));
  const setupSteps = steps.filter((s) => !s.id.startsWith('vapt-check-'));
  return (
    <div className="vapt-steps-panel">
      <div className="load-metrics-section-label">
        Internal scenarios · {attackTotal} attack step{attackTotal === 1 ? '' : 's'} (login suite)
      </div>
      <ol className="vapt-attack-step-cards">
        {attackSteps.length === 0 ? (
          <li className="field-hint">Start the run to materialize internal scenarios.</li>
        ) : (
          attackSteps.map((s, i) => (
            <li key={s.id} className={`vapt-attack-step vapt-attack-step-${s.status}`}>
              <div className="vapt-attack-step-head">
                <span className="vapt-attack-num">
                  Scenario {i + 1}/{attackTotal}
                </span>
                <span className={`load-status load-status-${s.status}`}>{s.status}</span>
              </div>
              <strong>{s.label}</strong>
              {s.description ? <p className="field-hint">{s.description}</p> : null}
              {s.message ? <p className="step-msg">{s.message}</p> : null}
              {s.detail ? <pre className="vapt-evidence">{s.detail}</pre> : null}
            </li>
          ))
        )}
      </ol>
      {setupSteps.length ? (
        <>
          <div className="load-metrics-section-label" style={{ marginTop: '1rem' }}>
            Setup / gate
          </div>
          <ul className="vapt-step-list">
            {setupSteps.map((s) => (
              <li key={s.id}>
                <strong>{s.status}</strong> — {s.label}
                {s.message ? <span className="field-hint"> · {s.message}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function FindingsPanel({
  metrics,
  runId,
}: {
  metrics?: VaptLiveMetrics | null;
  runId?: string | null;
}) {
  if (!metrics) {
    return (
      <div className="load-metrics-empty">
        Start API VAPT — each attack type logs network payloads and a screenshot report overlay.
      </div>
    );
  }
  return (
    <div className="load-metrics-wrap vapt-findings-wrap">
      <div className="load-metrics-section-label">Summary</div>
      <div className="load-metrics-grid">
        <div className="load-metric-cell">
          <span className="load-metric-label">Checked</span>
          <strong className="load-metric-value">{metrics.checked}</strong>
        </div>
        <div className="load-metric-cell">
          <span className="load-metric-label">Passed</span>
          <strong className="load-metric-value">{metrics.passed}</strong>
        </div>
        <div className="load-metric-cell">
          <span className="load-metric-label">Failed</span>
          <strong className="load-metric-value">{metrics.failed}</strong>
        </div>
        <div className="load-metric-cell">
          <span className="load-metric-label">Info</span>
          <strong className="load-metric-value">{metrics.info}</strong>
        </div>
        <div className="load-metric-cell">
          <span className="load-metric-label">Network</span>
          <strong className="load-metric-value">
            {metrics.networkCaptures?.length || 0}
          </strong>
        </div>
        <div className="load-metric-cell">
          <span className="load-metric-label">AI rounds</span>
          <strong className="load-metric-value">
            {metrics.aiProbeRounds?.length || 0}
          </strong>
        </div>
      </div>

      {metrics.aiProbeRounds && metrics.aiProbeRounds.length > 0 ? (
        <>
          <div className="load-metrics-section-label">
            Runtime AI rounds (multi → fail-level on pass)
          </div>
          <ul className="vapt-findings-list">
            {metrics.aiProbeRounds.map((r, i) => (
              <li key={`${r.checkId}-${r.level}-${i}`} className={`vapt-finding vapt-finding-${r.status === 'ok' ? 'pass' : r.status === 'error' ? 'error' : 'info'}`}>
                <div className="vapt-finding-head">
                  <span className="vapt-status">{r.level}</span>
                  <span className="vapt-status">{r.status}</span>
                  <span className="vapt-status">{r.checkId}</span>
                  <strong>
                    {r.queryCount} quer{r.queryCount === 1 ? 'y' : 'ies'} · pass {r.passed} / fail{' '}
                    {r.failed} / err {r.errors}
                  </strong>
                </div>
                <p className="field-hint">
                  {r.model ? `Model: ${r.model} · ` : ''}
                  {r.detail || ''}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="load-metrics-section-label">Per-attack findings</div>
      <ul className="vapt-findings-list">
        {metrics.findings.length === 0 ? (
          <li className="field-hint">No findings yet…</li>
        ) : (
          metrics.findings.map((f: VaptFinding) => {
            const shot = runId ? screenshotUrl(runId, f.screenshotPath) : null;
            return (
              <li key={f.id} className={`vapt-finding vapt-finding-${f.status}`}>
                <div className="vapt-finding-head">
                  <span className={`vapt-sev vapt-sev-${f.severity}`}>{f.severity}</span>
                  <span className="vapt-status">{f.status}</span>
                  {f.probeRound ? (
                    <span className="vapt-status">{f.probeRound}</span>
                  ) : null}
                  {f.checkId ? <span className="vapt-status">{f.checkId}</span> : null}
                  <strong>{f.title}</strong>
                </div>
                <p className="field-hint">
                  {f.category}
                  {f.owasp ? ` · ${f.owasp}` : ''}
                  {f.cwe ? ` · ${f.cwe}` : ''}
                  {f.aiModel ? ` · AI: ${f.aiModel}` : ''}
                  {f.aiQueryLabel ? ` · ${f.aiQueryLabel}` : ''}
                </p>
                {f.requestUrl ? (
                  <p className="field-hint">
                    <strong>
                      {f.requestMethod || 'REQ'} {f.responseStatus != null ? `→ ${f.responseStatus}` : ''}
                    </strong>{' '}
                    {f.requestUrl}
                  </p>
                ) : null}
                {f.requestPayload ? (
                  <pre className="vapt-evidence">Payload: {f.requestPayload}</pre>
                ) : null}
                {f.responseSnippet ? (
                  <pre className="vapt-evidence">Response: {f.responseSnippet}</pre>
                ) : null}
                {f.evidence && !f.responseSnippet ? (
                  <pre className="vapt-evidence">{f.evidence}</pre>
                ) : null}
                {f.recommendation ? (
                  <p className="vapt-reco">
                    <strong>Remediation:</strong> {f.recommendation}
                  </p>
                ) : null}
                {shot ? (
                  <a className="vapt-shot-link" href={shot} target="_blank" rel="noreferrer">
                    Attack screenshot →
                  </a>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function NetworkPanel({ captures }: { captures?: VaptNetworkCapture[] }) {
  if (!captures?.length) {
    return (
      <div className="load-metrics-empty">
        Network tab fills as probes and browser API calls capture method, URL, payload, and response.
      </div>
    );
  }
  return (
    <div className="vapt-network-table-wrap">
      <table className="vapt-network-table">
        <thead>
          <tr>
            <th>Src</th>
            <th>Method</th>
            <th>Status</th>
            <th>URL</th>
            <th>Payload</th>
            <th>Response</th>
          </tr>
        </thead>
        <tbody>
          {[...captures].reverse().map((c) => (
            <tr key={c.id}>
              <td>{c.source}</td>
              <td>
                <code>{c.method}</code>
              </td>
              <td>{c.status ?? '—'}</td>
              <td className="vapt-net-url" title={c.url}>
                {c.url}
              </td>
              <td>
                <pre className="vapt-net-pre">{c.requestPayload || '—'}</pre>
              </td>
              <td>
                <pre className="vapt-net-pre">{c.responseSnippet || '—'}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VaptTestWorkspace({
  testId,
  testName,
}: {
  testId: string;
  testName: string;
}) {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const testMode = useAppStore((s) => s.testMode);
  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const setTestMode = useAppStore((s) => s.setTestMode);

  const ready = isVaptReady({ testMode, baseUrl });
  const [meta, setMeta] = useState<VaptTestCase | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [view, setView] = useState<'live' | 'steps' | 'network' | 'findings'>('live');
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (testMode !== 'vapt' && baseUrl) setTestMode('vapt');
    if (!ready) router.replace('/vapt');
  }, [hydrated, ready, testMode, baseUrl, router, setTestMode]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tests/${encodeURIComponent(testId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.case?.kind === 'vapt') setMeta(d.case as VaptTestCase);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [testId]);

  const attachEvents = useCallback((id: string) => {
    eventSourceRef.current?.close();
    const es = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
    eventSourceRef.current = es;
    const closeEs = () => {
      es.close();
      if (eventSourceRef.current === es) eventSourceRef.current = null;
    };
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as RunSnapshot;
        setSnapshot(data);
        if (
          data.status === 'completed' ||
          data.status === 'failed' ||
          data.status === 'stopped'
        ) {
          closeEs();
        }
      } catch {
        // ignore
      }
    };
    es.addEventListener('end', closeEs);
    es.onerror = () => {
      // EventSource reconnect storms were a major memory contributor
      closeEs();
    };
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const finished =
    snapshot?.status === 'completed' ||
    snapshot?.status === 'failed' ||
    snapshot?.status === 'stopped';

  useEffect(() => {
    if (!runId || !finished) return;
    let cancelled = false;
    let tries = 0;
    const poll = () => {
      tries += 1;
      fetch(`/api/reports/${encodeURIComponent(runId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data?.report) {
            if (!cancelled && tries < 12) setTimeout(poll, 800);
            return;
          }
          setReport(data.report as RunReport);
        })
        .catch(() => {
          if (!cancelled && tries < 12) setTimeout(poll, 800);
        });
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [runId, finished]);

  async function startRun() {
    setStarting(true);
    setError('');
    setSnapshot(null);
    setReport(null);
    setView('live');
    try {
      const res = await fetch(`/api/tests/${encodeURIComponent(testId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'vapt',
          baseUrl,
          apiUrl: apiUrl || undefined,
          runtimeAi: true,
          provider: useAppStore.getState().aiProvider,
          ...aiKeysForRun(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start VAPT test');
      setRunId(data.runId);
      setSnapshot(data.snapshot as RunSnapshot);
      attachEvents(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setStarting(false);
    }
  }

  async function stopRun() {
    if (!runId) return;
    await fetch(`/api/runs/${runId}/stop`, { method: 'POST' });
  }

  async function downloadPdf() {
    if (!runId) return;
    setPdfBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(runId)}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'PDF not ready yet');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lgd-vapt-report-${runId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download PDF');
    } finally {
      setPdfBusy(false);
    }
  }

  if (!hydrated || !ready) {
    return (
      <main className="page">
        <p className="hero-sub">Loading…</p>
      </main>
    );
  }

  const metrics = snapshot?.vaptFindings || report?.vaptFindings;
  const running = snapshot?.status === 'running' || snapshot?.status === 'starting';
  const attackTotal = meta ? countAttacks(meta.vapt.checks) : 0;

  return (
    <main className="page load-run-fullscreen">
      <div className="load-run-header">
        <div className="load-run-header-copy">
          <p className="flow-back">
            <Link href="/tests/vapt">← Login VAPT</Link>
          </p>
          <h1 className="hero-title">{testName}</h1>
          <p className="hero-sub">
            {meta ? (
              <>
                <span
                  className={`tag expectation-tag expectation-${meta.vapt.intent === 'fail' ? 'negative' : 'positive'}`}
                >
                  {meta.vapt.intent === 'fail' ? 'Fail case' : 'Pass case'}
                </span>{' '}
                <span
                  className={`tag vapt-profile-tag vapt-profile-${meta.vapt.profile || 'higher'}`}
                  title={vaptProfileHint(meta.vapt.profile)}
                >
                  {vaptProfileLabel(meta.vapt.profile)}
                </span>
                {' · '}
                <strong>{attackTotal}</strong> internal scenario
                {attackTotal === 1 ? '' : 's'} · MCP{' '}
                <code>{meta.vapt.startUrl || '/login'}</code>
                {' · '}
                {(meta.vapt.method || 'GET')} <code>{meta.vapt.targetUrl}</code>
                {meta.vapt.useApiBase ? ' (API)' : ''} · gate{' '}
                {meta.vapt.severityGate || 'high'}
                {meta.estimatedMinutes ? (
                  <>
                    {' '}
                    · ~{meta.estimatedMinutes} min
                  </>
                ) : null}
                <br />
                <span className="field-hint">{vaptProfileHint(meta.vapt.profile)}</span>
              </>
            ) : (
              'Login main suite — attacks as internal scenarios'
            )}
          </p>
        </div>
        <div className="flow-header-actions">
          {!running ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={starting}
              onClick={() => void startRun()}
            >
              {starting ? 'Starting…' : runId ? 'Re-run' : 'Start VAPT'}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => void stopRun()}>
              Stop
            </button>
          )}
          {finished && runId ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pdfBusy}
              onClick={() => void downloadPdf()}
            >
              {pdfBusy ? 'PDF…' : 'Download PDF'}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="load-view-tabs" role="tablist">
        <button
          type="button"
          className={`load-view-tab${view === 'live' ? ' active' : ''}`}
          onClick={() => setView('live')}
        >
          Live MCP
        </button>
        <button
          type="button"
          className={`load-view-tab${view === 'steps' ? ' active' : ''}`}
          onClick={() => setView('steps')}
        >
          Scenarios ({attackTotal})
        </button>
        <button
          type="button"
          className={`load-view-tab${view === 'network' ? ' active' : ''}`}
          onClick={() => setView('network')}
        >
          Network / payloads
        </button>
        <button
          type="button"
          className={`load-view-tab${view === 'findings' ? ' active' : ''}`}
          onClick={() => setView('findings')}
        >
          Attack reports
        </button>
      </div>

      <div className="load-run-layout vapt-run-layout">
        <div className="load-run-main">
          {view === 'live' ? (
            <section className="load-panel load-mcp-panel">
              <h2 className="load-panel-title">
                MCP evidence view
                {snapshot?.status ? (
                  <span className={`load-status load-status-${snapshot.status}`}>
                    {snapshot.status}
                  </span>
                ) : null}
              </h2>
              <p className="field-hint" style={{ marginTop: 0 }}>
                Browser is for evidence on /login — each catalogue attack runs as an internal scenario.
              </p>
              <McpLiveView
                runId={runId}
                active={Boolean(runId && (running || (!finished && snapshot?.status === 'starting')))}
                title="VAPT evidence"
                idleHint="Start VAPT to open /login in Playwright; internal attack scenarios run as steps."
              />
            </section>
          ) : null}

          {view === 'steps' ? (
            <section className="load-panel">
              <h2 className="load-panel-title">Internal attack scenarios</h2>
              <AttackStepsPanel
                steps={snapshot?.steps || []}
                attackTotal={attackTotal || (snapshot?.steps || []).filter((s) => s.id.startsWith('vapt-check-')).length}
              />
            </section>
          ) : null}

          {view === 'network' ? (
            <section className="load-panel">
              <h2 className="load-panel-title">Network tab · API URL + payload</h2>
              <NetworkPanel captures={metrics?.networkCaptures} />
            </section>
          ) : null}

          {view === 'findings' ? (
            <section className="load-panel">
              <h2 className="load-panel-title">Attack findings + screenshots</h2>
              <FindingsPanel metrics={metrics} runId={runId} />
            </section>
          ) : null}
        </div>

        <aside className="load-run-side">
          <section className="load-panel">
            <h2 className="load-panel-title">Run</h2>
            <p className="field-hint">
              {snapshot?.status || 'idle'}
              {snapshot?.startedAt ? ` · started ${formatWhen(snapshot.startedAt)}` : ''}
            </p>
            {snapshot?.error ? <p className="error-text">{snapshot.error}</p> : null}
            <div className="load-metrics-grid" style={{ marginTop: '0.75rem' }}>
              <div className="load-metric-cell">
                <span className="load-metric-label">Scenarios</span>
                <strong className="load-metric-value">{attackTotal}</strong>
              </div>
              <div className="load-metric-cell">
                <span className="load-metric-label">Findings</span>
                <strong className="load-metric-value">{metrics?.checked ?? 0}</strong>
              </div>
              <div className="load-metric-cell">
                <span className="load-metric-label">Failed</span>
                <strong className="load-metric-value">{metrics?.failed ?? 0}</strong>
              </div>
              <div className="load-metric-cell">
                <span className="load-metric-label">Network</span>
                <strong className="load-metric-value">
                  {metrics?.networkCaptures?.length ?? 0}
                </strong>
              </div>
            </div>
          </section>
          {view !== 'steps' ? (
            <section className="load-panel">
              <h2 className="load-panel-title">Internal scenarios</h2>
              <AttackStepsPanel
                steps={snapshot?.steps || []}
                attackTotal={
                  attackTotal ||
                  (snapshot?.steps || []).filter((s) => s.id.startsWith('vapt-check-')).length
                }
              />
            </section>
          ) : null}
          {view !== 'findings' ? (
            <section className="load-panel">
              <h2 className="load-panel-title">Latest findings</h2>
              <FindingsPanel metrics={metrics} runId={runId} />
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
