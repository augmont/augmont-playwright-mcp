'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { normalizeUrl, useAppStore, type MobilePlatform } from '@/lib/store';

export function MobileSetupForm({ platform }: { platform: MobilePlatform }) {
  const router = useRouter();
  const existingDrive = useAppStore((s) => s.appDriveUrl);
  const existingAppium = useAppStore((s) => s.appiumUrl);
  const setMobileSetup = useAppStore((s) => s.setMobileSetup);
  const setMobilePlatform = useAppStore((s) => s.setMobilePlatform);

  const [driveValue, setDriveValue] = useState(existingDrive || '');
  const [appiumValue, setAppiumValue] = useState(
    existingAppium || 'http://127.0.0.1:4723',
  );
  const [error, setError] = useState('');

  const label = platform === 'android' ? 'Android' : 'iOS';
  const buildHint = platform === 'android' ? 'APK / AAB' : 'IPA';
  const deviceWord = platform === 'android' ? 'emulator' : 'simulator';
  const linkHint =
    platform === 'ios'
      ? 'Diawi or Drive IPA (not App Store)'
      : 'Google Drive or Diawi APK link';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const appDriveUrl = driveValue.trim();
    const appiumUrl = normalizeUrl(appiumValue);

    if (!appDriveUrl) {
      setError(`Enter the ${label} app URL (Diawi or Google Drive).`);
      return;
    }
    if (!/^https?:\/\//i.test(appDriveUrl)) {
      setError('App URL must start with http:// or https://');
      return;
    }
    if (/apps\.apple\.com|itunes\.apple\.com/i.test(appDriveUrl)) {
      setError(
        'App Store links cannot be used for install/automation. Paste a Diawi or Drive IPA link instead (or install the app on a real iPhone and we can use the bundle id later).',
      );
      return;
    }
    if (!appiumUrl || !/^https?:\/\//i.test(appiumUrl)) {
      setError('Enter a valid Appium server URL (http:// or https://).');
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(appDriveUrl);
      // eslint-disable-next-line no-new
      new URL(appiumUrl);
    } catch {
      setError('URL format looks invalid.');
      return;
    }

    setError('');
    setMobilePlatform(platform);
    setMobileSetup(appDriveUrl, appiumUrl);
    router.push(`/mobile/${platform}`);
  }

  return (
    <form className="url-form" onSubmit={onSubmit}>
      <label htmlFor="appDriveUrl">Application upload URL</label>
      <p className="field-hint">
        Paste a {linkHint} for your {label} build ({buildHint}). Changing the link later removes
        the old app and does a fresh install. Submitting only saves the URL — press{' '}
        <strong>Start test</strong> to open the {deviceWord}.
        {platform === 'ios' ? (
          <>
            {' '}
            An <strong>App Store</strong> page (apps.apple.com) is not enough — Apple does not
            allow downloading the IPA for testing. You need Diawi / Drive IPA, or Xcode +
            Simulator.
          </>
        ) : null}
      </p>
      <input
        id="appDriveUrl"
        className="url-input"
        type="url"
        placeholder={
          platform === 'ios'
            ? 'https://i.diawi.com/… or Drive IPA (not App Store)'
            : 'https://drive.google.com/… or https://i.diawi.com/…'
        }
        value={driveValue}
        onChange={(e) => setDriveValue(e.target.value)}
        autoFocus
      />

      <label htmlFor="appiumUrl" className="field-label-spaced">
        Appium server URL
      </label>
      <p className="field-hint">
        Local or remote Appium endpoint (e.g. http://127.0.0.1:4723).
      </p>
      <div className="url-row">
        <input
          id="appiumUrl"
          className="url-input"
          type="url"
          placeholder="http://127.0.0.1:4723"
          value={appiumValue}
          onChange={(e) => setAppiumValue(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          Submit & continue
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}

      <p className="flow-back">
        <Link href="/mobile">← Back to Android / iOS</Link>
      </p>
    </form>
  );
}
