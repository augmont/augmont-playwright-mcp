'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  emptyLoadCredential,
  readLoadAuthCredentials,
  readLoadAuthLoginConfig,
  readPresetAuthHeaders,
  writeLoadAuthCredentials,
  writeLoadAuthLoginConfig,
  writePresetAuthHeaders,
} from '@/lib/load-auth-credentials';
import { useAppStore } from '@/lib/store';
import type {
  LoadAuthCredential,
  WebLoadRequestStep,
  WebLoadTestCase,
} from '@/lib/types';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { LoadScenarioEditor } from '@/components/LoadScenarioEditor';
import { LoadAuthFileImport } from '@/components/LoadAuthFileImport';
import { ensureLgdApiV1Base } from '@/lib/api-url';
import { defaultLoadP99Ms, resolveLoadThresholds } from '@/lib/load-grade-summary';

type Props = {
  open: boolean;
  loadCase: WebLoadTestCase | null;
  onClose: () => void;
  onSaved: (updated: WebLoadTestCase) => void;
  /** After a successful save, start a full load test (VUs / duration from Load settings). */
  onRunLoadTest?: (updated: WebLoadTestCase) => void | Promise<void>;
};

function toBearer(token: string): string {
  const t = token.trim();
  if (!t) return '';
  return /^bearer\s/i.test(t) ? t : `Bearer ${t}`;
}

export function SwaggerSuiteEditModal({
  open,
  loadCase,
  onClose,
  onSaved,
  onRunLoadTest,
}: Props) {
  const storeApiUrl = useAppStore((s) => s.apiUrl);
  const setApiUrl = useAppStore((s) => s.setApiUrl);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [swaggerUrl, setSwaggerUrl] = useState('');
  const [virtualUsers, setVirtualUsers] = useState(10);
  const [durationSec, setDurationSec] = useState(30);
  const [rampUpSec, setRampUpSec] = useState(5);
  const [maxErrorRatePct, setMaxErrorRatePct] = useState(10);
  const [p50Ms, setP50Ms] = useState(1800);
  const [p75Ms, setP75Ms] = useState(2600);
  const [p90Ms, setP90Ms] = useState(3400);
  const [p95Ms, setP95Ms] = useState(4000);
  const [p99Ms, setP99Ms] = useState(6000);
  const [avgMs, setAvgMs] = useState(2200);
  const [maxAvgLatencyMs, setMaxAvgLatencyMs] = useState(1600);
  const [maxAvgConnectMs, setMaxAvgConnectMs] = useState(1000);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [requests, setRequests] = useState<WebLoadRequestStep[]>([]);

  const [authMode, setAuthMode] = useState<'login' | 'token'>('login');
  const [loginPath, setLoginPath] = useState('/auth/user-login');
  const [usernameField, setUsernameField] = useState('mobileNumber');
  const [passwordField, setPasswordField] = useState('password');
  const [tokenJsonPath, setTokenJsonPath] = useState('data.token');
  const [creds, setCreds] = useState<LoadAuthCredential[]>([
    emptyLoadCredential('User 1'),
  ]);
  const [directToken, setDirectToken] = useState('');

  const [saving, setSaving] = useState(false);
  const [runningLoad, setRunningLoad] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!open || !loadCase) return;
    setName(loadCase.name);
    setDescription(loadCase.description || '');
    setApiBaseUrl(
      ensureLgdApiV1Base(loadCase.load.apiBaseUrl || storeApiUrl || '') ||
        loadCase.load.apiBaseUrl ||
        storeApiUrl ||
        '',
    );
    setSwaggerUrl(loadCase.load.swaggerUrl || '');
    setVirtualUsers(loadCase.load.virtualUsers);
    setDurationSec(loadCase.load.durationSec);
    setRampUpSec(loadCase.load.rampUpSec);
    setMaxErrorRatePct(loadCase.load.maxErrorRatePct);
    const lim = resolveLoadThresholds(loadCase.load);
    setP50Ms(lim.p50Ms);
    setP75Ms(lim.p75Ms);
    setP90Ms(lim.p90Ms);
    setP95Ms(lim.p95Ms);
    setP99Ms(lim.p99Ms);
    setAvgMs(lim.avgMs);
    setMaxAvgLatencyMs(lim.avgLatencyMs);
    setMaxAvgConnectMs(lim.avgConnectMs);
    setRequiresAuth(Boolean(loadCase.load.requiresAuth));
    setRequests(
      loadCase.load.requests?.length
        ? loadCase.load.requests.map((r) => ({ ...r }))
        : [
            {
              name: loadCase.name,
              path: loadCase.load.targetUrl,
              method: loadCase.load.method,
              useApiBase: loadCase.load.useApiBase,
              headers: loadCase.load.headers,
              body: loadCase.load.body,
            },
          ],
    );

    const stored = readLoadAuthCredentials();
    setCreds(stored.length ? stored : [emptyLoadCredential('User 1')]);
    const cfg = readLoadAuthLoginConfig();
    // Migrate previous wrong defaults to LGD API login
    const path = cfg?.loginPath || '/auth/user-login';
    const userField = cfg?.usernameField || 'mobileNumber';
    setLoginPath(path === '/auth/login' ? '/auth/user-login' : path);
    setUsernameField(userField === 'email' ? 'mobileNumber' : userField);
    setPasswordField(cfg?.passwordField || 'password');
    setTokenJsonPath(cfg?.tokenJsonPath || 'data.token');
    const presets = readPresetAuthHeaders();
    if (presets[0]) {
      setDirectToken(presets[0].replace(/^Bearer\s+/i, ''));
      setAuthMode('token');
    } else {
      setDirectToken('');
      setAuthMode('login');
    }
    setError('');
    setSavedMsg('');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, loadCase, storeApiUrl, onClose]);

  if (!open || !loadCase) return null;

  function persistAuth() {
    if (authMode === 'token') {
      const header = toBearer(directToken);
      writePresetAuthHeaders(header ? [header] : []);
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
      return;
    }
    const cleaned = creds
      .map((c, i) => ({
        ...c,
        label: (c.label || `User ${i + 1}`).trim() || `User ${i + 1}`,
        username: c.username.trim(),
      }))
      .filter((c) => c.username && c.password);
    writeLoadAuthCredentials(cleaned);
    writePresetAuthHeaders([]);
    writeLoadAuthLoginConfig({
      loginPath: loginPath.trim() || '/auth/user-login',
      method: 'POST',
      usernameField: usernameField.trim() || 'mobileNumber',
      passwordField: passwordField.trim() || 'password',
      tokenJsonPath: tokenJsonPath.trim() || 'data.token',
      tokenHeader: 'Authorization',
      tokenPrefix: 'Bearer ',
      extraBody: { rememberMe: 'true' },
    });
  }

  async function save(): Promise<WebLoadTestCase | null> {
    if (!loadCase) return null;
    const api =
      ensureLgdApiV1Base(apiBaseUrl.trim()) ||
      apiBaseUrl.trim().replace(/\/+$/, '');
    if (api && !/^https?:\/\//i.test(api)) {
      setError('API URL must start with http:// or https://');
      return null;
    }
    if (api && api !== apiBaseUrl.trim().replace(/\/+$/, '')) {
      setApiBaseUrl(api);
    }
    if (!requests.some((r) => r.path.trim())) {
      setError('At least one internal scenario with a path is required.');
      return null;
    }
    if (requiresAuth) {
      if (authMode === 'token' && !directToken.trim()) {
        setError('Paste a Bearer token, or switch to username/password.');
        return null;
      }
      if (
        authMode === 'login' &&
        !creds.some((c) => c.username.trim() && c.password)
      ) {
        setError('Enter at least one username and password.');
        return null;
      }
    }

    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      persistAuth();
      if (api) setApiUrl(api);

      const first = requests.find((r) => r.path.trim()) || requests[0];
      const res = await fetch(`/api/tests/${encodeURIComponent(loadCase.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          load: {
            targetUrl: first.path.trim(),
            method: first.method || loadCase.load.method,
            useApiBase: true,
            apiBaseUrl: api || undefined,
            swaggerUrl: swaggerUrl.trim() || undefined,
            virtualUsers,
            durationSec,
            rampUpSec,
            maxErrorRatePct,
            p50Ms,
            p75Ms,
            p90Ms,
            p95Ms,
            p99Ms: defaultLoadP99Ms(p95Ms, p99Ms),
            avgMs,
            maxAvgLatencyMs,
            maxAvgConnectMs,
            requiresAuth,
            profile: requests.length > 1 ? 'advanced' : 'basic',
            requests: requests
              .filter((r) => r.path.trim())
              .map((r) => ({
                ...r,
                path: r.path.trim(),
                useApiBase: r.useApiBase ?? true,
              })),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      const updated = data.case as WebLoadTestCase;
      setSavedMsg('Saved. Auth details updated for this tab.');
      onSaved(updated);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndRunLoadTest() {
    if (!onRunLoadTest) return;
    setRunningLoad(true);
    setError('');
    try {
      const updated = await save();
      if (!updated) return;
      setSavedMsg('Saved. Starting load test…');
      await onRunLoadTest(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start load test');
    } finally {
      setRunningLoad(false);
    }
  }

  const modal = (
    <div
      className="report-modal-root swagger-edit-root"
      role="dialog"
      aria-modal="true"
      aria-label="Edit Swagger load case"
    >
      <div className="report-modal-backdrop" onClick={onClose} />
      <div className="report-modal swagger-edit-modal">
        <header className="creds-modal-header">
          <div className="creds-modal-header-copy">
            <h2>Edit Swagger load case</h2>
            <p className="history-meta">
              Update name, API URL, load settings, user credentials / token, and
              internal scenarios.
            </p>
          </div>
          <ModalCloseButton onClick={onClose} />
        </header>

        <div className="report-modal-body swagger-edit-body">
          <fieldset className="swagger-inline-auth">
            <legend>Main details</legend>
            <label>
              Case name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Description
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              Main API URL
              <input
                type="url"
                placeholder="https://api.testlgd.augmont.com/api/v1"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
              />
            </label>
            <p className="history-meta">
              Must include <code>/api/v1</code> (e.g.{' '}
              <code>https://api.testlgd.augmont.com/api/v1</code>). Without it,
              login returns 401 “please login first”.
            </p>
            <label>
              Swagger source URL
              <input
                type="url"
                placeholder="https://api.example.com/swagger.json"
                value={swaggerUrl}
                onChange={(e) => setSwaggerUrl(e.target.value)}
              />
            </label>
          </fieldset>

          <fieldset className="swagger-inline-auth">
            <legend>Load settings</legend>
            <div className="load-auth-grid-2">
              <label>
                Virtual users
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={virtualUsers}
                  onChange={(e) => setVirtualUsers(Number(e.target.value) || 10)}
                />
              </label>
              <label>
                Duration (sec)
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value) || 30)}
                />
              </label>
              <label>
                Ramp-up (sec)
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={rampUpSec}
                  onChange={(e) => setRampUpSec(Number(e.target.value) || 0)}
                />
              </label>
              <label>
                Max error %
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={maxErrorRatePct}
                  onChange={(e) =>
                    setMaxErrorRatePct(Number(e.target.value) || 0)
                  }
                />
              </label>
              <label>
                p50 threshold (ms)
                <input
                  type="number"
                  min={50}
                  max={120000}
                  value={p50Ms}
                  onChange={(e) => setP50Ms(Number(e.target.value) || 50)}
                />
              </label>
              <label>
                p75 threshold (ms)
                <input
                  type="number"
                  min={50}
                  max={120000}
                  value={p75Ms}
                  onChange={(e) => setP75Ms(Number(e.target.value) || 50)}
                />
              </label>
              <label>
                p90 threshold (ms)
                <input
                  type="number"
                  min={50}
                  max={120000}
                  value={p90Ms}
                  onChange={(e) => setP90Ms(Number(e.target.value) || 50)}
                />
              </label>
              <label>
                p95 threshold (ms)
                <input
                  type="number"
                  min={50}
                  max={120000}
                  value={p95Ms}
                  onChange={(e) => {
                    const next = Number(e.target.value) || 4000;
                    setP95Ms(next);
                    const derived = resolveLoadThresholds({
                      maxErrorRatePct,
                      p95Ms: next,
                      virtualUsers,
                      durationSec,
                    });
                    setP50Ms((prev) => (prev > next ? derived.p50Ms : prev));
                    setP75Ms((prev) => (prev > next ? derived.p75Ms : prev));
                    setP90Ms((prev) => (prev > next ? derived.p90Ms : prev));
                    setP99Ms((prev) =>
                      prev < next ? derived.p99Ms : prev,
                    );
                    setAvgMs((prev) => (prev > next ? derived.avgMs : prev));
                  }}
                />
              </label>
              <label>
                p99 threshold (ms)
                <input
                  type="number"
                  min={50}
                  max={120000}
                  value={p99Ms}
                  onChange={(e) =>
                    setP99Ms(
                      defaultLoadP99Ms(p95Ms, Number(e.target.value) || undefined),
                    )
                  }
                />
              </label>
              <label>
                Avg response (ms)
                <input
                  type="number"
                  min={50}
                  max={120000}
                  value={avgMs}
                  onChange={(e) => setAvgMs(Number(e.target.value) || 50)}
                />
              </label>
              <label>
                Avg TTFB (ms)
                <input
                  type="number"
                  min={10}
                  max={120000}
                  value={maxAvgLatencyMs}
                  onChange={(e) =>
                    setMaxAvgLatencyMs(Number(e.target.value) || 10)
                  }
                />
              </label>
              <label>
                Avg connect (ms)
                <input
                  type="number"
                  min={10}
                  max={120000}
                  value={maxAvgConnectMs}
                  onChange={(e) =>
                    setMaxAvgConnectMs(Number(e.target.value) || 10)
                  }
                />
              </label>
              <label className="swagger-check" style={{ justifyContent: 'flex-end' }}>
                <input
                  type="checkbox"
                  checked={requiresAuth}
                  onChange={(e) => setRequiresAuth(e.target.checked)}
                />
                Authorization required
              </label>
            </div>
          </fieldset>

          {requiresAuth ? (
            <fieldset className="swagger-inline-auth">
              <legend>User details / token</legend>
              <div className="swagger-docs-auth-modes">
                <button
                  type="button"
                  className={`creds-role-tab ${authMode === 'login' ? 'active' : ''}`}
                  onClick={() => setAuthMode('login')}
                >
                  Username / password
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
                  <p className="history-meta">
                    LGD default: <code>POST /auth/user-login</code> with{' '}
                    <code>mobileNumber</code> + <code>password</code>. Email/mobile
                    goes in Username. Send logs in first, then calls the scenario.
                  </p>
                  <div className="load-auth-grid-2">
                    <label>
                      Login path
                      <input
                        value={loginPath}
                        onChange={(e) => setLoginPath(e.target.value)}
                        placeholder="/auth/user-login"
                      />
                    </label>
                    <label>
                      Token JSON path
                      <input
                        value={tokenJsonPath}
                        onChange={(e) => setTokenJsonPath(e.target.value)}
                      />
                    </label>
                    <label>
                      Username field
                      <input
                        value={usernameField}
                        onChange={(e) => setUsernameField(e.target.value)}
                        placeholder="mobileNumber"
                      />
                    </label>
                    <label>
                      Password field
                      <input
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
                          value={c.label}
                          onChange={(e) =>
                            setCreds((list) =>
                              list.map((x) =>
                                x.id === c.id ? { ...x, label: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Username
                        <input
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
                    + Add user
                  </button>
                </>
              ) : (
                <label>
                  Bearer token
                  <input
                    type="password"
                    value={directToken}
                    onChange={(e) => setDirectToken(e.target.value)}
                    placeholder="Paste access token"
                  />
                </label>
              )}
            </fieldset>
          ) : null}

          <LoadScenarioEditor
            requests={requests}
            apiBaseUrl={apiBaseUrl}
            onChange={setRequests}
            auth={{
              requiresAuth,
              mode: authMode,
              directToken,
              credentials: creds,
              login: {
                loginPath: loginPath.trim() || '/auth/user-login',
                method: 'POST',
                usernameField: usernameField.trim() || 'mobileNumber',
                passwordField: passwordField.trim() || 'password',
                tokenJsonPath: tokenJsonPath.trim() || 'data.token',
                tokenHeader: 'Authorization',
                tokenPrefix: 'Bearer ',
                extraBody: { rememberMe: 'true' },
              },
              persistAuth,
            }}
            onLoadTest={
              onRunLoadTest ? () => void saveAndRunLoadTest() : undefined
            }
            loadTestBusy={saving || runningLoad}
          />

          {error ? <p className="error-text">{error}</p> : null}
          {savedMsg ? <p className="step-msg">{savedMsg}</p> : null}

          <div className="creds-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || runningLoad}
              onClick={() => void save()}
            >
              {saving && !runningLoad ? 'Saving…' : 'Save changes'}
            </button>
            {onRunLoadTest ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving || runningLoad}
                onClick={() => void saveAndRunLoadTest()}
                title="Save this case, then run a full load test with the Load settings above"
              >
                {runningLoad ? 'Starting load test…' : 'Save & run load test'}
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
