'use client';

import type { LoadGradeSummary, LoadMetricCompareRow } from '@/lib/types';
import {
  listConfiguredThresholdRows,
  type LoadGradeThresholds,
} from '@/lib/load-grade-summary';

function thresholdsFromGrade(
  grade: LoadGradeSummary,
): LoadGradeThresholds {
  const t = grade.thresholds;
  return {
    maxErrorRatePct: t.maxErrorRatePct,
    p50Ms: t.p50Ms,
    p75Ms: t.p75Ms,
    p90Ms: t.p90Ms,
    p95Ms: t.p95Ms,
    p99Ms: t.p99Ms,
    avgMs: t.avgMs,
    maxAvgLatencyMs: t.avgLatencyMs,
    maxAvgConnectMs: t.avgConnectMs,
    virtualUsers: t.virtualUsers,
    durationSec: t.durationSec,
  };
}

export function LoadThresholdsTables({
  thresholds,
  grade,
  compareTitle = 'Thresholds · required vs this run',
}: {
  thresholds?: LoadGradeThresholds | null;
  grade?: LoadGradeSummary | null;
  compareTitle?: string;
}) {
  const configInput =
    (grade ? thresholdsFromGrade(grade) : null) || thresholds || null;
  const configRows = configInput
    ? listConfiguredThresholdRows(configInput)
    : [];
  const compareRows: LoadMetricCompareRow[] = grade?.metrics || [];

  if (!configRows.length && !compareRows.length) {
    return (
      <p className="load-metrics-empty">
        No thresholds configured yet. Set them in Edit case → Load settings.
      </p>
    );
  }

  return (
    <div className="load-thresholds-tables">
      {configRows.length ? (
        <div className="load-metric-compare">
          <h3 className="load-metric-compare-title">Current thresholds</h3>
          <div className="load-metric-compare-table-wrap">
            <table className="load-metric-compare-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Threshold limit</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {configRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>
                      <code>{row.limit}</code>
                    </td>
                    <td className="load-metric-importance">{row.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {compareRows.length ? (
        <div className="load-metric-compare" style={{ marginTop: '1rem' }}>
          <h3 className="load-metric-compare-title">{compareTitle}</h3>
          <div className="load-metric-compare-table-wrap">
            <table className="load-metric-compare-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Required (threshold)</th>
                  <th>Actual (this run)</th>
                  <th>Result</th>
                  <th>Importance</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr
                    key={row.key}
                    className={row.passed ? 'row-pass' : 'row-fail'}
                  >
                    <td>{row.label}</td>
                    <td>
                      <code>{row.required}</code>
                    </td>
                    <td>
                      <code>{row.actual}</code>
                    </td>
                    <td>
                      <span
                        className={`load-metric-pass-pill ${row.passed ? 'ok' : 'bad'}`}
                      >
                        {row.passed ? 'Pass' : 'Fail'}
                      </span>
                    </td>
                    <td className="load-metric-importance">{row.importance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {grade ? (
            <p className="history-meta" style={{ marginTop: '0.65rem' }}>
              Grade: <strong>{grade.label}</strong> (score {grade.score}/100)
              {compareRows.every((r) => r.passed)
                ? ' · all threshold metrics passed'
                : ` · ${compareRows.filter((r) => !r.passed).length} metric(s) failed`}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="history-meta" style={{ marginTop: '0.85rem' }}>
          Run a load test to fill the required-vs-actual threshold metrics table.
        </p>
      )}
    </div>
  );
}

export function LoadThresholdsPanel({
  thresholds,
  grade,
  title = 'Thresholds',
}: {
  thresholds?: LoadGradeThresholds | null;
  grade?: LoadGradeSummary | null;
  title?: string;
}) {
  return (
    <section className="load-panel load-thresholds-panel">
      <h2 className="load-panel-title">
        {title}
        {grade ? (
          <span
            className={`load-grade-badge load-grade-${grade.grade}`}
            style={{ marginLeft: '0.5rem' }}
          >
            {grade.label}
          </span>
        ) : null}
      </h2>
      <p className="history-meta" style={{ marginTop: 0 }}>
        Configured SLA limits and how this JMeter run compared against each
        threshold.
      </p>
      <LoadThresholdsTables thresholds={thresholds} grade={grade} />
    </section>
  );
}
