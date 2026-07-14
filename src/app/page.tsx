import { PlatformSelect } from '@/components/PlatformSelect';

export default function HomePage() {
  return (
    <main className="page page-home">
      <div className="page-home-intro">
        <h1 className="hero-title">Select test type</h1>
        <p className="hero-sub hero-sub-home">
          <strong>Web</strong> case types (Playwright, load, VAPT) and a separate{' '}
          <strong>Mobile</strong> case type (Appium). Use header <strong>AI setup</strong> for
          OpenRouter / Claude keys (tab-only).
        </p>
      </div>
      <PlatformSelect />
    </main>
  );
}
