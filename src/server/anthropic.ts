import {
  DEFAULT_CLAUDE_MODEL,
  normalizeClaudeModelId,
} from '@/lib/ai-provider';
import { extractJsonFromModelText } from '@/server/openrouter';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/** Claude Code / setup-token OAuth — rejected by Messages API for third-party apps. */
export function isAnthropicOAuthToken(key: string): boolean {
  return /^sk-ant-oat/i.test((key || '').trim());
}

/** Console API keys from https://console.anthropic.com/settings/keys */
export function isAnthropicConsoleApiKey(key: string): boolean {
  const k = (key || '').trim();
  return /^sk-ant-api/i.test(k) || (/^sk-ant-/i.test(k) && !isAnthropicOAuthToken(k));
}

export function describeAnthropicKeyProblem(key: string): string | null {
  const k = (key || '').trim();
  if (!k) return 'Claude API key is missing.';
  if (isAnthropicOAuthToken(k)) {
    return (
      'This looks like a Claude Code / OAuth token (sk-ant-oat…). ' +
      'Anthropic rejects those for app API calls with “invalid x-api-key”. ' +
      'Create a Console API key (sk-ant-api03-…) at https://console.anthropic.com/settings/keys ' +
      'and paste that instead — or switch Active AI to OpenRouter (header → AI setup).'
    );
  }
  if (!/^sk-ant-/i.test(k)) {
    return (
      'Claude key should start with sk-ant-api03-… (from console.anthropic.com). ' +
      'Or switch Active AI to OpenRouter.'
    );
  }
  return null;
}

export function getAnthropicApiKey(override?: string | null): string | undefined {
  const fromClient = (override || '').trim();
  if (fromClient) return fromClient;
  return (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.CLAUDE_API_KEY?.trim() ||
    undefined
  );
}

/** Resolve + validate; throws a clear error for oat/missing keys. */
export function requireAnthropicApiKey(override?: string | null): string {
  const key = getAnthropicApiKey(override);
  if (!key) {
    throw new Error(
      'Claude API key missing. Add ANTHROPIC_API_KEY=sk-ant-api03-… to .env.local, ' +
        'or open header → AI setup, paste a Console API key (not a Claude Code oat token), Save, then retry. ' +
        'Alternatively set Active AI to OpenRouter.',
    );
  }
  const problem = describeAnthropicKeyProblem(key);
  if (problem) throw new Error(problem);
  return key;
}

export function hasAnthropicApiKey(override?: string | null): boolean {
  const key = getAnthropicApiKey(override);
  return Boolean(key && !describeAnthropicKeyProblem(key));
}

export function isAnthropicAuthError(message: string): boolean {
  return /invalid x-api-key|401|unauthorized|authentication|oauth authentication is currently not supported|sk-ant-oat/i.test(
    message,
  );
}

type AnthropicMessage = {
  content?: Array<{ type?: string; text?: string } | string>;
  stop_reason?: string;
};

function extractText(data: AnthropicMessage): string {
  const parts = data.content || [];
  const texts: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') texts.push(p);
    else if (p && typeof p === 'object' && p.type === 'text' && p.text) texts.push(p.text);
  }
  return texts.join('\n').trim();
}

export async function callAnthropicChat(input: {
  apiKey: string;
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<{ text: string; model: string; raw: unknown }> {
  const problem = describeAnthropicKeyProblem(input.apiKey);
  if (problem) throw new Error(problem);

  const model = normalizeClaudeModelId(input.model || DEFAULT_CLAUDE_MODEL);
  const maxTokens = input.maxTokens ?? Number(process.env.CLAUDE_MAX_TOKENS || 4096);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': input.apiKey.trim(),
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    }),
  });

  const rawText = await res.text();
  let data: AnthropicMessage & { error?: { message?: string }; type?: string } = {};
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    // keep empty
  }

  if (!res.ok) {
    let msg =
      data.error?.message ||
      data.type ||
      rawText.slice(0, 400) ||
      `Anthropic HTTP ${res.status}`;
    if (res.status === 401 || /invalid x-api-key/i.test(msg)) {
      msg =
        `${msg}. Use a Console API key (sk-ant-api03-…) from https://console.anthropic.com/settings/keys — ` +
        `Claude Code OAuth tokens (sk-ant-oat…) are not accepted. Or switch AI provider to OpenRouter.`;
    }
    throw new Error(`Claude API error (${res.status}): ${msg}`);
  }

  const text = extractText(data);
  if (!text) {
    throw new Error('Claude returned an empty response.');
  }

  return { text, model, raw: data };
}

export async function callAnthropicJson(input: {
  apiKey: string;
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<{ data: unknown; model: string; text: string }> {
  const { text, model } = await callAnthropicChat(input);
  const data = extractJsonFromModelText(text);
  if (data == null) {
    throw new Error(`Claude response was not valid JSON (model ${model}).`);
  }
  return { data, model, text };
}
