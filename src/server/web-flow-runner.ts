import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import type { ApiErrorRecord, WebFlowStep, WebTestCase } from '@/lib/types';
import type { RoleCredentialsMap } from '@/lib/role-credentials';
import { resolveSuiteBranchSteps, type TestExpectation } from '@/lib/test-expectation';
import {
  addApiError,
  currentRunningStepId,
  getSession,
  setFrame,
  setRunStatus,
  skipRemainingSteps,
  updateStep,
} from '@/server/session-manager';
import { performBuyerSignupLogin } from '@/server/runner';
import {
  captureFailureScreenshot,
  captureLivePreviewJpeg,
  highlightFromWebStep,
  stepFailDetail,
  stepPassDetail,
} from '@/server/report-capture';
import {
  clearLiveActionHighlight,
  showLiveActionHighlight,
  type LiveHighlightTone,
} from '@/server/live-highlight';
import {
  getSessionBuyerCreds,
  setSessionBuyerCreds,
} from '@/server/web-session-creds';

function resolveUrl(baseUrl: string, maybePath: string): string {
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  const base = baseUrl.replace(/\/+$/, '');
  const pathPart = maybePath.startsWith('/') ? maybePath : `/${maybePath}`;
  return `${base}${pathPart}`;
}

function isOurApiUrl(requestUrl: string, apiUrl?: string): boolean {
  if (!apiUrl) return false;
  try {
    const api = new URL(apiUrl);
    const req = new URL(requestUrl);
    if (req.origin !== api.origin) return false;
    const apiPath = api.pathname.replace(/\/+$/, '') || '';
    if (!apiPath || apiPath === '/') return /\/api(\/|$)/i.test(req.pathname);
    return req.pathname === apiPath || req.pathname.startsWith(`${apiPath}/`);
  } catch {
    return requestUrl.startsWith(apiUrl.replace(/\/+$/, ''));
  }
}

function attachApiErrorWatcher(page: Page, runId: string, apiUrl?: string) {
  page.on('response', async (response) => {
    try {
      const status = response.status();
      if (status < 400) return;
      const url = response.url();
      if (!isOurApiUrl(url, apiUrl)) return;
      let bodySnippet = '';
      try {
        bodySnippet = (await response.text()).slice(0, 280);
      } catch {
        // ignore
      }
      let message = response.statusText() || `HTTP ${status}`;
      try {
        const json = JSON.parse(bodySnippet) as { message?: string; error?: string };
        if (json.message) message = String(json.message);
        else if (json.error) message = String(json.error);
      } catch {
        // keep
      }
      const record: ApiErrorRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toISOString(),
        method: response.request().method(),
        url,
        status,
        statusText: response.statusText(),
        message,
        bodySnippet: bodySnippet || undefined,
        stepId: currentRunningStepId(runId),
      };
      addApiError(runId, record);
    } catch {
      // ignore
    }
  });
}

async function attachScreencast(runId: string, page: Page): Promise<CDPSession> {
  const { attachThrottledScreencast } = await import('@/server/mcp-screencast');
  return attachThrottledScreencast(runId, page);
}

/** Stop screencast before viewport expand — otherwise live view gets a tiny stretched JPEG. */
async function pauseScreencast(cdp?: CDPSession) {
  await cdp?.send('Page.stopScreencast').catch(() => undefined);
}

async function publishCrispLiveFrame(runId: string, page: Page) {
  const jpeg = await captureLivePreviewJpeg(page);
  if (jpeg) setFrame(runId, jpeg);
}

async function clearAppSession(page: Page, baseUrl: string) {
  const context = page.context();
  await context.clearCookies();
  try {
    const current = page.url();
    const targetOrigin = new URL(baseUrl).origin;
    if (!current.startsWith(targetOrigin)) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
  } catch {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
  }
  await page.evaluate(() => {
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
  });
}

async function loginWithCreds(page: Page, baseUrl: string, email: string, password: string) {
  await clearAppSession(page, baseUrl);
  await page.goto(resolveUrl(baseUrl, '/login'), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(600);
  await page.locator('#mobileNumber, [formcontrolname="mobileNumber"]').first().fill(email);
  await page
    .locator('[formcontrolname="password"] input, #password, input[type="password"]')
    .first()
    .fill(password);
  await page.getByRole('button', { name: /log\s*in|sign\s*in|submit/i }).first().click();
  await page.waitForTimeout(2500);
  const url = page.url();
  if (/\/login/i.test(url)) {
    const err = await page
      .locator('.p-toast-message-error, .p-error, .error, [class*="error"]')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(err?.trim() || `Login did not leave /login for ${email}`);
  }
}

function resolveRoleCredentials(
  role: string,
  map?: RoleCredentialsMap,
): { email: string; password: string } | null {
  const r = role.toLowerCase() as keyof RoleCredentialsMap;
  if (r !== 'buyer' && r !== 'admin' && r !== 'seller') return null;
  const c = map?.[r];
  if (c?.email?.trim() && c?.password) {
    return { email: c.email.trim(), password: c.password };
  }
  return null;
}

async function loginAsRole(
  page: Page,
  baseUrl: string,
  role: string,
  roleCredentials?: RoleCredentialsMap,
): Promise<string> {
  const creds = resolveRoleCredentials(role, roleCredentials);
  if (!creds) {
    throw new Error(
      `No ${role} credentials for this run. Click "Set credentials" in the header, save email/password for ${role}, then re-run. Values are tab-only (cleared when the tab closes).`,
    );
  }
  await loginWithCreds(page, baseUrl, creds.email, creds.password);
  return `Logged in as ${role} (${creds.email}) → ${page.url()}`;
}

/**
 * Prefer tab-session buyer credentials from the UI; otherwise signup once per webSessionId.
 */
async function ensureBuyerAuth(
  page: Page,
  baseUrl: string,
  apiUrl: string | undefined,
  webSessionId: string | undefined,
  roleCredentials?: RoleCredentialsMap,
): Promise<string> {
  const fixed = resolveRoleCredentials('buyer', roleCredentials);
  if (fixed) {
    await loginWithCreds(page, baseUrl, fixed.email, fixed.password);
    return `Logged in with set buyer credentials ${fixed.email} → ${page.url()}`;
  }

  if (!webSessionId?.trim()) {
    throw new Error(
      'Set buyer credentials (header → Set credentials), or provide webSessionId for one-time signup. Reload and try again.',
    );
  }

  const existing = getSessionBuyerCreds(webSessionId);
  if (existing) {
    await loginWithCreds(page, baseUrl, existing.email, existing.password);
    return `Reused tab-session buyer ${existing.email} → ${page.url()}`;
  }

  const created = await performBuyerSignupLogin(page, baseUrl, apiUrl);
  setSessionBuyerCreds(webSessionId, created);
  if (!/\/buyer/i.test(page.url())) {
    await loginWithCreds(page, baseUrl, created.email, created.password);
  }
  return `Signed up new buyer ${created.email} (saved for this tab) → ${page.url()}`;
}

async function highlightStepAction(page: Page, step: WebFlowStep) {
  const toneMap: Partial<Record<WebFlowStep['action'], LiveHighlightTone>> = {
    click: 'click',
    fill: 'fill',
    assertVisible: 'assert',
    assertUrl: 'assert',
    goto: 'goto',
    loginRole: 'info',
    ensureBuyer: 'info',
  };
  const tone = toneMap[step.action] || 'info';
  const detailBits = [
    step.selector ? `selector: ${step.selector}` : '',
    step.text ? `text: ${step.text}` : '',
    step.url ? `url: ${step.url}` : '',
  ].filter(Boolean);

  await showLiveActionHighlight(page, {
    tone,
    title: step.label || step.action,
    detail: detailBits.join(' · ') || step.action,
    selector: step.selector,
    text: step.text,
    holdMs: step.action === 'goto' || step.action === 'wait' ? 350 : 650,
  });
}

async function runStep(
  page: Page,
  baseUrl: string,
  step: WebFlowStep,
  ctx: {
    apiUrl?: string;
    webSessionId?: string;
    roleCredentials?: RoleCredentialsMap;
  },
) {
  const timeout = step.timeoutMs ?? 20000;

  // Highlight target in MCP live view before acting
  if (
    step.action === 'click' ||
    step.action === 'fill' ||
    step.action === 'assertVisible' ||
    step.action === 'assertUrl' ||
    step.action === 'goto' ||
    step.action === 'loginRole' ||
    step.action === 'ensureBuyer'
  ) {
    await highlightStepAction(page, step).catch(() => undefined);
  }

  try {
    switch (step.action) {
      case 'goto': {
        const target = resolveUrl(baseUrl, step.url || '/');
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(500);
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
        return `Opened ${target} (now ${page.url()})`;
      }
      case 'wait': {
        const ms = Math.min(Math.max(Number(step.value || 500), 0), 30_000);
        await page.waitForTimeout(ms);
        return `Waited ${ms}ms`;
      }
      case 'loginRole': {
        const role = (step.value || 'buyer').toLowerCase();
        return loginAsRole(page, baseUrl, role, ctx.roleCredentials);
      }
      case 'ensureBuyer': {
        return ensureBuyerAuth(
          page,
          baseUrl,
          ctx.apiUrl,
          ctx.webSessionId,
          ctx.roleCredentials,
        );
      }
      case 'fill': {
        if (!step.selector && !step.text) throw new Error('fill requires selector or text label');
        const loc = step.selector
          ? page.locator(step.selector).first()
          : page.getByLabel(new RegExp(step.text || '', 'i')).first();
        await loc.fill(step.value || '', { timeout });
        return `Filled ${step.selector || step.text}`;
      }
      case 'click': {
        // Scoped click: find text/button inside selector root(s)
        if (step.selector && step.text) {
          const selectors = step.selector
            .split(/\s*\|\|\s*/)
            .map((s) => s.trim())
            .filter(Boolean);
          const re = new RegExp(step.text, 'i');
          let lastErr: unknown;
          let used = '';
          for (const sel of selectors) {
            const perTry =
              selectors.length === 1 ? timeout : Math.max(3_000, Math.floor(timeout / selectors.length));
            try {
              const root = page.locator(sel);
              const btn = root.getByRole('button', { name: re }).first();
              if ((await btn.count()) > 0) {
                await btn.waitFor({ state: 'visible', timeout: perTry });
                await btn.scrollIntoViewIfNeeded().catch(() => undefined);
                await btn.click({ timeout: perTry });
              } else {
                const byText = root.getByText(re).first();
                await byText.waitFor({ state: 'visible', timeout: perTry });
                await byText.scrollIntoViewIfNeeded().catch(() => undefined);
                await byText.click({ timeout: perTry });
              }
              used = `${sel} ≫ ${step.text}`;
              break;
            } catch (err) {
              lastErr = err;
            }
          }
          if (!used) {
            throw lastErr instanceof Error
              ? lastErr
              : new Error(`Click failed for ${step.selector} + text "${step.text}"`);
          }
          await page.waitForTimeout(600);
          return `Clicked ${used}`;
        }
        if (step.selector) {
          const selectors = step.selector
            .split(/\s*\|\|\s*/)
            .map((s) => s.trim())
            .filter(Boolean);
          let lastErr: unknown;
          let used = '';
          for (const sel of selectors) {
            const perTry =
              selectors.length === 1 ? timeout : Math.max(3_000, Math.floor(timeout / selectors.length));
            try {
              const loc = page.locator(sel).first();
              await loc.waitFor({ state: 'visible', timeout: perTry });
              await loc.scrollIntoViewIfNeeded().catch(() => undefined);
              await loc.click({ timeout: perTry });
              used = sel;
              break;
            } catch (err) {
              lastErr = err;
            }
          }
          if (!used) {
            throw lastErr instanceof Error
              ? lastErr
              : new Error(`Click failed for selector(s): ${step.selector}`);
          }
          await page.waitForTimeout(600);
          return `Clicked ${used}`;
        }
        if (step.text) {
          const re = new RegExp(step.text, 'i');
          const btn = page.getByRole('button', { name: re }).first();
          if ((await btn.count()) > 0) await btn.click({ timeout });
          else {
            const byText = page.getByText(re).first();
            await byText.click({ timeout });
          }
          await page.waitForTimeout(600);
          return `Clicked ${step.text}`;
        }
        throw new Error('click requires selector or text');
      }
      case 'assertVisible': {
        if (step.selector) {
          const selectors = step.selector
            .split(/\s*\|\|\s*/)
            .map((s) => s.trim())
            .filter(Boolean);
          let lastErr: unknown;
          let matched = '';
          for (const sel of selectors) {
            const perTry =
              selectors.length === 1
                ? timeout
                : Math.max(3_000, Math.floor(timeout / selectors.length));
            try {
              await page.locator(sel).first().waitFor({ state: 'visible', timeout: perTry });
              matched = sel;
              break;
            } catch (err) {
              lastErr = err;
            }
          }
          if (!matched) {
            throw lastErr instanceof Error
              ? lastErr
              : new Error(`Not visible: ${step.selector}`);
          }
          return `Visible: ${matched}`;
        }
        const re = new RegExp(step.text || step.value || '.', 'i');
        await page.getByText(re).first().waitFor({ state: 'visible', timeout });
        return `Visible: ${step.text || step.value}`;
      }
      case 'assertUrl': {
        const needle = step.url || step.value || '';
        if (!needle) throw new Error('assertUrl requires url');
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (page.url().toLowerCase().includes(needle.toLowerCase())) {
            return `URL matches ${needle}`;
          }
          await page.waitForTimeout(300);
        }
        throw new Error(`Expected URL to include "${needle}", got ${page.url()}`);
      }
      default:
        throw new Error(`Unknown action: ${(step as WebFlowStep).action}`);
    }
  } finally {
    await clearLiveActionHighlight(page).catch(() => undefined);
  }
}

export function createWebFlowSessionSteps(
  test: WebTestCase,
  branch: TestExpectation = 'positive',
) {
  const steps = resolveSuiteBranchSteps(test, branch);
  return steps.map((s) => ({
    id: s.id,
    label: s.label,
    status: 'pending' as const,
    description: describeStep(s),
    action: s.action,
  }));
}

function describeStep(step: WebFlowStep): string {
  switch (step.action) {
    case 'goto':
      return `Open ${step.url || 'the page'} and confirm navigation succeeds.`;
    case 'assertUrl':
      return `URL should include "${step.url || step.value || ''}".`;
    case 'assertVisible':
      return `UI should show "${step.text || step.selector || 'target element'}".`;
    case 'click':
      return `Click "${step.text || step.selector || 'control'}" and wait for the UI to respond.`;
    case 'fill':
      return `Fill "${step.text || step.selector || 'field'}" with the expected value.`;
    case 'wait':
      return `Wait ${step.value || 'briefly'} for the UI to settle.`;
    case 'loginRole':
      return `Authenticate as ${step.value || 'role'} using credentials from Set credentials (this tab).`;
    case 'ensureBuyer':
      return 'Ensure a buyer session exists (signup once if needed, then login).';
    default:
      return step.label;
  }
}

function successDetail(step: WebFlowStep, message: string): string {
  return stepPassDetail(step.label, message);
}

function failureDetail(step: WebFlowStep, errMsg: string): string {
  return stepFailDetail(step.label, errMsg);
}

export async function runWebFlow(
  runId: string,
  baseUrl: string,
  test: WebTestCase,
  opts?: {
    webSessionId?: string;
    roleCredentials?: RoleCredentialsMap;
    branch?: TestExpectation;
  },
) {
  const session = getSession(runId);
  if (!session) throw new Error('Session not found');

  let browser: Browser | undefined;
  let cdp: CDPSession | undefined;
  const branchSteps = resolveSuiteBranchSteps(test, opts?.branch || 'positive');

  try {
    setRunStatus(runId, 'running');
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      storageState: undefined,
    });
    const page = await context.newPage();
    attachApiErrorWatcher(page, runId, session.apiUrl);
    cdp = await attachScreencast(runId, page);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await clearAppSession(page, baseUrl);

    const stepCtx = {
      apiUrl: session.apiUrl,
      webSessionId: opts?.webSessionId,
      roleCredentials: opts?.roleCredentials,
    };

    for (const step of branchSteps) {
      if (session.abortController.signal.aborted) {
        await setRunStatus(runId, 'stopped');
        return;
      }
      updateStep(runId, step.id, {
        status: 'running',
        description: describeStep(step),
      });
      try {
        const message = await runStep(page, baseUrl, step, stepCtx);
        updateStep(runId, step.id, {
          status: 'passed',
          message,
          description: describeStep(step),
          detail: successDetail(step, message),
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'Step failed';
        const detail = failureDetail(step, raw);
        await pauseScreencast(cdp);
        const screenshotPath = await captureFailureScreenshot(
          page,
          runId,
          step.id,
          highlightFromWebStep(step, raw),
        );
        await publishCrispLiveFrame(runId, page);
        updateStep(runId, step.id, {
          status: 'failed',
          message: raw,
          description: describeStep(step),
          detail,
          screenshotPath,
        });
        skipRemainingSteps(
          runId,
          `Skipped because "${step.label}" failed. Fix that step (see screenshot + message), then re-run.`,
        );
        await setRunStatus(runId, 'failed', detail);
        return;
      }
    }

    const failed = getSession(runId)?.steps.some((s) => s.status === 'failed');
    await setRunStatus(
      runId,
      failed ? 'failed' : 'completed',
      failed ? 'One or more steps failed — see failed steps and screenshots in the report.' : undefined,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Web flow failed';
    skipRemainingSteps(runId, `Run aborted: ${message}`);
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
