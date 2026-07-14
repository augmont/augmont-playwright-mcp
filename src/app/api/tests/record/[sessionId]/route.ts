import { NextResponse } from 'next/server';
import {
  applyRecordAction,
  closeRecordSession,
  getRecordSession,
  getRecordedFlowSnapshot,
  recordSessionPublicState,
  type RecordActionInput,
} from '@/server/record-session';
import { claudeGenerateTestCases } from '@/server/claude';
import {
  listWebFlowCases,
  normalizeWebTestCases,
} from '@/server/web-test-store';
import { partitionAgainstExisting } from '@/server/test-case-duplicates';
import { OPENROUTER_AUTO } from '@/lib/openrouter-models';
import { sanitizeClientAiKeys } from '@/server/ai-keys-request';
import {
  formatFlowChartForPrompt,
  type FlowChartNode,
} from '@/lib/flow-chart';
import { ensureCombinedSuites } from '@/lib/test-expectation';
import type { WebTestCase } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

type ActionBody = {
  action?: RecordActionInput['type'] | 'generate';
  nx?: number;
  ny?: number;
  value?: string;
  text?: string;
  selector?: string;
  key?: string;
  url?: string;
  dy?: number;
  dx?: number;
  email?: string;
  password?: string;
  loginRole?: string;
  /** Test case name (required for generate). Other fields auto-fill when omitted. */
  name?: string;
  description?: string;
  functionality?: string;
  tags?: string[];
  model?: string;
  provider?: string;
  openRouterApiKey?: string;
  anthropicApiKey?: string;
  apiUrl?: string;
  closeAfter?: boolean;
  /** User-edited flowchart — preferred over raw events when present */
  flowChart?: FlowChartNode[];
};

function roleHintFrom(role?: string) {
  return role === 'public' || role === 'buyer' || role === 'seller' || role === 'admin'
    ? role
    : undefined;
}

function autoMetaFromName(opts: {
  name: string;
  description?: string;
  functionality?: string;
  tags?: string[];
  role?: string;
  stepHintCount?: number;
}) {
  const name = opts.name.trim();
  const description =
    (opts.description || '').trim() ||
    (opts.functionality || '').trim() ||
    `MCP click-flow: ${name}`;
  const tags =
    Array.isArray(opts.tags) && opts.tags.length
      ? opts.tags.map((t) => String(t).trim()).filter(Boolean)
      : ['web', 'mcp-click-flow', opts.role || 'public'].filter(Boolean);
  const estimatedMinutes = Math.max(2, Math.ceil((opts.stepHintCount || 4) / 2));
  return { name, description, tags, estimatedMinutes };
}

/** GET session state + events */
export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const state = recordSessionPublicState(sessionId);
  if (!state) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, session: state });
}

/**
 * POST actions while recording, or generate a test case from the captured flow.
 * action: click | fill | press | goto | scroll | scrape | generate
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as ActionBody;
  const actionType = body.action || 'click';

  if (actionType === 'generate') {
    const session = getRecordSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const name = (body.name || '').trim();
    if (!name) {
      return NextResponse.json(
        { error: 'name is required to create the test case (other fields auto-set)' },
        { status: 400 },
      );
    }

    const interactionEvents = session.events.filter((e) => e.action !== 'page');
    const flowChart = Array.isArray(body.flowChart) ? body.flowChart : [];
    const flowSteps = flowChart.filter(
      (n) => n && n.action !== 'start' && n.action !== 'end' && !n.locked,
    );
    if (interactionEvents.length < 1 && flowSteps.length < 1) {
      return NextResponse.json(
        { error: 'Capture at least one click/fill/navigation (or edit the flow chart) before generating' },
        { status: 400 },
      );
    }

    session.status = 'generating';
    const roleHint = roleHintFrom(session.role);
    const meta = autoMetaFromName({
      name,
      description: body.description,
      functionality: body.functionality,
      tags: body.tags,
      role: roleHint,
      stepHintCount: flowSteps.length || interactionEvents.length,
    });

    const recordedSnap = getRecordedFlowSnapshot(sessionId) || '';
    const flowPrompt = flowSteps.length
      ? formatFlowChartForPrompt(flowChart)
      : '';
    const functionalityLine = (body.functionality || '').trim();

    const promptParts = [
      `Create ONE combined test suite named "${meta.name}" (suiteMode combined) with Positive + Negative paths.`,
      `Description: ${meta.description}`,
      functionalityLine ? `Functionality / intent: ${functionalityLine}` : '',
      `Tags: ${meta.tags.join(', ')}, combined-suite`,
      `estimatedMinutes: ${meta.estimatedMinutes}`,
      roleHint ? `role must be "${roleHint}".` : '',
      roleHint && roleHint !== 'public'
        ? `Start with loginRole value ${roleHint} when the flow needs auth (credentials are available).`
        : '',
      flowPrompt
        ? 'Use the EDITABLE FLOW CHART below as the PRIMARY source of truth for step order and fields (user may have edited it). If it has a Positive/Negative fork, map arms to positiveSteps / negativeSteps.'
        : 'Use the RECORDED MCP CLICK FLOW below as the source of truth for positiveSteps; invent negativeSteps (invalid inputs + error asserts) for the same flow.',
      'ALWAYS return a SINGLE combined suite in cases[] — never separate Positive/Negative cases.',
      'Include positiveSteps (happy path) and negativeSteps (error path). Also set steps = positiveSteps.',
      'Skip redundant [page] chatter; keep real user actions as steps. After each goto add assertUrl.',
      'If only a name was provided, still produce a complete suite (description, tags, both path step lists) from the recording/chart.',
    ].filter(Boolean);

    try {
      const existing = listWebFlowCases();
      const enrichedPrompt = promptParts.join('\n');
      const liveDomSnapshot = [flowPrompt, recordedSnap].filter(Boolean).join('\n\n');
      const aiKeys = sanitizeClientAiKeys(body);
      const result = await claudeGenerateTestCases({
        prompt: enrichedPrompt,
        baseUrl: session.baseUrl,
        apiUrl: body.apiUrl,
        mode: 'generate',
        model: body.model || OPENROUTER_AUTO,
        provider: body.provider,
        role: roleHint,
        existingCases: existing,
        includeUiGuide: true,
        liveDomSnapshot,
        forceCaseName: meta.name,
        forceCaseDescription: meta.description,
        forceCaseTags: meta.tags,
        openRouterApiKey: aiKeys.openRouterApiKey,
        anthropicApiKey: aiKeys.anthropicApiKey,
      });

      let normalized = ensureCombinedSuites(
        normalizeWebTestCases(result.data, 'claude'),
      );
      // Enforce name-only defaults when AI drifts
      normalized = normalized.map((c) => ({
        ...c,
        name: c.name?.trim() || meta.name,
        description: c.description?.trim() || meta.description,
        tags: c.tags?.length
          ? c.tags
          : [...meta.tags, 'combined-suite'].filter(
              (t, i, a) => a.indexOf(t) === i,
            ),
        estimatedMinutes: c.estimatedMinutes || meta.estimatedMinutes,
        role: roleHint || c.role || 'public',
        group: c.group || meta.name,
        pairId:
          c.pairId || meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || c.id,
        suiteMode: 'combined' as const,
      }));

      if (roleHint) {
        normalized = normalized.map((c) => ({ ...c, role: roleHint }));
      }

      const { novel, duplicates } = partitionAgainstExisting(normalized, existing, {
        role: roleHint,
      });

      if (body.closeAfter !== false) {
        await closeRecordSession(sessionId);
      } else {
        session.status = 'recording';
      }

      if (!novel.length && !duplicates.length) {
        return NextResponse.json(
          { error: 'AI did not return a valid test case from the recorded flow' },
          { status: 422 },
        );
      }

      return NextResponse.json({
        ok: true,
        preview: true,
        model: result.model,
        attempted: result.attempted,
        cases: novel as WebTestCase[],
        novel: novel as WebTestCase[],
        duplicates: duplicates.map((d) => ({
          message: d.message,
          reason: d.reason,
          score: d.score,
          generated: d.generated,
          existing: d.existing,
        })),
        message: novel.length
          ? `Generated ${novel.length} case(s) from MCP click flow`
          : `Already in library — ${duplicates.length} match(es)`,
      });
    } catch (err) {
      session.status = 'recording';
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Generate from recording failed' },
        { status: 500 },
      );
    }
  }

  try {
    let action: RecordActionInput;
    switch (actionType) {
      case 'click':
        action = {
          type: 'click',
          nx: typeof body.nx === 'number' ? body.nx : 0.5,
          ny: typeof body.ny === 'number' ? body.ny : 0.5,
        };
        break;
      case 'fill':
        action = {
          type: 'fill',
          value: String(body.value ?? ''),
          selector: body.selector,
        };
        break;
      case 'type':
        action = {
          type: 'type',
          text: String(body.text ?? body.value ?? ''),
          selector: body.selector,
        };
        break;
      case 'press':
        action = { type: 'press', key: String(body.key || 'Enter') };
        break;
      case 'goto':
        if (!(body.url || '').trim()) {
          return NextResponse.json({ error: 'url is required for goto' }, { status: 400 });
        }
        action = { type: 'goto', url: String(body.url) };
        break;
      case 'scroll':
        action = { type: 'scroll', dy: body.dy, dx: body.dx };
        break;
      case 'scrape':
        action = { type: 'scrape' };
        break;
      case 'login':
        action = {
          type: 'login',
          email: String(body.email || ''),
          password: String(body.password || ''),
          role: body.loginRole || undefined,
        };
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${actionType}` }, { status: 400 });
    }

    const result = await applyRecordAction(sessionId, action);
    return NextResponse.json({
      ok: true,
      ...result,
      session: recordSessionPublicState(sessionId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Record action failed' },
      { status: 500 },
    );
  }
}

/** End / discard recording */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  await closeRecordSession(sessionId);
  return NextResponse.json({ ok: true });
}
