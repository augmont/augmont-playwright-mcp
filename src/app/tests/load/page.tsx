'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isWebLoadReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import type { WebLoadTestCase } from '@/lib/types';
import { WebLoadAiPanel } from '@/components/WebLoadAiPanel';
import { SwaggerLoadPicker } from '@/components/SwaggerLoadPicker';
import { SwaggerSuiteEditModal } from '@/components/SwaggerSuiteEditModal';

export default function LoadTestsPage() {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const testMode = useAppStore((s) => s.testMode);
  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const setTestMode = useAppStore((s) => s.setTestMode);
  const [cases, setCases] = useState<WebLoadTestCase[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editCase, setEditCase] = useState<WebLoadTestCase | null>(null);

  const ready = isWebLoadReady({ testMode, baseUrl });

  const reloadCases = useCallback(async () => {
    try {
      const res = await fetch('/api/tests?mode=web-load');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load cases');
      setCases((data.cases || []) as WebLoadTestCase[]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (testMode !== 'web-load' && baseUrl) {
      setTestMode('web-load');
      return;
    }
    if (!ready) {
      router.replace('/web-load');
    }
  }, [hydrated, ready, testMode, baseUrl, router, setTestMode]);

  useEffect(() => {
    if (!hydrated || !ready) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tests?mode=web-load');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load cases');
        if (!cancelled) {
          setCases((data.cases || []) as WebLoadTestCase[]);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load cases');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, ready]);

  if (!hydrated || !ready) {
    return (
      <main className="page">
        <p className="hero-sub">Loading…</p>
      </main>
    );
  }

  return (
    <main className="page load-run-fullscreen">
      <div className="flow-header-row">
        <div className="flow-header-copy">
          <h1 className="hero-title">Web load tests</h1>
      <p className="hero-sub flow-header-sub">
            Basic + advanced HTTP load via <strong>Apache JMeter CLI</strong> against{' '}
            <strong style={{ color: 'var(--accent)' }}>{baseUrl}</strong>
            {apiUrl ? (
              <>
                {' '}
                · API <strong style={{ color: 'var(--accent)' }}>{apiUrl}</strong>
              </>
            ) : null}
            . Import APIs from a <strong>Swagger / OpenAPI</strong> URL, pick endpoints one by
            one, set multi-user credentials when auth is required, then run load. Reports
            store metrics, selected APIs, and auth status (never passwords/tokens).
          </p>
        </div>
        <div className="load-header-actions">
          <SwaggerLoadPicker
            baseUrl={baseUrl}
            apiUrl={apiUrl}
            onSaved={() => void reloadCases()}
          />
          <WebLoadAiPanel baseUrl={baseUrl} apiUrl={apiUrl} onSaved={() => void reloadCases()} />
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="hero-sub">Loading scenarios…</p> : null}

      <div className="load-case-grid">
        {cases.map((c) => {
          const n = c.load.requests?.length || 1;
          const profile = c.load.profile || (n > 1 ? 'advanced' : 'basic');
          return (
            <article key={c.id} className="choice-card load-case-card">
              <span className="choice-card-eyebrow">
                {c.load.swaggerUrl ? 'Swagger suite' : profile} · {c.load.method} ·{' '}
                {c.load.virtualUsers} VUs · {c.load.durationSec}s
                {n > 1 ? ` · ${n} scenarios` : ''}
                {c.source === 'claude' ? ' · AI' : ''}
                {c.load.requiresAuth ? ' · Auth' : ''}
              </span>
              <h2>{c.name}</h2>
              <p>{c.description}</p>
              <p className="load-case-meta">
                {c.load.apiBaseUrl ? (
                  <>
                    API: <code>{c.load.apiBaseUrl}</code>
                    <br />
                  </>
                ) : null}
                {c.load.swaggerUrl ? (
                  <>
                    Swagger: <code>{c.load.swaggerUrl}</code>
                    <br />
                  </>
                ) : null}
                Target: <code>{c.load.targetUrl}</code>
                {c.load.useApiBase ? ' (API base)' : ''}
                {c.load.requiresAuth ? (
                  <>
                    <br />
                    🔒 Authorization required — use Edit to set users / token
                  </>
                ) : null}
                {n > 1 ? (
                  <>
                    <br />
                    Internal scenarios ({n}):{' '}
                    {(c.load.requests || []).slice(0, 8).map((r, i) => (
                      <span key={`${r.path}-${i}`}>
                        {i > 0 ? ' · ' : ''}
                        <code>
                          {r.method || c.load.method} {r.path}
                        </code>
                      </span>
                    ))}
                    {n > 8 ? ` · +${n - 8} more` : null}
                  </>
                ) : null}
                <br />
                Thresholds: err ≤ {c.load.maxErrorRatePct}% · p95 ≤ {c.load.p95Ms}
                ms · p99 ≤ {c.load.p99Ms ?? Math.round(c.load.p95Ms * 1.5)}ms
              </p>
              <div className="load-case-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setEditCase(c)}
                >
                  Edit
                </button>
                <Link href={`/tests/${encodeURIComponent(c.id)}`} className="choice-card-cta">
                  Open &amp; run →
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      <p className="hero-sub" style={{ marginTop: '1.5rem' }}>
        <Link href="/web-load">Change URLs</Link>
        {' · '}
        <Link href="/">Home</Link>
      </p>

      <SwaggerSuiteEditModal
        open={Boolean(editCase)}
        loadCase={editCase}
        onClose={() => setEditCase(null)}
        onSaved={(updated) => {
          setCases((list) => list.map((c) => (c.id === updated.id ? updated : c)));
          setEditCase(null);
        }}
        onRunLoadTest={(updated) => {
          setCases((list) => list.map((c) => (c.id === updated.id ? updated : c)));
          setEditCase(null);
          router.push(
            `/tests/${encodeURIComponent(updated.id)}?autostart=1`,
          );
        }}
      />
    </main>
  );
}
