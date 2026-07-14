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
    let extractJson: WebLoadRequestStep['extractJson'];
    const rawExtract = (r as { extractJson?: unknown }).extractJson;
    if (rawExtract && typeof rawExtract === 'object') {
      const ex = rawExtract as {
        varName?: unknown;
        jsonPath?: unknown;
        defaultValue?: unknown;
      };
      const varName = String(ex.varName || '').trim();
      const jsonPath = String(ex.jsonPath || '').trim();
      if (varName && jsonPath) {
        extractJson = {
          varName,
          jsonPath,
          defaultValue:
            ex.defaultValue != null ? String(ex.defaultValue) : undefined,
        };
      }
    }
    out.push({
      name: r.name != null ? String(r.name) : undefined,
      path: pathStr,
      method,
      headers,
      body: r.body != null ? String(r.body) : undefined,
      useApiBase: Boolean(r.useApiBase),
      thinkTimeMs:
        r.thinkTimeMs != null ? clampInt(r.thinkTimeMs, 0, 0, 30_000) : undefined,
      extractJson,
    });
  }
  return out.length ? out : undefined;
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
    useApiBase: Boolean(raw.useApiBase),
    requests,
    profile,
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
  return readCases();
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
    apiUrl,
  );
}

/** Build absolute samplers for JMeter (single or advanced multi-request). */
export function resolveLoadSamplers(
  test: WebLoadTestCase,
  baseUrl: string,
  apiUrl?: string,
): ResolvedLoadSampler[] {
  const { load } = test;
  if (load.requests?.length) {
    return load.requests.map((r, i) => {
      const method = r.method || load.method || 'GET';
      const useApi = r.useApiBase ?? load.useApiBase;
      const url = resolveLoadPathUrl(r.path, useApi, baseUrl, apiUrl);
      return {
        name: r.name || `${method} ${r.path}`,
        url,
        method,
        headers: r.headers || load.headers,
        body: r.body != null ? r.body : i === 0 ? load.body : undefined,
        thinkTimeMs: r.thinkTimeMs,
        extractJson: r.extractJson,
      };
    });
  }
  return [
    {
      name: `${load.method || 'GET'} ${load.targetUrl}`,
      url: resolveLoadTargetUrl(test, baseUrl, apiUrl),
      method: load.method || 'GET',
      headers: load.headers,
      body: load.body,
    },
  ];
}
