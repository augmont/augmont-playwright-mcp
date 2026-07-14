'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { MobileSetupForm } from '@/components/MobileSetupForm';
import type { MobilePlatform } from '@/lib/store';

function isPlatform(value: string | undefined): value is MobilePlatform {
  return value === 'android' || value === 'ios';
}

export default function MobileSetupPage() {
  const params = useParams<{ platform: string }>();
  const router = useRouter();
  const platform = params?.platform;

  useEffect(() => {
    if (platform && !isPlatform(platform)) {
      router.replace('/mobile');
    }
  }, [platform, router]);

  if (!isPlatform(platform)) {
    return (
      <main className="page">
        <p className="hero-sub">Loading…</p>
      </main>
    );
  }

  const label = platform === 'android' ? 'Android' : 'iOS';

  return (
    <main className="page">
      <h1 className="hero-title">{label} — app & Appium URLs</h1>
      <p className="hero-sub">
        Add the app upload URL (Diawi or Google Drive) and the Appium server URL, then submit.
      </p>
      <MobileSetupForm platform={platform} />
    </main>
  );
}
