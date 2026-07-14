'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ANDROID_DEVICES,
  ANDROID_OS_VERSIONS,
  IOS_DEVICES,
  IOS_OS_VERSIONS,
} from '@/lib/mobile-versions';
import { useAppStore, type MobilePlatform } from '@/lib/store';
import { useStoreHydrated } from '@/lib/use-store-hydrated';

export function MobileVersionSetup({ platform }: { platform: MobilePlatform }) {
  const hydrated = useStoreHydrated();
  const router = useRouter();
  const appDriveUrl = useAppStore((s) => s.appDriveUrl);
  const appiumUrl = useAppStore((s) => s.appiumUrl);
  const storedOs = useAppStore((s) => s.osVersion);
  const storedDevice = useAppStore((s) => s.deviceVersion);
  const setMobileVersions = useAppStore((s) => s.setMobileVersions);
  const setMobilePlatform = useAppStore((s) => s.setMobilePlatform);

  const osOptions = platform === 'android' ? ANDROID_OS_VERSIONS : IOS_OS_VERSIONS;
  const deviceOptions = platform === 'android' ? ANDROID_DEVICES : IOS_DEVICES;

  const [osVersion, setOsVersion] = useState('');
  const [deviceVersion, setDeviceVersion] = useState('');

  useEffect(() => {
    if (!hydrated) return;
    setMobilePlatform(platform);
    if (!appDriveUrl || !appiumUrl) {
      router.replace(`/mobile/${platform}/setup`);
      return;
    }
    setOsVersion(storedOs || osOptions[0]?.id || '');
    setDeviceVersion(storedDevice || deviceOptions[0]?.id || '');
  }, [
    hydrated,
    appDriveUrl,
    appiumUrl,
    platform,
    router,
    setMobilePlatform,
    storedOs,
    storedDevice,
    osOptions,
    deviceOptions,
  ]);

  const osLabel = useMemo(
    () => osOptions.find((o) => o.id === osVersion)?.label || osVersion,
    [osOptions, osVersion],
  );
  const deviceLabel = useMemo(
    () => deviceOptions.find((d) => d.id === deviceVersion)?.label || deviceVersion,
    [deviceOptions, deviceVersion],
  );

  if (!hydrated) {
    return (
      <p className="hero-sub" style={{ padding: '2rem' }}>
        Loading…
      </p>
    );
  }

  if (!appDriveUrl || !appiumUrl) return null;

  function onContinue() {
    if (!osVersion || !deviceVersion) return;
    setMobileVersions(osVersion, deviceVersion);
    router.push('/tests');
  }

  const platformLabel = platform === 'android' ? 'Android' : 'iOS';

  return (
    <div className="mobile-version-layout">
      <aside className="mobile-version-sidebar">
        <div className="mobile-version-sidebar-header">
          <p className="mobile-version-eyebrow">{platformLabel}</p>
          <h1>Select versions</h1>
          <p>Choose {platformLabel} version and mobile / device, then continue.</p>
        </div>

        <section className="mobile-version-group">
          <h2>{platformLabel} version</h2>
          <ul className="mobile-version-list">
            {osOptions.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  className={
                    osVersion === opt.id
                      ? 'mobile-version-item is-active'
                      : 'mobile-version-item'
                  }
                  onClick={() => setOsVersion(opt.id)}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="mobile-version-group">
          <h2>Mobile / device</h2>
          <ul className="mobile-version-list">
            {deviceOptions.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  className={
                    deviceVersion === opt.id
                      ? 'mobile-version-item is-active'
                      : 'mobile-version-item'
                  }
                  onClick={() => setDeviceVersion(opt.id)}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <div className="mobile-version-main">
        <h2 className="hero-title" style={{ fontSize: '1.75rem' }}>
          Ready for {platformLabel} tests
        </h2>
        <p className="hero-sub">
          Pick OS + device, then open test cases. The Android emulator downloads the Drive APK and
          opens when you press <strong>Start test</strong> (not on Submit).
        </p>

        <dl className="mobile-summary">
          <div>
            <dt>Platform</dt>
            <dd>{platformLabel}</dd>
          </div>
          <div>
            <dt>OS version</dt>
            <dd>{osLabel || '—'}</dd>
          </div>
          <div>
            <dt>Device</dt>
            <dd>{deviceLabel || '—'}</dd>
          </div>
          <div>
            <dt>App Drive URL</dt>
            <dd className="mobile-summary-url">{appDriveUrl}</dd>
          </div>
          <div>
            <dt>Appium URL</dt>
            <dd className="mobile-summary-url">{appiumUrl}</dd>
          </div>
        </dl>

        <div className="url-row" style={{ marginTop: '1.5rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!osVersion || !deviceVersion}
            onClick={onContinue}
          >
            Continue to test cases
          </button>
          <Link href={`/mobile/${platform}/setup`} className="btn btn-ghost">
            Edit URLs
          </Link>
        </div>
      </div>
    </div>
  );
}
