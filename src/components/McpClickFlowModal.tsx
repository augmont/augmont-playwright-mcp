'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { McpLiveView } from '@/components/McpLiveView';
import { FlowChartEditor } from '@/components/FlowChartEditor';
import { McpClickFlowGuideModal } from '@/components/McpClickFlowGuideModal';
import { roleCredentialsForRun, readRoleCredentials } from '@/lib/role-credentials';
import { aiKeysForRun, activeProviderHasKey } from '@/lib/ai-keys';
import type { WebTestCase } from '@/lib/types';
import {
  OPENROUTER_AUTO,
  type OpenRouterModelOption,
} from '@/lib/openrouter-models';
import type { AiProviderId } from '@/lib/ai-provider';
import type { FlowChartNode } from '@/lib/flow-chart';
import {
  applyBranchedFlowToPair,
  countFlowChartSteps,
  eventsToFlowNodes,
  mergePairIntoBranchedChart,
  stepsToFlowNodes,
} from '@/lib/flow-chart';
import {
  ensureCombinedSuites,
  resolveExpectation,
} from '@/lib/test-expectation';
import { SuitePairFlowChart, pickSuitePair } from '@/components/SuitePairFlowChart';

type RecordedEvent = {
  id: string;
  at: string;
  action: string;
  label: string;
  url?: string;
  path?: string;
  selector?: string;
  text?: string;
  value?: string;
};

type ViewTab = 'mcp' | 'flowchart' | 'suite';

type Props = {
  open: boolean;
  baseUrl: string;
  apiUrl: string;
  flowRole?: 'public' | 'buyer' | 'seller' | 'admin';
  model: string;
  models: OpenRouterModelOption[];
  provider?: AiProviderId;
  onModelChange: (model: string) => void;
  onClose: () => void;
  onGenerated: (cases: WebTestCase[], model?: string, message?: string) => void;
  onError: (message: string) => void;
};

type ValidateState = {
  proper: boolean;
  score: number;
  summary: string;
  issues: string[];
  suggestions: string[];
  message: string;
} | null;

export function McpClickFlowModal({
  open,
  baseUrl,
  apiUrl,
  flowRole,
  model,
  models,
  provider = 'openrouter',
  onModelChange,
  onClose,
  onGenerated,
  onError,
}: Props) {
  const [name, setName] = useState('');
  const [functionality, setFunctionality] = useState('');
  const [description, setDescription] = useState('');
  const [startPath, setStartPath] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [status, setStatus] = useState<
    'idle' | 'starting' | 'recording' | 'generating' | 'review' | 'validating'
  >('idle');
  const [fillValue, setFillValue] = useState('');
  const [gotoPath, setGotoPath] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [focusedSelector, setFocusedSelector] = useState('');
  const [loggedInAs, setLoggedInAs] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [hint, setHint] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [viewTab, setViewTab] = useState<ViewTab>('mcp');
  const [flowNodes, setFlowNodes] = useState<FlowChartNode[]>(() =>
    eventsToFlowNodes([]),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [flowDirty, setFlowDirty] = useState(false);
  const [draftCases, setDraftCases] = useState<WebTestCase[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [validateResult, setValidateResult] = useState<ValidateState>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [modelInfoOpen, setModelInfoOpen] = useState(false);
  const eventsLenRef = useRef(0);

  const busy =
    status === 'starting' ||
    status === 'generating' ||
    status === 'validating' ||
    busyAction;

  const resetLocal = useCallback(() => {
    setName('');
    setFunctionality('');
    setDescription('');
    setStartPath('');
    setSessionId(null);
    setEvents([]);
    setStatus('idle');
    setFillValue('');
    setGotoPath('');
    setLoginEmail('');
    setLoginPassword('');
    setFocusedSelector('');
    setLoggedInAs('');
    setBusyAction(false);
    setHint('');
    setCurrentUrl('');
    setViewTab('mcp');
    setFlowNodes(eventsToFlowNodes([]));
    setSelectedNodeId(null);
    setFlowDirty(false);
    setDraftCases([]);
    setActiveDraftId(null);
    setValidateResult(null);
    eventsLenRef.current = 0;
  }, []);

  const stopSession = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      await fetch(`/api/tests/record/${id}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
  }, []);

  /** Keep flowchart in sync with newly recorded events unless user edited it. */
  useEffect(() => {
    if (status === 'review' || status === 'validating') return;
    const actionable = events.filter((e) => e.action !== 'page');
    const prevLen = eventsLenRef.current;
    if (flowDirty && actionable.length <= prevLen) return;
    setFlowNodes(eventsToFlowNodes(events));
    eventsLenRef.current = actionable.length;
    if (actionable.length > prevLen) setFlowDirty(false);
  }, [events, status, flowDirty]);

  useEffect(() => {
    if (!open) return;
    try {
      const creds = readRoleCredentials();
      const roleKey =
        flowRole === 'buyer' || flowRole === 'admin' || flowRole === 'seller'
          ? flowRole
          : undefined;
      const c = roleKey ? creds[roleKey] : undefined;
      if (c?.email) setLoginEmail(c.email);
      if (c?.password) setLoginPassword(c.password);
    } catch {
      // ignore
    }
  }, [open, flowRole]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (guideOpen) return;
      if (
        e.key === 'Escape' &&
        status !== 'generating' &&
        status !== 'starting' &&
        status !== 'validating'
      ) {
        void (async () => {
          await stopSession(sessionId);
          resetLocal();
          onClose();
        })();
      }
    }
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, status, sessionId, stopSession, resetLocal, onClose, guideOpen]);

  if (!open) return null;

  function onFlowChange(next: FlowChartNode[]) {
    setFlowDirty(true);
    setFlowNodes(next);
    setValidateResult(null);
    if (draftCases.length) {
      setDraftCases((prev) => applyBranchedFlowToPair(prev, next));
      setHint(
        'Flow chart edited — Positive & Negative suite updated from the fork paths. Validate when ready.',
      );
    }
  }

  async function startRecording(e?: FormEvent) {
    e?.preventDefault();
    if (!baseUrl.trim()) {
      onError('Set a portal URL before starting MCP click flow.');
      return;
    }
    setStatus('starting');
    setHint('Launching MCP browser…');
    setEvents([]);
    setFlowDirty(false);
    setDraftCases([]);
    setActiveDraftId(null);
    setValidateResult(null);
    eventsLenRef.current = 0;
    try {
      const res = await fetch('/api/tests/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          role: flowRole,
          startPath: startPath.trim() || undefined,
          hint: name.trim() || functionality.trim() || flowRole || '',
          name: name.trim() || undefined,
          roleCredentials: roleCredentialsForRun(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to start MCP');
      }
      const nextEvents = (data.session?.events || []) as RecordedEvent[];
      setSessionId(data.sessionId as string);
      setEvents(nextEvents);
      setFlowNodes(eventsToFlowNodes(nextEvents));
      setCurrentUrl(data.session?.currentUrl || '');
      setLoggedInAs(data.loggedInAs || data.session?.loggedInAs || '');
      setStatus('recording');
      setViewTab('mcp');
      setHint(
        data.loggedInAs
          ? `Recording · logged in as ${data.loggedInAs}. Click fields in MCP, then type — or use Login / Fill below.`
          : 'Recording · click MCP fields to focus, type on the keyboard, or use Login / Fill to enter details.',
      );
    } catch (err) {
      setStatus('idle');
      onError(err instanceof Error ? err.message : 'Failed to start MCP click flow');
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
      if (typeof data.session?.lastFocusedSelector === 'string') {
        setFocusedSelector(data.session.lastFocusedSelector);
      }
      if (typeof data.session?.loggedInAs === 'string' && data.session.loggedInAs) {
        setLoggedInAs(data.session.loggedInAs);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyAction(false);
    }
  }

  async function onViewClick(nx: number, ny: number) {
    if (status !== 'recording' || busyAction) return;
    setHint(`Click captured @ ${(nx * 100).toFixed(0)}%, ${(ny * 100).toFixed(0)}%…`);
    await postAction({ action: 'click', nx, ny });
    setHint('Field focused — type on keyboard, or Fill / Login below.');
  }

  async function onViewKey(payload: { type: 'type' | 'press'; text?: string; key?: string }) {
    if (status !== 'recording' || busyAction) return;
    if (payload.type === 'type' && payload.text) {
      await postAction({ action: 'type', text: payload.text });
      return;
    }
    if (payload.type === 'press' && payload.key) {
      await postAction({ action: 'press', key: payload.key });
    }
  }

  async function onLoginInMcp(e?: FormEvent) {
    e?.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      onError('Enter email/mobile and password to login in MCP.');
      return;
    }
    setHint('Logging in via MCP…');
    await postAction({
      action: 'login',
      email: loginEmail.trim(),
      password: loginPassword,
      loginRole: flowRole && flowRole !== 'public' ? flowRole : undefined,
    });
    setHint('Login submitted in MCP. Continue capturing the flow.');
  }

  async function onFill(e: FormEvent) {
    e.preventDefault();
    if (!fillValue) return;
    await postAction({
      action: 'fill',
      value: fillValue,
      selector: focusedSelector || undefined,
    });
    setFillValue('');
    setHint('Fill recorded into focused field.');
  }

  async function onGoto(e: FormEvent) {
    e.preventDefault();
    if (!(gotoPath || '').trim()) return;
    await postAction({ action: 'goto', url: gotoPath.trim() });
    setGotoPath('');
    setHint('Navigation recorded.');
  }

  async function onGenerateFromFlow(e: FormEvent) {
    e.preventDefault();
    if (!sessionId) return;
    const caseName = name.trim();
    if (!caseName) {
      onError('Enter a test case name (description & tags auto-set if omitted).');
      return;
    }
    const chartSteps = flowNodes.filter(
      (n) => n.action !== 'start' && n.action !== 'end' && !n.locked,
    );
    const actionable = events.filter((ev) => ev.action !== 'page');
    if (!chartSteps.length && !actionable.length) {
      onError('Capture clicks in MCP or add steps in the flow chart first.');
      return;
    }

    setStatus('generating');
    setHint('Sending flow chart + capture to AI…');
    setValidateResult(null);
    try {
      if (!activeProviderHasKey(provider)) {
        throw new Error(
          `No ${provider === 'claude' ? 'Claude' : 'OpenRouter'} key — open header → AI setup, paste key, Save for this tab.`,
        );
      }
      const res = await fetch(`/api/tests/record/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          name: caseName,
          functionality: functionality.trim() || undefined,
          description: description.trim() || undefined,
          model: model || OPENROUTER_AUTO,
          provider,
          apiUrl,
          closeAfter: true,
          flowChart: flowNodes,
          ...aiKeysForRun(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'Generate from click flow failed',
        );
      }
      const cases = ensureCombinedSuites(
        (data.novel || data.cases || []) as WebTestCase[],
      );
      if (!cases.length) {
        setSessionId(null);
        setStatus('idle');
        onError(data.message || 'No new test cases from MCP click flow');
        return;
      }
      const draft = cases[0]!;
      setSessionId(null);
      setDraftCases(cases);
      setActiveDraftId(draft.id);
      const chart =
        Array.isArray(draft.flowChart) && draft.flowChart.length
          ? (draft.flowChart as FlowChartNode[])
          : draft.positiveSteps && draft.negativeSteps
            ? mergePairIntoBranchedChart(
                { ...draft, steps: draft.positiveSteps },
                {
                  ...draft,
                  id: `${draft.id}-negative`,
                  steps: draft.negativeSteps,
                  expectation: 'negative',
                },
              )
            : stepsToFlowNodes(draft.steps || []);
      setFlowNodes(chart);
      setFlowDirty(false);
      setStatus('review');
      setViewTab('flowchart');
      setHint(
        'Combined suite ready: shared steps with Positive / Negative fork. Drag steps, edit path definitions, then validate & save.',
      );
    } catch (err) {
      setStatus('recording');
      onError(err instanceof Error ? err.message : 'Generate failed');
    }
  }

  async function onValidate() {
    const draftCase = draftCases.find((c) => c.id === activeDraftId) || draftCases[0];
    if (!draftCase) return;
    setStatus('validating');
    setHint('AI validating test case against flow chart…');
    try {
      if (!activeProviderHasKey(provider)) {
        throw new Error(
          `No ${provider === 'claude' ? 'Claude' : 'OpenRouter'} key — open header → AI setup, paste key, Save for this tab.`,
        );
      }
      const syncedPair = applyBranchedFlowToPair(draftCases, flowNodes);
      const synced =
        syncedPair.find((c) => c.id === draftCase.id) || syncedPair[0]!;
      setDraftCases(syncedPair);
      const res = await fetch('/api/tests/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testCase: synced,
          flowChart: flowNodes,
          syncFromFlowChart: true,
          baseUrl,
          apiUrl,
          model: model || OPENROUTER_AUTO,
          provider,
          applyFixes: true,
          ...aiKeysForRun(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Validation failed');
      }
      setValidateResult({
        proper: Boolean(data.proper),
        score: Number(data.score) || 0,
        summary: data.summary || '',
        issues: Array.isArray(data.issues) ? data.issues : [],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        message: data.message || '',
      });
      if (data.fixedCase) {
        const fixed = data.fixedCase as WebTestCase;
        const nextPair = syncedPair.map((c) => (c.id === synced.id ? fixed : c));
        setDraftCases(nextPair);
        setActiveDraftId(fixed.id);
        const pos = nextPair.find((c) => resolveExpectation(c) === 'positive') || fixed;
        const neg = nextPair.find((c) => resolveExpectation(c) === 'negative');
        if (neg) {
          setFlowNodes(mergePairIntoBranchedChart(pos, neg));
        }
        setFlowDirty(false);
        setHint('AI applied fixes. Review the Positive / Negative fork, then save both.');
      } else {
        setHint(data.message || 'Validation complete.');
      }
      setStatus('review');
    } catch (err) {
      setStatus('review');
      onError(err instanceof Error ? err.message : 'Validation failed');
    }
  }

  function selectDraft(id: string) {
    const next = draftCases.find((c) => c.id === id);
    if (!next) return;
    if (flowDirty) {
      setDraftCases((prev) => applyBranchedFlowToPair(prev, flowNodes));
    }
    setActiveDraftId(id);
    setValidateResult(null);
  }

  function onSaveToPreview() {
    if (!draftCases.length) return;
    let cases = flowDirty
      ? applyBranchedFlowToPair(draftCases, flowNodes)
      : draftCases;
    cases = ensureCombinedSuites(cases);
    resetLocal();
    onGenerated(
      cases,
      undefined,
      validateResult?.proper
        ? `Validated (${validateResult.score}/100). Review and save the combined suite.`
        : 'Generated combined Positive+Negative suite from MCP click flow. Review and save.',
    );
    onClose();
  }

  async function handleClose() {
    if (
      status === 'generating' ||
      status === 'starting' ||
      status === 'validating'
    ) {
      return;
    }
    await stopSession(sessionId);
    resetLocal();
    onClose();
  }

  const actionableCount = events.filter((ev) => ev.action !== 'page').length;
  const chartStepCount = countFlowChartSteps(flowNodes);

  return (
    <>
    <div
      className="report-modal-root ai-action-modal-root mcp-click-flow-root"
      role="dialog"
      aria-modal="true"
      aria-label="Create test case via MCP click flow"
    >
      <div
        className="report-modal-backdrop"
        onClick={busy ? undefined : () => void handleClose()}
      />
      <div className="ai-action-modal mcp-click-flow-modal">
        <div className="ai-action-modal-header">
          <div className="modal-header-copy">
            <h2>Create via MCP click flow</h2>
            <p className="field-hint" style={{ margin: 0 }}>
              Capture in MCP, edit the flow chart, generate a test case, then AI-validate. Name is
              enough — other fields auto-set.
            </p>
          </div>
          <div className="mcp-click-header-actions">
            <button
              type="button"
              className="btn btn-ghost mcp-info-btn"
              disabled={busy}
              title="How to use this feature"
              aria-label="Open usage guide"
              onClick={() => setGuideOpen(true)}
            >
              <span aria-hidden>ⓘ</span> Info / Guide
            </button>
            <ModalCloseButton disabled={busy} onClick={() => void handleClose()} />
          </div>
        </div>

        <div className="ai-action-modal-body mcp-click-flow-body">
          <div className="mcp-click-flow-sidebar">
            <form className="mcp-click-meta" onSubmit={onGenerateFromFlow}>
              <label className="field">
                <span>Test case name *</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Buyer add diamond to cart"
                  disabled={status === 'generating' || status === 'validating'}
                  required
                />
              </label>
              <label className="field">
                <span>Functionality (optional)</span>
                <input
                  type="text"
                  value={functionality}
                  onChange={(e) => setFunctionality(e.target.value)}
                  placeholder="What this flow validates"
                  disabled={status === 'generating' || status === 'validating'}
                />
              </label>
              <label className="field">
                <span>Description (optional — auto if empty)</span>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Auto-filled from name + recording when left blank"
                  disabled={status === 'generating' || status === 'validating'}
                />
              </label>
              {status === 'idle' || status === 'starting' || status === 'recording' ? (
                <label className="field">
                  <span>Start path (optional)</span>
                  <input
                    type="text"
                    value={startPath}
                    onChange={(e) => setStartPath(e.target.value)}
                    placeholder={
                      flowRole === 'buyer'
                        ? '/buyer/products'
                        : flowRole === 'admin'
                          ? '/admin'
                          : '/'
                    }
                    disabled={status !== 'idle' && status !== 'starting'}
                  />
                </label>
              ) : null}
              <div className="field mcp-model-field">
                <div className="mcp-model-field-label">
                  <span>AI model</span>
                  <button
                    type="button"
                    className="btn btn-ghost mcp-model-info-btn"
                    title="About AI models"
                    aria-label="About AI models"
                    aria-expanded={modelInfoOpen}
                    onClick={() => setModelInfoOpen((v) => !v)}
                  >
                    ⓘ Info
                  </button>
                </div>
                <select
                  value={model}
                  onChange={(e) => onModelChange(e.target.value)}
                  disabled={status === 'generating' || status === 'validating'}
                >
                  {provider === 'openrouter' ? (
                    <option value={OPENROUTER_AUTO}>Auto</option>
                  ) : null}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {(() => {
                  const selected =
                    provider === 'openrouter' && model === OPENROUTER_AUTO
                      ? null
                      : models.find((m) => m.id === model);
                  return (
                    <p className="field-hint mcp-model-hint">
                      {selected
                        ? `${selected.rating} · ${selected.note}`
                        : provider === 'claude'
                          ? 'Claude Sonnet is the default for generate / validate.'
                          : 'Auto tries free models in order until one succeeds.'}
                    </p>
                  );
                })()}
                {modelInfoOpen ? (
                  <div className="mcp-model-info-panel" role="region" aria-label="AI model details">
                    {provider === 'openrouter' ? (
                      <p>
                        <strong>Auto</strong> — switches free OpenRouter models on failure
                        (recommended).
                      </p>
                    ) : (
                      <p>
                        <strong>Claude</strong> — uses your Anthropic API key from{' '}
                        <code>.env.local</code>.
                      </p>
                    )}
                    <ul>
                      {models.map((m) => (
                        <li key={m.id}>
                          <strong>{m.label}</strong>
                          <span>
                            {m.rating} · {m.note}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setModelInfoOpen(false);
                        setGuideOpen(true);
                      }}
                    >
                      Full usage guide →
                    </button>
                  </div>
                ) : null}
              </div>

              {status === 'idle' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!baseUrl.trim()}
                  onClick={() => void startRecording()}
                >
                  Open MCP view &amp; start capture
                </button>
              ) : null}

              {status === 'starting' ? (
                <p className="history-meta">Starting MCP browser…</p>
              ) : null}

              {status === 'recording' || status === 'generating' ? (
                <>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      status === 'generating' ||
                      !name.trim() ||
                      (actionableCount < 1 && chartStepCount < 1)
                    }
                  >
                    {status === 'generating'
                      ? 'Generating test case…'
                      : `Generate test case (${chartStepCount || actionableCount} steps)`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={status === 'generating'}
                    onClick={() => void handleClose()}
                  >
                    Cancel &amp; discard
                  </button>
                </>
              ) : null}

              {status === 'review' || status === 'validating' ? (
                <>
                  {draftCases.length > 1 ? (
                    <div className="expectation-tabs mcp-draft-tabs" role="tablist">
                      {draftCases.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="tab"
                          className={`mode-btn ${activeDraftId === c.id ? 'active' : ''}`}
                          disabled={status === 'validating'}
                          onClick={() => selectDraft(c.id)}
                        >
                          {c.suiteMode === 'combined'
                            ? 'Combined suite'
                            : resolveExpectation(c) === 'negative'
                              ? 'Negative'
                              : 'Positive'}
                        </button>
                      ))}
                    </div>
                  ) : draftCases[0]?.suiteMode === 'combined' ? (
                    <p className="history-meta">
                      Combined suite · Positive + Negative fork in one chart
                    </p>
                  ) : null}
                  {draftCases.length ? (
                    <p className="history-meta">
                      Draft:{' '}
                      <strong>
                        {(draftCases.find((c) => c.id === activeDraftId) || draftCases[0])
                          ?.name}
                      </strong>{' '}
                      ·{' '}
                      {(draftCases.find((c) => c.id === activeDraftId) || draftCases[0])
                        ?.steps?.length || 0}{' '}
                      steps
                      {flowDirty ? ' · flow chart edited' : ''}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={status === 'validating' || chartStepCount < 1}
                    onClick={() => void onValidate()}
                  >
                    {status === 'validating'
                      ? 'AI validating…'
                      : 'AI validate test case'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={status === 'validating' || !draftCases.length}
                    onClick={onSaveToPreview}
                  >
                    Review &amp; save suite
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={status === 'validating'}
                    onClick={() => void handleClose()}
                  >
                    Discard
                  </button>
                </>
              ) : null}
            </form>

            {validateResult ? (
              <div
                className={`mcp-validate-card ${validateResult.proper ? 'is-ok' : 'is-warn'}`}
              >
                <strong>
                  {validateResult.proper ? 'Proper' : 'Needs work'} · {validateResult.score}/100
                </strong>
                <p>{validateResult.summary}</p>
                {validateResult.issues.length ? (
                  <ul>
                    {validateResult.issues.map((issue, i) => (
                      <li key={`i-${i}`}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
                {validateResult.suggestions.length ? (
                  <ul className="mcp-validate-suggestions">
                    {validateResult.suggestions.map((s, i) => (
                      <li key={`s-${i}`}>{s}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {status === 'recording' ? (
              <div className="mcp-click-tools">
                <div className="mcp-login-box">
                  <h3 className="tc-detail-subhead">Enter details in MCP</h3>
                  <p className="field-hint" style={{ marginTop: 0 }}>
                    Login, fill forms, or click a field in the live view then type.
                    {loggedInAs ? (
                      <>
                        {' '}
                        Logged in: <strong>{loggedInAs}</strong>
                      </>
                    ) : null}
                  </p>
                  <form onSubmit={onLoginInMcp} className="mcp-login-form">
                    <label className="field">
                      <span>Email / mobile</span>
                      <input
                        type="text"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="buyer@example.com"
                        disabled={busyAction}
                        autoComplete="username"
                      />
                    </label>
                    <label className="field">
                      <span>Password</span>
                      <input
                        type="password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••••"
                        disabled={busyAction}
                        autoComplete="current-password"
                      />
                    </label>
                    <div className="mcp-click-tool-row">
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={busyAction || !loginEmail.trim() || !loginPassword}
                      >
                        Login in MCP
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyAction}
                        onClick={() =>
                          void postAction({ action: 'goto', url: '/login' })
                        }
                      >
                        Open /login
                      </button>
                    </div>
                  </form>
                </div>

                <form onSubmit={onFill} className="mcp-click-tool-row">
                  <input
                    type="text"
                    value={fillValue}
                    onChange={(e) => setFillValue(e.target.value)}
                    placeholder={
                      focusedSelector
                        ? `Fill focused: ${focusedSelector}`
                        : 'Click a field in MCP, then type value…'
                    }
                    disabled={busyAction}
                  />
                  <button
                    type="submit"
                    className="btn btn-ghost"
                    disabled={busyAction || !fillValue}
                  >
                    Fill
                  </button>
                </form>
                {focusedSelector ? (
                  <p className="history-meta">Focused selector: <code>{focusedSelector}</code></p>
                ) : null}
                <form onSubmit={onGoto} className="mcp-click-tool-row">
                  <input
                    type="text"
                    value={gotoPath}
                    onChange={(e) => setGotoPath(e.target.value)}
                    placeholder="Go to path e.g. /buyer/cart"
                    disabled={busyAction}
                  />
                  <button
                    type="submit"
                    className="btn btn-ghost"
                    disabled={busyAction || !gotoPath.trim()}
                  >
                    Go
                  </button>
                </form>
                <div className="mcp-click-tool-row">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busyAction}
                    onClick={() => void postAction({ action: 'scroll', dy: 500 })}
                  >
                    Scroll down
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busyAction}
                    onClick={() => void postAction({ action: 'press', key: 'Tab' })}
                  >
                    Tab
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busyAction}
                    onClick={() => void postAction({ action: 'press', key: 'Enter' })}
                  >
                    Enter
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busyAction}
                    onClick={() => void postAction({ action: 'press', key: 'Backspace' })}
                  >
                    ⌫
                  </button>
                </div>
              </div>
            ) : null}

            {status !== 'review' && status !== 'validating' ? (
              <div className="mcp-click-events">
                <h3 className="tc-detail-subhead">
                  Captured ({actionableCount})
                  {currentUrl ? (
                    <span className="history-meta" style={{ marginLeft: 8 }}>
                      {currentUrl.replace(/^https?:\/\/[^/]+/, '') || '/'}
                    </span>
                  ) : null}
                </h3>
                {!events.length ? (
                  <p className="step-msg">No events yet — start MCP or add flow chart steps.</p>
                ) : (
                  <ol className="mcp-click-event-list">
                    {events
                      .filter((ev) => ev.action !== 'page')
                      .map((ev) => (
                        <li key={ev.id}>
                          <span className="tag">{ev.action}</span> <span>{ev.label}</span>
                        </li>
                      ))}
                  </ol>
                )}
              </div>
            ) : null}
            {hint ? <p className="history-meta mcp-click-hint">{hint}</p> : null}
          </div>

          <div className="mcp-click-flow-main">
            <div className="mcp-click-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={viewTab === 'mcp'}
                className={viewTab === 'mcp' ? 'active' : ''}
                onClick={() => setViewTab('mcp')}
              >
                MCP live view
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewTab === 'flowchart'}
                className={viewTab === 'flowchart' ? 'active' : ''}
                onClick={() => setViewTab('flowchart')}
              >
                Edit flow chart
                {chartStepCount ? ` (${chartStepCount})` : ''}
              </button>
              {(status === 'review' || status === 'validating') && draftCases.length >= 2 ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewTab === 'suite'}
                  className={viewTab === 'suite' ? 'active' : ''}
                  onClick={() => setViewTab('suite')}
                >
                  Suite overview
                </button>
              ) : null}
            </div>

            {viewTab === 'mcp' ? (
              <div className="mcp-click-flow-view">
                <McpLiveView
                  runId={sessionId}
                  active={
                    !!sessionId && (status === 'recording' || status === 'starting')
                  }
                  title="MCP · full live browser (click + type to enter details)"
                  idleHint="Press Open MCP view, then Login or click fields and type to capture login and form steps."
                  interactive={status === 'recording'}
                  clickBusy={busyAction}
                  onViewClick={onViewClick}
                  onViewKey={onViewKey}
                />
              </div>
            ) : viewTab === 'suite' ? (
              <div className="mcp-suite-chart-wrap">
                <SuitePairFlowChart
                  {...pickSuitePair(draftCases)}
                  activeExpectation={
                    resolveExpectation(
                      draftCases.find((c) => c.id === activeDraftId) || draftCases[0],
                    )
                  }
                  onSelectBranch={(exp) => {
                    const target = draftCases.find((c) => resolveExpectation(c) === exp);
                    if (target) selectDraft(target.id);
                  }}
                  onSelectStep={(exp) => {
                    const target = draftCases.find((c) => resolveExpectation(c) === exp);
                    if (target) {
                      selectDraft(target.id);
                      setViewTab('flowchart');
                    }
                  }}
                  selectedStepId={selectedNodeId}
                />
                <p className="field-hint">
                  Read-only overview of both polarity step lists. Edit forks and drag steps on{' '}
                  <strong>Edit flow chart</strong>.
                </p>
              </div>
            ) : (
              <FlowChartEditor
                nodes={flowNodes}
                selectedId={selectedNodeId}
                onSelect={setSelectedNodeId}
                onChange={onFlowChange}
                disabled={
                  status === 'generating' ||
                  status === 'starting' ||
                  status === 'validating'
                }
                title={
                  status === 'review' || status === 'validating'
                    ? 'Shared flow · Positive / Negative fork'
                    : 'Edit captured flow'
                }
                emptyHint="Capture MCP clicks or click + Add step. Select a step → Add Positive / Negative fork."
              />
            )}
          </div>
        </div>
      </div>
    </div>
    <McpClickFlowGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
