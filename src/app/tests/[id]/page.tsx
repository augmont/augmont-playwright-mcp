'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TestRunWorkspace } from '@/components/TestRunWorkspace';
import { MobileTestWorkspace } from '@/components/MobileTestWorkspace';
import { LoadTestWorkspace } from '@/components/LoadTestWorkspace';
import { VaptTestWorkspace } from '@/components/VaptTestWorkspace';
import {
  getTestCase,
  isCountryScopedWebTest,
  isMobileTestId,
  isSignupLoginTestId,
  parseSignupIsoFromTestId,
  resolveTestCase,
} from '@/lib/test-registry';
import {
  isMobileReady,
  isWebLoadReady,
  isVaptReady,
  isWebReady,
  useAppStore,
} from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import type { LocationCountry, TestCaseMeta } from '@/lib/types';

export default function TestDetailPage() {
  const hydrated = useStoreHydrated();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const testMode = useAppStore((s) => s.testMode);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const baseUrl = useAppStore((s) => s.baseUrl);
  const mobilePlatform = useAppStore((s) => s.mobilePlatform);
  const appDriveUrl = useAppStore((s) => s.appDriveUrl);
  const appiumUrl = useAppStore((s) => s.appiumUrl);
  const osVersion = useAppStore((s) => s.osVersion);
  const deviceVersion = useAppStore((s) => s.deviceVersion);
  const [test, setTest] = useState<TestCaseMeta | null>(null);
  const [error, setError] = useState('');

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
  const webLoadReady = isWebLoadReady(storeSlice);
  const vaptReady = isVaptReady(storeSlice);
  const mobileReady = isMobileReady(storeSlice);

  useEffect(() => {
    if (!hydrated || !id) return;

    if (isMobileTestId(id)) {
      if (!mobileReady) {
        if (!mobilePlatform) router.replace('/mobile');
        else if (!appDriveUrl || !appiumUrl)
          router.replace(`/mobile/${mobilePlatform}/setup`);
        else if (!osVersion || !deviceVersion)
          router.replace(`/mobile/${mobilePlatform}`);
        else router.replace('/');
        return;
      }
      const mobile = getTestCase(id);
      if (!mobile) setError('Unknown mobile test case.');
      else setTest(mobile);
      return;
    }

    let cancelled = false;

    (async () => {
      // Resolve case first — load tests don't require webReady (only baseUrl)
      try {
        const res = await fetch(`/api/tests/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (res.ok && data?.case) {
          const c = data.case as TestCaseMeta;
          if (c.kind === 'vapt') {
            if (!vaptReady && !baseUrl) {
              router.replace('/vapt');
              return;
            }
            if (!cancelled) setTest(c);
            return;
          }
          if (c.kind === 'web-load') {
            if (!webLoadReady && !baseUrl) {
              router.replace('/web-load');
              return;
            }
            if (!cancelled) setTest(c);
            return;
          }
          if (!webReady && !mobileReady) {
            if (testMode === 'mobile') router.replace('/mobile');
            else if (testMode === 'vapt') router.replace('/vapt');
            else if (testMode === 'web-load') router.replace('/web-load');
            else if (testMode === 'web' || baseUrl || apiUrl) router.replace('/web');
            else router.replace('/');
            return;
          }
        }
      } catch {
        // fall through to other resolvers
      }

      if (!webReady && !mobileReady && !webLoadReady && !vaptReady) {
        if (testMode === 'mobile') {
          router.replace('/mobile');
        } else if (testMode === 'vapt') {
          router.replace('/vapt');
        } else if (testMode === 'web-load') {
          router.replace('/web-load');
        } else if (testMode === 'web' || baseUrl || apiUrl) {
          router.replace('/web');
        } else {
          router.replace('/');
        }
        return;
      }

      if (isSignupLoginTestId(id)) {
        try {
          const res = await fetch(`/api/countries?apiUrl=${encodeURIComponent(apiUrl)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to load countries');
          const countries = (data.countries || []) as LocationCountry[];
          const resolved = resolveTestCase(id, countries) || getTestCase(id);
          if (!resolved) {
            if (!cancelled) setError('Test case not found.');
            return;
          }
          if (!cancelled) setTest({ ...resolved, name: 'Signup & Login' });
        } catch (err) {
          const fallback = getTestCase(id);
          if (fallback && !cancelled) {
            setTest({ ...fallback, name: 'Signup & Login' });
          } else if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Failed to resolve test');
          }
        }
        return;
      }

      try {
        const res = await fetch(`/api/tests/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Test case not found');
        if (!cancelled) setTest(data.case as TestCaseMeta);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown test case.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hydrated,
    webReady,
    webLoadReady,
    vaptReady,
    mobileReady,
    id,
    apiUrl,
    baseUrl,
    testMode,
    mobilePlatform,
    appDriveUrl,
    appiumUrl,
    osVersion,
    deviceVersion,
    router,
  ]);

  if (!hydrated) {
    return (
      <main className="page">
        <p className="hero-sub">Loading…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page">
        <p className="error-text">{error}</p>
        <a href="/tests" style={{ color: 'var(--accent)' }}>
          Back to tests
        </a>
      </main>
    );
  }

  if (!test || !id) {
    return (
      <main className="page">
        <p className="hero-sub">Loading test…</p>
      </main>
    );
  }

  if (isMobileTestId(id)) {
    return <MobileTestWorkspace testId={test.id} testName={test.name} />;
  }

  if (test.kind === 'vapt') {
    return <VaptTestWorkspace testId={test.id} testName={test.name} />;
  }

  if (test.kind === 'web-load') {
    return <LoadTestWorkspace testId={test.id} testName={test.name} />;
  }

  return (
    <TestRunWorkspace
      testId={test.id}
      testName={test.name}
      initialIsoCode={parseSignupIsoFromTestId(id)}
      showCountryPicker={isCountryScopedWebTest(id)}
    />
  );
}
