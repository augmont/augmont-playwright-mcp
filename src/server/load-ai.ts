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
  isAnthropicAuthError,
  requireAnthropicApiKey,
} from '@/server/anthropic';
import {
  listWebLoadCases,
  normalizeWebLoadCases,
} from '@/server/web-load-store';
import type { WebLoadTestCase } from '@/lib/types';

const LOAD_SYSTEM_PROMPT = `You are a web load-test scenario author for the Augmont LGD Portal.
Return ONLY valid JSON (no markdown fences) matching this schema:

{
  "cases": [
    {
      "id": "load-kebab-case-id",
      "name": "Short scenario name",
      "description": "One sentence: what URL/method and why this load matters",
      "tags": ["web-load", "portal" | "api", "basic" | "advanced", "..."],
      "estimatedMinutes": 1,
      "kind": "web-load",
      "load": {
        "targetUrl": "/path-or-absolute-url",
        "method": "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
        "headers": { "Content-Type": "application/json" },
        "body": "optional JSON string for POST/PUT/PATCH",
        "virtualUsers": 10,
        "durationSec": 30,
        "rampUpSec": 5,
        "maxErrorRatePct": 5,
        "p95Ms": 2000,
        "useApiBase": false,
        "profile": "basic" | "advanced",
        "requests": [
          {
            "name": "optional label",
            "path": "/step-path",
            "method": "GET",
            "thinkTimeMs": 300,
            "useApiBase": false
          }
        ]
      }
    }
  ]
}

Portal paths (relative to portal baseUrl unless useApiBase is true):
- Public: /, /login, /register, /forgot-password, /about-us, /contact-us, /bookademo,
  /terms-and-conditions, /return-policy, /privacy-policy, /news-insights, /download-app
- Buyer (auth): /buyer, /buyer/products, /buyer/cart, /buyer/wishlist, /buyer/orders
- Seller: /seller · Admin: /admin, /admin/buyers, /admin/orders
- Location API (set useApiBase true): POST /location with body {"key":"country"} (countries). For states use {"key":"state","value":"<countryUuid>"}; cities {"key":"city","value":"<stateUuid>"}. Do NOT use {"countryId":1} (returns 400). Do NOT use GET/HEAD /location (returns 500).

Rules:
- kind must be "web-load".
- Prefer relative paths (not full host) so users can change baseUrl.
- useApiBase=true only for Location API / backend API endpoints.
- Keep light smoke loads by default: virtualUsers 5–20, durationSec 20–60, rampUpSec 3–10.
- maxErrorRatePct typically 5–15; p95Ms typically 1500–4000.
- id must start with "load-" and be unique kebab-case.
- Return 1–3 cases unless the user asks for more (max 5).
- For advanced multi-step (customer browse, multiple login gates, API multi-call): set profile "advanced" and fill requests[] (2–6 steps) with thinkTimeMs 150–400.
- Do not invent authentication headers / credential sprays unless the user asks.
- Prefer GET for portal pages; POST for Location API.
`;

export type LoadAiProgressEvent = {
  type: 'status' | 'model_start' | 'model_ok' | 'model_fail' | 'parse_fail';
  message: string;
  model?: string;
  at?: string;
};

function progress(
  onProgress: ((e: LoadAiProgressEvent) => void) | undefined,
  event: LoadAiProgressEvent,
) {
  onProgress?.({ ...event, at: event.at || new Date().toISOString() });
}

export async function generateWebLoadCases(input: {
  prompt: string;
  baseUrl?: string;
  apiUrl?: string;
  model?: string | null;
  provider?: AiProviderId | string | null;
  openRouterApiKey?: string | null;
  anthropicApiKey?: string | null;
  /** Uploaded file text (JSON / markdown / notes) */
  fileContent?: string | null;
  /** Paths / URLs captured from MCP browsing */
  visitedPaths?: string[] | null;
  onProgress?: (event: LoadAiProgressEvent) => void;
}): Promise<{ cases: WebLoadTestCase[]; model: string; attempted: string[] }> {
  const provider = resolveAiProvider(input.provider);
  const prompt = (input.prompt || '').trim();
  const fileContent = (input.fileContent || '').trim();
  const visited = (input.visitedPaths || [])
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (!prompt && !fileContent && !visited.length) {
    throw new Error('prompt, file content, or visited paths are required');
  }

  if (provider === 'claude') {
    requireAnthropicApiKey(input.anthropicApiKey);
  } else {
    if (!getOpenRouterApiKey(input.openRouterApiKey)) {
      throw new Error(
        'OpenRouter API key missing. Add OPENROUTER_API_KEY to .env.local, or open header → AI setup, paste your OpenRouter key, Save for this tab, then retry.',
      );
    }
  }

  const existing = listWebLoadCases();
  const existingSummary = existing
    .slice(0, 40)
    .map(
      (c) =>
        `- ${c.id}: ${c.name} · ${c.load.method} ${c.load.targetUrl} · ${c.load.virtualUsers} VUs / ${c.load.durationSec}s`,
    )
    .join('\n');

  const userParts = [
    input.baseUrl ? `Portal baseUrl: ${input.baseUrl}` : '',
    input.apiUrl ? `API baseUrl: ${input.apiUrl}` : '',
    existingSummary
      ? `Existing load scenarios (avoid exact duplicates; improve or add new):\n${existingSummary}`
      : 'No existing load scenarios yet.',
    visited.length
      ? `MCP-VISITED PATHS / URLS (create light GET load scenarios for each unique path; prefer relative paths):\n${visited.map((p) => `- ${p}`).join('\n')}`
      : '',
    fileContent
      ? `UPLOADED FILE CONTENT (normalize into web-load cases; if already JSON load cases, keep structure):\n${fileContent.slice(0, 60_000)}`
      : '',
    prompt
      ? `User request for new web load test case(s):\n${prompt}`
      : visited.length
        ? 'User request: Create light smoke load scenarios from the MCP-visited paths above.'
        : 'User request: Normalize the uploaded content into web-load scenarios.',
  ].filter(Boolean);

  const userContent = userParts.join('\n\n');
  const attempted: string[] = [];
  const errors: string[] = [];

  if (provider === 'claude') {
    const apiKey = requireAnthropicApiKey(input.anthropicApiKey);
    const primary = normalizeClaudeModelId(
      input.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL,
    );
    const chain = [
      primary,
      ...CLAUDE_MODELS.map((m) => m.id).filter((id) => id !== primary),
    ].slice(0, 3);

    progress(input.onProgress, {
      type: 'status',
      message: `Generating load scenarios · Claude`,
    });

    for (let i = 0; i < chain.length; i++) {
      const modelId = chain[i]!;
      attempted.push(modelId);
      progress(input.onProgress, {
        type: 'model_start',
        model: modelId,
        message: `Thinking with ${modelId} (${i + 1}/${chain.length})…`,
      });
      try {
        const { text, model } = await callAnthropicChat({
          apiKey,
          model: modelId,
          system: LOAD_SYSTEM_PROMPT,
          user: userContent,
          maxTokens: Number(process.env.CLAUDE_MAX_TOKENS || 3500),
        });
        try {
          const data = extractJsonFromModelText(text);
          const cases = normalizeWebLoadCases(data, 'claude');
          if (!cases.length) throw new Error('No valid load cases in model JSON');
          progress(input.onProgress, {
            type: 'model_ok',
            model,
            message: `Parsed ${cases.length} load case(s) from ${model}`,
          });
          return { cases, model, attempted };
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : 'Invalid JSON';
          errors.push(`${modelId}: ${msg}`);
          progress(input.onProgress, {
            type: 'parse_fail',
            model: modelId,
            message: `${modelId} returned invalid JSON — trying next…`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`${modelId}: ${message}`);
        progress(input.onProgress, {
          type: 'model_fail',
          model: modelId,
          message: `${modelId} failed: ${message}`,
        });
        if (isAnthropicAuthError(message)) break;
      }
    }

    throw new Error(
      `All Claude models failed.\n${errors.slice(-5).join('\n')}`,
    );
  }

  const apiKey = getOpenRouterApiKey(input.openRouterApiKey)!;
  const chain = resolveOpenRouterModelChain(
    input.model || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
  ).slice(0, 5);

  progress(input.onProgress, {
    type: 'status',
    message: `Generating load scenarios · OpenRouter`,
  });

  for (let i = 0; i < chain.length; i++) {
    const modelId = chain[i]!;
    attempted.push(modelId);
    progress(input.onProgress, {
      type: 'model_start',
      model: modelId,
      message: `Thinking with ${modelId} (${i + 1}/${chain.length})…`,
    });
    try {
      const { text, model } = await callOpenRouterChat({
        apiKey,
        model: modelId,
        system: LOAD_SYSTEM_PROMPT,
        user: userContent,
        maxTokens: Number(process.env.OPENROUTER_MAX_TOKENS || 3000),
      });
      try {
        const data = extractJsonFromModelText(text);
        const cases = normalizeWebLoadCases(data, 'claude');
        if (!cases.length) throw new Error('No valid load cases in model JSON');
        progress(input.onProgress, {
          type: 'model_ok',
          model,
          message: `Parsed ${cases.length} load case(s) from ${model}`,
        });
        return { cases, model, attempted };
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : 'Invalid JSON';
        errors.push(`${modelId}: ${msg}`);
        progress(input.onProgress, {
          type: 'parse_fail',
          model: modelId,
          message: `${modelId} returned invalid JSON — trying next…`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${modelId}: ${message}`);
      progress(input.onProgress, {
        type: 'model_fail',
        model: modelId,
        message: `${modelId} failed: ${message}`,
      });
    }
  }

  throw new Error(
    `All OpenRouter models failed.\n${errors.slice(-5).join('\n')}`,
  );
}
