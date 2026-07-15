'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  emptyLoadCredential,
  loadAuthCredentialsForRun,
  readLoadAuthCredentials,
  readLoadAuthLoginConfig,
  readPresetAuthHeaders,
  writeLoadAuthCredentials,
  writeLoadAuthLoginConfig,
  writePresetAuthHeaders,
} from '@/lib/load-auth-credentials';
import { useAppStore } from '@/lib/store';
import type { LoadAuthCredential, SwaggerOperation, WebLoadTestCase } from '@/lib/types';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { LoadAuthFileImport } from '@/components/LoadAuthFileImport';
import {
  paramDefsFromPathAndSwagger,
  seedParamValues,
} from '@/lib/load-request-params';

type SwaggerFetchResult = {
  title: string;
  version?: string;
  apiBaseUrl?: string;
  swaggerUrl: string;
  suggestedLoginPath?: string;
  securitySchemes: string[];
  operations: SwaggerOperation[];
  authRequiredCount: number;
};

type Props = {
  baseUrl: string;
  apiUrl?: string;
  onSaved: () => void;
};

/** Auto load profile applied to every imported case (no manual selection). */
const AUTO_VUS = 10;
const AUTO_DURATION_SEC = 30;
const AUTO_RAMP_SEC = 5;

function opKey(o: SwaggerOperation) {
  return o.id;
}

function toBearerHeader(token: string): string {
  const t = token.trim();
  if (!t) return '';
  return /^bearer\s/i.test(t) ? t : `Bearer ${t}`;
}

export function SwaggerLoadPicker({ baseUrl, apiUrl, onSaved }: Props) {
  const setApiUrl = useAppStore((s) => s.setApiUrl);
  const [open, setOpen] = useState(false);
  const [swaggerUrl, setSwaggerUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [error, setError] = useState('');
  const [spec, setSpec] = useState<SwaggerFetchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [authOnly, setAuthOnly] = useState(false);
  const [tokenStatus, setTokenStatus] = useState('');

  /** Docs URL fetch auth (Swagger page itself → 401) */
  const [docsAuthOpen, setDocsAuthOpen] = useState(false);
  const [docsAuthMode, setDocsAuthMode] = useState<'basic' | 'bearer'>('basic');
  const [docsUsername, setDocsUsername] = useState('');
  const [docsPassword, setDocsPassword] = useState('');
  const [docsBearer, setDocsBearer] = useState('');

  /** Inline API auth — used for all selected auth-required APIs */
  const [loginPath, setLoginPath] = useState('/auth/user-login');
  const [usernameField, setUsernameField] = useState('mobileNumber');
  const [passwordField, setPasswordField] = useState('password');
  const [tokenJsonPath, setTokenJsonPath] = useState('data.token');
  const [creds, setCreds] = useState<LoadAuthCredential[]>([
    emptyLoadCredential('User 1'),
  ]);
  const [directToken, setDirectToken] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'token'>('login');

  const selectedOps = useMemo(() => {
    if (!spec) return [];
    return spec.operations.filter((o) => selected.has(opKey(o)));
  }, [spec, selected]);

  const needsAuth = selectedOps.some((o) => o.requiresAuth);

  const filteredOps = useMemo(() => {
    if (!spec) return [];
    const q = filter.trim().toLowerCase();
    return spec.operations.filter((o) => {
      if (authOnly && !o.requiresAuth) return false;
      if (!q) return true;
      return (
        o.path.toLowerCase().includes(q) ||
        o.method.toLowerCase().includes(q) ||
        (o.summary || '').toLowerCase().includes(q) ||
        (o.operationId || '').toLowerCase().includes(q) ||
        (o.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [spec, filter, authOnly]);

  const authReady = useMemo(() => {
    if (!needsAuth) return true;
    if (authMode === 'token') return Boolean(directToken.trim());
    return (
      Boolean(loginPath.trim()) &&
      creds.some((c) => c.username.trim() && c.password)
    );
  }, [needsAuth, authMode, directToken, loginPath, creds]);

  /** Prefill auth form when picker opens / swagger suggests login */
  useEffect(() => {
    if (!open) return;
    const stored = readLoadAuthCredentials();
    if (stored.length) setCreds(stored);
    const cfg = readLoadAuthLoginConfig();
    if (cfg?.loginPath) {
      setLoginPath(cfg.loginPath === '/auth/login' ? '/auth/user-login' : cfg.loginPath);
    }
    if (cfg?.usernameField) {
      setUsernameField(
        cfg.usernameField === 'email' ? 'mobileNumber' : cfg.usernameField,
      );
    }
    if (cfg?.passwordField) setPasswordField(cfg.passwordField);
    if (cfg?.tokenJsonPath) setTokenJsonPath(cfg.tokenJsonPath);
    const presets = readPresetAuthHeaders();
    if (presets[0]) {
      setDirectToken(presets[0].replace(/^Bearer\s+/i, ''));
      setAuthMode('token');
    }
  }, [open]);

  useEffect(() => {
    if (spec?.suggestedLoginPath && !readLoadAuthLoginConfig()?.loginPath) {
      setLoginPath(spec.suggestedLoginPath);
    }
  }, [spec?.suggestedLoginPath]);

  function openPicker() {
    setOpen(true);
    setError('');
  }

  function closePicker() {
    setOpen(false);
  }

  function buildFetchAuth() {
    if (docsAuthMode === 'bearer' && docsBearer.trim()) {
      return { bearerToken: docsBearer.trim() };
    }
    if (docsUsername.trim() && docsPassword) {
      return { username: docsUsername.trim(), password: docsPassword };
    }
    return undefined;
  }

  function persistAuthForRuns(): { ok: boolean; error?: string } {
    if (!needsAuth) return { ok: true };

    if (authMode === 'token') {
      const header = toBearerHeader(directToken);
      if (!header) return { ok: false, error: 'Paste a Bearer token for auth-required APIs.' };
      writePresetAuthHeaders([header]);
      writeLoadAuthLoginConfig({
        loginPath: loginPath.trim() || '/auth/user-login',
        usernameField: usernameField.trim() || 'mobileNumber',
        passwordField: passwordField.trim() || 'password',
        tokenJsonPath: tokenJsonPath.trim() || 'data.token',
        tokenHeader: 'Authorization',
        tokenPrefix: 'Bearer ',
        method: 'POST',
        extraBody: { rememberMe: 'true' },
      });
      return { ok: true };
    }

    const cleaned = creds
      .map((c, i) => ({
        ...c,
        label: (c.label || `User ${i + 1}`).trim() || `User ${i + 1}`,
        username: c.username.trim(),
      }))
      .filter((c) => c.username && c.password);

    if (!cleaned.length) {
      return { ok: false, error: 'Enter at least one username and password.' };
    }
    if (!loginPath.trim()) {
      return { ok: false, error: 'Login path is required (API that returns the token).' };
    }

    writeLoadAuthCredentials(cleaned);
    writePresetAuthHeaders([]);
    writeLoadAuthLoginConfig({
      loginPath: loginPath.trim(),
      method: 'POST',
      usernameField: usernameField.trim() || 'mobileNumber',
      passwordField: passwordField.trim() || 'password',
      tokenJsonPath: tokenJsonPath.trim() || 'data.token',
      tokenHeader: 'Authorization',
      tokenPrefix: 'Bearer ',
      extraBody: { rememberMe: 'true' },
    });
    return { ok: true };
  }

  async function fetchSwagger() {
    setLoading(true);
    setError('');
    setSpec(null);
    setSelected(new Set());
    setTokenStatus('');
    try {
      const res = await fetch('/api/tests/load/swagger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swaggerUrl: swaggerUrl.trim(),
          fetchAuth: buildFetchAuth(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (
          data.needsAuth ||
          res.status === 401 ||
          /401|Unauthorized/i.test(data.error || '')
        ) {
          setDocsAuthOpen(true);
        }
        throw new Error(data.error || 'Failed to load Swagger');
      }
      const result = data as SwaggerFetchResult;
      setSpec(result);
      if (result.apiBaseUrl && !apiUrl) setApiUrl(result.apiBaseUrl);
      if (result.suggestedLoginPath) {
        setLoginPath((prev) => prev || result.suggestedLoginPath || prev);
        const existing = readLoadAuthLoginConfig() || {};
        writeLoadAuthLoginConfig({
          ...existing,
          loginPath: existing.loginPath || result.suggestedLoginPath,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Swagger');
    } finally {
      setLoading(false);
    }
  }

  function toggleOp(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const o of filteredOps) next.add(opKey(o));
      return next;
    });
  }

  function selectAll() {
    if (!spec) return;
    setSelected(new Set(spec.operations.map((o) => opKey(o))));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function testTokens() {
    const persisted = persistAuthForRuns();
    if (!persisted.ok) {
      setError(persisted.error || 'Auth incomplete');
      return;
    }
    if (authMode === 'token') {
      setTokenStatus('✓ Bearer token saved — will be used on every auth load run.');
      setError('');
      return;
    }

    setTokenBusy(true);
    setTokenStatus('');
    setError('');
    try {
      const res = await fetch('/api/tests/load/auth-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: apiUrl || spec?.apiBaseUrl,
          credentials: loadAuthCredentialsForRun(),
          login: readLoadAuthLoginConfig(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Token request failed');
      const okCount = data.tokenCount || 0;
      if (!okCount) {
        throw new Error(
          data.errors?.[0]?.error ||
            'No tokens obtained — check login path and credentials',
        );
      }
      const headers = (data.tokens || [])
        .map((t: { headerValue?: string }) => t.headerValue)
        .filter(Boolean) as string[];
      if (headers.length) writePresetAuthHeaders(headers);
      setTokenStatus(`✓ Obtained ${okCount} token(s) — ready for load.`);
    } catch (err) {
      setTokenStatus('');
      setError(err instanceof Error ? err.message : 'Token test failed');
    } finally {
      setTokenBusy(false);
    }
  }

  function buildCases(): WebLoadTestCase[] {
    if (!spec || !selectedOps.length) return [];

    const titleSlug = (spec.title || 'api')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'api';
    const anyAuth = selectedOps.some((o) => o.requiresAuth);
    const first = selectedOps[0];

    const requests = selectedOps.map((op) => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (op.consumesJson || op.sampleBody) {
        headers['Content-Type'] = 'application/json';
      }
      const paramDefs = paramDefsFromPathAndSwagger(op.path, op.parameters);
      const seeded = seedParamValues(paramDefs);
      for (const [k, v] of Object.entries(seeded.headerExtras)) {
        if (!headers[k]) headers[k] = v;
      }
      const stepName =
        op.summary || op.operationId || `${op.method} ${op.path}`;
      return {
        name: stepName.slice(0, 100),
        path: op.path,
        method: op.method,
        useApiBase: true as const,
        headers,
        body: op.sampleBody,
        pathParams: Object.keys(seeded.pathParams).length
          ? seeded.pathParams
          : undefined,
        queryParams: Object.keys(seeded.queryParams).length
          ? seeded.queryParams
          : undefined,
        paramDefs: paramDefs.length ? paramDefs : undefined,
        bodyRequired: op.bodyRequired,
        apiDefinition: op.apiDefinition,
        thinkTimeMs: 150,
      };
    });

    const main: WebLoadTestCase = {
      id: `swagger-${titleSlug}`,
      name: `Swagger · ${spec.title}`.slice(0, 120),
      description: [
        `Main Swagger load suite imported from ${spec.swaggerUrl}.`,
        `${selectedOps.length} API scenarios inside this case.`,
        `Auto load: ${AUTO_VUS} VUs · ${AUTO_DURATION_SEC}s.`,
        anyAuth
          ? 'Includes auth-required APIs — username/password or token applied at run time.'
          : 'All selected scenarios are public / unauthenticated.',
      ].join(' '),
      tags: [
        'web-load',
        'swagger',
        'api',
        'suite',
        ...(anyAuth ? ['auth'] : ['public']),
      ],
      estimatedMinutes: Math.max(2, Math.min(15, Math.ceil(selectedOps.length / 20))),
      kind: 'web-load',
      source: 'upload',
      group: `swagger:${spec.title}`,
      load: {
        targetUrl: first.path,
        method: first.method,
        useApiBase: true,
        apiBaseUrl: (apiUrl || spec.apiBaseUrl || '').replace(/\/+$/, '') || undefined,
        headers: { Accept: 'application/json' },
        body: first.sampleBody,
        virtualUsers: AUTO_VUS,
        durationSec: AUTO_DURATION_SEC,
        rampUpSec: AUTO_RAMP_SEC,
        maxErrorRatePct: 10,
        p95Ms: 4000,
        p99Ms: 6000,
        profile: selectedOps.length > 1 ? 'advanced' : 'basic',
        requiresAuth: anyAuth,
        swaggerUrl: spec.swaggerUrl,
        operationId: first.operationId,
        operationTags: Array.from(
          new Set(selectedOps.flatMap((o) => o.tags || [])),
        ).slice(0, 12),
        requests: selectedOps.length > 1 ? requests : undefined,
      },
    };

    // Single-API import: still one main Swagger case (requests optional)
    if (selectedOps.length === 1) {
      main.load.requests = requests;
      main.load.profile = 'basic';
    }

    return [main];
  }

  async function saveCases() {
    if (!selectedOps.length) {
      setError('Select at least one API to add as internal scenarios.');
      return;
    }
    if (needsAuth) {
      const persisted = persistAuthForRuns();
      if (!persisted.ok) {
        setError(persisted.error || 'Set username/password or token first.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const cases = buildCases();
      const res = await fetch('/api/tests/load/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases, source: 'upload' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save cases');
      onSaved();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const modal =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="report-modal-root swagger-picker-root"
            role="dialog"
            aria-modal="true"
            aria-label="Import APIs from Swagger"
          >
            <div className="report-modal-backdrop" onClick={closePicker} />
            <div className="report-modal swagger-picker-modal">
              <header className="creds-modal-header">
                <div className="creds-modal-header-copy">
                  <h2>Swagger → API load tests</h2>
                  <p className="history-meta">
                    Pick APIs — they become <strong>internal scenarios</strong> inside one main{' '}
                    <strong>Swagger</strong> load case (auto{' '}
                    <strong>
                      {AUTO_VUS} VUs · {AUTO_DURATION_SEC}s
                    </strong>
                    ). Portal: <code>{baseUrl}</code>
                    {apiUrl ? (
                      <>
                        {' '}
                        · API <code>{apiUrl}</code>
                      </>
                    ) : null}
                  </p>
                </div>
                <ModalCloseButton onClick={closePicker} />
              </header>

              <div className="report-modal-body swagger-picker-body">
                <div className="swagger-url-row">
                  <label htmlFor="swaggerUrlInput">
                    Swagger / OpenAPI JSON URL
                    <input
                      id="swaggerUrlInput"
                      className="url-input"
                      type="url"
                      placeholder="https://api.example.com/v3/api-docs"
                      value={swaggerUrl}
                      onChange={(e) => setSwaggerUrl(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={loading || !swaggerUrl.trim()}
                    onClick={() => void fetchSwagger()}
                  >
                    {loading ? 'Loading…' : 'Fetch APIs'}
                  </button>
                </div>

                <div className="swagger-docs-auth">
                  <button
                    type="button"
                    className="btn btn-ghost swagger-docs-auth-toggle"
                    onClick={() => setDocsAuthOpen((v) => !v)}
                  >
                    {docsAuthOpen ? '▾' : '▸'} Docs URL auth (only if Fetch returns 401)
                  </button>
                  {docsAuthOpen ? (
                    <fieldset className="swagger-docs-auth-fields">
                      <legend>Access protected Swagger / api-docs</legend>
                      <div className="swagger-docs-auth-modes" role="tablist">
                        <button
                          type="button"
                          className={`creds-role-tab ${docsAuthMode === 'basic' ? 'active' : ''}`}
                          onClick={() => setDocsAuthMode('basic')}
                        >
                          Username / password
                        </button>
                        <button
                          type="button"
                          className={`creds-role-tab ${docsAuthMode === 'bearer' ? 'active' : ''}`}
                          onClick={() => setDocsAuthMode('bearer')}
                        >
                          Bearer token
                        </button>
                      </div>
                      {docsAuthMode === 'basic' ? (
                        <div className="load-auth-grid-2">
                          <label>
                            Username
                            <input
                              type="text"
                              value={docsUsername}
                              onChange={(e) => setDocsUsername(e.target.value)}
                            />
                          </label>
                          <label>
                            Password
                            <input
                              type="password"
                              value={docsPassword}
                              onChange={(e) => setDocsPassword(e.target.value)}
                            />
                          </label>
                        </div>
                      ) : (
                        <label>
                          Bearer token
                          <input
                            type="password"
                            value={docsBearer}
                            onChange={(e) => setDocsBearer(e.target.value)}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={loading || !swaggerUrl.trim()}
                        onClick={() => void fetchSwagger()}
                      >
                        {loading ? 'Loading…' : 'Fetch with auth'}
                      </button>
                    </fieldset>
                  ) : null}
                </div>

                {spec ? (
                  <>
                    <p className="step-msg">
                      <strong>{spec.title}</strong>
                      {spec.version ? ` · v${spec.version}` : ''} ·{' '}
                      {spec.operations.length} operations ·{' '}
                      {spec.authRequiredCount} require auth
                      {spec.apiBaseUrl ? (
                        <>
                          {' '}
                          · base <code>{spec.apiBaseUrl}</code>
                        </>
                      ) : null}
                    </p>

                    <div className="swagger-toolbar">
                      <input
                        type="search"
                        className="url-input"
                        placeholder="Filter by path, method, tag…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      />
                      <label className="swagger-check">
                        <input
                          type="checkbox"
                          checked={authOnly}
                          onChange={(e) => setAuthOnly(e.target.checked)}
                        />
                        Auth required only
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={selectAll}
                        disabled={!spec?.operations.length}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={selectAllFiltered}
                        disabled={!filteredOps.length}
                      >
                        Select visible
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={clearSelection}
                        disabled={!selected.size}
                      >
                        Clear
                      </button>
                    </div>

                    <ul className="swagger-op-list">
                      {filteredOps.map((op) => {
                        const id = opKey(op);
                        const checked = selected.has(id);
                        return (
                          <li key={id}>
                            <label
                              className={`swagger-op-row ${checked ? 'selected' : ''} ${op.requiresAuth ? 'needs-auth' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleOp(id)}
                              />
                              <span
                                className={`swagger-method method-${op.method.toLowerCase()}`}
                              >
                                {op.method}
                              </span>
                              <span className="swagger-path">
                                <code>{op.path}</code>
                                {op.summary ? (
                                  <span className="swagger-summary">{op.summary}</span>
                                ) : null}
                              </span>
                              {op.requiresAuth ? (
                                <span className="swagger-lock">🔒 Auth</span>
                              ) : (
                                <span className="swagger-public">Public</span>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>

                    <p className="step-msg swagger-auto-load">
                      Selected: <strong>{selectedOps.length}</strong>
                      {needsAuth ? ' · auth required' : ''}
                      {' · '}
                      Auto load: <strong>{AUTO_VUS} VUs · {AUTO_DURATION_SEC}s</strong> (applied to all cases)
                    </p>

                    {needsAuth ? (
                      <fieldset className="swagger-inline-auth">
                        <legend>Authorization required — set once for all selected APIs</legend>
                        <p className="history-meta">
                          These credentials / token are saved for this browser tab and used on
                          every auth load run. Passwords are never written to reports.
                        </p>

                        <div className="swagger-docs-auth-modes" role="tablist">
                          <button
                            type="button"
                            className={`creds-role-tab ${authMode === 'login' ? 'active' : ''}`}
                            onClick={() => setAuthMode('login')}
                          >
                            Username / password → token
                          </button>
                          <button
                            type="button"
                            className={`creds-role-tab ${authMode === 'token' ? 'active' : ''}`}
                            onClick={() => setAuthMode('token')}
                          >
                            Paste token
                          </button>
                        </div>

                        {authMode === 'login' ? (
                          <>
                            <div className="load-auth-grid-2">
                              <label>
                                Login path
                                <input
                                  type="text"
                                  placeholder="/auth/user-login"
                                  value={loginPath}
                                  onChange={(e) => setLoginPath(e.target.value)}
                                />
                              </label>
                              <label>
                                Token JSON path
                                <input
                                  type="text"
                                  placeholder="data.token"
                                  value={tokenJsonPath}
                                  onChange={(e) => setTokenJsonPath(e.target.value)}
                                />
                              </label>
                              <label>
                                Username field
                                <input
                                  type="text"
                                  value={usernameField}
                                  onChange={(e) => setUsernameField(e.target.value)}
                                />
                              </label>
                              <label>
                                Password field
                                <input
                                  type="text"
                                  value={passwordField}
                                  onChange={(e) => setPasswordField(e.target.value)}
                                />
                              </label>
                            </div>

                            <LoadAuthFileImport credentials={creds} onChange={setCreds} />

                            {creds.map((c, i) => (
                              <div key={c.id} className="load-auth-cred-row swagger-inline-cred">
                                <label>
                                  Label
                                  <input
                                    type="text"
                                    value={c.label}
                                    onChange={(e) =>
                                      setCreds((list) =>
                                        list.map((x) =>
                                          x.id === c.id
                                            ? { ...x, label: e.target.value }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  Username / email / mobile
                                  <input
                                    type="text"
                                    autoComplete="username"
                                    placeholder="email or mobile number"
                                    value={c.username}
                                    onChange={(e) =>
                                      setCreds((list) =>
                                        list.map((x) =>
                                          x.id === c.id
                                            ? { ...x, username: e.target.value }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  Password
                                  <input
                                    type="password"
                                    autoComplete="current-password"
                                    value={c.password}
                                    onChange={(e) =>
                                      setCreds((list) =>
                                        list.map((x) =>
                                          x.id === c.id
                                            ? { ...x, password: e.target.value }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="btn btn-ghost load-auth-remove"
                                  disabled={creds.length <= 1}
                                  onClick={() =>
                                    setCreds((list) =>
                                      list.length <= 1
                                        ? list
                                        : list.filter((x) => x.id !== c.id),
                                    )
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                setCreds((c) => [
                                  ...c,
                                  emptyLoadCredential(`User ${c.length + 1}`),
                                ])
                              }
                            >
                              + Add credential
                            </button>
                          </>
                        ) : (
                          <label>
                            Bearer token (used for all auth APIs)
                            <input
                              type="password"
                              autoComplete="off"
                              placeholder="Paste access token"
                              value={directToken}
                              onChange={(e) => setDirectToken(e.target.value)}
                            />
                          </label>
                        )}

                        <div className="swagger-auth-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={tokenBusy || !authReady}
                            onClick={() => void testTokens()}
                          >
                            {tokenBusy
                              ? 'Getting tokens…'
                              : authMode === 'token'
                                ? 'Save token'
                                : 'Save & test get tokens'}
                          </button>
                          {tokenStatus ? (
                            <span className="step-msg">{tokenStatus}</span>
                          ) : null}
                          {!authReady ? (
                            <span className="error-text">
                              Fill username/password (or paste token) before creating cases.
                            </span>
                          ) : null}
                        </div>
                      </fieldset>
                    ) : null}
                  </>
                ) : null}

                {error ? (
                  <p className="error-text" style={{ whiteSpace: 'pre-wrap' }}>
                    {error}
                  </p>
                ) : null}

                <div className="creds-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving || !selectedOps.length || (needsAuth && !authReady)}
                    onClick={() => void saveCases()}
                  >
                    {saving
                      ? 'Saving…'
                      : selectedOps.length
                        ? `Create Swagger case (${selectedOps.length} scenario${selectedOps.length === 1 ? '' : 's'})`
                        : 'Create Swagger case'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={closePicker}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={openPicker}>
        Import from Swagger
      </button>
      {modal}
    </>
  );
}
