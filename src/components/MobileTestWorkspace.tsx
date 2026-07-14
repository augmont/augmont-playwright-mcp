'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TestOverviewPanel } from '@/components/TestOverviewPanel';
import { ReportsDrawer } from '@/components/ReportsDrawer';
import { isMobileReady, useAppStore } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';
import type { RunSnapshot } from '@/lib/types';

export function MobileTestWorkspace({
  testId,
  testName,
}: {
  testId: string;
  testName: string;
}) {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const testMode = useAppStore((s) => s.testMode);
  const mobilePlatform = useAppStore((s) => s.mobilePlatform);
  const appDriveUrl = useAppStore((s) => s.appDriveUrl);
  const appiumUrl = useAppStore((s) => s.appiumUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const osVersion = useAppStore((s) => s.osVersion);
  const deviceVersion = useAppStore((s) => s.deviceVersion);

  const [runId, setRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportsRefresh, setReportsRefresh] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const isIos = mobilePlatform === 'ios';
  const ready = isMobileReady({
    testMode,
    mobilePlatform,
    appDriveUrl,
    appiumUrl,
    apiUrl,
    osVersion,
    deviceVersion,
  });

  useEffect(() => {
    if (!hydrated) return;
    if (ready) return;
    if (!mobilePlatform) router.replace('/mobile');
    else if (!appDriveUrl || !appiumUrl)
      router.replace(`/mobile/${mobilePlatform}/setup`);
    else if (!osVersion || !deviceVersion)
      router.replace(`/mobile/${mobilePlatform}`);
    else router.replace('/');
  }, [
    hydrated,
    ready,
    mobilePlatform,
    appDriveUrl,
    appiumUrl,
    osVersion,
    deviceVersion,
    router,
  ]);

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
    es.addEventListener('end', () => es.close());
  }, []);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  async function startRun() {
    if (!ready || !mobilePlatform) return;
    setStarting(true);
    setError('');
    try {
      const res = await fetch(`/api/tests/${testId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'mobile',
          platform: mobilePlatform,
          osVersion,
          deviceVersion,
          appDriveUrl,
          appiumUrl,
          apiUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start mobile run');
      setRunId(data.runId);
      setSnapshot(data.snapshot);
      attachEvents(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setStarting(false);
    }
  }

  async function stopRun() {
    if (!runId) return;
    await fetch(`/api/runs/${runId}/stop`, { method: 'POST' });
  }

  if (!hydrated || !ready) return null;

  const active =
    starting ||
    snapshot?.status === 'starting' ||
    snapshot?.status === 'running';

  const failed = snapshot?.status === 'failed';
  const targetLabel = `${isIos ? 'iOS' : 'Android'} ${osVersion} · ${deviceVersion} · ${appiumUrl}`;
  const deviceWord = isIos ? 'iPhone / Simulator' : 'Android emulator';

  return (
    <div className="page page-wide workspace-shell">
      {error ? (
        <p className="error-text" style={{ padding: '0.75rem 1.25rem', margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div className="split-layout">
        <TestOverviewPanel
          title={snapshot?.testName || testName}
          snapshot={snapshot}
          starting={starting}
          onStart={startRun}
          onStop={stopRun}
          onOpenReports={() => {
            setReportsRefresh((n) => n + 1);
            setReportsOpen(true);
          }}
          targetLabel={targetLabel}
          countryControls={
            <div className="country-controls">
              <h3 className="country-report-title">Mobile run</h3>
              <p className="step-msg">
                {isIos ? (
                  <>
                    iOS uses a Diawi/Drive IPA on a <strong>provisioned physical iPhone</strong> (or
                    a simulator <strong>.app</strong> from Xcode). This Mac needs Xcode installed.
                  </>
                ) : (
                  <>
                    Launch once with <strong>Mobile — App launch</strong>. Later cases reuse the same
                    emulator/app and skip boot/install if already running.
                  </>
                )}
              </p>
              <p className="step-msg" style={{ marginTop: '0.5rem' }}>
                App: <strong style={{ color: 'var(--text)' }}>{appDriveUrl}</strong>
              </p>
              {failed && snapshot?.error ? (
                <p className="error-text" style={{ marginTop: '0.75rem' }}>
                  {snapshot.error}
                </p>
              ) : null}
            </div>
          }
        />
        <section className="mcp-panel mobile-live-placeholder">
          <div className="mcp-toolbar">
            <span>{isIos ? 'iOS device / Simulator' : 'Android emulator'}</span>
            <span className={`status-badge status-${snapshot?.status || 'idle'}`}>
              {active ? 'running' : snapshot?.status || 'idle'}
            </span>
          </div>
          <div className="mobile-live-inner">
            <p className="mobile-live-eyebrow">
              {isIos ? 'iOS' : 'Android'} · {osVersion} · {deviceVersion}
            </p>
            <h2>
              {failed
                ? 'Run failed'
                : active
                  ? `${deviceWord} session active`
                  : 'Ready to start'}
            </h2>
            {failed && snapshot?.error ? (
              <p className="error-text">{snapshot.error}</p>
            ) : isIos ? (
              <p>
                iOS test cases run on the <strong>booted Simulator</strong> (iPhone 16). Diawi IPA
                install is skipped on Simulator — you need a Simulator <code>.app</code> at{' '}
                <code>data/mobile-apps/Augmont.app</code> for launch + onboarding/signup taps. A
                paired physical iPhone still works with Diawi.
              </p>
            ) : (
              <p>
                Watch the Android Emulator window on your Mac. If you see{' '}
                <strong>System UI isn&apos;t responding</strong>, the runner taps{' '}
                <strong>Wait</strong> automatically — or tap Wait yourself, then re-run.
              </p>
            )}
          </div>
        </section>
      </div>

      <ReportsDrawer
        open={reportsOpen}
        onClose={() => setReportsOpen(false)}
        refreshToken={reportsRefresh}
      />
    </div>
  );
}
