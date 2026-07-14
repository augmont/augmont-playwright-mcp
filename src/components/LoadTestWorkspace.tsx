'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { McpLiveView } from '@/components/McpLiveView';
import { isWebLoadReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import type {
  RunReport,
  RunSnapshot,
  TestStep,
  WebLoadLiveMetrics,
  WebLoadTestCase,
} from '@/lib/types';

type PageView = 'live' | 'report';

function formatWhen(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms?: number) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${Math.round(ms / 100) / 10}s`;
}

function screenshotUrl(runId: string, screenshotPath?: string) {
  if (!screenshotPath) return null;
  const file = screenshotPath.split(/[/\\]/).pop();
  if (!file) return null;
  return `/api/reports/${encodeURIComponent(runId)}/screenshot/${encodeURIComponent(file)}`;
}

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
  return `${Math.round((n / (1024 * 1024)) * 100) / 100} MB`;
}

function MetricCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="load-metric-cell">
      <span className="load-metric-label">{label}</span>
      <strong className="load-metric-value">{value}</strong>
    </div>
  );
}

function MetricsPanel({ metrics }: { metrics?: WebLoadLiveMetrics | null }) {
  if (!metrics) {
    return (
      <div className="load-metrics-empty">
        Start the load test — JMeter CLI drives traffic while MCP shows the live page.
      </div>
    );
  }
  return (
    <div className="load-metrics-wrap">
      <div className="load-metrics-section-label">Traffic</div>
      <div className="load-metrics-grid">
        <MetricCell label="Engine" value={metrics.engine || 'jmeter'} />
        <MetricCell label="Requests" value={metrics.totalRequests} />
        <MetricCell label="RPS" value={metrics.rps} />
        {metrics.rpsLive != null ? (
          <MetricCell label="RPS (15s)" value={metrics.rpsLive} />
        ) : null}
        <MetricCell
          label="Threads"
          value={`${metrics.latestThreads ?? metrics.jmeterThreads ?? metrics.activeUsers}/${metrics.virtualUsers}`}
        />
        <MetricCell label="Elapsed" value={`${metrics.elapsedSec}s`} />
        <MetricCell label="OK" value={metrics.successCount} />
        <MetricCell label="Errors" value={metrics.errorCount} />
        <MetricCell label="Success %" value={`${metrics.successRatePct ?? 100 - metrics.errorRatePct}%`} />
        <MetricCell label="Error %" value={`${metrics.errorRatePct}%`} />
      </div>

      <div className="load-metrics-section-label">Latency (response time)</div>
      <div className="load-metrics-grid">
        <MetricCell label="Avg" value={`${metrics.avgMs}ms`} />
        {metrics.windowAvgMs != null ? (
          <MetricCell label="Avg (15s)" value={`${metrics.windowAvgMs}ms`} />
        ) : null}
        <MetricCell label="Min" value={`${metrics.minMs ?? 0}ms`} />
        <MetricCell label="Max" value={`${metrics.maxMs ?? 0}ms`} />
        <MetricCell label="Stddev" value={`${metrics.stddevMs ?? 0}ms`} />
        <MetricCell label="p50" value={`${metrics.p50Ms}ms`} />
        <MetricCell label="p75" value={`${metrics.p75Ms ?? '—'}${metrics.p75Ms != null ? 'ms' : ''}`} />
        <MetricCell label="p90" value={`${metrics.p90Ms ?? '—'}${metrics.p90Ms != null ? 'ms' : ''}`} />
        <MetricCell label="p95" value={`${metrics.p95Ms}ms`} />
        <MetricCell label="p99" value={`${metrics.p99Ms}ms`} />
        {metrics.avgLatencyMs != null ? (
          <MetricCell label="Avg TTFB" value={`${metrics.avgLatencyMs}ms`} />
        ) : null}
        {metrics.avgConnectMs != null ? (
          <MetricCell label="Avg Connect" value={`${metrics.avgConnectMs}ms`} />
        ) : null}
      </div>

      <div className="load-metrics-section-label">Throughput</div>
      <div className="load-metrics-grid">
        {metrics.bytesPerSec != null ? (
          <MetricCell label="Bytes/s" value={metrics.bytesPerSec} />
        ) : null}
        {metrics.kbPerSec != null ? (
          <MetricCell label="KB/s" value={metrics.kbPerSec} />
        ) : null}
        {metrics.totalBytes != null ? (
          <MetricCell label="Total bytes" value={formatBytes(metrics.totalBytes)} />
        ) : null}
        {metrics.sentBytesPerSec != null ? (
          <MetricCell label="Sent B/s" value={metrics.sentBytesPerSec} />
        ) : null}
        {metrics.sentBytesTotal != null ? (
          <MetricCell label="Sent total" value={formatBytes(metrics.sentBytesTotal)} />
        ) : null}
      </div>

      <div className="load-metric-cell load-metric-statuses">
        <span className="load-metric-label">Status codes</span>
        <div className="load-status-bars">
          {Object.keys(metrics.statusCounts).length ? (
            Object.entries(metrics.statusCounts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([code, count]) => {
                const pct = metrics.totalRequests
                  ? Math.round((count / metrics.totalRequests) * 1000) / 10
                  : 0;
                return (
                  <div key={code} className="load-status-bar-row">
                    <span className="load-status-code">{code}</span>
                    <div className="load-status-track">
                      <div
                        className={`load-status-fill ${code.startsWith('2') ? 'ok' : 'err'}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <span className="load-status-count">
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })
          ) : (
            <strong className="load-metric-value">—</strong>
          )}
        </div>
      </div>
    </div>
  );
}

function StepList({
  steps,
  runId,
  showShots,
}: {
  steps: TestStep[];
  runId?: string | null;
  showShots?: boolean;
}) {
  if (!steps.length) {
    return (
      <p className="hero-sub" style={{ margin: 0 }}>
        Prepare JMeter → MCP live view → JMeter CLI → Thresholds
      </p>
    );
  }
  return (
    <ul className="load-step-list">
      {steps.map((step) => {
        const shot =
          showShots && runId ? screenshotUrl(runId, step.screenshotPath) : null;
        return (
          <li key={step.id} className={`load-step load-step-${step.status}`}>
            <span className="load-step-status">{step.status}</span>
            <div className="load-step-body">
              <strong>{step.label}</strong>
              {step.description ? (
                <p className="load-step-desc">{step.description}</p>
              ) : null}
              {step.message ? <p>{step.message}</p> : null}
              {step.detail ? <p className="load-step-detail">{step.detail}</p> : null}
              {shot ? (
                <div className="load-report-shot">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shot} alt={`Screenshot for ${step.label}`} />
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function LoadTestWorkspace({
  testId,
  testName,
}: {
  testId: string;
  testName: string;
}) {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const testMode = useAppStore((s) => s.testMode);
  const setTestMode = useAppStore((s) => s.setTestMode);

  const [loadCase, setLoadCase] = useState<WebLoadTestCase | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [view, setView] = useState<PageView>('live');
  const [starting, setStarting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState('');
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const ready = isWebLoadReady({ testMode, baseUrl });
  const active =
    snapshot?.status === 'running' ||
    snapshot?.status === 'starting' ||
    starting;
  const finished =
    snapshot?.status === 'completed' ||
    snapshot?.status === 'failed' ||
    snapshot?.status === 'stopped';

  useEffect(() => {
    if (!hydrated) return;
    if (testMode !== 'web-load' && baseUrl) setTestMode('web-load');
    if (!ready) router.replace('/web-load');
  }, [hydrated, ready, testMode, baseUrl, router, setTestMode]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tests/${encodeURIComponent(testId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.case?.kind === 'web-load') {
          setLoadCase(data.case as WebLoadTestCase);
        } else {
          setError('Not a web load test case');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load case');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [testId]);

  const attachEvents = useCallback((id: string) => {
    eventSourceRef.current?.close();
    const es = new EventSource(`/api/runs/${id}/events`);
    eventSourceRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as RunSnapshot;
        setSnapshot(data);
        if (
          data.status === 'completed' ||
          data.status === 'failed' ||
          data.status === 'stopped'
        ) {
          es.close();
          if (eventSourceRef.current === es) eventSourceRef.current = null;
          setView('report');
        }
      } catch {
        // ignore
      }
    };
    es.addEventListener('end', () => {
      es.close();
      if (eventSourceRef.current === es) eventSourceRef.current = null;
    });
    es.onerror = () => {
      es.close();
      if (eventSourceRef.current === es) eventSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Fetch persisted report when run finishes (for PDF + enriched summary)
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

  const logLines = snapshot?.loadMetrics?.logLines || [];
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logLines.length]);

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
          mode: 'web-load',
          baseUrl,
          apiUrl: apiUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start load test');
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
      // Wait briefly for report persistence if needed
      if (!report) {
        for (let i = 0; i < 10; i++) {
          const r = await fetch(`/api/reports/${encodeURIComponent(runId)}`);
          if (r.ok) {
            const data = await r.json();
            if (data?.report) {
              setReport(data.report as RunReport);
              break;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      const res = await fetch(`/api/reports/${encodeURIComponent(runId)}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'PDF not ready yet — try again in a moment');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lgd-load-report-${runId.slice(0, 8)}.pdf`;
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

  const title = snapshot?.testName || loadCase?.name || testName;
  const metrics = report?.loadMetrics || snapshot?.loadMetrics;
  const steps = report?.steps || snapshot?.steps || [];
  const status = report?.status || snapshot?.status;
  const durationMs =
    report?.durationMs ??
    (snapshot?.startedAt && snapshot?.finishedAt
      ? Date.parse(snapshot.finishedAt) - Date.parse(snapshot.startedAt)
      : undefined);

  return (
    <main className="page load-run-page load-run-fullscreen">
      <div className="load-run-header">
        <div className="load-run-header-copy">
          <p className="choice-card-eyebrow">Web load test · JMeter CLI + MCP</p>
          <h1 className="hero-title load-run-title">{title}</h1>
          <p className="hero-sub load-run-sub">
            {loadCase ? (
              <>
                {loadCase.load.method} <code>{loadCase.load.targetUrl}</code>
                {' · '}
                {loadCase.load.virtualUsers} VUs · {loadCase.load.durationSec}s · ramp{' '}
                {loadCase.load.rampUpSec}s
                {loadCase.load.useApiBase ? ' · API base' : ''}
              </>
            ) : (
              'Loading scenario…'
            )}
          </p>
        </div>
        <div className="load-run-actions">
          <Link href="/tests/load" className="load-back-link">
            ← All load tests
          </Link>
          {finished ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!runId || pdfBusy}
              onClick={() => void downloadPdf()}
            >
              {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
            </button>
          ) : null}
          {active ? (
            <button type="button" className="btn btn-danger" onClick={() => void stopRun()}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!loadCase || starting}
              onClick={() => void startRun()}
            >
              {starting ? 'Starting…' : runId ? 'Run again' : 'Start JMeter load'}
            </button>
          )}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="load-view-tabs" role="tablist" aria-label="Load run views">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'live'}
          className={`load-view-tab ${view === 'live' ? 'active' : ''}`}
          onClick={() => setView('live')}
        >
          Live run
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'report'}
          className={`load-view-tab ${view === 'report' ? 'active' : ''}`}
          onClick={() => setView('report')}
          disabled={!runId}
        >
          Report
          {status ? (
            <span className={`load-status load-status-${status}`}>{status}</span>
          ) : null}
        </button>
      </div>

      {view === 'live' ? (
        <div className="load-run-layout">
          <div className="load-run-main">
            <section className="load-panel">
              <h2 className="load-panel-title">
                Live metrics
                {snapshot?.status ? (
                  <span className={`load-status load-status-${snapshot.status}`}>
                    {snapshot.status}
                  </span>
                ) : null}
              </h2>
              <MetricsPanel metrics={metrics} />
              {metrics?.jtlPath || metrics?.jmxPath ? (
                <p className="load-artifact-paths">
                  {metrics.jmxPath ? (
                    <>
                      JMX: <code>{metrics.jmxPath}</code>
                    </>
                  ) : null}
                  {metrics.jmxPath && metrics.jtlPath ? ' · ' : null}
                  {metrics.jtlPath ? (
                    <>
                      JTL: <code>{metrics.jtlPath}</code>
                    </>
                  ) : null}
                  {metrics.reportDir ? (
                    <>
                      {' · '}
                      Report: <code>{metrics.reportDir}</code>
                    </>
                  ) : null}
                </p>
              ) : null}
            </section>

            <section className="load-panel">
              <h2 className="load-panel-title">Steps</h2>
              <StepList steps={steps} />
            </section>

            <section className="load-panel">
              <h2 className="load-panel-title">JMeter / runner log</h2>
              <div className="load-log">
                {logLines.length ? (
                  logLines.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 24)}`} className="load-log-line">
                      {line}
                    </div>
                  ))
                ) : (
                  <div className="load-metrics-empty">Log lines appear when the run starts.</div>
                )}
                <div ref={logEndRef} />
              </div>
            </section>
          </div>

          <aside className="load-run-side">
            <section className="load-panel load-mcp-panel">
              <h2 className="load-panel-title">MCP live browser</h2>
              <McpLiveView
                runId={runId}
                active={Boolean(runId && active)}
                title="Portal under load"
                idleHint="Start the test to open the target page in Playwright while JMeter hits it with virtual users."
              />
            </section>

            {loadCase ? (
              <section className="load-panel">
                <h2 className="load-panel-title">Scenario details</h2>
                <dl className="load-detail-dl">
                  <div>
                    <dt>Method</dt>
                    <dd>{loadCase.load.method}</dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>
                      <code>{loadCase.load.targetUrl}</code>
                      {loadCase.load.useApiBase ? ' (API base)' : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Virtual users</dt>
                    <dd>{loadCase.load.virtualUsers}</dd>
                  </div>
                  <div>
                    <dt>Duration / ramp</dt>
                    <dd>
                      {loadCase.load.durationSec}s / {loadCase.load.rampUpSec}s
                    </dd>
                  </div>
                  <div>
                    <dt>Thresholds</dt>
                    <dd>
                      err ≤ {loadCase.load.maxErrorRatePct}% · p95 ≤ {loadCase.load.p95Ms}ms
                    </dd>
                  </div>
                  <div>
                    <dt>Portal</dt>
                    <dd>
                      <code>{baseUrl}</code>
                    </dd>
                  </div>
                  {apiUrl ? (
                    <div>
                      <dt>API</dt>
                      <dd>
                        <code>{apiUrl}</code>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}
          </aside>
        </div>
      ) : (
        <div className="load-report-view">
          {!runId ? (
            <section className="load-panel load-report-empty">
              <p className="hero-sub" style={{ margin: 0 }}>
                Run a load test to generate the report (metrics, steps, screenshots, PDF).
              </p>
            </section>
          ) : (
            <>
              <section className="load-panel load-report-hero">
                <div className="load-report-hero-top">
                  <div>
                    <h2 className="load-panel-title" style={{ marginBottom: '0.35rem' }}>
                      Load test report
                      {status ? (
                        <span className={`load-status load-status-${status}`}>{status}</span>
                      ) : null}
                    </h2>
                    <p className="load-report-meta">
                      {formatWhen(report?.finishedAt || snapshot?.finishedAt || snapshot?.startedAt)}
                      {' · '}
                      Duration {formatDuration(durationMs)}
                      {' · '}
                      Run {runId.slice(0, 8)}
                    </p>
                    {report?.guidance || report?.aiSummary?.narrative ? (
                      <p className="load-report-summary">
                        {report.aiSummary?.headline
                          ? `${report.aiSummary.headline} — `
                          : null}
                        {report.aiSummary?.narrative || report.guidance}
                      </p>
                    ) : (
                      <p className="load-report-summary">
                        JMeter CLI results with MCP browser screenshots for{' '}
                        <strong>{title}</strong>.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={pdfBusy}
                    onClick={() => void downloadPdf()}
                  >
                    {pdfBusy ? 'Preparing PDF…' : 'Download PDF report'}
                  </button>
                </div>
              </section>

              <div className="load-report-grid">
                <section className="load-panel">
                  <h2 className="load-panel-title">Performance metrics</h2>
                  <MetricsPanel metrics={metrics} />
                  {metrics?.jtlPath || metrics?.jmxPath ? (
                    <p className="load-artifact-paths">
                      {metrics.jmxPath ? (
                        <>
                          JMX: <code>{metrics.jmxPath}</code>
                        </>
                      ) : null}
                      {metrics.jmxPath && metrics.jtlPath ? ' · ' : null}
                      {metrics.jtlPath ? (
                        <>
                          JTL: <code>{metrics.jtlPath}</code>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </section>

                <section className="load-panel">
                  <h2 className="load-panel-title">Scenario</h2>
                  {loadCase ? (
                    <dl className="load-detail-dl">
                      <div>
                        <dt>Method</dt>
                        <dd>{loadCase.load.method}</dd>
                      </div>
                      <div>
                        <dt>Target</dt>
                        <dd>
                          <code>{loadCase.load.targetUrl}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Virtual users</dt>
                        <dd>{loadCase.load.virtualUsers}</dd>
                      </div>
                      <div>
                        <dt>Duration / ramp</dt>
                        <dd>
                          {loadCase.load.durationSec}s / {loadCase.load.rampUpSec}s
                        </dd>
                      </div>
                      <div>
                        <dt>Thresholds</dt>
                        <dd>
                          err ≤ {loadCase.load.maxErrorRatePct}% · p95 ≤ {loadCase.load.p95Ms}
                          ms
                        </dd>
                      </div>
                      <div>
                        <dt>Portal</dt>
                        <dd>
                          <code>{baseUrl}</code>
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="load-metrics-empty">Scenario details unavailable.</p>
                  )}
                </section>
              </div>

              <section className="load-panel">
                <h2 className="load-panel-title">Steps & screenshots</h2>
                <StepList steps={steps} runId={runId} showShots />
              </section>

              {(snapshot?.error || report?.error) && (
                <p className="error-text">
                  Run error: {report?.error || snapshot?.error}
                </p>
              )}

              {logLines.length ? (
                <section className="load-panel">
                  <h2 className="load-panel-title">JMeter log (excerpt)</h2>
                  <div className="load-log load-log-report">
                    {logLines.slice(-40).map((line, i) => (
                      <div key={`${i}-${line.slice(0, 24)}`} className="load-log-line">
                        {line}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      )}

      {view === 'live' && snapshot?.error ? (
        <p className="error-text">Run error: {snapshot.error}</p>
      ) : null}
    </main>
  );
}
