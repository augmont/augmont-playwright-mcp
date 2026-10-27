'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  OPENROUTER_AUTO,
  OPENROUTER_MODELS,
  normalizeOpenRouterModelId,
  type OpenRouterModelOption,
} from '@/lib/openrouter-models';
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  normalizeClaudeModelId,
  type AiProviderId,
} from '@/lib/ai-provider';
import { useAppStore } from '@/lib/store';
import {
  activeProviderHasKey,
  aiKeysForRun,
} from '@/lib/ai-keys';
import type { VaptCaseIntent, VaptProfile, VaptTestCase } from '@/lib/types';
import { vaptProfileHint } from '@/lib/vapt-profile';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { VaptMcpDiscoverModal } from '@/components/VaptMcpDiscoverModal';
import { VaptManualCaseModal } from '@/components/VaptManualCaseModal';

const OR_STORAGE = 'lgd-openrouter-model';
const CLAUDE_STORAGE = 'lgd-claude-model';

type ActionModal = 'generate' | 'upload' | null;
type IntentMode = VaptCaseIntent | 'both';

type Props = {
  baseUrl: string;
  apiUrl: string;
  onSaved: () => void;
};

export function VaptAiPanel({ baseUrl, apiUrl, onSaved }: Props) {
  const aiProvider = useAppStore((s) => s.aiProvider);
  const openRouterEnabled = useAppStore((s) => s.openRouterEnabled);
  const claudeEnabled = useAppStore((s) => s.claudeEnabled);
  const providerEnabled =
    aiProvider === 'claude' ? claudeEnabled : openRouterEnabled;
  const hasActiveKey = activeProviderHasKey(aiProvider);
  /** Tab key optional — server falls back to .env.local */
  const canUseAi = providerEnabled;

  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [intentMode, setIntentMode] = useState<IntentMode>('both');
  const [profile, setProfile] = useState<VaptProfile>('higher');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(OPENROUTER_AUTO);
  const [orModels, setOrModels] = useState<OpenRouterModelOption[]>(OPENROUTER_MODELS);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [preview, setPreview] = useState<VaptTestCase[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch('/api/tests/vapt/generate')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.models) && d.models.length) {
          setOrModels(d.models as OpenRouterModelOption[]);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      if (aiProvider === 'claude') {
        const saved = localStorage.getItem(CLAUDE_STORAGE) || '';
        setModel(normalizeClaudeModelId(saved || DEFAULT_CLAUDE_MODEL));
      } else {
        const raw = localStorage.getItem(OR_STORAGE);
        const saved = raw ? normalizeOpenRouterModelId(raw) : OPENROUTER_AUTO;
        setModel(saved || OPENROUTER_AUTO);
      }
    } catch {
      setModel(aiProvider === 'claude' ? DEFAULT_CLAUDE_MODEL : OPENROUTER_AUTO);
    }
  }, [aiProvider]);

  useEffect(() => {
    if (!actionModal || generating || uploading || saving || previewOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActionModal(null);
    }
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [actionModal, generating, uploading, saving, previewOpen]);

  function onModelChange(value: string) {
    const next =
      aiProvider === 'claude'
        ? normalizeClaudeModelId(value)
        : value === OPENROUTER_AUTO
          ? OPENROUTER_AUTO
          : normalizeOpenRouterModelId(value);
    setModel(next);
    try {
      localStorage.setItem(
        aiProvider === 'claude' ? CLAUDE_STORAGE : OR_STORAGE,
        next,
      );
    } catch {
      // ignore
    }
  }

  function openPreview(cases: VaptTestCase[], msg?: string) {
    setPreview(cases);
    const sel: Record<string, boolean> = {};
    for (const c of cases) sel[c.id] = true;
    setSelected(sel);
    setPreviewOpen(true);
    setActionModal(null);
    if (msg) setMessage(msg);
  }

  async function readNdjsonStream(
    res: Response,
    onLine: (event: {
      type?: string;
      message?: string;
      model?: string;
      cases?: VaptTestCase[];
    }) => void,
  ): Promise<void> {
    if (!res.body) throw new Error('No response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          onLine(JSON.parse(trimmed));
        } catch {
          // ignore
        }
      }
    }
  }

  async function onGenerate(e: FormEvent) {
    e.preventDefault();
    if (!canUseAi) {
      setError('Enable a provider in header → AI setup (OpenRouter or Claude).');
      return;
    }
    if (!prompt.trim()) {
      setError('Describe the VAPT scenario to generate.');
      return;
    }
    setGenerating(true);
    setError('');
    setMessage('');
    setLog([`Generate started — ${aiProvider === 'claude' ? 'Claude' : 'OpenRouter'}…`]);

    try {
      const res = await fetch('/api/tests/vapt/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          baseUrl,
          apiUrl,
          model,
          provider: aiProvider,
          stream: true,
          intent: intentMode,
          profile,
          ...aiKeysForRun(),
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.error === 'string' ? data.error : `Generate failed (HTTP ${res.status})`,
        );
      }

      let doneCases: VaptTestCase[] | undefined;
      let doneMessage: string | undefined;
      let streamError: string | undefined;

      await readNdjsonStream(res, (event) => {
        if (event.message) setLog((prev) => [...prev.slice(-40), event.message!]);
        if (event.type === 'error') streamError = event.message || 'Generate failed';
        if (event.type === 'done') {
          doneCases = event.cases || [];
          doneMessage = event.message;
        }
      });

      if (streamError) throw new Error(streamError);
      const cases = doneCases || [];
      if (!cases.length) throw new Error(doneMessage || 'No VAPT cases returned');
      openPreview(
        cases,
        doneMessage ||
          `Generated ${cases.length} scenario(s) (${intentMode} · ${profile}). Select and save.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setGenerating(false);
    }
  }

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!canUseAi) {
      setError('Enable a provider in header → AI setup (OpenRouter or Claude).');
      return;
    }
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a .json, .md, or .txt file to upload.');
      return;
    }
    setUploading(true);
    setError('');
    setMessage('');
    setLog([`Upload started — ${file.name}`]);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('baseUrl', baseUrl);
      form.append('apiUrl', apiUrl);
      form.append('model', model);
      form.append('provider', aiProvider);
      form.append('stream', 'true');
      if (prompt.trim()) form.append('prompt', prompt.trim());
      const keys = aiKeysForRun();
      if (keys.openRouterApiKey) form.append('openRouterApiKey', keys.openRouterApiKey);
      if (keys.anthropicApiKey) form.append('anthropicApiKey', keys.anthropicApiKey);

      const res = await fetch('/api/tests/vapt/upload', { method: 'POST', body: form });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.error === 'string' ? data.error : `Upload failed (HTTP ${res.status})`,
        );
      }

      let doneCases: VaptTestCase[] | undefined;
      let doneMessage: string | undefined;
      let streamError: string | undefined;

      await readNdjsonStream(res, (event) => {
        if (event.message) setLog((prev) => [...prev.slice(-40), event.message!]);
        if (event.type === 'error') streamError = event.message || 'Upload failed';
        if (event.type === 'done') {
          doneCases = event.cases || [];
          doneMessage = event.message;
        }
      });

      if (streamError) throw new Error(streamError);
      const cases = doneCases || [];
      if (!cases.length) throw new Error(doneMessage || 'No VAPT cases from upload');
      openPreview(cases, doneMessage || `Ready ${cases.length} scenario(s) from upload.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onSave() {
    const toSave = preview.filter((c) => selected[c.id]);
    if (!toSave.length) {
      setError('Select at least one scenario to save.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tests/vapt/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases: toSave, source: 'claude' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Save failed');
      }
      const added = Array.isArray(data.added) ? data.added.length : 0;
      const replaced = Array.isArray(data.replaced) ? data.replaced.length : 0;
      setMessage(`Saved — added ${added}, replaced ${replaced}.`);
      setPreview([]);
      setPreviewOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const modelOptions =
    aiProvider === 'claude'
      ? CLAUDE_MODELS
      : [{ id: OPENROUTER_AUTO, label: 'Auto', note: 'Failover', rating: '★★★★★' }, ...orModels];

  const providerLabel = (p: AiProviderId) => (p === 'claude' ? 'Claude' : 'OpenRouter');
  const busy = generating || uploading || saving;

  const modelSelect = (
    <label className="ai-model-select-field">
      <span className="ai-model-select-label">Model</span>
      <select
        className="ai-model-select"
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
        disabled={busy || !canUseAi}
      >
        {modelOptions.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );

  const previewBlock =
    preview.length && previewOpen ? (
      <div
        className="report-modal-root ai-action-modal-root"
        role="dialog"
        aria-modal="true"
        aria-label="Review VAPT scenarios"
      >
        <div
          className="report-modal-backdrop"
          onClick={saving ? undefined : () => setPreviewOpen(false)}
        />
        <div className="ai-action-modal ai-action-modal-wide">
          <div className="ai-action-modal-header">
            <div className="modal-header-copy">
              <h2>Review VAPT scenarios</h2>
              <p className="history-meta">{message || 'Select scenarios to save.'}</p>
            </div>
            <ModalCloseButton disabled={saving} onClick={() => setPreviewOpen(false)} />
          </div>
          <div className="ai-action-modal-body">
            <div className="load-ai-preview">
              <ul className="load-ai-preview-list">
                {preview.map((c) => (
                  <li key={c.id}>
                    <label className="load-ai-preview-item">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[c.id])}
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [c.id]: e.target.checked }))
                        }
                      />
                      <span>
                        <strong>{c.name}</strong>
                        <br />
                        <span className="field-hint">
                          <span
                            className={`tag expectation-tag expectation-${c.vapt.intent === 'fail' ? 'negative' : 'positive'}`}
                          >
                            {c.vapt.intent === 'fail' ? 'Fail' : 'Pass'}
                          </span>{' '}
                          <span className={`tag vapt-profile-tag vapt-profile-${c.vapt.profile || 'higher'}`}>
                            {c.vapt.profile || 'higher'}
                          </span>
                          {' · '}
                          {c.vapt.method || 'GET'} {c.vapt.targetUrl}
                          {c.vapt.useApiBase ? ' (API)' : ''} · start{' '}
                          {c.vapt.startUrl || '/login'} · gate{' '}
                          {c.vapt.severityGate || 'high'} · checks:{' '}
                          {c.vapt.checks.join(', ')}
                        </span>
                        <br />
                        <span className="field-hint">{c.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="creds-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => void onSave()}
                >
                  {saving ? 'Saving…' : 'Save selected'}
                </button>
              </div>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <>
      <div className="flow-header-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            setError('');
            setMessage('');
            setLog([]);
            setActionModal('generate');
          }}
        >
          AI Generate
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            setError('');
            setMessage('');
            setManualOpen(true);
          }}
        >
          Manual entry
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            setError('');
            setMessage('');
            setLog([]);
            setFileName('');
            setActionModal('upload');
          }}
        >
          Upload
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            setError('');
            setMessage('');
            setMcpOpen(true);
          }}
        >
          MCP discover
        </button>
      </div>

      {message && !previewOpen && !actionModal ? (
        <p className="step-msg" style={{ marginTop: '0.5rem' }}>
          {message}
        </p>
      ) : null}
      {error && !actionModal && !previewOpen ? (
        <p className="error-text" style={{ marginTop: '0.5rem' }}>
          {error}
        </p>
      ) : null}

      {actionModal === 'generate' || actionModal === 'upload' ? (
        <div
          className="report-modal-root ai-action-modal-root"
          role="dialog"
          aria-modal="true"
          aria-label={
            actionModal === 'generate' ? 'Generate VAPT scenarios' : 'Upload VAPT scenarios'
          }
        >
          <div
            className="report-modal-backdrop"
            onClick={busy ? undefined : () => setActionModal(null)}
          />
          <div className="ai-action-modal ai-action-modal-wide">
            <div className="ai-action-modal-header">
              <div className="modal-header-copy">
                <h2>
                  {actionModal === 'generate'
                    ? 'Generate VAPT scenarios'
                    : 'Upload VAPT scenarios'}
                </h2>
                <p className="history-meta">
                  Active AI: <strong>{providerLabel(aiProvider)}</strong> — set key in header → AI
                  setup.
                </p>
              </div>
              <ModalCloseButton disabled={busy} onClick={() => setActionModal(null)} />
            </div>

            <div className="ai-action-modal-body">
              {!canUseAi ? (
                <p className="error-text">
                  Active provider is disabled — open header → AI setup and pick OpenRouter or Claude.
                </p>
              ) : null}

              {actionModal === 'generate' ? (
                <form className="ai-card ai-composer" onSubmit={onGenerate}>
                  <p className="field-hint">
                    Describe VAPT probe scenarios. Choose <strong>Pass</strong>,{' '}
                    <strong>Fail</strong>, or <strong>Both</strong>, plus probe level{' '}
                    <strong>Basic / Advanced / Higher</strong>.
                  </p>

                  <div className="vapt-manual-row" style={{ marginBottom: '0.75rem' }}>
                    <div className="field" style={{ margin: 0 }}>
                      <span className="field-hint">AI case type</span>
                      <div
                        className="expectation-tabs"
                        role="tablist"
                        aria-label="Pass or fail generation"
                      >
                        {(
                          [
                            { id: 'pass', label: 'Pass case' },
                            { id: 'fail', label: 'Fail case' },
                            { id: 'both', label: 'Pass + Fail' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={intentMode === tab.id}
                            className={`mode-btn ${intentMode === tab.id ? 'active' : ''}`}
                            disabled={generating}
                            onClick={() => setIntentMode(tab.id)}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <span className="field-hint">Probe level</span>
                      <div
                        className="expectation-tabs"
                        role="tablist"
                        aria-label="VAPT profile"
                      >
                        {(
                          [
                            { id: 'basic', label: 'Basic' },
                            { id: 'advanced', label: 'Advanced' },
                            { id: 'higher', label: 'Higher' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={profile === tab.id}
                            className={`mode-btn ${profile === tab.id ? 'active' : ''}`}
                            disabled={generating}
                            onClick={() => setProfile(tab.id)}
                            title={vaptProfileHint(tab.id)}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      <p className="field-hint" style={{ marginTop: '0.35rem' }}>
                        {vaptProfileHint(profile)}
                      </p>
                    </div>
                  </div>

                  <div className="ai-composer-box">
                    <textarea
                      className="ai-textarea ai-composer-input"
                      rows={4}
                      placeholder="e.g. Login + Location API: pass suite for clean posture and fail suite for auth/header gaps…"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      disabled={generating}
                    />
                    <div className="ai-composer-toolbar">
                      {modelSelect}
                      <button
                        type="submit"
                        className="btn btn-primary ai-composer-go"
                        disabled={generating || !canUseAi}
                      >
                        {generating
                          ? 'Generating…'
                          : intentMode === 'both'
                            ? 'Generate Pass + Fail'
                            : intentMode === 'fail'
                              ? 'Generate Fail case'
                              : 'Generate Pass case'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <form className="ai-card" onSubmit={onUpload}>
                  <p className="field-hint">
                    Upload <code>.json</code> VAPT cases (same shape as store), or{' '}
                    <code>.md</code>/<code>.txt</code> notes — AI normalizes into scenarios.
                  </p>
                  <div
                    className={`upload-dropzone ${dragOver ? 'drag-over' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f && fileRef.current) {
                        const dt = new DataTransfer();
                        dt.items.add(f);
                        fileRef.current.files = dt.files;
                        setFileName(f.name);
                      }
                    }}
                    onClick={() => fileRef.current?.click()}
                  >
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".json,.md,.txt,.markdown,application/json,text/plain,text/markdown"
                      hidden
                      onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
                    />
                    <strong>{fileName || 'Drop file or click to choose'}</strong>
                    <span className="upload-dropzone-sub">.json · .md · .txt</span>
                  </div>
                  <label className="field">
                    Optional notes for AI
                    <textarea
                      className="ai-textarea"
                      rows={2}
                      placeholder="e.g. Prefer 10 VUs and API useApiBase for /location"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      disabled={uploading}
                    />
                  </label>
                  <div className="ai-composer-toolbar">
                    {modelSelect}
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={uploading || !canUseAi}
                    >
                      {uploading ? 'Uploading…' : 'Import'}
                    </button>
                  </div>
                </form>
              )}

              {log.length ? (
                <div className="ai-live-log" aria-live="polite">
                  <div className="ai-live-log-header">
                    <strong>{busy ? 'AI working…' : 'AI log'}</strong>
                  </div>
                  <ul className="ai-live-log-list">
                    {log.map((line, i) => (
                      <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {error ? <p className="error-text">{error}</p> : null}
              {message ? <p className="step-msg">{message}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {previewBlock}

      <VaptMcpDiscoverModal
        open={mcpOpen}
        baseUrl={baseUrl}
        apiUrl={apiUrl}
        model={model}
        models={orModels}
        provider={aiProvider}
        onModelChange={onModelChange}
        onClose={() => setMcpOpen(false)}
        onError={(msg) => setError(msg)}
        onGenerated={(cases, usedModel, msg) => {
          openPreview(
            cases,
            msg ||
              `Generated ${cases.length} scenario(s) from MCP${usedModel ? ` via ${usedModel}` : ''}.`,
          );
        }}
      />

      <VaptManualCaseModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSaved={() => {
          setMessage('Manual VAPT case saved.');
          onSaved();
        }}
      />
    </>
  );
}
