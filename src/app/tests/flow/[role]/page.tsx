'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FlowTestCaseBrowser } from '@/components/FlowTestCaseBrowser';
import { WebAiPanel } from '@/components/WebAiPanel';
import { isWebReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import type { TestCaseMeta } from '@/lib/types';
import { getWebFlow, isWebFlowId } from '@/lib/web-flows';

export default function WebFlowTestsPage() {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const params = useParams<{ role: string }>();
  const roleParam = params?.role || '';
  const flow = isWebFlowId(roleParam) ? getWebFlow(roleParam) : undefined;

  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const testMode = useAppStore((s) => s.testMode);
  const webReady = isWebReady({ testMode, baseUrl, apiUrl });

  const [cases, setCases] = useState<TestCaseMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!flow) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tests?mode=web&role=${encodeURIComponent(flow.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load tests');
      setCases((data.cases || []) as TestCaseMeta[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tests');
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, [flow]);

  useEffect(() => {
    if (!hydrated) return;
    if (!webReady) {
      router.replace(baseUrl || apiUrl ? '/web' : '/');
      return;
    }
    if (!flow) {
      router.replace('/tests');
      return;
    }
    void refresh();
  }, [hydrated, webReady, flow, baseUrl, apiUrl, router, refresh]);

  if (!hydrated || !flow) {
    return (
      <main className="page">
        <p className="hero-sub">Loading…</p>
      </main>
    );
  }

  return (
    <main className="page">
      <p className="flow-back">
        <Link href="/tests">← All web flows</Link>
      </p>

      <div className="flow-header-row">
        <div className="flow-header-copy">
          <h1 className="hero-title">{flow.name}</h1>
          <p className="hero-sub flow-header-sub">
            {flow.description} Portal:{' '}
            <strong style={{ color: 'var(--accent)' }}>{baseUrl}</strong>
            {flow.id === 'buyer' || flow.id === 'admin' || flow.id === 'seller' ? (
              <>
                {' '}
                · Use header <strong>Set credentials</strong> for {flow.id} login (tab-only)
              </>
            ) : null}
          </p>
        </div>

        <WebAiPanel
          layout="header"
          baseUrl={baseUrl}
          apiUrl={apiUrl}
          flowRole={flow.id}
          onApplied={() => {
            void refresh();
          }}
        />
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="hero-sub">Loading test cases…</p> : null}

      {!loading && cases.length ? (
        <FlowTestCaseBrowser
          cases={cases}
          showProductFilters={flow.id === 'buyer'}
          onDeleted={() => {
            void refresh();
          }}
        />
      ) : null}

      {!loading && !cases.length ? (
        <p className="hero-sub">
          No test cases in this flow yet. Use <strong>AI Generate</strong>,{' '}
          <strong>Upload test</strong>, or <strong>MCP click flow</strong> above
          — new cases always include both <strong>Positive</strong> and{' '}
          <strong>Negative</strong> tabs.
        </p>
      ) : null}
    </main>
  );
}
