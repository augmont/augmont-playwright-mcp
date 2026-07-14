import { claudeGenerateTestCases } from '@/server/claude';
import { listWebFlowCases, normalizeWebTestCases } from '@/server/web-test-store';
import { ensureCombinedSuites } from '@/lib/test-expectation';
import { partitionAgainstExisting } from '@/server/test-case-duplicates';
import {
  isPythonPlaywrightUpload,
  parsePythonPlaywright,
} from '@/server/python-playwright-import';
import {
  groupNameFromFile,
  keepCasesSeparate,
} from '@/server/import-case-groups';
import {
  formatLiveSnapshotsForPrompt,
  inspectPortalForGenerate,
} from '@/server/live-page-inspect';
import { createInspectSession, endInspectSession } from '@/server/inspect-session';
import { OPENROUTER_AUTO } from '@/lib/openrouter-models';
import type { RoleCredentialsMap } from '@/lib/role-credentials';
import { sanitizeClientAiKeys } from '@/server/ai-keys-request';
import type { WebTestCase } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

function roleHintFrom(role?: string) {
  return role === 'public' || role === 'buyer' || role === 'seller' || role === 'admin'
    ? role
    : undefined;
}

function sanitizeRoleCredentials(raw: unknown): RoleCredentialsMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, { email?: string; password?: string }>;
  const out: RoleCredentialsMap = {};
  for (const key of ['buyer', 'admin', 'seller'] as const) {
    const c = obj[key];
    const email = (c?.email || '').trim();
    const password = c?.password || '';
    if (email && password) out[key] = { email, password };
  }
  return Object.keys(out).length ? out : undefined;
}

function buildInspectPrompt(opts: {
  content: string;
  fileName: string;
  isPy: boolean;
  localCases: WebTestCase[];
  roleHint?: string;
}): string {
  const names = opts.localCases.map((c) => c.name).join('; ');
  const paths = opts.localCases
    .flatMap((c) => c.steps.filter((s) => s.action === 'goto' && s.url).map((s) => s.url!))
    .slice(0, 6)
    .join(' ');
  return [
    `Import / normalize uploaded test file ${opts.fileName}`,
    opts.isPy ? 'Python Playwright script' : 'Uploaded test case file',
    opts.roleHint ? `role ${opts.roleHint}` : '',
    names ? `cases: ${names}` : '',
    paths ? `paths: ${paths}` : '',
    opts.content.slice(0, 2500),
  ]
    .filter(Boolean)
    .join('\n');
}

function tagPython(cases: WebTestCase[], fileName: string, isPy: boolean): WebTestCase[] {
  if (!isPy) return cases;
  return cases.map((c) => ({
    ...c,
    tags: Array.from(new Set([...(c.tags || []), 'python-playwright', 'upload'])),
    description: c.description || `Imported from Python Playwright (${fileName})`,
  }));
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
  const roleHint = roleHintFrom(String(form.get('role') || ''));
  const stream = String(form.get('stream') || 'true') !== 'false';
  const liveInspect = String(form.get('liveInspect') || 'true') !== 'false';
  let roleCredentials: RoleCredentialsMap | undefined;
  try {
    const rawCreds = form.get('roleCredentials');
    if (typeof rawCreds === 'string' && rawCreds.trim()) {
      roleCredentials = sanitizeRoleCredentials(JSON.parse(rawCreds));
    }
  } catch {
    roleCredentials = undefined;
  }

  if (!(file instanceof File)) {
    return Response.json({ error: 'file is required' }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  const allowedExt = /\.(json|md|txt|markdown|py)$/i.test(name);
  const allowedType =
    !file.type || /json|text|markdown|python|x-python/i.test(file.type);
  if (!allowedExt && !allowedType) {
    return Response.json(
      { error: 'Upload a .json, .md, .txt, or .py (Python Playwright) file' },
      { status: 400 },
    );
  }

  const content = await file.text();
  if (!content.trim()) {
    return Response.json({ error: 'Uploaded file is empty' }, { status: 400 });
  }

  const existing = listWebFlowCases();
  const isPy = isPythonPlaywrightUpload(file.name, content);

  const run = async (send: (event: Record<string, unknown>) => void) => {
    let inspectSessionId: string | undefined;
    let parseSource: 'json' | 'python' | 'ai' | 'python+ai' = 'json';
    let usedModel: string | undefined;
    let attempted: string[] = [];
    let liveDomSnapshot: string | undefined;

    try {
      send({ type: 'status', message: `Reading ${file.name}…` });

      let localCases: WebTestCase[] = [];
      if (isPy) {
        localCases = parsePythonPlaywright(content, {
          fileName: file.name,
          roleHint,
        });
        if (localCases.length) {
          parseSource = 'python';
          send({
            type: 'status',
            message: `Parsed ${localCases.length} Python Playwright case(s) locally`,
          });
        }
      }

      if (!localCases.length) {
        try {
          const raw = JSON.parse(content);
          localCases = normalizeWebTestCases(raw, 'upload');
          if (localCases.length) {
            parseSource = 'json';
            send({
              type: 'status',
              message: `Parsed ${localCases.length} JSON case(s)`,
            });
          }
        } catch {
          // not JSON
        }
      }

      const wantInspect = liveInspect && Boolean(baseUrl.trim());
      if (wantInspect) {
        inspectSessionId = createInspectSession(`upload:${file.name}`);
        send({
          type: 'inspect_session',
          inspectSessionId,
          message: `MCP live view · ${inspectSessionId.slice(0, 8)} — opening portal…`,
        });

        const inspectPrompt = buildInspectPrompt({
          content,
          fileName: file.name,
          isPy,
          localCases,
          roleHint,
        });

        const result = await inspectPortalForGenerate({
          baseUrl,
          prompt: inspectPrompt,
          role: roleHint,
          credentials: roleCredentials,
          inspectSessionId,
          onProgress: (message) =>
            send({ type: 'status', message, inspectSessionId }),
        });
        send({ type: 'status', message: result.message, inspectSessionId });
        if (result.pages.length) {
          liveDomSnapshot = formatLiveSnapshotsForPrompt(result.pages);
        }
      } else {
        send({
          type: 'status',
          message: liveInspect
            ? 'Live inspect skipped (set portal URL in Web setup)'
            : 'Live page inspect off — parsing / AI only',
        });
      }

      const needAiRequired = !localCases.length;
      const wantAiEnrich = Boolean(liveDomSnapshot) && localCases.length > 0;

      let cases = localCases;

      if (needAiRequired || wantAiEnrich) {
        send({
          type: 'status',
          message: liveDomSnapshot
            ? 'AI normalizing import with live DOM + UI guide…'
            : 'AI normalizing import…',
        });

        const aiPrompt = [
          roleHint
            ? `Normalize upload into web test cases. All cases must use role "${roleHint}".`
            : 'Normalize upload into web test cases',
          'CRITICAL: Keep EACH test as its OWN separate case in the cases[] array. NEVER merge multiple test_* / scenarios into one mega-case. Return one case per test function / scenario.',
          `Assign the same "group" string "${groupNameFromFile(file.name)}" on every case from this file.`,
          'Return ONLY compact JSON: {"cases":[...]} — no markdown, no commentary.',
          isPy
            ? 'Source is Python Playwright / pytest-playwright. Map page.goto→goto, locator/click/fill/get_by_*→click|fill, expect().to_be_visible→assertVisible, expect(page).to_have_url→assertUrl. One test_*=one case (separate objects).'
            : '',
          localCases.length
            ? `Locally parsed draft — KEEP the same number of cases (${localCases.length}), same ids when possible; only improve selectors using LIVE DOM / CURATED MCP selectors:\n${JSON.stringify({ cases: localCases }).slice(0, 40_000)}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        try {
          const result = await claudeGenerateTestCases({
            prompt: aiPrompt,
            baseUrl: baseUrl || undefined,
            apiUrl: apiUrl || undefined,
            mode: 'upload',
            fileContent: content.slice(0, 80_000),
            model,
            provider: provider || undefined,
            role: roleHint,
            existingCases: existing,
            includeUiGuide: true,
            liveDomSnapshot,
            openRouterApiKey: aiKeys.openRouterApiKey,
            anthropicApiKey: aiKeys.anthropicApiKey,
            onProgress: (event) => {
              send({
                type: event.type,
                message: event.message,
                model: event.model,
                inspectSessionId,
              });
            },
          });
          usedModel = result.model;
          attempted = result.attempted;
          const aiCases = normalizeWebTestCases(result.data, 'upload');
          const suite = groupNameFromFile(file.name);
          if (aiCases.length || localCases.length) {
            const kept = keepCasesSeparate(localCases, aiCases, suite);
            cases = kept.cases;
            if (localCases.length && aiCases.length) {
              parseSource =
                isPy || parseSource === 'python' ? 'python+ai' : 'ai';
            } else if (aiCases.length) {
              parseSource = 'ai';
            }
            send({
              type: 'model_ok',
              message: kept.note
                ? `${kept.note} · ${cases.length} case(s) in group “${suite}”`
                : `AI produced ${aiCases.length} case(s) → ${cases.length} separate in group “${suite}” via ${result.model}`,
              model: result.model,
            });
          } else if (!cases.length) {
            throw new Error('Could not parse any valid web test cases from upload');
          } else {
            send({
              type: 'status',
              message: 'AI returned no cases — keeping local parse',
            });
          }
        } catch (aiErr) {
          if (localCases.length) {
            cases = localCases;
            send({
              type: 'status',
              message: `AI normalize failed — keeping ${localCases.length} locally parsed case(s). ${
                aiErr instanceof Error ? aiErr.message.split('\n')[0] : ''
              }`,
            });
          } else {
            throw aiErr;
          }
        }
      } else {
        send({
          type: 'status',
          message: `Using ${localCases.length} locally parsed case(s) (AI skip)`,
        });
      }

      if (roleHint) {
        cases = cases.map((c) => ({ ...c, role: roleHint }));
      }
      const suite = groupNameFromFile(file.name);
      cases = cases.map((c) => ({ ...c, group: c.group || suite }));
      cases = tagPython(cases, file.name, isPy);
      cases = ensureCombinedSuites(cases);

      const { novel, duplicates } = partitionAgainstExisting(cases, existing, {
        role: roleHint,
      });

      if (!novel.length && !duplicates.length) {
        throw new Error('Could not parse any valid web test cases from upload');
      }

      const payload = {
        ok: true,
        preview: true,
        alreadyExists: novel.length === 0 && duplicates.length > 0,
        model: usedModel,
        attempted,
        parseSource,
        liveInspect: Boolean(liveDomSnapshot),
        cases: novel,
        novel,
        duplicates: duplicates.map((d) => ({
          message: d.message,
          reason: d.reason,
          score: d.score,
          generated: d.generated,
          existing: d.existing,
        })),
        message:
          novel.length === 0 && duplicates.length > 0
            ? `Already in library — ${duplicates.length} match(es) found.`
            : duplicates.length
              ? `Imported ${novel.length} new case(s)${liveDomSnapshot ? ' with live MCP' : ''}; ${duplicates.length} already existed.`
              : `Imported ${novel.length} case(s)${liveDomSnapshot ? ' with live MCP + AI' : parseSource === 'python' ? ' from Python Playwright' : usedModel ? ` via ${usedModel}` : ''}.`,
      };

      send({ type: 'done', ...payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      send({ type: 'error', message });
    } finally {
      if (inspectSessionId) endInspectSession(inspectSessionId);
    }
  };

  if (!stream) {
    let donePayload: Record<string, unknown> | undefined;
    let errorMessage: string | undefined;
    await run((event) => {
      if (event.type === 'done') donePayload = event;
      if (event.type === 'error') errorMessage = String(event.message || 'Upload failed');
    });
    if (errorMessage) {
      const status = /OPENROUTER_API_KEY|ANTHROPIC_API_KEY/i.test(errorMessage)
        ? 503
        : 502;
      return Response.json({ error: errorMessage }, { status });
    }
    return Response.json(donePayload || { error: 'Upload failed' });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`,
          ),
        );
      };
      await run(send);
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-cache',
      Connection: 'keep-alive',
    },
  });
}
