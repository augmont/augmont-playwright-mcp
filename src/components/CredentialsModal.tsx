'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ROLE_CRED_LABELS,
  clearRoleCredentials,
  countConfiguredRoles,
  readRoleCredentials,
  writeRoleCredentials,
  type RoleCredKey,
  type RoleCredentialsMap,
} from '@/lib/role-credentials';
import { ModalCloseButton } from '@/components/ModalCloseButton';

const ROLES: RoleCredKey[] = ['buyer', 'admin', 'seller'];

function emptyDraft(): Record<RoleCredKey, { email: string; password: string }> {
  return {
    buyer: { email: '', password: '' },
    admin: { email: '', password: '' },
    seller: { email: '', password: '' },
  };
}

export function CredentialsButton() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(0);

  useEffect(() => {
    setConfigured(countConfiguredRoles());
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`btn creds-header-btn ${configured ? 'has-creds' : ''}`}
        onClick={() => setOpen(true)}
        title="Set buyer / admin / seller email & password for this browser tab"
      >
        {configured ? `Credentials (${configured})` : 'Set credentials'}
      </button>
      <CredentialsModal
        open={open}
        onClose={() => {
          setOpen(false);
          setConfigured(countConfiguredRoles());
        }}
        onChange={() => setConfigured(countConfiguredRoles())}
      />
    </>
  );
}

function CredentialsModal({
  open,
  onClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const [draft, setDraft] = useState(emptyDraft);
  const [active, setActive] = useState<RoleCredKey>('buyer');
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    const stored = readRoleCredentials();
    const next = emptyDraft();
    for (const role of ROLES) {
      if (stored[role]) {
        next[role] = { email: stored[role]!.email, password: stored[role]!.password };
      }
    }
    setDraft(next);
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
  }, [open, onClose]);

  if (!open) return null;

  function save() {
    const map: RoleCredentialsMap = {};
    for (const role of ROLES) {
      const email = draft[role].email.trim();
      const password = draft[role].password;
      if (email && password) {
        map[role] = { email, password };
      }
    }
    writeRoleCredentials(map);
    setSavedMsg(
      Object.keys(map).length
        ? `Saved for this tab only (${Object.keys(map).join(', ')}). Clears when you close the tab.`
        : 'Nothing saved — enter email and password for at least one role.',
    );
    onChange();
  }

  function clearOne(role: RoleCredKey) {
    clearRoleCredentials(role);
    setDraft((d) => ({ ...d, [role]: { email: '', password: '' } }));
    setSavedMsg(`Cleared ${ROLE_CRED_LABELS[role]} credentials for this tab.`);
    onChange();
  }

  function clearAll() {
    clearRoleCredentials();
    setDraft(emptyDraft());
    setSavedMsg('Cleared all role credentials for this tab.');
    onChange();
  }

  const modal = (
    <div
      className="report-modal-root creds-modal-root"
      role="dialog"
      aria-modal="true"
      aria-label="Set credentials"
    >
      <div className="report-modal-backdrop" onClick={onClose} />
      <div className="report-modal creds-modal">
        <header className="creds-modal-header">
          <div className="creds-modal-header-copy">
            <h2>Set login credentials</h2>
            <p className="history-meta">
              Buyer / Admin / Seller email &amp; password for web-flow login. Stored in{' '}
              <strong>sessionStorage</strong> only — cleared when this tab closes. Use Clear to
              remove manually anytime.
            </p>
          </div>
          <ModalCloseButton onClick={onClose} />
        </header>

        <div className="report-modal-body">
          <div className="creds-role-tabs" role="tablist">
            {ROLES.map((role) => {
              const filled = Boolean(draft[role].email.trim() && draft[role].password);
              return (
                <button
                  key={role}
                  type="button"
                  role="tab"
                  aria-selected={active === role}
                  className={`creds-role-tab ${active === role ? 'active' : ''} ${filled ? 'filled' : ''}`}
                  onClick={() => setActive(role)}
                >
                  {ROLE_CRED_LABELS[role]}
                  {filled ? ' ✓' : ''}
                </button>
              );
            })}
          </div>

          <div className="creds-form">
            <label>
              {ROLE_CRED_LABELS[active]} email
              <input
                type="email"
                autoComplete="username"
                placeholder={`${active}@example.com`}
                value={draft[active].email}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [active]: { ...d[active], email: e.target.value },
                  }))
                }
              />
            </label>
            <label>
              {ROLE_CRED_LABELS[active]} password
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={draft[active].password}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [active]: { ...d[active], password: e.target.value },
                  }))
                }
              />
            </label>
          </div>

          {savedMsg ? <p className="step-msg creds-saved-msg">{savedMsg}</p> : null}

          <div className="creds-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              Save for this tab
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => clearOne(active)}>
              Clear {ROLE_CRED_LABELS[active]}
            </button>
            <button type="button" className="btn btn-ghost creds-clear-all" onClick={clearAll}>
              Clear all
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
