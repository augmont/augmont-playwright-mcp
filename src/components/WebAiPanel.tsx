'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { TestCaseMeta, WebTestCase } from '@/lib/types';
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
import { roleCredentialsForRun } from '@/lib/role-credentials';
import {
  activeProviderHasKey,
  aiKeysForRun,
} from '@/lib/ai-keys';
import {
  TestCaseSelectModal,
  type DuplicatePreview,
} from '@/components/TestCaseSelectModal';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { McpLiveView } from '@/components/McpLiveView';
import { McpClickFlowModal } from '@/components/McpClickFlowModal';

const STORAGE_KEY = 'lgd-openrouter-model';
const CLAUDE_STORAGE_KEY = 'lgd-claude-model';

function modelShortLabel(
  modelId: string,
  provider: AiProviderId,
  models: OpenRouterModelOption[],
): string {
  if (provider === 'claude') {
    if (modelId === 'auto' || !modelId) return 'Sonnet 4';
    const found = CLAUDE_MODELS.find((m) => m.id === modelId);
    return found?.label || modelId;
  }
  if (modelId === OPENROUTER_AUTO) return 'Auto';
  const found = models.find((m) => m.id === modelId);
  if (!found) return modelId.split('/').pop() || modelId;
  return found.label.replace(/\s*\(free\)\s*$/i, '').trim();
}

type ActionModal = 'generate' | 'upload' | 'mcp-click' | null;

type AiLogLevel = 'info' | 'ok' | 'warn' | 'error';

type AiLogLine = {
  id: string;
  at: string;
  message: string;
  level: AiLogLevel;
};

function formatLogTime(iso?: string) {
  try {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}

function levelForEventType(type?: string): AiLogLevel {
  if (type === 'error' || type === 'model_fail' || type === 'parse_fail') return 'error';
  if (type === 'model_ok' || type === 'done') return 'ok';
  if (type === 'model_start') return 'warn';
  return 'info';
}

export function WebAiPanel({
  baseUrl,
  apiUrl,
  onApplied,
  flowRole,
  layout = 'cards',
}: {
  baseUrl: string;
  apiUrl: string;
  onApplied: (cases: TestCaseMeta[]) => void;
  /** When set, generated cases are forced into this flow */
  flowRole?: 'public' | 'buyer' | 'seller' | 'admin';
  /** header = compact buttons in page header (frees space for test cases) */
  layout?: 'cards' | 'header';
}) {
  const aiProvider = useAppStore((s) => s.aiProvider);
  const openRouterEnabled = useAppStore((s) => s.openRouterEnabled);
  const claudeEnabled = useAppStore((s) => s.claudeEnabled);
  const providerEnabled =
    aiProvider === 'claude' ? claudeEnabled : openRouterEnabled;
  const hasActiveKey = activeProviderHasKey(aiProvider);
  const canUseAi = providerEnabled;

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(OPENROUTER_AUTO);
  const [models, setModels] = useState<OpenRouterModelOption[]>(OPENROUTER_MODELS);
  const [menuOpen, setMenuOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [previewCases, setPreviewCases] = useState<WebTestCase[]>([]);
  const [previewDuplicates, setPreviewDuplicates] = useState<DuplicatePreview[]>([]);
  const [previewSource, setPreviewSource] = useState<'claude' | 'upload'>('claude');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewModel, setPreviewModel] = useState<string | undefined>();
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [liveInspect, setLiveInspect] = useState(true);
  const [inspectSessionId, setInspectSessionId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [aiLog, setAiLog] = useState<AiLogLine[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  function pushAiLog(message: string, level: AiLogLevel = 'info', at?: string) {
    setAiLog((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: formatLogTime(at),
        message,
        level,
      },
    ]);
  }

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [aiLog]);

  useEffect(() => {
    void fetch('/api/tests/generate')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.models) && d.models.length) {
          setModels(d.models as OpenRouterModelOption[]);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      if (aiProvider === 'claude') {
        const saved = localStorage.getItem(CLAUDE_STORAGE_KEY) || '';
        const next = normalizeClaudeModelId(saved || DEFAULT_CLAUDE_MODEL);
        setModel(next);
        localStorage.setItem(CLAUDE_STORAGE_KEY, next);
        return;
      }
      const savedRaw = localStorage.getItem(STORAGE_KEY);
      const saved = savedRaw ? normalizeOpenRouterModelId(savedRaw) : '';
      if (saved === OPENROUTER_AUTO || models.some((m) => m.id === saved)) {
        if (saved) {
          setModel(saved);
          if (saved !== savedRaw) localStorage.setItem(STORAGE_KEY, saved);
        } else {
          setModel(OPENROUTER_AUTO);
        }
      } else {
        localStorage.setItem(STORAGE_KEY, OPENROUTER_AUTO);
        setModel(OPENROUTER_AUTO);
      }
    } catch {
      setModel(aiProvider === 'claude' ? DEFAULT_CLAUDE_MODEL : OPENROUTER_AUTO);
    }
  }, [aiProvider, models]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!actionModal || actionModal === 'mcp-click' || previewOpen || generating || uploading) {
      return;
    }
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
  }, [actionModal, previewOpen, generating, uploading]);

  function onModelChange(value: string) {
    const next =
      aiProvider === 'claude'
        ? normalizeClaudeModelId(value)
        : value === OPENROUTER_AUTO
          ? OPENROUTER_AUTO
          : normalizeOpenRouterModelId(value);
    setModel(next);
    setMenuOpen(false);
    try {
      localStorage.setItem(
        aiProvider === 'claude' ? CLAUDE_STORAGE_KEY : STORAGE_KEY,
        next,
      );
    } catch {
      // ignore
    }
  }

  function openPreview(
    cases: WebTestCase[],
    source: 'claude' | 'upload',
    usedModel?: string,
    duplicates: DuplicatePreview[] = [],
  ) {
    setPreviewCases(cases);
    setPreviewDuplicates(duplicates);
    setPreviewSource(source);
    setPreviewModel(usedModel);
    setPreviewOpen(true);
    setActionModal(null);
  }

  function closePreview() {
    if (saving) return;
    setPreviewOpen(false);
    setPreviewCases([]);
    setPreviewDuplicates([]);
  }

  async function onGenerate(e: FormEvent) {
    e.preventDefault();
    if (!providerEnabled) {
      setError(
        `Enable ${aiProvider === 'claude' ? 'Claude' : 'OpenRouter'} in header → AI setup.`,
      );
      return;
    }
    if (!hasActiveKey) {
      // Continue — server may use OPENROUTER_API_KEY / ANTHROPIC_API_KEY from .env.local
    }
    if (!prompt.trim()) {
      setError('Enter a prompt describing the flow to generate.');
      return;
    }
    setGenerating(true);
    setError('');
    setMessage('');
    setInspectSessionId(null);
    setAiLog([
      {
        id: `start-${Date.now()}`,
        at: formatLogTime(),
        message: `Generate started — ${aiProvider === 'claude' ? 'Claude' : 'OpenRouter'}…`,
        level: 'info',
      },
    ]);

    try {
      const res = await fetch('/api/tests/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          baseUrl,
          apiUrl,
          model,
          provider: aiProvider,
          role: flowRole,
          stream: true,
          liveInspect,
          roleCredentials: roleCredentialsForRun(),
          ...aiKeysForRun(),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.error === 'string' ? data.error : `Generate failed (HTTP ${res.status})`,
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let donePayload:
        | {
            cases: WebTestCase[];
            duplicates?: DuplicatePreview[];
            model?: string;
            message?: string;
            alreadyExists?: boolean;
          }
        | undefined;
      let streamError: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: {
            type?: string;
            message?: string;
            model?: string;
            cases?: WebTestCase[];
            novel?: WebTestCase[];
            duplicates?: DuplicatePreview[];
            alreadyExists?: boolean;
            inspectSessionId?: string;
            at?: string;
          };
          try {
            event = JSON.parse(trimmed) as typeof event;
          } catch {
            pushAiLog(trimmed, 'info');
            continue;
          }
          if (event.inspectSessionId) {
            setInspectSessionId(event.inspectSessionId);
          }
          if (event.type === 'inspect_session' && event.inspectSessionId) {
            setInspectSessionId(event.inspectSessionId);
          }
          const msg = event.message || event.type || 'Working…';
          pushAiLog(msg, levelForEventType(event.type), event.at);
          if (event.type === 'done') {
            donePayload = {
              cases: event.novel || event.cases || [],
              duplicates: event.duplicates || [],
              model: event.model,
              message: event.message,
              alreadyExists: event.alreadyExists,
            };
          }
          if (event.type === 'error') {
            streamError = event.message || 'Generate failed';
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!donePayload) throw new Error('AI stream ended without a result');
      const cases = donePayload.cases;
      const duplicates = donePayload.duplicates || [];
      if (!cases.length && !duplicates.length) {
        throw new Error('AI did not return any valid test cases');
      }

      openPreview(cases, 'claude', donePayload.model, duplicates);
      if (donePayload.alreadyExists || (!cases.length && duplicates.length)) {
        setMessage(
          donePayload.message ||
            `Already in library — ${duplicates.length} match(es) shown.`,
        );
      } else if (duplicates.length) {
        setMessage(
          `Generated ${cases.length} new case(s)${donePayload.model ? ` via ${donePayload.model}` : ''}; ${duplicates.length} already existed. Review and save new ones.`,
        );
      } else {
        setMessage(
          `Generated ${cases.length} case(s)${donePayload.model ? ` via ${donePayload.model}` : ''}. Review and save selection.`,
        );
      }
      setAiLog([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generate failed';
      pushAiLog(msg, 'error');
      setError(msg);
      setActionModal(null);
      setAiLog([]);
    } finally {
      setGenerating(false);
    }
  }

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!providerEnabled) {
      setError(
        `Enable ${aiProvider === 'claude' ? 'Claude' : 'OpenRouter'} in header → AI setup.`,
      );
      return;
    }
    if (!hasActiveKey) {
      // Continue — server may use keys from .env.local
    }
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a .json, .md, .txt, or .py (Python Playwright) file to upload.');
      return;
    }
    setUploading(true);
    setError('');
    setMessage('');
    setInspectSessionId(null);
    setAiLog([
      {
        id: `upload-start-${Date.now()}`,
        at: formatLogTime(),
        message: liveInspect
          ? `Import started — live MCP inspect then ${aiProvider === 'claude' ? 'Claude' : 'OpenRouter'}…`
          : `Import started — parse / ${aiProvider === 'claude' ? 'Claude' : 'OpenRouter'} normalize…`,
        level: 'info',
      },
    ]);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('baseUrl', baseUrl);
      form.append('apiUrl', apiUrl);
      form.append('model', model);
      form.append('provider', aiProvider);
      const keys = aiKeysForRun();
      if (keys.openRouterApiKey) form.append('openRouterApiKey', keys.openRouterApiKey);
      if (keys.anthropicApiKey) form.append('anthropicApiKey', keys.anthropicApiKey);
      form.append('stream', 'true');
      form.append('liveInspect', liveInspect ? 'true' : 'false');
      form.append('roleCredentials', JSON.stringify(roleCredentialsForRun()));
      if (flowRole) form.append('role', flowRole);

      const res = await fetch('/api/tests/upload', { method: 'POST', body: form });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.error === 'string' ? data.error : `Upload failed (HTTP ${res.status})`,
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let donePayload:
        | {
            cases: WebTestCase[];
            duplicates?: DuplicatePreview[];
            model?: string;
            message?: string;
            alreadyExists?: boolean;
          }
        | undefined;
      let streamError: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: {
            type?: string;
            message?: string;
            model?: string;
            cases?: WebTestCase[];
            novel?: WebTestCase[];
            duplicates?: DuplicatePreview[];
            alreadyExists?: boolean;
            inspectSessionId?: string;
            at?: string;
          };
          try {
            event = JSON.parse(trimmed) as typeof event;
          } catch {
            pushAiLog(trimmed, 'info');
            continue;
          }
          if (event.inspectSessionId) {
            setInspectSessionId(event.inspectSessionId);
          }
          if (event.type === 'inspect_session' && event.inspectSessionId) {
            setInspectSessionId(event.inspectSessionId);
          }
          const msg = event.message || event.type || 'Working…';
          pushAiLog(msg, levelForEventType(event.type), event.at);
          if (event.type === 'done') {
            donePayload = {
              cases: event.novel || event.cases || [],
              duplicates: event.duplicates || [],
              model: event.model,
              message: event.message,
              alreadyExists: event.alreadyExists,
            };
          }
          if (event.type === 'error') {
            streamError = event.message || 'Upload failed';
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!donePayload) throw new Error('Import stream ended without a result');
      const cases = donePayload.cases;
      const duplicates = donePayload.duplicates || [];
      if (!cases.length && !duplicates.length) {
        throw new Error('Could not parse any valid web test cases from upload');
      }

      openPreview(cases, 'upload', donePayload.model, duplicates);
      setActionModal(null);
      if (donePayload.alreadyExists || (!cases.length && duplicates.length)) {
        setMessage(
          donePayload.message ||
            `Already in library — ${duplicates.length} match(es) shown.`,
        );
      } else if (duplicates.length) {
        setMessage(
          `Imported ${cases.length} new case(s)${donePayload.model ? ` via ${donePayload.model}` : ''}; ${duplicates.length} already existed. Review and save new ones.`,
        );
      } else {
        setMessage(
          donePayload.message ||
            `Imported ${cases.length} case(s)${donePayload.model ? ` via ${donePayload.model}` : ''}. Review and save selection.`,
        );
      }
      if (fileRef.current) fileRef.current.value = '';
      setFileName('');
      setAiLog([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      pushAiLog(msg, 'error');
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  function assignUploadFile(file: File | undefined | null) {
    if (!file || !fileRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileRef.current.files = dt.files;
    setFileName(file.name);
    setError('');
  }

  async function onSaveSelected(selected: WebTestCase[]) {
    if (!selected.length) {
      setError('Select at least one test case to save.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tests/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases: selected, source: previewSource }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      const added = (data.added || []) as string[];
      const replaced = (data.replaced || []) as string[];
      const used = previewModel ? ` via ${previewModel}` : '';
      setMessage(
        `Saved ${added.length + replaced.length} case(s)${used}: ${added.length} added, ${replaced.length} replaced.`,
      );
      setPrompt('');
      setPreviewOpen(false);
      setPreviewCases([]);
      setPreviewDuplicates([]);
      onApplied((data.cases || []) as TestCaseMeta[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const busy = generating || uploading || saving;
  const short = modelShortLabel(model, aiProvider, models);
  const modelOptions =
    aiProvider === 'claude'
      ? CLAUDE_MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note, rating: m.rating }))
      : models;

  const modelPill = (
    <div className="ai-model-pill-wrap" ref={menuRef}>
      <button
        type="button"
        className={`ai-model-pill ${menuOpen ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        disabled={busy || !canUseAi}
        onClick={() => setMenuOpen((v) => !v)}
        title={
          aiProvider === 'claude' ? 'Change Claude model' : 'Change OpenRouter model'
        }
      >
        <span className="ai-model-pill-icon" aria-hidden>
          {aiProvider === 'claude' ? '◈' : '∞'}
        </span>
        <span className="ai-model-pill-label">{short}</span>
        <span className="ai-model-pill-chevron" aria-hidden>
          ▾
        </span>
      </button>

      {menuOpen ? (
        <ul
          className="ai-model-menu"
          role="listbox"
          aria-label={aiProvider === 'claude' ? 'Claude model' : 'OpenRouter model'}
        >
          {aiProvider === 'openrouter' ? (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={model === OPENROUTER_AUTO}
                className={model === OPENROUTER_AUTO ? 'active' : ''}
                onClick={() => onModelChange(OPENROUTER_AUTO)}
              >
                <span className="ai-model-menu-title">Auto</span>
                <span className="ai-model-menu-sub">Switch free models on failure</span>
              </button>
            </li>
          ) : null}
          {modelOptions.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={model === m.id}
                className={model === m.id ? 'active' : ''}
                onClick={() => onModelChange(m.id)}
              >
                <span className="ai-model-menu-title">{m.label}</span>
                <span className="ai-model-menu-sub">
                  {m.rating} · {m.note}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const generateForm = (
    <form className="ai-card ai-composer" onSubmit={onGenerate}>
      {layout !== 'header' ? <h2 className="ai-card-title">Generate with AI</h2> : null}
      {!canUseAi ? (
        <p className="error-text">
          Active provider is disabled — turn on OpenRouter or Claude in header → AI setup.
        </p>
      ) : null}
      <p className="field-hint">
        Describe a portal flow. Exact matches show as already added; otherwise AI creates a new
        case. With <strong>Live page inspect</strong>, Playwright opens the portal, reads real
        buttons (data-id / data-testid / id / formControlName), then generates steps.
      </p>
      <label className="ai-live-inspect-toggle">
        <input
          type="checkbox"
          checked={liveInspect}
          onChange={(e) => setLiveInspect(e.target.checked)}
          disabled={generating}
        />
        <span>Live page inspect (open portal + capture selectors)</span>
      </label>
      <div className="ai-composer-box">
        <textarea
          className="ai-textarea ai-composer-input"
          rows={4}
          placeholder="Plan a buyer cart flow, or describe steps to generate…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={generating}
        />
        <div className="ai-composer-toolbar">
          {modelPill}
          <button
            type="submit"
            className="btn btn-primary ai-composer-go"
            disabled={generating || !canUseAi}
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {generating || aiLog.length ? (
        <div className="ai-generate-live-row">
          {liveInspect ? (
            <div className="ai-inspect-mcp">
              <McpLiveView
                runId={inspectSessionId}
                active={generating && liveInspect}
                title="MCP · live page inspect"
                idleHint="Waiting for Playwright to open the portal and highlight controls…"
              />
            </div>
          ) : null}
          <div className="ai-live-log" aria-live="polite" aria-busy={generating}>
            <div className="ai-live-log-header">
              <span className={`ai-live-log-pulse ${generating ? 'on' : ''}`} aria-hidden />
              <strong>{generating ? 'AI working…' : 'AI log'}</strong>
              <span className="ai-live-log-meta">
                {generating
                  ? liveInspect
                    ? 'inspect + highlight + generate'
                    : 'models may take a minute'
                  : 'idle'}
              </span>
            </div>
            <ul className="ai-live-log-list">
              {aiLog.map((line) => (
                <li key={line.id} className={`ai-live-log-line level-${line.level}`}>
                  <time>{line.at}</time>
                  <span>{line.message}</span>
                </li>
              ))}
              <div ref={logEndRef} />
            </ul>
          </div>
        </div>
      ) : null}
    </form>
  );

  const uploadForm = (
    <form className="ai-card" onSubmit={onUpload}>
      {layout !== 'header' ? <h2 className="ai-card-title">Upload test cases</h2> : null}
      <p className="field-hint">
        Drop JSON, Markdown, text, or a <strong>Python Playwright</strong> (
        <code>.py</code>) file. With <strong>Live page inspect</strong>, Playwright opens the
        portal (MCP view), then AI normalizes steps with real selectors.
      </p>
      <label className="ai-live-inspect-toggle">
        <input
          type="checkbox"
          checked={liveInspect}
          onChange={(e) => setLiveInspect(e.target.checked)}
          disabled={uploading}
        />
        <span>Live page inspect + AI normalize (MCP view while importing)</span>
      </label>
      {layout === 'header' ? <div className="ai-upload-model-row">{modelPill}</div> : null}

      <input
        ref={fileRef}
        className="upload-input-hidden"
        type="file"
        accept=".json,.md,.txt,.markdown,.py,application/json,text/plain,text/markdown,text/x-python,application/x-python"
        disabled={uploading}
        onChange={(e) => assignUploadFile(e.target.files?.[0])}
      />

      <button
        type="button"
        className={`upload-dropzone ${dragOver ? 'drag-over' : ''} ${fileName ? 'has-file' : ''}`}
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          assignUploadFile(e.dataTransfer.files?.[0]);
        }}
      >
        <span className="upload-dropzone-icon" aria-hidden>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 16V7m0 0l-3.5 3.5M12 7l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 16.5V18a2 2 0 002 2h10a2 2 0 002-2v-1.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="upload-dropzone-title">
          {fileName ? fileName : 'Drag & drop your file here'}
        </span>
        <span className="upload-dropzone-sub">
          {fileName
            ? 'Click to choose a different file'
            : 'JSON · Markdown · TXT · Python (.py)  ·  click to browse'}
        </span>
      </button>

      <button type="submit" className="btn btn-primary" disabled={uploading || !fileName}>
        {uploading
          ? liveInspect
            ? 'Inspecting + AI…'
            : 'Parsing…'
          : 'Upload & review'}
      </button>

      {uploading || aiLog.length ? (
        <div className="ai-generate-live-row">
          {liveInspect ? (
            <div className="ai-inspect-mcp">
              <McpLiveView
                runId={inspectSessionId}
                active={uploading && liveInspect}
                title="MCP · import live inspect"
                idleHint="Waiting for Playwright to open the portal while importing…"
              />
            </div>
          ) : null}
          <div className="ai-live-log" aria-live="polite" aria-busy={uploading}>
            <div className="ai-live-log-header">
              <span className={`ai-live-log-pulse ${uploading ? 'on' : ''}`} aria-hidden />
              <strong>{uploading ? 'Import working…' : 'Import log'}</strong>
              <span className="ai-live-log-meta">
                {uploading
                  ? liveInspect
                    ? 'MCP inspect + AI normalize'
                    : 'parse / AI'
                  : 'idle'}
              </span>
            </div>
            <ul className="ai-live-log-list">
              {aiLog.map((line) => (
                <li key={line.id} className={`ai-live-log-line level-${line.level}`}>
                  <time>{line.at}</time>
                  <span>{line.message}</span>
                </li>
              ))}
              <div ref={logEndRef} />
            </ul>
          </div>
        </div>
      ) : null}
    </form>
  );

  const statusLine =
    error || message ? (
      <div className="ai-status-line">
        {error ? (
          <div className="ai-error-banner" role="alert">
            <strong>{generating ? 'AI generate failed' : 'Upload / import failed'}</strong>
            <pre className="ai-error-pre">{error}</pre>
          </div>
        ) : null}
        {message ? <p className="ai-success">{message}</p> : null}
      </div>
    ) : null;

  const previewModal = (
    <TestCaseSelectModal
      open={previewOpen}
      cases={previewCases}
      duplicates={previewDuplicates}
      title={
        previewCases.length === 0 && previewDuplicates.length > 0
          ? 'Already in library'
          : previewSource === 'upload'
            ? 'Review uploaded test cases'
            : 'Review generated test cases'
      }
      saving={saving}
      showProductFilters={flowRole === 'buyer'}
      baseUrl={baseUrl}
      apiUrl={apiUrl}
      flowRole={flowRole}
      model={model}
      onCancel={closePreview}
      onSave={onSaveSelected}
      onCaseUpdated={(next) => {
        setPreviewCases((prev) => {
          const idx = prev.findIndex((c) => c.id === next.id);
          if (idx < 0) return [...prev, next];
          const copy = [...prev];
          copy[idx] = next;
          return copy;
        });
      }}
      onCasesChange={(next) => setPreviewCases(next)}
    />
  );

  if (layout === 'header') {
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
              setAiLog([]);
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
              setAiLog([]);
              setInspectSessionId(null);
              setActionModal('upload');
            }}
          >
            Upload test
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              setError('');
              setMessage('');
              setAiLog([]);
              setActionModal('mcp-click');
            }}
          >
            MCP click flow
          </button>
        </div>

        {statusLine}

        {actionModal === 'mcp-click' ? (
          <McpClickFlowModal
            open
            baseUrl={baseUrl}
            apiUrl={apiUrl}
            flowRole={flowRole}
            model={model}
            models={modelOptions}
            provider={aiProvider}
            onModelChange={onModelChange}
            onClose={() => setActionModal(null)}
            onError={(msg) => setError(msg)}
            onGenerated={(cases, usedModel, msg) => {
              if (!cases.length) {
                setError(msg || 'No new test cases from MCP click flow');
                return;
              }
              openPreview(cases, 'claude', usedModel);
              setMessage(
                msg ||
                  `Generated ${cases.length} case(s) from MCP click flow${usedModel ? ` via ${usedModel}` : ''}. Review and save.`,
              );
            }}
          />
        ) : null}

        {actionModal === 'generate' || actionModal === 'upload' ? (
          <div
            className="report-modal-root ai-action-modal-root"
            role="dialog"
            aria-modal="true"
            aria-label={actionModal === 'generate' ? 'Generate with AI' : 'Upload test cases'}
          >
            <div
              className="report-modal-backdrop"
              onClick={busy ? undefined : () => setActionModal(null)}
            />
            <div
              className={`ai-action-modal${
                actionModal === 'generate' || actionModal === 'upload'
                  ? ' ai-action-modal-wide'
                  : ''
              }`}
            >
              <div className="ai-action-modal-header">
                <div className="modal-header-copy">
                  <h2>{actionModal === 'generate' ? 'Generate with AI' : 'Upload test cases'}</h2>
                </div>
                <ModalCloseButton
                  disabled={busy}
                  onClick={() => setActionModal(null)}
                />
              </div>
              <div className="ai-action-modal-body">
                {actionModal === 'generate' ? generateForm : uploadForm}
              </div>
            </div>
          </div>
        ) : null}

        {previewModal}
      </>
    );
  }

  return (
    <section className="ai-panel">
      <div className="ai-panel-grid">
        {generateForm}
        {uploadForm}
      </div>
      <div className="flow-header-actions" style={{ marginTop: '0.75rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            setError('');
            setMessage('');
            setActionModal('mcp-click');
          }}
        >
          MCP click flow
        </button>
      </div>
      {statusLine}
      {actionModal === 'mcp-click' ? (
        <McpClickFlowModal
          open
          baseUrl={baseUrl}
          apiUrl={apiUrl}
          flowRole={flowRole}
          model={model}
          models={modelOptions}
          provider={aiProvider}
          onModelChange={onModelChange}
          onClose={() => setActionModal(null)}
          onError={(msg) => setError(msg)}
          onGenerated={(cases, usedModel, msg) => {
            if (!cases.length) {
              setError(msg || 'No new test cases from MCP click flow');
              return;
            }
            openPreview(cases, 'claude', usedModel);
            setMessage(
              msg ||
                `Generated ${cases.length} case(s) from MCP click flow${usedModel ? ` via ${usedModel}` : ''}. Review and save.`,
            );
          }}
        />
      ) : null}
      {previewModal}
    </section>
  );
}
