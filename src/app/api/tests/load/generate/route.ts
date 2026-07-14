import { NextResponse } from 'next/server';
import { generateWebLoadCases, type LoadAiProgressEvent } from '@/server/load-ai';
import { sanitizeClientAiKeys } from '@/server/ai-keys-request';
import { OPENROUTER_AUTO, OPENROUTER_MODELS } from '@/lib/openrouter-models';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '@/lib/ai-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Body = {
  prompt?: string;
  baseUrl?: string;
  apiUrl?: string;
  model?: string;
  provider?: string;
  stream?: boolean;
  openRouterApiKey?: string;
  anthropicApiKey?: string;
  fileContent?: string;
  visitedPaths?: string[];
};

export async function GET() {
  return NextResponse.json({
    ok: true,
    models: OPENROUTER_MODELS,
    claudeModels: CLAUDE_MODELS,
    defaultClaudeModel: DEFAULT_CLAUDE_MODEL,
    auto: OPENROUTER_AUTO,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const prompt = (body.prompt || '').trim();
  const visitedPaths = Array.isArray(body.visitedPaths)
    ? body.visitedPaths.map(String).filter(Boolean)
    : [];
  const fileContent = (body.fileContent || '').trim();
  if (!prompt && !visitedPaths.length && !fileContent) {
    return NextResponse.json(
      { error: 'prompt, visitedPaths, or fileContent is required' },
      { status: 400 },
    );
  }

  const aiKeys = sanitizeClientAiKeys(body);

  if (!body.stream) {
    try {
      const result = await generateWebLoadCases({
        prompt: prompt || (visitedPaths.length ? 'Create load scenarios from visited paths.' : 'Normalize upload.'),
        baseUrl: body.baseUrl,
        apiUrl: body.apiUrl,
        model: body.model || OPENROUTER_AUTO,
        provider: body.provider,
        openRouterApiKey: aiKeys.openRouterApiKey,
        anthropicApiKey: aiKeys.anthropicApiKey,
        fileContent: fileContent || undefined,
        visitedPaths,
      });
      return NextResponse.json({
        ok: true,
        preview: true,
        model: result.model,
        attempted: result.attempted,
        cases: result.cases,
        message: `Generated ${result.cases.length} load scenario(s) via ${result.model}. Review and save.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generate failed';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        send({ type: 'status', message: 'Starting load scenario generate…' });
        const result = await generateWebLoadCases({
          prompt:
            prompt ||
            (visitedPaths.length
              ? 'Create load scenarios from visited paths.'
              : 'Normalize upload.'),
          baseUrl: body.baseUrl,
          apiUrl: body.apiUrl,
          model: body.model || OPENROUTER_AUTO,
          provider: body.provider,
          openRouterApiKey: aiKeys.openRouterApiKey,
          anthropicApiKey: aiKeys.anthropicApiKey,
          fileContent: fileContent || undefined,
          visitedPaths,
          onProgress: (event: LoadAiProgressEvent) => {
            send({ ...event });
          },
        });
        send({
          type: 'done',
          model: result.model,
          attempted: result.attempted,
          cases: result.cases,
          message: `Generated ${result.cases.length} load scenario(s) via ${result.model}. Review and save.`,
        });
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Generate failed',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
