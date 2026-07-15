import type { LoadAuthCredential, LoadAuthLoginConfig } from '@/lib/types';
import { ensureLgdApiV1Base } from '@/lib/api-url';
import { getJsonPathValue } from '@/lib/json-path';

export type ObtainedToken = {
  label: string;
  username: string;
  token: string;
  /** Full Authorization (or custom) header value ready to send */
  headerValue: string;
};

export { getJsonPathValue };

function resolveUrl(pathOrUrl: string, apiBase?: string): string {
  const raw = pathOrUrl.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = ensureLgdApiV1Base(apiBase || '').replace(/\/+$/, '');
  if (!base) throw new Error('apiUrl is required for relative login paths');
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return `${base}${path}`;
}

const TOKEN_CANDIDATE_PATHS = [
  'token',
  'access_token',
  'accessToken',
  'data.token',
  'data.access_token',
  'data.accessToken',
  'result.token',
  'payload.token',
  'data.user.token',
  'jwt',
  'id_token',
];

export function extractTokenFromResponse(
  body: unknown,
  preferredPath?: string,
): string | undefined {
  if (preferredPath) {
    const v = getJsonPathValue(body, preferredPath);
    if (v != null && String(v).trim()) return String(v).trim();
  }
  for (const p of TOKEN_CANDIDATE_PATHS) {
    const v = getJsonPathValue(body, p);
    if (v != null && String(v).trim()) return String(v).trim();
  }
  // Shallow scan string fields named *token*
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (/token/i.test(k) && typeof v === 'string' && v.trim().length > 8) {
        return v.trim();
      }
      if (v && typeof v === 'object') {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          if (/token/i.test(k2) && typeof v2 === 'string' && v2.trim().length > 8) {
            return v2.trim();
          }
        }
      }
    }
  }
  return undefined;
}

export async function obtainTokensForCredentials(opts: {
  credentials: LoadAuthCredential[];
  login: LoadAuthLoginConfig;
  apiUrl?: string;
  signal?: AbortSignal;
}): Promise<{
  tokens: ObtainedToken[];
  errors: Array<{ label: string; username: string; error: string }>;
}> {
  const { credentials, login, apiUrl, signal } = opts;
  if (!credentials.length) {
    throw new Error('At least one username/password credential is required');
  }
  if (!login.loginPath?.trim()) {
    throw new Error('Login path is required to obtain tokens');
  }

  const url = resolveUrl(login.loginPath, apiUrl);
  const method = (login.method || 'POST').toUpperCase();
  const userField = login.usernameField || 'mobileNumber';
  const passField = login.passwordField || 'password';
  const headerName = login.tokenHeader || 'Authorization';
  const prefix =
    login.tokenPrefix !== undefined
      ? login.tokenPrefix
      : headerName.toLowerCase() === 'authorization'
        ? 'Bearer '
        : '';

  const tokens: ObtainedToken[] = [];
  const errors: Array<{ label: string; username: string; error: string }> = [];

  for (const cred of credentials) {
    const username = cred.username.trim();
    const password = cred.password;
    if (!username || !password) continue;

    const bodyObj: Record<string, string | boolean> = {
      ...(login.extraBody || {}),
      [userField]: username,
      [passField]: password,
    };
    // LGD expects boolean rememberMe when present as string "true"/"false"
    if (typeof bodyObj.rememberMe === 'string') {
      const rm = bodyObj.rememberMe.toLowerCase();
      if (rm === 'true' || rm === 'false') {
        bodyObj.rememberMe = rm === 'true';
      }
    }

    try {
      const res = await fetch(url, {
        method,
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: ['GET', 'HEAD'].includes(method)
          ? undefined
          : JSON.stringify(bodyObj),
      });
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (!res.ok) {
        const snippet = text.slice(0, 180).replace(/\s+/g, ' ');
        errors.push({
          label: cred.label,
          username,
          error: `HTTP ${res.status} at ${url}${snippet ? `: ${snippet}` : ''}`,
        });
        continue;
      }
      const token = extractTokenFromResponse(json, login.tokenJsonPath);
      if (!token) {
        errors.push({
          label: cred.label,
          username,
          error: 'Login succeeded but no token found in JSON response',
        });
        continue;
      }
      tokens.push({
        label: cred.label,
        username,
        token,
        headerValue: `${prefix}${token}`,
      });
    } catch (err) {
      errors.push({
        label: cred.label,
        username,
        error: err instanceof Error ? err.message : 'Login request failed',
      });
    }
  }

  return { tokens, errors };
}
