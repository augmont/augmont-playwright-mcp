'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isVaptReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import type { VaptTestCase } from '@/lib/types';
import { countAttacks, vaptAttackLabel } from '@/lib/vapt-attacks';
import { VaptAiPanel } from '@/components/VaptAiPanel';

export default function VaptTestsPage() {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const testMode = useAppStore((s) => s.testMode);
  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const setTestMode = useAppStore((s) => s.setTestMode);
  const [cases, setCases] = useState<VaptTestCase[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const ready = isVaptReady({ testMode, baseUrl });

  const totals = useMemo(() => {
    const mainCases = cases.length;
    const internalScenarios = cases.reduce((n, c) => n + countAttacks(c.vapt.checks), 0);
    return { mainCases, internalScenarios };
  }, [cases]);

  const reloadCases = useCallback(async () => {
    try {
      const res = await fetch('/api/tests?mode=vapt');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load VAPT cases');
      setCases((data.cases || []) as VaptTestCase[]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load VAPT cases');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (testMode !== 'vapt' && baseUrl) {
      setTestMode('vapt');
      return;
    }
    if (!ready) {
      router.replace('/vapt');
    }
  }, [hydrated, ready, testMode, baseUrl, router, setTestMode]);

  useEffect(() => {
    if (!hydrated || !ready) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tests?mode=vapt');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load VAPT cases');
        if (!cancelled) {
          setCases((data.cases || []) as VaptTestCase[]);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load VAPT cases');
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
          <h1 className="hero-title">Login VAPT</h1>
          <p className="hero-sub flow-header-sub">
            Main case starts on <strong>/login</strong>. Attack types run as{' '}
            <strong>internal scenarios</strong> (safe posture probes). Portal{' '}
            <strong style={{ color: 'var(--accent)' }}>{baseUrl}</strong>
            {apiUrl ? (
              <>
                {' '}
                · API <strong style={{ color: 'var(--accent)' }}>{apiUrl}</strong>
              </>
            ) : null}
            .
          </p>
          <div className="vapt-attack-stats" aria-label="Suite inventory">
            <div className="vapt-attack-stat">
              <strong>{totals.mainCases}</strong>
              <span>main login case{totals.mainCases === 1 ? '' : 's'}</span>
            </div>
            <div className="vapt-attack-stat">
              <strong>{totals.internalScenarios}</strong>
              <span>internal scenarios</span>
            </div>
          </div>
        </div>
        <VaptAiPanel baseUrl={baseUrl} apiUrl={apiUrl} onSaved={() => void reloadCases()} />
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="hero-sub">Loading…</p> : null}

      <div className="load-case-grid">
        {cases.map((c) => {
          const n = countAttacks(c.vapt.checks);
          return (
            <article key={c.id} className="choice-card load-case-card vapt-main-case-card">
              <span className="choice-card-eyebrow">
                Main · login entry · {n} internal scenario{n === 1 ? '' : 's'} · gate{' '}
                {c.vapt.severityGate || 'high'}
                {c.source === 'claude' ? ' · AI' : ''}
              </span>
              <h2>{c.name}</h2>
              <p>{c.description}</p>
              <p className="load-case-meta">
                Start: <code>{c.vapt.startUrl || '/login'}</code>
                {' · '}
                API target: <code>{c.vapt.targetUrl}</code>
                {c.vapt.useApiBase ? ' (API base)' : ''}
                {c.estimatedMinutes ? ` · ~${c.estimatedMinutes} min` : ''}
              </p>
              <div className="vapt-internal-scenarios">
                <div className="load-metrics-section-label">Internal attack scenarios</div>
                <ol className="vapt-attack-list">
                  {c.vapt.checks.map((check, i) => (
                    <li key={check}>
                      <strong>
                        Scenario {i + 1}/{n}
                      </strong>{' '}
                      {vaptAttackLabel(check)}
                    </li>
                  ))}
                </ol>
              </div>
              <Link href={`/tests/${encodeURIComponent(c.id)}`} className="choice-card-cta">
                Open login suite →
              </Link>
            </article>
          );
        })}
      </div>

      <p className="hero-sub" style={{ marginTop: '1.5rem' }}>
        <Link href="/vapt">Change URLs</Link>
        {' · '}
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
