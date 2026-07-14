'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RunReport } from '@/lib/types';
import { ReportDetailModal } from '@/components/ReportDetailModal';
import { ReportFlowMini } from '@/components/ReportFlowChart';
import { resolveExpectation } from '@/lib/test-expectation';

function formatWhen(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ReportHistoryPanel({
  refreshToken = 0,
  compact = false,
}: {
  refreshToken?: number;
  compact?: boolean;
}) {
  const [reports, setReports] = useState<RunReport[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RunReport | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/reports')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setReports(data.reports || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load reports'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  return (
    <section className={`history-panel ${compact ? 'history-panel-compact' : ''}`}>
      {!compact ? (
        <div className="history-header">
          <h2>Last 5 test reports</h2>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      ) : (
        <div className="history-header history-header-compact">
          <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      )}

      {loading ? <p className="step-msg">Loading reports…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && !reports.length ? (
        <p className="step-msg">No runs yet. Start a signup test to build history.</p>
      ) : null}

      <ul className="history-list">
        {reports.slice(0, 5).map((report) => {
          const passed = report.countryResults.filter((c) => c.status === 'passed').length;
          const failed = report.countryResults.filter((c) => c.status === 'failed').length;
          const skipped = report.countryResults.filter((c) => c.status === 'skipped').length;
          return (
            <li key={report.runId} className="history-item">
              <button
                type="button"
                className="history-link history-link-btn"
                onClick={() => setSelected(report)}
              >
                <div className="history-top">
                  <strong>
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
                  </strong>
                  <span className={`status-badge status-${report.status}`}>{report.status}</span>
                </div>
                <div className="history-meta">
                  {formatWhen(report.finishedAt || report.startedAt)} ·{' '}
                  {report.countryResults.length
                    ? `${passed} passed / ${failed} failed / ${skipped} skipped`
                    : `${report.stepCounts.passed} steps passed · ${report.stepCounts.failed} failed`}
                  {(report.apiErrors?.length ?? 0) > 0
                    ? ` · ${report.apiErrors!.length} API error(s)`
                    : ''}
                  {report.pdfPath ? ' · PDF ready' : ''}
                </div>
                <ReportFlowMini nodes={report.flowChart} steps={report.steps} />
                {(report.apiErrors?.length ?? 0) > 0 ? (
                  <div className="step-msg api-error-inline" style={{ marginTop: '0.35rem' }}>
                    {report.apiErrors!.slice(0, 2).map((e) => (
                      <div key={e.id}>
                        {e.status ?? 'NET'} {e.message}
                      </div>
                    ))}
                  </div>
                ) : null}
                {report.countryResults.length > 0 ? (
                  <div className="country-chips">
                    {report.countryResults.map((c) => (
                      <span key={c.isoCode} className={`country-chip ${c.status}`}>
                        {c.isoCode}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <ReportDetailModal
        open={!!selected}
        report={selected}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
