import { NextResponse } from 'next/server';
import { fetchAndParseSwagger, type SwaggerFetchAuth } from '@/server/swagger-parse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeFetchAuth(raw: unknown): SwaggerFetchAuth | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const username = typeof a.username === 'string' ? a.username.trim() : '';
  const password = typeof a.password === 'string' ? a.password : '';
  const bearerToken =
    typeof a.bearerToken === 'string' ? a.bearerToken.trim() : '';
  const authorization =
    typeof a.authorization === 'string' ? a.authorization.trim() : '';
  let headers: Record<string, string> | undefined;
  if (a.headers && typeof a.headers === 'object') {
    headers = {};
    for (const [k, v] of Object.entries(a.headers as Record<string, unknown>)) {
      if (k && v != null) headers[k] = String(v);
    }
    if (!Object.keys(headers).length) headers = undefined;
  }
  if (!username && !password && !bearerToken && !authorization && !headers) {
    return undefined;
  }
  return {
    username: username || undefined,
    password: password || undefined,
    bearerToken: bearerToken || undefined,
    authorization: authorization || undefined,
    headers,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    swaggerUrl?: string;
    /** Auth for fetching the docs URL itself (401/403) */
    fetchAuth?: unknown;
    username?: string;
    password?: string;
    bearerToken?: string;
  };
  const swaggerUrl = (body.swaggerUrl || '').trim();
  if (!swaggerUrl || !/^https?:\/\//i.test(swaggerUrl)) {
    return NextResponse.json(
      { error: 'Valid swaggerUrl (http/https) is required' },
      { status: 400 },
    );
  }

  const fetchAuth =
    sanitizeFetchAuth(body.fetchAuth) ||
    sanitizeFetchAuth({
      username: body.username,
      password: body.password,
      bearerToken: body.bearerToken,
    });

  try {
    const spec = await fetchAndParseSwagger(swaggerUrl, { auth: fetchAuth });
    return NextResponse.json({
      ok: true,
      title: spec.title,
      version: spec.version,
      apiBaseUrl: spec.apiBaseUrl,
      swaggerUrl: spec.swaggerUrl,
      suggestedLoginPath: spec.suggestedLoginPath,
      securitySchemes: spec.securitySchemes,
      operations: spec.operations,
      operationCount: spec.operations.length,
      authRequiredCount: spec.operations.filter((o) => o.requiresAuth).length,
      usedFetchAuth: Boolean(fetchAuth),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse Swagger';
    const status =
      /401|403|Unauthorized|Forbidden/i.test(message) ? 401 : 502;
    return NextResponse.json({ error: message, needsAuth: status === 401 }, { status });
  }
}
