import { NextResponse } from 'next/server';
import type { WebLoadHttpMethod, WebLoadRequestStep } from '@/lib/types';
import { ensureLgdApiV1Base } from '@/lib/api-url';
import { applyParamsToPath } from '@/lib/load-request-params';
import { resolveOutgoingBody } from '@/lib/load-request-body';
import {
  expandDynamicRecord,
  expandDynamicString,
} from '@/lib/load-dynamic-vars';
import type { LoadFormField } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const METHODS: WebLoadHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
];

function resolveUrl(pathOrUrl: string, apiBaseUrl?: string): string {
  const raw = pathOrUrl.trim();
  if (!raw) throw new Error('path is required');
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = ensureLgdApiV1Base(apiBaseUrl || '').replace(/\/+$/, '');
  if (!base) {
    throw new Error('apiBaseUrl is required when path is relative');
  }
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

/**
 * Fire a single HTTP request (Postman-style) and return request + response + error.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<WebLoadRequestStep> & {
    apiBaseUrl?: string;
    useApiBase?: boolean;
    authHeaderValue?: string;
    authHeaderName?: string;
  };

  const resolvedPath = applyParamsToPath(
    {
      path: String(body.path || ''),
      pathParams: body.pathParams,
      queryParams: body.queryParams,
    },
    { mode: 'probe' },
  );

  let url: string;
  try {
    url = resolveUrl(resolvedPath, body.apiBaseUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid URL' },
      { status: 400 },
    );
  }

  const methodRaw = String(body.method || 'GET').toUpperCase();
  const method = METHODS.includes(methodRaw as WebLoadHttpMethod)
    ? (methodRaw as WebLoadHttpMethod)
    : 'GET';

  const formFields = (body.formFields || []).map((f: LoadFormField) => ({
    ...f,
    value: expandDynamicString(f.value, 'probe') || '',
  }));

  const step: WebLoadRequestStep = {
    path: String(body.path || ''),
    method,
    headers: expandDynamicRecord(body.headers, 'probe'),
    body: expandDynamicString(body.body, 'probe'),
    bodyMode: body.bodyMode,
    rawLanguage: body.rawLanguage,
    formFields,
    graphqlQuery: expandDynamicString(body.graphqlQuery, 'probe'),
    graphqlVariables: expandDynamicString(body.graphqlVariables, 'probe'),
    binaryFileName: body.binaryFileName,
    binaryBase64: body.binaryBase64,
    pathParams: body.pathParams,
    queryParams: body.queryParams,
  };

  const outgoing = resolveOutgoingBody(step);
  const headers: Record<string, string> = {
    ...(expandDynamicRecord(outgoing.headers, 'probe') || {}),
  };
  const authName = body.authHeaderName || 'Authorization';
  if (body.authHeaderValue?.trim() && !headers[authName] && !headers.authorization) {
    headers[authName] = body.authHeaderValue.trim();
  }

  let fetchBody: BodyInit | undefined;
  if (outgoing.body != null && !['GET', 'HEAD'].includes(method)) {
    if (outgoing.bodyEncoding === 'base64') {
      fetchBody = Buffer.from(outgoing.body, 'base64');
    } else {
      fetchBody = outgoing.body;
    }
  }

  const started = Date.now();

  const displayHeaders: Record<string, string> = { ...headers };
  for (const key of Object.keys(displayHeaders)) {
    if (/^(authorization|cookie|x-api-key)$/i.test(key)) {
      displayHeaders[key] = '***';
    }
  }

  const requestView = {
    method,
    url,
    headers: displayHeaders,
    body:
      outgoing.mode === 'binary'
        ? `[binary ${body.binaryFileName || 'file'}${outgoing.body ? ` · ${Buffer.from(outgoing.body, 'base64').length} bytes` : ''}]`
        : outgoing.body,
    bodyMode: outgoing.mode,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: fetchBody,
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }

    const elapsedMs = Date.now() - started;
    const text = await res.text();
    const snippet = text.length > 8000 ? `${text.slice(0, 8000)}\n…(truncated)` : text;
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    const ok = res.ok;
    return NextResponse.json({
      ok,
      elapsedMs,
      request: requestView,
      response: {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: snippet,
        size: text.length,
      },
      error: ok
        ? undefined
        : `HTTP ${res.status} ${res.statusText}${
            snippet ? ` — ${snippet.slice(0, 240).replace(/\s+/g, ' ')}` : ''
          }`,
    });
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'Request timed out (30s)'
          : err.message
        : 'Request failed';
    return NextResponse.json({
      ok: false,
      elapsedMs,
      request: requestView,
      response: null,
      error: message,
    });
  }
}
