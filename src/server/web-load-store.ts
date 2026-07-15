import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type {
  TestCaseMeta,
  WebLoadConfig,
  WebLoadHttpMethod,
  WebLoadRequestStep,
  WebLoadTestCase,
} from '@/lib/types';
import type { ResolvedLoadSampler } from '@/server/jmeter-jmx';
import { ensureLgdApiV1Base } from '@/lib/api-url';
import { applyParamsToPath } from '@/lib/load-request-params';
import { resolveOutgoingBody } from '@/lib/load-request-body';
import {
  expandDynamicRecord,
  expandDynamicString,
} from '@/lib/load-dynamic-vars';
import { defaultLoadP99Ms, resolveLoadThresholds } from '@/lib/load-grade-summary';
import {
  applyApiMappingsToStep,
  listJsonExtracts,
  normalizeApiMappings,
  normalizeJsonExtracts,
} from '@/lib/load-chain';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'web-load-cases.json');
const SEED_VERSION = 3;

const METHODS: WebLoadHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
];

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function normalizeRequests(raw: unknown): WebLoadRequestStep[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out: WebLoadRequestStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<WebLoadRequestStep>;
    const pathStr = (r.path || '').toString().trim();
    if (!pathStr) continue;
    const method = METHODS.includes(r.method as WebLoadHttpMethod)
      ? (r.method as WebLoadHttpMethod)
      : undefined;
    let headers: Record<string, string> | undefined;
    if (r.headers && typeof r.headers === 'object') {
      headers = {};
      for (const [k, v] of Object.entries(r.headers)) {
        if (k && v != null) headers[String(k)] = String(v);
      }
      if (!Object.keys(headers).length) headers = undefined;
    }
    let extractJsons = normalizeJsonExtracts(
      (r as { extractJsons?: unknown }).extractJsons,
    );
    const legacyExtract = normalizeJsonExtracts(
      (r as { extractJson?: unknown }).extractJson,
    );
    if (!extractJsons?.length && legacyExtract?.length) {
      extractJsons = legacyExtract;
    }
    const extractJson = extractJsons?.[0];
    const apiMappings = normalizeApiMappings(
      (r as { apiMappings?: unknown }).apiMappings,
    );
    let pathParams: Record<string, string> | undefined;
    if (r.pathParams && typeof r.pathParams === 'object') {
      pathParams = {};
      for (const [k, v] of Object.entries(r.pathParams)) {
        if (k) pathParams[String(k)] = v == null ? '' : String(v);
      }
      if (!Object.keys(pathParams).length) pathParams = undefined;
    }
    let queryParams: Record<string, string> | undefined;
    if (r.queryParams && typeof r.queryParams === 'object') {
      queryParams = {};
      for (const [k, v] of Object.entries(r.queryParams)) {
        if (k) queryParams[String(k)] = v == null ? '' : String(v);
      }
      if (!Object.keys(queryParams).length) queryParams = undefined;
    }
    let paramDefs: WebLoadRequestStep['paramDefs'];
    if (Array.isArray((r as { paramDefs?: unknown }).paramDefs)) {
      paramDefs = ((r as { paramDefs: unknown[] }).paramDefs || [])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({
          name: String(p.name || '').trim(),
          in: (['path', 'query', 'header', 'body'].includes(String(p.in))
            ? String(p.in)
            : 'query') as NonNullable<WebLoadRequestStep['paramDefs']>[number]['in'],
          required: Boolean(p.required),
          type: p.type != null ? String(p.type) : undefined,
          description: p.description != null ? String(p.description) : undefined,
          example: p.example != null ? String(p.example) : undefined,
        }))
        .filter((p) => p.name);
      if (!paramDefs.length) paramDefs = undefined;
    }
    let bodyRequired: string[] | undefined;
    if (Array.isArray((r as { bodyRequired?: unknown }).bodyRequired)) {
      bodyRequired = (r as { bodyRequired: unknown[] }).bodyRequired
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!bodyRequired.length) bodyRequired = undefined;
    }
    const bodyModes = ['none', 'form-data', 'urlencoded', 'raw', 'binary', 'graphql'] as const;
    const bodyMode = bodyModes.includes(r.bodyMode as (typeof bodyModes)[number])
      ? (r.bodyMode as (typeof bodyModes)[number])
      : undefined;
    const rawLangs = ['text', 'javascript', 'json', 'html', 'xml'] as const;
    const rawLanguage = rawLangs.includes(r.rawLanguage as (typeof rawLangs)[number])
      ? (r.rawLanguage as (typeof rawLangs)[number])
      : undefined;
    let formFields: WebLoadRequestStep['formFields'];
    if (Array.isArray(r.formFields)) {
      formFields = (r.formFields as unknown[])
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f, i) => ({
          id: String(f.id || `ff-${i}`),
          key: String(f.key || ''),
          value: f.value == null ? '' : String(f.value),
          type: f.type === 'file' ? ('file' as const) : ('text' as const),
          enabled: f.enabled !== false,
          contentType: f.contentType != null ? String(f.contentType) : undefined,
        }));
      if (!formFields.length) formFields = undefined;
    }
    out.push({
      name: r.name != null ? String(r.name) : undefined,
      path: pathStr,
      method,
      headers,
      body: r.body != null ? String(r.body) : undefined,
      bodyMode,
      rawLanguage,
      formFields,
      graphqlQuery: r.graphqlQuery != null ? String(r.graphqlQuery) : undefined,
      graphqlVariables:
        r.graphqlVariables != null ? String(r.graphqlVariables) : undefined,
      binaryFileName:
        r.binaryFileName != null ? String(r.binaryFileName) : undefined,
      binaryBase64: r.binaryBase64 != null ? String(r.binaryBase64) : undefined,
      apiDefinition: normalizeApiDefinition(
        (r as { apiDefinition?: unknown }).apiDefinition,
      ),
      pathParams,
      queryParams,
      paramDefs,
      bodyRequired,
      useApiBase: Boolean(r.useApiBase),
      thinkTimeMs:
        r.thinkTimeMs != null ? clampInt(r.thinkTimeMs, 0, 0, 30_000) : undefined,
      extractJson,
      extractJsons,
      apiMappings,
    });
  }
  return out.length ? out : undefined;
}

function normalizeApiDefinition(raw: unknown): WebLoadRequestStep['apiDefinition'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  const responses = Array.isArray(d.responses)
    ? d.responses
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
          status: String(x.status || ''),
          description: x.description != null ? String(x.description) : undefined,
          contentType: x.contentType != null ? String(x.contentType) : undefined,
          example: x.example != null ? String(x.example) : undefined,
          schemaPreview:
            x.schemaPreview != null ? String(x.schemaPreview) : undefined,
        }))
        .filter((x) => x.status)
    : undefined;
  const out: NonNullable<WebLoadRequestStep['apiDefinition']> = {
    summary: d.summary != null ? String(d.summary) : undefined,
    description: d.description != null ? String(d.description) : undefined,
    operationId: d.operationId != null ? String(d.operationId) : undefined,
    tags: Array.isArray(d.tags) ? d.tags.map(String).filter(Boolean) : undefined,
    requestBodyDescription:
      d.requestBodyDescription != null
        ? String(d.requestBodyDescription)
        : undefined,
    requestContentType:
      d.requestContentType != null ? String(d.requestContentType) : undefined,
    requestExample:
      d.requestExample != null ? String(d.requestExample) : undefined,
    requestSchemaPreview:
      d.requestSchemaPreview != null
        ? String(d.requestSchemaPreview)
        : undefined,
    responses: responses?.length ? responses : undefined,
  };
  const has =
    out.summary ||
    out.description ||
    out.requestExample ||
    out.requestSchemaPreview ||
    out.responses?.length;
  return has ? out : undefined;
}

function normalizeLoad(raw: Partial<WebLoadConfig> | undefined): WebLoadConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const targetUrl = (raw.targetUrl || '').toString().trim();
  if (!targetUrl) return null;
  const method = METHODS.includes(raw.method as WebLoadHttpMethod)
    ? (raw.method as WebLoadHttpMethod)
    : 'GET';
  let headers: Record<string, string> | undefined;
  if (raw.headers && typeof raw.headers === 'object') {
    headers = {};
    for (const [k, v] of Object.entries(raw.headers)) {
      if (k && v != null) headers[String(k)] = String(v);
    }
    if (!Object.keys(headers).length) headers = undefined;
  }
  const requests = normalizeRequests(raw.requests);
  const profile =
    raw.profile === 'advanced' || raw.profile === 'basic'
      ? raw.profile
      : requests && requests.length > 1
        ? 'advanced'
        : 'basic';
  return {
    targetUrl,
    method,
    headers,
    body: raw.body != null ? String(raw.body) : undefined,
    virtualUsers: clampInt(raw.virtualUsers, 10, 1, 100),
    durationSec: clampInt(raw.durationSec, 30, 5, 600),
    rampUpSec: clampInt(raw.rampUpSec, 5, 0, 120),
    maxErrorRatePct: clampInt(raw.maxErrorRatePct, 5, 0, 100),
    p95Ms: clampInt(raw.p95Ms, 2000, 50, 120_000),
    ...(() => {
      const p95 = clampInt(raw.p95Ms, 2000, 50, 120_000);
      const resolved = resolveLoadThresholds({
        maxErrorRatePct: clampInt(raw.maxErrorRatePct, 5, 0, 100),
        p50Ms: raw.p50Ms as number | undefined,
        p75Ms: raw.p75Ms as number | undefined,
        p90Ms: raw.p90Ms as number | undefined,
        p95Ms: p95,
        p99Ms: raw.p99Ms as number | undefined,
        avgMs: raw.avgMs as number | undefined,
        maxAvgLatencyMs: raw.maxAvgLatencyMs as number | undefined,
        maxAvgConnectMs: raw.maxAvgConnectMs as number | undefined,
        virtualUsers: clampInt(raw.virtualUsers, 10, 1, 100),
        durationSec: clampInt(raw.durationSec, 30, 5, 600),
      });
      return {
        p50Ms: clampInt(resolved.p50Ms, resolved.p50Ms, 50, 120_000),
        p75Ms: clampInt(resolved.p75Ms, resolved.p75Ms, 50, 120_000),
        p90Ms: clampInt(resolved.p90Ms, resolved.p90Ms, 50, 120_000),
        p99Ms: clampInt(resolved.p99Ms, defaultLoadP99Ms(p95), 50, 120_000),
        avgMs: clampInt(resolved.avgMs, resolved.avgMs, 50, 120_000),
        maxAvgLatencyMs: clampInt(
          resolved.avgLatencyMs,
          resolved.avgLatencyMs,
          10,
          120_000,
        ),
        maxAvgConnectMs: clampInt(
          resolved.avgConnectMs,
          resolved.avgConnectMs,
          10,
          120_000,
        ),
      };
    })(),
    useApiBase: Boolean(raw.useApiBase),
    requests,
    profile,
    requiresAuth: Boolean(raw.requiresAuth),
    swaggerUrl: raw.swaggerUrl ? String(raw.swaggerUrl).trim() : undefined,
    operationId: raw.operationId ? String(raw.operationId).trim() : undefined,
    operationTags: Array.isArray(raw.operationTags)
      ? raw.operationTags.map(String).filter(Boolean)
      : undefined,
    apiBaseUrl: raw.apiBaseUrl
      ? ensureLgdApiV1Base(String(raw.apiBaseUrl).trim()) || undefined
      : undefined,
  };
}

function buildSeed(): WebLoadTestCase[] {
  return [
    {
      id: 'load-portal-home',
      name: 'Portal home page',
      description: 'Basic · GET / with 10 VUs for 30s — public landing latency.',
      tags: ['web-load', 'portal', 'public', 'basic'],
      estimatedMinutes: 1,
      kind: 'web-load',
      source: 'seed',
      load: {
        targetUrl: '/',
        method: 'GET',
        virtualUsers: 10,
        durationSec: 30,
        rampUpSec: 5,
        maxErrorRatePct: 5,
        p95Ms: 2000,
        profile: 'basic',
      },
    },
    {
      id: 'load-portal-login',
      name: 'Login page',
      description: 'Basic · GET /login — auth entry under light concurrent load.',
      tags: ['web-load', 'portal', 'auth', 'login', 'basic'],
      estimatedMinutes: 1,
      kind: 'web-load',
      source: 'seed',
      load: {
        targetUrl: '/login',
        method: 'GET',
        virtualUsers: 15,
        durationSec: 30,
        rampUpSec: 5,
        maxErrorRatePct: 5,
        p95Ms: 2500,
        profile: 'basic',
      },
    },
    {
      id: 'load-portal-about',
      name: 'About us page',
      description: 'Basic · GET /about-us — static marketing page smoke load.',
      tags: ['web-load', 'portal', 'public', 'basic'],
      estimatedMinutes: 1,
      kind: 'web-load',
      source: 'seed',
      load: {
        targetUrl: '/about-us',
        method: 'GET',
        virtualUsers: 10,
        durationSec: 20,
        rampUpSec: 3,
        maxErrorRatePct: 5,
        p95Ms: 2000,
        profile: 'basic',
      },
    },
    {
      id: 'load-api-location',
      name: 'Location API health',
      description:
        'Basic · POST /location with {"key":"country"} — valid Location API contract (not countryId).',
      tags: ['web-load', 'api', 'basic'],
      estimatedMinutes: 1,
      kind: 'web-load',
      source: 'seed',
      load: {
        targetUrl: '/location',
        method: 'POST',
        useApiBase: true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{"key":"country"}',
        virtualUsers: 8,
        durationSec: 30,
        rampUpSec: 5,
        maxErrorRatePct: 5,
        p95Ms: 3000,
        profile: 'basic',
      },
    },
    {
      id: 'load-login-multi-def',
      name: 'Multiple login definitions',
      description:
        'Advanced · sequential GETs across login / role gate pages (/login, /buyer, /seller, /admin) to stress auth entry surfaces.',
      tags: ['web-load', 'portal', 'auth', 'login', 'advanced', 'multi'],
      estimatedMinutes: 2,
      kind: 'web-load',
      source: 'seed',
      load: {
        targetUrl: '/login',
        method: 'GET',
        virtualUsers: 12,
        durationSec: 40,
        rampUpSec: 8,
        maxErrorRatePct: 10,
        p95Ms: 3500,
        profile: 'advanced',
        requests: [
          { name: 'Login page', path: '/login', method: 'GET', thinkTimeMs: 300 },
          { name: 'Buyer gate', path: '/buyer', method: 'GET', thinkTimeMs: 250 },
          { name: 'Seller gate', path: '/seller', method: 'GET', thinkTimeMs: 250 },
          { name: 'Admin gate', path: '/admin', method: 'GET', thinkTimeMs: 200 },
        ],
      },
    },
    {
      id: 'load-customer-multi-get',
      name: 'Customer multi-GET journey',
      description:
        'Advanced · customer browse path: home → about → login → buyer catalog → cart (unauth redirects still measure page latency).',
      tags: ['web-load', 'portal', 'customer', 'buyer', 'advanced', 'multi'],
      estimatedMinutes: 2,
      kind: 'web-load',
      source: 'seed',
      load: {
        targetUrl: '/',
        method: 'GET',
        virtualUsers: 10,
        durationSec: 45,
        rampUpSec: 8,
        maxErrorRatePct: 12,
        p95Ms: 4000,
        profile: 'advanced',
        requests: [
          { name: 'Home', path: '/', method: 'GET', thinkTimeMs: 400 },
          { name: 'About', path: '/about-us', method: 'GET', thinkTimeMs: 300 },
          { name: 'Login', path: '/login', method: 'GET', thinkTimeMs: 300 },
          { name: 'Buyer products', path: '/buyer/products', method: 'GET', thinkTimeMs: 400 },
          { name: 'Buyer cart', path: '/buyer/cart', method: 'GET', thinkTimeMs: 250 },
        ],
      },
    },
    {
      id: 'load-login-stress',
      name: 'Login page stress',
      description:
        'Advanced · heavier concurrent GET /login (25 VUs) — auth page under pressure.',
      tags: ['web-load', 'portal', 'auth', 'login', 'advanced', 'stress'],
      estimatedMinutes: 2,
      kind: 'web-load',
      source: 'seed',
      load: {
        targetUrl: '/login',
        method: 'GET',
        virtualUsers: 25,
        durationSec: 45,
        rampUpSec: 10,
        maxErrorRatePct: 8,
        p95Ms: 4000,
        profile: 'advanced',
      },
    },
    {
      id: 'load-api-advanced',
      name: 'API advanced multi-call',
      description:
        'Advanced · Location cascade country → state → city (valid key/value bodies; no HEAD — API returns 500 on HEAD/GET).',
      tags: ['web-load', 'api', 'advanced', 'multi'],
      estimatedMinutes: 2,
      kind: 'web-load',
      source: 'seed',
      load: {
        targetUrl: '/location',
        method: 'POST',
        useApiBase: true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{"key":"country"}',
        virtualUsers: 10,
        durationSec: 40,
        rampUpSec: 8,
        maxErrorRatePct: 10,
        p95Ms: 3500,
        profile: 'advanced',
        requests: [
          {
            name: 'Location countries',
            path: '/location',
            method: 'POST',
            useApiBase: true,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: '{"key":"country"}',
            thinkTimeMs: 200,
            extractJsons: [
              {
                varName: 'locCountryId',
                jsonPath: '$.data.country[0].id',
              },
            ],
            extractJson: {
              varName: 'locCountryId',
              jsonPath: '$.data.country[0].id',
            },
          },
          {
            name: 'Location states',
            path: '/location',
            method: 'POST',
            useApiBase: true,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: '{"key":"state","value":"${locCountryId}"}',
            thinkTimeMs: 200,
            apiMappings: [
              {
                id: 'map-country-to-value',
                sourceVar: 'locCountryId',
                target: 'body',
                targetKey: 'value',
              },
            ],
            extractJsons: [
              {
                varName: 'locStateId',
                jsonPath: '$.data[0].id',
              },
            ],
            extractJson: {
              varName: 'locStateId',
              jsonPath: '$.data[0].id',
            },
          },
          {
            name: 'Location cities',
            path: '/location',
            method: 'POST',
            useApiBase: true,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: '{"key":"city","value":"${locStateId}"}',
            thinkTimeMs: 150,
            apiMappings: [
              {
                id: 'map-state-to-value',
                sourceVar: 'locStateId',
                target: 'body',
                targetKey: 'value',
              },
            ],
          },
        ],
      },
    },
  ];
}

function writeStore(cases: WebLoadTestCase[]) {
  ensureDir();
  writeFileSync(
    STORE_PATH,
    JSON.stringify({ version: SEED_VERSION, cases }, null, 2),
    'utf8',
  );
}

function readCases(): WebLoadTestCase[] {
  ensureDir();
  if (!existsSync(STORE_PATH)) {
    const seed = buildSeed();
    writeStore(seed);
    return seed;
  }
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as {
      version?: number;
      cases?: unknown[];
    };
    if (raw.version !== SEED_VERSION || !Array.isArray(raw.cases) || !raw.cases.length) {
      const seed = buildSeed();
      writeStore(seed);
      return seed;
    }
    const cases = raw.cases
      .map((item) => normalizeCase(item))
      .filter((c): c is WebLoadTestCase => !!c);
    if (!cases.length) {
      const seed = buildSeed();
      writeStore(seed);
      return seed;
    }
    return cases;
  } catch {
    const seed = buildSeed();
    writeStore(seed);
    return seed;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function normalizeCase(input: unknown): WebLoadTestCase | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<WebLoadTestCase> & { load?: Partial<WebLoadConfig> };
  const name = (raw.name || 'Untitled load test').toString().trim();
  let id = (raw.id || slugify(name) || `load-${Date.now()}`).toString().trim();
  id = id.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const load = normalizeLoad(raw.load);
  if (!load) return null;
  return {
    id,
    name,
    description: (raw.description || name).toString(),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : ['web-load'],
    estimatedMinutes: clampInt(raw.estimatedMinutes, 1, 1, 60),
    kind: 'web-load',
    source: raw.source === 'upload' || raw.source === 'claude' ? raw.source : 'seed',
    load,
  };
}

export function listWebLoadCases(): WebLoadTestCase[] {
  const cases = readCases();
  const consolidated = consolidateFragmentedSwaggerCases(cases);
  if (consolidated.changed) {
    writeStore(consolidated.cases);
    return consolidated.cases;
  }
  return cases;
}

/**
 * Convert per-API Swagger import cards into one main "Swagger · …" suite
 * with all APIs as internal request scenarios.
 */
export function consolidateFragmentedSwaggerCases(cases: WebLoadTestCase[]): {
  cases: WebLoadTestCase[];
  changed: boolean;
  suites: string[];
} {
  const fragments: WebLoadTestCase[] = [];
  const keep: WebLoadTestCase[] = [];

  for (const c of cases) {
    const isSwagger =
      Boolean(c.load.swaggerUrl) ||
      (c.tags || []).includes('swagger') ||
      /^swagger-/i.test(c.id);
    const isAlreadySuite =
      (c.load.requests?.length || 0) > 1 ||
      /^Swagger\s*·/i.test(c.name) ||
      (c.tags || []).includes('suite');
    const looksLikePerApi =
      isSwagger &&
      !isAlreadySuite &&
      (/^API load ·/i.test(c.name) ||
        /^swagger-(get|post|put|patch|delete|head)-/i.test(c.id));

    if (looksLikePerApi) fragments.push(c);
    else keep.push(c);
  }

  if (fragments.length < 2) {
    return { cases, changed: false, suites: [] };
  }

  const byUrl = new Map<string, WebLoadTestCase[]>();
  for (const c of fragments) {
    const key = (c.load.swaggerUrl || c.group || 'swagger').trim() || 'swagger';
    const list = byUrl.get(key) || [];
    list.push(c);
    byUrl.set(key, list);
  }

  const suites: string[] = [];
  const next = [...keep];

  for (const [swaggerUrl, group] of byUrl) {
    if (group.length < 2) {
      next.push(...group);
      continue;
    }

    // Prefer stable order from original array
    const requests = group.map((c) => {
      const stepName = c.name.replace(/^API load ·\s*/i, '').trim() || c.load.targetUrl;
      return {
        name: stepName.slice(0, 100),
        path: c.load.targetUrl,
        method: c.load.method,
        useApiBase: c.load.useApiBase ?? true,
        headers: c.load.headers || { Accept: 'application/json' },
        body: c.load.body,
        thinkTimeMs: 150,
      };
    });

    const first = group[0];
    const anyAuth = group.some((c) => c.load.requiresAuth);
    let title = 'API';
    try {
      const host = new URL(swaggerUrl).hostname.replace(/^api\./, '');
      title = host.split('.')[0] || 'API';
      title = title.charAt(0).toUpperCase() + title.slice(1);
    } catch {
      title = (first.group || 'API').replace(/^swagger:/i, '') || 'API';
    }
    // Prefer API title from first description if present
    if (first.group?.startsWith('swagger:')) {
      title = first.group.slice('swagger:'.length) || title;
    }

    const titleSlug = slugify(title) || 'api';
    const suiteId = `swagger-${titleSlug}`;
    const existingSuiteIdx = next.findIndex((c) => c.id === suiteId);

    const suite: WebLoadTestCase = {
      id: suiteId,
      name: `Swagger · ${title}`.slice(0, 120),
      description: [
        `Main Swagger load suite consolidated from ${group.length} imported APIs.`,
        swaggerUrl.startsWith('http') ? `Source: ${swaggerUrl}.` : '',
        `Auto load: ${first.load.virtualUsers || 10} VUs · ${first.load.durationSec || 30}s.`,
        anyAuth
          ? 'Includes auth-required APIs — credentials/token applied at run time.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      tags: [
        'web-load',
        'swagger',
        'api',
        'suite',
        ...(anyAuth ? ['auth'] : ['public']),
      ],
      estimatedMinutes: Math.max(
        2,
        Math.min(15, Math.ceil(group.length / 20)),
      ),
      kind: 'web-load',
      source: first.source === 'claude' ? 'claude' : 'upload',
      group: `swagger:${title}`,
      load: {
        targetUrl: first.load.targetUrl,
        method: first.load.method,
        useApiBase: true,
        headers: first.load.headers || { Accept: 'application/json' },
        body: first.load.body,
        virtualUsers: first.load.virtualUsers || 10,
        durationSec: first.load.durationSec || 30,
        rampUpSec: first.load.rampUpSec || 5,
        maxErrorRatePct: first.load.maxErrorRatePct || 10,
        p95Ms: first.load.p95Ms || 4000,
        p50Ms: first.load.p50Ms,
        p75Ms: first.load.p75Ms,
        p90Ms: first.load.p90Ms,
        p99Ms:
          first.load.p99Ms ||
          defaultLoadP99Ms(first.load.p95Ms || 4000, first.load.p99Ms),
        avgMs: first.load.avgMs,
        maxAvgLatencyMs: first.load.maxAvgLatencyMs,
        maxAvgConnectMs: first.load.maxAvgConnectMs,
        profile: 'advanced',
        requiresAuth: anyAuth,
        swaggerUrl: first.load.swaggerUrl || (swaggerUrl.startsWith('http') ? swaggerUrl : undefined),
        operationTags: Array.from(
          new Set(group.flatMap((c) => c.load.operationTags || [])),
        ).slice(0, 12),
        requests,
      },
    };

    if (existingSuiteIdx >= 0) {
      // Merge requests if suite already exists
      const existing = next[existingSuiteIdx];
      const seen = new Set(
        (existing.load.requests || []).map(
          (r) => `${(r.method || 'GET').toUpperCase()} ${r.path}`,
        ),
      );
      const merged = [...(existing.load.requests || [])];
      for (const r of requests) {
        const key = `${(r.method || 'GET').toUpperCase()} ${r.path}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(r);
        }
      }
      next[existingSuiteIdx] = {
        ...existing,
        ...suite,
        load: {
          ...suite.load,
          requests: merged,
        },
        description: suite.description,
      };
    } else {
      next.push(suite);
    }
    suites.push(suiteId);
  }

  return { cases: next, changed: true, suites };
}

export function listWebLoadMetas(): TestCaseMeta[] {
  return listWebLoadCases().map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    tags: c.tags,
    estimatedMinutes: c.estimatedMinutes,
    kind: 'web-load' as const,
    source: c.source,
  }));
}

export function getWebLoadCase(id: string): WebLoadTestCase | undefined {
  return listWebLoadCases().find((c) => c.id === id);
}

export function deleteWebLoadCase(id: string): boolean {
  const cases = listWebLoadCases();
  const next = cases.filter((c) => c.id !== id);
  if (next.length === cases.length) return false;
  writeStore(next);
  return true;
}

export function upsertWebLoadCase(input: unknown): WebLoadTestCase | null {
  const normalized = normalizeCase(input);
  if (!normalized) return null;
  const cases = listWebLoadCases();
  const idx = cases.findIndex((c) => c.id === normalized.id);
  if (idx >= 0) cases[idx] = normalized;
  else cases.push(normalized);
  writeStore(cases);
  return normalized;
}

export function normalizeWebLoadCases(
  input: unknown,
  source: 'claude' | 'upload' | 'seed' = 'claude',
): WebLoadTestCase[] {
  const root = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const list = Array.isArray(input)
    ? input
    : Array.isArray(root.cases)
      ? root.cases
      : [input];
  const out: WebLoadTestCase[] = [];
  for (const item of list) {
    const n = normalizeCase(
      item && typeof item === 'object' ? { ...(item as object), source } : item,
    );
    if (n) out.push({ ...n, source });
  }
  return out;
}

export function upsertWebLoadCases(
  cases: WebLoadTestCase[],
  source: 'claude' | 'upload' = 'claude',
): { added: string[]; replaced: string[]; cases: WebLoadTestCase[] } {
  const current = listWebLoadCases();
  const byId = new Map(current.map((c) => [c.id, c]));
  const added: string[] = [];
  const replaced: string[] = [];
  for (const raw of cases) {
    const n = normalizeCase({ ...raw, source });
    if (!n) continue;
    if (byId.has(n.id)) replaced.push(n.id);
    else added.push(n.id);
    byId.set(n.id, { ...n, source });
  }
  const next = Array.from(byId.values());
  writeStore(next);
  return { added, replaced, cases: next };
}

function joinBase(root: string, target: string): string {
  const base = root.trim().replace(/\/+$/, '');
  const pathPart = target.startsWith('/') ? target : `/${target}`;
  return `${base}${pathPart}`;
}

/** Resolve a single path against portal or API base. */
export function resolveLoadPathUrl(
  target: string,
  useApiBase: boolean | undefined,
  baseUrl: string,
  apiUrl?: string,
): string {
  const t = target.trim();
  if (/^https?:\/\//i.test(t)) return t.replace(/\/+$/, '') || t;
  const root = (useApiBase ? apiUrl || baseUrl : baseUrl).trim().replace(/\/+$/, '');
  return joinBase(root, t);
}

/** Effective API base for a load case (case override → run apiUrl). */
export function resolveCaseApiUrl(
  test: WebLoadTestCase,
  apiUrl?: string,
): string | undefined {
  const override = test.load.apiBaseUrl?.trim();
  if (override) {
    return ensureLgdApiV1Base(override) || undefined;
  }
  const fallback = apiUrl?.trim();
  return fallback ? ensureLgdApiV1Base(fallback) || undefined : undefined;
}

/** Resolve target URL for a run (absolute or relative to base/api). */
export function resolveLoadTargetUrl(
  test: WebLoadTestCase,
  baseUrl: string,
  apiUrl?: string,
): string {
  return resolveLoadPathUrl(
    test.load.targetUrl,
    test.load.useApiBase,
    baseUrl,
    resolveCaseApiUrl(test, apiUrl),
  );
}

/** Build absolute samplers for JMeter (single or advanced multi-request). */
export function resolveLoadSamplers(
  test: WebLoadTestCase,
  baseUrl: string,
  apiUrl?: string,
): ResolvedLoadSampler[] {
  const { load } = test;
  const effectiveApi = resolveCaseApiUrl(test, apiUrl);
  if (load.requests?.length) {
    return load.requests.map((r, i) => {
      const mapped = applyApiMappingsToStep(r);
      const method = mapped.method || load.method || 'GET';
      const useApi = mapped.useApiBase ?? load.useApiBase;
      const resolvedPath = applyParamsToPath(mapped, { mode: 'jmeter' });
      const url = resolveLoadPathUrl(resolvedPath, useApi, baseUrl, effectiveApi);
      const outgoing = resolveOutgoingBody({
        ...mapped,
        method,
        body: mapped.body != null ? mapped.body : i === 0 ? load.body : undefined,
        headers: mapped.headers || load.headers,
      });
      const headers = expandDynamicRecord(outgoing.headers, 'jmeter');
      const body = expandDynamicString(
        outgoing.bodyEncoding === 'base64'
          ? undefined
          : outgoing.formPairs?.length
            ? undefined
            : outgoing.body,
        'jmeter',
      );
      const formPairs = outgoing.formPairs?.map((p) => ({
        name: p.name,
        value: expandDynamicString(p.value, 'jmeter') || '',
      }));
      const extracts = listJsonExtracts(mapped);
      return {
        name: mapped.name || `${method} ${mapped.path}`,
        url,
        method,
        headers,
        body,
        multipart: outgoing.multipart,
        formPairs,
        thinkTimeMs: mapped.thinkTimeMs,
        extractJson: extracts[0],
        extractJsons: extracts.length ? extracts : undefined,
      };
    });
  }
  return [
    {
      name: `${load.method || 'GET'} ${load.targetUrl}`,
      url: resolveLoadTargetUrl(test, baseUrl, apiUrl),
      method: load.method || 'GET',
      headers: expandDynamicRecord(load.headers, 'jmeter'),
      body: expandDynamicString(load.body, 'jmeter'),
    },
  ];
}
