'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { McpLiveView } from '@/components/McpLiveView';
import { roleCredentialsForRun } from '@/lib/role-credentials';
import { aiKeysForRun, activeProviderHasKey } from '@/lib/ai-keys';
import {
  OPENROUTER_AUTO,
  type OpenRouterModelOption,
} from '@/lib/openrouter-models';
import { CLAUDE_MODELS, type AiProviderId } from '@/lib/ai-provider';
import type { VaptTestCase } from '@/lib/types';

type RecordedEvent = {
  id: string;
  at: string;
  action: string;
  label: string;
  url?: string;
  path?: string;
};

type Status = 'idle' | 'starting' | 'recording' | 'generating';

function uniquePathsFromEvents(events: RecordedEvent[], baseUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ev of events) {
    if (ev.action !== 'page' && ev.action !== 'goto' && ev.action !== 'assertUrl') continue;
    let path = (ev.path || '').trim();
    if (!path && ev.url) {
      try {
        const u = new URL(ev.url, baseUrl);
        path = `${u.pathname}${u.search}` || '/';
      } catch {
        path = ev.url;
      }
    }
    if (!path) continue;
    if (!path.startsWith('http') && !path.startsWith('/')) path = `/${path}`;
    const key = path.replace(/\/+$/, '') || '/';
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path.startsWith('http') ? path : path || '/');
  }
  return out.slice(0, 20);
}

type Props = {
  open: boolean;
  baseUrl: string;
  apiUrl: string;
  model: string;
  models: OpenRouterModelOption[];
  provider: AiProviderId;
  onModelChange: (model: string) => void;
  onClose: () => void;
  onError: (message: string) => void;
  onGenerated: (cases: VaptTestCase[], model?: string, message?: string) => void;
};

export function VaptMcpDiscoverModal({
  open,
  baseUrl,
  apiUrl,
  model,
  models,
  provider,
  onModelChange,
  onClose,
  onError,
  onGenerated,
}: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [currentUrl, setCurrentUrl] = useState('');
  const [startPath, setStartPath] = useState('/');
  const [busyAction, setBusyAction] = useState(false);
  const [hint, setHint] = useState(
    'Browse the portal in MCP — visited paths become VAPT probe targets.',
  );
  const [log, setLog] = useState<string[]>([]);
  const pollRef = useRef<number | null>(null);

  const paths = uniquePathsFromEvents(events, baseUrl);

  const stopSession = useCallback(async (id?: string | null) => {
    const sid = id ?? sessionId;
    if (!sid) return;
    try {
      await fetch(`/api/tests/record?sessionId=${encodeURIComponent(sid)}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
  }, [sessionId]);

  const resetLocal = useCallback(() => {
    setStatus('idle');
    setSessionId(null);
    setEvents([]);
    setCurrentUrl('');
    setBusyAction(false);
    setLog([]);
    setHint('Browse the portal in MCP — visited paths become VAPT probe targets.');
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (status === 'generating' || status === 'starting') return;
      e.stopPropagation();
      void (async () => {
        await stopSession();
        resetLocal();
        onClose();
      })();
    }
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, status, stopSession, resetLocal, onClose]);

  useEffect(() => {
    if (!open || !sessionId || status !== 'recording') {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch(`/api/tests/record/${sessionId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const next = (data.session?.events || data.events || []) as RecordedEvent[];
        setEvents(next);
        if (data.session?.currentUrl || data.url) {
          setCurrentUrl(data.session?.currentUrl || data.url);
        }
      } catch {
        // ignore
      }
    };
    void poll();
    pollRef.current = window.setInterval(() => void poll(), 1200);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, sessionId, status]);

  useEffect(() => {
    if (open) return;
    void stopSession();
    resetLocal();
  }, [open, stopSession, resetLocal]);

  if (!open) return null;

  async function startBrowsing(e?: FormEvent) {
    e?.preventDefault();
    if (!baseUrl.trim()) {
      onError('Set a portal URL before MCP discover.');
      return;
    }
    setStatus('starting');
    setHint('Launching MCP browser…');
    setEvents([]);
    setLog(['Starting MCP session…']);
    try {
      const res = await fetch('/api/tests/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          startPath: startPath.trim() || '/',
          hint: 'vapt-url-discover',
          roleCredentials: roleCredentialsForRun(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to start MCP');
      }
      setSessionId(data.sessionId as string);
      setEvents((data.session?.events || []) as RecordedEvent[]);
      setCurrentUrl(data.session?.currentUrl || '');
      setStatus('recording');
      setHint('Click around in MCP live view. Each page you open is collected for VAPT scenarios.');
      setLog((prev) => [...prev, 'Recording — browse pages, then Generate VAPT cases.']);
    } catch (err) {
      setStatus('idle');
      onError(err instanceof Error ? err.message : 'Failed to start MCP');
    }
  }

  async function postAction(payload: Record<string, unknown>) {
    if (!sessionId) return;
    setBusyAction(true);
    try {
      const res = await fetch(`/api/tests/record/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Action failed');
      }
      setEvents((data.session?.events || data.events || []) as RecordedEvent[]);
      if (data.session?.currentUrl || data.url) {
        setCurrentUrl(data.session?.currentUrl || data.url);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyAction(false);
    }
  }

  async function onGenerate() {
    if (!activeProviderHasKey(provider)) {
      onError(
        `No ${provider === 'claude' ? 'Claude' : 'OpenRouter'} key — open header → AI setup.`,
      );
      return;
    }
    if (!paths.length) {
      onError('Browse at least one page in MCP before generating VAPT cases.');
      return;
    }
    setStatus('generating');
    setHint('Generating VAPT scenarios from visited paths…');
    setLog((prev) => [...prev, `AI generate for ${paths.length} path(s)…`]);
    try {
      const res = await fetch('/api/tests/vapt/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Create passive VAPT probe scenarios for these MCP-visited portal paths. Prefer relative paths. Map paths to checks like security-headers, cookie-flags, unauth-sensitive, or api-location as appropriate.`,
          baseUrl,
          apiUrl,
          model: model || OPENROUTER_AUTO,
          provider,
          stream: false,
          visitedPaths: paths,
          intent: 'both',
          profile: 'higher',
          ...aiKeysForRun(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Generate failed');
      }
      const cases = (data.cases || []) as VaptTestCase[];
      if (!cases.length) throw new Error(data.message || 'No VAPT cases returned');
      await stopSession();
      resetLocal();
      onGenerated(
        cases,
        data.model,
        data.message || `Generated ${cases.length} VAPT scenario(s) from MCP paths.`,
      );
      onClose();
    } catch (err) {
      setStatus('recording');
      onError(err instanceof Error ? err.message : 'Generate failed');
    }
  }

  async function handleClose() {
    if (status === 'generating' || status === 'starting') return;
    await stopSession();
    resetLocal();
    onClose();
  }

  const modelOptions =
    provider === 'claude'
      ? CLAUDE_MODELS
      : [{ id: OPENROUTER_AUTO, label: 'Auto', note: '', rating: '' }, ...models];

  const modal = (
    <div
      className="report-modal-root ai-action-modal-root"
      role="dialog"
      aria-modal="true"
      aria-label="MCP discover VAPT URLs"
    >
      <div className="report-modal-backdrop" onClick={() => void handleClose()} />
      <div className="ai-action-modal ai-action-modal-wide load-mcp-modal">
        <div className="ai-action-modal-header">
          <div className="modal-header-copy">
            <h2>MCP · discover VAPT URLs</h2>
            <p className="history-meta">{hint}</p>
          </div>
          <ModalCloseButton
            disabled={status === 'generating' || status === 'starting'}
            onClick={() => void handleClose()}
          />
        </div>

        <div className="ai-action-modal-body load-mcp-body">
          <div className="load-mcp-sidebar">
            {status === 'idle' || status === 'starting' ? (
              <form className="creds-form" onSubmit={(e) => void startBrowsing(e)}>
                <label>
                  Start path
                  <input
                    type="text"
                    value={startPath}
                    onChange={(e) => setStartPath(e.target.value)}
                    placeholder="/"
                    disabled={status === 'starting'}
                  />
                </label>
                <label>
                  AI model
                  <select
                    value={model}
                    onChange={(e) => onModelChange(e.target.value)}
                    disabled={status === 'starting'}
                  >
                    {modelOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={status === 'starting'}
                >
                  {status === 'starting' ? 'Starting…' : 'Open MCP browser'}
                </button>
              </form>
            ) : (
              <>
                <p className="field-hint">
                  Current: <code>{currentUrl || '—'}</code>
                </p>
                <p className="field-hint">
                  Captured paths ({paths.length}):
                </p>
                <ul className="load-mcp-path-list">
                  {paths.length ? (
                    paths.map((p) => (
                      <li key={p}>
                        <code>{p}</code>
                      </li>
                    ))
                  ) : (
                    <li className="field-hint">Navigate pages to collect paths…</li>
                  )}
                </ul>
                <div className="creds-actions" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={status === 'generating' || !paths.length}
                    onClick={() => void onGenerate()}
                  >
                    {status === 'generating' ? 'Generating…' : 'Generate VAPT cases'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={status === 'generating' || busyAction}
                    onClick={() => void postAction({ action: 'goto', url: '/' })}
                  >
                    Go home
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={status === 'generating'}
                    onClick={() => void handleClose()}
                  >
                    Stop
                  </button>
                </div>
              </>
            )}

            {log.length ? (
              <ul className="ai-live-log-list" style={{ marginTop: '0.75rem' }}>
                {log.map((line, i) => (
                  <li key={`${i}-${line.slice(0, 20)}`}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="load-mcp-view">
            <McpLiveView
              runId={sessionId}
              active={Boolean(sessionId) && (status === 'recording' || status === 'generating')}
              title="MCP · live portal"
              idleHint="Start MCP browser to watch and click the portal."
              interactive={status === 'recording'}
              clickBusy={busyAction}
              onViewClick={(nx, ny) => void postAction({ action: 'click', nx, ny })}
              onViewKey={(payload) =>
                void postAction(
                  payload.type === 'press'
                    ? { action: 'press', key: payload.key }
                    : { action: 'type', text: payload.text },
                )
              }
            />
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
