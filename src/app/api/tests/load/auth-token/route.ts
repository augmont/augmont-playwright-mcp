import { NextResponse } from 'next/server';
import type { LoadAuthCredential, LoadAuthLoginConfig } from '@/lib/types';
import { obtainTokensForCredentials } from '@/server/load-auth-token';
import { ensureLgdApiV1Base } from '@/lib/api-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeCredentials(raw: unknown): LoadAuthCredential[] {
  if (!Array.isArray(raw)) return [];
  const out: LoadAuthCredential[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Partial<LoadAuthCredential>;
    const username = String(c.username || '').trim();
    const password = String(c.password || '');
    if (!username || !password) continue;
    out.push({
      id: String(c.id || `cred-${out.length + 1}`),
      label: String(c.label || `User ${out.length + 1}`).trim() || `User ${out.length + 1}`,
      username,
      password,
    });
  }
  return out;
}

function sanitizeLogin(raw: unknown): LoadAuthLoginConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Partial<LoadAuthLoginConfig>;
  const loginPath = String(l.loginPath || '').trim();
  if (!loginPath) return null;
  let extraBody: Record<string, string> | undefined;
  if (l.extraBody && typeof l.extraBody === 'object') {
    extraBody = {};
    for (const [k, v] of Object.entries(l.extraBody)) {
      if (k) extraBody[k] = String(v);
    }
  }
  return {
    loginPath,
    method: l.method,
    usernameField: l.usernameField ? String(l.usernameField) : undefined,
    passwordField: l.passwordField ? String(l.passwordField) : undefined,
    extraBody,
    tokenJsonPath: l.tokenJsonPath ? String(l.tokenJsonPath) : undefined,
    tokenHeader: l.tokenHeader ? String(l.tokenHeader) : undefined,
    tokenPrefix: l.tokenPrefix != null ? String(l.tokenPrefix) : undefined,
  };
}

/**
 * Exchange one or more username/password credentials for API tokens.
 * Tokens are returned to the client for the load run — never written to reports.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    apiUrl?: string;
    credentials?: unknown;
    login?: unknown;
  };

  const apiUrl =
    ensureLgdApiV1Base((body.apiUrl || '').trim()) ||
    (body.apiUrl || '').trim().replace(/\/+$/, '') ||
    undefined;
  const credentials = sanitizeCredentials(body.credentials);
  const login = sanitizeLogin(body.login);

  if (!credentials.length) {
    return NextResponse.json(
      { error: 'Provide at least one username/password credential' },
      { status: 400 },
    );
  }
  if (!login) {
    return NextResponse.json(
      { error: 'login.loginPath is required' },
      { status: 400 },
    );
  }
  if (!/^https?:\/\//i.test(login.loginPath) && !apiUrl) {
    return NextResponse.json(
      { error: 'apiUrl is required when loginPath is relative' },
      { status: 400 },
    );
  }

  try {
    const { tokens, errors } = await obtainTokensForCredentials({
      credentials,
      login,
      apiUrl,
    });
    return NextResponse.json({
      ok: tokens.length > 0,
      tokenCount: tokens.length,
      tokens: tokens.map((t) => ({
        label: t.label,
        username: t.username,
        /** Ready-to-use header value (e.g. "Bearer eyJ…") — not persisted in reports */
        headerValue: t.headerValue,
        /** Raw token only — for diagnostics; prefer headerValue for load */
        tokenPreview: `${t.token.slice(0, 8)}…`,
      })),
      errors,
      authHeaderName: login.tokenHeader || 'Authorization',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token acquisition failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
