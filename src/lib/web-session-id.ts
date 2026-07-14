/** Tab-scoped id in sessionStorage — cleared when the browser tab closes. */

const KEY = 'lgd-web-session-id';

export function getOrCreateWebSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `ws-${Date.now()}`;
  }
}
