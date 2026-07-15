import type {
  LoadBodyMode,
  LoadFormField,
  LoadRawLanguage,
  WebLoadRequestStep,
} from '@/lib/types';

export const BODY_MODES: Array<{ id: LoadBodyMode; label: string }> = [
  { id: 'none', label: 'none' },
  { id: 'form-data', label: 'form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'raw', label: 'raw' },
  { id: 'binary', label: 'binary' },
  { id: 'graphql', label: 'GraphQL' },
];

export const RAW_LANGUAGES: Array<{ id: LoadRawLanguage; label: string; contentType: string }> = [
  { id: 'json', label: 'JSON', contentType: 'application/json' },
  { id: 'text', label: 'Text', contentType: 'text/plain' },
  { id: 'javascript', label: 'JavaScript', contentType: 'application/javascript' },
  { id: 'html', label: 'HTML', contentType: 'text/html' },
  { id: 'xml', label: 'XML', contentType: 'application/xml' },
];

export function newFormField(partial?: Partial<LoadFormField>): LoadFormField {
  return {
    id: `ff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    key: '',
    value: '',
    type: 'text',
    enabled: true,
    ...partial,
  };
}

export function inferBodyMode(step: Pick<WebLoadRequestStep, 'body' | 'bodyMode' | 'headers'>): LoadBodyMode {
  if (step.bodyMode) return step.bodyMode;
  const ct = Object.entries(step.headers || {}).find(
    ([k]) => k.toLowerCase() === 'content-type',
  )?.[1]?.toLowerCase() || '';
  if (ct.includes('multipart/form-data')) return 'form-data';
  if (ct.includes('application/x-www-form-urlencoded')) return 'urlencoded';
  if (ct.includes('graphql')) return 'graphql';
  if (step.body?.trim()) return 'raw';
  return 'none';
}

export function contentTypeForRaw(lang: LoadRawLanguage = 'json'): string {
  return RAW_LANGUAGES.find((l) => l.id === lang)?.contentType || 'application/json';
}

function enabledFields(fields?: LoadFormField[]): LoadFormField[] {
  return (fields || []).filter((f) => f.enabled !== false && f.key.trim());
}

function encodeFormUrl(fields: LoadFormField[]): string {
  const params = new URLSearchParams();
  for (const f of enabledFields(fields)) {
    params.append(f.key.trim(), f.value ?? '');
  }
  return params.toString();
}

/** Merge Content-Type into headers (replaces existing CT). */
export function withContentType(
  headers: Record<string, string> | undefined,
  contentType: string | undefined,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === 'content-type') continue;
    next[k] = v;
  }
  if (contentType) next['Content-Type'] = contentType;
  return next;
}

export type ResolvedOutgoingBody = {
  /** Serialized body for fetch / JMeter raw */
  body?: string;
  /** When set, `body` is base64 and must be decoded before send */
  bodyEncoding?: 'utf8' | 'base64';
  headers: Record<string, string>;
  /** application/json, urlencoded, multipart, etc. */
  contentType?: string;
  /** JMeter multipart form */
  multipart: boolean;
  /** Argument pairs for JMeter form/urlencoded */
  formPairs?: Array<{ name: string; value: string; contentType?: string }>;
  mode: LoadBodyMode;
};

/**
 * Build the outgoing HTTP body + headers from a load step (Postman-style modes).
 */
export function resolveOutgoingBody(step: WebLoadRequestStep): ResolvedOutgoingBody {
  const mode = inferBodyMode(step);
  const baseHeaders = { ...(step.headers || {}) };
  const method = (step.method || 'GET').toUpperCase();
  const allowBody = !['GET', 'HEAD'].includes(method);

  if (mode === 'none' || !allowBody) {
    return {
      body: undefined,
      headers: withContentType(baseHeaders, undefined),
      multipart: false,
      mode: 'none',
    };
  }

  if (mode === 'urlencoded') {
    const pairs = enabledFields(step.formFields).map((f) => ({
      name: f.key.trim(),
      value: f.value ?? '',
    }));
    const body =
      pairs.length > 0
        ? encodeFormUrl(step.formFields || [])
        : step.body || undefined;
    return {
      body,
      headers: withContentType(baseHeaders, 'application/x-www-form-urlencoded'),
      contentType: 'application/x-www-form-urlencoded',
      multipart: false,
      formPairs: pairs.length ? pairs : undefined,
      mode,
    };
  }

  if (mode === 'form-data') {
    const pairs = enabledFields(step.formFields).map((f) => ({
      name: f.key.trim(),
      value: f.value ?? '',
      contentType: f.type === 'file' ? f.contentType || 'application/octet-stream' : undefined,
    }));
    // Text-only multipart body for probe (boundary)
    const boundary = `----LgdFormBoundary${Date.now().toString(36)}`;
    const parts: string[] = [];
    for (const p of pairs) {
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`,
      );
    }
    parts.push(`--${boundary}--\r\n`);
    const body = pairs.length ? parts.join('') : undefined;
    return {
      body,
      headers: withContentType(baseHeaders, `multipart/form-data; boundary=${boundary}`),
      contentType: `multipart/form-data; boundary=${boundary}`,
      multipart: true,
      formPairs: pairs.length ? pairs : undefined,
      mode,
    };
  }

  if (mode === 'graphql') {
    let variables: unknown = {};
    const rawVars = (step.graphqlVariables || '').trim();
    if (rawVars) {
      try {
        variables = JSON.parse(rawVars);
      } catch {
        variables = {};
      }
    }
    const payload = {
      query: step.graphqlQuery || step.body || '',
      variables,
    };
    return {
      body: JSON.stringify(payload),
      headers: withContentType(baseHeaders, 'application/json'),
      contentType: 'application/json',
      multipart: false,
      mode,
    };
  }

  if (mode === 'binary') {
    return {
      body: step.binaryBase64 || undefined,
      bodyEncoding: step.binaryBase64 ? 'base64' : 'utf8',
      headers: withContentType(baseHeaders, 'application/octet-stream'),
      contentType: 'application/octet-stream',
      multipart: false,
      mode,
    };
  }

  // raw
  const lang = step.rawLanguage || 'json';
  const ct = contentTypeForRaw(lang);
  return {
    body: step.body || undefined,
    headers: withContentType(baseHeaders, ct),
    contentType: ct,
    multipart: false,
    mode: 'raw',
  };
}

/** Sync formFields ↔ body string for urlencoded (best-effort). */
export function formFieldsFromUrlEncoded(body?: string): LoadFormField[] {
  if (!body?.trim()) return [newFormField()];
  try {
    const params = new URLSearchParams(body);
    const fields: LoadFormField[] = [];
    params.forEach((value, key) => {
      fields.push(newFormField({ key, value }));
    });
    return fields.length ? fields : [newFormField()];
  } catch {
    return [newFormField()];
  }
}
