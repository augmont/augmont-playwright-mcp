import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type {
  TestCaseMeta,
  VaptCaseIntent,
  VaptCheckId,
  VaptConfig,
  VaptSeverity,
  VaptTestCase,
  WebLoadHttpMethod,
} from '@/lib/types';
import { VAPT_CATALOGUE_ATTACKS } from '@/lib/vapt-attacks';
import { normalizeVaptProfile } from '@/lib/vapt-profile';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'vapt-cases.json');
const SEED_VERSION = 7;

const METHODS: WebLoadHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
];

export const VAPT_CHECK_IDS: VaptCheckId[] = [
  'brute-force',
  'ddos-rate-limit',
  'sql-injection-surface',
  'xss-reflection',
  'csrf-surface',
  'rce-surface',
  'command-injection-surface',
  'directory-traversal',
  'file-upload-surface',
  'api-auth-bypass',
  'privilege-escalation',
  'session-hijacking',
  'mitm-tls',
  'ssrf-surface',
  'xxe-surface',
  'deserialization-surface',
  'api-abuse',
  'malware-upload-surface',
  'phishing-credential-surface',
  'zero-day-posture',
  // supporting / legacy
  'security-headers',
  'cookie-flags',
  'info-disclosure',
  'tls-url',
  'unauth-sensitive',
  'api-location',
  'cors-preflight',
  'cache-control',
  'api-method-tamper',
  'api-error-hygiene',
  'injection-surface',
];

const SEVERITIES: VaptSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

const DEFAULT_START_URL = '/login';

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function normalizeChecks(raw: unknown): VaptCheckId[] {
  if (!Array.isArray(raw)) return ['security-headers'];
  const out: VaptCheckId[] = [];
  for (const item of raw) {
    const id = String(item || '').trim() as VaptCheckId;
    if (VAPT_CHECK_IDS.includes(id) && !out.includes(id)) out.push(id);
  }
  return out.length ? out : ['security-headers'];
}

function normalizeStartUrl(raw: unknown): string {
  const s = String(raw || DEFAULT_START_URL).trim() || DEFAULT_START_URL;
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith('/') ? s : `/${s}`;
}

function normalizeIntent(raw: unknown): VaptCaseIntent {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'fail' || s === 'negative' || s === 'failure') return 'fail';
  return 'pass';
}

function normalizeVapt(raw: Partial<VaptConfig> | undefined): VaptConfig | null {
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
  const severityGate = SEVERITIES.includes(raw.severityGate as VaptSeverity)
    ? (raw.severityGate as VaptSeverity)
    : 'high';
  return {
    targetUrl,
    method,
    headers,
    body: raw.body != null ? String(raw.body) : undefined,
    useApiBase: Boolean(raw.useApiBase),
    startUrl: normalizeStartUrl(raw.startUrl),
    checks: normalizeChecks(raw.checks),
    severityGate,
    intent: normalizeIntent(raw.intent),
    profile: normalizeVaptProfile(raw.profile),
  };
}

function buildSeed(): VaptTestCase[] {
  const total = VAPT_CATALOGUE_ATTACKS.length;
  const hygieneCore: VaptCheckId[] = [
    'security-headers',
    'cookie-flags',
    'tls-url',
    'api-auth-bypass',
    'api-error-hygiene',
  ];
  return [
    {
      id: 'vapt-login-main-suite',
      name: 'Login — main VAPT suite (Higher · Pass)',
      description: `Main pass-case starts on /login, then runs ${total} internal attack scenarios at Higher depth (baseline → AI multi → fail-level on pass). Safe hygiene probes only — no exploit payloads.`,
      tags: ['vapt', 'login', 'main', 'suite', 'catalogue', 'pass', 'higher'],
      estimatedMinutes: 8,
      kind: 'vapt',
      source: 'seed',
      group: 'login-main',
      suiteMode: 'combined',
      vapt: {
        startUrl: '/login',
        targetUrl: '/location',
        method: 'POST',
        useApiBase: true,
        headers: { 'Content-Type': 'application/json' },
        body: '{"key":"country"}',
        checks: [...VAPT_CATALOGUE_ATTACKS],
        severityGate: 'high',
        intent: 'pass',
        profile: 'higher',
      },
    },
    {
      id: 'vapt-login-fail-hygiene',
      name: 'Login — fail-case hygiene suite (Advanced)',
      description:
        'Fail-case oriented suite: probes auth bypass, error hygiene, headers, and cookie flags at Advanced depth (baseline + AI multi) to surface control gaps.',
      tags: ['vapt', 'login', 'fail', 'advanced', 'hygiene'],
      estimatedMinutes: 4,
      kind: 'vapt',
      source: 'seed',
      group: 'login-fail',
      suiteMode: 'single',
      vapt: {
        startUrl: '/login',
        targetUrl: '/location',
        method: 'POST',
        useApiBase: true,
        headers: { 'Content-Type': 'application/json' },
        body: '{"key":"country"}',
        checks: hygieneCore,
        severityGate: 'medium',
        intent: 'fail',
        profile: 'advanced',
      },
    },
  ];
}

function writeStore(cases: VaptTestCase[]) {
  ensureDir();
  writeFileSync(
    STORE_PATH,
    JSON.stringify({ version: SEED_VERSION, cases }, null, 2),
    'utf8',
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function normalizeCase(input: unknown): VaptTestCase | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<VaptTestCase> & { vapt?: Partial<VaptConfig> };
  const name = (raw.name || 'Untitled VAPT test').toString().trim();
  let id = (raw.id || slugify(name) || `vapt-${Date.now()}`).toString().trim();
  id = id.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  if (!id.startsWith('vapt-')) id = `vapt-${id}`;
  const vapt = normalizeVapt(raw.vapt);
  if (!vapt) return null;
  const source =
    raw.source === 'upload' ||
    raw.source === 'claude' ||
    raw.source === 'manual' ||
    raw.source === 'seed'
      ? raw.source
      : 'seed';
  const intent = vapt.intent || 'pass';
  const profile = vapt.profile || 'higher';
  let tags = Array.isArray(raw.tags) ? raw.tags.map(String) : ['vapt'];
  if (!tags.includes('vapt')) tags = ['vapt', ...tags];
  if (!tags.includes(intent)) tags = [...tags, intent];
  if (!tags.includes(profile)) tags = [...tags, profile];

  return {
    id,
    name,
    description: (raw.description || name).toString(),
    tags,
    estimatedMinutes: clampInt(raw.estimatedMinutes, 1, 1, 120),
    kind: 'vapt',
    source,
    group: raw.group != null ? String(raw.group) : undefined,
    suiteMode:
      raw.suiteMode === 'combined' || raw.suiteMode === 'single'
        ? raw.suiteMode
        : undefined,
    vapt: { ...vapt, intent, profile },
  };
}

function readCases(): VaptTestCase[] {
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
      .filter((c): c is VaptTestCase => !!c);
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

export function listVaptCases(): VaptTestCase[] {
  return readCases();
}

export function listVaptMetas(): TestCaseMeta[] {
  return listVaptCases().map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    tags: c.tags,
    estimatedMinutes: c.estimatedMinutes,
    kind: 'vapt' as const,
    source: c.source,
  }));
}

export function getVaptCase(id: string): VaptTestCase | undefined {
  return listVaptCases().find((c) => c.id === id);
}

export function deleteVaptCase(id: string): boolean {
  const cases = listVaptCases();
  const next = cases.filter((c) => c.id !== id);
  if (next.length === cases.length) return false;
  writeStore(next);
  return true;
}

export function upsertVaptCase(input: unknown): VaptTestCase | null {
  const normalized = normalizeCase(input);
  if (!normalized) return null;
  const cases = listVaptCases();
  const idx = cases.findIndex((c) => c.id === normalized.id);
  if (idx >= 0) cases[idx] = normalized;
  else cases.push(normalized);
  writeStore(cases);
  return normalized;
}

export type VaptCaseSource = 'claude' | 'upload' | 'seed' | 'manual';

export function normalizeVaptCases(
  input: unknown,
  source: VaptCaseSource = 'claude',
): VaptTestCase[] {
  const root = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const list = Array.isArray(input)
    ? input
    : Array.isArray(root.cases)
      ? root.cases
      : [input];
  const out: VaptTestCase[] = [];
  for (const item of list) {
    const n = normalizeCase(
      item && typeof item === 'object' ? { ...(item as object), source } : item,
    );
    if (n) out.push({ ...n, source });
  }
  return out;
}

export function upsertVaptCases(
  cases: VaptTestCase[],
  source: VaptCaseSource = 'claude',
): { added: string[]; replaced: string[]; cases: VaptTestCase[] } {
  const current = listVaptCases();
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

export function resolveVaptTargetUrl(
  test: VaptTestCase,
  baseUrl: string,
  apiUrl?: string,
): string {
  const target = test.vapt.targetUrl.trim();
  if (/^https?:\/\//i.test(target)) return target.replace(/\/+$/, '') || target;
  const root = (test.vapt.useApiBase ? apiUrl || baseUrl : baseUrl)
    .trim()
    .replace(/\/+$/, '');
  const pathPart = target.startsWith('/') ? target : `/${target}`;
  return `${root}${pathPart}`;
}

/** MCP evidence browser start URL — defaults to portal /login */
export function resolveVaptStartUrl(test: VaptTestCase, baseUrl: string): string {
  const start = (test.vapt.startUrl || '/login').trim() || '/login';
  if (/^https?:\/\//i.test(start)) return start.replace(/\/+$/, '') || start;
  const root = baseUrl.trim().replace(/\/+$/, '');
  const pathPart = start.startsWith('/') ? start : `/${start}`;
  return `${root}${pathPart}`;
}
