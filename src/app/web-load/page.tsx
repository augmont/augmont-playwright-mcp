import { WebLoadSetupForm } from '@/components/WebLoadSetupForm';

export default function WebLoadSetupPage() {
  return (
    <main className="page">
      <h1 className="hero-title">Web load test — set target URL</h1>
      <p className="hero-sub">
        Enter the portal URL (and optional API URL), then choose a JMeter load scenario.
        Each run generates a .jmx, executes <code>jmeter -n</code>, and streams MCP live
        browser + JTL metrics.
      </p>
      <WebLoadSetupForm />
    </main>
  );
}
