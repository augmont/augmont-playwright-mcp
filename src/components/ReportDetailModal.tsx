'use client';

import { useEffect } from 'react';
import type { RunReport, TestStep } from '@/lib/types';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { ReportFlowChart } from '@/components/ReportFlowChart';
import { LoadThresholdsPanel } from '@/components/LoadThresholdsPanel';
import { resolveExpectation } from '@/lib/test-expectation';
import { ensureReportFlowChart } from '@/lib/flow-chart';
import { buildLoadGradeSummary } from '@/lib/load-grade-summary';

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

function StepBlock({
  step,
  runId,
  emphasize,
}: {
  step: TestStep;
  runId: string;
  emphasize?: boolean;
}) {
  const shot = screenshotUrl(runId, step.screenshotPath);
  return (
    <li
      className={`step-item report-step-item status-${step.status} ${emphasize ? 'emphasize' : ''}`}
    >
      <span className={`step-dot ${step.status}`} />
      <div className="report-step-body">
        <div className="step-label">
          <span className={`status-badge status-${step.status}`}>{step.status}</span>{' '}
          {step.label}
        </div>
        {step.description ? (
          <div className="step-msg report-step-purpose">
            <strong>Purpose:</strong> {step.description}
          </div>
        ) : null}
        {step.message ? (
          <div className={`step-msg ${step.status === 'failed' ? 'api-error-inline' : ''}`}>
            <strong>Result:</strong> {step.message}
          </div>
        ) : null}
        {step.detail ? (
          <div className="step-msg report-step-detail">{step.detail}</div>
        ) : null}
        <div className="step-msg">
          {formatWhen(step.startedAt)} → {formatWhen(step.finishedAt)}
        </div>
        {step.apiErrors?.length ? (
          <div className="step-msg api-error-inline">
            API:{' '}
            {step.apiErrors.map((e) => `${e.status ?? 'NET'} ${e.message}`).join(' · ')}
          </div>
        ) : null}
        {shot ? (
          <div className="report-shot-wrap">
            <p className="step-msg">
              <strong>
                {step.status === 'failed' ? 'Failure screenshot' : 'Browser screenshot'}
              </strong>
              {step.status === 'failed' ? (
                <span className="history-meta"> — full page with mismatch highlight</span>
              ) : (
                <span className="history-meta"> — MCP view under load</span>
              )}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt={`Screenshot for ${step.label}`} className="report-shot" />
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function ReportDetailModal({
  report,
  open,
  onClose,
}: {
  report: RunReport | null;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !report) return null;

  const downloadPdf = () => {
    window.open(`/api/reports/${report.runId}/pdf`, '_blank');
  };

  const failedSteps = (report.steps || []).filter((s) => s.status === 'failed');
  const isFail = report.status === 'failed' || failedSteps.length > 0;

  return (
    <div className="report-modal-root" role="dialog" aria-modal="true" aria-label="Report details">
      <div className="report-modal-backdrop" onClick={onClose} />
      <div className="report-modal">
        <header className="report-modal-header">
          <div className="modal-header-copy">
            <h2>
              {report.testName}{' '}
              <span
                className={`tag expectation-tag expectation-${resolveExpectation({
                  expectation: report.expectation,
                  name: report.testName,
                  id: report.testId,
                })}`}
              >
                {resolveExpectation({
                  expectation: report.expectation,
                  name: report.testName,
                  id: report.testId,
                })}
              </span>
            </h2>
            <p className="history-meta">
              <span className={`status-badge status-${report.status}`}>{report.status}</span>{' '}
              {formatWhen(report.finishedAt || report.startedAt)} · Duration{' '}
              {formatDuration(report.durationMs)} · Run {report.runId.slice(0, 8)}
            </p>
            {report.testDescription ? (
              <p className="history-meta">{report.testDescription}</p>
            ) : null}
          </div>
          <div className="report-modal-actions">
            <button type="button" className="btn btn-primary" onClick={downloadPdf}>
              Download PDF
            </button>
            <ModalCloseButton onClick={onClose} />
          </div>
        </header>

        <div className="report-modal-body">
          <p className="history-meta">
            Portal: {report.baseUrl}
            {report.apiUrl ? ` · API: ${report.apiUrl}` : ''}
            {report.role ? ` · Role: ${report.role}` : ''}
          </p>

          {report.guidance || report.aiSummary ? (
            <div className={`report-guidance ${isFail ? 'fail' : 'pass'}`}>
              <h3 className="section-title" style={{ marginTop: 0 }}>
                {isFail ? 'Failure summary (developers & testers)' : 'Success summary'}
              </h3>
              {report.aiSummary?.headline ? (
                <p className="report-ai-headline">{report.aiSummary.headline}</p>
              ) : null}
              <p className="step-msg" style={{ margin: '0.35rem 0 0' }}>
                {report.aiSummary?.narrative || report.guidance}
              </p>
              {isFail && report.aiSummary?.whyFailed ? (
                <div className="report-why-failed">
                  <strong>Why it failed</strong>
                  <p className="step-msg" style={{ margin: '0.25rem 0 0' }}>
                    {report.aiSummary.whyFailed}
                  </p>
                  {report.aiSummary.rootCause ? (
                    <p className="history-meta" style={{ marginTop: '0.35rem' }}>
                      Root cause: {report.aiSummary.rootCause}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {report.aiSummary?.developerActions?.length ? (
                <div className="report-action-block">
                  <strong>Developer actions</strong>
                  <ul className="report-action-list">
                    {report.aiSummary.developerActions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.aiSummary?.preventionActions?.length ? (
                <div className="report-action-block report-prevention-block">
                  <strong>How to prevent this attack</strong>
                  <ul className="report-action-list">
                    {report.aiSummary.preventionActions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.aiSummary?.testerActions?.length ? (
                <div className="report-action-block">
                  <strong>Tester actions</strong>
                  <ul className="report-action-list">
                    {report.aiSummary.testerActions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.aiSummary?.studyNotes ? (
                <p className="step-msg report-study-notes">
                  <strong>Study notes:</strong> {report.aiSummary.studyNotes}
                </p>
              ) : null}
              {report.aiSummary?.model ? (
                <p className="history-meta" style={{ marginTop: '0.5rem' }}>
                  Summary model: {report.aiSummary.model}
                </p>
              ) : null}
            </div>
          ) : null}

          {report.aiSummary?.codeSnippets?.length ? (
            <div className="report-snippets">
              <h3 className="section-title">
                {report.vaptFindings
                  ? 'Hardening snippets (prevent & retest)'
                  : 'Developer code snippets'}
              </h3>
              <p className="history-meta">
                {report.vaptFindings
                  ? 'Controls and retest commands that help prevent the same attack class after the fix.'
                  : isFail
                    ? 'Reproduce / harden the failed assertion — copy into Playwright or a scratch test.'
                    : 'Happy-path reference snippets for onboarding and regression study.'}
              </p>
              {report.aiSummary.codeSnippets.map((sn) => (
                <div key={`${sn.title}-${sn.code.slice(0, 24)}`} className="report-snippet-card">
                  <div className="report-snippet-title">
                    {sn.title}
                    <span className="history-meta"> · {sn.language}</span>
                  </div>
                  {sn.why ? <p className="step-msg">{sn.why}</p> : null}
                  <pre className="report-code-snippet">{sn.code}</pre>
                </div>
              ))}
            </div>
          ) : null}

          {report.error ? <p className="error-text">{report.error}</p> : null}

          <div className="stats-row" style={{ maxWidth: 560, margin: '1rem 0' }}>
            <div className="stat completed">
              <strong>{report.stepCounts.passed}</strong>
              <span>Passed</span>
            </div>
            <div className="stat progress">
              <strong>{report.stepCounts.failed}</strong>
              <span>Failed</span>
            </div>
            <div className="stat remaining">
              <strong>{report.stepCounts.skipped}</strong>
              <span>Skipped</span>
            </div>
          </div>

          {report.vaptFindings ? (
            <div className="load-panel" style={{ margin: '1rem 0 1.5rem' }}>
              <h3 className="section-title" style={{ marginTop: 0 }}>
                API VAPT findings
              </h3>
              <div className="load-metrics-grid">
                <div className="load-metric-cell">
                  <span className="load-metric-label">Engine</span>
                  <strong className="load-metric-value">
                    {report.vaptFindings.engine || 'api-vapt'}
                  </strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Checked</span>
                  <strong className="load-metric-value">{report.vaptFindings.checked}</strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Passed</span>
                  <strong className="load-metric-value">{report.vaptFindings.passed}</strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Failed</span>
                  <strong className="load-metric-value">{report.vaptFindings.failed}</strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Network</span>
                  <strong className="load-metric-value">
                    {report.vaptFindings.networkCaptures?.length || 0}
                  </strong>
                </div>
              </div>
              {report.vaptFindings.findings?.length ? (
                <ul className="vapt-findings-list" style={{ marginTop: '0.85rem' }}>
                  {report.vaptFindings.findings.map((f) => {
                    const shot = screenshotUrl(report.runId, f.screenshotPath);
                    return (
                      <li key={f.id} className={`vapt-finding vapt-finding-${f.status}`}>
                        <div className="vapt-finding-head">
                          <span className={`vapt-sev vapt-sev-${f.severity}`}>{f.severity}</span>
                          <span className="vapt-status">{f.status}</span>
                          {f.checkId ? <span className="vapt-status">{f.checkId}</span> : null}
                          <strong>{f.title}</strong>
                        </div>
                        <p className="field-hint">
                          {f.category}
                          {f.owasp ? ` · ${f.owasp}` : ''}
                          {f.cwe ? ` · ${f.cwe}` : ''}
                        </p>
                        {f.requestUrl ? (
                          <p className="field-hint">
                            <strong>
                              {f.requestMethod || 'REQ'}
                              {f.responseStatus != null ? ` → ${f.responseStatus}` : ''}
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
                        {f.evidence ? <pre className="vapt-evidence">{f.evidence}</pre> : null}
                        {f.recommendation ? (
                          <p className="vapt-reco">
                            <strong>Remediation:</strong> {f.recommendation}
                          </p>
                        ) : null}
                        {shot ? (
                          <div className="load-report-shot">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={shot} alt={`Evidence for ${f.title}`} />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {report.vaptFindings.networkCaptures?.length ? (
                <>
                  <h3 className="section-title" style={{ marginTop: '1.25rem' }}>
                    Network / API payloads
                  </h3>
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
                        {report.vaptFindings.networkCaptures.map((c) => (
                          <tr key={c.id}>
                            <td>{c.source}</td>
                            <td>
                              <code>{c.method}</code>
                            </td>
                            <td>{c.status ?? '—'}</td>
                            <td className="vapt-net-url">{c.url}</td>
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
                </>
              ) : null}
            </div>
          ) : null}

          {report.loadAuth ? (
            <div className="load-panel" style={{ margin: '1rem 0 1.5rem' }}>
              <h3 className="section-title" style={{ marginTop: 0 }}>
                Authorization &amp; Swagger
              </h3>
              <dl className="load-detail-dl">
                <div>
                  <dt>Auth required</dt>
                  <dd>{report.loadAuth.requiresAuth ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt>Tokens obtained</dt>
                  <dd>
                    {report.loadAuth.tokenObtained
                      ? `Yes · ${report.loadAuth.tokenCount}`
                      : report.loadAuth.requiresAuth
                        ? 'No'
                        : 'N/A'}
                  </dd>
                </div>
                {report.loadAuth.credentialLabels?.length ? (
                  <div>
                    <dt>Credentials used</dt>
                    <dd>{report.loadAuth.credentialLabels.join(', ')}</dd>
                  </div>
                ) : null}
                {report.loadAuth.loginPath ? (
                  <div>
                    <dt>Login path</dt>
                    <dd>
                      <code>{report.loadAuth.loginPath}</code>
                    </dd>
                  </div>
                ) : null}
                {report.loadAuth.swaggerUrl ? (
                  <div>
                    <dt>Swagger URL</dt>
                    <dd>
                      <code>{report.loadAuth.swaggerUrl}</code>
                    </dd>
                  </div>
                ) : null}
                {report.loadAuth.selectedOperations?.length ? (
                  <div>
                    <dt>APIs tested</dt>
                    <dd>
                      {report.loadAuth.selectedOperations.map((op, i) => (
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
                {report.loadAuth.error ? (
                  <div>
                    <dt>Auth error</dt>
                    <dd className="api-error-inline">{report.loadAuth.error}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="history-meta">
                Passwords and raw tokens are never stored in reports.
              </p>
            </div>
          ) : null}

          {report.loadMetrics ? (
            <>
              <LoadThresholdsPanel
                grade={
                  report.loadGradeSummary ||
                  buildLoadGradeSummary({
                    metrics: report.loadMetrics,
                    thresholds: {
                      maxErrorRatePct: 10,
                      p95Ms: 4000,
                      p99Ms: 6000,
                      p50Ms: 1800,
                      p75Ms: 2600,
                      p90Ms: 3400,
                      avgMs: 2200,
                      virtualUsers: report.loadMetrics.virtualUsers,
                      durationSec: report.loadMetrics.elapsedSec,
                    },
                    status: report.status,
                    error: report.error,
                  })
                }
              />
            <div className="load-panel" style={{ margin: '1rem 0 1.5rem' }}>
              <h3 className="section-title" style={{ marginTop: 0 }}>
                JMeter load metrics
              </h3>
              <div className="load-metrics-grid">
                <div className="load-metric-cell">
                  <span className="load-metric-label">Engine</span>
                  <strong className="load-metric-value">
                    {report.loadMetrics.engine || 'jmeter'}
                  </strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Requests</span>
                  <strong className="load-metric-value">
                    {report.loadMetrics.totalRequests}
                  </strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">RPS</span>
                  <strong className="load-metric-value">{report.loadMetrics.rps}</strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Success %</span>
                  <strong className="load-metric-value">
                    {report.loadMetrics.successRatePct ??
                      100 - report.loadMetrics.errorRatePct}
                    %
                  </strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Error %</span>
                  <strong className="load-metric-value">
                    {report.loadMetrics.errorRatePct}%
                  </strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Avg</span>
                  <strong className="load-metric-value">{report.loadMetrics.avgMs}ms</strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">Min / Max</span>
                  <strong className="load-metric-value">
                    {report.loadMetrics.minMs ?? '—'} / {report.loadMetrics.maxMs ?? '—'}ms
                  </strong>
                </div>
                <div className="load-metric-cell">
                  <span className="load-metric-label">p90 / p95 / p99</span>
                  <strong className="load-metric-value">
                    {report.loadMetrics.p90Ms ?? '—'} / {report.loadMetrics.p95Ms} /{' '}
                    {report.loadMetrics.p99Ms}ms
                  </strong>
                </div>
                {report.loadMetrics.kbPerSec != null ? (
                  <div className="load-metric-cell">
                    <span className="load-metric-label">KB/s</span>
                    <strong className="load-metric-value">{report.loadMetrics.kbPerSec}</strong>
                  </div>
                ) : null}
                {report.loadMetrics.avgLatencyMs != null ? (
                  <div className="load-metric-cell">
                    <span className="load-metric-label">Avg TTFB</span>
                    <strong className="load-metric-value">
                      {report.loadMetrics.avgLatencyMs}ms
                    </strong>
                  </div>
                ) : null}
                {report.loadMetrics.avgConnectMs != null ? (
                  <div className="load-metric-cell">
                    <span className="load-metric-label">Avg Connect</span>
                    <strong className="load-metric-value">
                      {report.loadMetrics.avgConnectMs}ms
                    </strong>
                  </div>
                ) : null}
              </div>
              {report.loadMetrics.recentErrors?.length ? (
                <div className="load-error-list">
                  <div className="load-metrics-section-label">
                    Recent errors (request / response)
                  </div>
                  <ul className="load-error-ul">
                    {report.loadMetrics.recentErrors.slice(-20).map((e, i) => (
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
            </>
          ) : null}

          <ReportFlowChart
            title="Test flow chart (pass / fail)"
            nodes={ensureReportFlowChart(report)}
            steps={report.steps}
          />

          {isFail && failedSteps.length ? (
            <>
              <h3 className="section-title">Failed steps (with screenshots)</h3>
              <ul className="steps-list report-modal-steps">
                {failedSteps.map((step) => (
                  <StepBlock key={`fail-${step.id}`} step={step} runId={report.runId} emphasize />
                ))}
              </ul>
            </>
          ) : null}

          {!report.loadMetrics && !report.vaptFindings ? (
            <>
              <h3 className="section-title">Country results</h3>
              {!report.countryResults.length ? (
                <p className="step-msg">No per-country results (web-flow / single-suite run).</p>
              ) : (
                <ul className="history-list">
                  {report.countryResults.map((c) => (
                    <li key={c.isoCode} className="history-item" style={{ padding: '0.85rem 1rem' }}>
                      <div className="history-top">
                        <strong>
                          {c.countryName} ({c.isoCode})
                        </strong>
                        <span className={`country-chip ${c.status}`}>{c.status}</span>
                      </div>
                      {c.message ? <div className="history-meta">{c.message}</div> : null}
                      <div className="history-meta">
                        Steps: {c.stepsSummary.passed}p / {c.stepsSummary.failed}f /{' '}
                        {c.stepsSummary.skipped}s
                        {c.retried ? ' · retried' : ''}
                      </div>
                      {c.apiErrors?.length ? (
                        <div className="history-meta api-error-inline">
                          API:{' '}
                          {c.apiErrors.map((e) => `${e.status ?? 'NET'} ${e.message}`).join(' · ')}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          <h3 className="section-title" style={{ marginTop: '1.5rem' }}>
            {report.vaptFindings
              ? 'VAPT steps & screenshots'
              : report.loadMetrics
                ? 'Load steps & screenshots'
                : 'Full step log'}
          </h3>
          {!report.steps?.length ? (
            <p className="step-msg">No steps stored for this report.</p>
          ) : (
            <ul className="steps-list report-modal-steps">
              {report.steps.map((step) => (
                <StepBlock key={step.id} step={step} runId={report.runId} />
              ))}
            </ul>
          )}

          {!report.loadMetrics && !report.vaptFindings ? (
            <>
              <h3 className="section-title" style={{ marginTop: '1.5rem' }}>
                API errors
              </h3>
              {!report.apiErrors?.length ? (
                <p className="step-msg">No API errors recorded.</p>
              ) : (
                <ul className="history-list">
                  {report.apiErrors.map((e) => (
                    <li key={e.id} className="history-item" style={{ padding: '0.85rem 1rem' }}>
                      <div className="history-top">
                        <strong>
                          {e.method || 'REQ'} {e.status != null ? `HTTP ${e.status}` : 'Network'}
                        </strong>
                        <span className="country-chip failed">{e.isoCode || 'API'}</span>
                      </div>
                      <div className="history-meta">{e.url}</div>
                      <div className="history-meta api-error-inline">{e.message}</div>
                      {e.bodySnippet ? <pre className="api-body-snippet">{e.bodySnippet}</pre> : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
