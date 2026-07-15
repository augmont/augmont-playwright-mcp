import type { LoadAuthCredential, LoadAuthLoginConfig } from '@/lib/types';

const STORAGE_KEY = 'lgd-load-auth-credentials';
const LOGIN_CFG_KEY = 'lgd-load-auth-login-config';

function newId(): string {
  return `cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyLoadCredential(label = ''): LoadAuthCredential {
  return {
    id: newId(),
    label: label || `User ${Date.now() % 1000}`,
    username: '',
    password: '',
  };
}

export function readLoadAuthCredentials(): LoadAuthCredential[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c): c is LoadAuthCredential => !!c && typeof c === 'object')
      .map((c) => ({
        id: String(c.id || newId()),
        label: String(c.label || 'User').trim() || 'User',
        username: String(c.username || '').trim(),
        password: String(c.password || ''),
      }))
      .filter((c) => c.username && c.password);
  } catch {
    return [];
  }
}

export function writeLoadAuthCredentials(creds: LoadAuthCredential[]): void {
  if (typeof window === 'undefined') return;
  const cleaned = creds
    .map((c) => ({
      id: c.id || newId(),
      label: (c.label || 'User').trim() || 'User',
      username: (c.username || '').trim(),
      password: c.password || '',
    }))
    .filter((c) => c.username && c.password);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
}

export function clearLoadAuthCredentials(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function countLoadAuthCredentials(): number {
  return readLoadAuthCredentials().length;
}

export function readLoadAuthLoginConfig(): Partial<LoadAuthLoginConfig> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(LOGIN_CFG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<LoadAuthLoginConfig>;
  } catch {
    return null;
  }
}

export function writeLoadAuthLoginConfig(cfg: Partial<LoadAuthLoginConfig>): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(LOGIN_CFG_KEY, JSON.stringify(cfg));
}

/** Credentials payload safe to send to the run API (no empty rows). */
export function loadAuthCredentialsForRun(): LoadAuthCredential[] {
  return readLoadAuthCredentials();
}

const PRESET_TOKENS_KEY = 'lgd-load-auth-preset-headers';

/** Pre-set Authorization header values (e.g. "Bearer …") for load runs. */
export function writePresetAuthHeaders(values: string[]): void {
  if (typeof window === 'undefined') return;
  const cleaned = values.map((v) => String(v || '').trim()).filter(Boolean);
  if (!cleaned.length) {
    sessionStorage.removeItem(PRESET_TOKENS_KEY);
    return;
  }
  sessionStorage.setItem(PRESET_TOKENS_KEY, JSON.stringify(cleaned));
}

export function readPresetAuthHeaders(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(PRESET_TOKENS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).map((v) => v.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function clearPresetAuthHeaders(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(PRESET_TOKENS_KEY);
}
