/**
 * Tab-scoped buyer credentials.
 * Client sends webSessionId from sessionStorage (cleared when the browser tab closes).
 * Closing the tab → new id → signup creates a fresh account on next run.
 */

export type BuyerCreds = {
  email: string;
  password: string;
  createdAt: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __lgdWebSessionCreds: Map<string, BuyerCreds> | undefined;
}

function store(): Map<string, BuyerCreds> {
  if (!globalThis.__lgdWebSessionCreds) {
    globalThis.__lgdWebSessionCreds = new Map();
  }
  return globalThis.__lgdWebSessionCreds;
}

export function getSessionBuyerCreds(webSessionId: string | undefined): BuyerCreds | undefined {
  if (!webSessionId?.trim()) return undefined;
  return store().get(webSessionId.trim());
}

export function setSessionBuyerCreds(
  webSessionId: string,
  creds: { email: string; password: string },
): BuyerCreds {
  const entry: BuyerCreds = {
    email: creds.email,
    password: creds.password,
    createdAt: new Date().toISOString(),
  };
  store().set(webSessionId.trim(), entry);
  return entry;
}

export function clearSessionBuyerCreds(webSessionId: string | undefined) {
  if (!webSessionId?.trim()) return;
  store().delete(webSessionId.trim());
}
