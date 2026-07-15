import type {
  LoadApiMapping,
  LoadJsonExtract,
  WebLoadRequestStep,
} from '@/lib/types';

/** Collect extracts from extractJsons + legacy extractJson. */
export function listJsonExtracts(
  step: Pick<WebLoadRequestStep, 'extractJson' | 'extractJsons'> | null | undefined,
): LoadJsonExtract[] {
  if (!step) return [];
  const out: LoadJsonExtract[] = [];
  const seen = new Set<string>();
  const push = (ex: LoadJsonExtract | undefined) => {
    const varName = String(ex?.varName || '').trim();
    const jsonPath = String(ex?.jsonPath || '').trim();
    if (!varName || !jsonPath || seen.has(varName)) return;
    seen.add(varName);
    out.push({
      varName,
      jsonPath,
      defaultValue:
        ex?.defaultValue != null && String(ex.defaultValue).trim()
          ? String(ex.defaultValue)
          : undefined,
    });
  };
  for (const ex of step.extractJsons || []) push(ex);
  push(step.extractJson);
  return out;
}

export function normalizeJsonExtracts(raw: unknown): LoadJsonExtract[] | undefined {
  if (raw == null) return undefined;
  const items = Array.isArray(raw) ? raw : [raw];
  const out: LoadJsonExtract[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const ex = item as Record<string, unknown>;
    const varName = String(ex.varName || '').trim();
    const jsonPath = String(ex.jsonPath || '').trim();
    if (!varName || !jsonPath || seen.has(varName)) continue;
    seen.add(varName);
    out.push({
      varName,
      jsonPath,
      defaultValue:
        ex.defaultValue != null ? String(ex.defaultValue) : undefined,
    });
  }
  return out.length ? out : undefined;
}

export function normalizeApiMappings(raw: unknown): LoadApiMapping[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const targets = new Set(['path', 'query', 'header', 'body', 'form']);
  const out: LoadApiMapping[] = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    const sourceVar = String(row.sourceVar || '')
      .trim()
      .replace(/^\$\{|\}$/g, '');
    const targetKey = String(row.targetKey || '').trim();
    const target = String(row.target || '');
    if (!sourceVar || !targetKey || !targets.has(target)) continue;
    out.push({
      id: String(row.id || `map-${i}-${sourceVar}`),
      sourceVar,
      target: target as LoadApiMapping['target'],
      targetKey,
    });
  }
  return out.length ? out : undefined;
}

/** Set a dotted / bracket path on a JSON object (mutates). */
export function setJsonPathValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const clean = path
    .trim()
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1');
  if (!clean) return;
  const parts = clean.split('.').filter(Boolean);
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/**
 * Apply API field mappings onto a step (inject `${var}` into path/query/header/body/form).
 * Does not mutate the input.
 */
export function applyApiMappingsToStep(
  step: WebLoadRequestStep,
): WebLoadRequestStep {
  const maps = step.apiMappings;
  if (!maps?.length) return step;

  let pathParams = { ...(step.pathParams || {}) };
  let queryParams = { ...(step.queryParams || {}) };
  let headers = { ...(step.headers || {}) };
  let formFields = step.formFields ? step.formFields.map((f) => ({ ...f })) : undefined;
  let body = step.body;

  for (const m of maps) {
    const token = `\${${m.sourceVar}}`;
    switch (m.target) {
      case 'path':
        pathParams[m.targetKey] = token;
        break;
      case 'query':
        queryParams[m.targetKey] = token;
        break;
      case 'header':
        headers[m.targetKey] = token;
        break;
      case 'form': {
        if (!formFields) formFields = [];
        const idx = formFields.findIndex((f) => f.key === m.targetKey);
        if (idx >= 0) {
          formFields[idx] = { ...formFields[idx]!, value: token, type: 'text' };
        } else {
          formFields.push({
            id: `map-${m.id}`,
            key: m.targetKey,
            value: token,
            type: 'text',
            enabled: true,
          });
        }
        break;
      }
      case 'body': {
        const key = m.targetKey.replace(/^\$\.?/, '');
        try {
          const parsed = body?.trim() ? JSON.parse(body) : {};
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            setJsonPathValue(parsed as Record<string, unknown>, key, token);
            body = JSON.stringify(parsed);
          } else {
            body = JSON.stringify({ [key.split('.').pop() || key]: token });
          }
        } catch {
          body = JSON.stringify({ [key.split('.').pop() || key]: token });
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    ...step,
    pathParams: Object.keys(pathParams).length ? pathParams : step.pathParams,
    queryParams: Object.keys(queryParams).length ? queryParams : step.queryParams,
    headers: Object.keys(headers).length ? headers : step.headers,
    formFields: formFields?.length ? formFields : step.formFields,
    body: body !== step.body ? body : step.body,
  };
}

export function newEmptyExtract(index = 0): LoadJsonExtract {
  return {
    varName: index === 0 ? 'id' : `value${index + 1}`,
    jsonPath: index === 0 ? '$.data.id' : '$.data[0].id',
    defaultValue: '',
  };
}

export function newApiMapping(sourceVar = ''): LoadApiMapping {
  return {
    id: `map-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceVar,
    target: 'body',
    targetKey: 'value',
  };
}
