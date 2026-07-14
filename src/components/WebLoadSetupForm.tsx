'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEFAULT_API_URL, suggestApiUrl } from '@/lib/api-url';
import { normalizeUrl, useAppStore } from '@/lib/store';

const DEFAULT_URL =
  process.env.NEXT_PUBLIC_DEFAULT_BASE_URL || 'http://localhost:4200';

export function WebLoadSetupForm() {
  const router = useRouter();
  const setWebLoadUrls = useAppStore((s) => s.setWebLoadUrls);
  const setTestMode = useAppStore((s) => s.setTestMode);
  const existingBase = useAppStore((s) => s.baseUrl);
  const existingApi = useAppStore((s) => s.apiUrl);

  const [baseValue, setBaseValue] = useState(existingBase || DEFAULT_URL);
  const [apiValue, setApiValue] = useState(
    existingApi || suggestApiUrl(existingBase || DEFAULT_URL) || DEFAULT_API_URL,
  );
  const [error, setError] = useState('');
  const [apiTouched, setApiTouched] = useState(!!existingApi);

  useEffect(() => {
    setTestMode('web-load');
  }, [setTestMode]);

  useEffect(() => {
    if (!apiTouched) {
      setApiValue(suggestApiUrl(baseValue));
    }
  }, [baseValue, apiTouched]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const baseUrl = normalizeUrl(baseValue);
    const apiUrl = normalizeUrl(apiValue);
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      setError('Enter a valid portal URL (http:// or https://).');
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(baseUrl);
      if (apiUrl) {
        // eslint-disable-next-line no-new
        new URL(apiUrl);
      }
    } catch {
      setError('URL format looks invalid.');
      return;
    }
    setError('');
    setWebLoadUrls(baseUrl, apiUrl || undefined);
    router.push('/tests/load');
  }

  return (
    <form className="url-form" onSubmit={onSubmit}>
      <label htmlFor="loadBaseUrl">Portal URL (local or hosted)</label>
      <input
        id="loadBaseUrl"
        className="url-input"
        type="url"
        placeholder="http://localhost:4200 or https://your-app.example.com"
        value={baseValue}
        onChange={(e) => setBaseValue(e.target.value)}
        autoFocus
      />

      <label htmlFor="loadApiUrl" className="field-label-spaced">
        API URL (optional — for API load scenarios)
      </label>
      <p className="field-hint">
        Used when a scenario targets the Location API (e.g. <code>POST /location</code>).
      </p>
      <input
        id="loadApiUrl"
        className="url-input"
        type="url"
        placeholder={DEFAULT_API_URL}
        value={apiValue}
        onChange={(e) => {
          setApiTouched(true);
          setApiValue(e.target.value);
        }}
      />

      {error ? <p className="error-text">{error}</p> : null}

      <div className="url-row">
        <button type="submit" className="btn btn-primary">
          Continue to load tests →
        </button>
      </div>
      <p className="flow-back">
        <Link href="/">← Back to home</Link>
      </p>
    </form>
  );
}
