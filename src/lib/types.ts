export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type RunStatus = 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'stopped';

export type TestCaseKind =
  | 'signup-all'
  | 'signup-country'
  | 'mobile-launch'
  | 'mobile-onboarding'
  | 'mobile-signup'
  | 'web-flow'
  | 'web-load'
  | 'vapt';

export type WebLoadHttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD';

/** HTTP load-test configuration (concurrent virtual users). */
export interface WebLoadRequestStep {
  /** Sampler label in JMeter / reports */
  name?: string;
  /** Absolute URL or path relative to baseUrl / apiUrl */
  path: string;
  method?: WebLoadHttpMethod;
  headers?: Record<string, string>;
  body?: string;
  /** Resolve this step against apiUrl */
  useApiBase?: boolean;
  /** Pause after this request (ms) — think time */
  thinkTimeMs?: number;
  /** Extract JSON from response into a JMeter variable for later steps */
  extractJson?: {
    varName: string;
    jsonPath: string;
    defaultValue?: string;
  };
}

export interface WebLoadConfig {
  /** Absolute URL or path relative to baseUrl / apiUrl (primary / MCP target) */
  targetUrl: string;
  method: WebLoadHttpMethod;
  headers?: Record<string, string>;
  body?: string;
  virtualUsers: number;
  durationSec: number;
  rampUpSec: number;
  /** Fail run if HTTP error rate exceeds this % */
  maxErrorRatePct: number;
  /** Fail run if p95 latency exceeds this many ms */
  p95Ms: number;
  /** Resolve relative targetUrl against apiUrl instead of portal baseUrl */
  useApiBase?: boolean;
  /**
   * Advanced multi-request scenario: each VU iterates these steps in order.
   * When omitted, a single sampler uses method/targetUrl/body/headers.
   */
  requests?: WebLoadRequestStep[];
  /** Seed / UI profile */
  profile?: 'basic' | 'advanced';
}

export interface WebLoadTestCase extends TestCaseMeta {
  kind: 'web-load';
  load: WebLoadConfig;
}

/** VAPT check identifiers — defensive / hygiene probes (no active exploit payloads). */
export type VaptCheckId =
  | 'security-headers'
  | 'cookie-flags'
  | 'info-disclosure'
  | 'tls-url'
  | 'unauth-sensitive'
  | 'api-location'
  | 'cors-preflight'
  | 'cache-control'
  | 'api-auth-bypass'
  | 'api-method-tamper'
  | 'api-error-hygiene'
  | 'injection-surface'
  /** User attack catalogue (safe posture probes) */
  | 'brute-force'
  | 'ddos-rate-limit'
  | 'sql-injection-surface'
  | 'xss-reflection'
  | 'csrf-surface'
  | 'rce-surface'
  | 'command-injection-surface'
  | 'directory-traversal'
  | 'file-upload-surface'
  | 'privilege-escalation'
  | 'session-hijacking'
  | 'mitm-tls'
  | 'ssrf-surface'
  | 'xxe-surface'
  | 'deserialization-surface'
  | 'api-abuse'
  | 'malware-upload-surface'
  | 'phishing-credential-surface'
  | 'zero-day-posture';

export type VaptSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type VaptCheckCategory =
  | 'security-headers'
  | 'auth'
  | 'session'
  | 'access-control'
  | 'injection-surface'
  | 'api'
  | 'tls-transport'
  | 'info-disclosure'
  | 'misconfig'
  | 'rate-limit'
  | 'xss'
  | 'csrf'
  | 'ssrf'
  | 'xxe'
  | 'upload'
  | 'traversal';

export type VaptFindingStatus = 'pass' | 'fail' | 'info' | 'error';

export interface VaptConfig {
  /** Absolute URL or path relative to baseUrl / apiUrl (probe target) */
  targetUrl: string;
  method?: WebLoadHttpMethod;
  headers?: Record<string, string>;
  body?: string;
  /** Resolve relative targetUrl against apiUrl */
  useApiBase?: boolean;
  /**
   * Portal path opened in MCP at run start (evidence browser).
   * Defaults to `/login` — VAPT sessions begin on the login page.
   */
  startUrl?: string;
  /** Which probes to run */
  checks: VaptCheckId[];
  /** Fail the run if a finding at this severity or higher is fail (default high) */
  severityGate?: VaptSeverity;
}

export interface VaptTestCase extends TestCaseMeta {
  kind: 'vapt';
  vapt: VaptConfig;
}

/** Network-tab style capture (API URL + payload) for VAPT */
export interface VaptNetworkCapture {
  id: string;
  at: string;
  method: string;
  url: string;
  status?: number;
  requestPayload?: string;
  responseSnippet?: string;
  stepId?: string;
  checkId?: string;
  source: 'probe' | 'browser';
}

export interface VaptFinding {
  id: string;
  title: string;
  severity: VaptSeverity;
  category: VaptCheckCategory;
  status: VaptFindingStatus;
  evidence?: string;
  recommendation?: string;
  owasp?: string;
  cwe?: string;
  stepId?: string;
  /** Attack / check id that produced this finding */
  checkId?: string;
  requestMethod?: string;
  requestUrl?: string;
  requestPayload?: string;
  responseStatus?: number;
  responseSnippet?: string;
  screenshotPath?: string;
}

export interface VaptLiveMetrics {
  checked: number;
  passed: number;
  failed: number;
  info: number;
  errors: number;
  bySeverity: Partial<Record<VaptSeverity, number>>;
  findings: VaptFinding[];
  networkCaptures?: VaptNetworkCapture[];
  targetUrl?: string;
  engine?: 'http-probe' | 'api-vapt';
}

/** Live / final HTTP load metrics shown on the run page. */
export interface WebLoadLiveMetrics {
  elapsedSec: number;
  virtualUsers: number;
  activeUsers: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  rps: number;
  errorRatePct: number;
  /** Success rate % (100 - errorRate when samples exist) */
  successRatePct?: number;
  p50Ms: number;
  p75Ms?: number;
  p90Ms?: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  minMs?: number;
  maxMs?: number;
  /** Latency std deviation (ms) */
  stddevMs?: number;
  statusCounts: Record<string, number>;
  /** Load engine currently driving the run */
  engine?: 'jmeter' | 'node-fetch';
  /** Absolute or relative path to JTL results (JMeter) */
  jtlPath?: string;
  /** Generated .jmx path */
  jmxPath?: string;
  /** HTML report folder if generated */
  reportDir?: string;
  /** Recent JMeter / runner log lines for the detail panel */
  logLines?: string[];
  /** Bytes received / sec when known */
  bytesPerSec?: number;
  /** Total response bytes */
  totalBytes?: number;
  /** Throughput in KB/s */
  kbPerSec?: number;
  /** Avg Latency (TTFB) ms when JMeter provides Latency column */
  avgLatencyMs?: number;
  /** Avg Connect time ms */
  avgConnectMs?: number;
  /** Request bytes sent / sec */
  sentBytesPerSec?: number;
  /** Total request bytes sent */
  sentBytesTotal?: number;
  /** Peak allThreads seen in JTL */
  jmeterThreads?: number;
  /** Latest (most recent sample) allThreads — live concurrency */
  latestThreads?: number;
  /** Rolling-window RPS (~15s) for smoother live charting */
  rpsLive?: number;
  /** Rolling-window average response time (ms) */
  windowAvgMs?: number;
  /** Window size used for rpsLive / windowAvgMs (sec) */
  windowSec?: number;
}

export type WebFlowRole = 'public' | 'buyer' | 'seller' | 'admin';

export type WebFlowAction =
  | 'goto'
  | 'click'
  | 'fill'
  | 'assertVisible'
  | 'assertUrl'
  | 'wait'
  | 'loginRole'
  | 'ensureBuyer';

/** Declarative Playwright step for web-flow suites (Claude / upload / seed). */
export interface WebFlowStep {
  id: string;
  label: string;
  action: WebFlowAction;
  /** Relative path or absolute URL for goto; regex string for assertUrl */
  url?: string;
  /** CSS selector, or Playwright text=/.../i style hint */
  selector?: string;
  /** fill value, wait ms as number-string, or role for loginRole */
  value?: string;
  /** Visible text for click / assertVisible */
  text?: string;
  timeoutMs?: number;
}

export interface WebTestCase extends TestCaseMeta {
  kind: 'web-flow';
  role?: WebFlowRole;
  /**
   * Default / positive path steps.
   * For suiteMode "combined", this mirrors positiveSteps (happy path).
   */
  steps: WebFlowStep[];
  source?: 'seed' | 'claude' | 'upload';
  /** Happy-path steps (combined suites). Defaults to steps. */
  positiveSteps?: WebFlowStep[];
  /** Error-path steps (combined suites). */
  negativeSteps?: WebFlowStep[];
  /**
   * Editable branched flow chart (shared trunk + Positive/Negative fork).
   * Stored as JSON-compatible FlowChartNode[].
   */
  flowChart?: unknown[];
}

export interface ApiErrorRecord {
  id: string;
  at: string;
  method?: string;
  url: string;
  status?: number;
  statusText?: string;
  message: string;
  bodySnippet?: string;
  isoCode?: string;
  stepId?: string;
  retried?: boolean;
}

export interface TestStep {
  id: string;
  label: string;
  status: StepStatus;
  /** Short outcome message (pass/fail detail) */
  message?: string;
  /** What this step is meant to validate (for developers & testers) */
  description?: string;
  /** Extra guidance: expected behaviour, remediation tips on failure */
  detail?: string;
  /** Web-flow action when known (goto/click/fill/…) — used in report flow chart */
  action?: string;
  /** Relative path under data/, e.g. reports/{runId}/{stepId}.png */
  screenshotPath?: string;
  startedAt?: string;
  finishedAt?: string;
  apiErrors?: ApiErrorRecord[];
}

export interface LocationCountry {
  id: string;
  name: string;
  countryCode: string;
  isoCode: string;
}

export interface TestCaseMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  estimatedMinutes: number;
  kind: TestCaseKind;
  isoCode?: string;
  /** Web flow bucket: public | buyer | seller | admin */
  role?: WebFlowRole;
  /** Where the case came from (web-flow store) */
  source?: 'seed' | 'claude' | 'upload';
  /** Suite / import file grouping (keeps related cases together) */
  group?: string;
  /** Happy path vs failure/invalid path (run branch; combined suites use both) */
  expectation?: 'positive' | 'negative';
  /** Links legacy pair rows or identifies a combined suite id base */
  pairId?: string;
  /** combined = one suite with Positive + Negative fork (preferred) */
  suiteMode?: 'combined' | 'single';
}

export interface CountryRunResult {
  isoCode: string;
  countryName: string;
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  retried?: boolean;
  apiErrors?: ApiErrorRecord[];
  stepsSummary: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
}

export interface RunSnapshot {
  runId: string;
  testId: string;
  testName?: string;
  /** Test case description for report guidance */
  testDescription?: string;
  role?: WebFlowRole;
  /** Happy path vs failure/invalid path */
  expectation?: 'positive' | 'negative';
  pairId?: string;
  baseUrl: string;
  apiUrl?: string;
  status: RunStatus;
  steps: TestStep[];
  /** Pass/fail flow chart for live view + reports */
  flowChart?: ReportFlowNode[];
  completed: number;
  inProgress: number;
  remaining: number;
  total: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  countryResults?: CountryRunResult[];
  apiErrors?: ApiErrorRecord[];
  /** Present when kind is web-load */
  loadMetrics?: WebLoadLiveMetrics;
  /** Present when kind is vapt */
  vaptFindings?: VaptLiveMetrics;
}

/** Execution flow chart node (report + PDF) */
export interface ReportFlowNode {
  id: string;
  label: string;
  status: StepStatus;
  action?: string;
  message?: string;
  locked?: boolean;
}

export interface ReportCodeSnippet {
  title: string;
  language: string;
  code: string;
  why?: string;
}

/** Elaborate AI / local study summary for developers & testers */
export interface ReportAiSummary {
  headline: string;
  narrative: string;
  /** Clear explanation of why the run failed (omit / empty on success) */
  whyFailed?: string;
  rootCause?: string;
  developerActions?: string[];
  /** How to prevent the attack / harden the product (especially VAPT) */
  preventionActions?: string[];
  testerActions?: string[];
  studyNotes?: string;
  /** Playwright / debug snippets for developer handoff */
  codeSnippets?: ReportCodeSnippet[];
  /** Model id used, or "local-template" */
  model?: string;
}

export interface RunReport {
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
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** High-level study notes for developers and testers */
  guidance?: string;
  /** Elaborate pass/fail summary + code snippets (OpenRouter or local) */
  aiSummary?: ReportAiSummary;
  countryResults: CountryRunResult[];
  apiErrors: ApiErrorRecord[];
  /** Full step log for modal + PDF */
  steps: TestStep[];
  /** Flow chart with step pass/fail — attached to every report + PDF */
  flowChart?: ReportFlowNode[];
  stepCounts: {
    completed: number;
    inProgress: number;
    remaining: number;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  error?: string;
  /** Relative path under data/, e.g. reports/{runId}.pdf */
  pdfPath?: string;
  /** Present for web-load / JMeter runs */
  loadMetrics?: WebLoadLiveMetrics;
  /** Present for VAPT security probe runs */
  vaptFindings?: VaptLiveMetrics;
}

export interface CountrySignupFixture {
  isoCode: string;
  countryName: string;
  dialCode: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  mobileNumber: string;
  /** Fixed OTP used in test/dev/uat backends */
  otp: string;
  companyName: string;
  tradingName: string;
  registrationNumber: string;
  addressLine1: string;
  addressLine2: string;
  pincode: string;
}
