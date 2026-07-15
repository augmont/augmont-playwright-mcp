import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  SIGNUP_LOGIN_ID,
  buildSignupLoginTest,
  getMobileTestCase,
  isMobileTestId,
  isSignupLoginTestId,
  parseSignupIsoFromTestId,
  resolveTestCase,
} from '@/lib/test-registry';
import { createSession, toSnapshot } from '@/server/session-manager';
import { fetchCountries, findCountryByIso } from '@/server/location-client';
import {
  createSessionStepsFromFixtures,
  runSignupCountries,
} from '@/server/runner';
import { buildFixtureForCountry } from '@/server/tests/multi-country-signup-login';
import {
  createMobileTestSession,
  runMobileTestCase,
} from '@/server/mobile-test-runner';
import { getWebFlowCase } from '@/server/web-test-store';
import { getWebLoadCase } from '@/server/web-load-store';
import { getVaptCase } from '@/server/vapt-store';
import { createWebFlowSessionSteps, runWebFlow } from '@/server/web-flow-runner';
import {
  createWebLoadSessionSteps,
  runWebLoad,
} from '@/server/web-load-runner';
import { createVaptSessionSteps, runVapt } from '@/server/vapt-runner';
import type { RoleCredentialsMap } from '@/lib/role-credentials';
import { sanitizeClientAiKeys } from '@/server/ai-keys-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeRoleCredentials(
  raw?: {
    buyer?: { email?: string; password?: string };
    admin?: { email?: string; password?: string };
    seller?: { email?: string; password?: string };
  },
): RoleCredentialsMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: RoleCredentialsMap = {};
  for (const key of ['buyer', 'admin', 'seller'] as const) {
    const c = raw[key];
    const email = (c?.email || '').trim();
    const password = c?.password || '';
    if (email && password) out[key] = { email, password };
  }
  return Object.keys(out).length ? out : undefined;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ testId: string }> },
) {
  const { testId } = await context.params;

  const body = (await request.json().catch(() => ({}))) as {
    mode?: 'web' | 'mobile' | 'web-load' | 'vapt';
    baseUrl?: string;
    apiUrl?: string;
    isoCode?: string;
    webSessionId?: string;
    branch?: 'positive' | 'negative';
    expectation?: 'positive' | 'negative';
    roleCredentials?: {
      buyer?: { email?: string; password?: string };
      admin?: { email?: string; password?: string };
      seller?: { email?: string; password?: string };
    };
    /** Multi-user load auth credentials (username/password) */
    loadAuthCredentials?: Array<{
      id?: string;
      label?: string;
      username?: string;
      password?: string;
    }>;
    loadAuthLogin?: {
      loginPath?: string;
      method?: string;
      usernameField?: string;
      passwordField?: string;
      extraBody?: Record<string, string>;
      tokenJsonPath?: string;
      tokenHeader?: string;
      tokenPrefix?: string;
    };
    /** Pre-obtained Authorization header values (e.g. "Bearer …") */
    authHeaderValues?: string[];
    authHeaderName?: string;
    loadAuthMeta?: {
      swaggerUrl?: string;
      loginPath?: string;
      credentialLabels?: string[];
      selectedOperations?: Array<{
        method: string;
        path: string;
        summary?: string;
        requiresAuth?: boolean;
      }>;
    };
    platform?: 'android' | 'ios';
    osVersion?: string;
    deviceVersion?: string;
    appDriveUrl?: string;
    appiumUrl?: string;
    /** VAPT runtime AI multi-query + fail-level escalation (default true) */
    runtimeAi?: boolean;
    provider?: string;
    model?: string;
    openRouterApiKey?: string;
    anthropicApiKey?: string;
  };

  const mode =
    body.mode === 'mobile' || isMobileTestId(testId)
      ? 'mobile'
      : body.mode === 'vapt' || getVaptCase(testId)
        ? 'vapt'
        : body.mode === 'web-load' || getWebLoadCase(testId)
          ? 'web-load'
          : 'web';

  // —— Mobile-only suites ——
  if (mode === 'mobile' && isMobileTestId(testId)) {
    const meta = getMobileTestCase(testId);
    if (!meta) {
      return NextResponse.json({ error: 'Unknown mobile test case' }, { status: 404 });
    }

    const platform = body.platform === 'ios' ? 'ios' : body.platform === 'android' ? 'android' : null;
    const appiumUrl = (body.appiumUrl || '').trim().replace(/\/+$/, '');
    const appDriveUrl = (body.appDriveUrl || '').trim();
    const osVersion = (body.osVersion || '').trim();
    const deviceVersion = (body.deviceVersion || '').trim();
    const apiUrl = (body.apiUrl || '').trim().replace(/\/+$/, '');

    if (!platform) {
      return NextResponse.json({ error: 'platform must be android or ios' }, { status: 400 });
    }
    if (!appiumUrl || !/^https?:\/\//i.test(appiumUrl)) {
      return NextResponse.json({ error: 'Valid appiumUrl is required' }, { status: 400 });
    }
    if (!appDriveUrl) {
      return NextResponse.json({ error: 'appDriveUrl is required' }, { status: 400 });
    }
    if (!osVersion || !deviceVersion) {
      return NextResponse.json(
        { error: 'osVersion and deviceVersion are required' },
        { status: 400 },
      );
    }

    const runId = uuidv4();
    const platformLabel = platform === 'android' ? 'Android' : 'iOS';
    const session = createMobileTestSession({
      runId,
      testId,
      testName: `${meta.name} · ${platformLabel} ${osVersion}`,
      appiumUrl,
      apiUrl: apiUrl || undefined,
      platform,
    });

    void runMobileTestCase(runId, {
      testId,
      platform,
      osVersion,
      deviceVersion,
      appDriveUrl,
      appiumUrl,
    });

    return NextResponse.json({ runId, snapshot: toSnapshot(session) });
  }

  // —— VAPT security probes ——
  const vaptCase = getVaptCase(testId);
  if (vaptCase) {
    const baseUrl = (body.baseUrl || '').trim().replace(/\/+$/, '');
    const apiUrl = (body.apiUrl || '').trim().replace(/\/+$/, '') || undefined;
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json(
        { error: 'Valid baseUrl (http/https) is required' },
        { status: 400 },
      );
    }
    if (vaptCase.vapt.useApiBase && (!apiUrl || !/^https?:\/\//i.test(apiUrl))) {
      return NextResponse.json(
        { error: 'Valid apiUrl is required for this API VAPT scenario' },
        { status: 400 },
      );
    }

    const steps = createVaptSessionSteps(vaptCase);
    const runId = uuidv4();
    const session = createSession({
      runId,
      testId: vaptCase.id,
      testName: vaptCase.name,
      testDescription: vaptCase.description,
      baseUrl,
      apiUrl,
      steps,
    });
    const aiKeys = sanitizeClientAiKeys(body);
    void runVapt(runId, baseUrl, vaptCase, {
      apiUrl,
      runtimeAi: body.runtimeAi !== false,
      provider: body.provider,
      model: body.model,
      openRouterApiKey: aiKeys.openRouterApiKey,
      anthropicApiKey: aiKeys.anthropicApiKey,
    });
    return NextResponse.json({ runId, snapshot: toSnapshot(session) });
  }

  // —— HTTP web load tests ——
  const webLoad = getWebLoadCase(testId);
  if (webLoad) {
    const baseUrl = (body.baseUrl || '').trim().replace(/\/+$/, '');
    const apiUrl = (body.apiUrl || '').trim().replace(/\/+$/, '') || undefined;
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json(
        { error: 'Valid baseUrl (http/https) is required' },
        { status: 400 },
      );
    }
    if (webLoad.load.useApiBase && (!apiUrl || !/^https?:\/\//i.test(apiUrl))) {
      return NextResponse.json(
        { error: 'Valid apiUrl is required for this API load scenario' },
        { status: 400 },
      );
    }

    const loadAuthCredentials = Array.isArray(body.loadAuthCredentials)
      ? body.loadAuthCredentials
          .map((c, i) => ({
            id: String(c?.id || `cred-${i + 1}`),
            label: String(c?.label || `User ${i + 1}`).trim() || `User ${i + 1}`,
            username: String(c?.username || '').trim(),
            password: String(c?.password || ''),
          }))
          .filter((c) => c.username && c.password)
      : undefined;

    const loginRaw = body.loadAuthLogin;
    const authLogin =
      loginRaw?.loginPath?.trim()
        ? {
            loginPath: loginRaw.loginPath.trim(),
            method: (loginRaw.method as 'POST' | 'GET' | undefined) || 'POST',
            usernameField: loginRaw.usernameField,
            passwordField: loginRaw.passwordField,
            extraBody: loginRaw.extraBody,
            tokenJsonPath: loginRaw.tokenJsonPath,
            tokenHeader: loginRaw.tokenHeader,
            tokenPrefix: loginRaw.tokenPrefix,
          }
        : undefined;

    const authHeaderValues = Array.isArray(body.authHeaderValues)
      ? body.authHeaderValues.map(String).filter((v) => v.trim())
      : undefined;

    const loadAuthMeta = body.loadAuthMeta
      ? {
          swaggerUrl: body.loadAuthMeta.swaggerUrl,
          loginPath: body.loadAuthMeta.loginPath || authLogin?.loginPath,
          credentialLabels:
            body.loadAuthMeta.credentialLabels ||
            loadAuthCredentials?.map((c) => c.label) ||
            [],
          selectedOperations: body.loadAuthMeta.selectedOperations || [],
          requiresAuth: Boolean(
            webLoad.load.requiresAuth ||
              loadAuthCredentials?.length ||
              authHeaderValues?.length,
          ),
          tokenObtained: false,
          tokenCount: 0,
        }
      : undefined;

    const steps = createWebLoadSessionSteps(webLoad);
    const runId = uuidv4();
    const session = createSession({
      runId,
      testId: webLoad.id,
      testName: webLoad.name,
      testDescription: webLoad.description,
      baseUrl,
      apiUrl,
      steps,
      loadAuth: loadAuthMeta,
    });
    void runWebLoad(runId, baseUrl, webLoad, {
      apiUrl,
      authCredentials: loadAuthCredentials,
      authLogin,
      authHeaderValues,
      authHeaderName: body.authHeaderName,
      loadAuthMeta,
    });
    return NextResponse.json({ runId, snapshot: toSnapshot(session) });
  }

  // —— Declarative web-flow suites ——
  const webFlow = !isSignupLoginTestId(testId) ? getWebFlowCase(testId) : undefined;
  if (webFlow) {
    const baseUrl = (body.baseUrl || '').trim().replace(/\/+$/, '');
    const apiUrl = (body.apiUrl || '').trim().replace(/\/+$/, '') || undefined;
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json(
        { error: 'Valid baseUrl (http/https) is required' },
        { status: 400 },
      );
    }

    const branch =
      body.branch === 'negative' || body.expectation === 'negative'
        ? 'negative'
        : 'positive';
    const steps = createWebFlowSessionSteps(webFlow, branch);
    const runId = uuidv4();
    const session = createSession({
      runId,
      testId: webFlow.id,
      testName: webFlow.name,
      testDescription: webFlow.description,
      role: webFlow.role,
      expectation: branch,
      pairId: webFlow.pairId || webFlow.id,
      baseUrl,
      apiUrl,
      steps,
    });
    void runWebFlow(runId, baseUrl, webFlow, {
      webSessionId: (body.webSessionId || '').trim() || undefined,
      roleCredentials: sanitizeRoleCredentials(body.roleCredentials),
      branch,
    });
    return NextResponse.json({ runId, snapshot: toSnapshot(session) });
  }

  if (!isSignupLoginTestId(testId)) {
    return NextResponse.json({ error: 'Unknown test case' }, { status: 404 });
  }

  const apiUrl = (body.apiUrl || '').trim().replace(/\/+$/, '');
  if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
    return NextResponse.json(
      { error: 'Valid apiUrl (http/https) is required to load countries' },
      { status: 400 },
    );
  }

  if (mode === 'mobile') {
    return NextResponse.json(
      {
        error:
          'Use mobile-specific tests: mobile-app-launch, mobile-onboarding, or mobile-signup-login',
      },
      { status: 400 },
    );
  }

  // —— Web signup & login (Playwright multi-country) ——
  const baseUrl = (body.baseUrl || '').trim().replace(/\/+$/, '');

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    return NextResponse.json(
      { error: 'Valid baseUrl (http/https) is required' },
      { status: 400 },
    );
  }

  let countries;
  try {
    countries = await fetchCountries(apiUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load countries';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const resolved = resolveTestCase(testId, countries) || buildSignupLoginTest(countries.length);
  if (!resolved) {
    return NextResponse.json(
      { error: `Unknown or unavailable test case: ${testId}` },
      { status: 404 },
    );
  }

  const singleIso =
    body.isoCode?.toUpperCase() ||
    resolved.isoCode ||
    parseSignupIsoFromTestId(testId);

  const selected = singleIso
    ? (() => {
        const match = findCountryByIso(countries, singleIso);
        if (!match) return null;
        return [match];
      })()
    : countries;

  if (!selected || selected.length === 0) {
    return NextResponse.json(
      { error: singleIso ? `Country ${singleIso} not found in location API` : 'No countries' },
      { status: 404 },
    );
  }

  const fixtures = selected.map(buildFixtureForCountry);
  const steps = createSessionStepsFromFixtures(fixtures);
  const runId = uuidv4();

  const testName = singleIso
    ? `Signup & Login — ${selected[0]!.name} (${singleIso})`
    : `Signup & Login — all countries (${selected.length})`;

  const session = createSession({
    runId,
    testId: SIGNUP_LOGIN_ID,
    testName,
    baseUrl,
    apiUrl,
    steps,
  });

  void runSignupCountries(runId, baseUrl, fixtures);

  return NextResponse.json({ runId, snapshot: toSnapshot(session) });
}
