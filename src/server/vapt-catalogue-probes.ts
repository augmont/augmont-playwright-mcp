/**
 * Safe defensive probes for the VAPT attack catalogue.
 * No exploit payloads, malware, flooding, or credential guessing —
 * only hygiene markers and posture checks.
 */
import type {
  VaptCheckId,
  VaptFinding,
  VaptFindingStatus,
  VaptSeverity,
  VaptCheckCategory,
} from '@/lib/types';
import { vaptAttackLabel } from '@/lib/vapt-attacks';

export type CatalogueProbeCtx = {
  targetUrl: string;
  baseUrl: string;
  apiUrl?: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  stepId: string;
  checkId: VaptCheckId;
  signal: AbortSignal;
  onNetwork: (cap: {
    id: string;
    at: string;
    method: string;
    url: string;
    status?: number;
    requestPayload?: string;
    responseSnippet?: string;
    stepId?: string;
    checkId?: string;
    source: 'probe' | 'browser';
  }) => void;
};

type ProbeRes = {
  status: number;
  headers: Headers;
  text: string;
  method: string;
  url: string;
  requestPayload?: string;
};

async function probeFetch(
  ctx: CatalogueProbeCtx,
  url: string,
  method: string,
  headers?: Record<string, string>,
  body?: string,
): Promise<ProbeRes> {
  const reqPayload =
    method === 'GET' || method === 'HEAD' ? undefined : body?.slice(0, 4000);
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    redirect: 'manual',
    signal: ctx.signal,
  });
  const text = (await res.text().catch(() => '')).slice(0, 8000);
  ctx.onNetwork({
    id: `net-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
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
  return {
    status: res.status,
    headers: res.headers,
    text,
    method,
    url,
    requestPayload: reqPayload,
  };
}

function finding(
  ctx: CatalogueProbeCtx,
  partial: {
    idSuffix: string;
    title: string;
    severity: VaptSeverity;
    category: VaptCheckCategory;
    status: VaptFindingStatus;
    evidence?: string;
    recommendation?: string;
    owasp?: string;
    cwe?: string;
    probe?: ProbeRes;
  },
): VaptFinding {
  const f: VaptFinding = {
    id: `${ctx.checkId}-${partial.idSuffix}`,
    title: partial.title,
    severity: partial.severity,
    category: partial.category,
    status: partial.status,
    evidence: partial.evidence,
    recommendation: partial.recommendation,
    owasp: partial.owasp,
    cwe: partial.cwe,
    stepId: ctx.stepId,
    checkId: ctx.checkId,
  };
  if (partial.probe) {
    f.requestMethod = partial.probe.method;
    f.requestUrl = partial.probe.url;
    f.requestPayload = partial.probe.requestPayload;
    f.responseStatus = partial.probe.status;
    f.responseSnippet = partial.probe.text.slice(0, 500);
  }
  return f;
}

function loginUrl(ctx: CatalogueProbeCtx): string {
  return `${ctx.baseUrl.replace(/\/+$/, '')}/login`;
}

function apiOrTarget(ctx: CatalogueProbeCtx): string {
  return ctx.targetUrl;
}

/**
 * Returns findings for catalogue attack ids, or null to fall through to legacy checks.
 */
export async function runCatalogueAttackProbe(
  check: VaptCheckId,
  ctx: CatalogueProbeCtx,
): Promise<VaptFinding[] | null> {
  const label = vaptAttackLabel(check);

  switch (check) {
    case 'brute-force': {
      const url = loginUrl(ctx);
      const statuses: number[] = [];
      let rateLimited = false;
      for (let i = 0; i < 5; i++) {
        const res = await probeFetch(
          ctx,
          url,
          'POST',
          { 'Content-Type': 'application/json' },
          JSON.stringify({
            email: `lgd_vapt_bf_${i}@example.invalid`,
            password: 'lgd_vapt_not_a_real_password',
          }),
        );
        statuses.push(res.status);
        const retry = res.headers.get('retry-after');
        if (res.status === 429 || retry) rateLimited = true;
      }
      if (rateLimited) {
        return [
          finding(ctx, {
            idSuffix: 'ok',
            title: `${label} — rate limit / lockout signals observed`,
            severity: 'info',
            category: 'rate-limit',
            status: 'pass',
            evidence: `5 gentle login posts → ${statuses.join(',')}`,
            recommendation: 'Keep account lockout + progressive delays + CAPTCHA after N failures.',
            owasp: 'A07:2021 Identification and Authentication Failures',
            cwe: 'CWE-307',
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'norate',
          title: `${label} — no rate-limit signal after repeated login posts`,
          severity: 'medium',
          category: 'rate-limit',
          status: 'fail',
          evidence: `Statuses ${statuses.join(',')} (5 posts only — not a password spray)`,
          recommendation:
            'Add 429 / Retry-After, lockout, and monitoring for repeated failed logins.',
          owasp: 'A07:2021 Identification and Authentication Failures',
          cwe: 'CWE-307',
        }),
      ];
    }

    case 'ddos-rate-limit': {
      const url = apiOrTarget(ctx);
      const statuses: number[] = [];
      let limited = false;
      // Tiny burst only (not a flood)
      for (let i = 0; i < 8; i++) {
        const res = await probeFetch(ctx, url, 'GET', ctx.headers);
        statuses.push(res.status);
        if (
          res.status === 429 ||
          res.headers.get('retry-after') ||
          /rate.?limit/i.test(res.headers.get('x-ratelimit-remaining') || '')
        ) {
          limited = true;
        }
        if (res.headers.get('x-ratelimit-limit') || res.headers.get('x-ratelimit-remaining')) {
          limited = true;
        }
      }
      if (limited) {
        return [
          finding(ctx, {
            idSuffix: 'ok',
            title: `${label} — rate-limit headers / 429 present`,
            severity: 'info',
            category: 'rate-limit',
            status: 'pass',
            evidence: `Burst of 8 GETs → ${statuses.join(',')}`,
            recommendation: 'Keep edge WAF / API gateway quotas in production.',
            owasp: 'A04:2021 Insecure Design',
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'missing',
          title: `${label} — no obvious rate-limit posture on quick burst`,
          severity: 'medium',
          category: 'rate-limit',
          status: 'fail',
          evidence: `8 GETs (safe burst) → ${statuses.join(',')}`,
          recommendation:
            'Configure API/gateway rate limits and return 429. This probe never floods.',
          owasp: 'A04:2021 Insecure Design',
        }),
      ];
    }

    case 'sql-injection-surface': {
      const marker = `lgd_sqli_marker_'"`;
      const body = JSON.stringify({ q: marker, id: marker, search: marker });
      const res = await probeFetch(
        ctx,
        apiOrTarget(ctx),
        ctx.method === 'GET' ? 'POST' : ctx.method,
        { ...(ctx.headers || {}), 'Content-Type': 'application/json' },
        body,
      );
      if (/sql syntax|mysql|postgres|ora-\d|sqlite/i.test(res.text)) {
        return [
          finding(ctx, {
            idSuffix: 'leak',
            title: `${label} — database error text in response`,
            severity: 'high',
            category: 'injection-surface',
            status: 'fail',
            evidence: res.text.slice(0, 400),
            recommendation: 'Use parameterized queries; generic client errors only.',
            owasp: 'A03:2021 Injection',
            cwe: 'CWE-89',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — no SQL error leakage on marker input`,
          severity: 'info',
          category: 'injection-surface',
          status: 'pass',
          evidence: `${res.method} → ${res.status}`,
          recommendation: 'Keep ORM/parameter binding on all query paths.',
          owasp: 'A03:2021 Injection',
          probe: res,
        }),
      ];
    }

    case 'xss-reflection': {
      const marker = '<lgd_vapt_xss>';
      const body = JSON.stringify({ name: marker, comment: marker, q: marker });
      const res = await probeFetch(
        ctx,
        apiOrTarget(ctx),
        ctx.method === 'GET' ? 'POST' : ctx.method,
        { ...(ctx.headers || {}), 'Content-Type': 'application/json' },
        body,
      );
      const reflected = res.text.includes(marker);
      if (reflected) {
        return [
          finding(ctx, {
            idSuffix: 'reflect',
            title: `${label} — XSS marker reflected unescaped`,
            severity: 'high',
            category: 'xss',
            status: 'fail',
            evidence: 'Marker present in API/HTML response',
            recommendation: 'Encode output; enforce CSP on portal pages.',
            owasp: 'A03:2021 Injection',
            cwe: 'CWE-79',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — marker not reflected raw`,
          severity: 'info',
          category: 'xss',
          status: 'pass',
          evidence: `${res.status}`,
          recommendation: 'Keep CSP + output encoding on any HTML rendering paths.',
          owasp: 'A03:2021 Injection',
          probe: res,
        }),
      ];
    }

    case 'csrf-surface': {
      const res = await probeFetch(ctx, loginUrl(ctx), 'GET');
      const hasToken =
        /csrf|xsrf|_token|anti.?forgery/i.test(res.text) ||
        /csrf|xsrf/i.test(res.headers.get('set-cookie') || '');
      const setCookie = res.headers.get('set-cookie') || '';
      const sameSite = /samesite=/i.test(setCookie);
      if (hasToken || sameSite) {
        return [
          finding(ctx, {
            idSuffix: 'ok',
            title: `${label} — CSRF token and/or SameSite cookie signals present`,
            severity: 'info',
            category: 'csrf',
            status: 'pass',
            evidence: `tokenHint=${hasToken} sameSiteHint=${sameSite}`,
            recommendation: 'Require anti-CSRF on state-changing routes; SameSite=Lax/Strict.',
            owasp: 'A01:2021 Broken Access Control',
            cwe: 'CWE-352',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'weak',
          title: `${label} — no obvious CSRF token / SameSite on login`,
          severity: 'medium',
          category: 'csrf',
          status: 'fail',
          evidence: 'Login GET lacked csrf/xsrf markers and SameSite cookies',
          recommendation: 'Add CSRF tokens for cookie-auth POSTs; set SameSite on session cookies.',
          owasp: 'A01:2021 Broken Access Control',
          cwe: 'CWE-352',
          probe: res,
        }),
      ];
    }

    case 'rce-surface':
    case 'command-injection-surface': {
      const marker = 'lgd_cmd_marker';
      const body = JSON.stringify({
        cmd: marker,
        exec: marker,
        input: `${marker};id`,
      });
      const res = await probeFetch(
        ctx,
        apiOrTarget(ctx),
        'POST',
        { ...(ctx.headers || {}), 'Content-Type': 'application/json' },
        body,
      );
      if (/uid=\d+|bin\/sh|command not found|powershell/i.test(res.text)) {
        return [
          finding(ctx, {
            idSuffix: 'leak',
            title: `${label} — OS/shell output patterns in response`,
            severity: 'critical',
            category: 'injection-surface',
            status: 'fail',
            evidence: res.text.slice(0, 400),
            recommendation: 'Never pass user input to shell/exec; allow-list inputs.',
            owasp: 'A03:2021 Injection',
            cwe: 'CWE-78',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — no shell/exec leakage on marker body`,
          severity: 'info',
          category: 'injection-surface',
          status: 'pass',
          evidence: `${res.status}`,
          recommendation: 'Keep a ban on child_process / Runtime.exec with user data.',
          owasp: 'A03:2021 Injection',
          probe: res,
        }),
      ];
    }

    case 'directory-traversal': {
      const pathProbe = `${ctx.baseUrl.replace(/\/+$/, '')}/static/../../etc/passwd`;
      const res = await probeFetch(ctx, pathProbe, 'GET');
      if (/root:.*:0:0:/.test(res.text) || res.status === 200 && /passwd/i.test(res.text)) {
        return [
          finding(ctx, {
            idSuffix: 'hit',
            title: `${label} — traversal probe returned sensitive-looking body`,
            severity: 'critical',
            category: 'traversal',
            status: 'fail',
            evidence: res.text.slice(0, 200),
            recommendation: 'Normalize paths; reject .. segments; serve only under web root.',
            owasp: 'A01:2021 Broken Access Control',
            cwe: 'CWE-22',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — traversal path not exposed`,
          severity: 'info',
          category: 'traversal',
          status: res.status === 404 || res.status === 403 || res.status >= 400 ? 'pass' : 'info',
          evidence: `GET ${pathProbe} → ${res.status}`,
          recommendation: 'Keep path canonicalization at the reverse proxy and app.',
          owasp: 'A01:2021 Broken Access Control',
          probe: res,
        }),
      ];
    }

    case 'file-upload-surface':
    case 'malware-upload-surface': {
      const uploadUrl = `${(ctx.apiUrl || ctx.baseUrl).replace(/\/+$/, '')}/upload`;
      const res = await probeFetch(ctx, uploadUrl, 'POST', {
        'Content-Type': 'application/octet-stream',
      }, 'lgd_vapt_upload_probe');
      if (res.status === 200 || res.status === 201) {
        return [
          finding(ctx, {
            idSuffix: 'open',
            title: `${label} — upload endpoint accepted unauth/binary probe`,
            severity: 'high',
            category: 'upload',
            status: 'fail',
            evidence: `POST ${uploadUrl} → ${res.status}`,
            recommendation:
              'Require auth, MIME/allow-list, size limits, and store outside web root. Never allow executable uploads.',
            owasp: 'A04:2021 Insecure Design',
            cwe: 'CWE-434',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — upload not openly accepted`,
          severity: 'info',
          category: 'upload',
          status: 'pass',
          evidence: `POST ${uploadUrl} → ${res.status}`,
          recommendation: 'Keep malware scanning + extension allow-lists on real upload APIs.',
          owasp: 'A04:2021 Insecure Design',
          probe: res,
        }),
      ];
    }

    case 'privilege-escalation': {
      const adminApi = `${(ctx.apiUrl || ctx.baseUrl).replace(/\/+$/, '')}/admin`;
      const paths = [adminApi, `${ctx.baseUrl.replace(/\/+$/, '')}/admin`, apiOrTarget(ctx)];
      const findings: VaptFinding[] = [];
      for (const [i, url] of paths.entries()) {
        const res = await probeFetch(ctx, url, 'GET');
        const denied = res.status === 401 || res.status === 403 || res.status === 302 || res.status === 301;
        if (res.status === 200 && !/login/i.test(res.headers.get('location') || '')) {
          findings.push(
            finding(ctx, {
              idSuffix: `open-${i}`,
              title: `${label} — elevated path returned 200 without auth`,
              severity: 'critical',
              category: 'access-control',
              status: 'fail',
              evidence: `GET ${url} → ${res.status}`,
              recommendation: 'Enforce role checks server-side on every admin/privileged route.',
              owasp: 'A01:2021 Broken Access Control',
              cwe: 'CWE-269',
              probe: res,
            }),
          );
        } else {
          findings.push(
            finding(ctx, {
              idSuffix: `ok-${i}`,
              title: `${label} — privileged path denied/redirected`,
              severity: 'info',
              category: 'access-control',
              status: denied || res.status >= 400 ? 'pass' : 'info',
              evidence: `GET ${url} → ${res.status}`,
              owasp: 'A01:2021 Broken Access Control',
              probe: res,
            }),
          );
        }
      }
      return findings;
    }

    case 'session-hijacking': {
      const res = await probeFetch(ctx, loginUrl(ctx), 'GET');
      const cookies =
        typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : res.headers.get('set-cookie')
            ? [res.headers.get('set-cookie')!]
            : [];
      if (!cookies.length) {
        return [
          finding(ctx, {
            idSuffix: 'none',
            title: `${label} — no Set-Cookie on login GET`,
            severity: 'info',
            category: 'session',
            status: 'info',
            evidence: `${res.status}`,
            recommendation: 'Validate session cookies after auth for HttpOnly; Secure; SameSite.',
            owasp: 'A07:2021 Identification and Authentication Failures',
            probe: res,
          }),
        ];
      }
      const findings: VaptFinding[] = [];
      for (const [i, c] of cookies.entries()) {
        const missing: string[] = [];
        if (!/; *httponly/i.test(c)) missing.push('HttpOnly');
        if (!/; *secure/i.test(c) && loginUrl(ctx).startsWith('https:')) missing.push('Secure');
        if (!/; *samesite=/i.test(c)) missing.push('SameSite');
        findings.push(
          finding(ctx, {
            idSuffix: `c${i}`,
            title: missing.length
              ? `${label} — cookie missing ${missing.join(', ')}`
              : `${label} — cookie flags present`,
            severity: missing.includes('HttpOnly') ? 'high' : missing.length ? 'medium' : 'info',
            category: 'session',
            status: missing.length ? 'fail' : 'pass',
            evidence: c.slice(0, 220),
            recommendation: 'HttpOnly + Secure + SameSite blocks most session theft via XSS/MITM.',
            owasp: 'A07:2021 Identification and Authentication Failures',
            cwe: 'CWE-614',
            probe: res,
          }),
        );
      }
      return findings;
    }

    case 'mitm-tls': {
      try {
        const u = new URL(ctx.baseUrl);
        if (u.protocol === 'http:' && !/localhost|127\.0\.0\.1|\.local$/i.test(u.hostname)) {
          return [
            finding(ctx, {
              idSuffix: 'http',
              title: `${label} — portal uses HTTP (MITM risk)`,
              severity: 'high',
              category: 'tls-transport',
              status: 'fail',
              evidence: ctx.baseUrl,
              recommendation: 'Force HTTPS + HSTS at the edge.',
              owasp: 'A02:2021 Cryptographic Failures',
              cwe: 'CWE-319',
            }),
          ];
        }
        return [
          finding(ctx, {
            idSuffix: 'ok',
            title: `${label} — transport scheme acceptable for this host`,
            severity: 'info',
            category: 'tls-transport',
            status: 'pass',
            evidence: `${u.protocol}//${u.hostname}`,
            recommendation: 'Prefer TLS 1.2+ and HSTS in non-local environments.',
            owasp: 'A02:2021 Cryptographic Failures',
          }),
        ];
      } catch (err) {
        return [
          finding(ctx, {
            idSuffix: 'err',
            title: `${label} — could not parse baseUrl`,
            severity: 'medium',
            category: 'tls-transport',
            status: 'error',
            evidence: err instanceof Error ? err.message : 'parse error',
          }),
        ];
      }
    }

    case 'ssrf-surface': {
      const body = JSON.stringify({
        url: 'http://127.0.0.1:9/lgd_vapt_ssrf',
        callback: 'http://169.254.169.254/latest/meta-data/',
        webhook: 'http://localhost/lgd_vapt',
      });
      const res = await probeFetch(
        ctx,
        apiOrTarget(ctx),
        'POST',
        { ...(ctx.headers || {}), 'Content-Type': 'application/json' },
        body,
      );
      if (/meta-data|ami-id|compute metadata|connection refused to 127|ECONNREFUSED/i.test(res.text)) {
        return [
          finding(ctx, {
            idSuffix: 'leak',
            title: `${label} — response suggests server followed internal URL`,
            severity: 'high',
            category: 'ssrf',
            status: 'fail',
            evidence: res.text.slice(0, 400),
            recommendation: 'Block link-local/meta/private ranges; allow-list outbound hosts.',
            owasp: 'A10:2021 SSRF',
            cwe: 'CWE-918',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — no internal-metadata leakage on URL fields`,
          severity: 'info',
          category: 'ssrf',
          status: 'pass',
          evidence: `${res.status}`,
          recommendation: 'Validate/allow-list any server-side URL fetch features.',
          owasp: 'A10:2021 SSRF',
          probe: res,
        }),
      ];
    }

    case 'xxe-surface': {
      // Benign XXE-shaped payload — should be rejected / not expand entities
      const xml =
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/hosts">]><foo>&xxe;</foo>';
      const res = await probeFetch(
        ctx,
        apiOrTarget(ctx),
        'POST',
        { 'Content-Type': 'application/xml' },
        xml,
      );
      if (/localhost|127\.0\.0\.1|##|# Host Database/i.test(res.text) && res.status === 200) {
        return [
          finding(ctx, {
            idSuffix: 'expand',
            title: `${label} — XML entity expansion / file content suspected`,
            severity: 'critical',
            category: 'xxe',
            status: 'fail',
            evidence: res.text.slice(0, 300),
            recommendation: 'Disable external entities; prefer JSON APIs.',
            owasp: 'A05:2021 Security Misconfiguration',
            cwe: 'CWE-611',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — XML entity probe not expanded`,
          severity: 'info',
          category: 'xxe',
          status: 'pass',
          evidence: `${res.status}`,
          recommendation: 'Keep XXE disabled in XML parsers.',
          owasp: 'A05:2021 Security Misconfiguration',
          probe: res,
        }),
      ];
    }

    case 'deserialization-surface': {
      const res = await probeFetch(
        ctx,
        apiOrTarget(ctx),
        'POST',
        { 'Content-Type': 'application/x-java-serialized-object' },
        'lgd_vapt_deser_probe',
      );
      if (res.status === 200 || res.status === 201) {
        return [
          finding(ctx, {
            idSuffix: 'accept',
            title: `${label} — unusual binary Content-Type accepted`,
            severity: 'high',
            category: 'api',
            status: 'fail',
            evidence: `${res.status}`,
            recommendation: 'Reject unexpected Content-Types; never deserialize untrusted blobs.',
            owasp: 'A08:2021 Software and Data Integrity Failures',
            cwe: 'CWE-502',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — unusual Content-Type rejected`,
          severity: 'info',
          category: 'api',
          status: 'pass',
          evidence: `${res.status}`,
          recommendation: 'Keep strict Content-Type allow-lists on APIs.',
          owasp: 'A08:2021 Software and Data Integrity Failures',
          probe: res,
        }),
      ];
    }

    case 'api-abuse': {
      const url = apiOrTarget(ctx);
      const stripped = { ...(ctx.headers || {}) };
      delete stripped.Authorization;
      delete stripped.authorization;
      const res = await probeFetch(ctx, url, ctx.method || 'POST', stripped, ctx.body || '{}');
      const rate =
        res.status === 429 ||
        Boolean(res.headers.get('x-ratelimit-limit') || res.headers.get('retry-after'));
      const denied = res.status === 401 || res.status === 403;
      if (res.status === 200 || res.status === 201) {
        return [
          finding(ctx, {
            idSuffix: 'weak',
            title: `${label} — API accepted anonymous call (authz/rate gap)`,
            severity: 'high',
            category: 'api',
            status: 'fail',
            evidence: `${res.method} ${url} → ${res.status}`,
            recommendation: 'Require auth + scopes; add quotas; monitor abuse patterns.',
            owasp: 'A01:2021 Broken Access Control',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — anonymous call denied${rate ? ' / rate-limited' : ''}`,
          severity: 'info',
          category: 'api',
          status: denied || rate ? 'pass' : 'info',
          evidence: `${res.status}`,
          recommendation: 'Keep authN/Z + rate limits on all mutating APIs.',
          owasp: 'A01:2021 Broken Access Control',
          probe: res,
        }),
      ];
    }

    case 'phishing-credential-surface': {
      const res = await probeFetch(ctx, loginUrl(ctx), 'GET');
      const hasPassword = /type=["']password["']/i.test(res.text);
      const autocompleteOff = /autocomplete=["']off["']/i.test(res.text);
      const httpsOk = loginUrl(ctx).startsWith('https:') || /localhost|127\.0\.0\.1/.test(loginUrl(ctx));
      if (hasPassword && !httpsOk) {
        return [
          finding(ctx, {
            idSuffix: 'http-login',
            title: `${label} — password form over HTTP`,
            severity: 'high',
            category: 'auth',
            status: 'fail',
            evidence: loginUrl(ctx),
            recommendation: 'Serve login only on HTTPS; enable HSTS.',
            owasp: 'A02:2021 Cryptographic Failures',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — login surface notes`,
          severity: 'info',
          category: 'auth',
          status: 'pass',
          evidence: `passwordField=${hasPassword} autocompleteOff=${autocompleteOff} httpsOrLocal=${httpsOk}`,
          recommendation:
            'Educate users on phishing; enforce MFA; never put API keys in client pages.',
          owasp: 'A07:2021 Identification and Authentication Failures',
          probe: res,
        }),
      ];
    }

    case 'zero-day-posture': {
      const res = await probeFetch(ctx, loginUrl(ctx), 'GET');
      const csp = res.headers.get('content-security-policy');
      const xfo = res.headers.get('x-frame-options');
      const xcto = res.headers.get('x-content-type-options');
      const missing = [
        !csp && 'CSP',
        !xfo && 'X-Frame-Options',
        !xcto && 'X-Content-Type-Options',
      ].filter(Boolean);
      if (missing.length) {
        return [
          finding(ctx, {
            idSuffix: 'gaps',
            title: `${label} — baseline headers missing (${missing.join(', ')})`,
            severity: 'medium',
            category: 'misconfig',
            status: 'fail',
            evidence: `Missing: ${missing.join(', ')}`,
            recommendation:
              'Maintain patch SLAs, WAF, dependency scanning, and baseline security headers to shrink zero-day blast radius.',
            owasp: 'A06:2021 Vulnerable and Outdated Components',
            probe: res,
          }),
        ];
      }
      return [
        finding(ctx, {
          idSuffix: 'ok',
          title: `${label} — baseline header controls present`,
          severity: 'info',
          category: 'misconfig',
          status: 'pass',
          evidence: 'CSP / XFO / XCTO present',
          recommendation: 'Continue SBOM + rapid patching; headers alone are not a zero-day cure.',
          owasp: 'A06:2021 Vulnerable and Outdated Components',
          probe: res,
        }),
      ];
    }

    default:
      return null;
  }
}
