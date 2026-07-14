import { generateVaptCases, type VaptAiProgressEvent } from '@/server/vapt-ai';
import {
  listVaptCases,
  normalizeVaptCases,
} from '@/server/vapt-store';
import { sanitizeClientAiKeys } from '@/server/ai-keys-request';
import { OPENROUTER_AUTO } from '@/lib/openrouter-models';
import type { VaptTestCase } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

function tryParseLocalLoadCases(content: string): VaptTestCase[] {
  try {
    const raw = JSON.parse(content);
    return normalizeVaptCases(raw, 'upload');
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('file');
  const baseUrl = String(form.get('baseUrl') || '');
  const apiUrl = String(form.get('apiUrl') || '');
  const model = String(form.get('model') || OPENROUTER_AUTO);
  const provider = String(form.get('provider') || '');
  const openRouterApiKey = String(form.get('openRouterApiKey') || '');
  const anthropicApiKey = String(form.get('anthropicApiKey') || '');
  const aiKeys = sanitizeClientAiKeys({ openRouterApiKey, anthropicApiKey });
  const stream = String(form.get('stream') || 'true') !== 'false';
  const extraPrompt = String(form.get('prompt') || '').trim();

  if (!(file instanceof File)) {
    return Response.json({ error: 'file is required' }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  const allowedExt = /\.(json|md|txt|markdown)$/i.test(name);
  const allowedType = !file.type || /json|text|markdown/i.test(file.type);
  if (!allowedExt && !allowedType) {
    return Response.json(
      { error: 'Upload a .json, .md, or .txt VAPT scenario file' },
      { status: 400 },
    );
  }

  const content = await file.text();
  if (!content.trim()) {
    return Response.json({ error: 'Uploaded file is empty' }, { status: 400 });
  }

  const run = async (send: (event: Record<string, unknown>) => void) => {
    try {
      send({ type: 'status', message: `Reading ${file.name}…` });
      const localCases = tryParseLocalLoadCases(content);
      if (localCases.length) {
        send({
          type: 'status',
          message: `Parsed ${localCases.length} VAPT case(s) from JSON — polishing with AI if needed…`,
        });
      }

      // If JSON already valid and no extra prompt, return local cases directly
      if (localCases.length && !extraPrompt) {
        const existing = listVaptCases();
        const existingIds = new Set(existing.map((c) => c.id));
        send({
          type: 'done',
          model: null,
          cases: localCases,
          message: `Parsed ${localCases.length} VAPT scenario(s) from ${file.name}${
            localCases.some((c) => existingIds.has(c.id))
              ? ' (some ids already exist — save will replace)'
              : ''
          }. Review and save.`,
          parseSource: 'json',
        });
        return;
      }

      send({
        type: 'status',
        message: localCases.length
          ? 'Improving uploaded JSON with AI…'
          : 'AI normalizing upload into VAPT scenarios…',
      });

      const result = await generateVaptCases({
        prompt:
          extraPrompt ||
          (localCases.length
            ? 'Improve / complete the uploaded VAPT cases; keep valid ids when present.'
            : `Normalize this upload (${file.name}) into vapt test cases.`),
        baseUrl: baseUrl || undefined,
        apiUrl: apiUrl || undefined,
        model,
        provider: provider || undefined,
        openRouterApiKey: aiKeys.openRouterApiKey,
        anthropicApiKey: aiKeys.anthropicApiKey,
        fileContent: content.slice(0, 60_000),
        onProgress: (event: VaptAiProgressEvent) => {
          send({ ...event });
        },
      });

      const cases =
        result.cases.length > 0
          ? result.cases
          : localCases.map((c) => ({ ...c, source: 'upload' as const }));

      send({
        type: 'done',
        model: result.model,
        attempted: result.attempted,
        cases,
        message: `Ready ${cases.length} VAPT scenario(s) from upload via ${result.model}. Review and save.`,
        parseSource: localCases.length ? 'json+ai' : 'ai',
      });
    } catch (err) {
      send({
        type: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  };

  if (!stream) {
    const events: Record<string, unknown>[] = [];
    await run((e) => events.push(e));
    const done = events.find((e) => e.type === 'done');
    const error = events.find((e) => e.type === 'error');
    if (error) {
      return Response.json(
        { error: error.message || 'Upload failed' },
        { status: 500 },
      );
    }
    return Response.json(done || { error: 'No result' });
  }

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      await run(send);
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
