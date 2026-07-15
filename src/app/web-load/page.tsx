import { WebLoadSetupForm } from '@/components/WebLoadSetupForm';

export default function WebLoadSetupPage() {
  return (
    <main className="page">
      <h1 className="hero-title">Web load test — set target URL</h1>
      <p className="hero-sub">
        Enter the portal URL (and optional API URL), then choose a JMeter load scenario — or
        import APIs from a Swagger / OpenAPI URL, pick endpoints one by one, and authorize with
        multi-user credentials when required. Each run generates a .jmx, executes{' '}
        <code>jmeter -n</code>, and saves metrics + auth details in the report.
      </p>
      <WebLoadSetupForm />
    </main>
  );
}
