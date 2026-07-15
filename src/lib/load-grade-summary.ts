import type {
  LoadGrade,
  LoadGradeSummary,
  LoadMetricCompareRow,
  RunStatus,
  WebLoadConfig,
  WebLoadLiveMetrics,
} from '@/lib/types';

export type LoadGradeThresholds = Pick<
  WebLoadConfig,
  | 'maxErrorRatePct'
  | 'p50Ms'
  | 'p75Ms'
  | 'p90Ms'
  | 'p95Ms'
  | 'p99Ms'
  | 'avgMs'
  | 'maxAvgLatencyMs'
  | 'maxAvgConnectMs'
  | 'virtualUsers'
  | 'durationSec'
>;

/** Resolved latency SLAs derived from p95 when optional fields are omitted. */
export type ResolvedLoadThresholds = {
  maxErrorRatePct: number;
  p50Ms: number;
  p75Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  avgLatencyMs: number;
  avgConnectMs: number;
  virtualUsers: number;
  durationSec: number;
};

function clampMs(n: number | undefined | null, fallback: number): number {
  if (n != null && Number.isFinite(n) && n > 0) return Math.round(n);
  return Math.max(1, Math.round(fallback));
}

/** Default p99 SLA when not set — typically 1.5× p95. */
export function defaultLoadP99Ms(p95Ms: number, p99Ms?: number | null): number {
  const p95 = Math.max(1, p95Ms || 4000);
  if (p99Ms != null && Number.isFinite(p99Ms) && p99Ms > 0) {
    return Math.max(p95, Math.round(p99Ms));
  }
  return Math.max(p95, Math.round(p95 * 1.5));
}

/** Resolve all latency thresholds (p50…p99, avg, TTFB, connect) from config. */
export function resolveLoadThresholds(
  t: LoadGradeThresholds,
): ResolvedLoadThresholds {
  const p95 = Math.max(1, t.p95Ms ?? 4000);
  return {
    maxErrorRatePct: Math.max(0, t.maxErrorRatePct ?? 10),
    p50Ms: clampMs(t.p50Ms, p95 * 0.45),
    p75Ms: clampMs(t.p75Ms, p95 * 0.65),
    p90Ms: clampMs(t.p90Ms, p95 * 0.85),
    p95Ms: p95,
    p99Ms: defaultLoadP99Ms(p95, t.p99Ms),
    avgMs: clampMs(t.avgMs, p95 * 0.55),
    avgLatencyMs: clampMs(t.maxAvgLatencyMs, p95 * 0.4),
    avgConnectMs: clampMs(t.maxAvgConnectMs, p95 * 0.25),
    virtualUsers: t.virtualUsers ?? 10,
    durationSec: t.durationSec ?? 30,
  };
}

export type ConfiguredThresholdRow = {
  key: string;
  label: string;
  limit: string;
  category: 'error' | 'latency' | 'load' | 'optional';
};

/** Flat list of current configured threshold limits (for Thresholds tab / PDF). */
export function listConfiguredThresholdRows(
  t: LoadGradeThresholds | ResolvedLoadThresholds,
): ConfiguredThresholdRow[] {
  const lim =
    'avgLatencyMs' in t && typeof (t as ResolvedLoadThresholds).avgLatencyMs === 'number'
      ? (t as ResolvedLoadThresholds)
      : resolveLoadThresholds(t as LoadGradeThresholds);
  return [
    {
      key: 'error',
      label: 'Max error rate',
      limit: `≤ ${lim.maxErrorRatePct}%`,
      category: 'error',
    },
    {
      key: 'p50',
      label: 'p50 latency',
      limit: `≤ ${lim.p50Ms} ms`,
      category: 'latency',
    },
    {
      key: 'p75',
      label: 'p75 latency',
      limit: `≤ ${lim.p75Ms} ms`,
      category: 'latency',
    },
    {
      key: 'p90',
      label: 'p90 latency',
      limit: `≤ ${lim.p90Ms} ms`,
      category: 'latency',
    },
    {
      key: 'p95',
      label: 'p95 latency',
      limit: `≤ ${lim.p95Ms} ms`,
      category: 'latency',
    },
    {
      key: 'p99',
      label: 'p99 latency',
      limit: `≤ ${lim.p99Ms} ms`,
      category: 'latency',
    },
    {
      key: 'avg',
      label: 'Avg response time',
      limit: `≤ ${lim.avgMs} ms`,
      category: 'latency',
    },
    {
      key: 'ttfb',
      label: 'Avg TTFB (latency)',
      limit: `≤ ${lim.avgLatencyMs} ms`,
      category: 'optional',
    },
    {
      key: 'connect',
      label: 'Avg connect time',
      limit: `≤ ${lim.avgConnectMs} ms`,
      category: 'optional',
    },
    {
      key: 'vus',
      label: 'Virtual users',
      limit: String(lim.virtualUsers),
      category: 'load',
    },
    {
      key: 'duration',
      label: 'Duration',
      limit: `${lim.durationSec} s`,
      category: 'load',
    },
  ];
}

/**
 * Fail reasons for JMeter threshold step — one line per breached SLA.
 * Optional JMeter fields (TTFB / connect) only fail when present in the sample set.
 */
export function listLoadThresholdFailures(
  m: WebLoadLiveMetrics,
  t: LoadGradeThresholds,
): string[] {
  const lim = resolveLoadThresholds(t);
  const reasons: string[] = [];
  if (m.totalRequests <= 0) {
    reasons.push('No JMeter samples recorded');
    return reasons;
  }
  if (m.errorRatePct > lim.maxErrorRatePct) {
    reasons.push(`Error rate ${m.errorRatePct}% > ${lim.maxErrorRatePct}%`);
  }
  if (m.p50Ms > lim.p50Ms) reasons.push(`p50 ${m.p50Ms}ms > ${lim.p50Ms}ms`);
  if ((m.p75Ms ?? 0) > lim.p75Ms)
    reasons.push(`p75 ${m.p75Ms}ms > ${lim.p75Ms}ms`);
  if ((m.p90Ms ?? 0) > lim.p90Ms)
    reasons.push(`p90 ${m.p90Ms}ms > ${lim.p90Ms}ms`);
  if (m.p95Ms > lim.p95Ms) reasons.push(`p95 ${m.p95Ms}ms > ${lim.p95Ms}ms`);
  if (m.p99Ms > lim.p99Ms) reasons.push(`p99 ${m.p99Ms}ms > ${lim.p99Ms}ms`);
  if (m.avgMs > lim.avgMs) reasons.push(`avg ${m.avgMs}ms > ${lim.avgMs}ms`);
  if (m.avgLatencyMs != null && m.avgLatencyMs > lim.avgLatencyMs) {
    reasons.push(`avg TTFB ${m.avgLatencyMs}ms > ${lim.avgLatencyMs}ms`);
  }
  if (m.avgConnectMs != null && m.avgConnectMs > lim.avgConnectMs) {
    reasons.push(`avg connect ${m.avgConnectMs}ms > ${lim.avgConnectMs}ms`);
  }
  return reasons;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function gradeLabel(grade: LoadGrade): string {
  switch (grade) {
    case 'best':
      return 'Best';
    case 'good':
      return 'Good';
    case 'fair':
      return 'Fair';
    default:
      return 'Poor';
  }
}

function ratio(actual: number, limit: number): number {
  return limit > 0 ? actual / limit : actual > 0 ? 1 : 0;
}

/**
 * Score + badge from JMeter results vs required thresholds.
 * Each available percentile / latency type is checked separately.
 */
export function buildLoadGradeSummary(opts: {
  metrics: WebLoadLiveMetrics;
  thresholds: LoadGradeThresholds;
  status: RunStatus;
  error?: string;
}): LoadGradeSummary {
  const { metrics: m, thresholds: t, status, error } = opts;
  const lim = resolveLoadThresholds(t);
  const successTarget = Math.max(0, round1(100 - lim.maxErrorRatePct));
  const successActual = round1(
    m.successRatePct != null
      ? m.successRatePct
      : m.totalRequests > 0
        ? 100 - m.errorRatePct
        : 0,
  );

  const trafficPass = m.totalRequests > 0;
  const errPass = trafficPass && m.errorRatePct <= lim.maxErrorRatePct;
  const p50Pass = trafficPass && m.p50Ms <= lim.p50Ms;
  const p75Pass = trafficPass && (m.p75Ms ?? 0) <= lim.p75Ms;
  const p90Pass = trafficPass && (m.p90Ms ?? 0) <= lim.p90Ms;
  const p95Pass = trafficPass && m.p95Ms <= lim.p95Ms;
  const p99Pass = trafficPass && m.p99Ms <= lim.p99Ms;
  const avgPass = trafficPass && m.avgMs <= lim.avgMs;
  const successPass = trafficPass && successActual >= successTarget;
  const ttfbPass =
    m.avgLatencyMs == null || m.avgLatencyMs <= lim.avgLatencyMs;
  const connectPass =
    m.avgConnectMs == null || m.avgConnectMs <= lim.avgConnectMs;
  const runOk = status === 'completed';
  const latencyOk =
    p50Pass && p75Pass && p90Pass && p95Pass && p99Pass && avgPass;

  const metrics: LoadMetricCompareRow[] = [
    {
      key: 'errorRate',
      label: 'Error rate',
      required: `≤ ${lim.maxErrorRatePct}%`,
      actual: `${round1(m.errorRatePct)}%`,
      passed: errPass,
      importance: 'critical',
    },
    {
      key: 'p50',
      label: 'p50 latency',
      required: `≤ ${lim.p50Ms} ms`,
      actual: `${m.p50Ms} ms`,
      passed: p50Pass,
      importance: 'critical',
    },
    {
      key: 'p75',
      label: 'p75 latency',
      required: `≤ ${lim.p75Ms} ms`,
      actual: `${m.p75Ms ?? 0} ms`,
      passed: p75Pass,
      importance: 'critical',
    },
    {
      key: 'p90',
      label: 'p90 latency',
      required: `≤ ${lim.p90Ms} ms`,
      actual: `${m.p90Ms ?? 0} ms`,
      passed: p90Pass,
      importance: 'critical',
    },
    {
      key: 'p95',
      label: 'p95 latency',
      required: `≤ ${lim.p95Ms} ms`,
      actual: `${m.p95Ms} ms`,
      passed: p95Pass,
      importance: 'critical',
    },
    {
      key: 'p99',
      label: 'p99 latency',
      required: `≤ ${lim.p99Ms} ms`,
      actual: `${m.p99Ms} ms`,
      passed: p99Pass,
      importance: 'critical',
    },
    {
      key: 'avg',
      label: 'Avg response time',
      required: `≤ ${lim.avgMs} ms`,
      actual: `${m.avgMs} ms`,
      passed: avgPass,
      importance: 'critical',
    },
  ];

  if (m.avgLatencyMs != null) {
    metrics.push({
      key: 'ttfb',
      label: 'Avg TTFB (latency)',
      required: `≤ ${lim.avgLatencyMs} ms`,
      actual: `${m.avgLatencyMs} ms`,
      passed: ttfbPass,
      importance: 'high',
    });
  }
  if (m.avgConnectMs != null) {
    metrics.push({
      key: 'connect',
      label: 'Avg connect time',
      required: `≤ ${lim.avgConnectMs} ms`,
      actual: `${m.avgConnectMs} ms`,
      passed: connectPass,
      importance: 'high',
    });
  }

  metrics.push(
    {
      key: 'successRate',
      label: 'Success rate',
      required: `≥ ${successTarget}%`,
      actual: `${successActual}%`,
      passed: successPass,
      importance: 'high',
    },
    {
      key: 'requests',
      label: 'Total requests',
      required: '> 0 (traffic recorded)',
      actual: String(m.totalRequests),
      passed: trafficPass,
      importance: 'critical',
    },
    {
      key: 'rps',
      label: 'Throughput (RPS)',
      required: 'Recorded under target VUs',
      actual: `${m.rps}`,
      passed: trafficPass && m.rps > 0,
      importance: 'medium',
    },
  );

  if (m.minMs != null || m.maxMs != null) {
    metrics.push({
      key: 'minmax',
      label: 'Min / Max response',
      required: 'Observed under load',
      actual: `${m.minMs ?? '—'} / ${m.maxMs ?? '—'} ms`,
      passed: trafficPass,
      importance: 'info',
    });
  }
  if (m.stddevMs != null) {
    metrics.push({
      key: 'stddev',
      label: 'Stddev response',
      required: `Prefer ≤ ${Math.round(lim.avgMs * 0.8)} ms (guide)`,
      actual: `${m.stddevMs} ms`,
      passed: trafficPass && m.stddevMs <= lim.avgMs * 0.8,
      importance: 'info',
    });
  }
  if (m.kbPerSec != null) {
    metrics.push({
      key: 'kbps',
      label: 'Throughput (KB/s)',
      required: 'Recorded when JMeter has bytes',
      actual: String(m.kbPerSec),
      passed: trafficPass && m.kbPerSec > 0,
      importance: 'info',
    });
  }

  metrics.push({
    key: 'threads',
    label: 'Virtual users',
    required: `${lim.virtualUsers} planned`,
    actual: `${m.latestThreads ?? m.jmeterThreads ?? m.activeUsers}/${m.virtualUsers}`,
    passed: trafficPass,
    importance: 'info',
  });

  const criticalFail = metrics
    .filter((r) => r.importance === 'critical')
    .some((r) => !r.passed);
  const highFail = metrics
    .filter((r) => r.importance === 'high')
    .some((r) => !r.passed);

  const errRatio = ratio(m.errorRatePct, lim.maxErrorRatePct);
  const p95Ratio = ratio(m.p95Ms, lim.p95Ms);
  const p99Ratio = ratio(m.p99Ms, lim.p99Ms);
  const p90Ratio = ratio(m.p90Ms ?? 0, lim.p90Ms);

  let grade: LoadGrade = 'poor';
  let score = 25;

  if (!runOk || criticalFail || !trafficPass) {
    grade = 'poor';
    score = trafficPass ? 35 : 10;
  } else if (
    errRatio <= 0.25 &&
    p95Ratio <= 0.5 &&
    p99Ratio <= 0.5 &&
    p90Ratio <= 0.5 &&
    successActual >= 99 &&
    !highFail
  ) {
    grade = 'best';
    score = 95;
  } else if (
    errPass &&
    latencyOk &&
    !highFail &&
    errRatio <= 0.7 &&
    p95Ratio <= 0.85 &&
    p99Ratio <= 0.85
  ) {
    grade = 'good';
    score = 80;
  } else if (errPass && latencyOk && !highFail) {
    grade = 'fair';
    score = 60;
  } else if (errPass && latencyOk) {
    grade = 'fair';
    score = 55;
  } else {
    grade = 'poor';
    score = 40;
  }

  if (grade === 'good' && m.rps > 0 && m.avgMs < lim.avgMs * 0.7) {
    grade = 'best';
    score = 92;
  }

  const failedLabels = metrics.filter((r) => !r.passed).map((r) => r.label);
  const latencyLine = `p50 ${m.p50Ms}/${lim.p50Ms} · p75 ${m.p75Ms ?? 0}/${lim.p75Ms} · p90 ${m.p90Ms ?? 0}/${lim.p90Ms} · p95 ${m.p95Ms}/${lim.p95Ms} · p99 ${m.p99Ms}/${lim.p99Ms} · avg ${m.avgMs}/${lim.avgMs} ms`;

  const summary =
    grade === 'best'
      ? `Best — API stayed well under all latency SLAs (error ${round1(m.errorRatePct)}% ≤ ${lim.maxErrorRatePct}%; ${latencyLine}).`
      : grade === 'good'
        ? `Good — Required thresholds met (${m.totalRequests} samples; ${latencyLine}; error ${round1(m.errorRatePct)}%).`
        : grade === 'fair'
          ? `Fair — Thresholds passed but headroom is tight (${latencyLine}; error ${round1(m.errorRatePct)}% / ${lim.maxErrorRatePct}%).`
          : `Poor — ${
              error ||
              (failedLabels.length
                ? `Failed required checks: ${failedLabels.join(', ')}.`
                : 'Load run did not meet required metrics.')
            }`;

  const importance =
    grade === 'best' || grade === 'good'
      ? 'High confidence for release: critical SLAs (error rate, p50, p75, p90, p95, p99, and avg) are satisfied. Keep monitoring auth success and connect/TTFB after deploys.'
      : grade === 'fair'
        ? 'Medium priority: still within SLA but close to latency limits — plan capacity or optimize hot endpoints before traffic spikes.'
        : 'High priority fix: critical load SLAs failed — do not treat this as a green go-live signal until error rate / percentile latency / traffic gaps are addressed.';

  return {
    grade,
    label: gradeLabel(grade),
    score,
    summary,
    importance,
    metrics,
    thresholds: {
      maxErrorRatePct: lim.maxErrorRatePct,
      p50Ms: lim.p50Ms,
      p75Ms: lim.p75Ms,
      p90Ms: lim.p90Ms,
      p95Ms: lim.p95Ms,
      p99Ms: lim.p99Ms,
      avgMs: lim.avgMs,
      avgLatencyMs: lim.avgLatencyMs,
      avgConnectMs: lim.avgConnectMs,
      virtualUsers: lim.virtualUsers ?? m.virtualUsers,
      durationSec: lim.durationSec ?? m.elapsedSec,
    },
  };
}
