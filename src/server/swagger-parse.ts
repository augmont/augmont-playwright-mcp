import type {
  LoadApiDefinition,
  LoadApiResponseDef,
  LoadParamDef,
  SwaggerOperation,
  WebLoadHttpMethod,
} from '@/lib/types';
import { ensureLgdApiV1Base } from '@/lib/api-url';

const METHODS: WebLoadHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
];

export type ParsedSwaggerSpec = {
  title: string;
  version?: string;
  /** Suggested API base from servers / host */
  apiBaseUrl?: string;
  /** Spec document URL that was fetched */
  swaggerUrl: string;
  operations: SwaggerOperation[];
  /** Best-guess login path for token exchange */
  suggestedLoginPath?: string;
  securitySchemes: string[];
};

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function normalizePathTemplate(p: string): string {
  return p.replace(/\{([^}]+)\}/g, ':$1');
}

function looksLikeLogin(path: string, operationId?: string, summary?: string): boolean {
  const hay = `${path} ${operationId || ''} ${summary || ''}`.toLowerCase();
  return (
    /\/(login|signin|sign-in|user-login|auth\/login|auth\/user-login|oauth\/token|token|authenticate)\b/.test(
      hay,
    ) || /\b(login|signin|user.?login|get.?token|auth.?token)\b/.test(hay)
  );
}

function securityRequiresAuth(
  opSecurity: unknown,
  globalSecurity: unknown,
): boolean {
  // Explicit empty array = optional / no auth for this operation
  if (Array.isArray(opSecurity) && opSecurity.length === 0) return false;
  const effective =
    opSecurity !== undefined ? opSecurity : globalSecurity;
  if (!Array.isArray(effective) || !effective.length) return false;
  return effective.some(
    (item) => item && typeof item === 'object' && Object.keys(item as object).length > 0,
  );
}

function sampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 4) return undefined;
  const s = schema as Record<string, unknown>;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.$ref && typeof s.$ref === 'string') return { $ref: s.$ref };
  const type = String(s.type || '');
  if (type === 'object' || s.properties) {
    const props = (s.properties || {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props).slice(0, 12)) {
      const child = sampleFromSchema(v, depth + 1);
      out[k] = child !== undefined ? child : '';
    }
    return out;
  }
  if (type === 'array') {
    const item = sampleFromSchema(s.items, depth + 1);
    return item !== undefined ? [item] : [];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  return '';
}

function prettyJson(value: unknown, maxLen = 6000): string | undefined {
  if (value === undefined) return undefined;
  try {
    const text =
      typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (text.length > maxLen) return `${text.slice(0, maxLen)}\n…(truncated)`;
    return text;
  } catch {
    return String(value).slice(0, maxLen);
  }
}

function resolveRef(
  ref: string,
  root: Record<string, unknown>,
): unknown | undefined {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = root;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function derefSchema(
  schema: unknown,
  root: Record<string, unknown>,
  depth = 0,
  seen = new Set<string>(),
): unknown {
  if (!schema || typeof schema !== 'object' || depth > 5) return schema;
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === 'string') {
    const ref = s.$ref;
    if (seen.has(ref)) return { $ref: ref };
    seen.add(ref);
    const resolved = resolveRef(ref, root);
    if (resolved) return derefSchema(resolved, root, depth + 1, seen);
    return { $ref: ref };
  }
  if (Array.isArray(s.allOf) && s.allOf.length) {
    const merged: Record<string, unknown> = { type: 'object', properties: {} };
    for (const part of s.allOf) {
      const d = derefSchema(part, root, depth + 1, seen) as Record<
        string,
        unknown
      >;
      if (d?.properties && typeof d.properties === 'object') {
        Object.assign(merged.properties as object, d.properties);
      }
      if (Array.isArray(d?.required)) {
        merged.required = [
          ...((merged.required as string[]) || []),
          ...d.required.map(String),
        ];
      }
    }
    return merged;
  }
  if (s.properties && typeof s.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      s.properties as Record<string, unknown>,
    ).slice(0, 24)) {
      props[k] = derefSchema(v, root, depth + 1, seen);
    }
    return { ...s, properties: props };
  }
  if (s.items) {
    return { ...s, items: derefSchema(s.items, root, depth + 1, seen) };
  }
  return s;
}

function schemaPreview(schema: unknown, root: Record<string, unknown>): string | undefined {
  if (!schema) return undefined;
  const resolved = derefSchema(schema, root);
  return prettyJson(resolved, 4000);
}

function pickJsonContent(
  content: Record<string, { schema?: unknown; example?: unknown; examples?: unknown }> | undefined,
): { contentType?: string; schema?: unknown; example?: unknown } {
  if (!content) return {};
  const preferred =
    content['application/json'] ||
    content['application/*+json'] ||
    Object.entries(content).find(([k]) => k.includes('json'))?.[1] ||
    Object.values(content)[0];
  const contentType =
    content['application/json']
      ? 'application/json'
      : Object.keys(content).find((k) => k.includes('json')) ||
        Object.keys(content)[0];
  if (!preferred) return {};
  let example = preferred.example;
  if (example === undefined && preferred.examples && typeof preferred.examples === 'object') {
    const first = Object.values(preferred.examples as Record<string, { value?: unknown }>)[0];
    example = first?.value !== undefined ? first.value : first;
  }
  return { contentType, schema: preferred.schema, example };
}

function extractApiDefinition(
  op: Record<string, unknown>,
  root: Record<string, unknown>,
  meta: {
    summary?: string;
    description?: string;
    operationId?: string;
    tags?: string[];
    sampleBody?: string;
  },
): LoadApiDefinition {
  const def: LoadApiDefinition = {
    summary: meta.summary,
    description: meta.description,
    operationId: meta.operationId,
    tags: meta.tags,
  };

  // OAS3 requestBody
  const rb = op.requestBody as
    | {
        description?: string;
        content?: Record<
          string,
          { schema?: unknown; example?: unknown; examples?: unknown }
        >;
      }
    | undefined;
  if (rb) {
    def.requestBodyDescription =
      typeof rb.description === 'string' ? rb.description : undefined;
    const picked = pickJsonContent(rb.content);
    def.requestContentType = picked.contentType;
    def.requestExample =
      prettyJson(picked.example) || meta.sampleBody || undefined;
    def.requestSchemaPreview = schemaPreview(picked.schema, root);
  } else {
    // Swagger 2 body param
    const params = Array.isArray(op.parameters) ? op.parameters : [];
    const bodyParam = params.find(
      (p) =>
        p && typeof p === 'object' && (p as { in?: string }).in === 'body',
    ) as
      | {
          description?: string;
          schema?: unknown;
          example?: unknown;
        }
      | undefined;
    if (bodyParam) {
      def.requestBodyDescription = bodyParam.description;
      def.requestContentType = 'application/json';
      def.requestExample =
        prettyJson(bodyParam.example) || meta.sampleBody || undefined;
      def.requestSchemaPreview = schemaPreview(bodyParam.schema, root);
    } else if (meta.sampleBody) {
      def.requestContentType = 'application/json';
      def.requestExample = prettyJson(meta.sampleBody) || meta.sampleBody;
    }
  }

  const responses: LoadApiResponseDef[] = [];
  const respMap = (op.responses || {}) as Record<
    string,
    {
      description?: string;
      content?: Record<
        string,
        { schema?: unknown; example?: unknown; examples?: unknown }
      >;
      schema?: unknown;
      examples?: Record<string, unknown>;
    }
  >;

  const statusKeys = Object.keys(respMap).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    if (a === 'default') return 1;
    if (b === 'default') return -1;
    return a.localeCompare(b);
  });

  for (const status of statusKeys.slice(0, 12)) {
    const r = respMap[status];
    if (!r || typeof r !== 'object') continue;
    const picked = pickJsonContent(r.content);
    let example = prettyJson(picked.example);
    // Swagger 2 examples
    if (!example && r.examples && typeof r.examples === 'object') {
      const ex = Object.values(r.examples)[0];
      example = prettyJson(ex);
    }
    const schema = picked.schema || r.schema;
    responses.push({
      status,
      description: typeof r.description === 'string' ? r.description : undefined,
      contentType: picked.contentType || (schema ? 'application/json' : undefined),
      example,
      schemaPreview: schemaPreview(schema, root),
    });
  }

  if (responses.length) def.responses = responses;
  return def;
}

function extractBodyRequired(op: Record<string, unknown>): string[] | undefined {
  const rb = op.requestBody as
    | {
        required?: boolean;
        content?: Record<string, { schema?: Record<string, unknown> }>;
      }
    | undefined;
  if (rb?.content) {
    const json =
      rb.content['application/json'] ||
      rb.content['application/*+json'] ||
      Object.entries(rb.content).find(([k]) => k.includes('json'))?.[1];
    const schema = json?.schema;
    if (schema && Array.isArray(schema.required)) {
      return schema.required.map(String).filter(Boolean);
    }
  }
  const params = Array.isArray(op.parameters) ? op.parameters : [];
  const bodyParam = params.find(
    (p) => p && typeof p === 'object' && (p as { in?: string }).in === 'body',
  ) as { schema?: { required?: unknown[] } } | undefined;
  if (bodyParam?.schema && Array.isArray(bodyParam.schema.required)) {
    return bodyParam.schema.required.map(String).filter(Boolean);
  }
  return undefined;
}

function extractParameters(
  pathItem: Record<string, unknown>,
  op: Record<string, unknown>,
  pathNorm: string,
): LoadParamDef[] {
  const raw: unknown[] = [];
  if (Array.isArray(pathItem.parameters)) raw.push(...pathItem.parameters);
  if (Array.isArray(op.parameters)) raw.push(...op.parameters);

  const map = new Map<string, LoadParamDef>();

  // Infer path params from template
  for (const m of pathNorm.matchAll(/:([A-Za-z_][\w]*)/g)) {
    if (!m[1]) continue;
    map.set(`path:${m[1]}`, {
      name: m[1],
      in: 'path',
      required: true,
      type: 'string',
    });
  }

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = String(p.name || '').trim();
    const loc = String(p.in || '').toLowerCase();
    if (!name || !['path', 'query', 'header', 'formData'].includes(loc)) continue;
    const location = (loc === 'formData' ? 'query' : loc) as LoadParamDef['in'];
    const schema = (p.schema || {}) as Record<string, unknown>;
    const type =
      typeof p.type === 'string'
        ? p.type
        : typeof schema.type === 'string'
          ? schema.type
          : undefined;
    const example =
      p.example != null
        ? String(p.example)
        : schema.example != null
          ? String(schema.example)
          : p.default != null
            ? String(p.default)
            : undefined;
    map.set(`${location}:${name}`, {
      name,
      in: location,
      required: Boolean(p.required) || location === 'path',
      type,
      description: typeof p.description === 'string' ? p.description : undefined,
      example,
    });
  }

  return [...map.values()];
}

function extractSampleBody(op: Record<string, unknown>): {
  body?: string;
  consumesJson: boolean;
} {
  // OpenAPI 3 requestBody
  const rb = op.requestBody as
    | { content?: Record<string, { schema?: unknown; example?: unknown }> }
    | undefined;
  if (rb?.content) {
    const json =
      rb.content['application/json'] ||
      rb.content['application/*+json'] ||
      Object.entries(rb.content).find(([k]) => k.includes('json'))?.[1];
    if (json) {
      const sample =
        json.example !== undefined
          ? json.example
          : sampleFromSchema(json.schema);
      if (sample !== undefined) {
        try {
          return { body: JSON.stringify(sample, null, 0), consumesJson: true };
        } catch {
          /* ignore */
        }
      }
      return { body: undefined, consumesJson: true };
    }
  }

  // Swagger 2 parameters
  const params = Array.isArray(op.parameters) ? op.parameters : [];
  const bodyParam = params.find(
    (p) =>
      p &&
      typeof p === 'object' &&
      (p as { in?: string }).in === 'body' &&
      (p as { schema?: unknown }).schema,
  ) as { schema?: unknown; example?: unknown } | undefined;
  if (bodyParam) {
    const sample =
      bodyParam.example !== undefined
        ? bodyParam.example
        : sampleFromSchema(bodyParam.schema);
    if (sample !== undefined) {
      try {
        return { body: JSON.stringify(sample, null, 0), consumesJson: true };
      } catch {
        /* ignore */
      }
    }
  }
  const consumes = Array.isArray(op.consumes)
    ? (op.consumes as string[])
    : [];
  return { body: undefined, consumesJson: consumes.some((c) => c.includes('json')) };
}

function resolveApiBase(
  spec: Record<string, unknown>,
  swaggerUrl: string,
): string | undefined {
  let resolved: string | undefined;

  // OpenAPI 3 servers
  const servers = Array.isArray(spec.servers) ? spec.servers : [];
  const serverUrl = (servers[0] as { url?: string } | undefined)?.url?.trim();
  if (serverUrl) {
    if (/^https?:\/\//i.test(serverUrl)) {
      resolved = serverUrl.replace(/\/+$/, '');
    } else {
      try {
        resolved = new URL(serverUrl, swaggerUrl).toString().replace(/\/+$/, '');
      } catch {
        /* ignore */
      }
    }
  }

  // Swagger 2 host + basePath + schemes
  if (!resolved) {
    const host = typeof spec.host === 'string' ? spec.host.trim() : '';
    if (host) {
      const schemes = Array.isArray(spec.schemes) ? (spec.schemes as string[]) : [];
      const scheme =
        schemes.includes('https') ? 'https' : schemes[0] || 'https';
      const basePath =
        typeof spec.basePath === 'string' ? spec.basePath.trim() : '';
      resolved = joinUrl(`${scheme}://${host}`, basePath || '/').replace(
        /\/+$/,
        '',
      );
    }
  }

  if (!resolved) {
    try {
      const u = new URL(swaggerUrl);
      // Strip common doc suffixes
      let path = u.pathname.replace(
        /\/(swagger|openapi|api-docs|v[23]\/api-docs)(\.json)?\/?$/i,
        '',
      );
      if (!path || path === '/') path = '';
      resolved = `${u.origin}${path}`.replace(/\/+$/, '') || u.origin;
    } catch {
      return undefined;
    }
  }

  return ensureLgdApiV1Base(resolved) || resolved;
}

function listSecuritySchemeNames(spec: Record<string, unknown>): string[] {
  const names: string[] = [];
  // OAS3
  const comps = spec.components as
    | { securitySchemes?: Record<string, unknown> }
    | undefined;
  if (comps?.securitySchemes) {
    names.push(...Object.keys(comps.securitySchemes));
  }
  // Swagger 2
  const s2 = spec.securityDefinitions as Record<string, unknown> | undefined;
  if (s2) names.push(...Object.keys(s2));
  return names;
}

/**
 * Parse an OpenAPI 3 / Swagger 2 JSON document into load-testable operations.
 */
export function parseSwaggerDocument(
  doc: unknown,
  swaggerUrl: string,
): ParsedSwaggerSpec {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Swagger document is empty or not an object');
  }
  const spec = doc as Record<string, unknown>;
  const info = (spec.info || {}) as { title?: string; version?: string };
  const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
  if (!paths || !Object.keys(paths).length) {
    throw new Error('Swagger document has no paths');
  }

  const globalSecurity = spec.security;
  const securitySchemes = listSecuritySchemeNames(spec);
  const hasGlobalSchemes = securitySchemes.length > 0;
  const operations: SwaggerOperation[] = [];
  let suggestedLoginPath: string | undefined;

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of METHODS) {
      const key = method.toLowerCase();
      const op = pathItem[key];
      if (!op || typeof op !== 'object') continue;
      const opRec = op as Record<string, unknown>;
      const requiresAuth =
        securityRequiresAuth(opRec.security, globalSecurity) ||
        (hasGlobalSchemes &&
          opRec.security === undefined &&
          Array.isArray(globalSecurity) &&
          globalSecurity.length > 0);

      const summary =
        typeof opRec.summary === 'string' ? opRec.summary : undefined;
      const description =
        typeof opRec.description === 'string' ? opRec.description : undefined;
      const operationId =
        typeof opRec.operationId === 'string' ? opRec.operationId : undefined;
      const tags = Array.isArray(opRec.tags)
        ? opRec.tags.map(String).filter(Boolean)
        : undefined;
      const { body, consumesJson } = extractSampleBody(opRec);
      const pathNorm = normalizePathTemplate(rawPath);
      const id = `${method}:${pathNorm}`.toLowerCase();
      const parameters = extractParameters(
        pathItem as Record<string, unknown>,
        opRec,
        pathNorm,
      );
      const bodyRequired = extractBodyRequired(opRec);
      const apiDefinition = extractApiDefinition(opRec, spec, {
        summary,
        description,
        operationId,
        tags,
        sampleBody: body,
      });

      if (!suggestedLoginPath && looksLikeLogin(pathNorm, operationId, summary)) {
        suggestedLoginPath = pathNorm;
      }

      operations.push({
        id,
        method,
        path: pathNorm,
        summary,
        description,
        operationId,
        tags,
        requiresAuth,
        sampleBody: body,
        consumesJson,
        parameters: parameters.length ? parameters : undefined,
        bodyRequired: bodyRequired?.length ? bodyRequired : undefined,
        apiDefinition,
      });
    }
  }

  if (!operations.length) {
    throw new Error('No HTTP operations found in Swagger document');
  }

  // Fallback login guess
  if (!suggestedLoginPath) {
    const guess = operations.find((o) =>
      looksLikeLogin(o.path, o.operationId, o.summary),
    );
    suggestedLoginPath = guess?.path;
  }

  return {
    title: info.title || 'API',
    version: info.version,
    apiBaseUrl: resolveApiBase(spec, swaggerUrl),
    swaggerUrl,
    operations,
    suggestedLoginPath,
    securitySchemes,
  };
}

/**
 * Optional auth when the Swagger/OpenAPI docs URL itself is protected (401).
 */
export type SwaggerFetchAuth = {
  /** HTTP Basic username */
  username?: string;
  /** HTTP Basic password */
  password?: string;
  /** Raw token (will be sent as Authorization: Bearer …) */
  bearerToken?: string;
  /** Full Authorization header value (overrides basic / bearer) */
  authorization?: string;
  /** Extra request headers */
  headers?: Record<string, string>;
};

function buildSwaggerFetchHeaders(auth?: SwaggerFetchAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, application/yaml, text/yaml, */*',
  };
  if (auth?.headers) {
    for (const [k, v] of Object.entries(auth.headers)) {
      if (k && v != null) headers[k] = String(v);
    }
  }
  if (auth?.authorization?.trim()) {
    headers.Authorization = auth.authorization.trim();
  } else if (auth?.bearerToken?.trim()) {
    const t = auth.bearerToken.trim();
    headers.Authorization = /^bearer\s/i.test(t) ? t : `Bearer ${t}`;
  } else if (auth?.username?.trim() && auth.password != null && auth.password !== '') {
    const raw = `${auth.username.trim()}:${auth.password}`;
    headers.Authorization = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
  }
  return headers;
}

function isHtmlBody(contentType: string, text: string): boolean {
  return (
    contentType.includes('html') ||
    /^\s*<(!doctype|html|head|body)/i.test(text)
  );
}

/** Pull OpenAPI/JSON URLs embedded in Swagger UI HTML. */
function extractSpecUrlsFromHtml(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const s = raw.trim().replace(/\\u002F/g, '/').replace(/\\\//g, '/');
    if (!s || s.startsWith('data:')) return;
    try {
      const abs = new URL(s, pageUrl).toString();
      if (!found.includes(abs)) found.push(abs);
    } catch {
      /* ignore */
    }
  };

  // url: "/v3/api-docs" | url: '...' | "url":"..."
  const patterns = [
    /\burl\s*[:=]\s*["']([^"']+)["']/gi,
    /["']url["']\s*:\s*["']([^"']+)["']/gi,
    /\bconfigUrl\s*[:=]\s*["']([^"']+)["']/gi,
    /["']configUrl["']\s*:\s*["']([^"']+)["']/gi,
    /href=["']([^"']*(?:api-docs|openapi|swagger\.json)[^"']*)["']/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const candidate = m[1];
      if (
        /api-docs|openapi|swagger\.json|\.json(\?|$)/i.test(candidate) ||
        candidate.startsWith('/') ||
        /^https?:\/\//i.test(candidate)
      ) {
        // Skip swagger-ui asset paths
        if (/swagger-ui|redoc|favicon|\.js(\?|$)|\.css(\?|$)/i.test(candidate)) {
          continue;
        }
        push(candidate);
      }
    }
  }
  return found;
}

/** Common OpenAPI JSON paths to try when the user pasted a Swagger UI page. */
function candidateJsonUrls(fromUrl: string): string[] {
  let u: URL;
  try {
    u = new URL(fromUrl);
  } catch {
    return [];
  }
  const origin = u.origin;
  const path = u.pathname.replace(/\/+$/, '') || '/';

  // Strip UI suffixes to get a base directory / app root
  const stripped = path
    .replace(/\/swagger-ui\.html$/i, '')
    .replace(/\/swagger-ui\/index\.html$/i, '')
    .replace(/\/swagger-ui\/?$/i, '')
    .replace(/\/swagger\/index\.html$/i, '')
    .replace(/\/swagger\/?$/i, '')
    .replace(/\/docs\/?$/i, '')
    .replace(/\/redoc\/?$/i, '')
    .replace(/\/index\.html$/i, '');

  const bases = Array.from(
    new Set([
      origin,
      stripped && stripped !== '/' ? `${origin}${stripped}` : origin,
      // parent of swagger-ui folder
      (() => {
        const parts = stripped.split('/').filter(Boolean);
        if (parts.length) {
          parts.pop();
          return `${origin}/${parts.join('/')}` || origin;
        }
        return origin;
      })(),
    ]),
  ).map((b) => b.replace(/\/+$/, ''));

  const suffixes = [
    '/v3/api-docs',
    '/v3/api-docs/',
    '/v2/api-docs',
    '/api-docs',
    '/api-docs/',
    '/swagger.json',
    '/openapi.json',
    '/openapi.yaml',
    '/v3/api-docs/swagger-config',
    '/swagger/v1/swagger.json',
    '/api/swagger.json',
    '/api/v3/api-docs',
    '/documentation/json',
  ];

  const out: string[] = [];
  for (const base of bases) {
    for (const s of suffixes) {
      const abs = `${base}${s}`;
      if (!out.includes(abs)) out.push(abs);
    }
  }
  // Also try replacing path ending
  if (/swagger|docs|redoc/i.test(path)) {
    for (const s of ['/v3/api-docs', '/swagger.json', '/openapi.json', '/api-docs']) {
      const abs = `${origin}${s}`;
      if (!out.includes(abs)) out.push(abs);
    }
  }
  return out;
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; statusText: string; contentType: string; text: string; finalUrl: string }> {
  const res = await fetch(url, { signal, headers, redirect: 'follow' });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    contentType: (res.headers.get('content-type') || '').toLowerCase(),
    text,
    finalUrl: res.url || url,
  };
}

function tryParseOpenApiJson(text: string): unknown | null {
  try {
    const doc = JSON.parse(text);
    if (
      doc &&
      typeof doc === 'object' &&
      (('openapi' in doc && typeof (doc as { openapi?: unknown }).openapi === 'string') ||
        ('swagger' in doc && typeof (doc as { swagger?: unknown }).swagger === 'string') ||
        ('paths' in doc && typeof (doc as { paths?: unknown }).paths === 'object'))
    ) {
      return doc;
    }
    // Spring swagger-config is JSON but not the full OpenAPI — caller may follow url field
    return doc;
  } catch {
    return null;
  }
}

function isOpenApiDocument(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  if (typeof d.openapi === 'string' || typeof d.swagger === 'string') return true;
  return Boolean(d.paths && typeof d.paths === 'object');
}

/**
 * Fetch a Swagger/OpenAPI JSON URL and parse it.
 * If the URL is a Swagger UI HTML page, auto-resolves common JSON endpoints.
 * Pass auth when the docs endpoint returns 401 Unauthorized.
 */
export async function fetchAndParseSwagger(
  swaggerUrl: string,
  opts?: { signal?: AbortSignal; auth?: SwaggerFetchAuth },
): Promise<ParsedSwaggerSpec> {
  const url = swaggerUrl.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Valid http(s) Swagger URL is required');
  }

  const headers = buildSwaggerFetchHeaders(opts?.auth);
  const tried: string[] = [];
  const queue: string[] = [url];

  const enqueue = (u: string) => {
    const t = u.trim();
    if (!t || tried.includes(t) || queue.includes(t)) return;
    queue.push(t);
  };

  // Prefer known JSON paths early when user pasted a UI URL
  if (/swagger-ui|\/swagger\/?$|\/docs\/?$|\/redoc/i.test(url)) {
    for (const c of candidateJsonUrls(url)) enqueue(c);
  }

  let lastAuthError: string | undefined;
  let lastHtmlHint: string | undefined;

  while (queue.length) {
    const current = queue.shift()!;
    tried.push(current);

    let fetched: Awaited<ReturnType<typeof fetchText>>;
    try {
      fetched = await fetchText(current, headers, opts?.signal);
    } catch (err) {
      lastHtmlHint = err instanceof Error ? err.message : 'Network error';
      continue;
    }

    if (!fetched.ok) {
      if (fetched.status === 401 || fetched.status === 403) {
        lastAuthError = `Failed to fetch Swagger (${fetched.status} ${fetched.statusText}). This docs URL requires authentication — enter username/password or a Bearer token and try again.`;
      }
      continue;
    }

    if (!fetched.text.trim()) continue;

    if (isHtmlBody(fetched.contentType, fetched.text)) {
      lastHtmlHint = current;
      for (const extracted of extractSpecUrlsFromHtml(fetched.text, fetched.finalUrl || current)) {
        enqueue(extracted);
      }
      for (const c of candidateJsonUrls(fetched.finalUrl || current)) {
        enqueue(c);
      }
      continue;
    }

    const doc = tryParseOpenApiJson(fetched.text);
    if (!doc) {
      if (
        fetched.contentType.includes('yaml') ||
        /\.ya?ml(\?|$)/i.test(current) ||
        /^[\s]*openapi:\s/m.test(fetched.text) ||
        /^[\s]*swagger:\s/m.test(fetched.text)
      ) {
        throw new Error(
          'YAML OpenAPI is not supported yet — use the JSON endpoint (e.g. /v3/api-docs or swagger.json).',
        );
      }
      continue;
    }

    // Spring Boot swagger-config: { url: "/v3/api-docs", … }
    if (!isOpenApiDocument(doc) && doc && typeof doc === 'object') {
      const cfg = doc as { url?: string; urls?: Array<{ url?: string }> };
      if (typeof cfg.url === 'string') {
        enqueue(new URL(cfg.url, fetched.finalUrl || current).toString());
      }
      if (Array.isArray(cfg.urls)) {
        for (const item of cfg.urls) {
          if (item?.url) enqueue(new URL(item.url, fetched.finalUrl || current).toString());
        }
      }
      continue;
    }

    if (isOpenApiDocument(doc)) {
      return parseSwaggerDocument(doc, (fetched.finalUrl || current).replace(/\/+$/, ''));
    }
  }

  if (lastAuthError && tried.length <= 2) {
    throw new Error(lastAuthError);
  }

  const examples = candidateJsonUrls(url)
    .slice(0, 4)
    .map((u) => `• ${u}`)
    .join('\n');

  throw new Error(
    [
      'URL returned HTML (Swagger UI page), not OpenAPI JSON.',
      'Paste the raw JSON docs URL, for example:',
      examples ||
        '• https://your-api/v3/api-docs\n• https://your-api/swagger.json\n• https://your-api/openapi.json',
      lastAuthError ? `Also: ${lastAuthError}` : '',
      lastHtmlHint && !lastAuthError
        ? `Tried resolving from HTML page: ${lastHtmlHint}`
        : '',
      tried.length > 1 ? `Tried ${tried.length} URLs.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}
