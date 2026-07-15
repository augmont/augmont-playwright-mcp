'use client';

import type { LoadGradeSummary, ReportAiSummary } from '@/lib/types';
import { LoadThresholdsTables } from '@/components/LoadThresholdsPanel';
import type { LoadGradeThresholds } from '@/lib/load-grade-summary';

export function LoadGradeSummaryPanel({
  grade,
  aiSummary,
  thresholds,
  showThresholdTables = true,
}: {
  grade?: LoadGradeSummary | null;
  aiSummary?: ReportAiSummary | null;
  thresholds?: LoadGradeThresholds | null;
  showThresholdTables?: boolean;
}) {
  if (!grade && !aiSummary && !thresholds) return null;

  const hasAi = Boolean(aiSummary?.narrative || aiSummary?.headline);
  const isLocal = aiSummary?.model === 'local-template';

  return (
    <section className="load-panel load-grade-panel">
      <h2 className="load-panel-title">Performance summary</h2>

      {grade ? (
        <div className="load-grade-hero">
          <span
            className={`load-grade-badge load-grade-${grade.grade}`}
            title={`Score ${grade.score}/100`}
          >
            {grade.label}
          </span>
          <div className="load-grade-copy">
            {hasAi ? (
              <>
                {aiSummary?.headline ? (
                  <p className="report-ai-headline">{aiSummary.headline}</p>
                ) : null}
                <p className="load-grade-summary">
                  {aiSummary?.narrative || grade.summary}
                </p>
                {aiSummary?.rootCause ? (
                  <p className="load-grade-importance">
                    <strong>Root cause:</strong> {aiSummary.rootCause}
                  </p>
                ) : (
                  <p className="load-grade-importance">
                    <strong>Why it matters:</strong> {grade.importance}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="load-grade-summary">{grade.summary}</p>
                <p className="load-grade-importance">
                  <strong>Why it matters:</strong> {grade.importance}
                </p>
              </>
            )}
            {aiSummary?.model ? (
              <p className="history-meta" style={{ marginTop: '0.45rem' }}>
                Summary model:{' '}
                {isLocal
                  ? 'local-template — elaborating with AI when OpenRouter is configured (Report refreshes automatically)'
                  : aiSummary.model}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {hasAi ? (
        <div className="load-ai-summary">
          {aiSummary?.whyFailed ? (
            <div className="report-why-failed">
              <strong>Why it failed</strong>
              <p className="step-msg" style={{ margin: '0.25rem 0 0' }}>
                {aiSummary.whyFailed}
              </p>
            </div>
          ) : null}
          {aiSummary?.developerActions?.length ? (
            <div className="report-action-block">
              <strong>Developer actions</strong>
              <ul className="report-action-list">
                {aiSummary.developerActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {aiSummary?.preventionActions?.length ? (
            <div className="report-action-block report-prevention-block">
              <strong>How to prevent / sustain performance</strong>
              <ul className="report-action-list">
                {aiSummary.preventionActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {aiSummary?.testerActions?.length ? (
            <div className="report-action-block">
              <strong>Tester actions</strong>
              <ul className="report-action-list">
                {aiSummary.testerActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {aiSummary?.studyNotes ? (
            <p className="step-msg report-study-notes">
              <strong>Study notes:</strong> {aiSummary.studyNotes}
            </p>
          ) : null}
          {aiSummary?.codeSnippets?.length ? (
            <div className="report-snippets" style={{ marginTop: '0.85rem' }}>
              <strong>Reference snippets</strong>
              {aiSummary.codeSnippets.map((sn) => (
                <div
                  key={`${sn.title}-${sn.code.slice(0, 24)}`}
                  className="report-snippet-card"
                >
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
        </div>
      ) : null}

      {showThresholdTables ? (
        <LoadThresholdsTables thresholds={thresholds} grade={grade} />
      ) : null}
    </section>
  );
}
