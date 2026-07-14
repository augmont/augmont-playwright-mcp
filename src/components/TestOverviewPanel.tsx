'use client';

import type { ReactNode } from 'react';
import type {
  ApiErrorRecord,
  CountryRunResult,
  RunSnapshot,
  StepStatus,
  WebFlowStep,
  WebTestCase,
} from '@/lib/types';
import { ReportFlowChart } from '@/components/ReportFlowChart';
import { buildReportFlowChart } from '@/lib/flow-chart';
import {
  resolveExpectation,
  resolveSuiteBranchSteps,
  stripExpectationFromName,
  type TestExpectation,
} from '@/lib/test-expectation';

function statusClass(status: RunSnapshot['status']) {
  return `status-badge status-${status}`;
}

function dotClass(status: StepStatus) {
  return `step-dot ${status}`;
}

function shortApiUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

function ApiErrorsBlock({ errors }: { errors: ApiErrorRecord[] }) {
  if (!errors.length) return null;
  return (
    <div className="api-errors-block">
      <h3 className="country-report-title">API errors ({errors.length})</h3>
      <ul className="api-errors-list">
        {errors.slice(-8).map((e) => (
          <li key={e.id} className="api-error-item">
            <span className="country-chip failed">
              {e.status != null ? e.status : 'NET'}
            </span>
            <div>
              <div className="step-label">
                {e.method || 'REQ'} {shortApiUrl(e.url)}
              </div>
              <div className="step-msg">{e.message}</div>
              {e.isoCode ? <div className="step-msg">Country: {e.isoCode}</div> : null}
              {e.retried ? <div className="step-msg">Re-tested after this error</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CountryReport({ results }: { results: CountryRunResult[] }) {
  if (!results.length) return null;
  return (
    <div className="country-report">
      <h3 className="country-report-title">Country-wise report</h3>
      <ul className="country-report-list">
        {results.map((c) => (
          <li key={c.isoCode} className="country-report-item">
            <span className={`country-chip ${c.status}`}>{c.isoCode}</span>
            <div>
              <div className="step-label">
                {c.countryName} — {c.status}
                {c.retried ? ' (retried)' : ''}
              </div>
              {c.message ? <div className="step-msg">{c.message}</div> : null}
              <div className="step-msg">
                {c.stepsSummary.passed}p / {c.stepsSummary.failed}f / {c.stepsSummary.skipped}s
                of {c.stepsSummary.total}
              </div>
              {c.apiErrors?.length ? (
                <div className="step-msg api-error-inline">
                  API: {c.apiErrors.map((e) => `${e.status ?? 'NET'} ${e.message}`).join(' · ')}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TestOverviewPanel({
  title,
  snapshot,
  onStop,
  onStart,
  starting,
  countryControls,
  runDisabled,
  onOpenReports,
  onViewTestCase,
  viewLoading,
  targetLabel,
  runBranch,
  onToggleRunBranch,
  previewCase,
}: {
  title: string;
  snapshot: RunSnapshot | null;
  onStop: () => void;
  onStart: () => void;
  starting: boolean;
  countryControls?: ReactNode;
  runDisabled?: boolean;
  onOpenReports?: () => void;
  onViewTestCase?: () => void;
  viewLoading?: boolean;
  targetLabel?: string;
  /** Selected Positive/Negative path for combined suites */
  runBranch?: TestExpectation;
  onToggleRunBranch?: () => void;
  /** Full case — used to preview the selected path before Start */
  previewCase?: WebTestCase | null;
}) {
  const running =
    snapshot?.status === 'running' ||
    snapshot?.status === 'starting' ||
    starting;

  const suiteTitle = stripExpectationFromName(title || 'Test');
  const branch: TestExpectation = runBranch || 'positive';
  const canSwitch =
    !!onToggleRunBranch &&
    !!previewCase &&
    (previewCase.suiteMode === 'combined' ||
      (previewCase.negativeSteps && previewCase.negativeSteps.length > 0));

  const previewSteps: WebFlowStep[] =
    previewCase && canSwitch
      ? resolveSuiteBranchSteps(previewCase, branch)
      : [];

  const showLiveFromSnapshot =
    !!snapshot?.steps?.length &&
    (running ||
      !canSwitch ||
      !runBranch ||
      snapshot.expectation === runBranch);

  return (
    <aside className="overview-panel">
      <div className="overview-header">
        <div className="overview-header-row">
          <h1>{suiteTitle}</h1>
          <div className="overview-header-actions">
            {onViewTestCase ? (
              <button
                type="button"
                className="btn btn-ghost reports-btn"
                disabled={viewLoading}
                title="View steps, JSON, Playwright & verify checklist"
                onClick={onViewTestCase}
              >
                {viewLoading ? 'Loading…' : '👁 View test case'}
              </button>
            ) : null}
            {onOpenReports ? (
              <button type="button" className="btn btn-ghost reports-btn" onClick={onOpenReports}>
                Reports
              </button>
            ) : null}
          </div>
        </div>
        <p>{snapshot?.baseUrl || targetLabel || 'Waiting to start…'}</p>
        <div className="overview-status-row">
          {snapshot ? (
            <span className={statusClass(snapshot.status)}>{snapshot.status}</span>
          ) : (
            <span className="status-badge status-idle">idle</span>
          )}
          {snapshot?.apiErrors?.length ? (
            <span className="status-badge status-failed">
              {snapshot.apiErrors.length} API error(s)
            </span>
          ) : null}
          {canSwitch ? (
            <button
              type="button"
              className={`btn run-branch-swap expectation-${branch}`}
              disabled={running}
              title="Switch Positive ↔ Negative"
              aria-label="Switch Positive and Negative path"
              onClick={onToggleRunBranch}
            >
              ↔{' '}
              {branch === 'negative'
                ? 'Error path (Negative)'
                : 'Happy path (Positive)'}
            </button>
          ) : null}
        </div>
      </div>

      {countryControls}

      <div className="stats-row">
        <div className="stat completed">
          <strong>{snapshot?.completed ?? 0}</strong>
          <span>Complete</span>
        </div>
        <div className="stat progress">
          <strong>{snapshot?.inProgress ?? 0}</strong>
          <span>In process</span>
        </div>
        <div className="stat remaining">
          <strong>{snapshot?.remaining ?? snapshot?.total ?? 0}</strong>
          <span>Remaining</span>
        </div>
      </div>

      {showLiveFromSnapshot ? (
        <div className="live-report-flow">
          <div className="live-report-flow-badge-row">
            <span
              className={`tag expectation-tag expectation-${resolveExpectation({
                expectation: snapshot!.expectation || branch,
                name: snapshot!.testName,
                id: snapshot!.testId,
              })}`}
            >
              {resolveExpectation({
                expectation: snapshot!.expectation || branch,
                name: snapshot!.testName,
                id: snapshot!.testId,
              }) === 'negative'
                ? 'Error path (Negative)'
                : 'Happy path (Positive)'}
            </span>
          </div>
          <ReportFlowChart
            title="Live flow chart"
            nodes={snapshot!.flowChart}
            steps={snapshot!.steps}
            compact
          />
        </div>
      ) : previewSteps.length ? (
        <div className="live-report-flow">
          <div className="live-report-flow-badge-row">
            <span className={`tag expectation-tag expectation-${branch}`}>
              {branch === 'negative'
                ? 'Error path (Negative)'
                : 'Happy path (Positive)'}
            </span>
          </div>
          <ReportFlowChart
            title="Path preview"
            nodes={buildReportFlowChart(
              previewSteps.map((s) => ({
                id: s.id,
                label: s.label,
                status: 'pending' as const,
                action: s.action,
                description: s.label,
              })),
            )}
            compact
          />
        </div>
      ) : null}

      {snapshot?.countryResults?.length ? (
        <CountryReport results={snapshot.countryResults} />
      ) : null}

      {snapshot?.apiErrors?.length ? <ApiErrorsBlock errors={snapshot.apiErrors} /> : null}

      <ul className="steps-list">
        {(showLiveFromSnapshot
          ? snapshot?.steps ?? []
          : previewSteps.map((s) => ({
              id: s.id,
              label: s.label,
              status: 'pending' as StepStatus,
              message: undefined as string | undefined,
              apiErrors: undefined as ApiErrorRecord[] | undefined,
            }))
        ).map((step) => (
          <li key={step.id} className="step-item">
            <span className={dotClass(step.status)} />
            <div>
              <div className="step-label">{step.label}</div>
              {'message' in step && step.message ? (
                <div className="step-msg">{step.message}</div>
              ) : null}
              {'apiErrors' in step && step.apiErrors?.length ? (
                <div className="step-msg api-error-inline">
                  API error:{' '}
                  {step.apiErrors
                    .map((e) => `${e.status ?? 'NET'} ${e.message}`)
                    .join(' · ')}
                </div>
              ) : null}
            </div>
          </li>
        ))}
        {!showLiveFromSnapshot && !previewSteps.length && !snapshot?.steps?.length ? (
          <li className="step-item">
            <span className="step-dot pending" />
            <div className="step-label">Press Start to run this suite</div>
          </li>
        ) : null}
      </ul>

      <div className="overview-actions">
        {!running ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStart}
            disabled={starting || runDisabled}
          >
            {snapshot ? 'Run again' : 'Start test'}
          </button>
        ) : (
          <button type="button" className="btn btn-danger" onClick={onStop}>
            Stop
          </button>
        )}
        {onViewTestCase ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={viewLoading}
            onClick={onViewTestCase}
          >
            {viewLoading ? 'Loading…' : '👁 View test case'}
          </button>
        ) : null}
        {onOpenReports ? (
          <button type="button" className="btn btn-ghost" onClick={onOpenReports}>
            Reports
          </button>
        ) : null}
      </div>
    </aside>
  );
}
