import type { CountrySignupFixture, LocationCountry, TestStep } from '@/lib/types';

const PASSWORD = 'Test@Augmont1';
const OTP = '123456';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Digits-only unique mobile segment sized for each country's length rules. */
function uniqueDigits(length: number): string {
  const seed = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return seed.slice(-length).padStart(length, '9');
}

function mobileLengthForDial(dial: string): number {
  if (dial === '91' || dial === '1' || dial === '44') return 10;
  if (dial === '971') return 9;
  if (dial === '65') return 8;
  // Default international mobile length used by portal validators for most dials
  return 10;
}

function registrationForCountry(iso: string, dial: string, suffix: string): string {
  if (iso === 'IN' || dial === '91') return '27AABCU9603R1ZM';
  if (iso === 'US' || (dial === '1' && iso !== 'CA')) return '12-3456789';
  return `${iso}-REG-${suffix.toUpperCase()}`;
}

function pincodeForCountry(iso: string, dial: string): string {
  if (iso === 'IN' || dial === '91') return '400069';
  if (iso === 'US') return '94105';
  if (iso === 'GB') return 'SW1A1AA';
  if (iso === 'SG') return '048616';
  if (iso === 'AE') return '00000';
  return '10001';
}

const FIRST_NAMES = ['Alex', 'Jordan', 'Sam', 'Riley', 'Casey', 'Morgan', 'Avery', 'Quinn'];
const LAST_NAMES = ['Patel', 'Singh', 'Lee', 'Garcia', 'Chen', 'Khan', 'Brown', 'Silva'];

function pickName(seed: string, list: string[]): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i) * (i + 1)) % 997;
  return list[hash % list.length]!;
}

export function buildFixtureForCountry(country: LocationCountry): CountrySignupFixture {
  const suffix = uniqueSuffix();
  const iso = country.isoCode.toUpperCase();
  const dial = String(country.countryCode).replace(/^\+/, '');
  const slug = iso.toLowerCase();

  return {
    isoCode: iso,
    countryName: country.name,
    dialCode: dial,
    firstName: pickName(iso + 'f', FIRST_NAMES),
    lastName: pickName(iso + 'l', LAST_NAMES),
    email: `signup.${slug}.${suffix}@example.com`,
    password: PASSWORD,
    mobileNumber: uniqueDigits(mobileLengthForDial(dial)),
    otp: OTP,
    companyName: `Augmont Test ${country.name} Co`,
    tradingName: `Augmont ${iso}`,
    registrationNumber: registrationForCountry(iso, dial, suffix),
    addressLine1: '12 Test Street',
    addressLine2: 'Suite 100',
    pincode: pincodeForCountry(iso, dial),
  };
}

/** @deprecated Prefer buildFixtureForCountry with location API countries */
export function buildCountryFixtures(): CountrySignupFixture[] {
  const defaults: LocationCountry[] = [
    { id: 'IN', name: 'India', countryCode: '91', isoCode: 'IN' },
    { id: 'US', name: 'United States', countryCode: '1', isoCode: 'US' },
    { id: 'AE', name: 'United Arab Emirates', countryCode: '971', isoCode: 'AE' },
    { id: 'GB', name: 'United Kingdom', countryCode: '44', isoCode: 'GB' },
    { id: 'SG', name: 'Singapore', countryCode: '65', isoCode: 'SG' },
  ];
  return defaults.map(buildFixtureForCountry);
}

export function buildStepsForCountries(countries: CountrySignupFixture[]): TestStep[] {
  const steps: TestStep[] = [
    {
      id: 'boot',
      label: 'Launch browser & open target URL',
      status: 'pending',
    },
  ];

  for (const country of countries) {
    const key = country.isoCode.toLowerCase();
    steps.push(
      {
        id: `${key}-signup-open`,
        label: `${country.countryName}: open signup`,
        status: 'pending',
      },
      {
        id: `${key}-signup-fill`,
        label: `${country.countryName}: fill signup form`,
        status: 'pending',
      },
      {
        id: `${key}-signup-submit`,
        label: `${country.countryName}: continue & receive OTP`,
        status: 'pending',
      },
      {
        id: `${key}-otp-verify`,
        label: `${country.countryName}: verify email & mobile OTP`,
        status: 'pending',
      },
      {
        id: `${key}-company-details`,
        label: `${country.countryName}: fill company details`,
        status: 'pending',
      },
      {
        id: `${key}-login`,
        label: `${country.countryName}: login with credentials`,
        status: 'pending',
      },
    );
  }

  steps.push({
    id: 'wrap-up',
    label: 'Close browser & finalize report',
    status: 'pending',
  });

  return steps;
}

export function buildMultiCountrySteps(countries: CountrySignupFixture[]): TestStep[] {
  return buildStepsForCountries(countries);
}
