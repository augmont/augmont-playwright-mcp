import { promises as fs } from 'fs';
import path from 'path';
import type { RunReport, RunSnapshot, TestStep } from '@/lib/types';
import { buildReportFlowChart } from '@/lib/flow-chart';
import { enrichReportWithAiSummary, buildLocalReportAiSummary } from '@/server/report-ai-summary';
import { buildLoadGradeSummary, defaultLoadP99Ms } from '@/lib/load-grade-summary';
import { getWebLoadCase } from '@/server/web-load-store';
import { generateReportPdf, reportPdfAbsolutePath } from '@/server/report-pdf';

const MAX_REPORTS = 20;
const DATA_DIR = path.join(process.cwd(), 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'run-history.json');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readAll(): Promise<RunReport[]> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as RunReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(reports: RunReport[]) {
  await ensureDataDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(reports, null, 2), 'utf8');
}

function buildGuidance(snapshot: RunSnapshot, failed: TestStep[], passed: number): string {
  const local = buildLocalReportAiSummary({
    runId: snapshot.runId,
    testId: snapshot.testId,
    testName: snapshot.testName || snapshot.testId,
    testDescription: snapshot.testDescription,
    role: snapshot.role,
    baseUrl: snapshot.baseUrl,
    apiUrl: snapshot.apiUrl,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    countryResults: snapshot.countryResults || [],
    apiErrors: snapshot.apiErrors || [],
    steps: snapshot.steps || [],
    stepCounts: {
      completed: snapshot.completed,
      inProgress: snapshot.inProgress,
      remaining: snapshot.remaining,
      total: snapshot.total,
      passed,
      failed: failed.length,
      skipped: (snapshot.steps || []).filter((s) => s.status === 'skipped').length,
    },
    error: snapshot.error,
  });
  return [local.headline, local.narrative, local.whyFailed].filter(Boolean).join(' ');
}

export function snapshotToReport(snapshot: RunSnapshot): RunReport {
  const steps = snapshot.steps || [];
  const passed = steps.filter((s) => s.status === 'passed').length;
  const failedSteps = steps.filter((s) => s.status === 'failed');
  const failed = failedSteps.length;
  const skipped = steps.filter((s) => s.status === 'skipped').length;
  const started = snapshot.startedAt ? Date.parse(snapshot.startedAt) : NaN;
  const finished = snapshot.finishedAt ? Date.parse(snapshot.finishedAt) : NaN;
  const durationMs =
    Number.isFinite(started) && Number.isFinite(finished) && finished >= started
      ? finished - started
      : undefined;

  let loadGradeSummary = snapshot.loadGradeSummary;
  if (!loadGradeSummary && snapshot.loadMetrics) {
    const loadCase = getWebLoadCase(snapshot.testId);
    loadGradeSummary = buildLoadGradeSummary({
      metrics: snapshot.loadMetrics,
      thresholds: loadCase?.load || {
        maxErrorRatePct: 10,
        p95Ms: 4000,
        p99Ms: defaultLoadP99Ms(4000),
        virtualUsers: snapshot.loadMetrics.virtualUsers,
        durationSec: snapshot.loadMetrics.elapsedSec,
      },
      status: snapshot.status,
      error: snapshot.error,
    });
  }

  return {
    runId: snapshot.runId,
    testId: snapshot.testId,
    testName: snapshot.testName || snapshot.testId,
    testDescription: snapshot.testDescription,
    role: snapshot.role,
    expectation: snapshot.expectation,
    pairId: snapshot.pairId,
    baseUrl: snapshot.baseUrl,
    apiUrl: snapshot.apiUrl,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    durationMs,
    guidance: buildGuidance(snapshot, failedSteps, passed),
    countryResults: snapshot.countryResults || [],
    apiErrors: snapshot.apiErrors || [],
    steps,
    flowChart: snapshot.flowChart?.length
      ? snapshot.flowChart
      : buildReportFlowChart(steps),
    stepCounts: {
      completed: snapshot.completed,
      inProgress: snapshot.inProgress,
      remaining: snapshot.remaining,
      total: snapshot.total,
      passed,
      failed,
      skipped,
    },
    error: snapshot.error,
    loadMetrics: snapshot.loadMetrics,
    loadAuth: snapshot.loadAuth,
    loadGradeSummary,
    vaptFindings: snapshot.vaptFindings,
  };
}

async function removeReportArtifacts(runId: string, pdfPath?: string) {
  if (pdfPath) {
    await fs.unlink(path.join(DATA_DIR, pdfPath)).catch(() => undefined);
  } else {
    await fs.unlink(reportPdfAbsolutePath(runId)).catch(() => undefined);
  }
  await fs.rm(path.join(DATA_DIR, 'reports', runId), { recursive: true, force: true }).catch(
    () => undefined,
  );
}

export async function pushReport(report: RunReport): Promise<void> {
  // 1) Persist immediately with local summary so Reports drawer is never blocked on AI/PDF.
  const localSummary = report.aiSummary || buildLocalReportAiSummary(report);
  const immediate: RunReport = {
    ...report,
    aiSummary: localSummary,
    guidance:
      report.guidance ||
      [localSummary.headline, localSummary.narrative, localSummary.whyFailed]
        .filter(Boolean)
        .join(' '),
  };

  const existing = await readAll();
  const dropped = existing.filter((r) => r.runId !== immediate.runId).slice(MAX_REPORTS - 1);
  for (const old of dropped) {
    await removeReportArtifacts(old.runId, old.pdfPath);
  }
  const next = [immediate, ...existing.filter((r) => r.runId !== immediate.runId)].slice(
    0,
    MAX_REPORTS,
  );
  await writeAll(next);

  // 2) Enrich + PDF in background; update the same runId when ready.
  void (async () => {
    let enriched = immediate;
    try {
      enriched = await enrichReportWithAiSummary(immediate);
    } catch (err) {
      console.error('[report-ai] enrich failed', err);
    }

    let withPdf = enriched;
    try {
      const pdfPath = await generateReportPdf(enriched);
      withPdf = { ...enriched, pdfPath };
    } catch (err) {
      console.error('[report-pdf] failed to generate PDF', err);
    }

    try {
      const latest = await readAll();
      const updated = [withPdf, ...latest.filter((r) => r.runId !== withPdf.runId)].slice(
        0,
        MAX_REPORTS,
      );
      await writeAll(updated);
    } catch (err) {
      console.error('[run-history] failed to update enriched report', err);
    }
  })();
}

export async function listReports(): Promise<RunReport[]> {
  const all = await readAll();
  return all.map(enrichReportForView);
}

export async function getReport(runId: string): Promise<RunReport | undefined> {
  const all = await readAll();
  const report = all.find((r) => r.runId === runId);
  if (!report) return undefined;
  return enrichReportForView(report);
}

/** Fill guidance/duration for older stored reports so modal + PDF stay useful. */
function enrichReportForView(report: RunReport): RunReport {
  const steps = report.steps || [];
  const failedSteps = steps.filter((s) => s.status === 'failed');
  const passed = report.stepCounts?.passed ?? steps.filter((s) => s.status === 'passed').length;
  let durationMs = report.durationMs;
  if (durationMs == null) {
    const started = report.startedAt ? Date.parse(report.startedAt) : NaN;
    const finished = report.finishedAt ? Date.parse(report.finishedAt) : NaN;
    if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
      durationMs = finished - started;
    }
  }
  return {
    ...report,
    steps,
    countryResults: report.countryResults || [],
    apiErrors: report.apiErrors || [],
    durationMs,
    guidance:
      report.guidance ||
      buildGuidance(
        {
          runId: report.runId,
          testId: report.testId,
          testName: report.testName,
          testDescription: report.testDescription,
          role: report.role,
          baseUrl: report.baseUrl,
          apiUrl: report.apiUrl,
          status: report.status,
          steps,
          completed: report.stepCounts?.completed ?? 0,
          inProgress: report.stepCounts?.inProgress ?? 0,
          remaining: report.stepCounts?.remaining ?? 0,
          total: report.stepCounts?.total ?? steps.length,
          error: report.error,
          startedAt: report.startedAt,
          finishedAt: report.finishedAt,
        },
        failedSteps,
        passed,
      ),
    aiSummary: report.aiSummary || buildLocalReportAiSummary(report),
  };
}

export async function getReportPdfBuffer(runId: string): Promise<Buffer | null> {
  const report = await getReport(runId);
  if (!report) return null;

  try {
    // Always regenerate so PDF matches current developer/tester report layout
    // (guidance, failure screenshots, step purpose/result).
    const pdfPath = await generateReportPdf({
      ...report,
      steps: report.steps || [],
      countryResults: report.countryResults || [],
      apiErrors: report.apiErrors || [],
    });
    const all = await readAll();
    const next = all.map((r) => (r.runId === runId ? { ...r, pdfPath } : r));
    await writeAll(next);
    return await fs.readFile(reportPdfAbsolutePath(runId));
  } catch (err) {
    console.error('[report-pdf] generate failed for', runId, err);
    const abs = report.pdfPath
      ? path.join(DATA_DIR, report.pdfPath)
      : reportPdfAbsolutePath(runId);
    try {
      return await fs.readFile(abs);
    } catch {
      return null;
    }
  }
}

export function reportScreenshotAbsolutePath(runId: string, fileName: string): string {
  return path.join(DATA_DIR, 'reports', runId, fileName);
}
