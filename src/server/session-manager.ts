import type {
  ApiErrorRecord,
  CountryRunResult,
  RunSnapshot,
  RunStatus,
  StepStatus,
  TestStep,
  WebFlowRole,
  WebLoadLiveMetrics,
  VaptLiveMetrics,
} from '@/lib/types';
import { buildReportFlowChart } from '@/lib/flow-chart';
import { pushReport, snapshotToReport } from '@/server/run-history';

type Listener = (snapshot: RunSnapshot) => void;

export interface LiveSession {
  runId: string;
  testId: string;
  testName: string;
  testDescription?: string;
  role?: WebFlowRole;
  expectation?: 'positive' | 'negative';
  pairId?: string;
  baseUrl: string;
  apiUrl?: string;
  status: RunStatus;
  steps: TestStep[];
  countryResults: CountryRunResult[];
  apiErrors: ApiErrorRecord[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  latestFrame?: Buffer;
  loadMetrics?: WebLoadLiveMetrics;
  vaptFindings?: VaptLiveMetrics;
  abortController: AbortController;
  listeners: Set<Listener>;
}

declare global {
  // eslint-disable-next-line no-var
  var __lgdSessions: Map<string, LiveSession> | undefined;
}

function sessions(): Map<string, LiveSession> {
  if (!globalThis.__lgdSessions) {
    globalThis.__lgdSessions = new Map();
  }
  return globalThis.__lgdSessions;
}

function counts(steps: TestStep[]) {
  const completed = steps.filter(
    (s) => s.status === 'passed' || s.status === 'failed' || s.status === 'skipped',
  ).length;
  const inProgress = steps.filter((s) => s.status === 'running').length;
  const remaining = steps.filter((s) => s.status === 'pending').length;
  return { completed, inProgress, remaining, total: steps.length };
}

export function toSnapshot(session: LiveSession): RunSnapshot {
  const c = counts(session.steps);
  return {
    runId: session.runId,
    testId: session.testId,
    testName: session.testName,
    testDescription: session.testDescription,
    role: session.role,
    expectation: session.expectation,
    pairId: session.pairId,
    baseUrl: session.baseUrl,
    apiUrl: session.apiUrl,
    status: session.status,
    steps: session.steps,
    flowChart: buildReportFlowChart(session.steps),
    completed: c.completed,
    inProgress: c.inProgress,
    remaining: c.remaining,
    total: c.total,
    error: session.error,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    countryResults: session.countryResults,
    apiErrors: session.apiErrors,
    loadMetrics: session.loadMetrics,
    vaptFindings: session.vaptFindings,
  };
}

function emit(session: LiveSession) {
  const snapshot = toSnapshot(session);
  for (const listener of session.listeners) {
    try {
      listener(snapshot);
    } catch {
      // ignore listener errors
    }
  }
}

export function createSession(input: {
  runId: string;
  testId: string;
  testName: string;
  testDescription?: string;
  role?: WebFlowRole;
  expectation?: 'positive' | 'negative';
  pairId?: string;
  baseUrl: string;
  apiUrl?: string;
  steps: TestStep[];
}): LiveSession {
  const session: LiveSession = {
    ...input,
    status: 'starting',
    countryResults: [],
    apiErrors: [],
    startedAt: new Date().toISOString(),
    abortController: new AbortController(),
    listeners: new Set(),
  };
  sessions().set(input.runId, session);
  emit(session);
  return session;
}

export function getSession(runId: string): LiveSession | undefined {
  return sessions().get(runId);
}

export function subscribe(runId: string, listener: Listener): () => void {
  const session = sessions().get(runId);
  if (!session) return () => undefined;
  session.listeners.add(listener);
  listener(toSnapshot(session));
  return () => session.listeners.delete(listener);
}

export async function setRunStatus(runId: string, status: RunStatus, error?: string) {
  const session = sessions().get(runId);
  if (!session) return;
  session.status = status;
  if (error) session.error = error;
  if (status === 'completed' || status === 'failed' || status === 'stopped') {
    session.finishedAt = new Date().toISOString();
    // Drop live JPEG ASAP — largest in-memory buffer per run
    session.latestFrame = undefined;
    // Persist report immediately (AI/PDF enrich happens in background inside pushReport)
    try {
      await pushReport(snapshotToReport(toSnapshot(session)));
    } catch (err) {
      console.error('[run-history] failed to persist report', err);
    }
    pruneFinishedSessions();
  }
  emit(session);
}

export function updateStep(
  runId: string,
  stepId: string,
  patch: Partial<
    Pick<TestStep, 'status' | 'message' | 'description' | 'detail' | 'screenshotPath' | 'apiErrors'>
  >,
) {
  const session = sessions().get(runId);
  if (!session) return;
  session.steps = session.steps.map((step) => {
    if (step.id !== stepId) return step;
    const next: TestStep = { ...step, ...patch };
    if (patch.status === 'running') {
      next.startedAt = new Date().toISOString();
      next.finishedAt = undefined;
    }
    if (
      patch.status === 'passed' ||
      patch.status === 'failed' ||
      patch.status === 'skipped'
    ) {
      next.finishedAt = new Date().toISOString();
    }
    return next;
  });
  emit(session);
}

export function updateLoadMetrics(runId: string, metrics: WebLoadLiveMetrics) {
  const session = sessions().get(runId);
  if (!session) return;
  session.loadMetrics = metrics;
  emit(session);
}

export function updateVaptFindings(runId: string, metrics: VaptLiveMetrics) {
  const session = sessions().get(runId);
  if (!session) return;
  session.vaptFindings = metrics;
  emit(session);
}

/** Mark all still-pending steps as skipped after a hard failure. */
export function skipRemainingSteps(runId: string, reason: string) {
  const session = sessions().get(runId);
  if (!session) return;
  session.steps = session.steps.map((step) => {
    if (step.status !== 'pending' && step.status !== 'running') return step;
    return {
      ...step,
      status: 'skipped' as const,
      message: 'Skipped — earlier step failed',
      detail: reason,
      finishedAt: new Date().toISOString(),
    };
  });
  emit(session);
}

/** Reset a country's steps so the flow can be re-tested after an API failure. */
export function resetCountrySteps(runId: string, isoCode: string) {
  const session = sessions().get(runId);
  if (!session) return;
  const key = isoCode.toLowerCase();
  session.steps = session.steps.map((step) => {
    if (!step.id.startsWith(`${key}-`)) return step;
    return {
      ...step,
      status: 'pending' as const,
      message: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      apiErrors: undefined,
    };
  });
  emit(session);
}

export function addCountryResult(runId: string, result: CountryRunResult) {
  const session = sessions().get(runId);
  if (!session) return;
  session.countryResults = [
    ...session.countryResults.filter((r) => r.isoCode !== result.isoCode),
    result,
  ];
  emit(session);
}

export function addApiError(runId: string, error: ApiErrorRecord) {
  const session = sessions().get(runId);
  if (!session) return;
  session.apiErrors = [...session.apiErrors, error];
  // Attach to currently running step when possible
  if (error.stepId) {
    session.steps = session.steps.map((step) => {
      if (step.id !== error.stepId) return step;
      return {
        ...step,
        apiErrors: [...(step.apiErrors || []), error],
      };
    });
  }
  emit(session);
}

export function getApiErrorsSince(
  runId: string,
  sinceIso: string,
  isoCode?: string,
): ApiErrorRecord[] {
  const session = sessions().get(runId);
  if (!session) return [];
  const since = new Date(sinceIso).getTime();
  return session.apiErrors.filter((e) => {
    const t = new Date(e.at).getTime();
    if (t < since) return false;
    if (isoCode && e.isoCode && e.isoCode !== isoCode) return false;
    return true;
  });
}

export function currentRunningStepId(runId: string): string | undefined {
  const session = sessions().get(runId);
  return session?.steps.find((s) => s.status === 'running')?.id;
}

export function setFrame(runId: string, frame: Buffer) {
  const session = sessions().get(runId);
  if (!session) return;
  // Skip while idle/finished — prevents late screencast frames after stop
  if (
    session.status === 'completed' ||
    session.status === 'failed' ||
    session.status === 'stopped'
  ) {
    return;
  }
  session.latestFrame = frame;
}

/** Keep a small window of finished runs; drop frames and old maps to free RAM. */
export function pruneFinishedSessions(keepFinished = 8) {
  const map = sessions();
  const finished: Array<{ id: string; at: number }> = [];
  for (const [id, s] of map) {
    if (s.status === 'completed' || s.status === 'failed' || s.status === 'stopped') {
      s.latestFrame = undefined;
      finished.push({ id, at: Date.parse(s.finishedAt || s.startedAt || '') || 0 });
    }
  }
  finished.sort((a, b) => b.at - a.at);
  for (const old of finished.slice(keepFinished)) {
    const s = map.get(old.id);
    if (!s) continue;
    if (s.listeners.size > 0) continue;
    map.delete(old.id);
  }
}

export function stopSession(runId: string) {
  const session = sessions().get(runId);
  if (!session) return false;
  session.abortController.abort();
  session.latestFrame = undefined;
  void setRunStatus(runId, 'stopped');
  return true;
}

export function markStep(status: StepStatus): StepStatus {
  return status;
}
