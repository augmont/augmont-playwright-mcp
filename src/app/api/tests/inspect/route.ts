import {
  inspectPortalForGenerate,
  type LiveDomElement,
  type LivePageSnapshot,
} from '@/server/live-page-inspect';
import { createInspectSession, endInspectSession } from '@/server/inspect-session';
import type { RoleCredentialsMap } from '@/lib/role-credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type InspectBody = {
  baseUrl?: string;
  prompt?: string;
  role?: string;
  testId?: string;
  pathsHint?: string;
  roleCredentials?: {
    buyer?: { email?: string; password?: string };
    admin?: { email?: string; password?: string };
    seller?: { email?: string; password?: string };
  };
  keepSession?: boolean;
};

function roleHintFrom(role?: string) {
  return role === 'public' || role === 'buyer' || role === 'seller' || role === 'admin'
    ? role
    : undefined;
}

function sanitizeRoleCredentials(
  raw?: InspectBody['roleCredentials'],
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

function flattenElements(pages: LivePageSnapshot[]) {
  const out: Array<LiveDomElement & { path: string; pageUrl: string }> = [];
  for (const page of pages) {
    for (const el of page.elements) {
      out.push({ ...el, path: page.path, pageUrl: page.url });
    }
  }
  return out;
}

/**
 * NDJSON stream: inspect_session → status… → done { elements, pages }
 * so the UI can show MCP live view while Playwright scrapes.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as InspectBody;
  const baseUrl = (body.baseUrl || '').trim();
  if (!baseUrl) {
    return new Response(JSON.stringify({ type: 'error', message: 'baseUrl is required' }) + '\n', {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
    });
  }

  const role = roleHintFrom(body.role);
  const promptParts = [
    body.prompt || '',
    body.testId ? `test case id ${body.testId}` : '',
    body.pathsHint || '',
    role ? `${role} portal pages` : '',
  ].filter(Boolean);
  const prompt = promptParts.join('\n') || 'Inspect main portal interactive elements';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify({ ...obj, at: new Date().toISOString() })}\n`));
      };

      let inspectSessionId: string | undefined;
      try {
        inspectSessionId = createInspectSession(
          body.testId ? `select:${body.testId}` : 'select',
        );
        send({
          type: 'inspect_session',
          inspectSessionId,
          message: `MCP live view · ${inspectSessionId.slice(0, 8)}`,
        });

        const result = await inspectPortalForGenerate({
          baseUrl,
          prompt,
          role,
          credentials: sanitizeRoleCredentials(body.roleCredentials),
          inspectSessionId,
          onProgress: (message) =>
            send({ type: 'status', message, inspectSessionId }),
        });

        const elements = flattenElements(result.pages);

        if (body.keepSession === false && inspectSessionId) {
          endInspectSession(inspectSessionId);
          inspectSessionId = undefined;
        }

        send({
          type: 'done',
          ok: result.ok,
          message: result.message,
          inspectSessionId,
          loggedInAs: result.loggedInAs,
          pages: result.pages,
          elements,
        });
      } catch (err) {
        if (inspectSessionId) endInspectSession(inspectSessionId);
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Inspect failed',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
