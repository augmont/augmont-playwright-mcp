'use client';

import Link from 'next/link';
import { CredentialsButton } from '@/components/CredentialsModal';
import { AiSetupButton } from '@/components/AiSetupModal';
import { useAppStore } from '@/lib/store';

export function AppHeader() {
  const testMode = useAppStore((s) => s.testMode);
  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const mobilePlatform = useAppStore((s) => s.mobilePlatform);
  const appiumUrl = useAppStore((s) => s.appiumUrl);
  const osVersion = useAppStore((s) => s.osVersion);
  const deviceVersion = useAppStore((s) => s.deviceVersion);

  let chip = 'Choose Web, Load, VAPT, or Mobile';
  let chipHref = '/';

  if (testMode === 'mobile' && mobilePlatform) {
    const parts = [
      mobilePlatform === 'android' ? 'Android' : 'iOS',
      osVersion || null,
      deviceVersion || null,
      appiumUrl ? `Appium: ${appiumUrl}` : null,
    ].filter(Boolean);
    chip = parts.join(' · ');
    chipHref =
      osVersion && deviceVersion
        ? `/mobile/${mobilePlatform}`
        : appiumUrl
          ? `/mobile/${mobilePlatform}/setup`
          : '/mobile';
  } else if (testMode === 'web-load' && baseUrl) {
    chip = apiUrl
      ? `Load · Portal: ${baseUrl} · API: ${apiUrl}`
      : `Load · Portal: ${baseUrl}`;
    chipHref = '/web-load';
  } else if (testMode === 'vapt' && baseUrl) {
    chip = apiUrl
      ? `VAPT · Portal: ${baseUrl} · API: ${apiUrl}`
      : `VAPT · Portal: ${baseUrl}`;
    chipHref = '/vapt';
  } else if (testMode === 'web' && baseUrl) {
    chip = apiUrl ? `Portal: ${baseUrl} · API: ${apiUrl}` : `Portal: ${baseUrl}`;
    chipHref = '/web';
  } else if (baseUrl && !testMode) {
    chip = apiUrl ? `Portal: ${baseUrl} · API: ${apiUrl}` : `Portal: ${baseUrl}`;
    chipHref = '/web';
  }

  return (
    <header className="app-header">
      <Link href="/" className="brand">
        LGD <span>Playwright MCP</span>
      </Link>
      <div className="app-header-right">
        <AiSetupButton />
        <CredentialsButton />
        <Link href={chipHref} className="base-url-chip" title="Change setup">
          {chip}
        </Link>
      </div>
    </header>
  );
}
