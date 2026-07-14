'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AiProviderId } from '@/lib/ai-provider';
import {
  clearAiKeys,
  countConfiguredAiKeys,
  maskAiKey,
  readAiKeys,
  writeAiKeys,
} from '@/lib/ai-keys';
import { useAppStore } from '@/lib/store';
import { ModalCloseButton } from '@/components/ModalCloseButton';

export function AiSetupButton() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(0);
  const aiProvider = useAppStore((s) => s.aiProvider);

  useEffect(() => {
    setConfigured(countConfiguredAiKeys());
  }, [open]);

  const label =
    configured > 0
      ? `AI setup (${aiProvider === 'claude' ? 'Claude' : 'OpenRouter'})`
      : 'AI setup';

  return (
    <>
      <button
        type="button"
        className={`btn creds-header-btn ai-setup-header-btn ${configured ? 'has-creds' : ''}`}
        onClick={() => setOpen(true)}
        title="Set OpenRouter / Claude API keys for this browser tab"
      >
        {label}
      </button>
      <AiSetupModal
        open={open}
        onClose={() => {
          setOpen(false);
          setConfigured(countConfiguredAiKeys());
        }}
        onChange={() => setConfigured(countConfiguredAiKeys())}
      />
    </>
  );
}

function AiSetupModal({
  open,
  onClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const aiProvider = useAppStore((s) => s.aiProvider);
  const setAiProvider = useAppStore((s) => s.setAiProvider);

  const [openRouterKey, setOpenRouterKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    // Enforce single active provider (migrate older dual-enabled local state)
    setAiProvider(aiProvider === 'claude' ? 'claude' : 'openrouter');
    const stored = readAiKeys();
    setOpenRouterKey(stored.openRouterApiKey);
    setClaudeKey(stored.anthropicApiKey);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when modal opens
  }, [open, onClose, setAiProvider]);

  if (!open) return null;

  function selectProvider(id: AiProviderId) {
    setAiProvider(id);
    setSavedMsg('');
  }

  function save() {
    const claudeTrimmed = claudeKey.trim();
    if (aiProvider === 'claude' && /^sk-ant-oat/i.test(claudeTrimmed)) {
      setSavedMsg(
        'That key is a Claude Code OAuth token (sk-ant-oat…). Anthropic rejects it for this app. Use a Console API key (sk-ant-api03-…) from console.anthropic.com, or switch Active AI to OpenRouter.',
      );
      return;
    }
    writeAiKeys({
      openRouterApiKey: openRouterKey,
      anthropicApiKey: claudeKey,
    });
    const saved = readAiKeys();
    const activeKey =
      aiProvider === 'claude' ? saved.anthropicApiKey : saved.openRouterApiKey;
    const name = aiProvider === 'claude' ? 'Claude' : 'OpenRouter';
    setSavedMsg(
      activeKey
        ? `Saved ${name} key for this tab only. Only ${name} is active. Cleared when you close the tab.`
        : `Nothing saved for ${name} — paste the API key above (or rely on .env.local).`,
    );
    onChange();
  }

  function clearAll() {
    clearAiKeys();
    setOpenRouterKey('');
    setClaudeKey('');
    setSavedMsg('Cleared both AI keys for this tab.');
    onChange();
  }

  const activeKey = aiProvider === 'claude' ? claudeKey : openRouterKey;
  const activeMasked = maskAiKey(activeKey);

  const modal = (
    <div
      className="report-modal-root creds-modal-root"
      role="dialog"
      aria-modal="true"
      aria-label="AI setup"
    >
      <div className="report-modal-backdrop" onClick={onClose} />
      <div className="report-modal creds-modal ai-setup-modal">
        <header className="creds-modal-header">
          <div className="creds-modal-header-copy">
            <h2>AI setup</h2>
            <p className="history-meta">
              Only <strong>one</strong> AI is active at a time. Pick OpenRouter or Claude, paste
              that key, then Save. Keys stay in <strong>sessionStorage</strong> — cleared when
              this tab closes. Server <code>.env.local</code> keys are also used when the tab key
              is empty. Claude needs a Console key (<code>sk-ant-api03-…</code>) — not a Claude
              Code OAuth token (<code>sk-ant-oat…</code>).
            </p>
          </div>
          <ModalCloseButton onClick={onClose} />
        </header>

        <div className="report-modal-body ai-setup-body">
          <div className="ai-provider-grid" role="radiogroup" aria-label="Active AI provider">
            <article
              className={`ai-provider-card ${aiProvider === 'openrouter' ? 'active' : ''}`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={aiProvider === 'openrouter'}
                className="ai-provider-select"
                onClick={() => selectProvider('openrouter')}
              >
                <strong>OpenRouter</strong>
                <span>
                  {aiProvider === 'openrouter' ? 'Active now' : 'Tap to make active'}
                </span>
              </button>
            </article>

            <article className={`ai-provider-card ${aiProvider === 'claude' ? 'active' : ''}`}>
              <button
                type="button"
                role="radio"
                aria-checked={aiProvider === 'claude'}
                className="ai-provider-select"
                onClick={() => selectProvider('claude')}
              >
                <strong>Claude</strong>
                <span>{aiProvider === 'claude' ? 'Active now' : 'Tap to make active'}</span>
              </button>
            </article>
          </div>

          <p className="ai-provider-active">
            Active: <strong>{aiProvider === 'claude' ? 'Claude' : 'OpenRouter'}</strong>
            <span className="field-hint"> — the other provider is off</span>
          </p>

          <div className="creds-form ai-keys-form">
            {aiProvider === 'openrouter' ? (
              <label>
                OpenRouter API key
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-or-v1-…"
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                />
                {activeMasked ? <span className="field-hint">{activeMasked}</span> : null}
              </label>
            ) : (
              <label>
                Claude (Anthropic) Console API key
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-ant-api03-…"
                  value={claudeKey}
                  onChange={(e) => setClaudeKey(e.target.value)}
                />
                {activeMasked ? <span className="field-hint">{activeMasked}</span> : null}
                <span className="field-hint">
                  From{' '}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    console.anthropic.com
                  </a>
                  . Do not paste Claude Code <code>sk-ant-oat…</code> tokens — they return
                  invalid x-api-key.
                </span>
              </label>
            )}
          </div>

          {savedMsg ? <p className="step-msg creds-saved-msg">{savedMsg}</p> : null}

          <div className="creds-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              Save for this tab
            </button>
            <button type="button" className="btn btn-ghost creds-clear-all" onClick={clearAll}>
              Clear keys
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
