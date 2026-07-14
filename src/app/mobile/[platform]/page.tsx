'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { MobileVersionSetup } from '@/components/MobileVersionSetup';
import type { MobilePlatform } from '@/lib/store';

function isPlatform(value: string | undefined): value is MobilePlatform {
  return value === 'android' || value === 'ios';
}

export default function MobileVersionPage() {
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
      <main className="page page-wide">
        <p className="hero-sub" style={{ padding: '2rem' }}>
          Loading…
        </p>
      </main>
    );
  }

  return (
    <main className="page page-wide">
      <MobileVersionSetup platform={platform} />
    </main>
  );
}
