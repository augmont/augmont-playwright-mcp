import { UrlSetupForm } from '@/components/UrlSetupForm';

export default function WebSetupPage() {
  return (
    <main className="page">
      <h1 className="hero-title">Web test — set target URL</h1>
      <p className="hero-sub">
        Enter the LGD Portal URL and Location API URL, then continue to test cases.
      </p>
      <UrlSetupForm />
    </main>
  );
}
