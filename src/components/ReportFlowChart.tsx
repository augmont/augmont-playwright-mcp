'use client';

import type { ReportFlowNode } from '@/lib/types';
import { ensureReportFlowChart } from '@/lib/flow-chart';

type Props = {
  nodes?: ReportFlowNode[];
  steps?: Parameters<typeof ensureReportFlowChart>[0]['steps'];
  title?: string;
  compact?: boolean;
};

export function ReportFlowChart({
  nodes,
  steps,
  title = 'Test flow chart',
  compact = false,
}: Props) {
  const chart =
    nodes && nodes.length
      ? nodes
      : ensureReportFlowChart({ steps: steps || [], flowChart: nodes });

  if (!chart.length) {
    return (
      <div className={`report-flow-chart${compact ? ' is-compact' : ''}`}>
        <h3 className="section-title" style={{ marginTop: 0 }}>
          {title}
        </h3>
        <p className="step-msg">No steps to chart.</p>
      </div>
    );
  }

  return (
    <div className={`report-flow-chart${compact ? ' is-compact' : ''}`}>
      {!compact ? (
        <h3 className="section-title" style={{ marginTop: 0 }}>
          {title}
        </h3>
      ) : null}
      <p className="history-meta" style={{ marginBottom: '0.65rem' }}>
        Each node shows step success / fail. Failed steps break the path; skipped nodes were not run.
      </p>
      <div className="report-flow-canvas" role="list">
        {chart.map((node, index) => {
          const isLast = index === chart.length - 1;
          return (
            <div key={node.id} className="report-flow-item" role="listitem">
              <div
                className={`report-flow-node status-${node.status}${node.locked ? ' locked' : ''}`}
              >
                <span className="report-flow-badge">
                  {node.action || 'step'} · {node.status}
                </span>
                <span className="report-flow-label">{node.label}</span>
                {node.message ? (
                  <span className="report-flow-msg">{node.message}</span>
                ) : null}
              </div>
              {!isLast ? (
                <div
                  className={`report-flow-connector status-${node.status}`}
                  aria-hidden
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Compact status strip for history list rows */
export function ReportFlowMini({
  nodes,
  steps,
}: {
  nodes?: ReportFlowNode[];
  steps?: Parameters<typeof ensureReportFlowChart>[0]['steps'];
}) {
  const chart = ensureReportFlowChart({ steps: steps || [], flowChart: nodes }).filter(
    (n) => !n.locked,
  );
  if (!chart.length) return null;
  return (
    <div className="report-flow-mini" title="Step pass/fail flow" aria-label="Step status flow">
      {chart.map((n) => (
        <span
          key={n.id}
          className={`report-flow-mini-dot status-${n.status}`}
          title={`${n.label}: ${n.status}`}
        />
      ))}
    </div>
  );
}
