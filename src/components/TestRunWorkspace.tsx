'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { McpLiveView } from '@/components/McpLiveView';
import { TestOverviewPanel } from '@/components/TestOverviewPanel';
import { TestCaseDetailModal } from '@/components/TestCaseDetailModal';
import { ReportsDrawer } from '@/components/ReportsDrawer';
import { parseSignupIsoFromTestId } from '@/lib/test-registry';
import { isMobileReady, isWebReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import { getOrCreateWebSessionId } from '@/lib/web-session-id';
import { roleCredentialsForRun } from '@/lib/role-credentials';
import { OPENROUTER_AUTO } from '@/lib/openrouter-models';
import type { LocationCountry, RunSnapshot, WebTestCase } from '@/lib/types';
import {
  findExpectationSibling,
  resolveExpectation,
  type TestExpectation,
} from '@/lib/test-expectation';

type RunMode = 'all' | 'single';

export function TestRunWorkspace({
  testId,
  testName,
  initialIsoCode,
  showCountryPicker = true,
}: {
  testId: string;
  testName: string;
  initialIsoCode?: string;
  /** Signup & Login only — declarative web-flow suites skip country picker */
  showCountryPicker?: boolean;
}) {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const [autostart, setAutostart] = useState(false);
  const testMode = useAppStore((s) => s.testMode);
  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const mobilePlatform = useAppStore((s) => s.mobilePlatform);
  const appDriveUrl = useAppStore((s) => s.appDriveUrl);
  const appiumUrl = useAppStore((s) => s.appiumUrl);
  const osVersion = useAppStore((s) => s.osVersion);
  const deviceVersion = useAppStore((s) => s.deviceVersion);

  const [runId, setRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const eventSourceRef = useRef<EventSource | null>(null);

  const [countries, setCountries] = useState<LocationCountry[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [countriesError, setCountriesError] = useState('');
  const [mode, setMode] = useState<RunMode>(initialIsoCode ? 'single' : 'all');
  const [selectedIso, setSelectedIso] = useState(initialIsoCode || '');
  const [countryQuery, setCountryQuery] = useState('');
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportsRefresh, setReportsRefresh] = useState(0);
  const [canViewDetails, setCanViewDetails] = useState(false);
  const [viewCase, setViewCase] = useState<WebTestCase | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [loadedCase, setLoadedCase] = useState<WebTestCase | null>(null);
  const [siblingCase, setSiblingCase] = useState<WebTestCase | null>(null);
  const [runBranch, setRunBranch] = useState<TestExpectation>('positive');

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setAutostart(params.get('autostart') === '1');
    } catch {
      setAutostart(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCanViewDetails(false);
    setViewCase(null);
    setLoadedCase(null);
    setSiblingCase(null);
    fetch(`/api/tests/${encodeURIComponent(testId)}`)
      .then((r) => r.json())
      .then(async (data) => {
        if (cancelled) return;
        if (data?.case?.kind === 'web-flow') {
          setCanViewDetails(true);
          const current = data.case as WebTestCase;
          setLoadedCase(current);
          if (current.suiteMode === 'combined') {
            setRunBranch('positive');
            setSiblingCase(null);
          } else {
            setRunBranch(resolveExpectation(current));
          }
          const role = current.role || 'public';
          try {
            const listRes = await fetch(
              `/api/tests?mode=web&role=${encodeURIComponent(role)}`,
            );
            const listData = await listRes.json();
            if (cancelled) return;
            const metas = (listData.cases || []) as WebTestCase[];
            const sibMeta = findExpectationSibling(current, metas);
            if (sibMeta && current.suiteMode !== 'combined') {
              const sibRes = await fetch(
                `/api/tests/${encodeURIComponent(sibMeta.id)}`,
              );
              const sibData = await sibRes.json();
              if (!cancelled && sibData?.case) {
                setSiblingCase(sibData.case as WebTestCase);
              }
            }
          } catch {
            // ignore sibling lookup failures
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [testId]);

  async function openViewCase() {
    setViewLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tests/${encodeURIComponent(testId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load test case');
      setViewCase(data.case as WebTestCase);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test case');
    } finally {
      setViewLoading(false);
    }
  }

  const storeSlice = {
    testMode,
    baseUrl,
    apiUrl,
    mobilePlatform,
    appDriveUrl,
    appiumUrl,
    osVersion,
    deviceVersion,
  };
  const webReady = isWebReady(storeSlice);
  const mobileReady = isMobileReady(storeSlice);
  const isMobile = testMode === 'mobile' && mobileReady;

  useEffect(() => {
    if (!hydrated) return;
    if (webReady || mobileReady) return;

    if (testMode === 'mobile') {
      if (!mobilePlatform) router.replace('/mobile');
      else if (!appDriveUrl || !appiumUrl)
        router.replace(`/mobile/${mobilePlatform}/setup`);
      else if (!osVersion || !deviceVersion)
        router.replace(`/mobile/${mobilePlatform}`);
      else router.replace('/');
      return;
    }
    router.replace(baseUrl || apiUrl ? '/web' : '/');
  }, [
    hydrated,
    webReady,
    mobileReady,
    testMode,
    mobilePlatform,
    appDriveUrl,
    appiumUrl,
    osVersion,
    deviceVersion,
    baseUrl,
    apiUrl,
    router,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    if (!showCountryPicker) {
      setCountriesLoading(false);
      setCountriesError('');
      return;
    }
    if (!apiUrl) return;
    let cancelled = false;
    (async () => {
      setCountriesLoading(true);
      setCountriesError('');
      try {
        const res = await fetch(`/api/countries?apiUrl=${encodeURIComponent(apiUrl)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load countries');
        const list = (data.countries || []) as LocationCountry[];
        if (!cancelled) {
          setCountries(list);
          if (initialIsoCode && list.some((c) => c.isoCode === initialIsoCode)) {
            setSelectedIso(initialIsoCode);
            setMode('single');
          } else if (!selectedIso && list[0]) {
            setSelectedIso(list[0].isoCode);
          }
        }
      } catch (err) {
        if (!cancelled) {
          // Mobile can still launch the emulator without the location API
          if (testMode === 'mobile') {
            const fallback: LocationCountry = {
              id: 'in',
              name: 'India',
              countryCode: '91',
              isoCode: 'IN',
            };
            setCountries([fallback]);
            setSelectedIso('IN');
            setMode('single');
            setCountriesError(
              `${err instanceof Error ? err.message : 'Location API unavailable'} — using India fallback for mobile launch.`,
            );
          } else {
            setCountriesError(err instanceof Error ? err.message : 'Failed to load countries');
          }
        }
      } finally {
        if (!cancelled) setCountriesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, initialIsoCode, hydrated, testMode, showCountryPicker]);

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.isoCode.toLowerCase().includes(q) ||
        c.countryCode.includes(q),
    );
  }, [countries, countryQuery]);

  const attachEvents = useCallback((id: string) => {
    eventSourceRef.current?.close();
    const es = new EventSource(`/api/runs/${id}/events`);
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RunSnapshot;
        setSnapshot(data);
        if (
          data.status === 'completed' ||
          data.status === 'failed' ||
          data.status === 'stopped'
        ) {
          setReportsRefresh((n) => n + 1);
        }
      } catch {
        // ignore
      }
    };
    es.addEventListener('end', () => {
      es.close();
    });
  }, []);

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  function openReports() {
    setReportsRefresh((n) => n + 1);
    setReportsOpen(true);
  }

  async function startRun() {
    if (showCountryPicker) {
      if (!apiUrl) return;
      if (mode === 'single' && !selectedIso) {
        setError('Select a country to run.');
        return;
      }
    }

    setStarting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {};
      if (apiUrl) body.apiUrl = apiUrl;
      if (showCountryPicker && mode === 'single') body.isoCode = selectedIso;

      if (isMobile) {
        body.mode = 'mobile';
        body.platform = mobilePlatform!;
        body.osVersion = osVersion;
        body.deviceVersion = deviceVersion;
        body.appDriveUrl = appDriveUrl;
        body.appiumUrl = appiumUrl;
      } else {
        if (!baseUrl) return;
        body.mode = 'web';
        body.baseUrl = baseUrl;
        body.webSessionId = getOrCreateWebSessionId();
        const roleCredentials = roleCredentialsForRun();
        if (Object.keys(roleCredentials).length) {
          body.roleCredentials = roleCredentials;
        }
        if (loadedCase?.kind === 'web-flow') {
          body.branch = runBranch;
          body.expectation = runBranch;
        }
      }

      const res = await fetch(`/api/tests/${encodeURIComponent(testId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start run');
      setRunId(data.runId);
      setSnapshot(data.snapshot);
      attachEvents(data.runId);
      if (autostart) {
        router.replace(`/tests/${encodeURIComponent(testId)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setStarting(false);
    }
  }

  const autostartedRef = useRef(false);
  useEffect(() => {
    if (!autostart || !hydrated || autostartedRef.current) return;
    if (!(webReady || mobileReady)) return;
    if (showCountryPicker) {
      if (countriesLoading || countriesError) return;
      if (mode === 'single' && !selectedIso) return;
      if (!countries.length && !countriesError) return;
    } else if (!baseUrl) {
      return;
    }
    autostartedRef.current = true;
    void startRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot autostart from ?autostart=1
  }, [
    autostart,
    hydrated,
    webReady,
    mobileReady,
    showCountryPicker,
    countriesLoading,
    countriesError,
    mode,
    selectedIso,
    countries.length,
    baseUrl,
  ]);

  async function stopRun() {
    if (!runId) return;
    await fetch(`/api/runs/${runId}/stop`, { method: 'POST' });
  }

  const active =
    starting ||
    snapshot?.status === 'starting' ||
    snapshot?.status === 'running';

  const runLabel =
    mode === 'all'
      ? `All countries (${countries.length})`
      : selectedIso
        ? countries.find((c) => c.isoCode === selectedIso)?.name || selectedIso
        : 'Select country';

  if (!hydrated || (!webReady && !mobileReady)) return null;

  const targetLabel = isMobile
    ? `${mobilePlatform === 'android' ? 'Android' : 'iOS'} ${osVersion} · ${deviceVersion} · ${appiumUrl}`
    : baseUrl;

  return (
    <div className="page page-wide workspace-shell">
      {error ? (
        <p className="error-text" style={{ padding: '0.75rem 1.25rem', margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div className="split-layout">
        <TestOverviewPanel
          title={loadedCase?.name || testName}
          snapshot={snapshot}
          starting={starting}
          onStart={startRun}
          onStop={stopRun}
          onOpenReports={openReports}
          onViewTestCase={canViewDetails ? () => void openViewCase() : undefined}
          viewLoading={viewLoading}
          targetLabel={targetLabel}
          runBranch={runBranch}
          previewCase={loadedCase}
          onToggleRunBranch={
            loadedCase &&
            loadedCase.kind === 'web-flow' &&
            (loadedCase.suiteMode === 'combined' ||
              !!loadedCase.negativeSteps?.length ||
              !!siblingCase)
              ? () => {
                  const next = runBranch === 'positive' ? 'negative' : 'positive';
                  if (loadedCase.suiteMode === 'combined' || loadedCase.negativeSteps) {
                    setRunBranch(next);
                    return;
                  }
                  if (next === 'positive') {
                    const pos =
                      resolveExpectation(loadedCase) === 'positive'
                        ? loadedCase
                        : siblingCase;
                    if (pos) {
                      router.push(
                        `/tests/${encodeURIComponent(pos.id)}?autostart=0`,
                      );
                    }
                  } else {
                    const neg =
                      resolveExpectation(loadedCase) === 'negative'
                        ? loadedCase
                        : siblingCase;
                    if (neg) {
                      router.push(
                        `/tests/${encodeURIComponent(neg.id)}?autostart=0`,
                      );
                    }
                  }
                }
              : undefined
          }
          runDisabled={
            showCountryPicker
              ? countriesLoading ||
                (testMode !== 'mobile' && !!countriesError) ||
                (mode === 'single' && !selectedIso) ||
                countries.length === 0
              : !baseUrl
          }
          countryControls={
            <>
              {showCountryPicker ? (
              <div className="country-controls">
                <h3 className="country-report-title">Run scope</h3>
                {countriesLoading ? (
                  <p className="step-msg">Loading countries from location API…</p>
                ) : null}
                {countriesError ? <p className="error-text">{countriesError}</p> : null}

                {!countriesLoading && !countriesError ? (
                  <>
                    <div className="mode-toggle">
                      <button
                        type="button"
                        className={`mode-btn ${mode === 'all' ? 'active' : ''}`}
                        disabled={active}
                        onClick={() => setMode('all')}
                      >
                        All countries
                      </button>
                      <button
                        type="button"
                        className={`mode-btn ${mode === 'single' ? 'active' : ''}`}
                        disabled={active}
                        onClick={() => setMode('single')}
                      >
                        Single country
                      </button>
                    </div>
                    <p className="step-msg" style={{ marginBottom: '0.5rem' }}>
                      Will run: <strong style={{ color: 'var(--text)' }}>{runLabel}</strong>
                    </p>
                    {mode === 'single' ? (
                      <>
                        <input
                          className="search-input"
                          type="search"
                          placeholder="Search country…"
                          value={countryQuery}
                          disabled={active}
                          onChange={(e) => setCountryQuery(e.target.value)}
                          style={{ width: '100%', marginBottom: '0.5rem' }}
                        />
                        <select
                          className="country-select"
                          value={selectedIso}
                          disabled={active}
                          onChange={(e) => setSelectedIso(e.target.value)}
                        >
                          {filteredCountries.map((c) => (
                            <option key={c.isoCode} value={c.isoCode}>
                              {c.name} ({c.isoCode}) · +{c.countryCode}
                            </option>
                          ))}
                        </select>
                        {!filteredCountries.length ? (
                          <p className="step-msg">No countries match the search.</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="step-msg">
                        {countries.length} countries from location API will run sequentially.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="country-controls">
                <h3 className="country-report-title">Flow</h3>
                <p className="step-msg">
                  Against <strong style={{ color: 'var(--text)' }}>{baseUrl}</strong>
                  {loadedCase?.suiteMode === 'combined'
                    ? ` · ${runBranch === 'negative' ? 'Error path (Negative)' : 'Happy path (Positive)'}`
                    : ''}
                  . Buyer auth signups once per browser tab.
                </p>
              </div>
            )}
            </>
          }
        />
        {isMobile ? (
          <section className="mcp-panel mobile-live-placeholder">
            <div className="mcp-toolbar">
              <span>Appium live view</span>
              <span className="status-badge status-idle">
                {active ? 'running' : 'idle'}
              </span>
            </div>
            <div className="mobile-live-inner">
              <p className="mobile-live-eyebrow">
                {mobilePlatform === 'android' ? 'Android' : 'iOS'} · {osVersion} ·{' '}
                {deviceVersion}
              </p>
              <h2>{active ? 'Emulator / Appium session' : 'Ready to start'}</h2>
              <p>
                Press <strong>Start test</strong> to download the Drive APK, boot the Android
                emulator, install the app, and open it.
                <br />
                Appium: <span>{appiumUrl}</span>
                <br />
                App: <span>{appDriveUrl}</span>
              </p>
            </div>
          </section>
        ) : (
          <McpLiveView runId={runId} active={!!active || !!runId} />
        )}
      </div>

      <ReportsDrawer
        open={reportsOpen}
        onClose={() => setReportsOpen(false)}
        refreshToken={reportsRefresh}
      />

      <TestCaseDetailModal
        open={!!viewCase}
        test={viewCase}
        suiteCases={[loadedCase, siblingCase].filter(Boolean) as WebTestCase[]}
        baseUrl={baseUrl}
        apiUrl={apiUrl}
        flowRole={
          viewCase?.role === 'buyer' ||
          viewCase?.role === 'admin' ||
          viewCase?.role === 'seller' ||
          viewCase?.role === 'public'
            ? viewCase.role
            : undefined
        }
        model={OPENROUTER_AUTO}
        onClose={() => setViewCase(null)}
        onCaseUpdated={(next) => setViewCase(next)}
        onSavedReplace={async (next) => {
          try {
            const res = await fetch('/api/tests/apply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cases: [next], source: 'claude' }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            setViewCase(next);
            setError('');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
          }
        }}
      />
    </div>
  );
}

export function initialIsoFromTestId(testId: string): string | undefined {
  return parseSignupIsoFromTestId(testId);
}
