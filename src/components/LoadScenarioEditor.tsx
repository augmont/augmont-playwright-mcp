'use client';

import { useMemo, useState } from 'react';
import type {
  LoadApiDefinition,
  LoadAuthCredential,
  LoadAuthLoginConfig,
  LoadBodyMode,
  LoadFormField,
  LoadParamDef,
  LoadRawLanguage,
  WebLoadHttpMethod,
  WebLoadRequestStep,
} from '@/lib/types';
import {
  headersToLines,
  linesToHeaders,
  parseCurlToLoadStep,
} from '@/lib/parse-curl';
import {
  loadAuthCredentialsForRun,
  readLoadAuthLoginConfig,
  readPresetAuthHeaders,
} from '@/lib/load-auth-credentials';
import { ensureLgdApiV1Base } from '@/lib/api-url';
import {
  applyParamsToPath,
  ensureParamDefs,
  extractPathParamNames,
  validateLoadRequest,
  type RequestValidationIssue,
} from '@/lib/load-request-params';
import {
  BODY_MODES,
  RAW_LANGUAGES,
  contentTypeForRaw,
  formFieldsFromUrlEncoded,
  inferBodyMode,
  newFormField,
  withContentType,
} from '@/lib/load-request-body';
import {
  REQUEST_EXPORT_FORMATS,
  downloadExportFile,
  exportRequestCode,
  type RequestExportFormat,
} from '@/lib/export-request-code';
import { LoadDynamicVarsBar } from '@/components/LoadDynamicVarsBar';
import { LoadChainPanel } from '@/components/LoadChainPanel';
import { getJsonPathValue } from '@/lib/json-path';
import {
  applyApiMappingsToStep,
  listJsonExtracts,
} from '@/lib/load-chain';

const METHODS: WebLoadHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
];

export type ScenarioEditorAuth = {
  /** When true, Send must attach a token or show a clear error. */
  requiresAuth?: boolean;
  mode?: 'login' | 'token';
  /** Paste-token mode — raw or "Bearer …" */
  directToken?: string;
  credentials?: LoadAuthCredential[];
  login?: Partial<LoadAuthLoginConfig>;
  /** Persist form auth to sessionStorage before obtain/probe (called by parent). */
  persistAuth?: () => void;
};

type Props = {
  requests: WebLoadRequestStep[];
  apiBaseUrl?: string;
  onChange: (next: WebLoadRequestStep[]) => void;
  /** Live form auth from the edit modal (used even before Save). */
  auth?: ScenarioEditorAuth;
  /** Full load test (saves case + runs JMeter with VUs/duration). */
  onLoadTest?: () => void;
  loadTestBusy?: boolean;
};

function ApiDefinitionView({
  definition,
  method,
  path,
  paramDefs,
}: {
  definition: LoadApiDefinition;
  method: string;
  path: string;
  paramDefs: LoadParamDef[];
}) {
  const [docsPane, setDocsPane] = useState<'request' | 'response'>('request');
  const [activeStatus, setActiveStatus] = useState(
    definition.responses?.[0]?.status || '',
  );
  const responses = definition.responses || [];
  const activeResp =
    responses.find((r) => r.status === activeStatus) || responses[0];

  return (
    <div className="api-docs-view">
      <div className="api-docs-hero">
        <span className={`swagger-method method-${method.toLowerCase()}`}>
          {method}
        </span>
        <code className="probe-url-full">{path}</code>
      </div>
      {definition.summary ? (
        <h3 className="api-docs-title">{definition.summary}</h3>
      ) : null}
      {definition.description ? (
        <p className="history-meta api-docs-desc">{definition.description}</p>
      ) : null}
      <div className="api-docs-meta">
        {definition.operationId ? (
          <span>
            operationId <code>{definition.operationId}</code>
          </span>
        ) : null}
        {definition.tags?.length ? (
          <span>tags: {definition.tags.join(', ')}</span>
        ) : null}
      </div>

      <div className="probe-pane-tabs" role="tablist">
        <button
          type="button"
          className={`creds-role-tab ${docsPane === 'request' ? 'active' : ''}`}
          onClick={() => setDocsPane('request')}
        >
          Request definition
        </button>
        <button
          type="button"
          className={`creds-role-tab ${docsPane === 'response' ? 'active' : ''}`}
          onClick={() => setDocsPane('response')}
        >
          Response definition
          {responses.length ? ` (${responses.length})` : ''}
        </button>
      </div>

      {docsPane === 'request' ? (
        <div className="probe-detail">
          {paramDefs.length ? (
            <div className="probe-section">
              <div className="probe-section-head">
                <h4>Parameters</h4>
              </div>
              <div className="probe-kv-table-wrap">
                <table className="probe-kv-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>In</th>
                      <th>Required</th>
                      <th>Type</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paramDefs.map((p) => (
                      <tr key={`${p.in}-${p.name}`}>
                        <td>
                          <code>{p.name}</code>
                        </td>
                        <td>{p.in}</td>
                        <td>{p.required ? 'yes' : 'no'}</td>
                        <td>{p.type || '—'}</td>
                        <td>{p.description || p.example || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="probe-section">
            <div className="probe-section-head">
              <h4>Request body</h4>
              {definition.requestContentType ? (
                <code>{definition.requestContentType}</code>
              ) : null}
            </div>
            {definition.requestBodyDescription ? (
              <p className="history-meta">{definition.requestBodyDescription}</p>
            ) : null}
            {!definition.requestExample && !definition.requestSchemaPreview ? (
              <p className="history-meta">No request body schema / example.</p>
            ) : null}
            {definition.requestExample ? (
              <>
                <h4 className="api-docs-subh">Example</h4>
                <pre className="scenario-result-pre probe-body-pre">
                  {definition.requestExample}
                </pre>
              </>
            ) : null}
            {definition.requestSchemaPreview ? (
              <>
                <h4 className="api-docs-subh">Schema</h4>
                <pre className="scenario-result-pre probe-body-pre">
                  {definition.requestSchemaPreview}
                </pre>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {docsPane === 'response' ? (
        <div className="probe-detail">
          {!responses.length ? (
            <p className="history-meta">No response definitions in Swagger.</p>
          ) : (
            <>
              <div className="api-docs-status-tabs">
                {responses.map((r) => (
                  <button
                    key={r.status}
                    type="button"
                    className={`creds-role-tab ${
                      (activeResp?.status || '') === r.status ? 'active' : ''
                    }`}
                    onClick={() => setActiveStatus(r.status)}
                  >
                    {r.status}
                  </button>
                ))}
              </div>
              {activeResp ? (
                <>
                  <div className="probe-line">
                    <span
                      className={`probe-status-pill probe-status-${
                        String(activeResp.status).startsWith('2')
                          ? 'ok'
                          : String(activeResp.status).startsWith('3')
                            ? 'warn'
                            : 'err'
                      }`}
                    >
                      {activeResp.status}
                    </span>
                    {activeResp.contentType ? (
                      <code>{activeResp.contentType}</code>
                    ) : null}
                  </div>
                  {activeResp.description ? (
                    <p className="history-meta">{activeResp.description}</p>
                  ) : null}
                  {activeResp.example ? (
                    <>
                      <h4 className="api-docs-subh">Example</h4>
                      <pre className="scenario-result-pre probe-body-pre">
                        {activeResp.example}
                      </pre>
                    </>
                  ) : null}
                  {activeResp.schemaPreview ? (
                    <>
                      <h4 className="api-docs-subh">Schema</h4>
                      <pre className="scenario-result-pre probe-body-pre">
                        {activeResp.schemaPreview}
                      </pre>
                    </>
                  ) : null}
                  {!activeResp.example && !activeResp.schemaPreview ? (
                    <p className="history-meta">
                      No example or schema for this status.
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function toBearer(token: string): string {
  const t = token.trim();
  if (!t) return '';
  return /^bearer\s/i.test(t) ? t : `Bearer ${t}`;
}

type EditorTab =
  | 'params'
  | 'headers'
  | 'body'
  | 'docs'
  | 'chain'
  | 'timing'
  | 'curl'
  | 'export'
  | 'result';

function formatExtractValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

type ProbeResult = {
  ok: boolean;
  elapsedMs: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    size: number;
  } | null;
  error?: string;
};

type ResultPane = 'overview' | 'request' | 'response';
type BodyView = 'pretty' | 'raw';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
  return `${Math.round((n / (1024 * 1024)) * 100) / 100} MB`;
}

function prettyBody(raw?: string | null): { text: string; isJson: boolean } {
  if (raw == null || raw === '') return { text: '(empty)', isJson: false };
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true };
    } catch {
      /* fall through */
    }
  }
  return { text: raw, isJson: false };
}

function statusTone(status?: number, ok?: boolean): 'ok' | 'err' | 'warn' {
  if (status == null) return ok ? 'ok' : 'err';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'warn';
  return 'err';
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

function HeaderTable({
  headers,
}: {
  headers: Record<string, string>;
}) {
  const entries = Object.entries(headers || {});
  if (!entries.length) {
    return <p className="history-meta">No headers</p>;
  }
  return (
    <div className="probe-kv-table-wrap">
      <table className="probe-kv-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td>
                <code>{k}</code>
              </td>
              <td>
                <code>{v}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProbeResultView({ probe }: { probe: ProbeResult }) {
  const [pane, setPane] = useState<ResultPane>('overview');
  const [reqBodyView, setReqBodyView] = useState<BodyView>('pretty');
  const [resBodyView, setResBodyView] = useState<BodyView>('pretty');
  const [copied, setCopied] = useState('');

  const tone = statusTone(probe.response?.status, probe.ok);
  const reqPretty = useMemo(
    () => prettyBody(probe.request.body),
    [probe.request.body],
  );
  const resPretty = useMemo(
    () => prettyBody(probe.response?.body),
    [probe.response?.body],
  );

  async function onCopy(label: string, text: string) {
    await copyText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1600);
  }

  const curlExport = useMemo(() => {
    const { method, url, headers, body } = probe.request;
    const parts = [`curl '${url}'`];
    if (method && method.toUpperCase() !== 'GET') {
      parts.push(`  -X ${method.toUpperCase()}`);
    }
    for (const [k, v] of Object.entries(headers || {})) {
      parts.push(`  -H '${k}: ${v}'`);
    }
    if (body) {
      const escaped = body.replace(/'/g, `'\\''`);
      parts.push(`  --data-raw '${escaped}'`);
    }
    return parts.join(' \\\n');
  }, [probe.request]);

  return (
    <div className="probe-result">
      <div className={`probe-status-bar probe-status-${tone}`}>
        <span className={`probe-status-pill probe-status-${tone}`}>
          {probe.response
            ? `${probe.response.status} ${probe.response.statusText || ''}`.trim()
            : probe.ok
              ? 'OK'
              : 'Failed'}
        </span>
        <span className="probe-stat">
          <em>Time</em> {probe.elapsedMs} ms
        </span>
        {probe.response ? (
          <span className="probe-stat">
            <em>Size</em> {formatBytes(probe.response.size)}
          </span>
        ) : null}
        <span className="probe-stat probe-stat-method">
          <em>{probe.request.method}</em>
        </span>
        <code className="probe-url" title={probe.request.url}>
          {probe.request.url}
        </code>
      </div>

      {probe.error ? (
        <div className="probe-error-box">
          <strong>Error</strong>
          <pre>{probe.error}</pre>
        </div>
      ) : null}

      <div className="probe-pane-tabs" role="tablist">
        {(
          [
            ['overview', 'Overview'],
            ['request', 'Request'],
            ['response', 'Response'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`creds-role-tab ${pane === id ? 'active' : ''}`}
            onClick={() => setPane(id)}
          >
            {label}
          </button>
        ))}
        <div className="probe-pane-actions">
          {copied ? <span className="probe-copied">{copied} copied</span> : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onCopy('cURL', curlExport)}
          >
            Copy cURL
          </button>
        </div>
      </div>

      {pane === 'overview' ? (
        <div className="probe-overview">
          <div className="probe-overview-grid">
            <div className="probe-card">
              <div className="probe-card-head">
                <h4>Request</h4>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setPane('request')}
                >
                  Open
                </button>
              </div>
              <div className="probe-line">
                <span
                  className={`swagger-method method-${probe.request.method.toLowerCase()}`}
                >
                  {probe.request.method}
                </span>
                <code>{probe.request.url}</code>
              </div>
              <p className="history-meta">
                {Object.keys(probe.request.headers || {}).length} headers
                {probe.request.body ? ' · body present' : ' · no body'}
              </p>
            </div>
            <div className="probe-card">
              <div className="probe-card-head">
                <h4>Response</h4>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setPane('response')}
                >
                  Open
                </button>
              </div>
              {probe.response ? (
                <>
                  <div className="probe-line">
                    <span className={`probe-status-pill probe-status-${tone}`}>
                      {probe.response.status} {probe.response.statusText}
                    </span>
                    <span className="history-meta">
                      {formatBytes(probe.response.size)} · {probe.elapsedMs} ms
                    </span>
                  </div>
                  <p className="history-meta">
                    {Object.keys(probe.response.headers || {}).length} headers ·{' '}
                    {resPretty.isJson ? 'JSON body' : 'body'}
                  </p>
                </>
              ) : (
                <p className="history-meta">No response received.</p>
              )}
            </div>
          </div>
          {probe.response ? (
            <div className="probe-section">
              <div className="probe-section-head">
                <h4>Response body (preview)</h4>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    void onCopy(
                      'Body',
                      resBodyView === 'pretty'
                        ? resPretty.text
                        : probe.response?.body || '',
                    )
                  }
                >
                  Copy
                </button>
              </div>
              <pre className="scenario-result-pre probe-body-pre">
                {resPretty.text.length > 4000
                  ? `${resPretty.text.slice(0, 4000)}\n…(truncated)`
                  : resPretty.text}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {pane === 'request' ? (
        <div className="probe-detail">
          <div className="probe-section">
            <div className="probe-section-head">
              <h4>URL</h4>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void onCopy('URL', probe.request.url)}
              >
                Copy URL
              </button>
            </div>
            <div className="probe-line">
              <span
                className={`swagger-method method-${probe.request.method.toLowerCase()}`}
              >
                {probe.request.method}
              </span>
              <code className="probe-url-full">{probe.request.url}</code>
            </div>
          </div>

          <div className="probe-section">
            <div className="probe-section-head">
              <h4>Headers</h4>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void onCopy(
                    'Headers',
                    Object.entries(probe.request.headers || {})
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('\n'),
                  )
                }
              >
                Copy
              </button>
            </div>
            <HeaderTable headers={probe.request.headers || {}} />
          </div>

          <div className="probe-section">
            <div className="probe-section-head">
              <h4>Body</h4>
              <div className="probe-inline-tabs">
                <button
                  type="button"
                  className={`creds-role-tab ${reqBodyView === 'pretty' ? 'active' : ''}`}
                  onClick={() => setReqBodyView('pretty')}
                >
                  Pretty
                </button>
                <button
                  type="button"
                  className={`creds-role-tab ${reqBodyView === 'raw' ? 'active' : ''}`}
                  onClick={() => setReqBodyView('raw')}
                >
                  Raw
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    void onCopy(
                      'Body',
                      reqBodyView === 'pretty'
                        ? reqPretty.text
                        : probe.request.body || '',
                    )
                  }
                >
                  Copy
                </button>
              </div>
            </div>
            <pre className="scenario-result-pre probe-body-pre">
              {probe.request.body
                ? reqBodyView === 'pretty'
                  ? reqPretty.text
                  : probe.request.body
                : '(no request body)'}
            </pre>
          </div>
        </div>
      ) : null}

      {pane === 'response' ? (
        <div className="probe-detail">
          {!probe.response ? (
            <p className="history-meta">No response received.</p>
          ) : (
            <>
              <div className="probe-section">
                <div className="probe-section-head">
                  <h4>Status</h4>
                </div>
                <div className="probe-line">
                  <span className={`probe-status-pill probe-status-${tone}`}>
                    {probe.response.status} {probe.response.statusText}
                  </span>
                  <span className="probe-stat">
                    <em>Time</em> {probe.elapsedMs} ms
                  </span>
                  <span className="probe-stat">
                    <em>Size</em> {formatBytes(probe.response.size)}
                  </span>
                </div>
              </div>

              <div className="probe-section">
                <div className="probe-section-head">
                  <h4>Headers</h4>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      void onCopy(
                        'Headers',
                        Object.entries(probe.response?.headers || {})
                          .map(([k, v]) => `${k}: ${v}`)
                          .join('\n'),
                      )
                    }
                  >
                    Copy
                  </button>
                </div>
                <HeaderTable headers={probe.response.headers || {}} />
              </div>

              <div className="probe-section">
                <div className="probe-section-head">
                  <h4>Body</h4>
                  <div className="probe-inline-tabs">
                    <button
                      type="button"
                      className={`creds-role-tab ${resBodyView === 'pretty' ? 'active' : ''}`}
                      onClick={() => setResBodyView('pretty')}
                    >
                      Pretty
                    </button>
                    <button
                      type="button"
                      className={`creds-role-tab ${resBodyView === 'raw' ? 'active' : ''}`}
                      onClick={() => setResBodyView('raw')}
                    >
                      Raw
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        void onCopy(
                          'Body',
                          resBodyView === 'pretty'
                            ? resPretty.text
                            : probe.response?.body || '',
                        )
                      }
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <pre className="scenario-result-pre probe-body-pre">
                  {resBodyView === 'pretty'
                    ? resPretty.text
                    : probe.response.body || '(empty body)'}
                </pre>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function LoadScenarioEditor({
  requests,
  apiBaseUrl,
  onChange,
  auth,
  onLoadTest,
  loadTestBusy,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [tab, setTab] = useState<EditorTab>('headers');
  const [curlText, setCurlText] = useState('');
  const [curlError, setCurlError] = useState('');
  const [curlMode, setCurlMode] = useState<'replace' | 'add'>('replace');
  const [curlImportedMsg, setCurlImportedMsg] = useState('');
  const [exportFormat, setExportFormat] =
    useState<RequestExportFormat>('curl');
  const [exportCopied, setExportCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [validationIssues, setValidationIssues] = useState<
    RequestValidationIssue[]
  >([]);
  const [forceSend, setForceSend] = useState(false);
  const [dynamicMsg, setDynamicMsg] = useState('');
  const [extractPreview, setExtractPreview] = useState<string | null>(null);

  const safeIdx = Math.min(activeIdx, Math.max(0, requests.length - 1));
  const active = requests[safeIdx];
  const effectiveApiBase = ensureLgdApiV1Base(apiBaseUrl || '') || apiBaseUrl;

  /** Vars from earlier scenarios — use as ${name} in this request */
  const chainVars = useMemo(() => {
    const out: Array<{ varName: string; fromStep: string }> = [];
    const seen = new Set<string>();
    for (let i = 0; i < safeIdx; i++) {
      const r = requests[i];
      for (const ex of listJsonExtracts(r)) {
        if (seen.has(ex.varName)) continue;
        seen.add(ex.varName);
        out.push({
          varName: ex.varName,
          fromStep: r?.name || `Scenario ${i + 1}`,
        });
      }
    }
    return out;
  }, [requests, safeIdx]);

  const headerLines = useMemo(
    () => headersToLines(active?.headers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.headers, safeIdx],
  );

  const bodyMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const showBody = bodyMethods.has((active?.method || 'GET').toUpperCase());

  const paramDefs = useMemo(
    () => (active ? ensureParamDefs(active) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.path, active?.paramDefs, safeIdx],
  );

  const previewPath = useMemo(
    () =>
      active
        ? applyParamsToPath({
            path: active.path,
            pathParams: active.pathParams,
            queryParams: active.queryParams,
          })
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.path, active?.pathParams, active?.queryParams, safeIdx],
  );

  const exportCode = useMemo(() => {
    if (!active) return '';
    try {
      return exportRequestCode(exportFormat, active, effectiveApiBase);
    } catch (err) {
      return err instanceof Error
        ? `// Export failed: ${err.message}`
        : '// Export failed';
    }
  }, [active, exportFormat, effectiveApiBase, previewPath, safeIdx]);

  const exportMeta = REQUEST_EXPORT_FORMATS.find((f) => f.id === exportFormat);

  function patchActive(patch: Partial<WebLoadRequestStep>) {
    onChange(requests.map((r, i) => (i === safeIdx ? { ...r, ...patch } : r)));
    setValidationIssues([]);
    setForceSend(false);
  }

  /** Insert dynamic token into body (Body tab) or copy for Params/Headers paste. */
  function insertDynamicToken(token: string) {
    if (tab === 'body' && active) {
      const mode = active.bodyMode || inferBodyMode(active);
      if (mode === 'raw' || mode === 'graphql' || !mode) {
        if (mode === 'graphql') {
          patchActive({
            graphqlVariables: `${active.graphqlVariables || ''}${
              active.graphqlVariables ? ' ' : ''
            }${token}`,
          });
        } else {
          patchActive({
            body: `${active.body || ''}${active.body ? '' : ''}${
              active.body?.endsWith('\n') || !active.body ? '' : '\n'
            }${token}`,
          });
        }
        setDynamicMsg(`Inserted ${token} into body`);
        return;
      }
    }
    void navigator.clipboard.writeText(token).then(
      () => setDynamicMsg(`Copied ${token} — paste into a param, header, or body value`),
      () => setDynamicMsg(`Use ${token} in a param / header / body field`),
    );
  }

  function setHeaderLines(lines: Array<{ key: string; value: string }>) {
    patchActive({ headers: linesToHeaders(lines) });
  }

  function addScenario() {
    const next: WebLoadRequestStep = {
      name: `Scenario ${requests.length + 1}`,
      path: '/',
      method: 'GET',
      useApiBase: true,
      headers: { Accept: 'application/json' },
      thinkTimeMs: 150,
    };
    onChange([...requests, next]);
    setActiveIdx(requests.length);
    setTab('headers');
    setProbe(null);
  }

  function removeScenario(index: number) {
    if (requests.length <= 1) return;
    const next = requests.filter((_, i) => i !== index);
    onChange(next);
    setActiveIdx(Math.max(0, Math.min(safeIdx, next.length - 1)));
    setProbe(null);
  }

  function moveScenario(from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to >= requests.length) return;
    const next = [...requests];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
    setActiveIdx(to);
  }

  function importCurl() {
    setCurlError('');
    setCurlImportedMsg('');
    try {
      const step = parseCurlToLoadStep(curlText, {
        apiBaseUrl,
        name: active?.name,
      });
      if (curlMode === 'add') {
        onChange([...requests, { ...step, thinkTimeMs: step.thinkTimeMs ?? 150 }]);
        setActiveIdx(requests.length);
      } else {
        // Full replace of scenario fields so Body/Params match the curl
        onChange(
          requests.map((r, i) =>
            i === safeIdx
              ? {
                  ...step,
                  name: step.name || r.name,
                  thinkTimeMs: r.thinkTimeMs ?? step.thinkTimeMs ?? 150,
                  apiDefinition: step.apiDefinition || r.apiDefinition,
                }
              : r,
          ),
        );
      }
      const mode = step.bodyMode || 'none';
      if (step.queryParams && Object.keys(step.queryParams).length) {
        setTab('params');
      } else if (mode !== 'none') {
        setTab('body');
      } else if (step.headers && Object.keys(step.headers).length) {
        setTab('headers');
      } else {
        setTab('params');
      }
      setCurlText('');
      setProbe(null);
      setValidationIssues([]);
      setForceSend(false);
      const bits = [
        step.method || 'GET',
        step.path,
        mode !== 'none' ? `body: ${mode}` : null,
        step.queryParams && Object.keys(step.queryParams).length
          ? `${Object.keys(step.queryParams).length} query`
          : null,
      ].filter(Boolean);
      setCurlImportedMsg(
        `${curlMode === 'add' ? 'Added' : 'Updated'} scenario · ${bits.join(' · ')}`,
      );
    } catch (err) {
      setCurlError(err instanceof Error ? err.message : 'Invalid curl');
    }
  }

  function emptyProbeError(message: string): ProbeResult {
    return {
      ok: false,
      elapsedMs: 0,
      request: {
        method: active?.method || 'GET',
        url: active?.path || '',
        headers: active?.headers || {},
        body: active?.body,
      },
      response: null,
      error: message,
    };
  }

  async function resolveAuthHeader(): Promise<{
    headerValue?: string;
    headerName: string;
    authAttempted: boolean;
    loginError?: string;
  }> {
    auth?.persistAuth?.();

    const headerName =
      auth?.login?.tokenHeader ||
      readLoadAuthLoginConfig()?.tokenHeader ||
      'Authorization';

    const liveToken =
      auth?.mode === 'token' ? toBearer(auth.directToken || '') : '';
    const storedPresets = readPresetAuthHeaders();
    let headerValue: string | undefined = liveToken || storedPresets[0];
    if (headerValue) {
      return { headerValue, headerName, authAttempted: true };
    }

    const liveCreds = (auth?.credentials || [])
      .map((c) => ({
        ...c,
        username: (c.username || '').trim(),
        password: c.password || '',
      }))
      .filter((c) => c.username && c.password);
    const storedCreds = loadAuthCredentialsForRun();
    const creds = liveCreds.length ? liveCreds : storedCreds;

    const storedLogin = readLoadAuthLoginConfig();
    const login: Partial<LoadAuthLoginConfig> = {
      loginPath: '/auth/user-login',
      method: 'POST',
      usernameField: 'mobileNumber',
      passwordField: 'password',
      tokenJsonPath: 'data.token',
      tokenHeader: 'Authorization',
      tokenPrefix: 'Bearer ',
      extraBody: { rememberMe: 'true' },
      ...storedLogin,
      ...auth?.login,
    };

    const needsAuth =
      Boolean(auth?.requiresAuth) ||
      creds.length > 0 ||
      Boolean(liveToken) ||
      storedPresets.length > 0;

    if (!creds.length) {
      if (needsAuth || auth?.requiresAuth) {
        return {
          headerName,
          authAttempted: true,
          loginError:
            'No username/password (or token) available. Fill User details above, enable Authorization required, then Send again.',
        };
      }
      return { headerName, authAttempted: false };
    }

    if (!login.loginPath?.trim()) {
      return {
        headerName,
        authAttempted: true,
        loginError: 'Login path is empty — set Login path (e.g. /auth/user-login).',
      };
    }
    if (!effectiveApiBase?.trim() && !/^https?:\/\//i.test(login.loginPath || '')) {
      return {
        headerName,
        authAttempted: true,
        loginError: 'Main API URL is required to obtain a login token.',
      };
    }

    const tokRes = await fetch('/api/tests/load/auth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiUrl: effectiveApiBase,
        credentials: [creds[0]],
        login,
      }),
    });
    const tokData = await tokRes.json();
    headerValue = tokData.tokens?.[0]?.headerValue
      ? String(tokData.tokens[0].headerValue)
      : undefined;
    if (headerValue) {
      return { headerValue, headerName, authAttempted: true };
    }

    const detail =
      tokData.errors?.[0]?.error ||
      tokData.error ||
      'Login succeeded but no token was returned';
    return {
      headerName,
      authAttempted: true,
      loginError: `Could not obtain token via ${login.loginPath} against ${effectiveApiBase} (field "${login.usernameField}"): ${detail}. LGD login must be {apiBase}/api/v1/auth/user-login with mobileNumber — if the URL above is missing /api/v1, fix Main API URL.`,
    };
  }

  function runValidation(hasAuthHeader?: boolean): RequestValidationIssue[] {
    if (!active) return [];
    const issues = validateLoadRequest(
      { ...active, paramDefs },
      {
        requiresAuth: auth?.requiresAuth,
        hasAuthHeader,
      },
    );
    setValidationIssues(issues);
    return issues;
  }

  async function sendRequest(opts?: { ignoreValidation?: boolean }) {
    if (!active) return;
    setSending(true);
    setProbe(null);
    setExtractPreview(null);
    try {
      const issues = runValidation(false);
      const errors = issues.filter((i) => i.level === 'error');
      if (errors.length && !opts?.ignoreValidation && !forceSend) {
        setSending(false);
        setForceSend(true);
        setTab('result');
        setProbe(
          emptyProbeError(
            `Validation failed (${errors.length}):\n` +
              errors.map((e) => `• ${e.message}`).join('\n') +
              '\n\nFill Params / Body, then Send — or click Send anyway.',
          ),
        );
        return;
      }
      setForceSend(false);
      setTab('result');

      const authResolved = await resolveAuthHeader();
      if (authResolved.loginError) {
        setProbe(emptyProbeError(authResolved.loginError));
        return;
      }
      if (auth?.requiresAuth && !authResolved.headerValue) {
        setProbe(
          emptyProbeError(
            'Authorization required is on, but no token was obtained. Enter credentials or paste a Bearer token, then Send again.',
          ),
        );
        return;
      }

      const stepForSend = applyApiMappingsToStep(active);

      const res = await fetch('/api/tests/load/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: stepForSend.path,
          method: stepForSend.method || 'GET',
          headers: stepForSend.headers,
          body: stepForSend.body,
          bodyMode: stepForSend.bodyMode || inferBodyMode(stepForSend),
          rawLanguage: stepForSend.rawLanguage,
          formFields: stepForSend.formFields,
          graphqlQuery: stepForSend.graphqlQuery,
          graphqlVariables: stepForSend.graphqlVariables,
          binaryFileName: stepForSend.binaryFileName,
          binaryBase64: stepForSend.binaryBase64,
          pathParams: stepForSend.pathParams,
          queryParams: stepForSend.queryParams,
          apiBaseUrl: effectiveApiBase,
          useApiBase: stepForSend.useApiBase !== false,
          authHeaderValue: authResolved.headerValue,
          authHeaderName: authResolved.headerName,
        }),
      });
      const data = (await res.json()) as ProbeResult & { error?: string };
      if (!res.ok && !data.request) {
        setProbe(emptyProbeError(data.error || 'Probe request failed'));
      } else if (data.response?.status === 401 && !authResolved.headerValue) {
        setProbe({
          ...data,
          ok: false,
          error:
            (data.error || 'HTTP 401') +
            ' — no Authorization header was sent. Enable Authorization required, enter user details (login uses /auth/user-login + mobileNumber), and Send again.',
        });
      } else {
        setProbe(data);
        const extracts = listJsonExtracts(active);
        if (extracts.length && data.response?.body) {
          try {
            const json = JSON.parse(data.response.body) as unknown;
            const lines = extracts.map((ex) => {
              const val = getJsonPathValue(json, ex.jsonPath);
              if (val !== undefined) {
                return `${ex.varName}=${formatExtractValue(val)}`;
              }
              return `${ex.varName}=${ex.defaultValue || 'NOT_FOUND'} (missing ${ex.jsonPath})`;
            });
            setExtractPreview(lines.join(' · '));
          } catch {
            setExtractPreview(
              'Extracts need a JSON response body — response was not JSON',
            );
          }
        }
      }
    } catch (err) {
      setProbe(
        emptyProbeError(err instanceof Error ? err.message : 'Send failed'),
      );
    } finally {
      setSending(false);
    }
  }

  if (!active) {
    return (
      <fieldset className="swagger-inline-auth">
        <legend>Internal scenarios</legend>
        <p className="history-meta">No scenarios yet.</p>
        <button type="button" className="btn btn-ghost" onClick={addScenario}>
          + Add scenario
        </button>
      </fieldset>
    );
  }

  return (
    <fieldset className="swagger-inline-auth scenario-editor">
      <legend>Internal scenarios (Postman-style)</legend>
      <p className="history-meta">
        Edit Params, headers, body, and timing. <strong>Send</strong> validates required
        path/query/body fields, logs in when Authorization is on, then shows request /
        response. Use <strong>Load test</strong> to save and run the full suite with the
        Load settings above.
      </p>

      <div className="scenario-editor-layout">
        <aside className="scenario-list-pane">
          <div className="scenario-list-head">
            <strong>Scenarios ({requests.length})</strong>
            <button type="button" className="btn btn-ghost" onClick={addScenario}>
              + Add
            </button>
          </div>
          <ul className="scenario-list">
            {requests.map((r, i) => (
              <li key={`${i}-${r.path}`}>
                <button
                  type="button"
                  className={`scenario-list-item ${i === safeIdx ? 'active' : ''}`}
                  onClick={() => {
                    setActiveIdx(i);
                    setTab('headers');
                    setProbe(null);
                    setExtractPreview(null);
                    setDynamicMsg('');
                  }}
                >
                  <span
                    className={`swagger-method method-${(r.method || 'get').toLowerCase()}`}
                  >
                    {r.method || 'GET'}
                  </span>
                  <span className="scenario-list-copy">
                    <strong>{r.name || r.path}</strong>
                    <code>{r.path}</code>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="scenario-detail-pane">
          <div className="scenario-request-line scenario-request-line-send">
            <select
              value={active.method || 'GET'}
              onChange={(e) => {
                const method = e.target.value as WebLoadHttpMethod;
                patchActive({ method });
                if (['POST', 'PUT', 'PATCH'].includes(method)) setTab('body');
              }}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="scenario-path-input"
              placeholder="/api/path or full URL"
              value={active.path}
              onChange={(e) => patchActive({ path: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-primary scenario-send-btn"
              disabled={sending || !active.path.trim()}
              onClick={() => void sendRequest()}
            >
              {sending
                ? 'Sending…'
                : forceSend
                  ? 'Send anyway'
                  : 'Send'}
            </button>
            {onLoadTest ? (
              <button
                type="button"
                className="btn btn-ghost scenario-send-btn"
                disabled={loadTestBusy || sending || !active.path.trim()}
                onClick={onLoadTest}
                title="Save changes and run a full load test (virtual users + duration)"
              >
                {loadTestBusy ? 'Starting…' : 'Load test'}
              </button>
            ) : null}
          </div>

          {previewPath && previewPath !== active.path ? (
            <p className="history-meta probe-path-preview">
              Resolved URL path: <code>{previewPath}</code>
            </p>
          ) : null}

          {validationIssues.length ? (
            <ul className="probe-validation-list">
              {validationIssues.map((issue, i) => (
                <li
                  key={`${issue.field}-${i}`}
                  className={issue.level === 'error' ? 'err' : 'warn'}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}

          <label className="scenario-name-label">
            Scenario name
            <input
              type="text"
              value={active.name || ''}
              onChange={(e) => patchActive({ name: e.target.value })}
              placeholder="Friendly name"
            />
          </label>

          <label className="swagger-check">
            <input
              type="checkbox"
              checked={active.useApiBase !== false}
              onChange={(e) => patchActive({ useApiBase: e.target.checked })}
            />
            Use main API URL as base
          </label>

          <div className="scenario-tabs" role="tablist">
            {(
              [
                ['params', 'Params'],
                ['headers', 'Headers'],
                ['body', 'Body'],
                ['chain', 'Chain'],
                ['docs', 'Docs'],
                ['timing', 'Timing'],
                ['curl', 'Import curl'],
                ['export', 'Code'],
                ['result', 'Request / Response'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={`creds-role-tab ${tab === id ? 'active' : ''}`}
                onClick={() => {
                  setTab(id);
                  setDynamicMsg('');
                }}
              >
                {label}
                {id === 'docs' && active.apiDefinition ? ' ·' : ''}
                {id === 'chain' &&
                (listJsonExtracts(active).length > 0 ||
                  (active.apiMappings?.length || 0) > 0)
                  ? ' ·'
                  : ''}
                {id === 'params' &&
                paramDefs.some((p) => p.required) &&
                validationIssues.some((v) => v.level === 'error')
                  ? ' !'
                  : ''}
                {id === 'result' && probe ? (probe.ok ? ' ✓' : ' ✕') : ''}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const issues = runValidation();
                if (!issues.length) {
                  setValidationIssues([
                    {
                      level: 'warn',
                      field: 'ok',
                      message: 'Request looks valid',
                    },
                  ]);
                }
              }}
            >
              Validate
            </button>
          </div>

          {tab === 'params' ? (
            <div className="scenario-tab-panel">
              <p className="history-meta">
                Path tokens like <code>:addressId</code> and query/header params from
                Swagger. Required fields are validated on Send. Use dynamic tokens for
                unique data per VU on load runs.
              </p>
              <LoadDynamicVarsBar
                onInsert={insertDynamicToken}
                chainVars={chainVars}
              />
              {dynamicMsg ? <p className="step-msg">{dynamicMsg}</p> : null}

              <div className="probe-section">
                <div className="probe-section-head">
                  <h4>Path parameters</h4>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const names = extractPathParamNames(active.path);
                      const next = { ...(active.pathParams || {}) };
                      for (const n of names) {
                        if (next[n] == null) next[n] = '';
                      }
                      patchActive({
                        pathParams: next,
                        paramDefs: ensureParamDefs({
                          ...active,
                          pathParams: next,
                        }),
                      });
                    }}
                  >
                    Sync from path
                  </button>
                </div>
                {paramDefs.filter((p) => p.in === 'path').length === 0 ? (
                  <p className="history-meta">No path params (path has no :id tokens).</p>
                ) : (
                  <div className="scenario-kv-list">
                    {paramDefs
                      .filter((p) => p.in === 'path')
                      .map((p) => (
                        <div key={`path-${p.name}`} className="scenario-kv-row">
                          <label className="scenario-param-label">
                            {p.name}
                            {p.required ? ' *' : ''}
                            <input
                              type="text"
                              placeholder={p.example || p.type || 'value'}
                              value={active.pathParams?.[p.name] || ''}
                              onChange={(e) =>
                                patchActive({
                                  pathParams: {
                                    ...(active.pathParams || {}),
                                    [p.name]: e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="probe-section">
                <div className="probe-section-head">
                  <h4>Query parameters</h4>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const defs = [
                        ...paramDefs,
                        {
                          name: `param${paramDefs.filter((p) => p.in === 'query').length + 1}`,
                          in: 'query' as const,
                          required: false,
                          type: 'string',
                        },
                      ];
                      patchActive({
                        paramDefs: defs,
                        queryParams: {
                          ...(active.queryParams || {}),
                          [`param${paramDefs.filter((p) => p.in === 'query').length + 1}`]:
                            '',
                        },
                      });
                    }}
                  >
                    + Add query
                  </button>
                </div>
                <div className="scenario-kv-list">
                  {(
                    paramDefs.filter((p) => p.in === 'query').length
                      ? paramDefs.filter((p) => p.in === 'query')
                      : Object.keys(active.queryParams || {}).map((name) => ({
                          name,
                          in: 'query' as const,
                          required: false,
                          type: undefined as string | undefined,
                        }))
                  ).map((p) => (
                    <div key={`query-${p.name}`} className="scenario-kv-row">
                      <input
                        type="text"
                        placeholder="Key"
                        value={p.name}
                        onChange={(e) => {
                          const oldName = p.name;
                          const newName = e.target.value;
                          const q = { ...(active.queryParams || {}) };
                          const val = q[oldName] || '';
                          delete q[oldName];
                          if (newName) q[newName] = val;
                          const defs = ensureParamDefs(active)
                            .filter((d) => !(d.in === 'query' && d.name === oldName))
                            .concat(
                              newName
                                ? [
                                    {
                                      name: newName,
                                      in: 'query' as const,
                                      required: p.required,
                                      type: p.type,
                                    },
                                  ]
                                : [],
                            );
                          patchActive({ queryParams: q, paramDefs: defs });
                        }}
                      />
                      <input
                        type="text"
                        placeholder={p.required ? 'Required value *' : 'Value'}
                        value={active.queryParams?.[p.name] || ''}
                        onChange={(e) =>
                          patchActive({
                            queryParams: {
                              ...(active.queryParams || {}),
                              [p.name]: e.target.value,
                            },
                          })
                        }
                      />
                      <label className="swagger-check scenario-param-req">
                        <input
                          type="checkbox"
                          checked={Boolean(p.required)}
                          onChange={(e) => {
                            const defs = ensureParamDefs(active).map((d) =>
                              d.in === 'query' && d.name === p.name
                                ? { ...d, required: e.target.checked }
                                : d,
                            );
                            patchActive({ paramDefs: defs });
                          }}
                        />
                        Req
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          const q = { ...(active.queryParams || {}) };
                          delete q[p.name];
                          patchActive({
                            queryParams: q,
                            paramDefs: ensureParamDefs(active).filter(
                              (d) => !(d.in === 'query' && d.name === p.name),
                            ),
                          });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {active.bodyRequired?.length ? (
                <div className="probe-section">
                  <h4>Required body fields</h4>
                  <p className="history-meta">
                    {active.bodyRequired.join(', ')} — validated as JSON keys on
                    Send.
                  </p>
                </div>
              ) : null}

              <div className="probe-section">
                <div className="probe-section-head">
                  <h4>Resolved preview</h4>
                </div>
                <pre className="scenario-result-pre">{previewPath || active.path}</pre>
              </div>
            </div>
          ) : null}

          {tab === 'headers' ? (
            <div className="scenario-tab-panel">
              <LoadDynamicVarsBar
                onInsert={insertDynamicToken}
                chainVars={chainVars}
              />
              {dynamicMsg ? <p className="step-msg">{dynamicMsg}</p> : null}
              <div className="scenario-kv-list">
                {headerLines.map((line, i) => (
                  <div key={i} className="scenario-kv-row">
                    <input
                      type="text"
                      placeholder="Header"
                      value={line.key}
                      onChange={(e) => {
                        const next = headerLines.map((l, j) =>
                          j === i ? { ...l, key: e.target.value } : l,
                        );
                        setHeaderLines(next);
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Value"
                      value={line.value}
                      onChange={(e) => {
                        const next = headerLines.map((l, j) =>
                          j === i ? { ...l, value: e.target.value } : l,
                        );
                        setHeaderLines(next);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        setHeaderLines(headerLines.filter((_, j) => j !== i))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setHeaderLines([...headerLines, { key: '', value: '' }])
                }
              >
                + Add header
              </button>
            </div>
          ) : null}

          {tab === 'body' ? (
            <div className="scenario-tab-panel">
              {!showBody ? (
                <p className="history-meta">
                  Body is often unused for {active.method || 'GET'}. You can still set
                  a body type if needed.
                </p>
              ) : null}

              <LoadDynamicVarsBar
                onInsert={insertDynamicToken}
                chainVars={chainVars}
              />
              {dynamicMsg ? <p className="step-msg">{dynamicMsg}</p> : null}

              <div className="body-mode-tabs" role="tablist">
                {BODY_MODES.map((m) => {
                  const current = inferBodyMode(active);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="tab"
                      className={`creds-role-tab ${current === m.id ? 'active' : ''}`}
                      onClick={() => {
                        const mode = m.id as LoadBodyMode;
                        if (mode === 'none') {
                          patchActive({
                            bodyMode: 'none',
                            body: undefined,
                            headers: withContentType(active.headers, undefined),
                          });
                          return;
                        }
                        if (mode === 'raw') {
                          const lang = (active.rawLanguage || 'json') as LoadRawLanguage;
                          patchActive({
                            bodyMode: 'raw',
                            rawLanguage: lang,
                            headers: withContentType(
                              active.headers,
                              contentTypeForRaw(lang),
                            ),
                          });
                          return;
                        }
                        if (mode === 'urlencoded' || mode === 'form-data') {
                          const fields =
                            active.formFields?.length
                              ? active.formFields
                              : formFieldsFromUrlEncoded(active.body);
                          patchActive({
                            bodyMode: mode,
                            formFields: fields,
                            headers: withContentType(
                              active.headers,
                              mode === 'urlencoded'
                                ? 'application/x-www-form-urlencoded'
                                : undefined,
                            ),
                          });
                          return;
                        }
                        if (mode === 'graphql') {
                          patchActive({
                            bodyMode: 'graphql',
                            graphqlQuery: active.graphqlQuery || active.body || '',
                            graphqlVariables: active.graphqlVariables || '{\n  \n}',
                            headers: withContentType(
                              active.headers,
                              'application/json',
                            ),
                          });
                          return;
                        }
                        if (mode === 'binary') {
                          patchActive({
                            bodyMode: 'binary',
                            headers: withContentType(
                              active.headers,
                              'application/octet-stream',
                            ),
                          });
                        }
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {inferBodyMode(active) === 'none' ? (
                <p className="history-meta">This request does not have a body.</p>
              ) : null}

              {inferBodyMode(active) === 'raw' ? (
                <>
                  <div className="body-raw-lang">
                    <span className="history-meta">Language</span>
                    <select
                      value={active.rawLanguage || 'json'}
                      onChange={(e) => {
                        const lang = e.target.value as LoadRawLanguage;
                        patchActive({
                          rawLanguage: lang,
                          bodyMode: 'raw',
                          headers: withContentType(
                            active.headers,
                            contentTypeForRaw(lang),
                          ),
                        });
                      }}
                    >
                      {RAW_LANGUAGES.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label>
                    Raw body
                    <textarea
                      rows={12}
                      className="scenario-body-input"
                      placeholder={
                        (active.rawLanguage || 'json') === 'json'
                          ? '{\n  "key": "value"\n}'
                          : 'Request body…'
                      }
                      value={active.body || ''}
                      onChange={(e) =>
                        patchActive({ body: e.target.value, bodyMode: 'raw' })
                      }
                    />
                  </label>
                </>
              ) : null}

              {inferBodyMode(active) === 'urlencoded' ||
              inferBodyMode(active) === 'form-data' ? (
                <div className="probe-section">
                  <div className="probe-section-head">
                    <h4>
                      {inferBodyMode(active) === 'form-data'
                        ? 'form-data'
                        : 'x-www-form-urlencoded'}
                    </h4>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        patchActive({
                          formFields: [
                            ...(active.formFields || []),
                            newFormField(),
                          ],
                          bodyMode: inferBodyMode(active),
                        })
                      }
                    >
                      + Add
                    </button>
                  </div>
                  <div className="scenario-kv-list">
                    {(active.formFields?.length
                      ? active.formFields
                      : [newFormField()]
                    ).map((field, idx, arr) => {
                      const isFormData = inferBodyMode(active) === 'form-data';
                      return (
                      <div
                        key={field.id}
                        className={`scenario-kv-row body-form-row ${isFormData ? '' : 'is-urlencoded'}`}
                      >
                        <label className="body-form-check" title="Include field">
                          <input
                            type="checkbox"
                            checked={field.enabled !== false}
                            onChange={(e) => {
                              const next = [...(active.formFields || arr)].map(
                                (f, i) =>
                                  i === idx
                                    ? { ...f, enabled: e.target.checked }
                                    : f,
                              );
                              patchActive({ formFields: next });
                            }}
                          />
                        </label>
                        <input
                          type="text"
                          placeholder="Key"
                          value={field.key}
                          onChange={(e) => {
                            const next = [...(active.formFields || arr)].map(
                              (f, i) =>
                                i === idx ? { ...f, key: e.target.value } : f,
                            );
                            patchActive({ formFields: next });
                          }}
                        />
                        {isFormData ? (
                          <select
                            value={field.type || 'text'}
                            onChange={(e) => {
                              const next = [...(active.formFields || arr)].map(
                                (f, i) =>
                                  i === idx
                                    ? {
                                        ...f,
                                        type: e.target.value as 'text' | 'file',
                                      }
                                    : f,
                              );
                              patchActive({ formFields: next });
                            }}
                          >
                            <option value="text">Text</option>
                            <option value="file">File</option>
                          </select>
                        ) : null}
                        <input
                          type="text"
                          placeholder={
                            field.type === 'file' ? 'Filename / path note' : 'Value'
                          }
                          value={field.value}
                          onChange={(e) => {
                            const next = [...(active.formFields || arr)].map(
                              (f, i) =>
                                i === idx ? { ...f, value: e.target.value } : f,
                            );
                            patchActive({ formFields: next });
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="Remove"
                          onClick={() => {
                            const base = active.formFields || arr;
                            const next = base.filter((_, i) => i !== idx);
                            patchActive({
                              formFields: next.length ? next : [newFormField()],
                            });
                          }}
                        >
                          ×
                        </button>
                      </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {inferBodyMode(active) === 'graphql' ? (
                <div className="probe-detail">
                  <label>
                    Query
                    <textarea
                      rows={8}
                      className="scenario-body-input"
                      placeholder={'query {\n  viewer { id }\n}'}
                      value={active.graphqlQuery || ''}
                      onChange={(e) =>
                        patchActive({
                          bodyMode: 'graphql',
                          graphqlQuery: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    GraphQL variables (JSON)
                    <textarea
                      rows={6}
                      className="scenario-body-input"
                      placeholder={'{\n  "id": "1"\n}'}
                      value={active.graphqlVariables || ''}
                      onChange={(e) =>
                        patchActive({
                          bodyMode: 'graphql',
                          graphqlVariables: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}

              {inferBodyMode(active) === 'binary' ? (
                <div className="probe-section">
                  <p className="history-meta">
                    Upload a file for the request body (stored as base64 for this
                    session / save).
                  </p>
                  <input
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const result = String(reader.result || '');
                        const b64 = result.includes(',')
                          ? result.split(',')[1] || ''
                          : result;
                        patchActive({
                          bodyMode: 'binary',
                          binaryFileName: file.name,
                          binaryBase64: b64,
                          headers: withContentType(
                            active.headers,
                            'application/octet-stream',
                          ),
                        });
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  {active.binaryFileName ? (
                    <p className="step-msg">
                      Selected: <code>{active.binaryFileName}</code>
                      {active.binaryBase64
                        ? ` · ~${Math.round((active.binaryBase64.length * 3) / 4)} bytes`
                        : ''}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'docs' ? (
            <div className="scenario-tab-panel docs-definition-panel">
              {!active.apiDefinition ? (
                <p className="history-meta">
                  No request/response definition on this scenario. Re-import from
                  Swagger (or paste an OpenAPI-backed suite) to attach Docs — like
                  Postman’s API definition view.
                </p>
              ) : (
                <ApiDefinitionView
                  definition={active.apiDefinition}
                  method={active.method || 'GET'}
                  path={active.path}
                  paramDefs={paramDefs}
                />
              )}
            </div>
          ) : null}

          {tab === 'chain' ? (
            <LoadChainPanel
              active={active}
              scenarioIndex={safeIdx}
              chainVars={chainVars}
              extractPreview={extractPreview}
              onPatch={patchActive}
              onInsertToken={insertDynamicToken}
            />
          ) : null}

          {tab === 'timing' ? (
            <div className="scenario-tab-panel">
              <label>
                Think time after this scenario (ms)
                <input
                  type="number"
                  min={0}
                  max={30000}
                  value={active.thinkTimeMs ?? 150}
                  onChange={(e) =>
                    patchActive({
                      thinkTimeMs: Math.max(
                        0,
                        Math.min(30_000, Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
              </label>
              <p className="history-meta" style={{ marginTop: '0.75rem' }}>
                To pass this API’s response into the next API, use the{' '}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setTab('chain')}
                >
                  Chain
                </button>{' '}
                tab.
              </p>
            </div>
          ) : null}

          {tab === 'curl' ? (
            <div className="scenario-tab-panel curl-import-panel">
              <p className="history-meta">
                Paste a curl command to fill this scenario’s method, URL, Params,
                Headers, and Body (raw / form-data / urlencoded) — same fields used
                by Send and load runs.
              </p>
              <label>
                Paste curl
                <textarea
                  rows={8}
                  className="scenario-body-input"
                  placeholder={`curl 'https://api.example.com/users?page=1' \\\n  -X POST \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"Ada"}'`}
                  value={curlText}
                  onChange={(e) => {
                    setCurlText(e.target.value);
                    setCurlError('');
                    setCurlImportedMsg('');
                  }}
                />
              </label>
              <div className="curl-import-actions">
                <div className="swagger-docs-auth-modes">
                  <button
                    type="button"
                    className={`creds-role-tab ${curlMode === 'replace' ? 'active' : ''}`}
                    onClick={() => setCurlMode('replace')}
                  >
                    Replace this scenario
                  </button>
                  <button
                    type="button"
                    className={`creds-role-tab ${curlMode === 'add' ? 'active' : ''}`}
                    onClick={() => setCurlMode('add')}
                  >
                    Add as new scenario
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!curlText.trim()}
                  onClick={importCurl}
                >
                  Import from curl
                </button>
              </div>
              {curlImportedMsg ? (
                <p className="step-msg">{curlImportedMsg}</p>
              ) : null}
              {curlError ? <p className="error-text">{curlError}</p> : null}
            </div>
          ) : null}

          {tab === 'export' ? (
            <div className="scenario-tab-panel code-export-panel">
              <p className="history-meta">
                Generate client code for this scenario (Postman-style) — cURL, Node.js,
                JavaScript, Python, Go, Java, C#, PHP, Ruby, and more.
              </p>
              <div className="code-export-toolbar">
                <label className="code-export-format">
                  Language / library
                  <select
                    value={exportFormat}
                    onChange={(e) => {
                      setExportFormat(e.target.value as RequestExportFormat);
                      setExportCopied(false);
                    }}
                  >
                    {Array.from(
                      new Set(REQUEST_EXPORT_FORMATS.map((f) => f.group)),
                    ).map((group) => (
                      <optgroup key={group} label={group}>
                        {REQUEST_EXPORT_FORMATS.filter((f) => f.group === group).map(
                          (f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ),
                        )}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <div className="code-export-actions">
                  {exportCopied ? (
                    <span className="probe-copied">Copied</span>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(exportCode).then(() => {
                        setExportCopied(true);
                        window.setTimeout(() => setExportCopied(false), 1600);
                      });
                    }}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const safe =
                        (active.name || active.path || 'request')
                          .replace(/[^\w.-]+/g, '-')
                          .slice(0, 40) || 'request';
                      downloadExportFile(
                        `${safe}.${exportMeta?.ext || 'txt'}`,
                        exportCode,
                      );
                    }}
                  >
                    Download
                  </button>
                </div>
              </div>
              <div className="code-export-chips">
                {REQUEST_EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`creds-role-tab ${exportFormat === f.id ? 'active' : ''}`}
                    onClick={() => {
                      setExportFormat(f.id);
                      setExportCopied(false);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <pre className="scenario-result-pre probe-body-pre code-export-pre">
                {exportCode}
              </pre>
            </div>
          ) : null}

          {tab === 'result' ? (
            <div className="scenario-tab-panel scenario-result-panel">
              {!probe && !sending ? (
                <p className="history-meta">
                  Click <strong>Send</strong> to run this scenario and view a polished
                  request / response (status, time, size, headers, pretty JSON).
                </p>
              ) : null}
              {sending ? <p className="step-msg">Sending request…</p> : null}
              {extractPreview ? (
                <p className="load-extract-preview">
                  Chain extract: <code>{extractPreview}</code>
                </p>
              ) : null}
              {probe ? <ProbeResultView probe={probe} /> : null}
            </div>
          ) : null}

          <div className="scenario-detail-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={safeIdx === 0}
              onClick={() => moveScenario(safeIdx, -1)}
            >
              ↑ Move up
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={safeIdx >= requests.length - 1}
              onClick={() => moveScenario(safeIdx, 1)}
            >
              ↓ Move down
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={requests.length <= 1}
              onClick={() => removeScenario(safeIdx)}
            >
              Remove scenario
            </button>
          </div>
        </div>
      </div>
    </fieldset>
  );
}
