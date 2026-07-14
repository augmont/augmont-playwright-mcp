import {
  DEFAULT_OPENROUTER_MODEL,
  normalizeOpenRouterModelId,
  resolveOpenRouterModelChain,
} from '@/lib/openrouter-models';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SITE_URL = process.env.OPENROUTER_SITE_URL || 'http://localhost:3100';
const SITE_TITLE = process.env.OPENROUTER_SITE_TITLE || 'LGD Playwright MCP';
/** OpenRouter rejects `models` arrays longer than 3. */
const MAX_MODEL_FALLBACKS = 3;

export function getOpenRouterApiKey(override?: string | null): string | undefined {
  const fromClient = (override || '').trim();
  if (fromClient) return fromClient;
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

export function isRetryableOpenRouterError(status: number, message: string): boolean {
  if (status === 429 || status === 503 || status === 502 || status === 408 || status === 404) {
    return true;
  }
  return /rate.?limit|capacity|overloaded|timeout|temporarily|no endpoints|credits|max_tokens|unavailable|provider|not a valid model|empty response|paid version|no healthy|temporarily rate-limited/i.test(
    message,
  );
}

/** Soft-repair common model JSON mistakes before parse. */
function softRepairJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  // Strip reasoning / think blocks free models often emit
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<\/?think>/gi, '');
  s = s.replace(/^[\s\S]*?(?=[\[{])/, '');
  s = s.replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // Trailing junk after JSON
  const endObj = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (endObj > 0 && endObj < s.length - 1) {
    const candidate = s.slice(0, endObj + 1);
    if (/^[\[{]/.test(candidate)) s = candidate;
  }
  return s.trim();
}

function tryParseJson(raw: string): unknown | null {
  for (const c of [raw, softRepairJson(raw)]) {
    try {
      return JSON.parse(c);
    } catch {
      // continue
    }
  }
  return null;
}

/** Extract first balanced `{...}` or `[...]` (handles nested braces / strings). */
function extractBalancedJson(text: string): string | null {
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  let start = -1;
  let open = '';
  let close = '';
  if (startObj < 0 && startArr < 0) return null;
  if (startArr < 0 || (startObj >= 0 && startObj < startArr)) {
    start = startObj;
    open = '{';
    close = '}';
  } else {
    start = startArr;
    open = '[';
    close = ']';
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function normalizeExtractedJson(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    return { cases: parsed };
  }
  return parsed;
}

export function extractJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParseJson(trimmed);
  if (direct !== null) return normalizeExtractedJson(direct);

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) {
    const fromFence = tryParseJson(fence[1].trim());
    if (fromFence !== null) return normalizeExtractedJson(fromFence);
  }

  const balanced = extractBalancedJson(softRepairJson(trimmed));
  if (balanced) {
    const fromBalanced = tryParseJson(balanced);
    if (fromBalanced !== null) return normalizeExtractedJson(fromBalanced);
  }

  const start = Math.min(
    ...[trimmed.indexOf('{'), trimmed.indexOf('[')].filter((i) => i >= 0),
  );
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (Number.isFinite(start) && start >= 0 && end > start) {
    const fromSlice = tryParseJson(trimmed.slice(start, end + 1));
    if (fromSlice !== null) return normalizeExtractedJson(fromSlice);
  }

  throw new Error('Model response was not valid JSON');
}

function messageContentToText(message: {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
} | null | undefined): string {
  if (!message) return '';
  const c = message.content;
  if (typeof c === 'string' && c.trim()) return c;
  if (Array.isArray(c)) {
    const joined = c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as { text?: string; content?: string };
          return p.text || p.content || '';
        }
        return '';
      })
      .join('');
    if (joined.trim()) return joined;
  }
  for (const key of ['reasoning', 'reasoning_content'] as const) {
    const r = message[key];
    if (typeof r === 'string' && /[\[{]/.test(r)) return r;
  }
  return '';
}

export type OpenRouterChatResult = {
  text: string;
  /** Model that actually answered (may differ when `models` fallbacks were used). */
  model: string;
};

export async function callOpenRouterChat(input: {
  apiKey: string;
  model: string;
  /** Extra free-model IDs OpenRouter should try if the primary fails (one request). */
  fallbackModels?: string[];
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask OpenRouter for JSON object output when the model supports it. */
  jsonMode?: boolean;
}): Promise<OpenRouterChatResult> {
  const primary = normalizeOpenRouterModelId(input.model);
  // openrouter/free already routes across free models — extra `models` often conflict.
  const fallbacks =
    primary === 'openrouter/free'
      ? []
      : (input.fallbackModels || [])
          .map(normalizeOpenRouterModelId)
          .filter((id) => id && id !== primary && id !== 'openrouter/free')
          .slice(0, MAX_MODEL_FALLBACKS);

  const payload: Record<string, unknown> = {
    model: primary,
    ...(fallbacks.length ? { models: fallbacks } : {}),
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxTokens ?? Number(process.env.OPENROUTER_MAX_TOKENS || 2500),
  };
  if (input.jsonMode !== false) {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'HTTP-Referer': SITE_URL,
      'X-Title': SITE_TITLE,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string } | string;
    model?: string;
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning?: unknown;
        reasoning_content?: unknown;
      };
    }>;
  };

  if (!res.ok) {
    const errMsg =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message || `OpenRouter API error HTTP ${res.status}`;
    // Some free models reject response_format — retry once without it
    if (
      input.jsonMode !== false &&
      /response_format|json_object|not supported/i.test(errMsg)
    ) {
      return callOpenRouterChat({ ...input, jsonMode: false });
    }
    const err = new Error(errMsg) as Error & { status?: number; retryable?: boolean };
    err.status = res.status;
    err.retryable = isRetryableOpenRouterError(res.status, errMsg);
    throw err;
  }

  const text = messageContentToText(body.choices?.[0]?.message);
  if (!text.trim()) {
    const err = new Error(
      `OpenRouter (${body.model || primary}) returned an empty response`,
    ) as Error & {
      retryable?: boolean;
    };
    err.retryable = true;
    throw err;
  }

  return { text, model: body.model || primary };
}

/**
 * Try free models until one returns usable text.
 * Prefer one OpenRouter `models` failover request (saves free-tier quota),
 * then fall back to a short per-model retry if needed.
 */
export async function callOpenRouterWithFallback(input: {
  system: string;
  user: string;
  preferredModel?: string | null;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ text: string; model: string; attempted: string[] }> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. Add it to .env.local and restart the server.',
    );
  }

  const chain = resolveOpenRouterModelChain(
    input.preferredModel || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
  );
  const attempted: string[] = [];
  const errors: string[] = [];

  // 1) Single request with OpenRouter native model failover
  try {
    attempted.push(...chain.slice(0, 1 + MAX_MODEL_FALLBACKS));
    const result = await callOpenRouterChat({
      apiKey,
      model: chain[0]!,
      fallbackModels: chain.slice(1, 1 + MAX_MODEL_FALLBACKS),
      system: input.system,
      user: input.user,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
    return { text: result.text, model: result.model, attempted };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    errors.push(`models-failover: ${message}`);
  }

  // 2) Sparse sequential retries (skip ones already tried as primary batch)
  const solo = ['openrouter/free', ...chain].filter(
    (id, i, arr) => arr.indexOf(id) === i,
  );
  for (const model of solo.slice(0, 4)) {
    if (attempted.includes(model) && model !== 'openrouter/free') continue;
    attempted.push(model);
    try {
      const result = await callOpenRouterChat({
        apiKey,
        model,
        system: input.system,
        user: input.user,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      });
      return { text: result.text, model: result.model, attempted };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${model}: ${message}`);
    }
  }

  throw new Error(
    `All OpenRouter models failed (${attempted.length} tried). Free models rotate often — pick Auto or openrouter/free, or check OpenRouter rate limits (≈20/min, ≈50/day without credits).\n${errors.slice(-5).join('\n')}`,
  );
}
