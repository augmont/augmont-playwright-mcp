import { NextResponse } from 'next/server';
import { claudeGenerateTestCases, type AiProgressEvent } from '@/server/claude';
import {
  listWebFlowCases,
  normalizeWebTestCases,
} from '@/server/web-test-store';
import { ensureCombinedSuites } from '@/lib/test-expectation';
import {
  findExistingForPrompt,
  partitionAgainstExisting,
  type DuplicateMatch,
} from '@/server/test-case-duplicates';
import {
  formatLiveSnapshotsForPrompt,
  inspectPortalForGenerate,
} from '@/server/live-page-inspect';
import { createInspectSession, endInspectSession } from '@/server/inspect-session';
import { OPENROUTER_MODELS, OPENROUTER_AUTO } from '@/lib/openrouter-models';
import type { RoleCredentialsMap } from '@/lib/role-credentials';
import { sanitizeClientAiKeys } from '@/server/ai-keys-request';
import type { WebTestCase } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    models: OPENROUTER_MODELS,
    auto: OPENROUTER_AUTO,
    defaultModel: OPENROUTER_AUTO,
  });
}

type GenerateBody = {
  prompt?: string;
  baseUrl?: string;
  apiUrl?: string;
  model?: string;
  /** openrouter | claude */
  provider?: string;
  role?: string;
  /** When true, stream NDJSON progress events then a final done/error line */
  stream?: boolean;
  /** Skip prompt pre-check and always call the model */
  forceGenerate?: boolean;
  /** Open portal with Playwright and scrape real selectors (default true when baseUrl set) */
  liveInspect?: boolean;
  roleCredentials?: {
    buyer?: { email?: string; password?: string };
    admin?: { email?: string; password?: string };
    seller?: { email?: string; password?: string };
  };
  /** Tab session keys from header → AI setup */
  openRouterApiKey?: string;
  anthropicApiKey?: string;
};

function roleHintFrom(role?: string) {
  return role === 'public' || role === 'buyer' || role === 'seller' || role === 'admin'
    ? role
    : undefined;
}

function sanitizeRoleCredentials(
  raw?: GenerateBody['roleCredentials'],
): RoleCredentialsMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: RoleCredentialsMap = {};
  for (const key of ['buyer', 'admin', 'seller'] as const) {
    const c = raw[key];
    const email = (c?.email || '').trim();
    const password = c?.password || '';
    if (email && password) out[key] = { email, password };
  }
  return Object.keys(out).length ? out : undefined;
}

function serializeDup(d: DuplicateMatch) {
  return {
    message: d.message,
    reason: d.reason,
    score: d.score,
    generated: d.generated,
    existing: d.existing,
  };
}

function finalizeCases(
  cases: WebTestCase[],
  roleHint: ReturnType<typeof roleHintFrom>,
  existing: WebTestCase[],
) {
  let next = cases;
  if (roleHint) {
    next = next.map((c) => ({ ...c, role: roleHint }));
  }
  return partitionAgainstExisting(next, existing, { role: roleHint });
}

async function runLiveInspect(opts: {
  baseUrl?: string;
  prompt: string;
  role?: ReturnType<typeof roleHintFrom>;
  liveInspect?: boolean;
  credentials?: RoleCredentialsMap;
  inspectSessionId?: string;
  onProgress?: (message: string) => void;
}): Promise<{ snapshot?: string; inspectSessionId?: string }> {
  const want =
    opts.liveInspect !== false && Boolean((opts.baseUrl || '').trim());
  if (!want) {
    opts.onProgress?.('Live page inspect skipped (no portal URL or disabled)');
    return {};
  }
  const inspectSessionId = opts.inspectSessionId || createInspectSession();
  opts.onProgress?.(`MCP live view session ${inspectSessionId.slice(0, 8)}…`);
  const result = await inspectPortalForGenerate({
    baseUrl: opts.baseUrl!,
    prompt: opts.prompt,
    role: opts.role,
    credentials: opts.credentials,
    inspectSessionId,
    onProgress: opts.onProgress,
  });
  opts.onProgress?.(result.message);
  if (!result.pages.length) {
    return { inspectSessionId };
  }
  return {
    snapshot: formatLiveSnapshotsForPrompt(result.pages),
    inspectSessionId,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as GenerateBody;

  const prompt = (body.prompt || '').trim();
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  const roleHint = roleHintFrom(body.role);
  const existing = listWebFlowCases();
  const credentials = sanitizeRoleCredentials(body.roleCredentials);
  const aiKeys = sanitizeClientAiKeys(body);
  const enrichedPrompt = roleHint
    ? `${prompt}\n\nIMPORTANT: All generated cases must use role "${roleHint}". Embed loginRole ${roleHint} as first step when the flow needs auth. Do NOT create standalone login-only test cases.`
    : prompt;

  // Fast path: ONLY exact id/name match → show already added.
  // Anything else (not found) → create via AI below.
  if (!body.forceGenerate) {
    const exactHits = findExistingForPrompt(prompt, existing, {
      role: roleHint,
      limit: 8,
    }).filter((h) => h.score >= 0.98);
    if (exactHits.length > 0) {
      const payload = {
        ok: true,
        preview: true,
        alreadyExists: true,
        model: null as string | null,
        attempted: [] as string[],
        cases: [] as WebTestCase[],
        novel: [] as WebTestCase[],
        duplicates: exactHits.map(serializeDup),
        message: `Already this test case added — matched ${exactHits.length} existing case(s). Showing saved case(s) instead of regenerating.`,
      };

      if (!body.stream) {
        return NextResponse.json(payload);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: Record<string, unknown>) => {
            controller.enqueue(
              encoder.encode(`${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`),
            );
          };
          send({
            type: 'status',
            message: 'Checking existing test cases…',
          });
          send({
            type: 'done',
            ...payload,
            message: payload.message,
          });
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store, no-cache',
          Connection: 'keep-alive',
        },
      });
    }
  }

  if (!body.stream) {
    try {
      const inspect = await runLiveInspect({
        baseUrl: body.baseUrl,
        prompt,
        role: roleHint,
        liveInspect: body.liveInspect,
        credentials,
      });
      const liveDomSnapshot = inspect.snapshot;

      const result = await claudeGenerateTestCases({
        prompt: enrichedPrompt,
        baseUrl: body.baseUrl,
        apiUrl: body.apiUrl,
        mode: 'generate',
        model: body.model || OPENROUTER_AUTO,
        provider: body.provider,
        role: roleHint,
        existingCases: existing,
        includeUiGuide: true,
        liveDomSnapshot,
        openRouterApiKey: aiKeys.openRouterApiKey,
        anthropicApiKey: aiKeys.anthropicApiKey,
      });
      if (inspect.inspectSessionId) endInspectSession(inspect.inspectSessionId);
      const normalized = ensureCombinedSuites(
        normalizeWebTestCases(result.data, 'claude'),
      );
      const { novel, duplicates } = finalizeCases(normalized, roleHint, existing);

      if (!novel.length && !duplicates.length) {
        return NextResponse.json(
          {
            error:
              'AI did not return any valid test cases (and no existing match was found). Try a more specific prompt.',
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        ok: true,
        preview: true,
        alreadyExists: novel.length === 0 && duplicates.length > 0,
        model: result.model,
        attempted: result.attempted,
        liveInspect: Boolean(liveDomSnapshot),
        cases: novel,
        novel,
        duplicates: duplicates.map(serializeDup),
        message:
          novel.length === 0 && duplicates.length > 0
            ? `Already this test case added — ${duplicates.length} match(es) found in your library.`
            : duplicates.length
              ? `Generated ${novel.length} new case(s); ${duplicates.length} already existed and were skipped.`
              : `Generated ${novel.length} case(s)${liveDomSnapshot ? ' from live page inspect' : ''}.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generate failed';
      const status = /OPENROUTER_API_KEY|ANTHROPIC_API_KEY/i.test(message) ? 503 : 502;
      return NextResponse.json({ error: message }, { status });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`),
        );
      };

      let inspectSessionId: string | undefined;

      try {
        send({
          type: 'status',
          message: 'Request accepted · checking library, then live portal inspect…',
        });

        inspectSessionId = createInspectSession();
        send({
          type: 'inspect_session',
          inspectSessionId,
          message: 'MCP live view ready — highlighting page sections…',
        });

        const inspect = await runLiveInspect({
          baseUrl: body.baseUrl,
          prompt,
          role: roleHint,
          liveInspect: body.liveInspect,
          credentials,
          inspectSessionId,
          onProgress: (message) => {
            send({ type: 'status', message, inspectSessionId });
          },
        });
        const liveDomSnapshot = inspect.snapshot;

        send({
          type: 'status',
          message: liveDomSnapshot
            ? 'Live DOM captured · generating test cases with real selectors…'
            : 'No live DOM · generating from UI guide only…',
          inspectSessionId,
        });

        const result = await claudeGenerateTestCases({
          prompt: enrichedPrompt,
          baseUrl: body.baseUrl,
          apiUrl: body.apiUrl,
          mode: 'generate',
          model: body.model || OPENROUTER_AUTO,
          provider: body.provider,
          role: roleHint,
          existingCases: existing,
          includeUiGuide: true,
          liveDomSnapshot,
          openRouterApiKey: aiKeys.openRouterApiKey,
          anthropicApiKey: aiKeys.anthropicApiKey,
          onProgress: (event: AiProgressEvent) => {
            send({ ...event, inspectSessionId });
          },
        });

        const normalized = ensureCombinedSuites(
          normalizeWebTestCases(result.data, 'claude'),
        );
        const { novel, duplicates } = finalizeCases(normalized, roleHint, existing);

        if (!novel.length && !duplicates.length) {
          send({
            type: 'error',
            message:
              'AI did not return any valid test cases (and no existing match was found). Try a more specific prompt.',
          });
          return;
        }

        const message =
          novel.length === 0 && duplicates.length > 0
            ? `Already this test case added — ${duplicates.length} match(es) found in your library.`
            : duplicates.length
              ? `Generated ${novel.length} new case(s) via ${result.model}; ${duplicates.length} already existed and were skipped.`
              : `Generated ${novel.length} test case(s) via ${result.model}${liveDomSnapshot ? ' (live selectors)' : ''}`;

        send({
          type: 'done',
          message,
          model: result.model,
          attempted: result.attempted,
          alreadyExists: novel.length === 0 && duplicates.length > 0,
          liveInspect: Boolean(liveDomSnapshot),
          inspectSessionId,
          cases: novel,
          novel,
          duplicates: duplicates.map(serializeDup),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Generate failed';
        send({ type: 'error', message });
      } finally {
        if (inspectSessionId) {
          // Keep last frame briefly for UI, then drop
          setTimeout(() => endInspectSession(inspectSessionId!), 60_000);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-cache',
      Connection: 'keep-alive',
    },
  });
}
