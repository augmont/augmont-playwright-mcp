'use client';

import type { StepStatus, WebFlowStep, WebTestCase } from '@/lib/types';
import { buildReportFlowChart } from '@/lib/flow-chart';
import { resolveExpectation } from '@/lib/test-expectation';

type BranchCase = Pick<WebTestCase, 'id' | 'name' | 'steps' | 'expectation' | 'tags'>;

type Props = {
  positive?: BranchCase | null;
  negative?: BranchCase | null;
  /** Suite / group label */
  title?: string;
  /** Highlight which branch is currently selected for editing */
  activeExpectation?: 'positive' | 'negative' | null;
  onSelectBranch?: (expectation: 'positive' | 'negative') => void;
  /** When provided, node click selects within that branch */
  onSelectStep?: (expectation: 'positive' | 'negative', stepId: string) => void;
  selectedStepId?: string | null;
  compact?: boolean;
};

function stepsAsPending(steps: WebFlowStep[] = []) {
  return buildReportFlowChart(
    steps.map((s) => ({
      id: s.id,
      label: s.label,
      status: 'pending' as StepStatus,
      action: s.action,
      description: s.label,
    })),
  );
}

function BranchColumn({
  expectation,
  label,
  nodes,
  active,
  selectedStepId,
  onSelectBranch,
  onSelectStep,
}: {
  expectation: 'positive' | 'negative';
  label: string;
  nodes: ReturnType<typeof buildReportFlowChart>;
  active: boolean;
  selectedStepId?: string | null;
  onSelectBranch?: (expectation: 'positive' | 'negative') => void;
  onSelectStep?: (expectation: 'positive' | 'negative', stepId: string) => void;
}) {
  const mid = nodes.filter((n) => !n.locked);
  return (
    <div
      className={`suite-pair-branch expectation-${expectation}${active ? ' is-active' : ''}`}
      role="group"
      aria-label={`${label} path`}
    >
      <button
        type="button"
        className={`suite-pair-branch-head expectation-tag expectation-${expectation}`}
        onClick={() => onSelectBranch?.(expectation)}
      >
        {label}
      </button>
      <div className="suite-pair-branch-steps">
        {!mid.length ? (
          <p className="step-msg">No steps yet</p>
        ) : (
          mid.map((node, index) => {
            const isLast = index === mid.length - 1;
            const selected = selectedStepId === node.id && active;
            return (
              <div key={node.id} className="suite-pair-step-wrap">
                <button
                  type="button"
                  className={`suite-pair-step${selected ? ' selected' : ''}`}
                  onClick={() => {
                    onSelectBranch?.(expectation);
                    onSelectStep?.(expectation, node.id);
                  }}
                >
                  <span className="suite-pair-step-badge">{node.action || 'step'}</span>
                  <span className="suite-pair-step-label">{node.label}</span>
                </button>
                {!isLast ? <div className="suite-pair-step-connector" aria-hidden /> : null}
              </div>
            );
          })
        )}
      </div>
      <div className={`suite-pair-end expectation-${expectation}`}>
        End · {expectation === 'positive' ? 'success' : 'error path'}
      </div>
    </div>
  );
}

/** One suite chart: Start → Positive | Negative branches → End (same test suite / pair). */
export function SuitePairFlowChart({
  positive,
  negative,
  title = 'Suite flow chart · Positive + Negative',
  activeExpectation = null,
  onSelectBranch,
  onSelectStep,
  selectedStepId,
  compact = false,
}: Props) {
  if (!positive && !negative) {
    return (
      <div className={`suite-pair-flow${compact ? ' is-compact' : ''}`}>
        <h3 className="section-title" style={{ marginTop: 0 }}>
          {title}
        </h3>
        <p className="step-msg">No positive/negative pair in this suite yet.</p>
      </div>
    );
  }

  const posNodes = stepsAsPending(positive?.steps);
  const negNodes = stepsAsPending(negative?.steps);
  const suiteName =
    (positive?.name || negative?.name || '')
      .replace(/\s*\((Positive|Negative)\)\s*$/i, '')
      .trim() || 'Test suite';

  return (
    <div className={`suite-pair-flow${compact ? ' is-compact' : ''}`}>
      {!compact ? (
        <>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            {title}
          </h3>
          <p className="field-hint" style={{ marginBottom: '0.75rem' }}>
            Same suite (<strong>{suiteName}</strong>) — both paths share one group/pair. Runs still
            execute each path separately; the chart shows them together.
          </p>
        </>
      ) : null}

      <div className="suite-pair-canvas">
        <div className="suite-pair-start">Start</div>
        <div className="suite-pair-fork" aria-hidden>
          <span />
        </div>
        <div className="suite-pair-branches">
          {positive ? (
            <BranchColumn
              expectation="positive"
              label="Positive · happy path"
              nodes={posNodes}
              active={activeExpectation === 'positive'}
              selectedStepId={selectedStepId}
              onSelectBranch={onSelectBranch}
              onSelectStep={onSelectStep}
            />
          ) : (
            <div className="suite-pair-branch is-empty">
              <span className="history-meta">Positive missing</span>
            </div>
          )}
          {negative ? (
            <BranchColumn
              expectation="negative"
              label="Negative · error path"
              nodes={negNodes}
              active={activeExpectation === 'negative'}
              selectedStepId={selectedStepId}
              onSelectBranch={onSelectBranch}
              onSelectStep={onSelectStep}
            />
          ) : (
            <div className="suite-pair-branch is-empty">
              <span className="history-meta">Negative missing</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pick positive + negative from a list for the same pair. */
export function pickSuitePair(
  cases: BranchCase[],
  preferred?: BranchCase | null,
): { positive: BranchCase | null; negative: BranchCase | null } {
  let positive: BranchCase | null = null;
  let negative: BranchCase | null = null;
  for (const c of cases) {
    const e = resolveExpectation(c);
    if (e === 'positive' && !positive) positive = c;
    if (e === 'negative' && !negative) negative = c;
  }
  if (preferred) {
    const e = resolveExpectation(preferred);
    if (e === 'positive') positive = preferred;
    if (e === 'negative') negative = preferred;
  }
  return { positive, negative };
}
