/**
 * Multi-format import: Swagger / OpenAPI, Postman Collection v2.1, HAR, raw JSON.
 * Converts all formats into WebLoadRequestStep[] for the scenario editor.
 */
import type {
  LoadApiDefinition,
  LoadApiResponseDef,
  LoadBodyMode,
  LoadFormField,
  LoadParamDef,
  LoadRawLanguage,
  WebLoadHttpMethod,
  WebLoadRequestStep,
} from '@/lib/types';
import { newFormField } from '@/lib/load-request-body';

const VALID_METHODS: WebLoadHttpMethod[] = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD',
];

function toMethod(m?: string): WebLoadHttpMethod {
  const u = (m || 'GET').toUpperCase();
  return VALID_METHODS.includes(u as WebLoadHttpMethod)
    ? (u as WebLoadHttpMethod)
    : 'GET';
}

export type ImportFormat =
  | 'swagger'
  | 'postman'
  | 'har'
  | 'raw-json'
  | 'unknown';

export type ImportResult = {
  format: ImportFormat;
  label: string;
  steps: WebLoadRequestStep[];
  warnings: string[];
  apiBaseUrl?: string;
};

/** Auto-detect format and parse into steps. */
export function parseImportJson(
  raw: string,
  opts?: { apiBaseUrl?: string },
): ImportResult {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Paste or drop a JSON / Swagger / Postman file');

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error(
      'Could not parse as JSON. Ensure the file is valid JSON (Swagger / OpenAPI / Postman Collection).',
    );
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('Expected a JSON object or array');
  }

  const obj = data as Record<string, unknown>;

  // Swagger / OpenAPI 3.x
  if (obj.openapi && typeof obj.openapi === 'string') {
    return parseOpenApi3(obj, opts);
  }

  // Swagger 2.0
  if (obj.swagger && typeof obj.swagger === 'string') {
    return parseSwagger2(obj, opts);
  }

  // Postman Collection v2.x
  if (obj.info && (obj as Record<string, unknown>).item) {
    const info = obj.info as Record<string, unknown>;
    if (info.schema && typeof info.schema === 'string' && info.schema.includes('postman')) {
      return parsePostmanCollection(obj, opts);
    }
    if (info.name && Array.isArray((obj as Record<string, unknown>).item)) {
      return parsePostmanCollection(obj, opts);
    }
  }

  // HAR
  if (obj.log && typeof obj.log === 'object') {
    const log = obj.log as Record<string, unknown>;
    if (Array.isArray(log.entries)) {
      return parseHar(obj, opts);
    }
  }

  // Raw JSON array of request-like objects
  if (Array.isArray(data)) {
    return parseRawJsonArray(data, opts);
  }

  // Single request-like object
  if (obj.method || obj.url || obj.path) {
    return parseRawJsonArray([obj], opts);
  }

  throw new Error(
    'Unrecognized format. Supported: OpenAPI 3.x, Swagger 2.0, Postman Collection v2.x, HAR, or JSON array of requests.',
  );
}

// ─── OpenAPI 3.x ────────────────────────────────────────────
function parseOpenApi3(
  spec: Record<string, unknown>,
  opts?: { apiBaseUrl?: string },
): ImportResult {
  const info = (spec.info as Record<string, unknown>) || {};
  const title = String(info.title || 'OpenAPI Import');
  const warnings: string[] = [];
  const steps: WebLoadRequestStep[] = [];

  let apiBase = opts?.apiBaseUrl || '';
  const servers = spec.servers as Array<Record<string, unknown>> | undefined;
  if (servers?.length && !apiBase) {
    apiBase = String(servers[0]!.url || '');
  }

  const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
  const components = (spec.components || {}) as Record<string, unknown>;

  for (const [pathTemplate, methods] of Object.entries(paths)) {
    if (typeof methods !== 'object' || !methods) continue;
    for (const [method, opRaw] of Object.entries(methods)) {
      if (!VALID_METHODS.includes(method.toUpperCase() as WebLoadHttpMethod)) continue;
      const op = opRaw as Record<string, unknown>;
      const step = openApiOpToStep(
        pathTemplate,
        method.toUpperCase() as WebLoadHttpMethod,
        op,
        components,
      );
      steps.push(step);
    }
  }

  if (!steps.length) warnings.push('No operations found in OpenAPI spec');

  return {
    format: 'swagger',
    label: `OpenAPI — ${title} (${steps.length} endpoints)`,
    steps,
    warnings,
    apiBaseUrl: apiBase || undefined,
  };
}

function openApiOpToStep(
  pathTemplate: string,
  method: WebLoadHttpMethod,
  op: Record<string, unknown>,
  components: Record<string, unknown>,
): WebLoadRequestStep {
  const path = pathTemplate.replace(/\{([^}]+)\}/g, ':$1');
  const name = String(op.summary || op.operationId || `${method} ${path}`).slice(0, 120);
  const headers: Record<string, string> = {};
  const paramDefs: LoadParamDef[] = [];
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, string> = {};

  // Parameters
  const params = (op.parameters || []) as Array<Record<string, unknown>>;
  for (const p of params) {
    const loc = String(p.in || 'query');
    const pName = String(p.name || '');
    if (!pName) continue;
    paramDefs.push({
      name: pName,
      in: loc as 'path' | 'query' | 'header',
      required: Boolean(p.required),
      type: resolveSchemaType(p.schema as Record<string, unknown> | undefined),
      description: String(p.description || ''),
      example: p.example != null ? String(p.example) : undefined,
    });
    if (loc === 'path') pathParams[pName] = p.example != null ? String(p.example) : '';
    if (loc === 'query') queryParams[pName] = p.example != null ? String(p.example) : '';
    if (loc === 'header' && p.example) headers[pName] = String(p.example);
  }

  // Request body
  let body: string | undefined;
  let bodyMode: LoadBodyMode = 'none';
  let rawLanguage: LoadRawLanguage | undefined;
  let formFields: LoadFormField[] | undefined;
  const bodyRequired: string[] = [];

  const reqBody = op.requestBody as Record<string, unknown> | undefined;
  if (reqBody) {
    const content = (reqBody.content || {}) as Record<string, Record<string, unknown>>;
    const jsonContent = content['application/json'];
    if (jsonContent) {
      headers['Content-Type'] = 'application/json';
      bodyMode = 'raw';
      rawLanguage = 'json';
      body = generateSampleFromSchema(jsonContent.schema as Record<string, unknown>, components, bodyRequired);
    } else if (content['application/x-www-form-urlencoded']) {
      bodyMode = 'urlencoded';
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const schema = content['application/x-www-form-urlencoded']!.schema as Record<string, unknown> | undefined;
      formFields = schemaToFormFields(schema, components);
    } else if (content['multipart/form-data']) {
      bodyMode = 'form-data';
      const schema = content['multipart/form-data']!.schema as Record<string, unknown> | undefined;
      formFields = schemaToFormFields(schema, components);
    }
  }

  if (!headers.Accept) headers.Accept = 'application/json';

  // Build apiDefinition for model info display
  const apiDefinition: LoadApiDefinition = {
    summary: op.summary ? String(op.summary) : undefined,
    description: op.description ? String(op.description) : undefined,
    operationId: op.operationId ? String(op.operationId) : undefined,
    tags: Array.isArray(op.tags) ? (op.tags as string[]) : undefined,
  };

  // Request model info
  if (reqBody) {
    const content = (reqBody.content || {}) as Record<string, Record<string, unknown>>;
    const jsonContent = content['application/json'];
    apiDefinition.requestBodyDescription = reqBody.description ? String(reqBody.description) : undefined;
    if (jsonContent) {
      apiDefinition.requestContentType = 'application/json';
      if (jsonContent.schema) {
        const schemaStr = compactSchemaPreview(jsonContent.schema as Record<string, unknown>, components);
        if (schemaStr) apiDefinition.requestSchemaPreview = schemaStr;
      }
      if (body) apiDefinition.requestExample = body;
    } else {
      const firstCt = Object.keys(content)[0];
      if (firstCt) apiDefinition.requestContentType = firstCt;
    }
  }

  // Response models
  const responses = op.responses as Record<string, Record<string, unknown>> | undefined;
  if (responses) {
    const respDefs: LoadApiResponseDef[] = [];
    for (const [status, respObj] of Object.entries(responses)) {
      const respDef: LoadApiResponseDef = {
        status,
        description: respObj.description ? String(respObj.description) : undefined,
      };
      const respContent = (respObj.content || {}) as Record<string, Record<string, unknown>>;
      const jsonResp = respContent['application/json'];
      if (jsonResp) {
        respDef.contentType = 'application/json';
        if (jsonResp.schema) {
          respDef.schemaPreview = compactSchemaPreview(jsonResp.schema as Record<string, unknown>, components);
          const ignored: string[] = [];
          respDef.example = generateSampleFromSchema(jsonResp.schema as Record<string, unknown>, components, ignored);
        }
        if (jsonResp.example != null) {
          respDef.example = typeof jsonResp.example === 'string'
            ? jsonResp.example
            : JSON.stringify(jsonResp.example, null, 2);
        }
      } else {
        const firstCt = Object.keys(respContent)[0];
        if (firstCt) respDef.contentType = firstCt;
      }
      respDefs.push(respDef);
    }
    if (respDefs.length) apiDefinition.responses = respDefs;
  }

  const hasApiDef = apiDefinition.summary || apiDefinition.requestSchemaPreview || apiDefinition.responses?.length;

  return {
    name,
    path,
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body,
    bodyMode,
    rawLanguage,
    formFields,
    pathParams: Object.keys(pathParams).length ? pathParams : undefined,
    queryParams: Object.keys(queryParams).length ? queryParams : undefined,
    paramDefs: paramDefs.length ? paramDefs : undefined,
    bodyRequired: bodyRequired.length ? bodyRequired : undefined,
    apiDefinition: hasApiDef ? apiDefinition : undefined,
    useApiBase: true,
    thinkTimeMs: 150,
  };
}

// ─── Swagger 2.0 ────────────────────────────────────────────
function parseSwagger2(
  spec: Record<string, unknown>,
  opts?: { apiBaseUrl?: string },
): ImportResult {
  const info = (spec.info as Record<string, unknown>) || {};
  const title = String(info.title || 'Swagger 2.0 Import');
  const warnings: string[] = [];
  const steps: WebLoadRequestStep[] = [];

  let apiBase = opts?.apiBaseUrl || '';
  if (!apiBase && spec.host) {
    const scheme = Array.isArray(spec.schemes) ? (spec.schemes[0] || 'https') : 'https';
    const basePath = String(spec.basePath || '');
    apiBase = `${scheme}://${spec.host}${basePath}`;
  }

  const definitions = (spec.definitions || {}) as Record<string, unknown>;
  const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;

  for (const [pathTemplate, methods] of Object.entries(paths)) {
    if (typeof methods !== 'object' || !methods) continue;
    for (const [method, opRaw] of Object.entries(methods)) {
      if (!VALID_METHODS.includes(method.toUpperCase() as WebLoadHttpMethod)) continue;
      const op = opRaw as Record<string, unknown>;
      const step = swagger2OpToStep(
        pathTemplate,
        method.toUpperCase() as WebLoadHttpMethod,
        op,
        definitions,
      );
      steps.push(step);
    }
  }

  if (!steps.length) warnings.push('No operations found in Swagger spec');

  return {
    format: 'swagger',
    label: `Swagger 2.0 — ${title} (${steps.length} endpoints)`,
    steps,
    warnings,
    apiBaseUrl: apiBase || undefined,
  };
}

function swagger2OpToStep(
  pathTemplate: string,
  method: WebLoadHttpMethod,
  op: Record<string, unknown>,
  definitions: Record<string, unknown>,
): WebLoadRequestStep {
  const path = pathTemplate.replace(/\{([^}]+)\}/g, ':$1');
  const name = String(op.summary || op.operationId || `${method} ${path}`).slice(0, 120);
  const headers: Record<string, string> = {};
  const paramDefs: LoadParamDef[] = [];
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, string> = {};
  let body: string | undefined;
  let bodyMode: LoadBodyMode = 'none';
  let rawLanguage: LoadRawLanguage | undefined;
  let formFields: LoadFormField[] | undefined;
  const bodyRequired: string[] = [];

  const params = (op.parameters || []) as Array<Record<string, unknown>>;
  for (const p of params) {
    const loc = String(p.in || 'query');
    const pName = String(p.name || '');
    if (!pName) continue;

    if (loc === 'body') {
      const schema = p.schema as Record<string, unknown> | undefined;
      if (schema) {
        headers['Content-Type'] = 'application/json';
        bodyMode = 'raw';
        rawLanguage = 'json';
        const components = { schemas: definitions };
        body = generateSampleFromSchema(schema, components, bodyRequired);
      }
      continue;
    }
    if (loc === 'formData') {
      if (!formFields) formFields = [];
      formFields.push(
        newFormField({
          key: pName,
          value: p.example != null ? String(p.example) : '',
          type: p.type === 'file' ? 'file' : 'text',
        }),
      );
      bodyMode = p.type === 'file' ? 'form-data' : (bodyMode === 'form-data' ? 'form-data' : 'urlencoded');
      continue;
    }

    paramDefs.push({
      name: pName,
      in: loc as 'path' | 'query' | 'header',
      required: Boolean(p.required),
      type: String(p.type || ''),
      description: String(p.description || ''),
      example: p.example != null ? String(p.example) : undefined,
    });
    if (loc === 'path') pathParams[pName] = p.example != null ? String(p.example) : '';
    if (loc === 'query') queryParams[pName] = p.example != null ? String(p.example) : '';
    if (loc === 'header' && p.example) headers[pName] = String(p.example);
  }

  if (!headers.Accept) headers.Accept = 'application/json';

  // Build apiDefinition for Swagger 2.0
  const apiDefinition: LoadApiDefinition = {
    summary: op.summary ? String(op.summary) : undefined,
    description: op.description ? String(op.description) : undefined,
    operationId: op.operationId ? String(op.operationId) : undefined,
    tags: Array.isArray(op.tags) ? (op.tags as string[]) : undefined,
  };
  if (body && bodyMode === 'raw') {
    apiDefinition.requestContentType = 'application/json';
    apiDefinition.requestExample = body;
  }

  // Swagger 2.0 responses
  const responses = op.responses as Record<string, Record<string, unknown>> | undefined;
  if (responses) {
    const respDefs: LoadApiResponseDef[] = [];
    for (const [status, respObj] of Object.entries(responses)) {
      const respDef: LoadApiResponseDef = {
        status,
        description: respObj.description ? String(respObj.description) : undefined,
      };
      if (respObj.schema) {
        respDef.contentType = 'application/json';
        const schema = respObj.schema as Record<string, unknown>;
        respDef.schemaPreview = compactSchemaPreview(schema, { schemas: definitions });
        const ignored: string[] = [];
        respDef.example = generateSampleFromSchema(schema, { schemas: definitions }, ignored);
      }
      respDefs.push(respDef);
    }
    if (respDefs.length) apiDefinition.responses = respDefs;
  }

  const hasApiDef = apiDefinition.summary || apiDefinition.requestExample || apiDefinition.responses?.length;

  return {
    name,
    path,
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body,
    bodyMode,
    rawLanguage,
    formFields,
    pathParams: Object.keys(pathParams).length ? pathParams : undefined,
    queryParams: Object.keys(queryParams).length ? queryParams : undefined,
    paramDefs: paramDefs.length ? paramDefs : undefined,
    bodyRequired: bodyRequired.length ? bodyRequired : undefined,
    apiDefinition: hasApiDef ? apiDefinition : undefined,
    useApiBase: true,
    thinkTimeMs: 150,
  };
}

// ─── Postman Collection v2.x ────────────────────────────────
function parsePostmanCollection(
  collection: Record<string, unknown>,
  opts?: { apiBaseUrl?: string },
): ImportResult {
  const info = (collection.info as Record<string, unknown>) || {};
  const title = String(info.name || 'Postman Collection');
  const warnings: string[] = [];
  const steps: WebLoadRequestStep[] = [];
  const items = (collection.item || []) as unknown[];

  flattenPostmanItems(items, steps, warnings, '');

  // Extract variables
  const variables = (collection.variable || []) as Array<Record<string, unknown>>;
  let apiBase = opts?.apiBaseUrl || '';
  if (!apiBase) {
    const baseUrlVar = variables.find(
      (v) => String(v.key || '').toLowerCase() === 'baseurl' || String(v.key || '').toLowerCase() === 'base_url',
    );
    if (baseUrlVar) apiBase = String(baseUrlVar.value || '');
  }

  if (!steps.length) warnings.push('No requests found in Postman collection');

  return {
    format: 'postman',
    label: `Postman — ${title} (${steps.length} requests)`,
    steps,
    warnings,
    apiBaseUrl: apiBase || undefined,
  };
}

function flattenPostmanItems(
  items: unknown[],
  steps: WebLoadRequestStep[],
  warnings: string[],
  folderPrefix: string,
): void {
  for (const raw of items) {
    const item = raw as Record<string, unknown>;

    // Folder: recurse
    if (Array.isArray(item.item)) {
      const folder = item.name ? `${folderPrefix}${item.name}/` : folderPrefix;
      flattenPostmanItems(item.item as unknown[], steps, warnings, folder);
      continue;
    }

    // Request item
    const req = item.request as Record<string, unknown> | string | undefined;
    if (!req) continue;

    try {
      const step = postmanRequestToStep(item, folderPrefix);
      steps.push(step);
    } catch (err) {
      warnings.push(
        `Skipped "${item.name || '?'}": ${err instanceof Error ? err.message : 'parse error'}`,
      );
    }
  }
}

function postmanRequestToStep(
  item: Record<string, unknown>,
  folderPrefix: string,
): WebLoadRequestStep {
  const itemName = String(item.name || '');
  let req = item.request as Record<string, unknown> | string;
  if (typeof req === 'string') {
    return {
      name: folderPrefix + itemName || 'GET /',
      path: req,
      method: 'GET',
      useApiBase: true,
      thinkTimeMs: 150,
    };
  }

  const method = toMethod(String(req.method || 'GET'));

  // URL
  const url = req.url as Record<string, unknown> | string;
  let path = '/';
  const queryParams: Record<string, string> = {};
  const pathParams: Record<string, string> = {};

  if (typeof url === 'string') {
    path = url;
  } else if (url) {
    const rawPath = url.raw ? String(url.raw) : '';
    if (rawPath) {
      try {
        const u = new URL(rawPath.replace(/\{\{[^}]*\}\}/g, 'PLACEHOLDER'));
        path = u.pathname || '/';
      } catch {
        path = rawPath;
      }
    } else if (Array.isArray(url.path)) {
      path = '/' + (url.path as string[]).join('/');
    }

    // Path variables
    const pathVars = (url.variable || []) as Array<Record<string, unknown>>;
    for (const v of pathVars) {
      const key = String(v.key || '');
      if (key) {
        pathParams[key] = String(v.value || '');
        path = path.replace(`:${key}`, `:${key}`);
      }
    }

    // Query params
    const queries = (url.query || []) as Array<Record<string, unknown>>;
    for (const q of queries) {
      const key = String(q.key || '');
      if (key && q.disabled !== true) queryParams[key] = String(q.value || '');
    }
  }

  // Replace Postman variables {{var}} → ${var} for our engine
  path = path.replace(/\{\{([^}]+)\}\}/g, '${$1}');

  // Headers
  const headers: Record<string, string> = {};
  const headersList = (req.header || []) as Array<Record<string, unknown>>;
  for (const h of headersList) {
    if (h.disabled) continue;
    const key = String(h.key || '');
    const val = String(h.value || '');
    if (key) headers[key] = val.replace(/\{\{([^}]+)\}\}/g, '${$1}');
  }

  // Body
  let body: string | undefined;
  let bodyMode: LoadBodyMode = 'none';
  let rawLanguage: LoadRawLanguage | undefined;
  let formFields: LoadFormField[] | undefined;

  const bodyObj = req.body as Record<string, unknown> | undefined;
  if (bodyObj) {
    const mode = String(bodyObj.mode || '');

    if (mode === 'raw') {
      body = String(bodyObj.raw || '');
      bodyMode = 'raw';
      const options = bodyObj.options as Record<string, Record<string, unknown>> | undefined;
      const lang = String(options?.raw?.language || 'json');
      rawLanguage = (['json', 'xml', 'html', 'javascript', 'text'].includes(lang)
        ? lang
        : 'text') as LoadRawLanguage;
    } else if (mode === 'urlencoded') {
      bodyMode = 'urlencoded';
      formFields = ((bodyObj.urlencoded || []) as Array<Record<string, unknown>>).map(
        (f) =>
          newFormField({
            key: String(f.key || ''),
            value: String(f.value || '').replace(/\{\{([^}]+)\}\}/g, '${$1}'),
            enabled: f.disabled !== true,
          }),
      );
    } else if (mode === 'formdata') {
      bodyMode = 'form-data';
      formFields = ((bodyObj.formdata || []) as Array<Record<string, unknown>>).map(
        (f) =>
          newFormField({
            key: String(f.key || ''),
            value: String(f.value || f.src || '').replace(/\{\{([^}]+)\}\}/g, '${$1}'),
            type: f.type === 'file' ? 'file' : 'text',
            enabled: f.disabled !== true,
          }),
      );
    } else if (mode === 'graphql') {
      bodyMode = 'raw';
      rawLanguage = 'json';
      const gql = bodyObj.graphql as Record<string, unknown> | undefined;
      body = JSON.stringify({
        query: gql?.query || '',
        variables: gql?.variables ? JSON.parse(String(gql.variables)) : {},
      }, null, 2);
    }
  }

  if (!headers.Accept && !headers.accept) headers.Accept = 'application/json';

  const name = (folderPrefix + itemName || `${method} ${path}`).slice(0, 120);

  return {
    name,
    path,
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body,
    bodyMode,
    rawLanguage,
    formFields,
    pathParams: Object.keys(pathParams).length ? pathParams : undefined,
    queryParams: Object.keys(queryParams).length ? queryParams : undefined,
    useApiBase: !/^https?:\/\//i.test(path),
    thinkTimeMs: 150,
  };
}

// ─── HAR (HTTP Archive) ─────────────────────────────────────
function parseHar(
  har: Record<string, unknown>,
  opts?: { apiBaseUrl?: string },
): ImportResult {
  const log = har.log as Record<string, unknown>;
  const entries = (log.entries || []) as Array<Record<string, unknown>>;
  const warnings: string[] = [];
  const steps: WebLoadRequestStep[] = [];

  for (const entry of entries) {
    const req = entry.request as Record<string, unknown> | undefined;
    if (!req) continue;
    try {
      const step = harEntryToStep(req, opts?.apiBaseUrl);
      steps.push(step);
    } catch {
      warnings.push(`Skipped HAR entry: ${String(req.url || '?').slice(0, 80)}`);
    }
  }

  return {
    format: 'har',
    label: `HAR — ${steps.length} requests`,
    steps,
    warnings,
  };
}

function harEntryToStep(
  req: Record<string, unknown>,
  apiBase?: string,
): WebLoadRequestStep {
  const method = toMethod(String(req.method || 'GET'));
  const rawUrl = String(req.url || '/');

  let path = rawUrl;
  let useApiBase = false;
  const queryParams: Record<string, string> = {};

  try {
    const u = new URL(rawUrl);
    path = u.pathname || '/';
    u.searchParams.forEach((v, k) => { if (k) queryParams[k] = v; });
    if (apiBase) {
      try {
        const base = new URL(apiBase);
        if (u.origin === base.origin) {
          useApiBase = true;
          const basePath = base.pathname.replace(/\/+$/, '');
          if (basePath && path.startsWith(basePath)) {
            path = path.slice(basePath.length) || '/';
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* keep raw */ }

  const headers: Record<string, string> = {};
  const headersList = (req.headers || []) as Array<Record<string, unknown>>;
  for (const h of headersList) {
    const key = String(h.name || '');
    if (key && !key.startsWith(':')) headers[key] = String(h.value || '');
  }

  let body: string | undefined;
  let bodyMode: LoadBodyMode = 'none';
  let rawLanguage: LoadRawLanguage | undefined;
  let formFields: LoadFormField[] | undefined;

  const postData = req.postData as Record<string, unknown> | undefined;
  if (postData) {
    const text = String(postData.text || '');
    const mimeType = String(postData.mimeType || '');
    const harParams = (postData.params || []) as Array<Record<string, unknown>>;

    if (harParams.length && mimeType.includes('form')) {
      bodyMode = mimeType.includes('multipart') ? 'form-data' : 'urlencoded';
      formFields = harParams.map((p) =>
        newFormField({
          key: String(p.name || ''),
          value: String(p.value || ''),
          type: p.fileName ? 'file' : 'text',
        }),
      );
    } else if (text) {
      bodyMode = 'raw';
      rawLanguage = mimeType.includes('json') ? 'json' : mimeType.includes('xml') ? 'xml' : 'text';
      body = text;
    }
  }

  return {
    name: `${method} ${path}`.slice(0, 120),
    path,
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body,
    bodyMode,
    rawLanguage,
    formFields,
    queryParams: Object.keys(queryParams).length ? queryParams : undefined,
    useApiBase,
    thinkTimeMs: 150,
  };
}

// ─── Raw JSON array of requests ─────────────────────────────
function parseRawJsonArray(
  arr: unknown[],
  opts?: { apiBaseUrl?: string },
): ImportResult {
  const warnings: string[] = [];
  const steps: WebLoadRequestStep[] = [];

  for (const raw of arr) {
    if (typeof raw !== 'object' || !raw) continue;
    const obj = raw as Record<string, unknown>;
    const method = toMethod(String(obj.method || 'GET'));
    const path = String(obj.url || obj.path || '/');
    const headers: Record<string, string> = {};

    if (obj.headers && typeof obj.headers === 'object') {
      for (const [k, v] of Object.entries(obj.headers as Record<string, unknown>)) {
        headers[k] = String(v ?? '');
      }
    }

    let body: string | undefined;
    let bodyMode: LoadBodyMode = 'none';
    let rawLanguage: LoadRawLanguage | undefined;

    if (obj.body != null) {
      bodyMode = 'raw';
      rawLanguage = 'json';
      body = typeof obj.body === 'string' ? obj.body : JSON.stringify(obj.body, null, 2);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }

    steps.push({
      name: String(obj.name || `${method} ${path}`).slice(0, 120),
      path,
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body,
      bodyMode,
      rawLanguage,
      useApiBase: !/^https?:\/\//i.test(path),
      thinkTimeMs: 150,
    });
  }

  return {
    format: 'raw-json',
    label: `JSON — ${steps.length} requests`,
    steps,
    warnings,
  };
}

// ─── Schema helpers ─────────────────────────────────────────
function resolveSchemaType(schema?: Record<string, unknown>): string {
  if (!schema) return 'string';
  return String(schema.type || schema.format || 'string');
}

function resolveRef(
  ref: string,
  components: Record<string, unknown>,
): Record<string, unknown> | undefined {
  // $ref: "#/components/schemas/Foo" or "#/definitions/Foo"
  const parts = ref.replace(/^#\//, '').split('/');
  let cur: unknown = { components, definitions: (components as Record<string, unknown>).schemas };
  for (const part of parts) {
    if (typeof cur !== 'object' || !cur) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'object' && cur ? (cur as Record<string, unknown>) : undefined;
}

function generateSampleFromSchema(
  schema: Record<string, unknown> | undefined,
  components: Record<string, unknown>,
  requiredOut: string[],
  depth = 0,
): string | undefined {
  if (!schema || depth > 5) return undefined;

  if (schema.$ref && typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, components);
    if (resolved) return generateSampleFromSchema(resolved, components, requiredOut, depth);
    return undefined;
  }

  const type = String(schema.type || 'object');

  if (schema.example != null) {
    return typeof schema.example === 'string' ? schema.example : JSON.stringify(schema.example, null, 2);
  }

  if (type === 'object' || schema.properties) {
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    if (depth === 0) requiredOut.push(...required);

    const obj: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(props)) {
      obj[key] = sampleValue(propSchema, components, depth + 1);
    }
    return JSON.stringify(obj, null, 2);
  }

  if (type === 'array') {
    const itemSchema = schema.items as Record<string, unknown> | undefined;
    const val = itemSchema ? sampleValue(itemSchema, components, depth + 1) : '';
    return JSON.stringify([val], null, 2);
  }

  return undefined;
}

function sampleValue(
  schema: Record<string, unknown>,
  components: Record<string, unknown>,
  depth: number,
): unknown {
  if (schema.$ref && typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, components);
    if (resolved) return sampleValue(resolved, components, depth);
    return '';
  }

  if (schema.example != null) return schema.example;
  if (schema.default != null) return schema.default;

  const type = String(schema.type || 'string');
  if (type === 'string') return schema.format === 'date' ? '2024-01-01' : schema.format === 'date-time' ? '2024-01-01T00:00:00Z' : schema.format === 'email' ? 'user@example.com' : '';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    return items ? [sampleValue(items, components, depth + 1)] : [];
  }
  if (type === 'object' || schema.properties) {
    if (depth > 4) return {};
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      obj[k] = sampleValue(v, components, depth + 1);
    }
    return obj;
  }
  return '';
}

/** Build a compact type-like preview of a schema, e.g. "{ id: string, name: string, items: [{ ... }] }" */
function compactSchemaPreview(
  schema: Record<string, unknown>,
  components: Record<string, unknown>,
  depth = 0,
): string | undefined {
  if (!schema || depth > 4) return undefined;

  if (schema.$ref && typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, components);
    if (resolved) return compactSchemaPreview(resolved, components, depth);
    const refName = schema.$ref.split('/').pop() || '?';
    return refName;
  }

  const type = String(schema.type || 'object');

  if (type === 'object' || schema.properties) {
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const indent = '  '.repeat(depth);
    const innerIndent = '  '.repeat(depth + 1);
    const lines: string[] = [];
    for (const [key, propSchema] of Object.entries(props)) {
      const req = required.has(key) ? '' : '?';
      const propType = compactPropType(propSchema, components, depth + 1);
      lines.push(`${innerIndent}${key}${req}: ${propType}`);
    }
    if (!lines.length) return '{}';
    return `{\n${lines.join('\n')}\n${indent}}`;
  }

  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    const inner = items ? compactPropType(items, components, depth + 1) : 'any';
    return `${inner}[]`;
  }

  return type;
}

function compactPropType(
  schema: Record<string, unknown>,
  components: Record<string, unknown>,
  depth: number,
): string {
  if (schema.$ref && typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, components);
    if (resolved && depth < 3) return compactSchemaPreview(resolved, components, depth) || '?';
    return schema.$ref.split('/').pop() || '?';
  }
  const type = String(schema.type || 'string');
  if (type === 'object' || schema.properties) {
    return compactSchemaPreview(schema, components, depth) || '{}';
  }
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    const inner = items ? compactPropType(items, components, depth + 1) : 'any';
    return `${inner}[]`;
  }
  if (schema.enum && Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).map(v => JSON.stringify(v)).join(' | ');
  }
  if (schema.format) return `${type} (${schema.format})`;
  return type;
}

function schemaToFormFields(
  schema: Record<string, unknown> | undefined,
  components: Record<string, unknown>,
): LoadFormField[] {
  if (!schema) return [newFormField()];

  if (schema.$ref && typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, components);
    if (resolved) return schemaToFormFields(resolved, components);
  }

  const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const fields: LoadFormField[] = [];
  for (const [key, propSchema] of Object.entries(props)) {
    fields.push(
      newFormField({
        key,
        value: propSchema.example != null ? String(propSchema.example) : '',
        type: propSchema.format === 'binary' || propSchema.type === 'file' ? 'file' : 'text',
      }),
    );
  }
  return fields.length ? fields : [newFormField()];
}

/** Detect format from raw text without full parse (for UI label). */
export function detectImportFormat(raw: string): ImportFormat {
  const t = raw.trim();
  if (!t) return 'unknown';
  try {
    const data = JSON.parse(t) as Record<string, unknown>;
    if (data.openapi) return 'swagger';
    if (data.swagger) return 'swagger';
    if ((data.info as Record<string, unknown>)?.schema?.toString().includes('postman')) return 'postman';
    if (data.info && data.item) return 'postman';
    if ((data.log as Record<string, unknown>)?.entries) return 'har';
    if (Array.isArray(data)) return 'raw-json';
    if (data.method || data.url || data.path) return 'raw-json';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
