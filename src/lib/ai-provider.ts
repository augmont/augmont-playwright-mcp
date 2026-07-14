export type AiProviderId = 'openrouter' | 'claude';

export type ClaudeModelOption = {
  id: string;
  label: string;
  note: string;
  rating: string;
};

export const CLAUDE_MODELS: ClaudeModelOption[] = [
  {
    id: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    note: 'Best for generate / upload',
    rating: '★★★★★',
  },
  {
    id: 'claude-opus-4-20250514',
    label: 'Claude Opus 4',
    note: 'Highest quality, slower',
    rating: '★★★★★',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    label: 'Claude Haiku 3.5',
    note: 'Fast & light',
    rating: '★★★★',
  },
];

export const DEFAULT_CLAUDE_MODEL =
  process.env.NEXT_PUBLIC_CLAUDE_MODEL ||
  process.env.CLAUDE_MODEL ||
  'claude-sonnet-4-20250514';

export function isAiProviderId(v: unknown): v is AiProviderId {
  return v === 'openrouter' || v === 'claude';
}

export function resolveAiProvider(raw?: string | null): AiProviderId {
  const fromEnv = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (isAiProviderId(raw)) return raw;
  if (isAiProviderId(fromEnv)) return fromEnv;
  return 'openrouter';
}

export function normalizeClaudeModelId(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === 'auto') return DEFAULT_CLAUDE_MODEL;
  if (CLAUDE_MODELS.some((m) => m.id === trimmed)) return trimmed;
  return DEFAULT_CLAUDE_MODEL;
}
