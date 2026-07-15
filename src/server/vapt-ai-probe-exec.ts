/**
 * Execute runtime AI (or fallback) probe queries and map responses → VaptFinding[].
 */
import type {
  VaptCheckCategory,
  VaptCheckId,
  VaptFinding,
  VaptFindingStatus,
  VaptNetworkCapture,
  VaptProbeRound,
  VaptSeverity,
} from '@/lib/types';
import { vaptAttackLabel } from '@/lib/vapt-attacks';
import {
  levelToRound,
  type VaptAiQueryLevel,
  type VaptRuntimeAiQuery,
} from '@/server/vapt-runtime-ai';

export type AiProbeExecCtx = {
  checkId: VaptCheckId;
  stepId: string;
  signal: AbortSignal;
  onNetwork: (cap: VaptNetworkCapture) => void;
  model?: string;
  level: VaptAiQueryLevel;
};

function categoryFor(checkId: VaptCheckId): VaptCheckCategory {
  if (checkId.includes('xss')) return 'xss';
  if (checkId.includes('csrf')) return 'csrf';
  if (checkId.includes('ssrf')) return 'ssrf';
  if (checkId.includes('xxe')) return 'xxe';
  if (checkId.includes('upload') || checkId.includes('malware')) return 'upload';
  if (checkId.includes('traversal')) return 'traversal';
  if (checkId.includes('rate') || checkId.includes('ddos') || checkId.includes('brute'))
    return 'rate-limit';
  if (checkId.includes('auth') || checkId.includes('privilege') || checkId.includes('session'))
    return 'auth';
  if (checkId.includes('tls') || checkId.includes('mitm') || checkId.includes('phishing'))
    return 'tls-transport';
  if (
    checkId.includes('sql') ||
    checkId.includes('rce') ||
    checkId.includes('command') ||
    checkId.includes('injection') ||
    checkId.includes('deserial')
  )
    return 'injection-surface';
  return 'api';
}

function defaultFailPatterns(checkId: VaptCheckId): string[] {
  switch (checkId) {
    case 'sql-injection-surface':
      return ['sql syntax', 'mysql', 'postgres', 'ORA-', 'sqlite', 'syntax error'];
    case 'xss-reflection':
      return ['<lgd_vapt_xss>', 'lgd_vapt_xss'];
    case 'rce-surface':
    case 'command-injection-surface':
      return ['uid=', 'gid=', 'root:', 'bin/bash', 'lgd_vapt_cmd_out'];
    case 'directory-traversal':
      return ['root:x:', 'daemon:', '/bin/bash'];
    case 'ssrf-surface':
      return ['ami-id', 'instance-id', 'meta-data', 'OpenSSH'];
    case 'xxe-surface':
      return ['root:x:', '/bin/bash'];
    default:
      return ['stack trace', 'Exception in thread', 'Traceback (most recent'];
  }
}

function evaluateResponse(
  checkId: VaptCheckId,
  query: VaptRuntimeAiQuery,
  status: number,
  text: string,
  headers: Headers,
): { status: VaptFindingStatus; severity: VaptSeverity; evidence: string } {
  const hay = `${text}\n${Array.from(headers.entries())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}`;

  const patterns = [
    ...(query.failIfContains || []),
    ...defaultFailPatterns(checkId),
  ].filter(Boolean);

  for (const p of patterns) {
    try {
      if (new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(hay)) {
        return {
          status: 'fail',
          severity: 'high',
          evidence: `Matched fail signal "${p}" · HTTP ${status}`,
        };
      }
    } catch {
      if (hay.toLowerCase().includes(p.toLowerCase())) {
        return {
          status: 'fail',
          severity: 'high',
          evidence: `Matched fail signal "${p}" · HTTP ${status}`,
        };
      }
    }
  }

  // Rate-limit style checks: success if we see limiting signals
  if (
    checkId === 'brute-force' ||
    checkId === 'ddos-rate-limit' ||
    checkId === 'api-abuse'
  ) {
    const limited =
      status === 429 ||
      Boolean(headers.get('retry-after')) ||
      Boolean(headers.get('x-ratelimit-limit')) ||
      Boolean(headers.get('x-ratelimit-remaining'));
    if (limited) {
      return {
        status: 'pass',
        severity: 'info',
        evidence: `Rate-limit signal present · HTTP ${status}`,
      };
    }
    // Individual request without limit is info; aggregation done by runner for rate checks
    return {
      status: 'info',
      severity: 'low',
      evidence: `No rate-limit header on this request · HTTP ${status}`,
    };
  }

  if (checkId === 'api-auth-bypass') {
    if (status === 200) {
      return {
        status: 'fail',
        severity: 'high',
        evidence: `Unauth/junk-auth GET returned 200 · may indicate auth bypass`,
      };
    }
    if (status === 401 || status === 403) {
      return {
        status: 'pass',
        severity: 'info',
        evidence: `Auth correctly denied · HTTP ${status}`,
      };
    }
  }

  return {
    status: 'pass',
    severity: 'info',
    evidence: `No fail signal · HTTP ${status}`,
  };
}

async function fetchOne(
  ctx: AiProbeExecCtx,
  query: VaptRuntimeAiQuery,
): Promise<{ status: number; text: string; headers: Headers; url: string }> {
  const reqPayload =
    query.method === 'GET' || query.method === 'HEAD'
      ? undefined
      : query.body?.slice(0, 4000);
  const res = await fetch(query.url, {
    method: query.method,
    headers: query.headers,
    body:
      query.method === 'GET' || query.method === 'HEAD' ? undefined : query.body,
    redirect: 'manual',
    signal: ctx.signal,
  });
  const text = (await res.text().catch(() => '')).slice(0, 8000);
  ctx.onNetwork({
    id: `net-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    method: query.method,
    url: query.url,
    status: res.status,
    requestPayload: reqPayload,
    responseSnippet: text.slice(0, 600),
    stepId: ctx.stepId,
    checkId: ctx.checkId,
    source: 'probe',
  });
  return { status: res.status, text, headers: res.headers, url: query.url };
}

/**
 * Run AI/fallback queries. For rate-limit family, also synthesize an aggregate finding.
 */
export async function executeRuntimeAiQueries(
  queries: VaptRuntimeAiQuery[],
  ctx: AiProbeExecCtx,
): Promise<VaptFinding[]> {
  const round: VaptProbeRound = levelToRound(ctx.level);
  const label = vaptAttackLabel(ctx.checkId);
  const findings: VaptFinding[] = [];
  const rateStatuses: number[] = [];
  let rateLimited = false;

  for (const q of queries) {
    if (ctx.signal.aborted) break;
    try {
      const res = await fetchOne(ctx, q);
      rateStatuses.push(res.status);
      if (
        res.status === 429 ||
        res.headers.get('retry-after') ||
        res.headers.get('x-ratelimit-limit')
      ) {
        rateLimited = true;
      }

      const ev = evaluateResponse(
        ctx.checkId,
        q,
        res.status,
        res.text,
        res.headers,
      );

      findings.push({
        id: `${ctx.checkId}-${round}-${q.id}`,
        title: `${label} · ${round} · ${q.label}`,
        severity: ev.severity,
        category: categoryFor(ctx.checkId),
        status: ev.status,
        evidence: [ev.evidence, q.note].filter(Boolean).join(' · '),
        recommendation:
          ev.status === 'fail'
            ? 'Harden input validation / auth / rate limits for this attack class; re-run VAPT after fix.'
            : 'Keep existing controls; continue monitoring this surface.',
        owasp:
          ctx.checkId.includes('sql') || ctx.checkId.includes('xss')
            ? 'A03:2021 Injection'
            : ctx.checkId.includes('auth') || ctx.checkId.includes('brute')
              ? 'A07:2021 Identification and Authentication Failures'
              : 'A05:2021 Security Misconfiguration',
        stepId: ctx.stepId,
        checkId: ctx.checkId,
        requestMethod: q.method,
        requestUrl: res.url,
        requestPayload: q.body?.slice(0, 4000),
        responseStatus: res.status,
        responseSnippet: res.text.slice(0, 500),
        probeRound: round,
        aiQueryLabel: q.label,
        aiModel: ctx.model,
      });
    } catch (err) {
      findings.push({
        id: `${ctx.checkId}-${round}-${q.id}-err`,
        title: `${label} · ${round} · ${q.label} (error)`,
        severity: 'medium',
        category: categoryFor(ctx.checkId),
        status: 'error',
        evidence: err instanceof Error ? err.message : 'request failed',
        stepId: ctx.stepId,
        checkId: ctx.checkId,
        requestMethod: q.method,
        requestUrl: q.url,
        requestPayload: q.body?.slice(0, 4000),
        probeRound: round,
        aiQueryLabel: q.label,
        aiModel: ctx.model,
      });
    }
  }

  // Aggregate rate-limit verdict when we only got info rows
  if (
    (ctx.checkId === 'brute-force' ||
      ctx.checkId === 'ddos-rate-limit' ||
      ctx.checkId === 'api-abuse') &&
    findings.every((f) => f.status === 'info' || f.status === 'pass')
  ) {
    if (!rateLimited) {
      findings.push({
        id: `${ctx.checkId}-${round}-aggregate`,
        title: `${label} · ${round} · no rate-limit after ${rateStatuses.length} AI queries`,
        severity: 'medium',
        category: 'rate-limit',
        status: 'fail',
        evidence: `Statuses: ${rateStatuses.join(',')} · no 429 / Retry-After / X-RateLimit`,
        recommendation:
          'Add rate limiting (429 + Retry-After) and lockout for repeated auth/API abuse.',
        owasp: 'A07:2021 Identification and Authentication Failures',
        cwe: 'CWE-307',
        stepId: ctx.stepId,
        checkId: ctx.checkId,
        probeRound: round,
        aiQueryLabel: 'aggregate rate check',
        aiModel: ctx.model,
      });
    } else {
      findings.push({
        id: `${ctx.checkId}-${round}-aggregate-ok`,
        title: `${label} · ${round} · rate-limit signals observed`,
        severity: 'info',
        category: 'rate-limit',
        status: 'pass',
        evidence: `Statuses: ${rateStatuses.join(',')}`,
        stepId: ctx.stepId,
        checkId: ctx.checkId,
        probeRound: round,
        aiQueryLabel: 'aggregate rate check',
        aiModel: ctx.model,
      });
    }
  }

  return findings;
}

/** True when baseline (and optional multi) findings have no fail/error for this check. */
export function checkPassedClean(findings: VaptFinding[], checkId: VaptCheckId): boolean {
  const relevant = findings.filter((f) => f.checkId === checkId);
  if (!relevant.length) return true;
  return !relevant.some((f) => f.status === 'fail' || f.status === 'error');
}
