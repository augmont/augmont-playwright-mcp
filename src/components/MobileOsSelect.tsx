'use client';

import Link from 'next/link';
import { useAppStore, type MobilePlatform } from '@/lib/store';

const OPTIONS: { id: MobilePlatform; title: string; description: string }[] = [
  {
    id: 'android',
    title: 'Android',
    description: 'Next: paste APK Drive/Diawi link and Appium URL, then pick OS & device.',
  },
  {
    id: 'ios',
    title: 'iOS',
    description: 'Next: paste IPA Diawi or Drive link and Appium URL, then pick iOS & device.',
  },
];

export function MobileOsSelect() {
  const setMobilePlatform = useAppStore((s) => s.setMobilePlatform);

  return (
    <>
      <div className="choice-grid">
        {OPTIONS.map((opt) => (
          <Link
            key={opt.id}
            href={`/mobile/${opt.id}/setup`}
            className="choice-card"
            onClick={() => setMobilePlatform(opt.id)}
          >
            <span className="choice-card-eyebrow">Platform</span>
            <h2>{opt.title}</h2>
            <p>{opt.description}</p>
            <span className="choice-card-cta">Continue →</span>
          </Link>
        ))}
      </div>
      <p className="flow-back">
        <Link href="/">← Back to test types</Link>
      </p>
    </>
  );
}
