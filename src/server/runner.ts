import { chromium, type Browser, type CDPSession, type Page, type Response } from 'playwright';
import type {
  ApiErrorRecord,
  CountryRunResult,
  CountrySignupFixture,
  LocationCountry,
} from '@/lib/types';
import {
  addApiError,
  addCountryResult,
  currentRunningStepId,
  getApiErrorsSince,
  getSession,
  resetCountrySteps,
  setFrame,
  setRunStatus,
  updateStep,
} from '@/server/session-manager';
import {
  captureFailureScreenshot,
  captureLivePreviewJpeg,
  stepFailDetail,
  stepPassDetail,
} from '@/server/report-capture';
import {
  buildCountryFixtures,
  buildFixtureForCountry,
  buildStepsForCountries,
} from '@/server/tests/multi-country-signup-login';

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.slice(0, 160);
  } catch {
    return url.slice(0, 160);
  }
}

/** Only track failures against the configured LGD API base URL (not CDN/analytics/portal assets). */
function isOurApiUrl(requestUrl: string, apiUrl?: string): boolean {
  if (!apiUrl) return false;
  try {
    const api = new URL(apiUrl);
    const req = new URL(requestUrl);
    if (req.origin !== api.origin) return false;
    // Match same host and path under /api (or whatever prefix apiUrl uses)
    const apiPath = api.pathname.replace(/\/+$/, '') || '';
    const reqPath = req.pathname;
    if (!apiPath || apiPath === '/') {
      // e.g. http://localhost:3000 — require /api in path to avoid portal HTML
      return /\/api(\/|$)/i.test(reqPath);
    }
    return reqPath === apiPath || reqPath.startsWith(`${apiPath}/`);
  } catch {
    return requestUrl.startsWith(apiUrl.replace(/\/+$/, ''));
  }
}

function formatApiError(err: ApiErrorRecord): string {
  const status = err.status != null ? `HTTP ${err.status}` : 'network';
  return `API error ${status} ${err.method || 'GET'} ${shortUrl(err.url)} — ${err.message}`;
}

/** Watch failures only for the configured apiUrl; ignore other network traffic. */
function attachApiErrorWatcher(
  page: Page,
  runId: string,
  apiUrl: string | undefined,
  getIso: () => string | undefined,
) {
  const handleFailedResponse = async (response: Response) => {
    try {
      const status = response.status();
      if (status < 400) return;
      const url = response.url();
      if (!isOurApiUrl(url, apiUrl)) return;

      const request = response.request();
      let bodySnippet = '';
      try {
        bodySnippet = (await response.text()).slice(0, 280);
      } catch {
        // ignore body read errors
      }

      let message = response.statusText() || `Request failed with status ${status}`;
      try {
        const json = JSON.parse(bodySnippet) as { message?: string; error?: string };
        if (json.message) message = String(json.message);
        else if (json.error) message = String(json.error);
      } catch {
        // keep status text
      }

      const record: ApiErrorRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toISOString(),
        method: request.method(),
        url,
        status,
        statusText: response.statusText(),
        message,
        bodySnippet: bodySnippet || undefined,
        isoCode: getIso(),
        stepId: currentRunningStepId(runId),
      };
      addApiError(runId, record);
    } catch {
      // ignore watcher errors
    }
  };

  page.on('response', (response) => {
    void handleFailedResponse(response);
  });

  page.on('requestfailed', (request) => {
    try {
      const url = request.url();
      if (!isOurApiUrl(url, apiUrl)) return;
      const failure = request.failure()?.errorText || 'Request failed';
      const record: ApiErrorRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toISOString(),
        method: request.method(),
        url,
        message: failure,
        isoCode: getIso(),
        stepId: currentRunningStepId(runId),
      };
      addApiError(runId, record);
    } catch {
      // ignore
    }
  });
}

function isApiRelatedFailure(message: string, apiErrors: ApiErrorRecord[]): boolean {
  // Only treat as API-related when we captured errors against our apiUrl
  return apiErrors.length > 0;
}
async function attachScreencast(runId: string, page: Page): Promise<CDPSession> {
  const { attachThrottledScreencast } = await import('@/server/mcp-screencast');
  return attachThrottledScreencast(runId, page);
}

async function pauseScreencast(cdp?: CDPSession) {
  await cdp?.send('Page.stopScreencast').catch(() => undefined);
}

async function resumeScreencast(cdp?: CDPSession) {
  if (!cdp) return;
  await cdp
    .send('Page.startScreencast', {
      format: 'jpeg',
      quality: 82,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    })
    .catch(() => undefined);
}

async function captureFailShot(
  page: Page,
  runId: string,
  stepId: string,
  highlight: Parameters<typeof captureFailureScreenshot>[3],
  cdp?: CDPSession,
) {
  await pauseScreencast(cdp);
  try {
    const screenshotPath = await captureFailureScreenshot(page, runId, stepId, highlight);
    const jpeg = await captureLivePreviewJpeg(page);
    if (jpeg) setFrame(runId, jpeg);
    return screenshotPath;
  } finally {
    await resumeScreencast(cdp);
  }
}

async function selectCountry(page: Page, country: CountrySignupFixture) {
  const triggers = [
    page.locator('#isoCode'),
    page.locator('[formcontrolname="isoCode"]'),
    page.locator('p-select').filter({ hasText: /country/i }).first(),
    page.getByRole('combobox').first(),
  ];

  let opened = false;
  for (const trigger of triggers) {
    if ((await trigger.count()) > 0) {
      await trigger.first().click({ timeout: 5000 }).catch(() => undefined);
      opened = true;
      break;
    }
  }

  if (!opened) {
    throw new Error('Could not find country selector on signup form');
  }

  const option = page
    .locator('[role="option"]')
    .filter({ hasText: new RegExp(country.countryName, 'i') })
    .first();

  if ((await option.count()) > 0) {
    await option.click();
    return;
  }

  await page.keyboard.type(country.countryName.slice(0, 4), { delay: 40 });
  const filtered = page.locator('[role="option"]').first();
  await filtered.click({ timeout: 5000 });
}

async function selectFirstDropdownOption(
  page: Page,
  formControlName: string,
  labelHint?: RegExp,
) {
  const trigger = page.locator(`[formcontrolname="${formControlName}"]`).first();
  if ((await trigger.count()) === 0) {
    if (labelHint) {
      const byLabel = page.getByRole('combobox', { name: labelHint }).first();
      if ((await byLabel.count()) > 0) {
        await byLabel.click();
      } else {
        return false;
      }
    } else {
      return false;
    }
  } else {
    await trigger.click({ timeout: 5000 });
  }

  await page.waitForTimeout(400);
  const option = page.locator('[role="option"]').first();
  if ((await option.count()) === 0) return false;
  await option.click();
  await page.waitForTimeout(400);
  return true;
}

async function fillSignup(page: Page, country: CountrySignupFixture) {
  await page.locator('#firstName, [formcontrolname="firstName"]').first().fill(country.firstName);
  await page.locator('#lastName, [formcontrolname="lastName"]').first().fill(country.lastName);
  await page.locator('#email, [formcontrolname="email"]').first().fill(country.email);

  const password = page.locator('[formcontrolname="password"] input, #password').first();
  await password.fill(country.password);

  const confirm = page
    .locator('[formcontrolname="confirmPassword"] input, #confirmPassword')
    .first();
  if ((await confirm.count()) > 0) {
    await confirm.fill(country.password);
  }

  await selectCountry(page, country);

  const mobile = page
    .locator('#mobileNumber, [formcontrolname="mobileNumber"]')
    .first();
  await mobile.fill(country.mobileNumber);

  const terms = page.locator('[formcontrolname="terms"] input, input[type="checkbox"]').first();
  if ((await terms.count()) > 0) {
    const checked = await terms.isChecked().catch(() => false);
    if (!checked) await terms.check({ force: true });
  }
}

async function submitSignup(page: Page) {
  const button = page
    .getByRole('button', { name: /continue\s*&\s*receive\s*otp|sign\s*up|register|continue|submit/i })
    .first();
  await button.click();
  await page.waitForURL(/\/register\/verify/i, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
}

type CapturedOtps = { emailOtp?: string; mobileOtp?: string };

/**
 * Register API returns reference codes (emailOtpCode / mobileOtpCode), NOT the OTP digits.
 * In development/test/uat the backend OTP is fixed to 123456 — use the fixture fallback.
 * This hook is kept for future envs that may expose otp in responses.
 */
function attachOtpCapture(page: Page, bucket: CapturedOtps) {
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!/user\/(register|send-otp|resend)/i.test(url)) return;
      if (!response.ok()) return;
      const json = (await response.json().catch(() => null)) as {
        data?: {
          /** Actual OTP digits if ever returned (not reference codes) */
          emailOtp?: string;
          mobileOtp?: string;
          otp?: string | number;
        };
      } | null;
      const data = json?.data;
      if (!data) return;
      if (data.emailOtp && /^\d{4,8}$/.test(String(data.emailOtp))) {
        bucket.emailOtp = String(data.emailOtp);
      }
      if (data.mobileOtp && /^\d{4,8}$/.test(String(data.mobileOtp))) {
        bucket.mobileOtp = String(data.mobileOtp);
      }
      if (data.otp && /^\d{4,8}$/.test(String(data.otp))) {
        const code = String(data.otp);
        if (!bucket.emailOtp) bucket.emailOtp = code;
        if (!bucket.mobileOtp) bucket.mobileOtp = code;
      }
    } catch {
      // ignore
    }
  });
}

function resolveOtps(captured: CapturedOtps, fallback: string) {
  return {
    emailOtp: captured.emailOtp || fallback,
    mobileOtp: captured.mobileOtp || fallback,
  };
}

/**
 * PrimeNG InputOtp: putting the full code on the first cell (value.length > 1)
 * triggers handleOnPaste and updates the FormControl in one shot.
 */
async function fillOtpGroup(page: Page, groupIndex: number, otp: string) {
  const group = page.locator('p-inputotp').nth(groupIndex);
  await group.waitFor({ state: 'visible', timeout: 10000 });

  const first = group.locator('input:not([type="hidden"])').first();
  await first.click({ timeout: 5000 });
  await first.fill('');
  // fill() sets the whole value + input event → PrimeNG paste path
  await first.fill(otp);
  await page.waitForTimeout(150);
}

/** Patch Angular VerifyComponent form when UI binding fails (dev builds expose window.ng). */
async function patchVerifyFormViaAngular(
  page: Page,
  emailOtp: string,
  mobileOtp: string,
): Promise<boolean> {
  return page.evaluate(
    ({ email, mobile }) => {
      const host = document.querySelector('app-verify');
      const ng = (window as unknown as { ng?: { getComponent?: (el: Element) => any } }).ng;
      if (!host || !ng?.getComponent) return false;

      const comp = ng.getComponent(host);
      if (!comp?.verifyForm) return false;

      // Ensure reference codes from registrationData are present (required validators)
      try {
        const raw = localStorage.getItem('registrationData');
        const reg = raw ? JSON.parse(raw) : null;
        if (reg) {
          comp.verifyForm.patchValue({
            emailCode: reg.emailOtpCode || comp.verifyForm.value.emailCode,
            mobileCode: reg.mobileOtpCode || comp.verifyForm.value.mobileCode,
            countryCode: reg.countryCode || comp.verifyForm.value.countryCode,
          });
        }
      } catch {
        // ignore
      }

      comp.verifyForm.patchValue({ emailOtp: email, mobileOtp: mobile });
      comp.verifyForm.markAsDirty();
      comp.verifyForm.updateValueAndValidity();
      return !comp.verifyForm.invalid;
    },
    { email: emailOtp, mobile: mobileOtp },
  );
}

/**
 * Fill email + mobile OTP then Continue.
 * Continue stays disabled until both OTP FormControls are valid.
 */
async function verifyOtp(page: Page, fallbackOtp: string, captured: CapturedOtps) {
  await page.waitForURL(/\/register\/verify/i, { timeout: 20000 }).catch(() => undefined);
  await page.waitForSelector('text=/Verify OTP/i', { timeout: 15000 });

  const otpGroups = page.locator('p-inputotp');
  await otpGroups.first().waitFor({ state: 'visible', timeout: 10000 });
  const groupCount = await otpGroups.count();
  if (groupCount === 0) {
    throw new Error('OTP inputs not found on verify page');
  }

  await page.waitForTimeout(400);
  const { emailOtp, mobileOtp } = resolveOtps(captured, fallbackOtp);

  await fillOtpGroup(page, 0, emailOtp);
  if (groupCount > 1) {
    await fillOtpGroup(page, 1, mobileOtp);
  }

  const continueBtn = page
    .locator('button[type="submit"]')
    .filter({ hasText: /continue/i })
    .first();
  await continueBtn.waitFor({ state: 'visible', timeout: 10000 });

  const enabled = await page
    .waitForFunction(
      () => {
        const btn = Array.from(document.querySelectorAll('button[type="submit"]')).find((el) =>
          /continue/i.test(el.textContent || ''),
        ) as HTMLButtonElement | undefined;
        return !!btn && !btn.disabled;
      },
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!enabled) {
    // DOM fill didn't bind — patch Angular form directly
    const patched = await patchVerifyFormViaAngular(page, emailOtp, mobileOtp);
    if (!patched) {
      // Last resort: paste via InputEvent on first cell of each group
      await page.evaluate(
        ({ email, mobile }) => {
          const fillPaste = (group: Element | undefined, code: string) => {
            if (!group) return;
            const cell = group.querySelector(
              'input:not([type="hidden"])',
            ) as HTMLInputElement | null;
            if (!cell) return;
            cell.focus();
            cell.value = code;
            cell.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                inputType: 'insertFromPaste',
                data: code,
              }),
            );
          };
          const groups = Array.from(document.querySelectorAll('p-inputotp'));
          fillPaste(groups[0], email);
          fillPaste(groups[1], mobile);
        },
        { email: emailOtp, mobile: mobileOtp },
      );
      await patchVerifyFormViaAngular(page, emailOtp, mobileOtp);
      await page.waitForTimeout(400);
    }
  }

  if (await continueBtn.isDisabled().catch(() => true)) {
    // Call verify() on the component if form is valid but button still blocked
    const invoked = await page.evaluate(
      ({ email, mobile }) => {
        const host = document.querySelector('app-verify');
        const ng = (window as unknown as { ng?: { getComponent?: (el: Element) => any } }).ng;
        if (!host || !ng?.getComponent) return false;
        const comp = ng.getComponent(host);
        if (!comp?.verifyForm || !comp.verify) return false;
        comp.verifyForm.patchValue({ emailOtp: email, mobileOtp: mobile });
        if (comp.verifyForm.invalid) return false;
        comp.verify();
        return true;
      },
      { email: emailOtp, mobile: mobileOtp },
    );

    if (!invoked) {
      throw new Error(
        `Continue still disabled after OTP fill (email=${emailOtp}, mobile=${mobileOtp}). ` +
          'Check that backend NODE_ENV is test/development/uat (OTP 123456) and registrationData has emailOtpCode/mobileOtpCode.',
      );
    }
  } else {
    await continueBtn.click({ timeout: 10000 });
  }

  await page
    .waitForURL(/\/register\/company-details/i, { timeout: 20000 })
    .catch(() => undefined);
  await page.waitForTimeout(1000);
}

async function fillAddressIfPresent(page: Page, country: CountrySignupFixture) {
  const address1 = page.locator('#shippingAddressLine1, [formcontrolname="addressLine1"]').first();
  if ((await address1.count()) === 0) return;
  if (!(await address1.isVisible().catch(() => false))) return;

  await address1.fill(country.addressLine1);

  const address2 = page.locator('#shippingAddressLine2, [formcontrolname="addressLine2"]').first();
  if ((await address2.count()) > 0 && (await address2.isVisible().catch(() => false))) {
    await address2.fill(country.addressLine2);
  }

  // Country is usually pre-selected & disabled; still ensure state/city load
  await selectFirstDropdownOption(page, 'stateId', /state/i);
  await selectFirstDropdownOption(page, 'cityId', /city/i);

  const pincode = page
    .locator(
      '#shippingPincode, [formcontrolname="pincode"] input, [formcontrolname="pincode"]',
    )
    .first();
  if ((await pincode.count()) > 0 && (await pincode.isVisible().catch(() => false))) {
    await pincode.fill(country.pincode);
  }
}

async function fillCompanyDetails(page: Page, country: CountrySignupFixture) {
  await page.waitForSelector('text=/Company Registration/i', { timeout: 15000 });

  await page
    .locator('#registrationNumber, [formcontrolname="registrationNumber"]')
    .first()
    .fill(country.registrationNumber);

  await page
    .locator('#companyName, [formcontrolname="companyName"]')
    .first()
    .fill(country.companyName);

  const trading = page.locator('#tradingName, [formcontrolname="tradingName"]').first();
  if ((await trading.count()) > 0) {
    await trading.fill(country.tradingName);
  }

  // Auto-verify when available (IN GSTIN / US EIN). Manual KYC countries skip this.
  const verifyBtn = page.getByRole('button', { name: /^verify$/i }).first();
  if ((await verifyBtn.count()) > 0 && (await verifyBtn.isEnabled().catch(() => false))) {
    await verifyBtn.click();
    await page.waitForTimeout(2500);
  }

  // Manual / failed lookup paths require registered business address
  await fillAddressIfPresent(page, country);

  const confirmBtn = page.getByRole('button', { name: /confirm/i }).first();
  await confirmBtn.click({ timeout: 10000 });
  await page
    .waitForURL(/\/register\/success/i, { timeout: 25000 })
    .catch(() => undefined);
  await page.waitForTimeout(1000);

  // Optional: leave success screen so login can be exercised cleanly
  const launchBtn = page
    .getByRole('button', { name: /launch the augmont platform/i })
    .first();
  if ((await launchBtn.count()) > 0) {
    // Prefer going to login instead of launching authenticated session
    await page.goto(page.url().replace(/\/register\/success.*/, '/login'), {
      waitUntil: 'domcontentloaded',
    }).catch(() => undefined);
  }
}

async function clearAppSession(page: Page, baseUrl: string) {
  const context = page.context();
  await context.clearCookies();

  // Must be on the app origin to clear storage for that origin
  try {
    const current = page.url();
    const targetOrigin = new URL(baseUrl).origin;
    if (!current.startsWith(targetOrigin)) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
  } catch {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
  }

  await page
    .evaluate(() => {
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
      try {
        sessionStorage.clear();
      } catch {
        // ignore
      }
      // Clear common auth keys if storage is partially locked
      const keys = [
        'token',
        'user',
        'userRole',
        'registrationData',
        'profileDetails',
        'pendingStep',
        'onboardingToken',
        'kycVerified',
        'isoCode',
        'lgd_cart',
        'emailTimerStart',
        'mobileTimerStart',
        'rememberedEmail',
      ];
      for (const key of keys) {
        try {
          localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }
    })
    .catch(() => undefined);

  await context.clearPermissions().catch(() => undefined);
}

async function login(page: Page, baseUrl: string, country: CountrySignupFixture) {
  // Fresh session so login is not skipped by leftover signup token
  await clearAppSession(page, baseUrl);
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await page
    .locator('#mobileNumber, [formcontrolname="mobileNumber"]')
    .first()
    .fill(country.email);

  await page
    .locator('[formcontrolname="password"] input, #password, input[type="password"]')
    .first()
    .fill(country.password);

  await page.getByRole('button', { name: /log\s*in|sign\s*in|submit/i }).first().click();
  await page.waitForTimeout(2000);
}

async function runCountryFlow(
  runId: string,
  page: Page,
  baseUrl: string,
  country: CountrySignupFixture,
  signal: AbortSignal,
  capturedOtps: CapturedOtps,
  cdp?: CDPSession,
) {
  const key = country.isoCode.toLowerCase();

  const ensureActive = () => {
    if (signal.aborted) throw new Error('Run stopped by user');
  };

  // Reset captured OTPs for this country run
  capturedOtps.emailOtp = undefined;
  capturedOtps.mobileOtp = undefined;

  ensureActive();
  updateStep(runId, `${key}-signup-open`, {
    status: 'running',
    description: 'Open /register with a clean session for this country.',
  });
  // Each country uses a clean app session (no shared cookies / localStorage)
  await clearAppSession(page, baseUrl);
  await page.goto(`${baseUrl}/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  updateStep(runId, `${key}-signup-open`, {
    status: 'passed',
    message: `Opened ${baseUrl}/register (cleared session)`,
    description: 'Open /register with a clean session for this country.',
    detail: stepPassDetail(
      `${country.countryName}: open signup`,
      `Opened ${baseUrl}/register (cleared session)`,
    ),
  });

  ensureActive();
  updateStep(runId, `${key}-signup-fill`, {
    status: 'running',
    description: `Fill signup form for ${country.countryName} (${country.isoCode}).`,
  });
  await fillSignup(page, country);
  updateStep(runId, `${key}-signup-fill`, {
    status: 'passed',
    message: `Filled ${country.countryName} (${country.isoCode}) form`,
    description: `Fill signup form for ${country.countryName} (${country.isoCode}).`,
    detail: stepPassDetail(
      `${country.countryName}: fill signup`,
      `Filled ${country.countryName} (${country.isoCode}) form`,
    ),
  });

  ensureActive();
  updateStep(runId, `${key}-signup-submit`, {
    status: 'running',
    description: 'Submit signup and land on OTP verify.',
  });
  try {
    await submitSignup(page);
    updateStep(runId, `${key}-signup-submit`, {
      status: 'passed',
      message: 'Clicked Continue & Receive OTP',
      description: 'Submit signup and land on OTP verify.',
      detail: stepPassDetail(
        `${country.countryName}: submit signup`,
        'Clicked Continue & Receive OTP',
      ),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Signup submit failed';
    const label = `${country.countryName}: submit signup`;
    const screenshotPath = await captureFailShot(
      page,
      runId,
      `${key}-signup-submit`,
      {
      label,
      action: 'signup-submit',
      expected: 'Continue & Receive OTP / verify page',
      message: raw,
      },
      cdp,
    );
    updateStep(runId, `${key}-signup-submit`, {
      status: 'failed',
      message: raw,
      description: 'Submit signup and land on OTP verify.',
      detail: stepFailDetail(label, raw),
      screenshotPath,
    });
    throw err;
  }

  ensureActive();
  updateStep(runId, `${key}-otp-verify`, {
    status: 'running',
    description: 'Enter email and mobile OTP and continue.',
  });
  try {
    await verifyOtp(page, country.otp, capturedOtps);
    const used = resolveOtps(capturedOtps, country.otp);
    updateStep(runId, `${key}-otp-verify`, {
      status: 'passed',
      message: `Verified email OTP ${used.emailOtp} & mobile OTP ${used.mobileOtp}`,
      description: 'Enter email and mobile OTP and continue.',
      detail: stepPassDetail(
        `${country.countryName}: verify OTP`,
        `Verified email OTP ${used.emailOtp} & mobile OTP ${used.mobileOtp}`,
      ),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'OTP verify failed';
    const label = `${country.countryName}: verify OTP`;
    const screenshotPath = await captureFailShot(page, runId, `${key}-otp-verify`, {
      label,
      action: 'otp-verify',
      expected: 'OTP inputs / verify success',
      message: raw,
    }, cdp);
    updateStep(runId, `${key}-otp-verify`, {
      status: 'failed',
      message: raw,
      description: 'Enter email and mobile OTP and continue.',
      detail: stepFailDetail(label, raw),
      screenshotPath,
    });
    throw err;
  }

  ensureActive();
  updateStep(runId, `${key}-company-details`, {
    status: 'running',
    description: 'Fill and submit company details after OTP.',
  });
  try {
    await fillCompanyDetails(page, country);
    updateStep(runId, `${key}-company-details`, {
      status: 'passed',
      message: `Submitted company details for ${country.companyName}`,
      description: 'Fill and submit company details after OTP.',
      detail: stepPassDetail(
        `${country.countryName}: company details`,
        `Submitted company details for ${country.companyName}`,
      ),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Company details failed';
    const label = `${country.countryName}: company details`;
    const screenshotPath = await captureFailShot(
      page,
      runId,
      `${key}-company-details`,
      {
        label,
        action: 'company-details',
        expected: 'Company details form submit',
        message: raw,
      },
      cdp,
    );
    updateStep(runId, `${key}-company-details`, {
      status: 'failed',
      message: raw,
      description: 'Fill and submit company details after OTP.',
      detail: stepFailDetail(label, raw),
      screenshotPath,
    });
    throw err;
  }

  ensureActive();
  updateStep(runId, `${key}-login`, {
    status: 'running',
    description: 'Login with the newly registered credentials.',
  });
  try {
    await login(page, baseUrl, country);
    updateStep(runId, `${key}-login`, {
      status: 'passed',
      message: `Login attempted with ${country.email}`,
      description: 'Login with the newly registered credentials.',
      detail: stepPassDetail(
        `${country.countryName}: login`,
        `Login attempted with ${country.email}`,
      ),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Login failed';
    const label = `${country.countryName}: login`;
    const screenshotPath = await captureFailShot(page, runId, `${key}-login`, {
      label,
      action: 'login',
      expected: 'Post-login destination (left /login)',
      message: raw,
    }, cdp);
    updateStep(runId, `${key}-login`, {
      status: 'failed',
      message: raw,
      description: 'Login with the newly registered credentials.',
      detail: stepFailDetail(label, raw),
      screenshotPath,
    });
    throw err;
  }
}

function summarizeCountrySteps(
  runId: string,
  isoCode: string,
): CountryRunResult['stepsSummary'] {
  const session = getSession(runId);
  const key = isoCode.toLowerCase();
  const steps = (session?.steps || []).filter((s) => s.id.startsWith(`${key}-`));
  return {
    passed: steps.filter((s) => s.status === 'passed').length,
    failed: steps.filter((s) => s.status === 'failed').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
    total: steps.length,
  };
}

function recordCountryResult(
  runId: string,
  country: CountrySignupFixture,
  status: CountryRunResult['status'],
  message?: string,
  extra?: { retried?: boolean; apiErrors?: ApiErrorRecord[] },
) {
  addCountryResult(runId, {
    isoCode: country.isoCode,
    countryName: country.countryName,
    status,
    message,
    retried: extra?.retried,
    apiErrors: extra?.apiErrors,
    stepsSummary: summarizeCountrySteps(runId, country.isoCode),
  });
}

async function runCountryWithRetry(
  runId: string,
  page: Page,
  baseUrl: string,
  country: CountrySignupFixture,
  signal: AbortSignal,
  capturedOtps: CapturedOtps,
  setActiveIso: (iso: string | undefined) => void,
  cdp?: CDPSession,
) {
  const attempt = async (isRetry: boolean) => {
    const startedAt = new Date().toISOString();
    setActiveIso(country.isoCode);
    if (isRetry) {
      resetCountrySteps(runId, country.isoCode);
      updateStep(runId, `${country.isoCode.toLowerCase()}-signup-open`, {
        status: 'running',
        message: 'Re-testing after API error…',
      });
      // brief pause so UI shows retry state
      await page.waitForTimeout(400);
    }
    try {
      await runCountryFlow(runId, page, baseUrl, country, signal, capturedOtps, cdp);
      const apiErrors = getApiErrorsSince(runId, startedAt, country.isoCode);
      const msg =
        apiErrors.length > 0
          ? `Completed with ${apiErrors.length} API warning(s)${isRetry ? ' (after retry)' : ''}`
          : isRetry
            ? `Completed ${country.countryName} after retry`
            : `Completed ${country.countryName}`;
      recordCountryResult(runId, country, 'passed', msg, {
        retried: isRetry,
        apiErrors: apiErrors.length ? apiErrors : undefined,
      });
      return { ok: true as const, apiErrors };
    } catch (err) {
      const apiErrors = getApiErrorsSince(runId, startedAt, country.isoCode);
      const baseMsg = err instanceof Error ? err.message : 'Country flow failed';
      const apiDetail =
        apiErrors.length > 0
          ? ` | API: ${apiErrors.map(formatApiError).slice(0, 3).join(' · ')}`
          : '';
      return {
        ok: false as const,
        message: `${baseMsg}${apiDetail}`,
        apiErrors,
        err,
      };
    }
  };

  const first = await attempt(false);
  if (first.ok) return;

  if (signal.aborted) {
    recordCountryResult(runId, country, 'skipped', 'Stopped by user');
    throw first.err instanceof Error ? first.err : new Error(first.message);
  }

  if (isApiRelatedFailure(first.message, first.apiErrors)) {
    // Mark failed steps message with API detail, then retry once
    const isoKey = country.isoCode.toLowerCase();
    const session = getSession(runId);
    for (const step of session?.steps || []) {
      if (step.id.startsWith(`${isoKey}-`) && step.status === 'failed') {
        updateStep(runId, step.id, {
          status: 'failed',
          message: `${step.message || 'Failed'} — will re-test (API error)`,
          apiErrors: first.apiErrors,
        });
      }
    }

    const second = await attempt(true);
    if (second.ok) return;

    if (signal.aborted) {
      recordCountryResult(runId, country, 'skipped', 'Stopped by user', {
        retried: true,
        apiErrors: [...first.apiErrors, ...second.apiErrors],
      });
      throw second.err instanceof Error ? second.err : new Error(second.message);
    }

    for (const step of getSession(runId)?.steps || []) {
      if (step.id.startsWith(`${isoKey}-`) && step.status === 'pending') {
        updateStep(runId, step.id, {
          status: 'skipped',
          message: 'Skipped after API error retry failed',
        });
      }
    }
    recordCountryResult(runId, country, 'failed', `Failed after retry: ${second.message}`, {
      retried: true,
      apiErrors: [...first.apiErrors, ...second.apiErrors],
    });
    throw second.err instanceof Error ? second.err : new Error(second.message);
  }

  const failKey = country.isoCode.toLowerCase();
  for (const step of getSession(runId)?.steps || []) {
    if (step.id.startsWith(`${failKey}-`) && step.status === 'pending') {
      updateStep(runId, step.id, {
        status: 'skipped',
        message: 'Skipped after earlier failure in this country',
      });
    }
  }
  recordCountryResult(runId, country, 'failed', first.message, {
    apiErrors: first.apiErrors.length ? first.apiErrors : undefined,
  });
  throw first.err instanceof Error ? first.err : new Error(first.message);
}

/**
 * One-shot buyer signup → OTP → company → login.
 * Used by declarative web flows (ensureBuyer / loginRole buyer) with session-stored creds.
 */
export async function performBuyerSignupLogin(
  page: Page,
  baseUrl: string,
  apiUrl?: string,
): Promise<{ email: string; password: string }> {
  let country: LocationCountry = {
    id: 'IN',
    name: 'India',
    countryCode: '91',
    isoCode: 'IN',
  };
  if (apiUrl) {
    try {
      const { fetchCountries, findCountryByIso } = await import('@/server/location-client');
      const list = await fetchCountries(apiUrl);
      country = findCountryByIso(list, 'IN') || list[0] || country;
    } catch {
      // keep India fallback
    }
  }

  const fixture = buildFixtureForCountry(country);
  const capturedOtps: CapturedOtps = {};
  attachOtpCapture(page, capturedOtps);

  await clearAppSession(page, baseUrl);
  await page.goto(`${baseUrl}/register`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(800);
  await fillSignup(page, fixture);
  await submitSignup(page);
  await verifyOtp(page, fixture.otp, capturedOtps);
  await fillCompanyDetails(page, fixture);
  await login(page, baseUrl, fixture);

  const url = page.url();
  if (/\/login/i.test(url) && !/buyer|seller|admin/i.test(url)) {
    // still on login after attempt — retry once
    await login(page, baseUrl, fixture);
  }

  return { email: fixture.email, password: fixture.password };
}

export async function runSignupCountries(
  runId: string,
  baseUrl: string,
  fixtures: CountrySignupFixture[],
) {
  const session = getSession(runId);
  if (!session) throw new Error('Session not found');
  if (fixtures.length === 0) {
    setRunStatus(runId, 'failed', 'No countries to run');
    return;
  }

  let browser: Browser | undefined;
  let cdp: CDPSession | undefined;
  let activeIso: string | undefined;

  try {
    setRunStatus(runId, 'running');
    updateStep(runId, 'boot', { status: 'running' });

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      // Never reuse a shared auth/session file across runs
      storageState: undefined,
    });
    const page = await context.newPage();
    const capturedOtps: CapturedOtps = {};
    attachOtpCapture(page, capturedOtps);
    attachApiErrorWatcher(page, runId, session.apiUrl, () => activeIso);
    cdp = await attachScreencast(runId, page);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await clearAppSession(page, baseUrl);
    updateStep(runId, 'boot', {
      status: 'passed',
      message: `Opened ${baseUrl} with a clean user session`,
    });

    for (const country of fixtures) {
      try {
        await runCountryWithRetry(
          runId,
          page,
          baseUrl,
          country,
          session.abortController.signal,
          capturedOtps,
          (iso) => {
            activeIso = iso;
          },
          cdp,
        );
      } catch (err) {
        if (session.abortController.signal.aborted) {
          await setRunStatus(runId, 'stopped');
          return;
        }
        console.error(`[${country.isoCode}] flow error`, err);
      } finally {
        activeIso = undefined;
      }
    }

    updateStep(runId, 'wrap-up', { status: 'running' });
    await page.waitForTimeout(500);
    const apiCount = getSession(runId)?.apiErrors.length || 0;
    updateStep(runId, 'wrap-up', {
      status: 'passed',
      message:
        apiCount > 0
          ? `Browser closed · ${apiCount} API error(s) recorded in report`
          : 'Browser closed',
    });

    const failed = getSession(runId)?.steps.some((s) => s.status === 'failed');
    const apiErrors = getSession(runId)?.apiErrors || [];
    if (failed) {
      const apiSummary =
        apiErrors.length > 0
          ? ` · ${apiErrors.length} API error(s): ${apiErrors
              .slice(0, 2)
              .map(formatApiError)
              .join(' · ')}`
          : '';
      await setRunStatus(runId, 'failed', `One or more countries failed${apiSummary}`);
    } else {
      await setRunStatus(runId, 'completed');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown runner error';
    updateStep(runId, 'boot', { status: 'failed', message });
    await setRunStatus(runId, 'failed', message);
  } finally {
    try {
      await cdp?.send('Page.stopScreencast').catch(() => undefined);
      await cdp?.detach().catch(() => undefined);
    } catch {
      // ignore
    }
    await browser?.close().catch(() => undefined);
  }
}

/** @deprecated Use runSignupCountries with location-API fixtures */
export async function runMultiCountrySignupLogin(runId: string, baseUrl: string) {
  await runSignupCountries(runId, baseUrl, buildCountryFixtures());
}

export function createSessionStepsFromFixtures(fixtures: CountrySignupFixture[]) {
  return buildStepsForCountries(fixtures);
}

export function createMultiCountrySessionSteps() {
  return buildStepsForCountries(buildCountryFixtures());
}
