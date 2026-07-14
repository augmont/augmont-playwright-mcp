import { NextResponse } from 'next/server';
import { claudeValidateTestCase } from '@/server/claude';
import { normalizeWebTestCases } from '@/server/web-test-store';
import { ensureCombinedSuites } from '@/lib/test-expectation';
import { OPENROUTER_AUTO } from '@/lib/openrouter-models';
import {
  applyFlowNodesToCase,
  formatFlowChartForPrompt,
  type FlowChartNode,
} from '@/lib/flow-chart';
import { sanitizeClientAiKeys } from '@/server/ai-keys-request';
import type { WebTestCase } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type ValidateBody = {
  testCase?: WebTestCase;
  /** Editable flowchart nodes — when present, test case steps are synced from them first */
  flowChart?: FlowChartNode[];
  syncFromFlowChart?: boolean;
  baseUrl?: string;
  apiUrl?: string;
  model?: string;
  provider?: string;
  openRouterApiKey?: string;
  anthropicApiKey?: string;
  /** If true and AI returns fixedCase, include normalized fixed case */
  applyFixes?: boolean;
};

/**
 * AI-validate a web test case (optionally synced from an editable flowchart).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ValidateBody;
  let testCase = body.testCase;

  if (!testCase || typeof testCase !== 'object') {
    return NextResponse.json({ error: 'testCase is required' }, { status: 400 });
  }

  if (body.syncFromFlowChart !== false && Array.isArray(body.flowChart) && body.flowChart.length) {
    testCase = applyFlowNodesToCase(testCase, body.flowChart);
  }

  const stepCountOk =
    (Array.isArray(testCase.steps) && testCase.steps.length > 0) ||
    (Array.isArray(testCase.positiveSteps) && testCase.positiveSteps.length > 0);
  if (!stepCountOk) {
    return NextResponse.json(
      { error: 'Test case has no steps — edit the flow chart first' },
      { status: 400 },
    );
  }

  try {
    const aiKeys = sanitizeClientAiKeys(body);
    const result = await claudeValidateTestCase({
      testCase,
      flowChartPrompt: Array.isArray(body.flowChart)
        ? formatFlowChartForPrompt(body.flowChart)
        : undefined,
      baseUrl: body.baseUrl,
      apiUrl: body.apiUrl,
      model: body.model || OPENROUTER_AUTO,
      provider: body.provider,
      openRouterApiKey: aiKeys.openRouterApiKey,
      anthropicApiKey: aiKeys.anthropicApiKey,
    });

    let fixed: WebTestCase | null = null;
    if (result.fixedCase && body.applyFixes !== false) {
      const normalized = ensureCombinedSuites(
        normalizeWebTestCases(result.fixedCase, 'claude'),
      );
      if (normalized[0]) {
        fixed = {
          ...normalized[0],
          id: testCase.id || normalized[0].id,
          name: testCase.name || normalized[0].name,
          role: testCase.role || normalized[0].role,
          suiteMode: 'combined',
        };
      }
    }

    return NextResponse.json({
      ok: true,
      proper: result.proper,
      score: result.score,
      summary: result.summary,
      issues: result.issues,
      suggestions: result.suggestions,
      model: result.model,
      attempted: result.attempted,
      testCase,
      fixedCase: fixed,
      message: result.proper
        ? `Valid · score ${result.score}/100 — ${result.summary}`
        : `Needs work · score ${result.score}/100 — ${result.summary}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Validation failed' },
      { status: 500 },
    );
  }
}
