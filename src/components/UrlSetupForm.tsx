'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEFAULT_API_URL, suggestApiUrl } from '@/lib/api-url';
import { normalizeUrl, useAppStore } from '@/lib/store';

const DEFAULT_URL =
  process.env.NEXT_PUBLIC_DEFAULT_BASE_URL || 'http://localhost:4200';

export function UrlSetupForm() {
  const router = useRouter();
  const setUrls = useAppStore((s) => s.setUrls);
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
    setTestMode('web');
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
    if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
      setError('Enter a valid API URL (http:// or https://).');
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(baseUrl);
      // eslint-disable-next-line no-new
      new URL(apiUrl);
    } catch {
      setError('URL format looks invalid.');
      return;
    }
    setError('');
    setUrls(baseUrl, apiUrl);
    router.push('/tests');
  }

  return (
    <form className="url-form" onSubmit={onSubmit}>
      <label htmlFor="baseUrl">Portal URL (local or hosted)</label>
      <input
        id="baseUrl"
        className="url-input"
        type="url"
        placeholder="http://localhost:4200 or https://your-app.example.com"
        value={baseValue}
        onChange={(e) => setBaseValue(e.target.value)}
        autoFocus
      />

      <label htmlFor="apiUrl" className="field-label-spaced">
        Location API URL
      </label>
      <p className="field-hint">
        Used to load countries via <code>POST /location</code>. Auto-suggested from the portal
        host — edit if needed.
      </p>
      <div className="url-row">
        <input
          id="apiUrl"
          className="url-input"
          type="url"
          placeholder="http://localhost:3000/api/v1"
          value={apiValue}
          onChange={(e) => {
            setApiTouched(true);
            setApiValue(e.target.value);
          }}
        />
        <button type="submit" className="btn btn-primary">
          Submit & continue
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <p className="flow-back">
        <Link href="/">← Back to Web / Mobile</Link>
      </p>
    </form>
  );
}
