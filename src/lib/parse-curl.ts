import type {
  LoadBodyMode,
  LoadFormField,
  LoadRawLanguage,
  WebLoadHttpMethod,
  WebLoadRequestStep,
} from '@/lib/types';
import { newFormField } from '@/lib/load-request-body';

const METHODS: WebLoadHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
];

function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/** Tokenize a curl command respecting quotes and line continuations. */
function tokenizeCurl(input: string): string[] {
  const normalized = input
    .replace(/\\\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
  const tokens: string[] = [];
  let cur = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < normalized.length) {
        cur += normalized[++i];
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function splitPathAndQuery(pathWithQuery: string): {
  path: string;
  queryParams?: Record<string, string>;
} {
  const qIdx = pathWithQuery.indexOf('?');
  if (qIdx < 0) return { path: pathWithQuery || '/' };
  const path = pathWithQuery.slice(0, qIdx) || '/';
  const qs = pathWithQuery.slice(qIdx + 1);
  const queryParams: Record<string, string> = {};
  try {
    const params = new URLSearchParams(qs);
    params.forEach((value, key) => {
      if (key) queryParams[key] = value;
    });
  } catch {
    /* ignore */
  }
  return {
    path,
    queryParams: Object.keys(queryParams).length ? queryParams : undefined,
  };
}

function pathFromUrl(
  rawUrl: string,
  apiBase?: string,
): { path: string; useApiBase: boolean; queryParams?: Record<string, string> } {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    const rel = url.startsWith('/') ? url : `/${url}`;
    const split = splitPathAndQuery(rel);
    return { path: split.path, useApiBase: true, queryParams: split.queryParams };
  }
  try {
    const u = new URL(url);
    const pathOnly = u.pathname || '/';
    const queryParams: Record<string, string> = {};
    u.searchParams.forEach((value, key) => {
      if (key) queryParams[key] = value;
    });
    const q = Object.keys(queryParams).length ? queryParams : undefined;
    if (apiBase) {
      try {
        const base = new URL(apiBase);
        if (u.origin === base.origin) {
          // Prefer path relative to API base path (e.g. /api/v1)
          let path = pathOnly;
          const basePath = base.pathname.replace(/\/+$/, '');
          if (basePath && path.startsWith(basePath)) {
            path = path.slice(basePath.length) || '/';
          }
          return { path, useApiBase: true, queryParams: q };
        }
      } catch {
        /* ignore */
      }
    }
    return {
      path: `${u.origin}${pathOnly}`,
      useApiBase: false,
      queryParams: q,
    };
  } catch {
    const split = splitPathAndQuery(url);
    return { path: split.path, useApiBase: true, queryParams: split.queryParams };
  }
}

function parseFormFieldsFromBody(body: string): LoadFormField[] {
  const fields: LoadFormField[] = [];
  try {
    const params = new URLSearchParams(body);
    params.forEach((value, key) => {
      if (key) fields.push(newFormField({ key, value }));
    });
  } catch {
    /* ignore */
  }
  return fields.length ? fields : [newFormField({ key: '', value: body })];
}

function detectBodyMode(
  body: string | undefined,
  headers: Record<string, string>,
  formDataFields: LoadFormField[],
  isBinary: boolean,
): {
  bodyMode: LoadBodyMode;
  rawLanguage?: LoadRawLanguage;
  formFields?: LoadFormField[];
  body?: string;
} {
  if (formDataFields.length) {
    return { bodyMode: 'form-data', formFields: formDataFields, body: undefined };
  }
  if (!body) return { bodyMode: 'none' };
  if (isBinary) {
    return { bodyMode: 'binary', body };
  }

  const ct = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === 'content-type',
  )?.[1]?.toLowerCase() || '';

  if (ct.includes('application/x-www-form-urlencoded')) {
    return {
      bodyMode: 'urlencoded',
      formFields: parseFormFieldsFromBody(body),
      body,
    };
  }
  if (ct.includes('application/json') || /^\s*[\[{]/.test(body)) {
    return { bodyMode: 'raw', rawLanguage: 'json', body };
  }
  if (ct.includes('text/html')) {
    return { bodyMode: 'raw', rawLanguage: 'html', body };
  }
  if (ct.includes('xml')) {
    return { bodyMode: 'raw', rawLanguage: 'xml', body };
  }
  if (ct.includes('javascript')) {
    return { bodyMode: 'raw', rawLanguage: 'javascript', body };
  }
  if (ct.includes('text/plain')) {
    return { bodyMode: 'raw', rawLanguage: 'text', body };
  }
  // Heuristic: a=b&c=d → urlencoded
  if (/^[^=&]+=/.test(body) && body.includes('=') && !body.includes('{')) {
    return {
      bodyMode: 'urlencoded',
      formFields: parseFormFieldsFromBody(body),
      body,
    };
  }
  return { bodyMode: 'raw', rawLanguage: 'text', body };
}

/**
 * Parse a curl command into a full WebLoadRequestStep (Postman-style).
 * Maps into Params / Headers / Body modes used by main scenarios.
 */
export function parseCurlToLoadStep(
  curlText: string,
  opts?: { apiBaseUrl?: string; name?: string },
): WebLoadRequestStep {
  const raw = curlText.trim();
  if (!raw) throw new Error('Paste a curl command first');
  if (!/\bcurl\b/i.test(raw) && !/^https?:\/\//i.test(raw) && !raw.startsWith('/')) {
    throw new Error('Expected a curl command (starting with curl …)');
  }

  const tokens = tokenizeCurl(
    raw.startsWith('curl') || raw.startsWith('CURL') ? raw : `curl ${raw}`,
  );
  if (!tokens.length || !/^curl$/i.test(tokens[0]!)) {
    throw new Error('Could not parse curl command');
  }

  let method: WebLoadHttpMethod | undefined;
  let url = '';
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let compressed = false;
  let isBinary = false;
  const formDataFields: LoadFormField[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = () => {
      const v = tokens[++i];
      if (v == null) throw new Error(`Missing value after ${t}`);
      return stripQuotes(v);
    };

    if (t === '-X' || t === '--request') {
      const m = next().toUpperCase();
      if (METHODS.includes(m as WebLoadHttpMethod)) method = m as WebLoadHttpMethod;
      continue;
    }
    if (t === '-H' || t === '--header') {
      const h = next();
      const idx = h.indexOf(':');
      if (idx > 0) {
        const name = h.slice(0, idx).trim();
        const value = h.slice(idx + 1).trim();
        if (name) headers[name] = value;
      }
      continue;
    }
    if (t === '-F' || t === '--form' || t === '--form-string') {
      const pair = next();
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const key = pair.slice(0, eq).trim();
        let value = pair.slice(eq + 1);
        let type: 'text' | 'file' = 'text';
        if (value.startsWith('@')) {
          type = 'file';
          value = value.slice(1);
        }
        formDataFields.push(newFormField({ key, value, type }));
      }
      if (!method) method = 'POST';
      continue;
    }
    if (
      t === '-d' ||
      t === '--data' ||
      t === '--data-raw' ||
      t === '--data-ascii'
    ) {
      body = next();
      if (!method) method = 'POST';
      continue;
    }
    if (t === '--data-binary' || t === '--data-urlencode') {
      body = next();
      if (t === '--data-binary') isBinary = true;
      if (!method) method = 'POST';
      continue;
    }
    if (t === '--json') {
      body = next();
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      if (!method) method = 'POST';
      continue;
    }
    if (t === '-G' || t === '--get') {
      method = 'GET';
      continue;
    }
    if (t === '-u' || t === '--user') {
      const up = next();
      headers.Authorization = `Basic ${typeof btoa === 'function' ? btoa(up) : Buffer.from(up, 'utf8').toString('base64')}`;
      continue;
    }
    if (t === '-A' || t === '--user-agent') {
      headers['User-Agent'] = next();
      continue;
    }
    if (t === '-e' || t === '--referer') {
      headers.Referer = next();
      continue;
    }
    if (t === '--url') {
      url = next();
      continue;
    }
    if (t === '--compressed') {
      compressed = true;
      continue;
    }
    if (t.startsWith('-') && t.includes('X') && t.length <= 4) {
      const m = t.replace(/^-X/, '').toUpperCase();
      if (METHODS.includes(m as WebLoadHttpMethod)) method = m as WebLoadHttpMethod;
      continue;
    }
    if (t.startsWith('-')) {
      if (
        i + 1 < tokens.length &&
        !tokens[i + 1]!.startsWith('-') &&
        !/^https?:\/\//i.test(tokens[i + 1]!)
      ) {
        if (
          t.startsWith('--') &&
          ![
            '--location',
            '--insecure',
            '-k',
            '-L',
            '-s',
            '-S',
            '-v',
            '-i',
            '--silent',
            '--verbose',
            '--include',
          ].includes(t)
        ) {
          i += 1;
        }
      }
      continue;
    }
    if (!url) {
      url = stripQuotes(t);
    }
  }

  if (!url) throw new Error('No URL found in curl command');

  const resolved = pathFromUrl(url, opts?.apiBaseUrl);
  const finalMethod = method || (body || formDataFields.length ? 'POST' : 'GET');

  if (
    (body || formDataFields.length) &&
    !headers['Content-Type'] &&
    !headers['content-type'] &&
    !formDataFields.length
  ) {
    const looksJson = !!body && (/^\s*[\[{]/.test(body) || body.trim().startsWith('"'));
    headers['Content-Type'] = looksJson
      ? 'application/json'
      : 'application/x-www-form-urlencoded';
  }
  if (compressed && !headers.Accept) {
    headers.Accept = 'application/json, */*';
  }

  const detected = detectBodyMode(body, headers, formDataFields, isBinary);

  // Build query paramDefs for UI
  const queryParams = resolved.queryParams;
  const paramDefs = queryParams
    ? Object.keys(queryParams).map((name) => ({
        name,
        in: 'query' as const,
        required: false,
        type: 'string',
      }))
    : undefined;

  return {
    name: opts?.name || `${finalMethod} ${resolved.path}`.slice(0, 100),
    path: resolved.path,
    method: finalMethod,
    headers: Object.keys(headers).length ? headers : undefined,
    body: detected.body,
    bodyMode: detected.bodyMode,
    rawLanguage: detected.rawLanguage,
    formFields: detected.formFields,
    queryParams,
    paramDefs,
    useApiBase: resolved.useApiBase,
    thinkTimeMs: 150,
  };
}

export function headersToLines(
  headers?: Record<string, string>,
): Array<{ key: string; value: string }> {
  const entries = Object.entries(headers || {});
  if (!entries.length) return [{ key: '', value: '' }];
  return entries.map(([key, value]) => ({ key, value }));
}

export function linesToHeaders(
  lines: Array<{ key: string; value: string }>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const { key, value } of lines) {
    const k = key.trim();
    if (!k) continue;
    out[k] = value;
  }
  return Object.keys(out).length ? out : undefined;
}
