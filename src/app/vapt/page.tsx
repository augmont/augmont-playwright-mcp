import { VaptSetupForm } from '@/components/VaptSetupForm';

export default function VaptSetupPage() {
  return (
    <main className="page vapt-setup-page">
      <h1 className="hero-title">VAPT test — set target URL</h1>
      <p className="hero-sub">
        Vulnerability Assessment / Penetration Testing probes against the portal (and optional
        API). Security headers, cookies, transport, unauth surfaces, and API hygiene — with
        findings-rich reports. Use header <strong>AI setup</strong> for generate / upload.
      </p>
      <VaptSetupForm />
    </main>
  );
}
