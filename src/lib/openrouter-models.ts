export type OpenRouterModelOption = {
  id: string;
  label: string;
  rating: string;
  note: string;
};

/**
 * Free OpenRouter models ranked for coding + report summaries.
 * Order = Auto fallback chain (report + generate).
 * IDs must match https://openrouter.ai/api/v1/models (`:free` suffix).
 * Updated Jul 2026 — gpt-oss-120b:free removed (paid-only now).
 */
export const OPENROUTER_MODELS: OpenRouterModelOption[] = [
  {
    id: 'openrouter/free',
    label: 'OpenRouter Free Router',
    rating: '★★★★★',
    note: 'Auto-routes to any available free model (most reliable)',
  },
  {
    id: 'qwen/qwen3-coder:free',
    label: 'Qwen3 Coder (free)',
    rating: '★★★★★',
    note: 'Reports ★★★★★ · Test cases ★★★★★ · Unit ★★★★★',
  },
  {
    id: 'poolside/laguna-m.1:free',
    label: 'Poolside Laguna M.1 (free)',
    rating: '★★★★★',
    note: 'Strong free coding / agent model',
  },
  {
    id: 'cohere/north-mini-code:free',
    label: 'Cohere North Mini Code (free)',
    rating: '★★★★☆',
    note: 'Free coding-focused fallback',
  },
  {
    id: 'openai/gpt-oss-20b:free',
    label: 'GPT-OSS 20B (free)',
    rating: '★★★★☆',
    note: 'Faster free OSS fallback',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    label: 'Gemma 4 31B (free)',
    rating: '★★★★☆',
    note: 'Strong free instruct model',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'Llama 3.3 70B (free)',
    rating: '★★★★☆',
    note: 'Large free instruct fallback',
  },
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    label: 'Nemotron 3 Nano 30B (free)',
    rating: '★★★★☆',
    note: 'NVIDIA free coding / instruct',
  },
  {
    id: 'poolside/laguna-xs-2.1:free',
    label: 'Poolside Laguna XS 2.1 (free)',
    rating: '★★★☆☆',
    note: 'Smaller free coding fallback',
  },
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    label: 'Llama 3.2 3B (free)',
    rating: '★★★☆☆',
    note: 'Lightweight free fallback',
  },
];

/** Dead / retired free slugs we still rewrite to a live model. */
export const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  'openai/gpt-oss-120b:free': 'openrouter/free',
  'poolside/laguna-m1:free': 'poolside/laguna-m.1:free',
  'deepseek/deepseek-r1:free': 'qwen/qwen3-coder:free',
};

export const OPENROUTER_AUTO = 'auto';

export const DEFAULT_OPENROUTER_MODEL =
  process.env.NEXT_PUBLIC_OPENROUTER_MODEL ||
  process.env.OPENROUTER_MODEL ||
  OPENROUTER_AUTO;

export function normalizeOpenRouterModelId(id: string): string {
  const trimmed = (id || '').trim();
  if (!trimmed) return OPENROUTER_AUTO;
  return OPENROUTER_MODEL_ALIASES[trimmed] || trimmed;
}

export function isKnownOpenRouterModel(id: string): boolean {
  const normalized = normalizeOpenRouterModelId(id);
  return (
    normalized === OPENROUTER_AUTO ||
    OPENROUTER_MODELS.some((m) => m.id === normalized)
  );
}

/** Ordered fallback chain for auto-switch (starts with preferred if provided). */
export function resolveOpenRouterModelChain(preferred?: string | null): string[] {
  const ids = OPENROUTER_MODELS.map((m) => m.id);
  const pick = normalizeOpenRouterModelId(preferred || '');
  if (!pick || pick === OPENROUTER_AUTO) return ids;
  if (ids.includes(pick)) {
    return [pick, ...ids.filter((id) => id !== pick)];
  }
  // Allow custom model id, then free fallbacks
  return [pick, ...ids];
}
