'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { LoadAuthCredential, SwaggerOperation, WebLoadTestCase, WebLoadRequestStep } from '@/lib/types';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { LoadAuthFileImport } from '@/components/LoadAuthFileImport';
import {
  paramDefsFromPathAndSwagger,
  seedParamValues,
} from '@/lib/load-request-params';
import { parseImportJson } from '@/lib/parse-import';

type ImportSourceTab =
  | 'swagger'
  | 'postman-file'
  | 'postman-link'
  | 'har'
  | 'curl'
  | 'website'
  | 'raw-json';

const IMPORT_TABS: { id: ImportSourceTab; label: string; icon: string; desc: string }[] = [
  { id: 'swagger', label: 'Swagger / OpenAPI', icon: '📘', desc: 'Fetch from live URL' },
  { id: 'postman-file', label: 'Postman Collection', icon: '📦', desc: 'Upload JSON file' },
  { id: 'postman-link', label: 'Postman Link', icon: '🔗', desc: 'Share link or API URL' },
  { id: 'har', label: 'HAR File', icon: '🌐', desc: 'Browser network export' },
  { id: 'curl', label: 'cURL', icon: '⌨️', desc: 'Paste cURL command' },
  { id: 'website', label: 'Website Crawl', icon: '🕷️', desc: 'Discover APIs from live page' },
  { id: 'raw-json', label: 'Raw JSON', icon: '{ }', desc: 'Paste scenario JSON' },
];

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

  // ─── Multi-source import state ───
  const [importTab, setImportTab] = useState<ImportSourceTab>('swagger');
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSteps, setImportSteps] = useState<WebLoadRequestStep[]>([]);
  const [importLabel, setImportLabel] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [postmanLinkUrl, setPostmanLinkUrl] = useState('');
  const [curlText, setCurlText] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);

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

  // ─── Multi-source import handlers ───

  async function handleFileImport(file: File) {
    setImportBusy(true);
    setError('');
    setImportSteps([]);
    setImportWarnings([]);
    try {
      const text = await file.text();
      const result = parseImportJson(text, { apiBaseUrl: apiUrl });
      setImportSteps(result.steps);
      setImportLabel(result.label);
      setImportWarnings(result.warnings);
      if (result.apiBaseUrl && !apiUrl) setApiUrl(result.apiBaseUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setImportBusy(false);
    }
  }

  async function handleTextImport(text: string) {
    setImportBusy(true);
    setError('');
    setImportSteps([]);
    setImportWarnings([]);
    try {
      const result = parseImportJson(text, { apiBaseUrl: apiUrl });
      setImportSteps(result.steps);
      setImportLabel(result.label);
      setImportWarnings(result.warnings);
      if (result.apiBaseUrl && !apiUrl) setApiUrl(result.apiBaseUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setImportBusy(false);
    }
  }

  function parseCurlToStep(curl: string): WebLoadRequestStep | null {
    const trimmed = curl.trim().replace(/\\\n/g, ' ').replace(/\\\r\n/g, ' ');
    const urlMatch = trimmed.match(/curl\s+(?:--[a-z-]+\s+)*['"]?(https?:\/\/[^\s'"]+)['"]?/i)
      || trimmed.match(/['"]?(https?:\/\/[^\s'"]+)['"]?/);
    if (!urlMatch) return null;
    const url = urlMatch[1];
    const headers: Record<string, string> = {};
    const hMatches = [...trimmed.matchAll(/-H\s+['"]([^'"]+)['"]/gi)];
    for (const m of hMatches) {
      const [key, ...rest] = m[1].split(':');
      if (key && rest.length) headers[key.trim()] = rest.join(':').trim();
    }
    let method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' = 'GET';
    const mMatch = trimmed.match(/-X\s+(\w+)/i);
    if (mMatch) method = mMatch[1].toUpperCase() as typeof method;
    let body: string | undefined;
    const bMatch = trimmed.match(/(?:-d|--data|--data-raw|--data-binary)\s+['"](.+?)['"]/s);
    if (bMatch) {
      body = bMatch[1];
      if (!mMatch) method = 'POST';
    }
    const parsed = new URL(url);
    return {
      name: `${method} ${parsed.pathname}`,
      path: parsed.pathname + parsed.search,
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body || undefined,
      useApiBase: false,
    };
  }

  async function handleCurlImport() {
    setImportBusy(true);
    setError('');
    setImportSteps([]);
    try {
      const lines = curlText.split(/\n(?=curl\s)/i).filter(Boolean);
      const steps: WebLoadRequestStep[] = [];
      for (const line of lines) {
        const step = parseCurlToStep(line);
        if (step) steps.push(step);
      }
      if (!steps.length) throw new Error('Could not parse any cURL commands. Ensure valid cURL format.');
      setImportSteps(steps);
      setImportLabel(`cURL import (${steps.length} request${steps.length > 1 ? 's' : ''})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'cURL parse failed');
    } finally {
      setImportBusy(false);
    }
  }

  async function handlePostmanLink() {
    setImportBusy(true);
    setError('');
    setImportSteps([]);
    try {
      let url = postmanLinkUrl.trim();
      if (url.includes('postman.com') && !url.includes('/collection/')) {
        throw new Error('Enter a Postman Collection share link (e.g. https://www.postman.com/collections/...)');
      }
      if (url.includes('postman.com') && url.includes('/collection/')) {
        const idMatch = url.match(/\/collection\/([a-zA-Z0-9-]+)/);
        if (idMatch) url = `https://www.postman.com/collections/${idMatch[1]}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch Postman collection (${res.status})`);
      const text = await res.text();
      const result = parseImportJson(text, { apiBaseUrl: apiUrl });
      setImportSteps(result.steps);
      setImportLabel(result.label);
      setImportWarnings(result.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch Postman link');
    } finally {
      setImportBusy(false);
    }
  }

  async function handleWebsiteCrawl() {
    setImportBusy(true);
    setError('');
    setImportSteps([]);
    try {
      const url = websiteUrl.trim();
      if (!url) throw new Error('Enter a website URL');
      const res = await fetch('/api/tests/load/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Crawl failed (${res.status})`);
      }
      const data = await res.json();
      const steps = (data as { steps?: WebLoadRequestStep[] }).steps || [];
      if (!steps.length) throw new Error('No API endpoints discovered on this page. Try a page with API calls.');
      setImportSteps(steps);
      setImportLabel(`Website crawl (${steps.length} API${steps.length > 1 ? 's' : ''})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Crawl failed');
    } finally {
      setImportBusy(false);
    }
  }

  async function saveImportedSteps() {
    if (!importSteps.length) return;
    setSaving(true);
    setError('');
    try {
      const label = importLabel || `Imported (${importSteps.length} scenarios)`;
      const first = importSteps[0];
      const cases: WebLoadTestCase[] = [{
        id: `import-${Date.now()}`,
        name: label.slice(0, 120),
        description: `Imported ${importSteps.length} API scenario(s) via ${importTab}.`,
        tags: ['web-load', 'import', importTab],
        estimatedMinutes: Math.max(2, Math.ceil(importSteps.length / 20)),
        kind: 'web-load',
        source: 'upload',
        load: {
          targetUrl: first.path,
          method: first.method,
          useApiBase: first.useApiBase ?? true,
          headers: first.headers || { Accept: 'application/json' },
          body: first.body,
          virtualUsers: AUTO_VUS,
          durationSec: AUTO_DURATION_SEC,
          rampUpSec: AUTO_RAMP_SEC,
          maxErrorRatePct: 10,
          p95Ms: 4000,
          p99Ms: 6000,
          profile: importSteps.length > 1 ? 'advanced' : 'basic',
          requests: importSteps.length > 1 ? importSteps : undefined,
        },
      }];
      const res = await fetch('/api/tests/load/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases, source: 'upload' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to save cases');
      onSaved();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
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
                  <h2>Import API Scenarios</h2>
                  <p className="history-meta">
                    Import from multiple sources — APIs become <strong>internal scenarios</strong> inside a load case (auto{' '}
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

              {/* ─── Import Source Tabs ─── */}
              <div className="import-source-tabs-bar">
                {IMPORT_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`import-source-tab ${importTab === t.id ? 'active' : ''}`}
                    onClick={() => {
                      setImportTab(t.id);
                      setError('');
                      setImportSteps([]);
                      setImportWarnings([]);
                    }}
                    title={t.desc}
                  >
                    <span className="import-source-tab-icon">{t.icon}</span>
                    <span className="import-source-tab-label">{t.label}</span>
                  </button>
                ))}
              </div>

              <div className="report-modal-body swagger-picker-body">

                {/* ─── TAB: Swagger / OpenAPI ─── */}
                {importTab === 'swagger' && (
                  <>
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

                {/* Swagger actions */}
                {importTab === 'swagger' && (
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
                          ? `Import ${selectedOps.length} scenario${selectedOps.length === 1 ? '' : 's'}`
                          : 'Import scenarios'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={closePicker}>
                      Cancel
                    </button>
                  </div>
                )}
                  </>
                )}

                {/* ─── TAB: Postman Collection File ─── */}
                {importTab === 'postman-file' && (
                  <div className="import-tab-content">
                    <h3 className="import-tab-title">📦 Upload Postman Collection</h3>
                    <p className="history-meta">Upload a Postman Collection v2.0 / v2.1 JSON file exported from Postman.</p>
                    <div
                      className="import-file-drop-zone"
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files[0];
                        if (file) { setImportFile(file); void handleFileImport(file); }
                      }}
                      onClick={() => importFileRef.current?.click()}
                    >
                      <input
                        ref={importFileRef}
                        type="file"
                        accept=".json,.har"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) { setImportFile(file); void handleFileImport(file); }
                        }}
                      />
                      <span className="import-file-drop-icon">📁</span>
                      <span className="import-file-drop-text">
                        {importFile ? importFile.name : 'Drop Postman JSON or click to choose'}
                      </span>
                      <span className="import-file-drop-hint">.json</span>
                    </div>
                  </div>
                )}

                {/* ─── TAB: Postman Link ─── */}
                {importTab === 'postman-link' && (
                  <div className="import-tab-content">
                    <h3 className="import-tab-title">🔗 Postman Share Link</h3>
                    <p className="history-meta">Paste a Postman collection share URL or public API link.</p>
                    <div className="swagger-url-row">
                      <label htmlFor="postmanLinkInput">
                        Postman Collection URL
                        <input
                          id="postmanLinkInput"
                          className="url-input"
                          type="url"
                          placeholder="https://www.postman.com/collections/abc123..."
                          value={postmanLinkUrl}
                          onChange={(e) => setPostmanLinkUrl(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={importBusy || !postmanLinkUrl.trim()}
                        onClick={() => void handlePostmanLink()}
                      >
                        {importBusy ? 'Fetching…' : 'Fetch Collection'}
                      </button>
                    </div>
                    <p className="history-meta" style={{ marginTop: '0.5rem' }}>
                      Supports: Postman share links, public workspace URLs, raw JSON URLs
                    </p>
                  </div>
                )}

                {/* ─── TAB: HAR File ─── */}
                {importTab === 'har' && (
                  <div className="import-tab-content">
                    <h3 className="import-tab-title">🌐 HAR File Import</h3>
                    <p className="history-meta">
                      Upload a HAR (HTTP Archive) file exported from browser DevTools (Network → Export HAR).
                    </p>
                    <div
                      className="import-file-drop-zone"
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files[0];
                        if (file) { setImportFile(file); void handleFileImport(file); }
                      }}
                      onClick={() => importFileRef.current?.click()}
                    >
                      <input
                        ref={importFileRef}
                        type="file"
                        accept=".har,.json"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) { setImportFile(file); void handleFileImport(file); }
                        }}
                      />
                      <span className="import-file-drop-icon">📁</span>
                      <span className="import-file-drop-text">
                        {importFile ? importFile.name : 'Drop HAR file or click to choose'}
                      </span>
                      <span className="import-file-drop-hint">.har · .json</span>
                    </div>
                    <div className="import-har-help">
                      <strong>How to export HAR:</strong> Chrome DevTools → Network tab → right-click → "Save all as HAR"
                    </div>
                  </div>
                )}

                {/* ─── TAB: cURL ─── */}
                {importTab === 'curl' && (
                  <div className="import-tab-content">
                    <h3 className="import-tab-title">⌨️ cURL Import</h3>
                    <p className="history-meta">
                      Paste one or more cURL commands. Supports multiple commands separated by newlines.
                    </p>
                    <textarea
                      className="import-curl-textarea"
                      rows={8}
                      placeholder={`curl -X POST 'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name": "test"}'`}
                      value={curlText}
                      onChange={(e) => setCurlText(e.target.value)}
                    />
                    <div className="import-tab-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={importBusy || !curlText.trim()}
                        onClick={() => void handleCurlImport()}
                      >
                        {importBusy ? 'Parsing…' : 'Parse cURL'}
                      </button>
                      <span className="history-meta">
                        Tip: right-click request in DevTools → "Copy as cURL"
                      </span>
                    </div>
                  </div>
                )}

                {/* ─── TAB: Website Crawl ─── */}
                {importTab === 'website' && (
                  <div className="import-tab-content">
                    <h3 className="import-tab-title">🕷️ Website API Crawler</h3>
                    <p className="history-meta">
                      Enter a live website URL — we'll analyze the page and discover API endpoints from its network calls, scripts, and HTML.
                    </p>
                    <div className="swagger-url-row">
                      <label htmlFor="websiteUrlInput">
                        Website URL
                        <input
                          id="websiteUrlInput"
                          className="url-input"
                          type="url"
                          placeholder="https://example.com/dashboard"
                          value={websiteUrl}
                          onChange={(e) => setWebsiteUrl(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={importBusy || !websiteUrl.trim()}
                        onClick={() => void handleWebsiteCrawl()}
                      >
                        {importBusy ? 'Crawling…' : 'Discover APIs'}
                      </button>
                    </div>
                    <p className="history-meta" style={{ marginTop: '0.5rem' }}>
                      Works best on SPAs and pages that make XHR/fetch calls. Detects REST endpoints, GraphQL, and form submissions.
                    </p>
                  </div>
                )}

                {/* ─── TAB: Raw JSON ─── */}
                {importTab === 'raw-json' && (
                  <div className="import-tab-content">
                    <h3 className="import-tab-title">{'{ }'} Raw JSON Import</h3>
                    <p className="history-meta">
                      Paste raw JSON — supports Swagger/OpenAPI spec, Postman Collection, HAR, or a plain array of scenario objects.
                    </p>
                    <textarea
                      className="import-curl-textarea"
                      rows={10}
                      placeholder='Paste Swagger spec, Postman collection, HAR, or JSON array...'
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                    />
                    <div className="import-tab-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={importBusy || !importText.trim()}
                        onClick={() => void handleTextImport(importText)}
                      >
                        {importBusy ? 'Parsing…' : 'Parse & Import'}
                      </button>
                      <span className="history-meta">Auto-detects format</span>
                    </div>
                  </div>
                )}

                {/* ─── Imported Steps Preview (non-swagger tabs) ─── */}
                {importTab !== 'swagger' && importSteps.length > 0 && (
                  <div className="import-steps-preview">
                    <p className="step-msg">
                      <strong>{importLabel}</strong> · {importSteps.length} scenario{importSteps.length > 1 ? 's' : ''} detected
                    </p>
                    {importWarnings.length > 0 && (
                      <div className="import-warnings">
                        {importWarnings.map((w, i) => (
                          <p key={i} className="import-warning-item">⚠️ {w}</p>
                        ))}
                      </div>
                    )}
                    <ul className="swagger-op-list">
                      {importSteps.map((step, i) => (
                        <li key={i}>
                          <div className="swagger-op-row selected">
                            <span className={`swagger-method method-${step.method.toLowerCase()}`}>
                              {step.method}
                            </span>
                            <span className="swagger-path">
                              <code>{step.path}</code>
                              {step.name && step.name !== `${step.method} ${step.path}` ? (
                                <span className="swagger-summary">{step.name}</span>
                              ) : null}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ─── Non-swagger save ─── */}
                {importTab !== 'swagger' && (
                  <div className="creds-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={saving || !importSteps.length}
                      onClick={() => void saveImportedSteps()}
                    >
                      {saving
                        ? 'Saving…'
                        : importSteps.length
                          ? `Import ${importSteps.length} scenario${importSteps.length > 1 ? 's' : ''}`
                          : 'Import scenarios'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={closePicker}>
                      Cancel
                    </button>
                  </div>
                )}

                {error ? (
                  <p className="error-text" style={{ whiteSpace: 'pre-wrap' }}>
                    {error}
                  </p>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={openPicker}>
        Import APIs
      </button>
      {modal}
    </>
  );
}
