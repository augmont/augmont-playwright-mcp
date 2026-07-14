import { mkdirSync } from 'fs';
import path from 'path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import type { TestStep, WebLoadTestCase } from '@/lib/types';
import {
  getSession,
  setFrame,
  setRunStatus,
  skipRemainingSteps,
  updateLoadMetrics,
  updateStep,
} from '@/server/session-manager';
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

export function createWebLoadSessionSteps(test: WebLoadTestCase): TestStep[] {
  const { load } = test;
  const stepCount = load.requests?.length || 1;
  const multi =
    stepCount > 1 ? ` · ${stepCount} requests/iteration` : '';
  return [
    {
      id: 'load-prepare',
      label: 'Prepare JMeter plan',
      description: `Generate .jmx · ${load.virtualUsers} VUs · ramp ${load.rampUpSec}s · ${load.durationSec}s${multi}${load.profile === 'advanced' ? ' · advanced' : ''}`,
      status: 'pending',
      action: 'wait',
    },
    {
      id: 'load-mcp',
      label: 'Open MCP live browser view',
      description: 'Playwright screencast of the target page while load runs',
      status: 'pending',
      action: 'goto',
    },
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
      description: `Max error rate ${load.maxErrorRatePct}% · p95 ≤ ${load.p95Ms}ms`,
      status: 'pending',
      action: 'assertVisible',
    },
  ];
}

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
  opts?: { apiUrl?: string },
): Promise<void> {
  const session = getSession(runId);
  if (!session) return;

  const { load } = test;
  const targetUrl = resolveLoadTargetUrl(test, baseUrl, opts?.apiUrl);
  const mcpUrl = load.useApiBase
    ? baseUrl.replace(/\/+$/, '') || targetUrl
    : targetUrl;
  const signal = session.abortController.signal;
  const startedAt = Date.now();
  let logLines: string[] = [];
  let browser: Browser | undefined;
  let cdp: CDPSession | undefined;
  let jmeterProc: ReturnType<typeof spawnJmeter>['proc'] | undefined;
  let stopWatch: (() => void) | undefined;

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

  await setRunStatus(runId, 'running');

  try {
    // —— 1) Prepare JMeter ——
    updateStep(runId, 'load-prepare', {
      status: 'running',
      message: `Target ${load.method} ${targetUrl}`,
    });
    onLog(`Run dir ${runDir}`);
    onLog(`Writing JMX for ${load.virtualUsers} threads…`);

    const samplers = resolveLoadSamplers(test, baseUrl, opts?.apiUrl);
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
    });
    onLog(`JMX → ${jmxPath}`);

    const jmeterBin = await ensureJmeterBin(onLog);
    updateStep(runId, 'load-prepare', {
      status: 'passed',
      message: `JMeter ready · ${path.basename(jmeterBin)}`,
      detail: jmxPath,
    });
    emitMetricsFromAgg(parseJtlFile(jtlPath));

    if (signal.aborted) throw new Error('Load test stopped');

    // —— 2) MCP live view (Playwright screencast) ——
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
    const page = await context.newPage();
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
    const mcpRefresh = setInterval(() => {
      if (signal.aborted) return;
      void page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
    }, 8_000);

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
        message: `${m.totalRequests} samples · ${m.rps} rps · p95 ${m.p95Ms}ms · err ${m.errorRatePct}% · threads ${m.jmeterThreads || 0}`,
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
    clearInterval(mcpRefresh);
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
      message: `${finalMetrics.totalRequests} samples · ${finalMetrics.rps} rps · p95 ${finalMetrics.p95Ms}ms`,
      detail: `JTL ${path.relative(process.cwd(), jtlPath)}`,
    });
    onLog(
      `JMeter finished · requests=${finalMetrics.totalRequests} err%=${finalMetrics.errorRatePct} p95=${finalMetrics.p95Ms}`,
    );
    emitMetricsFromAgg(finalAgg);

    // Crisp final MCP frame + report screenshot
    let finalShot: string | undefined;
    try {
      const jpeg = await captureLivePreviewJpeg(page);
      if (jpeg) setFrame(runId, jpeg);
      finalShot = await captureViewportScreenshot(page, runId, 'load-final');
    } catch {
      // ignore
    }

    // —— 4) Thresholds ——
    updateStep(runId, 'load-thresholds', { status: 'running' });
    const errFail = finalMetrics.errorRatePct > load.maxErrorRatePct;
    const p95Fail = finalMetrics.p95Ms > load.p95Ms;
    const noTraffic = finalMetrics.totalRequests === 0;

    if (noTraffic || errFail || p95Fail) {
      const reasons: string[] = [];
      if (noTraffic) reasons.push('No JMeter samples recorded');
      if (errFail)
        reasons.push(
          `Error rate ${finalMetrics.errorRatePct}% > ${load.maxErrorRatePct}%`,
        );
      if (p95Fail)
        reasons.push(`p95 ${finalMetrics.p95Ms}ms > ${load.p95Ms}ms`);
      updateStep(runId, 'load-thresholds', {
        status: 'failed',
        message: reasons.join(' · '),
        detail: JSON.stringify(finalMetrics.statusCounts),
        screenshotPath: finalShot,
      });
      onLog(`Thresholds FAILED: ${reasons.join('; ')}`);
      emitMetricsFromAgg(finalAgg);
      await setRunStatus(runId, 'failed', reasons.join('; '));
      return;
    }

    updateStep(runId, 'load-thresholds', {
      status: 'passed',
      message: `Error ${finalMetrics.errorRatePct}% ≤ ${load.maxErrorRatePct}% · p95 ${finalMetrics.p95Ms}ms ≤ ${load.p95Ms}ms`,
      screenshotPath: finalShot,
    });
    onLog('Thresholds PASSED');
    emitMetricsFromAgg(finalAgg);
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
