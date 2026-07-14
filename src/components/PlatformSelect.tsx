'use client';

import Link from 'next/link';
import { useAppStore } from '@/lib/store';

export function PlatformSelect() {
  const setTestMode = useAppStore((s) => s.setTestMode);

  return (
    <div className="type-select">
      <section className="type-select-group" aria-labelledby="web-case-types">
        <div className="type-select-group-head">
          <h2 id="web-case-types" className="type-select-group-title">
            Web case types
          </h2>
          <p className="type-select-group-sub">
            Portal and API targeting the LGD web stack — Playwright, JMeter load, or VAPT probes.
          </p>
        </div>
        <div className="choice-grid choice-grid-web">
          <Link
            href="/web"
            className="choice-card"
            onClick={() => setTestMode('web')}
          >
            <span className="choice-card-eyebrow">Browser · Playwright</span>
            <h3>Web test</h3>
            <p>Functional UI flows against the LGD Portal with live MCP browser view.</p>
            <span className="choice-card-cta">Continue →</span>
          </Link>

          <Link
            href="/web-load"
            className="choice-card"
            onClick={() => setTestMode('web-load')}
          >
            <span className="choice-card-eyebrow">HTTP · JMeter + MCP</span>
            <h3>Web load test</h3>
            <p>
              Apache JMeter CLI virtual users with live MCP view, RPS, and latency thresholds.
            </p>
            <span className="choice-card-cta">Continue →</span>
          </Link>

          <Link
            href="/vapt"
            className="choice-card"
            onClick={() => setTestMode('vapt')}
          >
            <span className="choice-card-eyebrow">Security · OWASP probes</span>
            <h3>VAPT test</h3>
            <p>
              HTTP security checks (headers, cookies, access control, API) with severity findings
              and remediation reports.
            </p>
            <span className="choice-card-cta">Continue →</span>
          </Link>
        </div>
      </section>

      <section className="type-select-group" aria-labelledby="mobile-case-types">
        <div className="type-select-group-head">
          <h2 id="mobile-case-types" className="type-select-group-title">
            Mobile case type
          </h2>
          <p className="type-select-group-sub">
            Native app suites via Appium — separate from web case types above.
          </p>
        </div>
        <div className="choice-grid choice-grid-mobile">
          <Link
            href="/mobile"
            className="choice-card choice-card-mobile"
            onClick={() => setTestMode('mobile')}
          >
            <span className="choice-card-eyebrow">Appium · Android / iOS</span>
            <h3>Mobile test</h3>
            <p>
              Drive app URL and Appium server, then run Signup &amp; Login suites on device —
              not a web browser case.
            </p>
            <span className="choice-card-cta">Continue →</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
