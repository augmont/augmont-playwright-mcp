'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clearLoadAuthCredentials,
  emptyLoadCredential,
  readLoadAuthCredentials,
  readLoadAuthLoginConfig,
  writeLoadAuthCredentials,
  writeLoadAuthLoginConfig,
} from '@/lib/load-auth-credentials';
import type { LoadAuthCredential, LoadAuthLoginConfig } from '@/lib/types';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { LoadAuthFileImport } from '@/components/LoadAuthFileImport';

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: (creds: LoadAuthCredential[], login: Partial<LoadAuthLoginConfig>) => void;
  /** Prefill login path from Swagger suggestion */
  suggestedLoginPath?: string;
  title?: string;
};

export function LoadAuthCredentialsModal({
  open,
  onClose,
  onSaved,
  suggestedLoginPath,
  title = 'API load authorization',
}: Props) {
  const [creds, setCreds] = useState<LoadAuthCredential[]>([emptyLoadCredential('User 1')]);
  const [loginPath, setLoginPath] = useState('/auth/login');
  const [usernameField, setUsernameField] = useState('email');
  const [passwordField, setPasswordField] = useState('password');
  const [tokenJsonPath, setTokenJsonPath] = useState('data.token');
  const [tokenHeader, setTokenHeader] = useState('Authorization');
  const [tokenPrefix, setTokenPrefix] = useState('Bearer ');
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    const stored = readLoadAuthCredentials();
    setCreds(
      stored.length
        ? stored
        : [emptyLoadCredential('User 1'), emptyLoadCredential('User 2')],
    );
    const cfg = readLoadAuthLoginConfig();
    setLoginPath(
      cfg?.loginPath || suggestedLoginPath || '/auth/login',
    );
    setUsernameField(cfg?.usernameField || 'email');
    setPasswordField(cfg?.passwordField || 'password');
    setTokenJsonPath(cfg?.tokenJsonPath || 'data.token');
    setTokenHeader(cfg?.tokenHeader || 'Authorization');
    setTokenPrefix(
      cfg?.tokenPrefix !== undefined ? cfg.tokenPrefix : 'Bearer ',
    );
    setSavedMsg('');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, suggestedLoginPath]);

  if (!open) return null;

  function save() {
    const cleaned = creds
      .map((c, i) => ({
        ...c,
        label: (c.label || `User ${i + 1}`).trim() || `User ${i + 1}`,
        username: c.username.trim(),
      }))
      .filter((c) => c.username && c.password);

    if (!cleaned.length) {
      setSavedMsg('Enter at least one username and password.');
      return;
    }
    if (!loginPath.trim()) {
      setSavedMsg('Login path is required to obtain tokens.');
      return;
    }

    writeLoadAuthCredentials(cleaned);
    const loginCfg: Partial<LoadAuthLoginConfig> = {
      loginPath: loginPath.trim(),
      method: 'POST',
      usernameField: usernameField.trim() || 'email',
      passwordField: passwordField.trim() || 'password',
      tokenJsonPath: tokenJsonPath.trim() || undefined,
      tokenHeader: tokenHeader.trim() || 'Authorization',
      tokenPrefix,
    };
    writeLoadAuthLoginConfig(loginCfg);
    setSavedMsg(
      `Saved ${cleaned.length} credential(s) for this tab. Tokens are obtained when you run the load test.`,
    );
    onSaved?.(cleaned, loginCfg);
  }

  function addRow() {
    setCreds((c) => [...c, emptyLoadCredential(`User ${c.length + 1}`)]);
  }

  function removeRow(id: string) {
    setCreds((c) => (c.length <= 1 ? c : c.filter((x) => x.id !== id)));
  }

  function clearAll() {
    clearLoadAuthCredentials();
    setCreds([emptyLoadCredential('User 1')]);
    setSavedMsg('Cleared credentials for this tab.');
  }

  const modal = (
    <div
      className="report-modal-root creds-modal-root"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="report-modal-backdrop" onClick={onClose} />
      <div className="report-modal creds-modal load-auth-modal">
        <header className="creds-modal-header">
          <div className="creds-modal-header-copy">
            <h2>{title}</h2>
            <p className="history-meta">
              Add one or more username / password pairs. At run time each credential is
              exchanged for a token and rotated across virtual users. Stored in{' '}
              <strong>sessionStorage</strong> only — passwords are never written to reports.
            </p>
          </div>
          <ModalCloseButton onClick={onClose} />
        </header>

        <div className="report-modal-body">
          <fieldset className="load-auth-fieldset">
            <legend>Login → token</legend>
            <label>
              Login path
              <input
                type="text"
                placeholder="/auth/login"
                value={loginPath}
                onChange={(e) => setLoginPath(e.target.value)}
              />
            </label>
            <div className="load-auth-grid-2">
              <label>
                Username field
                <input
                  type="text"
                  value={usernameField}
                  onChange={(e) => setUsernameField(e.target.value)}
                />
              </label>
              <label>
                Password field
                <input
                  type="text"
                  value={passwordField}
                  onChange={(e) => setPasswordField(e.target.value)}
                />
              </label>
              <label>
                Token JSON path
                <input
                  type="text"
                  placeholder="data.token"
                  value={tokenJsonPath}
                  onChange={(e) => setTokenJsonPath(e.target.value)}
                />
              </label>
              <label>
                Auth header
                <input
                  type="text"
                  value={tokenHeader}
                  onChange={(e) => setTokenHeader(e.target.value)}
                />
              </label>
            </div>
            <label>
              Token prefix
              <input
                type="text"
                placeholder="Bearer "
                value={tokenPrefix}
                onChange={(e) => setTokenPrefix(e.target.value)}
              />
            </label>
          </fieldset>

          <div className="load-auth-cred-list">
            <div className="load-auth-cred-head">
              <h3>Credentials</h3>
              <button type="button" className="btn btn-ghost" onClick={addRow}>
                + Add credential
              </button>
            </div>
            <LoadAuthFileImport credentials={creds} onChange={setCreds} />
            {creds.map((c, i) => (
              <div key={c.id} className="load-auth-cred-row">
                <label>
                  Label
                  <input
                    type="text"
                    value={c.label}
                    onChange={(e) =>
                      setCreds((list) =>
                        list.map((x) =>
                          x.id === c.id ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Username / email
                  <input
                    type="text"
                    autoComplete="username"
                    placeholder={`user${i + 1}@example.com`}
                    value={c.username}
                    onChange={(e) =>
                      setCreds((list) =>
                        list.map((x) =>
                          x.id === c.id ? { ...x, username: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={c.password}
                    onChange={(e) =>
                      setCreds((list) =>
                        list.map((x) =>
                          x.id === c.id ? { ...x, password: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost load-auth-remove"
                  onClick={() => removeRow(c.id)}
                  disabled={creds.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {savedMsg ? <p className="step-msg creds-saved-msg">{savedMsg}</p> : null}

          <div className="creds-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              Save credentials
            </button>
            <button type="button" className="btn btn-ghost" onClick={clearAll}>
              Clear all
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
