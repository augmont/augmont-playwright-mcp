/** Sanitize client-provided AI keys from request bodies / form fields. */

export type ClientAiKeys = {
  openRouterApiKey?: string;
  anthropicApiKey?: string;
};

export function sanitizeClientAiKeys(raw?: {
  openRouterApiKey?: unknown;
  anthropicApiKey?: unknown;
  openrouterApiKey?: unknown;
  claudeApiKey?: unknown;
} | null): ClientAiKeys {
  if (!raw || typeof raw !== 'object') return {};
  const openRouterApiKey = String(
    raw.openRouterApiKey || raw.openrouterApiKey || '',
  ).trim();
  const anthropicApiKey = String(
    raw.anthropicApiKey || raw.claudeApiKey || '',
  ).trim();
  return {
    openRouterApiKey: openRouterApiKey || undefined,
    anthropicApiKey: anthropicApiKey || undefined,
  };
}
