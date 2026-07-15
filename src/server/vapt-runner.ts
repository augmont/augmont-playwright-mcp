import { chromium, type Browser, type CDPSession, type Page, type Request } from 'playwright';
import type {
  TestStep,
  VaptAiProbeRoundSummary,
  VaptCheckId,
  VaptFinding,
  VaptLiveMetrics,
  VaptNetworkCapture,
  VaptSeverity,
  VaptTestCase,
} from '@/lib/types';
import type { AiProviderId } from '@/lib/ai-provider';
import {
  getSession,
  setFrame,
  setRunStatus,
  skipRemainingSteps,
  updateStep,
  updateVaptFindings,
} from '@/server/session-manager';
import {
  attachThrottledScreencast,
  stopScreencast,
} from '@/server/mcp-screencast';
import {
  captureLivePreviewJpeg,
  captureViewportScreenshot,
} from '@/server/report-capture';
import { resolveVaptStartUrl, resolveVaptTargetUrl } from '@/server/vapt-store';
import { countAttacks, vaptAttackLabel } from '@/lib/vapt-attacks';
import { runCatalogueAttackProbe } from '@/server/vapt-catalogue-probes';
import { generateRuntimeProbeQueries } from '@/server/vapt-runtime-ai';
import {
  checkPassedClean,
  executeRuntimeAiQueries,
} from '@/server/vapt-ai-probe-exec';

const SEVERITY_RANK: Record<VaptSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

type ProbeResult = {
  status: number;
  headers: Headers;
  text: string;
  finalUrl: string;
  method: string;
  url: string;
  requestPayload?: string;
};

type CheckCtx = {
  targetUrl: string;
  baseUrl: string;
  apiUrl?: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  stepId: string;
  checkId: VaptCheckId;
  signal: AbortSignal;
  onNetwork: (cap: VaptNetworkCapture) => void;
};

function emptyMetrics(targetUrl: string): VaptLiveMetrics {
  return {
    checked: 0,
    passed: 0,
    failed: 0,
    info: 0,
    errors: 0,
    bySeverity: {},
    findings: [],
    networkCaptures: [],
    targetUrl,
    engine: 'api-vapt',
    aiProbeRounds: [],
  };
}

function summarize(
  findings: VaptFinding[],
  targetUrl: string,
  networkCaptures: VaptNetworkCapture[],
  aiProbeRounds?: VaptAiProbeRoundSummary[],
): VaptLiveMetrics {
  const bySeverity: Partial<Record<VaptSeverity, number>> = {};
  let passed = 0;
  let failed = 0;
  let info = 0;
  let errors = 0;
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    if (f.status === 'pass') passed += 1;
    else if (f.status === 'fail') failed += 1;
    else if (f.status === 'info') info += 1;
    else errors += 1;
  }
  return {
    checked: findings.length,
    passed,
    failed,
    info,
    errors,
    bySeverity,
    findings,
    networkCaptures,
    targetUrl,
    engine: 'api-vapt',
    aiProbeRounds: aiProbeRounds || [],
  };
}

function tagBaseline(findings: VaptFinding[]): VaptFinding[] {
  return findings.map((f) => ({
    ...f,
    probeRound: f.probeRound || ('baseline' as const),
  }));
}

function countRoundStats(batch: VaptFinding[]) {
  return {
    passed: batch.filter((f) => f.status === 'pass').length,
    failed: batch.filter((f) => f.status === 'fail').length,
    errors: batch.filter((f) => f.status === 'error').length,
  };
}

function gateFails(findings: VaptFinding[], gate: VaptSeverity): boolean {
  const min = SEVERITY_RANK[gate];
  return findings.some(
    (f) => f.status === 'fail' && SEVERITY_RANK[f.severity] >= min,
  );
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  );
}

function headerGet(headers: Headers, name: string): string | null {
  return headers.get(name) || headers.get(name.toLowerCase());
}

function attachProbeFields(
  finding: VaptFinding,
  probe: ProbeResult,
  checkId: VaptCheckId,
): VaptFinding {
  return {
    ...finding,
    checkId,
    requestMethod: probe.method,
    requestUrl: probe.url,
    requestPayload: probe.requestPayload,
    responseStatus: probe.status,
    responseSnippet: probe.text.slice(0, 500),
  };
}

async function fetchProbe(
  url: string,
  method: string,
  headers: Record<string, string> | undefined,
  body: string | undefined,
  signal: AbortSignal,
  ctx: Pick<CheckCtx, 'onNetwork' | 'stepId' | 'checkId'>,
): Promise<ProbeResult> {
  const reqPayload =
    method === 'GET' || method === 'HEAD' ? undefined : body?.slice(0, 4000);
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    redirect: 'manual',
    signal,
  });
  const text = (await res.text().catch(() => '')).slice(0, 8000);
  const probe: ProbeResult = {
    status: res.status,
    headers: res.headers,
    text,
    finalUrl: res.url || url,
    method,
    url,
    requestPayload: reqPayload,
  };
  ctx.onNetwork({
    id: `net-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    method,
    url,
    status: res.status,
    requestPayload: reqPayload,
    responseSnippet: text.slice(0, 600),
    stepId: ctx.stepId,
    checkId: ctx.checkId,
    source: 'probe',
  });
  return probe;
}

async function attachScreencast(runId: string, page: Page): Promise<CDPSession> {
  return attachThrottledScreencast(runId, page);
}

function attachBrowserNetworkWatcher(
  page: Page,
  apiUrl: string | undefined,
  onNetwork: (cap: VaptNetworkCapture) => void,
  stepIdRef: { current: string },
) {
  const apiHost = (() => {
    try {
      return apiUrl ? new URL(apiUrl).host : '';
    } catch {
      return '';
    }
  })();

  const pending = new Map<Request, { method: string; url: string; payload?: string }>();

  page.on('request', (req) => {
    try {
      const url = req.url();
      if (apiHost && !url.includes(apiHost) && !/\/api\//i.test(url)) return;
      if (!apiHost && !/\/api\/|graphql|location/i.test(url)) return;
      pending.set(req, {
        method: req.method(),
        url,
        payload: req.postData()?.slice(0, 4000),
      });
    } catch {
      // ignore
    }
  });

  page.on('response', async (res) => {
    const req = res.request();
    const meta = pending.get(req);
    pending.delete(req);
    if (!meta) return;
    let body = '';
    try {
      body = (await res.text()).slice(0, 600);
    } catch {
      body = '';
    }
    onNetwork({
      id: `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      method: meta.method,
      url: meta.url,
      status: res.status(),
      requestPayload: meta.payload,
      responseSnippet: body,
      stepId: stepIdRef.current,
      source: 'browser',
    });
  });
}

async function paintAttackEvidence(
  page: Page,
  opts: {
    checkId: string;
    title: string;
    findings: VaptFinding[];
    targetUrl: string;
  },
) {
  try {
    await page.evaluate((payload) => {
      const id = '__lgd_vapt_evidence__';
      document.getElementById(id)?.remove();
      const el = document.createElement('div');
      el.id = id;
      el.setAttribute(
        'style',
        [
          'position:fixed',
          'inset:12px',
          'z-index:2147483646',
          'overflow:auto',
          'background:rgba(12,18,28,0.92)',
          'color:#e8eef7',
          'font:13px/1.45 ui-sans-serif,system-ui,sans-serif',
          'padding:18px 20px',
          'border-radius:12px',
          'border:1px solid rgba(120,160,220,0.35)',
          'box-shadow:0 16px 40px rgba(0,0,0,0.45)',
        ].join(';'),
      );
      const fails = payload.findings.filter((f) => f.status === 'fail' || f.status === 'error');
      const lines = payload.findings
        .slice(0, 8)
        .map(
          (f) =>
            `<div style="margin:6px 0;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.06)">
              <strong style="text-transform:uppercase;font-size:11px;opacity:.8">${f.status} · ${f.severity}</strong>
              <div>${f.title}</div>
              ${f.requestUrl ? `<div style="opacity:.75;font-size:11px;margin-top:4px">${f.requestMethod || ''} ${f.requestUrl}</div>` : ''}
              ${f.requestPayload ? `<pre style="white-space:pre-wrap;font-size:11px;margin:4px 0 0;opacity:.85">${f.requestPayload.slice(0, 280)}</pre>` : ''}
            </div>`,
        )
        .join('');
      el.innerHTML = `
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;margin-bottom:6px">API VAPT evidence · not UI crawl</div>
        <h1 style="margin:0 0 6px;font-size:20px">${payload.title}</h1>
        <div style="opacity:.8;margin-bottom:12px">Check <code>${payload.checkId}</code> · ${payload.targetUrl}</div>
        <div style="margin-bottom:10px">${fails.length} fail/error · ${payload.findings.length} finding(s)</div>
        ${lines || '<div>No findings</div>'}
      `;
      document.documentElement.appendChild(el);
    }, opts);
  } catch {
    // page may be closed
  }
}

async function runCheck(check: VaptCheckId, ctx: CheckCtx): Promise<VaptFinding[]> {
  const findings: VaptFinding[] = [];
  const idBase = `${check}-${Date.now().toString(36)}`;
  const tag = (f: VaptFinding, probe?: ProbeResult): VaptFinding => {
    const base = { ...f, checkId: check, stepId: ctx.stepId };
    return probe ? attachProbeFields(base, probe, check) : base;
  };

  const catalogue = await runCatalogueAttackProbe(check, {
    targetUrl: ctx.targetUrl,
    baseUrl: ctx.baseUrl,
    apiUrl: ctx.apiUrl,
    method: ctx.method,
    headers: ctx.headers,
    body: ctx.body,
    stepId: ctx.stepId,
    checkId: ctx.checkId,
    signal: ctx.signal,
    onNetwork: ctx.onNetwork,
  });
  if (catalogue) return catalogue;

  if (check === 'tls-url') {
    try {
      const u = new URL(ctx.baseUrl);
      if (u.protocol === 'http:' && !isLocalHost(u.hostname)) {
        findings.push(
          tag({
            id: `${idBase}-http`,
            title: 'Portal served over HTTP (non-local)',
            severity: 'high',
            category: 'tls-transport',
            status: 'fail',
            evidence: `baseUrl=${ctx.baseUrl}`,
            recommendation:
              'Terminate TLS at the edge and redirect HTTP→HTTPS. Use HSTS once HTTPS is stable.',
            owasp: 'A02:2021 Cryptographic Failures',
            cwe: 'CWE-319',
          }),
        );
      } else {
        findings.push(
          tag({
            id: `${idBase}-ok`,
            title: 'Transport scheme check',
            severity: 'info',
            category: 'tls-transport',
            status: 'pass',
            evidence: `scheme=${u.protocol} host=${u.hostname}`,
            recommendation: 'Keep HTTPS in non-local environments.',
            owasp: 'A02:2021 Cryptographic Failures',
          }),
        );
      }
    } catch (err) {
      findings.push(
        tag({
          id: `${idBase}-err`,
          title: 'Could not parse baseUrl for TLS check',
          severity: 'medium',
          category: 'tls-transport',
          status: 'error',
          evidence: err instanceof Error ? err.message : 'parse error',
        }),
      );
    }
    return findings;
  }

  if (check === 'unauth-sensitive') {
    const paths = ['/admin', '/buyer', '/seller'];
    for (const p of paths) {
      const url = `${ctx.baseUrl.replace(/\/+$/, '')}${p}`;
      try {
        const res = await fetchProbe(url, 'GET', undefined, undefined, ctx.signal, ctx);
        const loc = headerGet(res.headers, 'location') || '';
        const denied =
          res.status === 401 ||
          res.status === 403 ||
          res.status === 302 ||
          res.status === 301 ||
          res.status === 307 ||
          res.status === 308 ||
          /login/i.test(loc);
        if (res.status === 200 && !denied) {
          findings.push(
            tag(
              {
                id: `${idBase}-${p.replace(/\//g, '')}`,
                title: `Unauthenticated access to ${p} returned 200`,
                severity: 'high',
                category: 'access-control',
                status: 'fail',
                evidence: `GET ${url} → ${res.status}${loc ? ` Location=${loc}` : ''}`,
                recommendation:
                  'Enforce auth guards on buyer/seller/admin routes; redirect anonymous users to /login.',
                owasp: 'A01:2021 Broken Access Control',
                cwe: 'CWE-862',
              },
              res,
            ),
          );
        } else {
          findings.push(
            tag(
              {
                id: `${idBase}-${p.replace(/\//g, '')}-ok`,
                title: `Unauth ${p} access denied / redirected`,
                severity: 'info',
                category: 'access-control',
                status: 'pass',
                evidence: `GET ${url} → ${res.status}${loc ? ` Location=${loc}` : ''}`,
                owasp: 'A01:2021 Broken Access Control',
              },
              res,
            ),
          );
        }
      } catch (err) {
        findings.push(
          tag({
            id: `${idBase}-${p.replace(/\//g, '')}-err`,
            title: `Unauth probe failed for ${p}`,
            severity: 'medium',
            category: 'access-control',
            status: 'error',
            evidence: err instanceof Error ? err.message : 'request failed',
          }),
        );
      }
    }
    return findings;
  }

  if (check === 'cors-preflight') {
    const origin = 'https://evil.example';
    try {
      const res = await fetch(ctx.targetUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
        signal: ctx.signal,
      });
      const text = await res.text().catch(() => '');
      const acao = headerGet(res.headers, 'access-control-allow-origin');
      ctx.onNetwork({
        id: `net-${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        method: 'OPTIONS',
        url: ctx.targetUrl,
        status: res.status,
        requestPayload: `Origin=${origin}`,
        responseSnippet: `ACAO=${acao || '(none)'} · ${text.slice(0, 200)}`,
        stepId: ctx.stepId,
        checkId: check,
        source: 'probe',
      });
      const fakeProbe: ProbeResult = {
        status: res.status,
        headers: res.headers,
        text,
        finalUrl: ctx.targetUrl,
        method: 'OPTIONS',
        url: ctx.targetUrl,
        requestPayload: `Origin=${origin}`,
      };
      if (acao === '*' || acao === origin) {
        findings.push(
          tag(
            {
              id: `${idBase}-cors`,
              title: 'Permissive CORS on preflight',
              severity: 'medium',
              category: 'api',
              status: 'fail',
              evidence: `OPTIONS ${ctx.targetUrl} ACAO=${acao}`,
              recommendation:
                'Restrict Access-Control-Allow-Origin to trusted portals; avoid * with credentials.',
              owasp: 'A05:2021 Security Misconfiguration',
              cwe: 'CWE-942',
            },
            fakeProbe,
          ),
        );
      } else {
        findings.push(
          tag(
            {
              id: `${idBase}-cors-ok`,
              title: 'CORS preflight not openly permissive',
              severity: 'info',
              category: 'api',
              status: 'pass',
              evidence: `OPTIONS → ${res.status}; ACAO=${acao || '(none)'}`,
            },
            fakeProbe,
          ),
        );
      }
    } catch (err) {
      findings.push(
        tag({
          id: `${idBase}-cors-err`,
          title: 'CORS preflight probe error',
          severity: 'low',
          category: 'api',
          status: 'error',
          evidence: err instanceof Error ? err.message : 'request failed',
        }),
      );
    }
    return findings;
  }

  if (check === 'api-auth-bypass') {
    try {
      const stripped = { ...(ctx.headers || {}) };
      delete stripped.Authorization;
      delete stripped.authorization;
      delete stripped.Cookie;
      delete stripped.cookie;
      const res = await fetchProbe(
        ctx.targetUrl,
        ctx.method,
        stripped,
        ctx.body || '{}',
        ctx.signal,
        ctx,
      );
      const denied = res.status === 401 || res.status === 403;
      if (res.status === 200 || res.status === 201) {
        findings.push(
          tag(
            {
              id: `${idBase}-bypass`,
              title: 'API accepted unauthenticated request',
              severity: 'critical',
              category: 'auth',
              status: 'fail',
              evidence: `${ctx.method} ${ctx.targetUrl} → ${res.status}`,
              recommendation:
                'Require auth on sensitive APIs; return 401/403 for anonymous callers.',
              owasp: 'A01:2021 Broken Access Control',
              cwe: 'CWE-306',
            },
            res,
          ),
        );
      } else if (denied) {
        findings.push(
          tag(
            {
              id: `${idBase}-denied`,
              title: 'API rejected unauthenticated call',
              severity: 'info',
              category: 'auth',
              status: 'pass',
              evidence: `${ctx.method} ${ctx.targetUrl} → ${res.status}`,
              owasp: 'A01:2021 Broken Access Control',
            },
            res,
          ),
        );
      } else {
        findings.push(
          tag(
            {
              id: `${idBase}-other`,
              title: `Unauth API returned ${res.status}`,
              severity: 'medium',
              category: 'auth',
              status: 'info',
              evidence: `${ctx.method} ${ctx.targetUrl} → ${res.status}; ${res.text.slice(0, 200)}`,
              recommendation: 'Prefer explicit 401/403 for missing credentials.',
              owasp: 'A01:2021 Broken Access Control',
            },
            res,
          ),
        );
      }
    } catch (err) {
      findings.push(
        tag({
          id: `${idBase}-err`,
          title: 'api-auth-bypass probe failed',
          severity: 'medium',
          category: 'auth',
          status: 'error',
          evidence: err instanceof Error ? err.message : 'request failed',
        }),
      );
    }
    return findings;
  }

  if (check === 'api-method-tamper') {
    const methods = ['PUT', 'PATCH', 'DELETE', 'TRACE'] as const;
    for (const m of methods) {
      try {
        const res = await fetchProbe(
          ctx.targetUrl,
          m,
          ctx.headers,
          m === 'DELETE' || m === 'TRACE' ? undefined : ctx.body || '{}',
          ctx.signal,
          ctx,
        );
        if (res.status === 200 || res.status === 201 || res.status === 204) {
          findings.push(
            tag(
              {
                id: `${idBase}-${m}`,
                title: `Unexpected success for ${m}`,
                severity: 'high',
                category: 'api',
                status: 'fail',
                evidence: `${m} ${ctx.targetUrl} → ${res.status}`,
                recommendation:
                  'Allow only documented methods; return 405 Method Not Allowed otherwise.',
                owasp: 'A01:2021 Broken Access Control',
                cwe: 'CWE-650',
              },
              res,
            ),
          );
        } else {
          findings.push(
            tag(
              {
                id: `${idBase}-${m}-ok`,
                title: `${m} not openly accepted`,
                severity: 'info',
                category: 'api',
                status: 'pass',
                evidence: `${m} → ${res.status}`,
              },
              res,
            ),
          );
        }
      } catch (err) {
        findings.push(
          tag({
            id: `${idBase}-${m}-err`,
            title: `${m} probe error`,
            severity: 'low',
            category: 'api',
            status: 'error',
            evidence: err instanceof Error ? err.message : 'request failed',
          }),
        );
      }
    }
    return findings;
  }

  if (check === 'api-error-hygiene') {
    try {
      const headers = {
        ...(ctx.headers || {}),
        'Content-Type': 'application/json',
      };
      const res = await fetchProbe(
        ctx.targetUrl,
        ctx.method === 'GET' ? 'POST' : ctx.method,
        headers,
        '{', // malformed JSON — hygiene only, not an exploit
        ctx.signal,
        ctx,
      );
      if (/exception|stack trace|at [A-Za-z0-9_.]+\(/i.test(res.text)) {
        findings.push(
          tag(
            {
              id: `${idBase}-leak`,
              title: 'Malformed request returned stack / exception text',
              severity: 'high',
              category: 'info-disclosure',
              status: 'fail',
              evidence: res.text.slice(0, 400),
              recommendation: 'Return generic 400 JSON errors; never expose stack traces.',
              owasp: 'A05:2021 Security Misconfiguration',
              cwe: 'CWE-209',
            },
            res,
          ),
        );
      } else if (res.status >= 500) {
        findings.push(
          tag(
            {
              id: `${idBase}-5xx`,
              title: 'Malformed body triggered 5xx',
              severity: 'medium',
              category: 'api',
              status: 'fail',
              evidence: `${res.method} → ${res.status}`,
              recommendation: 'Validate JSON and return 400, not 500.',
              owasp: 'A04:2021 Insecure Design',
            },
            res,
          ),
        );
      } else {
        findings.push(
          tag(
            {
              id: `${idBase}-ok`,
              title: 'Malformed body handled without stack leak',
              severity: 'info',
              category: 'api',
              status: 'pass',
              evidence: `${res.method} → ${res.status}`,
            },
            res,
          ),
        );
      }
    } catch (err) {
      findings.push(
        tag({
          id: `${idBase}-err`,
          title: 'api-error-hygiene probe failed',
          severity: 'low',
          category: 'api',
          status: 'error',
          evidence: err instanceof Error ? err.message : 'request failed',
        }),
      );
    }
    return findings;
  }

  if (check === 'injection-surface') {
    const marker = `lgd_vapt_marker_'\"<>`;
    try {
      const headers = {
        ...(ctx.headers || {}),
        'Content-Type': 'application/json',
      };
      const body = JSON.stringify({
        q: marker,
        search: marker,
        name: marker,
      });
      const res = await fetchProbe(
        ctx.targetUrl,
        ctx.method === 'GET' ? 'POST' : ctx.method,
        headers,
        body,
        ctx.signal,
        ctx,
      );
      const reflected = res.text.includes(marker) || res.text.includes('lgd_vapt_marker_');
      if (/exception|stack trace|sql|syntax error/i.test(res.text)) {
        findings.push(
          tag(
            {
              id: `${idBase}-sqlish`,
              title: 'Probe marker triggered verbose DB/parser error',
              severity: 'high',
              category: 'injection-surface',
              status: 'fail',
              evidence: res.text.slice(0, 400),
              recommendation:
                'Parameterized queries + generic client errors. This probe is hygiene-only (no exploit payload).',
              owasp: 'A03:2021 Injection',
              cwe: 'CWE-89',
            },
            res,
          ),
        );
      } else if (reflected) {
        findings.push(
          tag(
            {
              id: `${idBase}-reflect`,
              title: 'Input marker reflected in API response',
              severity: 'medium',
              category: 'injection-surface',
              status: 'fail',
              evidence: `Marker present in response (${res.status})`,
              recommendation:
                'Encode/sanitize outputs; treat client input as untrusted for XSS/injection chaining.',
              owasp: 'A03:2021 Injection',
              cwe: 'CWE-79',
            },
            res,
          ),
        );
      } else {
        findings.push(
          tag(
            {
              id: `${idBase}-ok`,
              title: 'No verbose injection/reflection signals',
              severity: 'info',
              category: 'injection-surface',
              status: 'pass',
              evidence: `${res.method} → ${res.status}`,
            },
            res,
          ),
        );
      }
    } catch (err) {
      findings.push(
        tag({
          id: `${idBase}-err`,
          title: 'injection-surface probe failed',
          severity: 'low',
          category: 'injection-surface',
          status: 'error',
          evidence: err instanceof Error ? err.message : 'request failed',
        }),
      );
    }
    return findings;
  }

  // Default HTTP GET/POST probes for remaining checks
  let res: ProbeResult;
  try {
    res = await fetchProbe(
      ctx.targetUrl,
      ctx.method,
      ctx.headers,
      ctx.body,
      ctx.signal,
      ctx,
    );
  } catch (err) {
    return [
      tag({
        id: `${idBase}-net`,
        title: `Request failed for ${check}`,
        severity: 'high',
        category: 'misconfig',
        status: 'error',
        evidence: err instanceof Error ? err.message : 'network error',
      }),
    ];
  }

  if (check === 'security-headers') {
    const required: Array<{ name: string; severity: VaptSeverity; hint: string }> = [
      {
        name: 'content-security-policy',
        severity: 'high',
        hint: 'Set a restrictive CSP (default-src / script-src).',
      },
      {
        name: 'x-frame-options',
        severity: 'medium',
        hint: 'Set X-Frame-Options: DENY or SAMEORIGIN (or frame-ancestors in CSP).',
      },
      {
        name: 'x-content-type-options',
        severity: 'medium',
        hint: 'Set X-Content-Type-Options: nosniff.',
      },
      {
        name: 'referrer-policy',
        severity: 'low',
        hint: 'Set Referrer-Policy (e.g. strict-origin-when-cross-origin).',
      },
      {
        name: 'strict-transport-security',
        severity: 'high',
        hint: 'Enable HSTS on HTTPS deployments.',
      },
    ];
    for (const h of required) {
      const val = headerGet(res.headers, h.name);
      if (!val) {
        let severity = h.severity;
        try {
          const u = new URL(ctx.targetUrl);
          if (h.name === 'strict-transport-security' && u.protocol === 'http:') {
            severity = 'info';
            findings.push(
              tag(
                {
                  id: `${idBase}-${h.name}`,
                  title: `Missing ${h.name} (expected weaker on HTTP)`,
                  severity,
                  category: 'security-headers',
                  status: 'info',
                  evidence: `GET ${ctx.targetUrl} → ${res.status}`,
                  recommendation: h.hint,
                  owasp: 'A05:2021 Security Misconfiguration',
                },
                res,
              ),
            );
            continue;
          }
        } catch {
          // ignore
        }
        findings.push(
          tag(
            {
              id: `${idBase}-${h.name}`,
              title: `Missing response header: ${h.name}`,
              severity,
              category: 'security-headers',
              status: severity === 'info' ? 'info' : 'fail',
              evidence: `GET ${ctx.targetUrl} → ${res.status}`,
              recommendation: h.hint,
              owasp: 'A05:2021 Security Misconfiguration',
              cwe: 'CWE-693',
            },
            res,
          ),
        );
      } else {
        findings.push(
          tag(
            {
              id: `${idBase}-${h.name}-ok`,
              title: `Present: ${h.name}`,
              severity: 'info',
              category: 'security-headers',
              status: 'pass',
              evidence: `${h.name}: ${val.slice(0, 200)}`,
            },
            res,
          ),
        );
      }
    }
  }

  if (check === 'cookie-flags') {
    const raw = res.headers.getSetCookie?.() || [];
    const setCookie =
      raw.length > 0
        ? raw
        : (() => {
            const single = headerGet(res.headers, 'set-cookie');
            return single ? [single] : [];
          })();
    if (!setCookie.length) {
      findings.push(
        tag(
          {
            id: `${idBase}-none`,
            title: 'No Set-Cookie on this response',
            severity: 'info',
            category: 'session',
            status: 'info',
            evidence: `${ctx.method} ${ctx.targetUrl} → ${res.status}`,
            recommendation:
              'Re-test after authenticated login if session cookies are only set post-auth.',
          },
          res,
        ),
      );
    } else {
      for (const [i, cookie] of setCookie.entries()) {
        const missing: string[] = [];
        if (!/; *httponly/i.test(cookie)) missing.push('HttpOnly');
        if (!/; *secure/i.test(cookie) && ctx.targetUrl.startsWith('https:')) {
          missing.push('Secure');
        }
        if (!/; *samesite=/i.test(cookie)) missing.push('SameSite');
        if (missing.length) {
          findings.push(
            tag(
              {
                id: `${idBase}-c${i}`,
                title: `Cookie missing flags: ${missing.join(', ')}`,
                severity: missing.includes('HttpOnly') ? 'high' : 'medium',
                category: 'session',
                status: 'fail',
                evidence: cookie.slice(0, 240),
                recommendation:
                  'Set HttpOnly; Secure on HTTPS; SameSite=Lax or Strict for session cookies.',
                owasp: 'A07:2021 Identification and Authentication Failures',
                cwe: 'CWE-614',
              },
              res,
            ),
          );
        } else {
          findings.push(
            tag(
              {
                id: `${idBase}-c${i}-ok`,
                title: 'Cookie flags look present',
                severity: 'info',
                category: 'session',
                status: 'pass',
                evidence: cookie.slice(0, 240),
              },
              res,
            ),
          );
        }
      }
    }
  }

  if (check === 'info-disclosure') {
    const server = headerGet(res.headers, 'server');
    const powered = headerGet(res.headers, 'x-powered-by');
    if (server) {
      findings.push(
        tag(
          {
            id: `${idBase}-server`,
            title: 'Server header discloses technology',
            severity: 'low',
            category: 'info-disclosure',
            status: 'fail',
            evidence: `Server: ${server}`,
            recommendation: 'Remove or generalize the Server header at the reverse proxy.',
            owasp: 'A05:2021 Security Misconfiguration',
          },
          res,
        ),
      );
    }
    if (powered) {
      findings.push(
        tag(
          {
            id: `${idBase}-xpb`,
            title: 'X-Powered-By header present',
            severity: 'low',
            category: 'info-disclosure',
            status: 'fail',
            evidence: `X-Powered-By: ${powered}`,
            recommendation: 'Disable X-Powered-By / framework fingerprint headers.',
            owasp: 'A05:2021 Security Misconfiguration',
          },
          res,
        ),
      );
    }
    if (/exception|stack trace|at [A-Za-z0-9_.]+\(/i.test(res.text)) {
      findings.push(
        tag(
          {
            id: `${idBase}-stack`,
            title: 'Possible stack trace / exception in body',
            severity: 'high',
            category: 'info-disclosure',
            status: 'fail',
            evidence: res.text.slice(0, 400),
            recommendation: 'Return generic errors to clients; log details server-side only.',
            owasp: 'A05:2021 Security Misconfiguration',
            cwe: 'CWE-209',
          },
          res,
        ),
      );
    }
    if (!findings.some((f) => f.id.startsWith(idBase))) {
      findings.push(
        tag(
          {
            id: `${idBase}-ok`,
            title: 'No obvious info-disclosure headers/body markers',
            severity: 'info',
            category: 'info-disclosure',
            status: 'pass',
            evidence: `${ctx.method} ${ctx.targetUrl} → ${res.status}`,
          },
          res,
        ),
      );
    }
  }

  if (check === 'cache-control') {
    const cc = headerGet(res.headers, 'cache-control');
    if (!cc) {
      findings.push(
        tag(
          {
            id: `${idBase}-cc`,
            title: 'Missing Cache-Control on sensitive-capable response',
            severity: 'low',
            category: 'misconfig',
            status: 'info',
            evidence: `${ctx.method} ${ctx.targetUrl} → ${res.status}`,
            recommendation:
              'For auth/HTML apps prefer Cache-Control: no-store on authenticated pages.',
          },
          res,
        ),
      );
    } else {
      findings.push(
        tag(
          {
            id: `${idBase}-cc-ok`,
            title: 'Cache-Control present',
            severity: 'info',
            category: 'misconfig',
            status: 'pass',
            evidence: `Cache-Control: ${cc}`,
          },
          res,
        ),
      );
    }
  }

  if (check === 'api-location') {
    if (res.status >= 500) {
      findings.push(
        tag(
          {
            id: `${idBase}-5xx`,
            title: 'Location API returned server error',
            severity: 'medium',
            category: 'api',
            status: 'fail',
            evidence: `${ctx.method} ${ctx.targetUrl} → ${res.status}; body=${res.text.slice(0, 300)}`,
            recommendation: 'Validate inputs; return consistent 4xx without leaking internals.',
            owasp: 'A04:2021 Insecure Design',
          },
          res,
        ),
      );
    } else {
      findings.push(
        tag(
          {
            id: `${idBase}-api-ok`,
            title: 'Location API responded without 5xx',
            severity: 'info',
            category: 'api',
            status: 'pass',
            evidence: `${ctx.method} ${ctx.targetUrl} → ${res.status}`,
          },
          res,
        ),
      );
    }
    if (/exception|stack trace/i.test(res.text)) {
      findings.push(
        tag(
          {
            id: `${idBase}-api-leak`,
            title: 'API error body may leak internals',
            severity: 'high',
            category: 'info-disclosure',
            status: 'fail',
            evidence: res.text.slice(0, 400),
            recommendation: 'Sanitize API error responses.',
            owasp: 'A05:2021 Security Misconfiguration',
          },
          res,
        ),
      );
    }
  }

  return findings;
}

export function createVaptSessionSteps(test: VaptTestCase): TestStep[] {
  const { vapt } = test;
  const start = vapt.startUrl || '/login';
  const attacks = vapt.checks;
  const total = countAttacks(attacks);
  return [
    {
      id: 'vapt-prepare',
      label: 'Prepare API VAPT',
      description: `MCP start ${start} · API ${vapt.method || 'GET'} ${vapt.targetUrl} · ${total} attack(s)`,
      status: 'pending',
      action: 'wait',
    },
    {
      id: 'vapt-mcp',
      label: `Open MCP on ${start}`,
      description: 'Evidence browser + network watch before internal scenarios',
      status: 'pending',
      action: 'goto',
    },
    ...attacks.map((check, index) => ({
      id: `vapt-check-${check}`,
      label: `Scenario ${index + 1}/${total} · ${vaptAttackLabel(check)}`,
      description: `Baseline → AI multi queries → on pass AI fail-level · ${vapt.method || 'GET'} ${vapt.targetUrl} · id=${check}`,
      status: 'pending' as const,
      action: 'assertVisible' as const,
    })),
    {
      id: 'vapt-gate',
      label: 'Severity gate + report',
      description: `Fail if any finding ≥ ${vapt.severityGate || 'high'} · all steps/rounds/pass-fail → report`,
      status: 'pending',
      action: 'assertVisible',
    },
  ];
}

export async function runVapt(
  runId: string,
  baseUrl: string,
  test: VaptTestCase,
  opts?: {
    apiUrl?: string;
    runtimeAi?: boolean;
    provider?: AiProviderId | string | null;
    openRouterApiKey?: string | null;
    anthropicApiKey?: string | null;
    model?: string | null;
  },
): Promise<void> {
  const session = getSession(runId);
  if (!session) return;

  const { vapt } = test;
  const targetUrl = resolveVaptTargetUrl(test, baseUrl, opts?.apiUrl);
  const mcpUrl = resolveVaptStartUrl(test, baseUrl);
  const signal = session.abortController.signal;
  const method = vapt.method || 'GET';
  const gate = vapt.severityGate || 'high';
  const runtimeAi = opts?.runtimeAi !== false;
  let findings: VaptFinding[] = [];
  let networkCaptures: VaptNetworkCapture[] = [];
  let aiProbeRounds: VaptAiProbeRoundSummary[] = [];
  let browser: Browser | undefined;
  let cdp: CDPSession | undefined;
  const stepIdRef = { current: 'vapt-mcp' };

  const pushNetwork = (cap: VaptNetworkCapture) => {
    networkCaptures = [...networkCaptures, cap].slice(-80);
    // Avoid emitting a full findings snapshot on every row — batch with existing update cadence
    const session = getSession(runId);
    if (session?.vaptFindings) {
      session.vaptFindings = {
        ...session.vaptFindings,
        networkCaptures,
      };
    }
  };

  try {
    await setRunStatus(runId, 'running');
    updateVaptFindings(runId, emptyMetrics(targetUrl));

    updateStep(runId, 'vapt-prepare', {
      status: 'running',
      message: `Start ${mcpUrl} · probe ${targetUrl}`,
    });
    if (signal.aborted) throw new Error('Stopped');
    updateStep(runId, 'vapt-prepare', {
      status: 'passed',
      message: `Ready · login start · ${vapt.checks.length} attack type(s)`,
      detail: `MCP ${mcpUrl} · API/probe ${targetUrl}`,
    });

    updateStep(runId, 'vapt-mcp', {
      status: 'running',
      message: `Opening login page for MCP… ${mcpUrl}`,
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    attachBrowserNetworkWatcher(page, opts?.apiUrl, pushNetwork, stepIdRef);
    cdp = await attachScreencast(runId, page);
    await page.goto(mcpUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
    // Ensure we stayed on / near login when startUrl is login
    const landed = page.url();
    const jpeg = await captureLivePreviewJpeg(page);
    if (jpeg) setFrame(runId, jpeg);
    const mcpShot = await captureViewportScreenshot(page, runId, 'vapt-mcp');
    updateStep(runId, 'vapt-mcp', {
      status: 'passed',
      message: `MCP on login start · ${landed}`,
      detail: `Started ${mcpUrl} · probe target ${targetUrl}`,
      screenshotPath: mcpShot,
    });

    for (const check of vapt.checks) {
      if (signal.aborted) throw new Error('Stopped');
      const stepId = `vapt-check-${check}`;
      stepIdRef.current = stepId;
      const attackLabel = vaptAttackLabel(check);
      updateStep(runId, stepId, {
        status: 'running',
        message: `Baseline · ${attackLabel}…`,
      });

      // —— 1) Baseline catalogue / legacy probe ——
      const baselineRaw = await runCheck(check, {
        targetUrl,
        baseUrl,
        apiUrl: opts?.apiUrl,
        method,
        headers: vapt.headers,
        body: vapt.body,
        stepId,
        checkId: check,
        signal,
        onNetwork: pushNetwork,
      });
      let batch = tagBaseline(baselineRaw);
      const stepLog: string[] = [
        `=== BASELINE (${batch.length} finding(s)) ===`,
        ...batch.map(
          (f) =>
            `${f.status.toUpperCase()}: ${f.title}` +
            (f.requestUrl ? `\n  ${f.requestMethod} ${f.requestUrl}` : '') +
            (f.requestPayload ? `\n  payload: ${f.requestPayload.slice(0, 120)}` : ''),
        ),
      ];

      // —— 2) Runtime AI multi-query ——
      if (runtimeAi && !signal.aborted) {
        updateStep(runId, stepId, {
          status: 'running',
          message: `AI generating multi queries · ${attackLabel}…`,
          detail: stepLog.join('\n'),
        });
        try {
          const gen = await generateRuntimeProbeQueries({
            checkId: check,
            level: 'multi',
            targetUrl,
            baseUrl,
            method,
            priorFindings: batch,
            provider: opts?.provider,
            openRouterApiKey: opts?.openRouterApiKey,
            anthropicApiKey: opts?.anthropicApiKey,
            model: opts?.model,
            signal,
          });
          updateStep(runId, stepId, {
            status: 'running',
            message: `AI multi · running ${gen.queries.length} queries (${gen.source}/${gen.model})…`,
            detail: stepLog.join('\n'),
          });
          const multiBatch = await executeRuntimeAiQueries(gen.queries, {
            checkId: check,
            stepId,
            signal,
            onNetwork: pushNetwork,
            model: gen.model,
            level: 'multi',
          });
          const stats = countRoundStats(multiBatch);
          aiProbeRounds.push({
            checkId: check,
            level: 'multi',
            status: 'ok',
            model: gen.model,
            queryCount: gen.queries.length,
            passed: stats.passed,
            failed: stats.failed,
            errors: stats.errors,
            detail: `${gen.source} · ${gen.queries.map((q) => q.label).join(', ')}`,
            at: new Date().toISOString(),
          });
          batch = [...batch, ...multiBatch];
          stepLog.push(
            `=== AI MULTI (${gen.source}/${gen.model} · ${multiBatch.length} finding(s)) ===`,
            ...multiBatch.map(
              (f) =>
                `${f.status.toUpperCase()}: ${f.title}` +
                (f.requestUrl ? `\n  ${f.requestMethod} ${f.requestUrl}` : '') +
                (f.requestPayload
                  ? `\n  payload: ${f.requestPayload.slice(0, 120)}`
                  : ''),
            ),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'AI multi failed';
          aiProbeRounds.push({
            checkId: check,
            level: 'multi',
            status: 'error',
            queryCount: 0,
            passed: 0,
            failed: 0,
            errors: 1,
            detail: msg,
            at: new Date().toISOString(),
          });
          stepLog.push(`=== AI MULTI ERROR ===\n${msg}`);
        }
      }

      // —— 3) On pass → AI fail-level escalation ——
      if (runtimeAi && !signal.aborted && checkPassedClean(batch, check)) {
        updateStep(runId, stepId, {
          status: 'running',
          message: `Pass → AI fail-level queries · ${attackLabel}…`,
          detail: stepLog.join('\n'),
        });
        try {
          const gen = await generateRuntimeProbeQueries({
            checkId: check,
            level: 'fail-level',
            targetUrl,
            baseUrl,
            method,
            priorFindings: batch.filter((f) => f.checkId === check),
            provider: opts?.provider,
            openRouterApiKey: opts?.openRouterApiKey,
            anthropicApiKey: opts?.anthropicApiKey,
            model: opts?.model,
            signal,
          });
          updateStep(runId, stepId, {
            status: 'running',
            message: `AI fail-level · running ${gen.queries.length} queries (${gen.source}/${gen.model})…`,
            detail: stepLog.join('\n'),
          });
          const flBatch = await executeRuntimeAiQueries(gen.queries, {
            checkId: check,
            stepId,
            signal,
            onNetwork: pushNetwork,
            model: gen.model,
            level: 'fail-level',
          });
          const stats = countRoundStats(flBatch);
          aiProbeRounds.push({
            checkId: check,
            level: 'fail-level',
            status: 'ok',
            model: gen.model,
            queryCount: gen.queries.length,
            passed: stats.passed,
            failed: stats.failed,
            errors: stats.errors,
            detail: `${gen.source} · ${gen.queries.map((q) => q.label).join(', ')}`,
            at: new Date().toISOString(),
          });
          batch = [...batch, ...flBatch];
          stepLog.push(
            `=== AI FAIL-LEVEL (${gen.source}/${gen.model} · ${flBatch.length} finding(s)) ===`,
            ...flBatch.map(
              (f) =>
                `${f.status.toUpperCase()}: ${f.title}` +
                (f.requestUrl ? `\n  ${f.requestMethod} ${f.requestUrl}` : '') +
                (f.requestPayload
                  ? `\n  payload: ${f.requestPayload.slice(0, 120)}`
                  : ''),
            ),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'AI fail-level failed';
          aiProbeRounds.push({
            checkId: check,
            level: 'fail-level',
            status: 'error',
            queryCount: 0,
            passed: 0,
            failed: 0,
            errors: 1,
            detail: msg,
            at: new Date().toISOString(),
          });
          stepLog.push(`=== AI FAIL-LEVEL ERROR ===\n${msg}`);
        }
      } else if (runtimeAi && !checkPassedClean(batch, check)) {
        aiProbeRounds.push({
          checkId: check,
          level: 'fail-level',
          status: 'skipped',
          queryCount: 0,
          passed: 0,
          failed: 0,
          errors: 0,
          detail: 'Skipped — baseline/multi already failed (no escalation needed)',
          at: new Date().toISOString(),
        });
        stepLog.push('=== AI FAIL-LEVEL SKIPPED (already failed) ===');
      }

      await paintAttackEvidence(page, {
        checkId: check,
        title: `Scenario report · ${check}`,
        findings: batch,
        targetUrl,
      });
      const jpeg2 = await captureLivePreviewJpeg(page);
      if (jpeg2) setFrame(runId, jpeg2);
      const shotPath = await captureViewportScreenshot(page, runId, stepId);
      const withShot = batch.map((f) => ({
        ...f,
        screenshotPath: f.screenshotPath || shotPath,
      }));
      findings = [...findings, ...withShot];
      updateVaptFindings(
        runId,
        summarize(findings, targetUrl, networkCaptures, aiProbeRounds),
      );

      const failed = batch.filter((f) => f.status === 'fail' || f.status === 'error').length;
      const rounds = batch.reduce(
        (acc, f) => {
          const r = f.probeRound || 'baseline';
          acc[r] = (acc[r] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      updateStep(runId, stepId, {
        status: failed ? 'failed' : 'passed',
        message: failed
          ? `${failed} finding(s) failed · rounds baseline/${rounds.baseline || 0} multi/${rounds['ai-multi'] || 0} fail-level/${rounds['ai-fail-level'] || 0}`
          : `PASS · ${batch.length} finding(s) · baseline + AI rounds logged`,
        detail: stepLog.join('\n'),
        screenshotPath: shotPath,
      });
    }

    stepIdRef.current = 'vapt-gate';
    updateStep(runId, 'vapt-gate', { status: 'running' });
    const metrics = summarize(findings, targetUrl, networkCaptures, aiProbeRounds);
    updateVaptFindings(runId, metrics);
    const failGate = gateFails(findings, gate);
    if (failGate) {
      updateStep(runId, 'vapt-gate', {
        status: 'failed',
        message: `Severity gate (${gate}) triggered`,
        detail: `${metrics.failed} fail · ${metrics.passed} pass · ${networkCaptures.length} network · ${aiProbeRounds.length} AI round(s)`,
      });
      skipRemainingSteps(runId, 'Severity gate failed');
      await setRunStatus(
        runId,
        'failed',
        `VAPT gate failed: one or more findings at ≥ ${gate}`,
      );
      return;
    }

    updateStep(runId, 'vapt-gate', {
      status: 'passed',
      message: `Gate ${gate} clear`,
      detail: `${metrics.failed} fail · ${metrics.passed} pass · ${networkCaptures.length} network · ${aiProbeRounds.length} AI round(s) → report`,
    });
    await setRunStatus(runId, 'completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'VAPT run failed';
    if (message === 'Stopped' || signal.aborted) {
      skipRemainingSteps(runId, 'Stopped by user');
      await setRunStatus(runId, 'stopped');
      return;
    }
    skipRemainingSteps(runId, message);
    await setRunStatus(runId, 'failed', message);
  } finally {
    await stopScreencast(cdp);
    cdp = undefined;
    await browser?.close().catch(() => undefined);
    browser = undefined;
  }
}
