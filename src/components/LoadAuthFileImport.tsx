'use client';

import { useRef, useState } from 'react';
import type { LoadAuthCredential } from '@/lib/types';
import {
  downloadAuthCredentialsSampleCsv,
  mergeImportedCredentials,
  parseAuthCredentialsFile,
  type AuthCredImportMode,
} from '@/lib/parse-auth-credentials-file';

type Props = {
  credentials: LoadAuthCredential[];
  onChange: (next: LoadAuthCredential[]) => void;
};

export function LoadAuthFileImport({ credentials, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<AuthCredImportMode>('append');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const result = await parseAuthCredentialsFile(file);
      const next = mergeImportedCredentials(credentials, result.credentials, mode);
      onChange(next);
      const parts = [
        `Imported ${result.credentials.length} user${result.credentials.length === 1 ? '' : 's'}`,
        mode === 'replace' ? '(replaced existing)' : '(appended)',
      ];
      if (result.skipped) parts.push(`· skipped ${result.skipped} empty row(s)`);
      if (result.sheetHint) parts.push(`· ${result.sheetHint}`);
      setMsg(parts.join(' '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="load-auth-import">
      <div className="load-auth-import-bar">
        <div className="swagger-docs-auth-modes">
          <button
            type="button"
            className={`creds-role-tab ${mode === 'append' ? 'active' : ''}`}
            onClick={() => setMode('append')}
          >
            Append
          </button>
          <button
            type="button"
            className={`creds-role-tab ${mode === 'replace' ? 'active' : ''}`}
            onClick={() => setMode('replace')}
          >
            Replace all
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.xlsx,.xls,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="load-auth-import-input"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Importing…' : 'Import CSV / Excel'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={downloadAuthCredentialsSampleCsv}
        >
          Sample CSV
        </button>
      </div>
      <p className="history-meta">
        Columns: <code>username</code>, <code>password</code>, optional{' '}
        <code>label</code> (also accepts email / mobile). Excel uses the first sheet.
      </p>
      {msg ? <p className="step-msg">{msg}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
