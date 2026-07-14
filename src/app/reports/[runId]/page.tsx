'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/** Legacy /reports/[runId] route — redirect into Signup & Login reports drawer flow. */
export default function ReportDetailPage() {
  const params = useParams<{ runId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace('/tests/signup-login');
  }, [params?.runId, router]);

  return (
    <main className="page">
      <p className="hero-sub">Opening reports in the Signup &amp; Login workspace…</p>
    </main>
  );
}
