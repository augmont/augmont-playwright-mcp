import type {
  LoadParamDef,
  LoadParamLocation,
  WebLoadHttpMethod,
  WebLoadRequestStep,
} from '@/lib/types';
import {
  encodeDynamicParamValue,
  expandDynamicForJmeter,
  expandDynamicForProbe,
  hasDynamicExpr,
  isDynamicOrFilled,
} from '@/lib/load-dynamic-vars';

export type RequestValidationIssue = {
  level: 'error' | 'warn';
  field: string;
  message: string;
};

/** Path tokens like :id or {id} */
export function extractPathParamNames(path: string): string[] {
  const names = new Set<string>();
  for (const m of path.matchAll(/:([A-Za-z_][\w]*)/g)) {
    if (m[1]) names.add(m[1]);
  }
  for (const m of path.matchAll(/\{([A-Za-z_][\w]*)\}/g)) {
    if (m[1]) names.add(m[1]);
  }
  return [...names];
}

export function ensureParamDefs(step: WebLoadRequestStep): LoadParamDef[] {
  const existing = step.paramDefs || [];
  const byKey = new Map<string, LoadParamDef>(
    existing.map((p) => [`${p.in}:${p.name}`, p] as const),
  );

  for (const name of extractPathParamNames(step.path || '')) {
    const key = `path:${name}`;
    if (!byKey.has(key)) {
      byKey.set(key, { name, in: 'path', required: true, type: 'string' });
    }
  }

  return [...byKey.values()];
}

function isFilled(v: unknown): boolean {
  return isDynamicOrFilled(v);
}

/** Substitute path params and append query string (does not touch host). */
export function applyParamsToPath(
  step: Pick<WebLoadRequestStep, 'path' | 'pathParams' | 'queryParams'>,
  opts?: { mode?: 'probe' | 'jmeter' },
): string {
  const mode = opts?.mode || 'probe';
  let path = (step.path || '').trim();
  const pathParams = step.pathParams || {};

  for (const [name, value] of Object.entries(pathParams)) {
    if (!isFilled(value)) continue;
    const enc = encodeDynamicParamValue(String(value).trim(), mode);
    path = path
      .replace(new RegExp(`:${name}\\b`, 'g'), enc)
      .replace(new RegExp(`\\{${name}\\}`, 'g'), enc);
  }

  // Also expand any inline ${…} left in the path template itself
  path =
    mode === 'jmeter'
      ? expandDynamicForJmeter(path)
      : expandDynamicForProbe(path);

  const q = step.queryParams || {};
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (!k.trim() || !isFilled(v)) continue;
    const encVal = encodeDynamicParamValue(String(v).trim(), mode);
    const encKey =
      mode === 'jmeter' && hasDynamicExpr(k)
        ? k.trim()
        : encodeURIComponent(k.trim());
    pairs.push(`${encKey}=${encVal}`);
  }
  if (!pairs.length) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}${pairs.join('&')}`;
}

function getJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function validateLoadRequest(
  step: WebLoadRequestStep,
  opts?: { requiresAuth?: boolean; hasAuthHeader?: boolean },
): RequestValidationIssue[] {
  const issues: RequestValidationIssue[] = [];
  const method = (step.method || 'GET').toUpperCase() as WebLoadHttpMethod;
  const defs = ensureParamDefs(step);

  if (!step.path?.trim()) {
    issues.push({
      level: 'error',
      field: 'path',
      message: 'Path / URL is required',
    });
  }

  for (const def of defs) {
    if (!def.required) continue;
    if (def.in === 'path') {
      if (!isFilled(step.pathParams?.[def.name])) {
        issues.push({
          level: 'error',
          field: `path.${def.name}`,
          message: `Required path param "${def.name}" is empty`,
        });
      }
    } else if (def.in === 'query') {
      if (!isFilled(step.queryParams?.[def.name])) {
        issues.push({
          level: 'error',
          field: `query.${def.name}`,
          message: `Required query param "${def.name}" is empty`,
        });
      }
    } else if (def.in === 'header') {
      const headers = step.headers || {};
      const found = Object.entries(headers).find(
        ([k]) => k.toLowerCase() === def.name.toLowerCase(),
      );
      if (!found || !isFilled(found[1])) {
        issues.push({
          level: 'error',
          field: `header.${def.name}`,
          message: `Required header "${def.name}" is missing`,
        });
      }
    }
  }

  // Unfilled path tokens still in path string
  const unresolved = extractPathParamNames(applyParamsToPath({
    path: step.path,
    pathParams: step.pathParams,
    queryParams: {},
  }));
  for (const name of unresolved) {
    if (!issues.some((i) => i.field === `path.${name}`)) {
      issues.push({
        level: 'error',
        field: `path.${name}`,
        message: `Path still contains :${name} — set a value in Params`,
      });
    }
  }

  const bodyMethods = new Set(['POST', 'PUT', 'PATCH']);
  const bodyMode = step.bodyMode || (step.body?.trim() ? 'raw' : 'none');
  const requiredBody =
    step.bodyRequired ||
    defs.filter((d) => d.in === 'body' && d.required).map((d) => d.name);

  if (bodyMethods.has(method) && bodyMode !== 'none') {
    if (bodyMode === 'raw' || bodyMode === 'graphql') {
      const raw =
        bodyMode === 'graphql'
          ? step.graphqlQuery || step.body
          : step.body;
      if (requiredBody.length && !raw?.trim()) {
        issues.push({
          level: 'error',
          field: 'body',
          message: 'Request body is required for this API',
        });
      } else if (
        bodyMode === 'raw' &&
        (step.rawLanguage || 'json') === 'json' &&
        raw?.trim()
      ) {
        try {
          const json = JSON.parse(raw);
          if (json && typeof json === 'object') {
            for (const field of requiredBody) {
              const v = getJsonPath(json, field);
              if (!isFilled(v) && v !== 0 && v !== false) {
                issues.push({
                  level: 'error',
                  field: `body.${field}`,
                  message: `Required body field "${field}" is missing`,
                });
              }
            }
          }
        } catch {
          issues.push({
            level: requiredBody.length ? 'error' : 'warn',
            field: 'body',
            message: 'Body must be valid JSON',
          });
        }
      } else if (bodyMode === 'graphql' && step.graphqlVariables?.trim()) {
        try {
          JSON.parse(step.graphqlVariables);
        } catch {
          issues.push({
            level: 'error',
            field: 'body.variables',
            message: 'GraphQL variables must be valid JSON',
          });
        }
      }
    } else if (bodyMode === 'urlencoded' || bodyMode === 'form-data') {
      const fields = (step.formFields || []).filter(
        (f) => f.enabled !== false && f.key.trim(),
      );
      if (requiredBody.length && !fields.length && !step.body?.trim()) {
        issues.push({
          level: 'error',
          field: 'body',
          message: 'Add at least one form field for this API',
        });
      }
    } else if (bodyMode === 'binary' && !step.binaryBase64) {
      issues.push({
        level: 'warn',
        field: 'body',
        message: 'No binary file selected',
      });
    }
  } else if (bodyMethods.has(method) && requiredBody.length && bodyMode === 'none') {
    issues.push({
      level: 'error',
      field: 'body',
      message: 'Request body is required for this API — pick a Body type',
    });
  }

  if (opts?.requiresAuth && !opts.hasAuthHeader) {
    issues.push({
      level: 'warn',
      field: 'auth',
      message: 'Authorization required — token will be attached on Send if credentials are set',
    });
  }

  return issues;
}

export function paramDefsFromPathAndSwagger(
  path: string,
  parameters?: LoadParamDef[],
): LoadParamDef[] {
  const map = new Map<string, LoadParamDef>();
  for (const name of extractPathParamNames(path)) {
    map.set(`path:${name}`, {
      name,
      in: 'path',
      required: true,
      type: 'string',
    });
  }
  for (const p of parameters || []) {
    const key = `${p.in}:${p.name}`;
    map.set(key, { ...p });
  }
  return [...map.values()];
}

export function seedParamValues(
  defs: LoadParamDef[],
): {
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  headerExtras: Record<string, string>;
} {
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, string> = {};
  const headerExtras: Record<string, string> = {};
  for (const d of defs) {
    const val = d.example != null ? String(d.example) : '';
    if (d.in === 'path') pathParams[d.name] = val;
    else if (d.in === 'query') queryParams[d.name] = val;
    else if (d.in === 'header' && val) headerExtras[d.name] = val;
  }
  return { pathParams, queryParams, headerExtras };
}

export function locationLabel(loc: LoadParamLocation): string {
  return loc.charAt(0).toUpperCase() + loc.slice(1);
}
