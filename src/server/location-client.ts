import type { LocationCountry } from '@/lib/types';
import { normalizeApiUrl } from '@/lib/api-url';

interface LocationApiResponse {
  data?: {
    country?: Array<{
      id?: string | number;
      name?: string;
      countryCode?: string | number;
      isoCode?: string;
    }>;
  };
  message?: string;
}

export async function fetchCountries(apiUrl: string): Promise<LocationCountry[]> {
  const base = normalizeApiUrl(apiUrl);
  if (!base) {
    throw new Error('API URL is required to load countries');
  }

  const res = await fetch(`${base}/location`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ key: 'country' }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Location API failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }

  const json = (await res.json()) as LocationApiResponse;
  const raw = json.data?.country;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Location API returned no countries');
  }

  const countries: LocationCountry[] = [];
  for (const row of raw) {
    const isoCode = String(row.isoCode || '')
      .trim()
      .toUpperCase();
    const name = String(row.name || '').trim();
    const countryCode = String(row.countryCode ?? '').trim();
    const id = String(row.id ?? isoCode);
    if (!isoCode || !name || !countryCode) continue;
    countries.push({ id, name, countryCode, isoCode });
  }

  if (countries.length === 0) {
    throw new Error('Location API countries missing isoCode/name/countryCode');
  }

  return countries.sort((a, b) => a.name.localeCompare(b.name));
}

export function findCountryByIso(
  countries: LocationCountry[],
  isoCode: string,
): LocationCountry | undefined {
  const key = isoCode.trim().toUpperCase();
  return countries.find((c) => c.isoCode === key);
}
