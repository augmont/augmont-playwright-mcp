/** Map portal host → LGD backend API base (…/api/v1). */

const DEFAULT_API =
  process.env.NEXT_PUBLIC_DEFAULT_API_URL || 'http://localhost:3000/api/v1';

export function normalizeApiUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

/**
 * Suggest API URL from the portal application URL.
 * localhost:4200 → localhost:3000/api/v1
 * *.testlgd.* → https://api.testlgd.augmont.com/api/v1
 * *.uatlgd.* → https://api.uatlgd.augmont.com/api/v1
 * production-ish → https://diamonds-api.augmont.com/api/v1
 */
export function suggestApiUrl(portalUrl: string): string {
  try {
    const host = new URL(
      /^https?:\/\//i.test(portalUrl) ? portalUrl : `http://${portalUrl}`,
    ).hostname.toLowerCase();

    if (host === 'localhost' || host === '127.0.0.1') {
      return normalizeApiUrl(DEFAULT_API.includes('localhost') ? DEFAULT_API : 'http://localhost:3000/api/v1');
    }
    if (host.includes('testlgd') || host.includes('test.')) {
      return 'https://api.testlgd.augmont.com/api/v1';
    }
    if (host.includes('uatlgd') || host.includes('uat.')) {
      return 'https://api.uatlgd.augmont.com/api/v1';
    }
    if (host.includes('augmont') || host.includes('diamonds')) {
      return 'https://diamonds-api.augmont.com/api/v1';
    }
  } catch {
    // fall through
  }
  return normalizeApiUrl(DEFAULT_API);
}

export { DEFAULT_API as DEFAULT_API_URL };
