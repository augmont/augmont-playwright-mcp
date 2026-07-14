/** Tab-scoped role credentials (sessionStorage — clears when the browser tab closes). */

export type RoleCredKey = 'buyer' | 'admin' | 'seller';

export type RoleCredential = {
  email: string;
  password: string;
};

export type RoleCredentialsMap = Partial<Record<RoleCredKey, RoleCredential>>;

const STORAGE_KEY = 'lgd-role-credentials';

export const ROLE_CRED_LABELS: Record<RoleCredKey, string> = {
  buyer: 'Buyer',
  admin: 'Admin',
  seller: 'Seller',
};

export function readRoleCredentials(): RoleCredentialsMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RoleCredentialsMap;
    const out: RoleCredentialsMap = {};
    for (const key of ['buyer', 'admin', 'seller'] as RoleCredKey[]) {
      const c = parsed[key];
      if (c?.email?.trim() && c?.password) {
        out[key] = { email: c.email.trim(), password: c.password };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRoleCredentials(map: RoleCredentialsMap): void {
  if (typeof window === 'undefined') return;
  const cleaned: RoleCredentialsMap = {};
  for (const key of ['buyer', 'admin', 'seller'] as RoleCredKey[]) {
    const c = map[key];
    if (c?.email?.trim() && c?.password) {
      cleaned[key] = { email: c.email.trim(), password: c.password };
    }
  }
  if (Object.keys(cleaned).length === 0) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
}

export function clearRoleCredentials(role?: RoleCredKey): void {
  if (typeof window === 'undefined') return;
  if (!role) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  const current = readRoleCredentials();
  delete current[role];
  writeRoleCredentials(current);
}

export function countConfiguredRoles(map: RoleCredentialsMap = readRoleCredentials()): number {
  return (['buyer', 'admin', 'seller'] as RoleCredKey[]).filter((k) => Boolean(map[k])).length;
}

/** Payload safe to send with a test run (never logs passwords). */
export function roleCredentialsForRun(): RoleCredentialsMap {
  return readRoleCredentials();
}
