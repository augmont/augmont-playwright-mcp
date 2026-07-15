/**
 * Runtime AI for VAPT attack probes:
 * 1) Generate multiple safe hygiene query variants per check
 * 2) On pass, escalate to fail-level (harder marker / edge-case) variants
 *
 * Never invent weaponized exploits — only defensive posture markers.
 */
import {
  DEFAULT_OPENROUTER_MODEL,
  resolveOpenRouterModelChain,
} from '@/lib/openrouter-models';
import {
  DEFAULT_CLAUDE_MODEL,
  CLAUDE_MODELS,
  normalizeClaudeModelId,
  resolveAiProvider,
  type AiProviderId,
} from '@/lib/ai-provider';
import {
  callOpenRouterChat,
  extractJsonFromModelText,
  getOpenRouterApiKey,
} from '@/server/openrouter';
import {
  callAnthropicChat,
  requireAnthropicApiKey,
} from '@/server/anthropic';
import type {
  VaptCheckId,
  VaptFinding,
  VaptProbeRound,
} from '@/lib/types';
import { vaptAttackLabel } from '@/lib/vapt-attacks';

export type VaptAiQueryLevel = 'multi' | 'fail-level';

export type VaptRuntimeAiQuery = {
  id: string;
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  /** Absolute URL or path relative to target/base */
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Regex-like substrings — if response matches → fail */
  failIfContains?: string[];
  /** Optional note for evidence */
  note?: string;
};

export type GenerateRuntimeQueriesResult = {
  queries: VaptRuntimeAiQuery[];
  model: string;
  source: 'ai' | 'fallback';
  level: VaptAiQueryLevel;
};

const SYSTEM_PROMPT = `You are a defensive API VAPT probe author for Augmont LGD Portal.
Return ONLY valid JSON (no markdown) matching:
{
  "queries": [
    {
      "id": "q1",
      "label": "short name",
      "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"HEAD",
      "url": "absolute https URL or path starting with /",
      "headers": { "Content-Type": "application/json" },
      "body": "optional string body",
      "failIfContains": ["optional substring that indicates a vulnerability / hygiene failure"],
      "note": "why this probe matters"
    }
  ]
}

STRICT RULES:
- Generate 2–4 DISTINCT hygiene probe variants (never more than 4).
- Use ONLY safe markers containing "lgd_vapt" (e.g. lgd_vapt_sqli_'\\", <lgd_vapt_xss>, lgd_vapt_cmd).
- Do NOT invent real exploit payloads, malware, password sprays, or flood traffic.
- Do NOT send more than one request per query object (the runner sends each once).
- Prefer the provided targetUrl; relative paths are OK.
- failIfContains should detect leakage (SQL errors, reflected markers, shell output, stack traces, /etc/passwd, etc.).
- For level "fail-level": craft HARDER edge-case variants (encoding, nested JSON keys, alternate field names, header tricks) still using only lgd_vapt markers — not weaponized exploits.
- For level "multi": craft several complementary safe variants of the same attack class.
`;

function levelToRound(level: VaptAiQueryLevel): VaptProbeRound {
  return level === 'fail-level' ? 'ai-fail-level' : 'ai-multi';
}

export { levelToRound };

function sanitizeQuery(
  raw: unknown,
  index: number,
  targetUrl: string,
): VaptRuntimeAiQuery | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const methodRaw = String(o.method || 'POST').toUpperCase();
  const method = (
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(methodRaw)
      ? methodRaw
      : 'POST'
  ) as VaptRuntimeAiQuery['method'];
  let url = String(o.url || targetUrl).trim();
  if (!url) url = targetUrl;
  if (url.startsWith('/') && /^https?:\/\//i.test(targetUrl)) {
    try {
      url = new URL(url, targetUrl).toString();
    } catch {
      url = targetUrl;
    }
  }
  if (!/^https?:\/\//i.test(url)) return null;

  let body =
    typeof o.body === 'string'
      ? o.body
      : o.body != null
        ? JSON.stringify(o.body)
        : undefined;
  // Soft-enforce marker presence for injection-style bodies
  if (body && body.length > 8000) body = body.slice(0, 8000);

  const headers =
    o.headers && typeof o.headers === 'object' && !Array.isArray(o.headers)
      ? Object.fromEntries(
          Object.entries(o.headers as Record<string, unknown>)
            .filter(([, v]) => v != null)
            .map(([k, v]) => [k, String(v)]),
        )
      : undefined;

  const failIfContains = Array.isArray(o.failIfContains)
    ? o.failIfContains.map((s) => String(s)).filter(Boolean).slice(0, 8)
    : undefined;

  return {
    id: String(o.id || `q${index + 1}`).slice(0, 64),
    label: String(o.label || `AI query ${index + 1}`).slice(0, 120),
    method,
    url,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    failIfContains,
    note: o.note != null ? String(o.note).slice(0, 400) : undefined,
  };
}

function parseQueries(data: unknown, targetUrl: string): VaptRuntimeAiQuery[] {
  const root =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { queries: data };
  const list = Array.isArray(root.queries) ? root.queries : [];
  const out: VaptRuntimeAiQuery[] = [];
  for (let i = 0; i < list.length && out.length < 4; i++) {
    const q = sanitizeQuery(list[i], i, targetUrl);
    if (q) out.push(q);
  }
  return out;
}

/** Deterministic fallbacks when AI is unavailable. */
export function fallbackRuntimeQueries(
  checkId: VaptCheckId,
  level: VaptAiQueryLevel,
  targetUrl: string,
  baseUrl: string,
): VaptRuntimeAiQuery[] {
  const login = `${baseUrl.replace(/\/+$/, '')}/login`;
  const api = targetUrl;
  const multi = level === 'multi';
  const label = vaptAttackLabel(checkId);

  switch (checkId) {
    case 'sql-injection-surface':
      return multi
        ? [
            {
              id: 'fb-sqli-1',
              label: `${label} · marker in q`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ q: `lgd_vapt_sqli_'"`, search: `lgd_vapt_sqli_'` }),
              failIfContains: ['sql syntax', 'mysql', 'postgres', 'ORA-', 'sqlite'],
            },
            {
              id: 'fb-sqli-2',
              label: `${label} · marker in id`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: `lgd_vapt_sqli_1 OR 1=1`, filter: `lgd_vapt_sqli_` }),
              failIfContains: ['sql syntax', 'mysql', 'postgres', 'ORA-'],
            },
            {
              id: 'fb-sqli-3',
              label: `${label} · nested field`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: { value: "lgd_vapt_sqli_';--" } }),
              failIfContains: ['sql syntax', 'syntax error', 'mysql'],
            },
          ]
        : [
            {
              id: 'fb-sqli-fl-1',
              label: `${label} · fail-level union marker`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                q: `lgd_vapt_sqli_' UNION SELECT null--`,
                orderBy: `lgd_vapt_sqli_; DROP`,
              }),
              failIfContains: ['sql syntax', 'mysql', 'postgres', 'ORA-', 'sqlite', 'syntax error'],
              note: 'Harder marker shape — still hygiene only',
            },
            {
              id: 'fb-sqli-fl-2',
              label: `${label} · fail-level encoded quotes`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                search: `lgd_vapt_sqli_%27%20OR%20%271%27%3D%271`,
              }),
              failIfContains: ['sql syntax', 'mysql', 'postgres'],
            },
            {
              id: 'fb-sqli-fl-3',
              label: `${label} · fail-level multi-key`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: `lgd_vapt_sqli_'@x.invalid`,
                password: `lgd_vapt_sqli_' OR '1'='1`,
              }),
              failIfContains: ['sql syntax', 'mysql', 'stack trace'],
            },
          ];

    case 'xss-reflection':
      return multi
        ? [
            {
              id: 'fb-xss-1',
              label: `${label} · name field`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: '<lgd_vapt_xss>', comment: '<lgd_vapt_xss>' }),
              failIfContains: ['<lgd_vapt_xss>'],
            },
            {
              id: 'fb-xss-2',
              label: `${label} · q param shape`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ q: '"><lgd_vapt_xss>', title: '<lgd_vapt_xss>' }),
              failIfContains: ['<lgd_vapt_xss>'],
            },
          ]
        : [
            {
              id: 'fb-xss-fl-1',
              label: `${label} · fail-level event handler marker`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                html: `<img src=x onerror=lgd_vapt_xss>`,
                bio: `<svg/onload=lgd_vapt_xss>`,
              }),
              failIfContains: ['lgd_vapt_xss', '<img', '<svg'],
            },
            {
              id: 'fb-xss-fl-2',
              label: `${label} · fail-level script marker`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: `<script>lgd_vapt_xss()</script>`,
              }),
              failIfContains: ['<script>lgd_vapt_xss', 'lgd_vapt_xss()'],
            },
          ];

    case 'brute-force':
      return multi
        ? [
            {
              id: 'fb-bf-1',
              label: `${label} · multi attempt A`,
              method: 'POST',
              url: login,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'lgd_vapt_bf_ai_a@example.invalid',
                password: 'lgd_vapt_not_real',
              }),
              failIfContains: [],
              note: 'Expect 429 / Retry-After across burst (runner aggregates)',
            },
            {
              id: 'fb-bf-2',
              label: `${label} · multi attempt B`,
              method: 'POST',
              url: login,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'lgd_vapt_bf_ai_b@example.invalid',
                password: 'lgd_vapt_not_real',
              }),
            },
            {
              id: 'fb-bf-3',
              label: `${label} · multi attempt C`,
              method: 'POST',
              url: login,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'lgd_vapt_bf_ai_c@example.invalid',
                password: 'lgd_vapt_not_real',
              }),
            },
          ]
        : [
            {
              id: 'fb-bf-fl-1',
              label: `${label} · fail-level denser burst 1`,
              method: 'POST',
              url: login,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'lgd_vapt_bf_fl_1@example.invalid',
                password: 'lgd_vapt_not_real',
              }),
            },
            {
              id: 'fb-bf-fl-2',
              label: `${label} · fail-level denser burst 2`,
              method: 'POST',
              url: login,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'lgd_vapt_bf_fl_2@example.invalid',
                password: 'lgd_vapt_not_real',
              }),
            },
            {
              id: 'fb-bf-fl-3',
              label: `${label} · fail-level denser burst 3`,
              method: 'POST',
              url: login,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'lgd_vapt_bf_fl_3@example.invalid',
                password: 'lgd_vapt_not_real',
              }),
            },
            {
              id: 'fb-bf-fl-4',
              label: `${label} · fail-level denser burst 4`,
              method: 'POST',
              url: login,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'lgd_vapt_bf_fl_4@example.invalid',
                password: 'lgd_vapt_not_real',
              }),
            },
          ];

    case 'ddos-rate-limit':
    case 'api-abuse':
      return [
        {
          id: `fb-rate-${level}-1`,
          label: `${label} · ${level} GET A`,
          method: 'GET',
          url: api,
        },
        {
          id: `fb-rate-${level}-2`,
          label: `${label} · ${level} GET B`,
          method: 'GET',
          url: api,
        },
        {
          id: `fb-rate-${level}-3`,
          label: `${label} · ${level} GET C`,
          method: 'GET',
          url: api,
        },
      ];

    case 'rce-surface':
    case 'command-injection-surface':
      return multi
        ? [
            {
              id: 'fb-rce-1',
              label: `${label} · cmd marker`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cmd: 'lgd_vapt_cmd', exec: 'lgd_vapt_cmd' }),
              failIfContains: ['uid=', 'root:', 'bin/bash', 'lgd_vapt_cmd_out'],
            },
            {
              id: 'fb-rce-2',
              label: `${label} · shell field`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shell: 'echo lgd_vapt_cmd', command: 'lgd_vapt_cmd' }),
              failIfContains: ['uid=', 'root:', 'bin/bash'],
            },
          ]
        : [
            {
              id: 'fb-rce-fl-1',
              label: `${label} · fail-level pipe marker`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cmd: 'lgd_vapt_cmd;id',
                arg: '$(lgd_vapt_cmd)',
              }),
              failIfContains: ['uid=', 'gid=', 'root:', 'bin/bash'],
            },
            {
              id: 'fb-rce-fl-2',
              label: `${label} · fail-level backtick marker`,
              method: 'POST',
              url: api,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ exec: '`lgd_vapt_cmd`', path: '|lgd_vapt_cmd' }),
              failIfContains: ['uid=', 'root:'],
            },
          ];

    case 'directory-traversal':
      return multi
        ? [
            {
              id: 'fb-trav-1',
              label: `${label} · static traversal`,
              method: 'GET',
              url: `${baseUrl.replace(/\/+$/, '')}/static/../../etc/passwd`,
              failIfContains: ['root:x:', '/bin/bash'],
            },
            {
              id: 'fb-trav-2',
              label: `${label} · encoded dots`,
              method: 'GET',
              url: `${baseUrl.replace(/\/+$/, '')}/static/..%2F..%2Fetc%2Fpasswd`,
              failIfContains: ['root:x:'],
            },
          ]
        : [
            {
              id: 'fb-trav-fl-1',
              label: `${label} · fail-level deep traversal`,
              method: 'GET',
              url: `${baseUrl.replace(/\/+$/, '')}/assets/../../../../etc/passwd`,
              failIfContains: ['root:x:', 'daemon:'],
            },
            {
              id: 'fb-trav-fl-2',
              label: `${label} · fail-level file query`,
              method: 'GET',
              url: `${api}${api.includes('?') ? '&' : '?'}file=../../etc/passwd&lgd_vapt=1`,
              failIfContains: ['root:x:'],
            },
          ];

    case 'ssrf-surface':
      return [
        {
          id: `fb-ssrf-${level}-1`,
          label: `${label} · ${level} metadata URL`,
          method: 'POST',
          url: api,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'http://169.254.169.254/latest/meta-data/',
            callback: 'http://127.0.0.1/lgd_vapt_ssrf',
          }),
          failIfContains: ['ami-id', 'instance-id', 'meta-data'],
        },
        {
          id: `fb-ssrf-${level}-2`,
          label: `${label} · ${level} localhost`,
          method: 'POST',
          url: api,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook: 'http://localhost:22/lgd_vapt_ssrf',
            fetchUrl: 'http://[::1]/lgd_vapt_ssrf',
          }),
          failIfContains: ['SSH-', 'OpenSSH', 'meta-data'],
        },
      ];

    case 'xxe-surface':
      return [
        {
          id: `fb-xxe-${level}-1`,
          label: `${label} · ${level} benign XXE shape`,
          method: 'POST',
          url: api,
          headers: { 'Content-Type': 'application/xml' },
          body: `<?xml version="1.0"?><!DOCTYPE lgd [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;lgd_vapt_xxe</root>`,
          failIfContains: ['root:x:', '/bin/bash'],
        },
      ];

    case 'api-auth-bypass':
      return [
        {
          id: `fb-auth-${level}-1`,
          label: `${label} · ${level} no auth`,
          method: 'GET',
          url: api,
          failIfContains: [],
          note: '200 with sensitive body without auth may indicate bypass',
        },
        {
          id: `fb-auth-${level}-2`,
          label: `${label} · ${level} junk bearer`,
          method: 'GET',
          url: api,
          headers: { Authorization: 'Bearer lgd_vapt_invalid_token' },
        },
      ];

    default:
      return [
        {
          id: `fb-${checkId}-${level}-1`,
          label: `${label} · ${level} variant A`,
          method: 'POST',
          url: api,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ probe: `lgd_vapt_${checkId}`, level }),
          failIfContains: ['stack trace', 'Exception in', 'Traceback'],
        },
        {
          id: `fb-${checkId}-${level}-2`,
          label: `${label} · ${level} variant B`,
          method: 'GET',
          url: api,
        },
      ];
  }
}

export async function generateRuntimeProbeQueries(input: {
  checkId: VaptCheckId;
  level: VaptAiQueryLevel;
  targetUrl: string;
  baseUrl: string;
  method?: string;
  priorFindings?: VaptFinding[];
  provider?: AiProviderId | string | null;
  openRouterApiKey?: string | null;
  anthropicApiKey?: string | null;
  model?: string | null;
  signal?: AbortSignal;
}): Promise<GenerateRuntimeQueriesResult> {
  const { checkId, level, targetUrl, baseUrl } = input;
  const fallback = (): GenerateRuntimeQueriesResult => ({
    queries: fallbackRuntimeQueries(checkId, level, targetUrl, baseUrl),
    model: 'fallback-templates',
    source: 'fallback',
    level,
  });

  if (input.signal?.aborted) return fallback();

  const provider = resolveAiProvider(input.provider);
  const hasClaude =
    provider === 'claude' &&
    Boolean(
      (input.anthropicApiKey || '').trim() || process.env.ANTHROPIC_API_KEY?.trim(),
    );
  const hasOr =
    provider !== 'claude' && Boolean(getOpenRouterApiKey(input.openRouterApiKey));

  if (!hasClaude && !hasOr) return fallback();

  const priorSummary = (input.priorFindings || [])
    .slice(0, 6)
    .map((f) => `${f.status}/${f.severity}: ${f.title}`)
    .join('; ');

  const user = [
    `Attack check id: ${checkId} (${vaptAttackLabel(checkId)})`,
    `Level: ${level}`,
    `Target URL: ${targetUrl}`,
    `Portal baseUrl: ${baseUrl}`,
    `Preferred method: ${input.method || 'POST'}`,
    priorSummary ? `Prior findings for this check: ${priorSummary}` : 'No prior findings yet.',
    level === 'fail-level'
      ? 'Baseline/multi queries PASSED. Generate HARDER fail-level hygiene variants to try to elicit a failure signal.'
      : 'Generate MULTIPLE complementary safe probe query variants for this attack class.',
  ].join('\n');

  try {
    if (hasClaude) {
      const apiKey = requireAnthropicApiKey(input.anthropicApiKey);
      const primary = normalizeClaudeModelId(
        input.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL,
      );
      const chain = [
        primary,
        ...CLAUDE_MODELS.map((m) => m.id).filter((id) => id !== primary),
      ].slice(0, 2);
      for (const modelId of chain) {
        if (input.signal?.aborted) break;
        try {
          const { text, model } = await callAnthropicChat({
            apiKey,
            model: modelId,
            system: SYSTEM_PROMPT,
            user,
            maxTokens: 1800,
          });
          const data = extractJsonFromModelText(text);
          const queries = parseQueries(data, targetUrl);
          if (queries.length) {
            return { queries, model, source: 'ai', level };
          }
        } catch {
          // try next
        }
      }
    } else {
      const apiKey = getOpenRouterApiKey(input.openRouterApiKey)!;
      const chain = resolveOpenRouterModelChain(
        input.model || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      );
      for (const modelId of chain.slice(0, 3)) {
        if (input.signal?.aborted) break;
        try {
          const { text, model } = await callOpenRouterChat({
            apiKey,
            model: modelId,
            fallbackModels: chain.slice(1, 3),
            system: SYSTEM_PROMPT,
            user,
            maxTokens: 1800,
            temperature: 0.35,
          });
          const data = extractJsonFromModelText(text);
          const queries = parseQueries(data, targetUrl);
          if (queries.length) {
            return { queries, model, source: 'ai', level };
          }
        } catch {
          // try next
        }
      }
    }
  } catch {
    // fall through
  }

  return fallback();
}
