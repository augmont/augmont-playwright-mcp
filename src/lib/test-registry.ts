import type { LocationCountry, TestCaseMeta } from '@/lib/types';
import {
  MOBILE_TEST_CASES,
  getMobileTestCase,
  isMobileTestId,
} from '@/lib/mobile-test-registry';

/** Main suite — country all/single runs live inside this test workspace. */
export const SIGNUP_LOGIN_ID = 'signup-login';
export const SIGNUP_ALL_ID = 'signup-all';
export const LEGACY_MULTI_COUNTRY_ID = 'multi-country-signup-login';

const MAIN_ALIASES = new Set([SIGNUP_LOGIN_ID, SIGNUP_ALL_ID, LEGACY_MULTI_COUNTRY_ID]);

export function buildSignupLoginTest(countryCount?: number): TestCaseMeta {
  const n = countryCount ?? 0;
  return {
    id: SIGNUP_LOGIN_ID,
    name: 'Signup & Login',
    description:
      n > 0
        ? `Signup → OTP → company details → login. Run all ${n} countries from the location API, or pick one country inside the workspace.`
        : 'Signup → OTP → company details → login. Run all countries from the location API, or pick one country inside the workspace.',
    tags: ['auth', 'signup', 'login', 'otp', 'company', 'multi-country', 'web'],
    estimatedMinutes: Math.max(8, n * 2 || 12),
    kind: 'signup-all',
  };
}

/** @deprecated Prefer buildSignupLoginTest — kept for older callers */
export function buildSignupAllTest(countryCount?: number): TestCaseMeta {
  return buildSignupLoginTest(countryCount);
}

export function buildSignupCountryTest(country: LocationCountry): TestCaseMeta {
  const iso = country.isoCode.toUpperCase();
  return {
    id: `signup-${iso.toLowerCase()}`,
    name: `Signup — ${country.name} (${iso})`,
    description: `Signup for ${country.name}: dial +${country.countryCode}, form → OTP → company details → login.`,
    tags: ['auth', 'signup', 'otp', 'company', 'login', iso, 'web'],
    estimatedMinutes: 3,
    kind: 'signup-country',
    isoCode: iso,
  };
}

/** Main list shows only the Signup & Login suite. */
export function buildTestCases(countries: LocationCountry[] = []): TestCaseMeta[] {
  return [buildSignupLoginTest(countries.length)];
}

export function getTestCasesForMode(mode: 'web' | 'mobile' | null): TestCaseMeta[] {
  if (mode === 'mobile') return MOBILE_TEST_CASES;
  return TEST_CASES;
}

export function isSignupLoginTestId(id: string): boolean {
  return MAIN_ALIASES.has(id) || /^signup-[a-z0-9]{2}$/i.test(id);
}

/** Resolve a test id (main suite, mobile suite, or legacy per-country deep link). */
export function resolveTestCase(
  id: string,
  countries: LocationCountry[],
): TestCaseMeta | undefined {
  if (isMobileTestId(id)) {
    return getMobileTestCase(id);
  }
  if (MAIN_ALIASES.has(id)) {
    return buildSignupLoginTest(countries.length);
  }

  const match = /^signup-([a-z0-9]{2})$/i.exec(id);
  if (match) {
    const iso = match[1]!.toUpperCase();
    const country = countries.find((c) => c.isoCode === iso);
    if (!country) return undefined;
    return buildSignupCountryTest(country);
  }

  return undefined;
}

export function parseSignupIsoFromTestId(id: string): string | undefined {
  if (MAIN_ALIASES.has(id)) return undefined;
  const match = /^signup-([a-z0-9]{2})$/i.exec(id);
  return match ? match[1]!.toUpperCase() : undefined;
}

export const TEST_CASES: TestCaseMeta[] = [buildSignupLoginTest()];

export function getTestCase(id: string): TestCaseMeta | undefined {
  if (isMobileTestId(id)) return getMobileTestCase(id);
  if (MAIN_ALIASES.has(id)) {
    return buildSignupLoginTest();
  }
  const match = /^signup-([a-z0-9]{2})$/i.exec(id);
  if (match) {
    const iso = match[1]!.toUpperCase();
    return {
      id: `signup-${iso.toLowerCase()}`,
      name: `Signup — ${iso}`,
      description: `Signup flow for country ${iso}.`,
      tags: ['auth', 'signup', iso, 'web'],
      estimatedMinutes: 3,
      kind: 'signup-country',
      isoCode: iso,
    };
  }
  return undefined;
}

/** True for built-in signup suite (country picker). Declarative web-flow ids are false. */
export function isCountryScopedWebTest(id: string): boolean {
  return isSignupLoginTestId(id);
}

export { MOBILE_TEST_CASES, isMobileTestId, getMobileTestCase };
