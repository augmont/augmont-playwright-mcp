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
export type LoadParamLocation = 'path' | 'query' | 'header' | 'body';

/** One JSONPath → JMeter variable (for chaining API A → API B). */
export interface LoadJsonExtract {
  varName: string;
  jsonPath: string;
  defaultValue?: string;
}

export type LoadApiMappingTarget =
  | 'path'
  | 'query'
  | 'header'
  | 'body'
  | 'form';

/** Map a prior extract variable into a field on this request. */
export interface LoadApiMapping {
  id: string;
  /** Variable name without ${}, e.g. countryId */
  sourceVar: string;
  target: LoadApiMappingTarget;
  /** path/query/header/form key, or body JSON path like value / data.id */
  targetKey: string;
}

/** Postman-style request body modes */
export type LoadBodyMode =
  | 'none'
  | 'form-data'
  | 'urlencoded'
  | 'raw'
  | 'binary'
  | 'graphql';

export type LoadRawLanguage =
  | 'text'
  | 'javascript'
  | 'json'
  | 'html'
  | 'xml';

export interface LoadFormField {
  id: string;
  key: string;
  value: string;
  /** form-data field type */
  type?: 'text' | 'file';
  enabled?: boolean;
  contentType?: string;
}

/** Parameter definition from OpenAPI (or inferred from path). */
export interface LoadParamDef {
  name: string;
  in: LoadParamLocation;
  required?: boolean;
  type?: string;
  description?: string;
  example?: string;
}

export interface WebLoadRequestStep {
  /** Sampler label in JMeter / reports */
  name?: string;
  /** Absolute URL or path relative to baseUrl / apiUrl (may include :param or {param}) */
  path: string;
  method?: WebLoadHttpMethod;
  headers?: Record<string, string>;
  body?: string;
  /** Postman body mode (default: raw when body set, else none) */
  bodyMode?: LoadBodyMode;
  /** Language when bodyMode is raw */
  rawLanguage?: LoadRawLanguage;
  /** Key/value rows for form-data / x-www-form-urlencoded */
  formFields?: LoadFormField[];
  /** GraphQL query text */
  graphqlQuery?: string;
  /** GraphQL variables JSON string */
  graphqlVariables?: string;
  /** Binary upload metadata */
  binaryFileName?: string;
  binaryBase64?: string;
  /**
   * Swagger/OpenAPI request + response definition for Postman-style Docs view.
   */
  apiDefinition?: LoadApiDefinition;
  /** Path template variable values, e.g. { addressId: "…" } */
  pathParams?: Record<string, string>;
  /** Query string values */
  queryParams?: Record<string, string>;
  /** Parameter / body field definitions used for validation UI */
  paramDefs?: LoadParamDef[];
  /** JSON body field names that must be present (dot paths optional later) */
  bodyRequired?: string[];
  /** Resolve this step against apiUrl */
  useApiBase?: boolean;
  /** Pause after this request (ms) — think time */
  thinkTimeMs?: number;
  /**
   * Extract one or more JSON fields from this response into JMeter variables.
   * Prefer `extractJsons` for multiple; `extractJson` is kept for backward compatibility.
   */
  extractJsons?: LoadJsonExtract[];
  /** @deprecated Prefer extractJsons — still honored when extractJsons is empty */
  extractJson?: LoadJsonExtract;
  /**
   * Advanced API mapping: wire earlier extract vars into this request’s
   * path / query / header / body / form fields as `${varName}`.
   */
  apiMappings?: LoadApiMapping[];
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
  /** Fail run if p50 latency exceeds this many ms (defaults from p95) */
  p50Ms?: number;
  /** Fail run if p75 latency exceeds this many ms */
  p75Ms?: number;
  /** Fail run if p90 latency exceeds this many ms */
  p90Ms?: number;
  /** Fail run if p95 latency exceeds this many ms */
  p95Ms: number;
  /** Fail run if p99 latency exceeds this many ms (checked separately from p95). Defaults to ~1.5× p95. */
  p99Ms?: number;
  /** Fail run if average response time exceeds this many ms */
  avgMs?: number;
  /** Fail run if avg TTFB (JMeter Latency) exceeds this — when samples include Latency */
  maxAvgLatencyMs?: number;
  /** Fail run if avg Connect time exceeds this — when samples include Connect */
  maxAvgConnectMs?: number;
  /** Resolve relative targetUrl against apiUrl instead of portal baseUrl */
  useApiBase?: boolean;
  /**
   * Advanced multi-request scenario: each VU iterates these steps in order.
   * When omitted, a single sampler uses method/targetUrl/body/headers.
   */
  requests?: WebLoadRequestStep[];
  /** Seed / UI profile */
  profile?: 'basic' | 'advanced';
  /** OpenAPI operation requires Authorization (Bearer / API key) */
  requiresAuth?: boolean;
  /** Swagger/OpenAPI source URL this case was imported from */
  swaggerUrl?: string;
  /** OpenAPI operationId when imported from Swagger */
  operationId?: string;
  /** OpenAPI tags for the imported operation */
  operationTags?: string[];
  /**
   * Optional API base override for this case (used when useApiBase is true).
   * Falls back to the app-level API URL when omitted.
   */
  apiBaseUrl?: string;
}

export interface WebLoadTestCase extends TestCaseMeta {
  kind: 'web-load';
  load: WebLoadConfig;
}

/** One username/password pair for authenticated API load. */
export interface LoadAuthCredential {
  id: string;
  label: string;
  username: string;
  password: string;
}

/** How to exchange credentials for a bearer (or similar) token. */
export interface LoadAuthLoginConfig {
  /** Login path or absolute URL (resolved against apiUrl when relative) */
  loginPath: string;
  method?: WebLoadHttpMethod;
  /** JSON body field for username (default email / username) */
  usernameField?: string;
  /** JSON body field for password */
  passwordField?: string;
  /** Extra JSON fields merged into the login body */
  extraBody?: Record<string, string>;
  /** JSONPath-ish path to token in response, e.g. data.token or access_token */
  tokenJsonPath?: string;
  /** Header name for the token (default Authorization) */
  tokenHeader?: string;
  /** Prefix before token value, e.g. "Bearer " */
  tokenPrefix?: string;
}

/** Safe (no secrets) auth details persisted on run snapshots / reports. */
export interface WebLoadAuthReport {
  swaggerUrl?: string;
  loginPath?: string;
  requiresAuth: boolean;
  tokenObtained: boolean;
  tokenCount: number;
  credentialLabels: string[];
  selectedOperations: Array<{
    method: string;
    path: string;
    summary?: string;
    requiresAuth?: boolean;
  }>;
  authHeaderName?: string;
  error?: string;
  /** Swagger/API load: JMeter only — no MCP browser or screenshots. */
  apiOnly?: boolean;
}

/** OpenAPI response definition shown in Postman-style Docs view */
export interface LoadApiResponseDef {
  status: string;
  description?: string;
  contentType?: string;
  /** Example response body (pretty JSON / text) */
  example?: string;
  /** Compact schema preview */
  schemaPreview?: string;
}

/** Request + response API definition attached to a scenario (from Swagger) */
export interface LoadApiDefinition {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  requestBodyDescription?: string;
  requestContentType?: string;
  requestExample?: string;
  requestSchemaPreview?: string;
  responses?: LoadApiResponseDef[];
}

/** Parsed OpenAPI / Swagger operation for the API picker. */
export interface SwaggerOperation {
  id: string;
  method: WebLoadHttpMethod;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  requiresAuth: boolean;
  /** Suggested JSON request body from the schema (if any) */
  sampleBody?: string;
  consumesJson?: boolean;
  /** OpenAPI parameters (path / query / header) */
  parameters?: LoadParamDef[];
  /** Required JSON body top-level keys (when schema known) */
  bodyRequired?: string[];
  /** Full request/response definition for Docs view */
  apiDefinition?: LoadApiDefinition;
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
  /** Recent failed samples with request/response error detail */
  recentErrors?: Array<{
    at?: string;
    label: string;
    method?: string;
    url?: string;
    status?: string;
    message: string;
    success: boolean;
  }>;
}

/** Overall JMeter result badge after a completed load run */
export type LoadGrade = 'best' | 'good' | 'fair' | 'poor';

export interface LoadMetricCompareRow {
  key: string;
  label: string;
  /** Required / target threshold text */
  required: string;
  /** Observed value from this run */
  actual: string;
  passed: boolean;
  importance: 'critical' | 'high' | 'medium' | 'info';
}

/** Grade + required-vs-actual metrics for load reports */
export interface LoadGradeSummary {
  grade: LoadGrade;
  label: string;
  /** 0–100 composite score */
  score: number;
  /** Short written summary with the badge meaning */
  summary: string;
  /** Why the grade matters (release / risk) */
  importance: string;
  metrics: LoadMetricCompareRow[];
  thresholds: {
    maxErrorRatePct: number;
    p50Ms: number;
    p75Ms: number;
    p90Ms: number;
    p95Ms: number;
    p99Ms: number;
    avgMs: number;
    avgLatencyMs: number;
    avgConnectMs: number;
    virtualUsers: number;
    durationSec: number;
  };
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
  /** Auth / Swagger context for load runs (no secrets) */
  loadAuth?: WebLoadAuthReport;
  /** Performance badge + required vs actual metrics */
  loadGradeSummary?: LoadGradeSummary;
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
  /** Auth / Swagger context for load runs (no secrets) */
  loadAuth?: WebLoadAuthReport;
  /** Performance badge + required vs actual metrics */
  loadGradeSummary?: LoadGradeSummary;
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
