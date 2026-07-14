'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WebFlowSelect } from '@/components/WebFlowSelect';
import { FlowTestCaseBrowser } from '@/components/FlowTestCaseBrowser';
import { getTestCasesForMode } from '@/lib/test-registry';
import { isMobileReady, isWebLoadReady, isVaptReady, isWebReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';

export default function TestsPage() {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const testMode = useAppStore((s) => s.testMode);
  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const mobilePlatform = useAppStore((s) => s.mobilePlatform);
  const appDriveUrl = useAppStore((s) => s.appDriveUrl);
  const appiumUrl = useAppStore((s) => s.appiumUrl);
  const osVersion = useAppStore((s) => s.osVersion);
  const deviceVersion = useAppStore((s) => s.deviceVersion);

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
  const isMobile = testMode === 'mobile';

  useEffect(() => {
    if (!hydrated) return;

    if (testMode === 'web-load') {
      router.replace(webLoadReady ? '/tests/load' : '/web-load');
      return;
    }

    if (testMode === 'vapt') {
      router.replace(vaptReady ? '/tests/vapt' : '/vapt');
      return;
    }

    if (webReady) return;
    if (mobileReady) return;

    if (testMode === 'mobile') {
      if (!mobilePlatform) {
        router.replace('/mobile');
        return;
      }
      if (!appDriveUrl || !appiumUrl) {
        router.replace(`/mobile/${mobilePlatform}/setup`);
        return;
      }
      if (!osVersion || !deviceVersion) {
        router.replace(`/mobile/${mobilePlatform}`);
        return;
      }
    }

    if (testMode === 'web' || (!testMode && (baseUrl || apiUrl))) {
      router.replace('/web');
      return;
    }

    router.replace('/');
  }, [
    hydrated,
    webReady,
    webLoadReady,
    vaptReady,
    mobileReady,
    testMode,
    baseUrl,
    apiUrl,
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

  if (testMode === 'web-load' || testMode === 'vapt') return null;

  if (!webReady && !mobileReady) return null;

  if (isMobile) {
    const cases = getTestCasesForMode('mobile');
    return (
      <main className="page">
        <h1 className="hero-title">Mobile test cases</h1>
        <p className="hero-sub">
          Separate Android suites — launch, onboarding, and signup. Appium:{' '}
          <strong style={{ color: 'var(--accent)' }}>{appiumUrl}</strong>
        </p>
        <FlowTestCaseBrowser cases={cases} />
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="hero-title">Select web flow</h1>
      <p className="hero-sub">
        Choose a flow to see its test cases. Set buyer / admin / seller email &amp; password
        with <strong>Set credentials</strong> in the header (saved for this tab only).
        then walk the pages. Portal:{' '}
        <strong style={{ color: 'var(--accent)' }}>{baseUrl}</strong>
      </p>
      <WebFlowSelect />
    </main>
  );
}
