/** Tab-scoped AI API keys (sessionStorage — cleared when the browser tab closes). */

export type AiKeys = {
  openRouterApiKey: string;
  anthropicApiKey: string;
};

const STORAGE_KEY = 'lgd-ai-keys';

export function readAiKeys(): AiKeys {
  if (typeof window === 'undefined') {
    return { openRouterApiKey: '', anthropicApiKey: '' };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { openRouterApiKey: '', anthropicApiKey: '' };
    const parsed = JSON.parse(raw) as Partial<AiKeys>;
    return {
      openRouterApiKey: String(parsed.openRouterApiKey || '').trim(),
      anthropicApiKey: String(parsed.anthropicApiKey || '').trim(),
    };
  } catch {
    return { openRouterApiKey: '', anthropicApiKey: '' };
  }
}

export function writeAiKeys(keys: Partial<AiKeys>): void {
  if (typeof window === 'undefined') return;
  const next: AiKeys = {
    openRouterApiKey: String(keys.openRouterApiKey || '').trim(),
    anthropicApiKey: String(keys.anthropicApiKey || '').trim(),
  };
  if (!next.openRouterApiKey && !next.anthropicApiKey) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function clearAiKeys(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function maskAiKey(key?: string | null): string | null {
  const k = (key || '').trim();
  if (!k) return null;
  if (k.length < 12) return '••••';
  return `${k.slice(0, 10)}…${k.slice(-4)}`;
}

export function hasOpenRouterKey(keys: AiKeys = readAiKeys()): boolean {
  return Boolean(keys.openRouterApiKey);
}

export function hasClaudeKey(keys: AiKeys = readAiKeys()): boolean {
  return Boolean(keys.anthropicApiKey);
}

export function countConfiguredAiKeys(keys: AiKeys = readAiKeys()): number {
  return (hasOpenRouterKey(keys) ? 1 : 0) + (hasClaudeKey(keys) ? 1 : 0);
}

/** Payload to send with AI generate / upload / validate (never log full keys). */
export function aiKeysForRun(): {
  openRouterApiKey?: string;
  anthropicApiKey?: string;
} {
  const keys = readAiKeys();
  return {
    openRouterApiKey: keys.openRouterApiKey || undefined,
    anthropicApiKey: keys.anthropicApiKey || undefined,
  };
}

export function activeProviderHasKey(
  provider: 'openrouter' | 'claude',
  keys: AiKeys = readAiKeys(),
): boolean {
  return provider === 'claude' ? hasClaudeKey(keys) : hasOpenRouterKey(keys);
}
