import type { WebFlowStep, WebTestCase } from '@/lib/types';
import {
  branchedFlowToPolaritySteps,
  mergePairIntoBranchedChart,
  type FlowChartNode,
} from '@/lib/flow-chart';

export type TestExpectation = 'positive' | 'negative';

/** Resolve polarity from explicit field, tags, id, or name. Defaults to positive. */
export function resolveExpectation(c: {
  expectation?: string | null;
  tags?: string[] | null;
  name?: string | null;
  id?: string | null;
  suiteMode?: string | null;
}): TestExpectation {
  if (c.expectation === 'positive' || c.expectation === 'negative') {
    return c.expectation;
  }
  if (c.suiteMode === 'combined') return 'positive';
  const hay = [...(c.tags || []), c.name || '', c.id || ''].join(' ').toLowerCase();
  if (
    /\bnegative\b/.test(hay) ||
    /\b(invalid|unauthorized|error[- ]?path|fail(?:ure)?)\b/.test(hay)
  ) {
    return 'negative';
  }
  if (/\bpositive\b/.test(hay) || /-positive$/.test((c.id || '').toLowerCase())) {
    return 'positive';
  }
  return 'positive';
}

export function stripExpectationSuffix(id: string): string {
  return id
    .replace(/-(positive|negative)$/i, '')
    .replace(/_(positive|negative)$/i, '')
    .replace(/-(pos|neg)$/i, '');
}

export function stripExpectationFromName(name: string): string {
  return name
    .replace(/\s*[\[(]?\s*(positive|negative)\s*[\])]?\s*$/i, '')
    .replace(/\s*[-–—]\s*(positive|negative)\s*$/i, '')
    .trim();
}

export function expectationId(baseId: string, expectation: TestExpectation): string {
  const base = stripExpectationSuffix(baseId || 'flow') || 'flow';
  return `${base}-${expectation}`;
}

/** Apply expectation field + tags + consistent id/name suffixes (legacy separate cases). */
export function withExpectation(
  c: WebTestCase,
  expectation: TestExpectation,
  opts?: { pairId?: string; group?: string },
): WebTestCase {
  const baseName = stripExpectationFromName(c.name || 'Untitled flow');
  const baseId = stripExpectationSuffix(c.id || 'flow');
  const tags = [
    ...(c.tags || []).filter(
      (t) => !/^(positive|negative|combined-suite)$/i.test(String(t).trim()),
    ),
    expectation,
  ];
  const pairId = opts?.pairId || c.pairId || baseId;
  const group = opts?.group ?? c.group ?? baseName;
  return {
    ...c,
    id: expectationId(baseId, expectation),
    name: `${baseName} (${expectation === 'positive' ? 'Positive' : 'Negative'})`,
    expectation,
    pairId,
    group: group || undefined,
    tags,
    suiteMode: 'single',
  };
}

function mutateFillsForNegative(steps: WebFlowStep[]): WebFlowStep[] {
  return steps.map((s) => {
    if (s.action !== 'fill') return s;
    const v = s.value || '';
    const looksSecret =
      /pass|otp|pin|secret/i.test(s.label || '') ||
      /pass|password/i.test(s.selector || '') ||
      /pass/i.test(s.text || '');
    const looksEmail =
      /@/.test(v) || /email|mobile|user/i.test(`${s.label || ''}${s.selector || ''}`);
    if (looksSecret) {
      return { ...s, value: 'WrongPass!999', label: s.label || 'Enter invalid password' };
    }
    if (looksEmail || !v.trim()) {
      return {
        ...s,
        value: v.includes('@') ? 'invalid-user@example.invalid' : 'not-an-email',
        label: s.label || 'Enter invalid email / mobile',
      };
    }
    return { ...s, value: `invalid-${v}`, label: s.label || 'Enter invalid value' };
  });
}

function stepKey(s: WebFlowStep): string {
  return [s.action, s.label, s.selector || '', s.text || '', s.url || '', s.value || '']
    .join('|')
    .toLowerCase();
}

function isGenericNegAssert(s: WebFlowStep): boolean {
  return (
    s.action === 'assertVisible' &&
    (/assert error \/ invalid feedback/i.test(s.label || '') ||
      /^invalid$/i.test((s.text || '').trim()))
  );
}

/** True when negative is basically the happy path + a stub error assert. */
export function isWeakNegativePair(
  positive: WebFlowStep[],
  negative: WebFlowStep[],
): boolean {
  if (!negative.length) return true;
  if (!positive.length) return false;
  let shared = 0;
  const lim = Math.min(positive.length, negative.length);
  for (let i = 0; i < lim; i++) {
    if (stepKey(positive[i]!) === stepKey(negative[i]!)) shared += 1;
    else break;
  }
  const uniqueNeg = negative.filter(
    (s) => !positive.some((p) => stepKey(p) === stepKey(s)),
  );
  const onlyGeneric =
    uniqueNeg.length <= 1 &&
    uniqueNeg.every((s) => isGenericNegAssert(s) || s.action === 'wait');
  return shared / Math.max(positive.length, 1) >= 0.75 || onlyGeneric;
}

function pickGuardedPath(steps: WebFlowStep[], role?: string): string {
  for (const s of steps) {
    if (s.action !== 'goto' || !s.url) continue;
    const u = s.url;
    if (/\/(buyer|admin|seller|wishlist|cart|orders|my-account)/i.test(u)) return u;
  }
  if (role === 'admin') return '/admin';
  if (role === 'seller') return '/seller';
  if (role === 'buyer') return '/buyer/wishlist';
  return '/buyer';
}

function errorAsserts(pageHint?: string): WebFlowStep[] {
  const asserts: WebFlowStep[] = [
    {
      id: 'step-neg-error',
      label: 'Assert error / invalid feedback is shown',
      action: 'assertVisible',
      text: 'Invalid',
      timeoutMs: 8000,
    },
  ];
  if (pageHint) {
    asserts.push({
      id: 'step-neg-stay',
      label: `Still on ${pageHint} (success path blocked)`,
      action: 'assertUrl',
      url: pageHint,
      timeoutMs: 8000,
    });
  }
  return asserts;
}

/**
 * Build a real Negative path from Positive steps — not a clone of the happy path.
 */
export function buildDistinctNegativeSteps(
  positive: WebFlowStep[],
  opts?: { role?: string },
): WebFlowStep[] {
  const pos = positive || [];
  const role = opts?.role;

  const firstFillIdx = pos.findIndex((s) => s.action === 'fill');
  if (firstFillIdx >= 0) {
    const prefix = pos.slice(0, firstFillIdx).filter((s) => !isGenericNegAssert(s));
    const fills = mutateFillsForNegative(pos.filter((s) => s.action === 'fill'));
    const afterFill = pos.slice(firstFillIdx + 1);
    const submit = afterFill.find(
      (s) =>
        s.action === 'click' &&
        /login|sign\s*in|submit|continue|apply|save|confirm|next|send|request|otp/i.test(
          `${s.label || ''} ${s.text || ''}`,
        ),
    );
    const pageHint =
      prefix.find((s) => s.action === 'goto')?.url ||
      (/login|forgot/i.test(prefix.map((s) => `${s.url || ''}${s.label || ''}`).join(' '))
        ? '/login'
        : undefined);
    const out: WebFlowStep[] = [
      ...prefix,
      ...fills.map((s, i) => ({ ...s, id: s.id || `step-neg-fill-${i + 1}` })),
    ];
    if (submit) {
      out.push({
        ...submit,
        id: 'step-neg-submit',
        label: submit.label || 'Submit invalid form',
      });
    }
    out.push(...errorAsserts(pageHint || '/login'));
    return out;
  }

  const hasAuth = pos.some(
    (s) => s.action === 'loginRole' || s.action === 'ensureBuyer',
  );
  const guarded = pickGuardedPath(pos, role);

  if (hasAuth) {
    return [
      {
        id: 'step-neg-goto-guarded',
        label: `Open ${guarded} without login (unauthorized)`,
        action: 'goto',
        url: guarded,
      },
      {
        id: 'step-neg-assert-login',
        label: 'Assert redirected to login / auth required',
        action: 'assertUrl',
        url: '/login',
        timeoutMs: 10000,
      },
      {
        id: 'step-neg-assert-login-ui',
        label: 'Assert login form is visible',
        action: 'assertVisible',
        text: 'Login',
        timeoutMs: 8000,
      },
    ];
  }

  const actionClick = [...pos]
    .reverse()
    .find(
      (s) =>
        s.action === 'click' &&
        /add to (cart|wishlist)|wishlist|apply|filter|buy|checkout|remove|submit/i.test(
          `${s.label || ''} ${s.text || ''}`,
        ),
    );

  if (actionClick) {
    const targetUrl =
      pos.find((s) =>
        s.action === 'goto' && /buyer|product|cart|wishlist/i.test(s.url || ''),
      )?.url || guarded;
    return [
      {
        id: 'step-neg-goto-target',
        label: `Open ${targetUrl} without completing happy path`,
        action: 'goto',
        url: targetUrl,
      },
      {
        id: 'step-neg-attempt-action',
        label: `Attempt “${actionClick.text || actionClick.label}” without valid session/input`,
        action: 'click',
        selector: actionClick.selector,
        text: actionClick.text,
      },
      {
        id: 'step-neg-assert-blocked',
        label: 'Assert success outcome is blocked (login or error)',
        action: 'assertVisible',
        text: 'Login',
        timeoutMs: 8000,
      },
      {
        id: 'step-neg-assert-url',
        label: 'Assert not on happy-path success URL',
        action: 'assertUrl',
        url: '/login',
        timeoutMs: 8000,
      },
    ];
  }

  return [
    {
      id: 'step-neg-goto-protected',
      label: `Open protected path ${guarded} (expect deny)`,
      action: 'goto',
      url: guarded,
    },
    {
      id: 'step-neg-assert-denied',
      label: 'Assert login / unauthorized (not the happy destination)',
      action: 'assertUrl',
      url: '/login',
      timeoutMs: 10000,
    },
    {
      id: 'step-neg-login-visible',
      label: 'Assert login UI visible',
      action: 'assertVisible',
      text: 'Login',
      timeoutMs: 8000,
    },
  ];
}

/** Build the opposite polarity case when AI returned only one (merge input only). */
export function synthesizeOppositeCase(source: WebTestCase): WebTestCase {
  const current = resolveExpectation(source);
  const opposite: TestExpectation = current === 'positive' ? 'negative' : 'positive';
  const baseId = stripExpectationSuffix(source.id);
  const baseName = stripExpectationFromName(source.name);
  const pairId = source.pairId || baseId;
  const group = source.group || baseName;

  let steps: WebFlowStep[];
  if (opposite === 'negative') {
    const sourcePos = source.positiveSteps || source.steps || [];
    steps = buildDistinctNegativeSteps(sourcePos, { role: source.role });
  } else {
    steps = (source.positiveSteps || source.steps || []).filter(
      (s) => !isGenericNegAssert(s),
    );
  }

  return withExpectation(
    {
      ...source,
      id: expectationId(baseId, opposite),
      name: baseName,
      description:
        opposite === 'negative'
          ? `Negative path for ${baseName}: invalid/unauthorized behaviour must be handled.`
          : `Positive path for ${baseName}: happy-path success behaviour.`,
      steps,
      estimatedMinutes: Math.max(2, Math.ceil(steps.length / 2)),
    },
    opposite,
    { pairId, group },
  );
}

function suiteBucketKey(c: WebTestCase): string {
  const pair = (c.pairId || '').trim();
  if (pair) return pair.toLowerCase();
  const group = (c.group || '').trim();
  if (group) return `grp:${group.toLowerCase()}`;
  return stripExpectationSuffix(c.id).toLowerCase() || c.id.toLowerCase();
}

/** Steps for a run branch from a combined (or legacy) case. */
export function resolveSuiteBranchSteps(
  test: WebTestCase,
  branch: TestExpectation = 'positive',
): WebFlowStep[] {
  if (test.suiteMode === 'combined' || test.positiveSteps || test.negativeSteps) {
    if (branch === 'negative') {
      return (
        test.negativeSteps ||
        (Array.isArray(test.flowChart)
          ? branchedFlowToPolaritySteps(test.flowChart as FlowChartNode[]).negative
          : test.steps) ||
        []
      );
    }
    return test.positiveSteps || test.steps || [];
  }
  return test.steps || [];
}

/** Build one combined suite from positive + negative (or synthesize missing/weak side). */
export function buildCombinedSuite(
  positiveIn: WebTestCase,
  negativeIn?: WebTestCase | null,
  opts?: { forceNewNegative?: boolean },
): WebTestCase {
  const positive = positiveIn;
  const posSteps = positive.positiveSteps || positive.steps || [];
  let negSteps =
    negativeIn?.negativeSteps || negativeIn?.steps || positive.negativeSteps || [];

  if (
    opts?.forceNewNegative ||
    !negSteps.length ||
    isWeakNegativePair(posSteps, negSteps)
  ) {
    negSteps = buildDistinctNegativeSteps(posSteps, { role: positive.role });
  }

  const baseId =
    stripExpectationSuffix(positive.pairId || positive.id) ||
    stripExpectationSuffix(negativeIn?.id || '') ||
    'flow';
  const baseName =
    stripExpectationFromName(positive.name) ||
    stripExpectationFromName(negativeIn?.name || '') ||
    'Untitled suite';
  const group = positive.group || negativeIn?.group || baseName;

  const posCase: WebTestCase = { ...positive, steps: posSteps };
  const negCase: WebTestCase = {
    ...(negativeIn || positive),
    id: `${baseId}-negative`,
    steps: negSteps,
    expectation: 'negative',
  };

  const flowChart = mergePairIntoBranchedChart(posCase, negCase);
  const split = branchedFlowToPolaritySteps(flowChart);
  const positiveSteps = split.positive.length ? split.positive : posSteps;
  const negativeSteps = split.negative.length ? split.negative : negSteps;

  const tags = [
    ...new Set(
      [
        ...(positive.tags || []),
        ...(negativeIn?.tags || []),
        'web',
        'combined-suite',
      ]
        .map(String)
        .filter((t) => !/^(positive|negative)$/i.test(t.trim())),
    ),
  ];

  return {
    ...positive,
    id: baseId,
    name: baseName,
    description:
      positive.description ||
      negativeIn?.description ||
      `Combined suite: Positive + Negative for ${baseName}`,
    tags,
    estimatedMinutes: Math.max(
      positive.estimatedMinutes || 2,
      negativeIn?.estimatedMinutes || 2,
      Math.ceil((positiveSteps.length + negativeSteps.length) / 3),
    ),
    kind: 'web-flow',
    role: positive.role || negativeIn?.role || 'public',
    source: positive.source || negativeIn?.source,
    group,
    pairId: baseId,
    suiteMode: 'combined',
    expectation: undefined,
    steps: positiveSteps,
    positiveSteps,
    negativeSteps,
    flowChart: flowChart as unknown[],
  };
}

/**
 * Merge matching Positive/Negative cases into ONE combined suite.
 * Rebuilds weak negatives so Positive ≠ Negative.
 */
export function ensureCombinedSuites(cases: WebTestCase[]): WebTestCase[] {
  if (!cases.length) return cases;

  const combinedReady: WebTestCase[] = [];
  const pending: WebTestCase[] = [];

  for (const c of cases) {
    if (c.suiteMode === 'combined' && (c.positiveSteps || c.steps)) {
      const posSteps = c.positiveSteps || c.steps || [];
      const negSteps = c.negativeSteps || [];
      const refreshed = buildCombinedSuite(
        { ...c, steps: posSteps, positiveSteps: posSteps },
        negSteps.length
          ? {
              ...c,
              id: `${c.id}-negative`,
              steps: negSteps,
              expectation: 'negative',
            }
          : null,
        {
          // Always rebuild stub clones so Happy path ≠ Error path
          forceNewNegative:
            !negSteps.length || isWeakNegativePair(posSteps, negSteps),
        },
      );
      combinedReady.push({
        ...refreshed,
        id: stripExpectationSuffix(c.id) || refreshed.id,
        name: stripExpectationFromName(c.name) || refreshed.name,
      });
    } else {
      pending.push(c);
    }
  }

  const byKey = new Map<
    string,
    { positive?: WebTestCase; negative?: WebTestCase; singles: WebTestCase[] }
  >();
  for (const c of pending) {
    const key = suiteBucketKey(c);
    const bucket = byKey.get(key) || { singles: [] };
    if (c.suiteMode === 'combined') {
      bucket.singles.push(c);
    } else {
      const exp = resolveExpectation(c);
      if (exp === 'negative') bucket.negative = c;
      else bucket.positive = c;
    }
    byKey.set(key, bucket);
  }

  const out: WebTestCase[] = [...combinedReady];
  const seenIds = new Set(out.map((c) => c.id));

  for (const [, bucket] of byKey) {
    const { positive, negative, singles } = bucket;

    if (positive || negative) {
      const suite = buildCombinedSuite(
        positive || synthesizeOppositeCase(negative!),
        negative || undefined,
        {
          forceNewNegative: !!(
            positive &&
            negative &&
            isWeakNegativePair(
              positive.positiveSteps || positive.steps || [],
              negative.negativeSteps || negative.steps || [],
            )
          ),
        },
      );
      if (!seenIds.has(suite.id)) {
        seenIds.add(suite.id);
        out.push(suite);
      }
      continue;
    }

    for (const s of singles) {
      const suite = buildCombinedSuite(s, undefined, { forceNewNegative: true });
      if (!seenIds.has(suite.id)) {
        seenIds.add(suite.id);
        out.push(suite);
      }
    }
  }

  return out;
}

/**
 * @deprecated Use ensureCombinedSuites — kept as alias so older imports still merge to one suite.
 */
export function ensurePositiveNegativePair(cases: WebTestCase[]): WebTestCase[] {
  return ensureCombinedSuites(cases);
}

/** Find sibling opposite case — only for legacy separate rows. */
export function findExpectationSibling<
  T extends {
    id: string;
    pairId?: string;
    expectation?: string;
    tags?: string[];
    name?: string;
    suiteMode?: string;
  },
>(current: T, all: T[]): T | undefined {
  if (current.suiteMode === 'combined') return undefined;
  const exp = resolveExpectation(current);
  const want: TestExpectation = exp === 'positive' ? 'negative' : 'positive';
  const pairId = current.pairId || stripExpectationSuffix(current.id);
  return all.find((c) => {
    if (c.id === current.id) return false;
    if (c.suiteMode === 'combined') return false;
    const otherPair = c.pairId || stripExpectationSuffix(c.id);
    if (otherPair !== pairId) return false;
    return resolveExpectation(c) === want;
  });
}
