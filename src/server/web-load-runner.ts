import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import type {
  LoadAuthCredential,
  LoadAuthLoginConfig,
  TestStep,
  WebLoadAuthReport,
  WebLoadTestCase,
} from '@/lib/types';
import {
  getSession,
  setFrame,
  setRunStatus,
  skipRemainingSteps,
  updateLoadAuth,
  updateLoadGradeSummary,
  updateLoadMetrics,
  updateStep,
} from '@/server/session-manager';
import {
  buildLoadGradeSummary,
  listLoadThresholdFailures,
  resolveLoadThresholds,
} from '@/lib/load-grade-summary';
import {
  attachThrottledScreencast,
  stopScreencast,
} from '@/server/mcp-screencast';
import { resolveLoadSamplers, resolveLoadTargetUrl } from '@/server/web-load-store';
import {
  ensureJmeterBin,
  killJmeterProcess,
  spawnJmeter,
} from '@/server/jmeter-cli';
import { writeHttpLoadJmx } from '@/server/jmeter-jmx';
import { jtlToMetrics, parseJtlFile, watchJtlFile } from '@/server/jmeter-jtl';
import {
  captureLivePreviewJpeg,
  captureViewportScreenshot,
} from '@/server/report-capture';
import { obtainTokensForCredentials } from '@/server/load-auth-token';

export function createWebLoadSessionSteps(test: WebLoadTestCase): TestStep[] {
  const { load } = test;
  const stepCount = load.requests?.length || 1;
  const multi =
    stepCount > 1 ? ` · ${stepCount} requests/iteration` : '';
  /** Swagger/API suites are HTTP-only — no Playwright MCP browser. */
  const apiOnly = Boolean(load.swaggerUrl || load.useApiBase);
  const steps: TestStep[] = [
    {
      id: 'load-auth',
      label: 'Authorize & set tokens',
      description:
        'If the API requires auth: login with credentials, obtain tokens, attach to JMeter',
      status: 'pending',
      action: 'loginRole',
    },
    {
      id: 'load-prepare',
      label: 'Prepare JMeter plan',
      description: `Generate .jmx · ${load.virtualUsers} VUs · ramp ${load.rampUpSec}s · ${load.durationSec}s${multi}${load.profile === 'advanced' ? ' · advanced' : ''}`,
      status: 'pending',
      action: 'wait',
    },
  ];
  if (!apiOnly) {
    steps.push({
      id: 'load-mcp',
      label: 'Open MCP live browser view',
      description: 'Playwright screencast of the target page while load runs',
      status: 'pending',
      action: 'goto',
    });
  }
  steps.push(
    {
      id: 'load-jmeter',
      label:
        stepCount > 1
          ? `JMeter CLI · multi (${stepCount} steps)`
          : `JMeter CLI · ${load.method} ${load.targetUrl}`,
      description: 'Non-GUI jmeter -n -t … -l results.jtl',
      status: 'pending',
      action: 'goto',
    },
    {
      id: 'load-thresholds',
      label: 'Evaluate thresholds',
      description: (() => {
        const lim = resolveLoadThresholds(load);
        return `Max error ${lim.maxErrorRatePct}% · p50 ≤ ${lim.p50Ms}ms · p75 ≤ ${lim.p75Ms}ms · p90 ≤ ${lim.p90Ms}ms · p95 ≤ ${lim.p95Ms}ms · p99 ≤ ${lim.p99Ms}ms · avg ≤ ${lim.avgMs}ms`;
      })(),
      status: 'pending',
      action: 'assertVisible',
    },
  );
  return steps;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export type WebLoadRunOpts = {
  apiUrl?: string;
  /** Pre-obtained header values (e.g. "Bearer …") — preferred when client already fetched tokens */
  authHeaderValues?: string[];
  authHeaderName?: string;
  /** Credentials + login config — server obtains tokens when authHeaderValues omitted */
  authCredentials?: LoadAuthCredential[];
  authLogin?: LoadAuthLoginConfig;
  /** Report metadata (no secrets) */
  loadAuthMeta?: Partial<WebLoadAuthReport>;
};

async function attachScreencast(runId: string, page: Page): Promise<CDPSession> {
  return attachThrottledScreencast(runId, page);
}

function pushLog(lines: string[], line: string, max = 80): string[] {
  const next = [...lines, line];
  return next.length > max ? next.slice(-max) : next;
}

export async function runWebLoad(
  runId: string,
  baseUrl: string,
  test: WebLoadTestCase,
  opts?: WebLoadRunOpts,
): Promise<void> {
  const session = getSession(runId);
  if (!session) return;

  const { load } = test;
  const targetUrl = resolveLoadTargetUrl(test, baseUrl, opts?.apiUrl);
  /** Swagger / API base load: JMeter only — skip Playwright MCP browser. */
  const skipMcp = Boolean(load.swaggerUrl || load.useApiBase);
  const mcpUrl = load.useApiBase
    ? baseUrl.replace(/\/+$/, '') || targetUrl
    : targetUrl;
  const signal = session.abortController.signal;
  const startedAt = Date.now();
  let logLines: string[] = [];
  let browser: Browser | undefined;
  let cdp: CDPSession | undefined;
  let page: Page | undefined;
  let jmeterProc: ReturnType<typeof spawnJmeter>['proc'] | undefined;
  let stopWatch: (() => void) | undefined;
  let authCsvPath: string | undefined;
  let authHeaderName = opts?.authHeaderName || 'Authorization';
  let mcpRefresh: ReturnType<typeof setInterval> | undefined;

  const runDir = path.join(process.cwd(), 'data', 'load-runs', runId);
  mkdirSync(runDir, { recursive: true });
  const jmxPath = path.join(runDir, 'plan.jmx');
  const jtlPath = path.join(runDir, 'results.jtl');
  const jmeterLog = path.join(runDir, 'jmeter.log');
  const reportDir = path.join(runDir, 'html-report');

  const onLog = (line: string) => {
    logLines = pushLog(logLines, line);
  };

  const emitMetricsFromAgg = (agg: ReturnType<typeof parseJtlFile>) => {
    const metrics = jtlToMetrics(agg, {
      virtualUsers: load.virtualUsers,
      startedAt,
      engine: 'jmeter',
      jtlPath: path.relative(process.cwd(), jtlPath),
      jmxPath: path.relative(process.cwd(), jmxPath),
      reportDir: path.relative(process.cwd(), reportDir),
      logLines,
    });
    updateLoadMetrics(runId, metrics);
    return metrics;
  };

  const onAbort = () => {
    killJmeterProcess(jmeterProc);
  };
  signal.addEventListener('abort', onAbort);

  const baseAuthReport: WebLoadAuthReport = {
    swaggerUrl: opts?.loadAuthMeta?.swaggerUrl || load.swaggerUrl,
    loginPath: opts?.authLogin?.loginPath || opts?.loadAuthMeta?.loginPath,
    requiresAuth: Boolean(
      load.requiresAuth ||
        opts?.authCredentials?.length ||
        opts?.authHeaderValues?.length,
    ),
    tokenObtained: false,
    tokenCount: 0,
    credentialLabels:
      opts?.loadAuthMeta?.credentialLabels ||
      (opts?.authCredentials || []).map((c) => c.label),
    selectedOperations: opts?.loadAuthMeta?.selectedOperations || [
      {
        method: load.method,
        path: load.targetUrl,
        summary: test.name,
        requiresAuth: load.requiresAuth,
      },
    ],
    authHeaderName,
    apiOnly: skipMcp,
  };
  updateLoadAuth(runId, baseAuthReport);

  await setRunStatus(runId, 'running');

  try {
    // —— 0) Auth / tokens (when required or credentials provided) ——
    const wantsAuth =
      Boolean(load.requiresAuth) ||
      Boolean(opts?.authCredentials?.length) ||
      Boolean(opts?.authHeaderValues?.length);

    if (!wantsAuth) {
      updateStep(runId, 'load-auth', {
        status: 'skipped',
        message: 'No authorization required for this scenario',
      });
    } else {
      updateStep(runId, 'load-auth', {
        status: 'running',
        message: 'Obtaining tokens for load VUs…',
      });

      let headerValues = (opts?.authHeaderValues || [])
        .map((v) => String(v || '').trim())
        .filter(Boolean);

      if (!headerValues.length && opts?.authCredentials?.length && opts.authLogin) {
        onLog(
          `Logging in ${opts.authCredentials.length} credential(s) via ${opts.authLogin.loginPath}…`,
        );
        const { tokens, errors } = await obtainTokensForCredentials({
          credentials: opts.authCredentials,
          login: opts.authLogin,
          apiUrl: opts?.apiUrl,
          signal,
        });
        headerValues = tokens.map((t) => t.headerValue);
        for (const e of errors) {
          onLog(`Auth failed · ${e.label} (${e.username}): ${e.error}`);
        }
        if (!headerValues.length) {
          const msg =
            errors[0]?.error ||
            'Could not obtain any auth tokens — check credentials and login path';
          updateLoadAuth(runId, {
            ...baseAuthReport,
            tokenObtained: false,
            tokenCount: 0,
            error: msg,
          });
          updateStep(runId, 'load-auth', {
            status: 'failed',
            message: msg,
            detail: errors.map((e) => `${e.label}: ${e.error}`).join(' · '),
          });
          skipRemainingSteps(runId, msg);
          await setRunStatus(runId, 'failed', msg);
          return;
        }
        updateLoadAuth(runId, {
          ...baseAuthReport,
          tokenObtained: true,
          tokenCount: headerValues.length,
          credentialLabels: tokens.map((t) => t.label),
          authHeaderName,
        });
        onLog(`Obtained ${headerValues.length} token(s) for load`);
      } else if (headerValues.length) {
        updateLoadAuth(runId, {
          ...baseAuthReport,
          tokenObtained: true,
          tokenCount: headerValues.length,
          authHeaderName,
        });
        onLog(`Using ${headerValues.length} pre-set auth header value(s)`);
      } else if (load.requiresAuth) {
        const msg =
          'This API requires authorization — set username/password credentials and obtain tokens before running';
        updateLoadAuth(runId, {
          ...baseAuthReport,
          error: msg,
        });
        updateStep(runId, 'load-auth', {
          status: 'failed',
          message: msg,
        });
        skipRemainingSteps(runId, msg);
        await setRunStatus(runId, 'failed', msg);
        return;
      }

      if (headerValues.length) {
        const csvFile = path.join(runDir, 'auth-tokens.csv');
        const lines = [
          'authToken',
          ...headerValues.map((v) => csvEscape(v)),
        ];
        writeFileSync(csvFile, `${lines.join('\n')}\n`, 'utf8');
        authCsvPath = csvFile;
        onLog(`Auth CSV → ${csvFile} (${headerValues.length} token(s))`);
        updateStep(runId, 'load-auth', {
          status: 'passed',
          message: `${headerValues.length} token(s) attached to JMeter plan`,
          detail: `Header: ${authHeaderName} · credentials: ${(
            opts?.authCredentials || []
          )
            .map((c) => c.label)
            .join(', ') || 'pre-set'}`,
        });
      } else {
        updateStep(runId, 'load-auth', {
          status: 'skipped',
          message: 'No auth applied',
        });
      }
    }

    if (signal.aborted) throw new Error('Load test stopped');

    // —— 1) Prepare JMeter ——
    updateStep(runId, 'load-prepare', {
      status: 'running',
      message: `Target ${load.method} ${targetUrl}`,
    });
    onLog(`Run dir ${runDir}`);
    onLog(`Writing JMX for ${load.virtualUsers} threads…`);

    let samplers = resolveLoadSamplers(test, baseUrl, opts?.apiUrl);
    // If single token and no CSV (shouldn't happen), merge header; CSV path uses ${authToken}
    if (!authCsvPath && opts?.authHeaderValues?.[0]) {
      const hv = opts.authHeaderValues[0];
      samplers = samplers.map((s) => ({
        ...s,
        headers: { ...(s.headers || {}), [authHeaderName]: hv },
      }));
    }
    onLog(
      samplers.length > 1
        ? `Advanced plan · ${samplers.length} samplers/iteration`
        : `Single sampler · ${samplers[0]?.method} ${samplers[0]?.url}`,
    );

    writeHttpLoadJmx(jmxPath, {
      name: test.name,
      targetUrl,
      load,
      samplers,
      authCsvPath,
      authHeaderName,
    });
    onLog(`JMX → ${jmxPath}`);

    const jmeterBin = await ensureJmeterBin(onLog);
    updateStep(runId, 'load-prepare', {
      status: 'passed',
      message: `JMeter ready · ${path.basename(jmeterBin)}${authCsvPath ? ' · auth CSV' : ''}`,
      detail: jmxPath,
    });
    emitMetricsFromAgg(parseJtlFile(jtlPath));

    if (signal.aborted) throw new Error('Load test stopped');

    // —— 2) MCP live view (Playwright screencast) — portal loads only ——
    if (skipMcp) {
      onLog('Skipping MCP live browser (Swagger/API load — JMeter only)');
    } else {
      updateStep(runId, 'load-mcp', {
        status: 'running',
        message: `Opening ${mcpUrl}`,
      });
      browser = await chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage'],
      });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
      });
      page = await context.newPage();
      cdp = await attachScreencast(runId, page);
      try {
        await page.goto(mcpUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        const jpeg = await captureLivePreviewJpeg(page);
        if (jpeg) setFrame(runId, jpeg);
        const shotPath = await captureViewportScreenshot(page, runId, 'load-mcp');
        onLog(`MCP view loaded ${mcpUrl}`);
        updateStep(runId, 'load-mcp', {
          status: 'passed',
          message: 'Live screencast streaming',
          detail: mcpUrl,
          screenshotPath: shotPath,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'MCP navigate failed';
        onLog(`MCP warning: ${msg}`);
        const shotPath = await captureViewportScreenshot(page, runId, 'load-mcp').catch(
          () => undefined,
        );
        updateStep(runId, 'load-mcp', {
          status: 'passed',
          message: 'MCP started (page load warning)',
          detail: msg,
          screenshotPath: shotPath,
        });
      }

      // Soft-refresh MCP page periodically so UI under load is visible
      mcpRefresh = setInterval(() => {
        if (signal.aborted || !page) return;
        void page
          .reload({ waitUntil: 'domcontentloaded', timeout: 20_000 })
          .catch(() => undefined);
      }, 8_000);
    }

    if (signal.aborted) throw new Error('Load test stopped');

    // —— 3) JMeter CLI ——
    updateStep(runId, 'load-jmeter', {
      status: 'running',
      message: `jmeter -n -t plan.jmx -l results.jtl`,
    });
    onLog(
      `Starting JMeter: ${jmeterBin} -n -t ${jmxPath} -l ${jtlPath} (${load.durationSec}s)`,
    );

    stopWatch = watchJtlFile(jtlPath, (agg) => {
      const m = emitMetricsFromAgg(agg);
      updateStep(runId, 'load-jmeter', {
        status: 'running',
        message: `${m.totalRequests} samples · ${m.rps} rps · p95 ${m.p95Ms}ms · p99 ${m.p99Ms}ms · err ${m.errorRatePct}% · threads ${m.jmeterThreads || 0}`,
      });
    });

    const handle = spawnJmeter({
      jmeterBin,
      jmxPath,
      jtlPath,
      logFile: jmeterLog,
      // HTML report only after successful long runs can be slow; skip during short default runs
      reportDir: load.durationSec >= 45 ? reportDir : undefined,
      onStdout: (line) => onLog(`[jmeter] ${line}`),
      onStderr: (line) => onLog(`[jmeter:err] ${line}`),
    });
    jmeterProc = handle.proc;

    const result = await handle.done;
    if (mcpRefresh) clearInterval(mcpRefresh);
    stopWatch?.();
    stopWatch = undefined;

    if (signal.aborted) throw new Error('Load test stopped');

    const finalAgg = parseJtlFile(jtlPath);
    const finalMetrics = emitMetricsFromAgg(finalAgg);

    if (result.code && result.code !== 0 && finalMetrics.totalRequests === 0) {
      throw new Error(
        `JMeter exited with code ${result.code}. ${(result.stderr || result.stdout).slice(-500)}`,
      );
    }

    updateStep(runId, 'load-jmeter', {
      status: 'passed',
      message: `${finalMetrics.totalRequests} samples · ${finalMetrics.rps} rps · p95 ${finalMetrics.p95Ms}ms · p99 ${finalMetrics.p99Ms}ms`,
      detail: `JTL ${path.relative(process.cwd(), jtlPath)}`,
    });
    onLog(
      `JMeter finished · requests=${finalMetrics.totalRequests} err%=${finalMetrics.errorRatePct} p95=${finalMetrics.p95Ms} p99=${finalMetrics.p99Ms}`,
    );
    emitMetricsFromAgg(finalAgg);

    // Crisp final MCP frame + report screenshot (portal loads only)
    let finalShot: string | undefined;
    if (page) {
      try {
        const jpeg = await captureLivePreviewJpeg(page);
        if (jpeg) setFrame(runId, jpeg);
        finalShot = await captureViewportScreenshot(page, runId, 'load-final');
      } catch {
        // ignore
      }
    }

    // —— 4) Thresholds ——
    updateStep(runId, 'load-thresholds', { status: 'running' });
    const lim = resolveLoadThresholds(load);
    const reasons = listLoadThresholdFailures(finalMetrics, load);

    if (reasons.length) {
      updateStep(runId, 'load-thresholds', {
        status: 'failed',
        message: reasons.join(' · '),
        detail: JSON.stringify(finalMetrics.statusCounts),
        screenshotPath: finalShot,
      });
      onLog(`Thresholds FAILED: ${reasons.join('; ')}`);
      emitMetricsFromAgg(finalAgg);
      updateLoadGradeSummary(
        runId,
        buildLoadGradeSummary({
          metrics: finalMetrics,
          thresholds: {
            ...load,
            p50Ms: lim.p50Ms,
            p75Ms: lim.p75Ms,
            p90Ms: lim.p90Ms,
            p95Ms: lim.p95Ms,
            p99Ms: lim.p99Ms,
            avgMs: lim.avgMs,
            maxAvgLatencyMs: lim.avgLatencyMs,
            maxAvgConnectMs: lim.avgConnectMs,
          },
          status: 'failed',
          error: reasons.join('; '),
        }),
      );
      await setRunStatus(runId, 'failed', reasons.join('; '));
      return;
    }

    updateStep(runId, 'load-thresholds', {
      status: 'passed',
      message: `Error ${finalMetrics.errorRatePct}% ≤ ${lim.maxErrorRatePct}% · p50 ${finalMetrics.p50Ms} · p75 ${finalMetrics.p75Ms ?? 0} · p90 ${finalMetrics.p90Ms ?? 0} · p95 ${finalMetrics.p95Ms} · p99 ${finalMetrics.p99Ms} · avg ${finalMetrics.avgMs} ms (all ≤ limits)`,
      screenshotPath: finalShot,
    });
    onLog('Thresholds PASSED');
    emitMetricsFromAgg(finalAgg);
    updateLoadGradeSummary(
      runId,
      buildLoadGradeSummary({
        metrics: finalMetrics,
        thresholds: {
          ...load,
          p50Ms: lim.p50Ms,
          p75Ms: lim.p75Ms,
          p90Ms: lim.p90Ms,
          p95Ms: lim.p95Ms,
          p99Ms: lim.p99Ms,
          avgMs: lim.avgMs,
          maxAvgLatencyMs: lim.avgLatencyMs,
          maxAvgConnectMs: lim.avgConnectMs,
        },
        status: 'completed',
      }),
    );
    await setRunStatus(runId, 'completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Load test failed';
    onLog(`ERROR: ${message}`);
    skipRemainingSteps(runId, message);
    const status = /abort|stopp/i.test(message) ? 'stopped' : 'failed';
    try {
      const partial = jtlToMetrics(parseJtlFile(jtlPath), {
        virtualUsers: load.virtualUsers,
        startedAt,
        engine: 'jmeter',
        jtlPath: path.relative(process.cwd(), jtlPath),
        jmxPath: path.relative(process.cwd(), jmxPath),
        logLines,
      });
      updateLoadMetrics(runId, partial);
      updateLoadGradeSummary(
        runId,
        buildLoadGradeSummary({
          metrics: partial,
          thresholds: load,
          status,
          error: message,
        }),
      );
    } catch {
      updateLoadMetrics(runId, {
        elapsedSec: Math.round((Date.now() - startedAt) / 100) / 10,
        virtualUsers: load.virtualUsers,
        activeUsers: 0,
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        rps: 0,
        errorRatePct: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        avgMs: 0,
        statusCounts: {},
        engine: 'jmeter',
        jtlPath: path.relative(process.cwd(), jtlPath),
        jmxPath: path.relative(process.cwd(), jmxPath),
        logLines,
      });
    }
    await setRunStatus(runId, status, message);
  } finally {
    signal.removeEventListener('abort', onAbort);
    stopWatch?.();
    if (mcpRefresh) clearInterval(mcpRefresh);
    killJmeterProcess(jmeterProc);
    await stopScreencast(cdp);
    cdp = undefined;
    try {
      await browser?.close();
    } catch {
      // ignore
    }
    browser = undefined;
  }
}
