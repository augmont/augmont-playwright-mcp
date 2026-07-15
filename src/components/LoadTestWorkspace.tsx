'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { McpLiveView } from '@/components/McpLiveView';
import { isWebLoadReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import {
  countLoadAuthCredentials,
  loadAuthCredentialsForRun,
  readLoadAuthLoginConfig,
  readPresetAuthHeaders,
} from '@/lib/load-auth-credentials';
import { LoadAuthCredentialsModal } from '@/components/LoadAuthCredentialsModal';
import { SwaggerSuiteEditModal } from '@/components/SwaggerSuiteEditModal';
import { LoadGradeSummaryPanel } from '@/components/LoadGradeSummaryPanel';
import { LoadThresholdsPanel } from '@/components/LoadThresholdsPanel';
import { buildLoadGradeSummary } from '@/lib/load-grade-summary';
import type {
  RunReport,
  RunSnapshot,
  TestStep,
  WebLoadLiveMetrics,
  WebLoadTestCase,
} from '@/lib/types';

type PageView = 'live' | 'report' | 'thresholds';

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

function MetricsPanel({
  metrics,
  apiOnly,
}: {
  metrics?: WebLoadLiveMetrics | null;
  apiOnly?: boolean;
}) {
  if (!metrics) {
    return (
      <div className="load-metrics-empty">
        {apiOnly
          ? 'Start the load test — JMeter CLI drives API traffic (no browser needed).'
          : 'Start the load test — JMeter CLI drives traffic while MCP shows the live page.'}
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

      {metrics.recentErrors?.length ? (
        <div className="load-error-list">
          <div className="load-metrics-section-label">Recent errors (request / response)</div>
          <ul className="load-error-ul">
            {metrics.recentErrors.slice(-12).map((e, i) => (
              <li key={`${e.label}-${i}`}>
                <strong>
                  {e.method ? `${e.method} ` : ''}
                  {e.label}
                </strong>
                {e.status ? ` · HTTP ${e.status}` : ''}
                {e.url ? (
                  <>
                    <br />
                    <code>{e.url}</code>
                  </>
                ) : null}
                <br />
                <span className="api-error-inline">{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StepList({
  steps,
  runId,
  showShots,
  apiOnly,
}: {
  steps: TestStep[];
  runId?: string | null;
  showShots?: boolean;
  apiOnly?: boolean;
}) {
  if (!steps.length) {
    return (
      <p className="hero-sub" style={{ margin: 0 }}>
        {apiOnly
          ? 'Authorize → Prepare JMeter → JMeter CLI → Thresholds'
          : 'Prepare JMeter → MCP live view → JMeter CLI → Thresholds'}
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
  const [credsOpen, setCredsOpen] = useState(false);
  const [credCount, setCredCount] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const autostartDoneRef = useRef(false);

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

  // Fetch persisted report when run finishes (for PDF + AI-enriched summary)
  useEffect(() => {
    if (!runId || !finished) return;
    let cancelled = false;
    let tries = 0;
    const maxTries = 45; // ~45s — OpenRouter enrich can land after local-template
    const poll = () => {
      tries += 1;
      fetch(`/api/reports/${encodeURIComponent(runId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) return;
          if (!data?.report) {
            if (tries < maxTries) setTimeout(poll, 1000);
            return;
          }
          setReport(data.report as RunReport);
          const model = (data.report as RunReport).aiSummary?.model;
          const awaitingAi = !model || model === 'local-template';
          if (awaitingAi && tries < maxTries) setTimeout(poll, 1000);
        })
        .catch(() => {
          if (!cancelled && tries < maxTries) setTimeout(poll, 1000);
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

  useEffect(() => {
    setCredCount(countLoadAuthCredentials());
  }, [loadCase, credsOpen]);

  useEffect(() => {
    if (!hydrated || !ready || !loadCase) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') !== '1') return;
    if (autostartDoneRef.current) return;
    autostartDoneRef.current = true;
    router.replace(`/tests/${encodeURIComponent(testId)}`, { scroll: false });
    void startRun(loadCase);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot autostart after case load
  }, [hydrated, ready, loadCase, testId, router]);

  async function startRun(caseOverride?: WebLoadTestCase) {
    const current = caseOverride ?? loadCase;
    setStarting(true);
    setError('');
    setSnapshot(null);
    setReport(null);
    setView('live');
    try {
      const requiresAuth = Boolean(current?.load.requiresAuth);
      const creds = loadAuthCredentialsForRun();
      const login = readLoadAuthLoginConfig();
      const presetHeaders = readPresetAuthHeaders();

      if (requiresAuth && !creds.length && !presetHeaders.length) {
        setCredsOpen(true);
        throw new Error(
          'This API requires authorization. Add username/password or a Bearer token, then run again.',
        );
      }

      const res = await fetch(`/api/tests/${encodeURIComponent(testId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'web-load',
          baseUrl,
          apiUrl: current?.load.apiBaseUrl || apiUrl || undefined,
          loadAuthCredentials: creds.length ? creds : undefined,
          loadAuthLogin: login?.loginPath ? login : undefined,
          authHeaderValues: presetHeaders.length ? presetHeaders : undefined,
          authHeaderName: login?.tokenHeader || 'Authorization',
          loadAuthMeta: {
            swaggerUrl: current?.load.swaggerUrl,
            loginPath: login?.loginPath,
            credentialLabels: creds.length
              ? creds.map((c) => c.label)
              : presetHeaders.length
                ? ['preset-token']
                : [],
            selectedOperations: [
              {
                method: current?.load.method || 'GET',
                path: current?.load.targetUrl || '',
                summary: current?.name,
                requiresAuth,
              },
            ],
          },
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
  const apiOnly = Boolean(
    loadCase?.load.swaggerUrl ||
      loadCase?.load.useApiBase ||
      report?.loadAuth?.apiOnly ||
      snapshot?.loadAuth?.apiOnly,
  );
  /** Grade/badge only after the run finishes — live partial JTL must not show Fail/Poor. */
  const runFinished =
    status === 'completed' || status === 'failed' || status === 'stopped';
  const gradeSummary =
    report?.loadGradeSummary ||
    (runFinished ? snapshot?.loadGradeSummary : undefined) ||
    (runFinished && metrics && loadCase
      ? buildLoadGradeSummary({
          metrics,
          thresholds: loadCase.load,
          status: status || 'completed',
          error: report?.error || snapshot?.error,
        })
      : null);
  const aiSummary = report?.aiSummary;
  const thresholdsBadge = active ? (
    <span className="load-grade-badge load-grade-pending" title="Grade is set when JMeter finishes">
      Running
    </span>
  ) : gradeSummary ? (
    <span
      className={`load-grade-badge load-grade-${gradeSummary.grade}`}
      title={`Score ${gradeSummary.score}/100`}
    >
      {gradeSummary.label}
    </span>
  ) : null;

  return (
    <main className="page load-run-page load-run-fullscreen">
      <div className="load-run-header">
        <div className="load-run-header-copy">
          <p className="choice-card-eyebrow">
            {apiOnly
              ? 'Swagger API load · JMeter CLI'
              : 'Web load test · JMeter CLI + MCP'}
          </p>
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
          {loadCase ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={active}
              onClick={() => setEditOpen(true)}
            >
              Edit case
            </button>
          ) : null}
          {loadCase?.load.requiresAuth || credCount > 0 ? (
            <button
              type="button"
              className={`btn btn-ghost ${credCount ? 'has-creds' : ''}`}
              onClick={() => setCredsOpen(true)}
              disabled={active}
            >
              {credCount ? `Auth credentials (${credCount})` : 'Set auth credentials'}
            </button>
          ) : null}
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

      {loadCase?.load.requiresAuth ? (
        <p className="step-msg load-auth-hint">
          🔒 This API requires authorization. Add one or more username/password pairs — tokens
          are obtained at run start and attached to JMeter (never saved in reports).
        </p>
      ) : null}

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
          aria-selected={view === 'thresholds'}
          className={`load-view-tab ${view === 'thresholds' ? 'active' : ''}`}
          onClick={() => setView('thresholds')}
        >
          Thresholds
          {thresholdsBadge}
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
        <div
          className={`load-run-layout ${apiOnly ? 'load-run-layout-api' : ''}`}
        >
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
              <MetricsPanel metrics={metrics} apiOnly={apiOnly} />
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
              <StepList steps={steps} apiOnly={apiOnly} />
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
            {!apiOnly ? (
              <section className="load-panel load-mcp-panel">
                <h2 className="load-panel-title">MCP live browser</h2>
                <McpLiveView
                  runId={runId}
                  active={Boolean(runId && active)}
                  title="Portal under load"
                  idleHint="Start the test to open the target page in Playwright while JMeter hits it with virtual users."
                />
              </section>
            ) : null}

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
                      err ≤ {loadCase.load.maxErrorRatePct}% · p50/p75/p90/p95/p99/avg
                      checked separately
                      {loadCase.load.p95Ms
                        ? ` (p95 ≤ ${loadCase.load.p95Ms}ms)`
                        : ''}
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
                  {loadCase.load.requiresAuth ? (
                    <div>
                      <dt>Authorization</dt>
                      <dd>Required · {credCount || 0} credential(s) saved</dd>
                    </div>
                  ) : null}
                  {loadCase.load.swaggerUrl ? (
                    <div>
                      <dt>Swagger</dt>
                      <dd>
                        <code>{loadCase.load.swaggerUrl}</code>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}
          </aside>
        </div>
      ) : view === 'thresholds' ? (
        <div className="load-report-view">
          <LoadThresholdsPanel
            thresholds={loadCase?.load || null}
            grade={runFinished ? gradeSummary : null}
          />
          {active ? (
            <section className="load-panel">
              <p className="history-meta" style={{ margin: 0 }}>
                JMeter is still running — threshold Pass/Fail and the grade badge
                appear only after the run completes. Live metrics stay on the Live
                run tab.
              </p>
            </section>
          ) : !gradeSummary && loadCase ? (
            <section className="load-panel">
              <p className="history-meta" style={{ margin: 0 }}>
                Threshold limits above come from this case&apos;s Load settings.
                After a completed JMeter run, this tab also shows required vs
                actual for every metric.
              </p>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="load-report-view">
          {!runId ? (
            <section className="load-panel load-report-empty">
              <p className="hero-sub" style={{ margin: 0 }}>
                Run a load test to generate the report (metrics, steps
                {apiOnly ? '' : ', screenshots'}, PDF).
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
                      {runFinished && gradeSummary ? (
                        <span
                          className={`load-grade-badge load-grade-${gradeSummary.grade}`}
                          style={{ marginLeft: '0.45rem' }}
                        >
                          {gradeSummary.label}
                        </span>
                      ) : active ? (
                        <span
                          className="load-grade-badge load-grade-pending"
                          style={{ marginLeft: '0.45rem' }}
                        >
                          Running
                        </span>
                      ) : null}
                    </h2>
                    <p className="load-report-meta">
                      {formatWhen(report?.finishedAt || snapshot?.finishedAt || snapshot?.startedAt)}
                      {durationMs != null ? ` · ${formatDuration(durationMs)}` : ''}
                      {runId ? (
                        <>
                          {' · '}
                          <code>{runId.slice(0, 8)}</code>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
              </section>

              {(runFinished && (gradeSummary || aiSummary)) ? (
                <LoadGradeSummaryPanel
                  grade={gradeSummary}
                  aiSummary={aiSummary}
                  thresholds={loadCase?.load || null}
                  showThresholdTables
                />
              ) : loadCase ? (
                <LoadThresholdsPanel
                  thresholds={loadCase.load}
                  grade={null}
                />
              ) : null}

              {(() => {
                const auth = report?.loadAuth || snapshot?.loadAuth;
                if (!auth) return null;
                return (
                  <section className="load-panel">
                    <h2 className="load-panel-title">Authorization &amp; Swagger</h2>
                    <dl className="load-detail-dl">
                      <div>
                        <dt>Auth required</dt>
                        <dd>{auth.requiresAuth ? 'Yes' : 'No'}</dd>
                      </div>
                      <div>
                        <dt>Tokens obtained</dt>
                        <dd>
                          {auth.tokenObtained
                            ? `Yes · ${auth.tokenCount}`
                            : auth.requiresAuth
                              ? 'No'
                              : 'N/A'}
                        </dd>
                      </div>
                      {auth.credentialLabels?.length ? (
                        <div>
                          <dt>Credentials used</dt>
                          <dd>{auth.credentialLabels.join(', ')}</dd>
                        </div>
                      ) : null}
                      {auth.loginPath ? (
                        <div>
                          <dt>Login path</dt>
                          <dd>
                            <code>{auth.loginPath}</code>
                          </dd>
                        </div>
                      ) : null}
                      {auth.authHeaderName ? (
                        <div>
                          <dt>Auth header</dt>
                          <dd>
                            <code>{auth.authHeaderName}</code>
                          </dd>
                        </div>
                      ) : null}
                      {auth.swaggerUrl ? (
                        <div>
                          <dt>Swagger URL</dt>
                          <dd>
                            <code>{auth.swaggerUrl}</code>
                          </dd>
                        </div>
                      ) : null}
                      {auth.selectedOperations?.length ? (
                        <div>
                          <dt>APIs tested</dt>
                          <dd>
                            {auth.selectedOperations.map((op, i) => (
                              <span key={`${op.method}-${op.path}-${i}`}>
                                {i > 0 ? ' · ' : ''}
                                <code>
                                  {op.method} {op.path}
                                </code>
                              </span>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                      {auth.error ? (
                        <div>
                          <dt>Auth error</dt>
                          <dd className="api-error-inline">{auth.error}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <p className="history-meta" style={{ marginTop: '0.75rem' }}>
                      Passwords and raw tokens are never stored in reports — only labels and status.
                    </p>
                  </section>
                );
              })()}

              <div className="load-report-grid">
                <section className="load-panel">
                  <h2 className="load-panel-title">Final metrics</h2>
                  {metrics ? (
                    <MetricsPanel metrics={metrics} apiOnly={apiOnly} />
                  ) : (
                    <p className="load-metrics-empty">Waiting for metrics…</p>
                  )}
                </section>

                <section className="load-panel">
                  <h2 className="load-panel-title">Scenario</h2>
                  {loadCase ? (
                    <dl className="load-detail-dl">
                      <div>
                        <dt>Method / target</dt>
                        <dd>
                          {loadCase.load.method} <code>{loadCase.load.targetUrl}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>VUs · duration</dt>
                        <dd>
                          {loadCase.load.virtualUsers} · {loadCase.load.durationSec}s
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
                <h2 className="load-panel-title">
                  {apiOnly ? 'Steps' : 'Steps & screenshots'}
                </h2>
                <StepList
                  steps={steps}
                  runId={runId}
                  showShots={!apiOnly}
                  apiOnly={apiOnly}
                />
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

      <LoadAuthCredentialsModal
        open={credsOpen}
        onClose={() => {
          setCredsOpen(false);
          setCredCount(countLoadAuthCredentials());
        }}
        onSaved={() => setCredCount(countLoadAuthCredentials())}
      />

      <SwaggerSuiteEditModal
        open={editOpen}
        loadCase={loadCase}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setLoadCase(updated);
          setEditOpen(false);
          setCredCount(countLoadAuthCredentials());
        }}
        onRunLoadTest={async (updated) => {
          setLoadCase(updated);
          setEditOpen(false);
          setCredCount(countLoadAuthCredentials());
          await startRun(updated);
        }}
      />

      {view === 'live' && snapshot?.error ? (
        <p className="error-text">Run error: {snapshot.error}</p>
      ) : null}
    </main>
  );
}
