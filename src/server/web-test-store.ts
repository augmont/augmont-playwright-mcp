import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { TestCaseMeta, WebFlowStep, WebTestCase } from '@/lib/types';
import { buildSignupLoginTest } from '@/lib/test-registry';
import { buildSeedWebTestCases } from '@/server/web-test-seed';
import { resolveExpectation } from '@/lib/test-expectation';
import { ensureCombinedSuites } from '@/lib/test-expectation';
import type { FlowChartNode } from '@/lib/flow-chart';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'web-test-cases.json');
/** Bump when seed suites change so local data/web-test-cases.json is refreshed. */
const SEED_VERSION = 12;

export type UpsertResult = {
  added: string[];
  replaced: string[];
  cases: WebTestCase[];
};

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function writeStore(cases: WebTestCase[]) {
  ensureDir();
  writeFileSync(
    STORE_PATH,
    JSON.stringify({ version: SEED_VERSION, cases }, null, 2),
    'utf8',
  );
}

function readRaw(): WebTestCase[] {
  ensureDir();
  if (!existsSync(STORE_PATH)) {
    const seed = buildSeedWebTestCases();
    writeStore(seed);
    return seed;
  }
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as {
      version?: number;
      cases?: WebTestCase[];
    };
    // Refresh built-in seeds when version bumps (keeps Claude/upload custom ids)
    if (raw.version !== SEED_VERSION) {
      const seed = buildSeedWebTestCases();
      const seedIds = new Set(seed.map((c) => c.id));
      const custom = (raw.cases || []).filter(
        (c) =>
          (c.source === 'claude' || c.source === 'upload') && !seedIds.has(c.id),
      );
      const merged = ensureCombinedSuites([...seed, ...custom]);
      writeStore(merged);
      return merged;
    }
    if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
      const seed = buildSeedWebTestCases();
      writeStore(seed);
      return seed;
    }
    // Merge legacy pairs + rebuild weak negatives (Positive ≠ Negative)
    const merged = ensureCombinedSuites(raw.cases);
    const changed =
      merged.length !== raw.cases.length ||
      merged.some((c, i) => {
        const prev = raw.cases![i];
        if (!prev || c.id !== prev.id || c.suiteMode !== prev.suiteMode) return true;
        return (
          JSON.stringify(c.negativeSteps || []) !==
            JSON.stringify(prev.negativeSteps || []) ||
          JSON.stringify(c.positiveSteps || []) !==
            JSON.stringify(prev.positiveSteps || [])
        );
      });
    if (changed) {
      writeStore(merged);
      return merged;
    }
    return raw.cases;
  } catch {
    const seed = buildSeedWebTestCases();
    writeStore(seed);
    return seed;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function normalizeStep(raw: Partial<WebFlowStep>, index: number): WebFlowStep | null {
  const action = raw.action;
  if (
    action !== 'goto' &&
    action !== 'click' &&
    action !== 'fill' &&
    action !== 'assertVisible' &&
    action !== 'assertUrl' &&
    action !== 'wait' &&
    action !== 'loginRole' &&
    action !== 'ensureBuyer'
  ) {
    return null;
  }
  const id = (raw.id || `step-${index + 1}`).toString().trim() || `step-${index + 1}`;
  const label = (raw.label || id).toString().trim() || id;
  return {
    id,
    label,
    action,
    url: raw.url?.toString(),
    selector: raw.selector?.toString(),
    value: raw.value?.toString(),
    text: raw.text?.toString(),
    timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : undefined,
  };
}

/** Normalize Claude / upload payloads into WebTestCase[]. */
export function normalizeWebTestCases(
  input: unknown,
  source: 'claude' | 'upload' | 'seed' = 'claude',
): WebTestCase[] {
  const list = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { cases?: unknown }).cases)
      ? (input as { cases: unknown[] }).cases
      : input && typeof input === 'object' && (input as { id?: string }).id
        ? [input]
        : [];

  const out: WebTestCase[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<WebTestCase> & { steps?: unknown[] };
    const name = (raw.name || 'Untitled flow').toString().trim();
    let id = (raw.id || slugify(name) || `web-flow-${Date.now()}`).toString().trim();
    id = id.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    if (!id || id === 'signup-login' || id === 'signup-all') {
      id = `flow-${slugify(name) || Date.now()}`;
    }

    const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
    const positiveRaw = Array.isArray(raw.positiveSteps) ? raw.positiveSteps : null;
    const negativeRaw = Array.isArray(raw.negativeSteps) ? raw.negativeSteps : null;

    const steps = stepsRaw
      .map((s, i) => normalizeStep((s || {}) as Partial<WebFlowStep>, i))
      .filter((s): s is WebFlowStep => !!s);

    const positiveSteps = positiveRaw
      ? positiveRaw
          .map((s, i) => normalizeStep((s || {}) as Partial<WebFlowStep>, i))
          .filter((s): s is WebFlowStep => !!s)
      : undefined;
    const negativeSteps = negativeRaw
      ? negativeRaw
          .map((s, i) => normalizeStep((s || {}) as Partial<WebFlowStep>, i))
          .filter((s): s is WebFlowStep => !!s)
      : undefined;

    const effectiveSteps = positiveSteps?.length ? positiveSteps : steps;
    if (effectiveSteps.length === 0) continue;

    const role =
      raw.role === 'buyer' ||
      raw.role === 'seller' ||
      raw.role === 'admin' ||
      raw.role === 'public'
        ? raw.role
        : 'public';

    const suiteMode =
      raw.suiteMode === 'combined' ||
      (positiveSteps && negativeSteps && negativeSteps.length > 0)
        ? 'combined'
        : raw.suiteMode === 'single'
          ? 'single'
          : undefined;

    const expectation =
      suiteMode === 'combined'
        ? undefined
        : resolveExpectation({
            expectation: raw.expectation,
            tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
            name,
            id,
          });

    let tags = Array.isArray(raw.tags)
      ? raw.tags.map(String)
      : ['web', 'claude', role];
    tags = tags.filter((t) => !/^(positive|negative)$/i.test(t.trim()));
    if (suiteMode === 'combined') {
      if (!tags.some((t) => /combined-suite/i.test(t))) tags = [...tags, 'combined-suite'];
    } else if (expectation) {
      tags = [...tags, expectation];
    }

    const pairId =
      (raw.pairId || '').toString().trim() ||
      id.replace(/-(positive|negative)$/i, '') ||
      undefined;

    const flowChart = Array.isArray(raw.flowChart)
      ? (raw.flowChart as FlowChartNode[])
      : undefined;

    out.push({
      id,
      name,
      description: (raw.description || name).toString(),
      tags,
      estimatedMinutes:
        typeof raw.estimatedMinutes === 'number' && raw.estimatedMinutes > 0
          ? raw.estimatedMinutes
          : Math.max(2, Math.ceil(effectiveSteps.length / 2)),
      kind: 'web-flow',
      role,
      steps: effectiveSteps,
      source,
      group: raw.group?.toString().trim() || undefined,
      expectation,
      pairId,
      suiteMode,
      positiveSteps: positiveSteps?.length ? positiveSteps : suiteMode === 'combined' ? effectiveSteps : undefined,
      negativeSteps: negativeSteps?.length ? negativeSteps : undefined,
      flowChart: flowChart as unknown[] | undefined,
    });
  }
  return out;
}

export function listWebFlowCases(): WebTestCase[] {
  return readRaw();
}

export function getWebFlowCase(id: string): WebTestCase | undefined {
  return readRaw().find((c) => c.id === id);
}

/** Built-in signup suite + stored web-flow cases (for /tests list). */
export function listAllWebTestMetas(countryCount?: number): TestCaseMeta[] {
  const signup = {
    ...buildSignupLoginTest(countryCount),
    role: 'public' as const,
  };
  const flows = listWebFlowCases().map(
    ({ steps: _s, positiveSteps: _p, negativeSteps: _n, flowChart: _f, ...meta }) => meta,
  );
  return [signup, ...flows];
}

export function listWebTestMetasByRole(
  role: 'public' | 'buyer' | 'seller' | 'admin',
  countryCount?: number,
): TestCaseMeta[] {
  return listAllWebTestMetas(countryCount).filter((c) => (c.role || 'public') === role);
}

export function upsertWebTestCases(
  incoming: WebTestCase[],
  source: 'claude' | 'upload' = 'claude',
): UpsertResult {
  const current = readRaw();
  const byId = new Map(current.map((c) => [c.id, c]));
  const added: string[] = [];
  const replaced: string[] = [];

  for (const raw of incoming) {
    const next: WebTestCase = { ...raw, source, kind: 'web-flow' };
    // Drop legacy separate polarity rows for this suite base
    const base = (next.pairId || next.id).replace(/-(positive|negative)$/i, '');
    for (const key of [...byId.keys()]) {
      const existing = byId.get(key);
      if (!existing) continue;
      if (key === next.id) continue;
      const otherBase = (existing.pairId || existing.id).replace(
        /-(positive|negative)$/i,
        '',
      );
      if (
        otherBase === base &&
        (existing.suiteMode !== 'combined' ||
          /-(positive|negative)$/i.test(existing.id))
      ) {
        byId.delete(key);
      }
    }

    if (byId.has(next.id)) {
      replaced.push(next.id);
    } else {
      added.push(next.id);
    }
    byId.set(next.id, next);
  }

  const cases = ensureCombinedSuites(Array.from(byId.values()));
  writeStore(cases);
  return { added, replaced, cases };
}

export function deleteWebFlowCase(id: string): boolean {
  const current = readRaw();
  const next = current.filter((c) => c.id !== id);
  if (next.length === current.length) return false;
  writeStore(next);
  return true;
}

export function resetWebFlowCasesToSeed(): WebTestCase[] {
  const seed = buildSeedWebTestCases();
  writeStore(seed);
  return seed;
}
