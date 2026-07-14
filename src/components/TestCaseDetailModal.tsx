'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WebFlowStep, WebTestCase } from '@/lib/types';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { McpLiveView } from '@/components/McpLiveView';
import {
  OPENROUTER_AUTO,
  type OpenRouterModelOption,
} from '@/lib/openrouter-models';
import { roleCredentialsForRun } from '@/lib/role-credentials';
import { aiKeysForRun, activeProviderHasKey } from '@/lib/ai-keys';
import { useAppStore } from '@/lib/store';
import { findExpectationSibling, resolveExpectation } from '@/lib/test-expectation';
import { ReportFlowChart } from '@/components/ReportFlowChart';
import { SuitePairFlowChart, pickSuitePair } from '@/components/SuitePairFlowChart';
import { buildReportFlowChart } from '@/lib/flow-chart';

type DetailTab = 'overview' | 'steps' | 'flowchart' | 'mcp' | 'json' | 'playwright' | 'verify';

type ScrapedElement = {
  tag: string;
  role?: string;
  text?: string;
  name?: string;
  placeholder?: string;
  selector: string;
  dataTestId?: string;
  dataId?: string;
  id?: string;
  formControlName?: string;
  ariaLabel?: string;
  suggestedDataId?: string;
  path?: string;
  pageUrl?: string;
};

type GuideEntry = {
  id: string;
  selector: string;
  dataId?: string;
  dataTestId?: string;
  text?: string;
  tag?: string;
  path?: string;
  role?: string;
  suggestedDataId?: string;
  note?: string;
  sourceTestId?: string;
  createdAt: string;
};

const ACTION_META: Record<
  string,
  { icon: string; label: string; color: string }
> = {
  goto: { icon: '↗', label: 'Navigate', color: '#0ea5e9' },
  click: { icon: '🖱', label: 'Click', color: '#2563eb' },
  fill: { icon: '✎', label: 'Fill', color: '#7c3aed' },
  assertVisible: { icon: '👁', label: 'Assert visible', color: '#059669' },
  assertUrl: { icon: '🔗', label: 'Assert URL', color: '#059669' },
  wait: { icon: '⏱', label: 'Wait', color: '#64748b' },
  loginRole: { icon: '🔑', label: 'Login role', color: '#c9a227' },
  ensureBuyer: { icon: '👤', label: 'Ensure buyer', color: '#c9a227' },
};

function stepToPlaywright(step: WebFlowStep, baseUrl: string): string {
  const timeout = step.timeoutMs ?? 10000;
  switch (step.action) {
    case 'goto': {
      const path = step.url || '/';
      const url = path.startsWith('http')
        ? path
        : `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
      return `await page.goto('${url}', { waitUntil: 'domcontentloaded', timeout: ${timeout} });`;
    }
    case 'wait':
      return `await page.waitForTimeout(${Number(step.value) || 500});`;
    case 'loginRole':
      return `// loginRole: ${step.value || 'buyer'} — use Set credentials in the app header`;
    case 'ensureBuyer':
      return `// ensureBuyer — signup once per tab or use buyer credentials`;
    case 'fill': {
      if (step.selector) {
        return `await page.locator('${escapeJs(step.selector)}').first().fill('${escapeJs(step.value || '')}', { timeout: ${timeout} });`;
      }
      return `await page.getByLabel(/${escapeJs(step.text || '')}/i).fill('${escapeJs(step.value || '')}');`;
    }
    case 'click': {
      if (step.selector && step.text) {
        return `await page.locator('${escapeJs(step.selector)}').getByRole('button', { name: /${escapeJs(step.text)}/i }).first().click({ timeout: ${timeout} });`;
      }
      if (step.selector) {
        const first = step.selector.split(/\s*\|\|\s*/)[0]!.trim();
        return `await page.locator('${escapeJs(first)}').first().click({ timeout: ${timeout} });`;
      }
      return `await page.getByRole('button', { name: /${escapeJs(step.text || '')}/i }).click({ timeout: ${timeout} });`;
    }
    case 'assertVisible': {
      if (step.selector) {
        const first = step.selector.split(/\s*\|\|\s*/)[0]!.trim();
        return `await expect(page.locator('${escapeJs(first)}').first()).toBeVisible({ timeout: ${timeout} });`;
      }
      return `await expect(page.getByText(/${escapeJs(step.text || step.value || '')}/i).first()).toBeVisible({ timeout: ${timeout} });`;
    }
    case 'assertUrl':
      return `await expect(page).toHaveURL(/${escapeJs(step.url || step.value || '')}/i);`;
    default:
      return `// ${step.action}`;
  }
}

function escapeJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPlaywrightScript(test: WebTestCase, baseUrl: string): string {
  const lines = [
    `// Playwright sketch for: ${test.name}`,
    `// id: ${test.id} · role: ${test.role || 'public'}`,
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('${escapeJs(test.name)}', async ({ page }) => {`,
  ];
  for (const step of test.steps || []) {
    lines.push(`  // ${step.label || step.id} (${step.action})`);
    lines.push(`  ${stepToPlaywright(step, baseUrl)}`);
    lines.push('');
  }
  lines.push(`});`);
  return lines.join('\n');
}

function buildHtmlChecklist(test: WebTestCase): string {
  const rows: string[] = [
    `<!DOCTYPE html>`,
    `<html><head><meta charset="utf-8"><title>Verify · ${escapeHtml(test.name)}</title>`,
    `<style>
      body{font-family:system-ui,sans-serif;margin:24px;background:#0f1115;color:#e8eaed}
      h1{font-size:1.25rem} .meta{color:#9aa0a6;font-size:0.9rem}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border:1px solid #2a2f3a;padding:8px 10px;text-align:left;font-size:0.85rem;vertical-align:top}
      th{background:#1a1f2a} code{background:#1e2430;padding:2px 6px;border-radius:4px}
    </style></head><body>`,
    `<h1>${escapeHtml(test.name)}</h1>`,
    `<p class="meta">id=<code>${escapeHtml(test.id)}</code> · role=${escapeHtml(test.role || 'public')} · ${(test.steps || []).length} steps</p>`,
    `<table><thead><tr><th>#</th><th>Action</th><th>Label</th><th>Selector / text</th><th>Verify</th></tr></thead><tbody>`,
  ];
  (test.steps || []).forEach((s, i) => {
    const sel = s.selector || '—';
    const text = s.text || s.url || s.value || '—';
    rows.push(
      `<tr><td>${i + 1}</td><td>${escapeHtml(s.action)}</td><td>${escapeHtml(s.label)}</td><td><code>${escapeHtml(sel)}</code><br/>${escapeHtml(String(text))}</td><td>☐</td></tr>`,
    );
  });
  rows.push(`</tbody></table></body></html>`);
  return rows.join('\n');
}

function collectVerifyItems(test: WebTestCase) {
  const items: { kind: string; value: string; stepLabel: string; tip: string }[] = [];
  for (const s of test.steps || []) {
    if (s.selector) {
      items.push({
        kind: 'selector',
        value: s.selector,
        stepLabel: s.label,
        tip: 'Exists & visible on live page',
      });
    }
    if (s.text && (s.action === 'click' || s.action === 'assertVisible')) {
      items.push({
        kind: 'text',
        value: s.text,
        stepLabel: s.label,
        tip: 'Visible label / button text',
      });
    }
    if (s.url && (s.action === 'goto' || s.action === 'assertUrl')) {
      items.push({
        kind: 'url',
        value: s.url,
        stepLabel: s.label,
        tip: 'Route matches',
      });
    }
  }
  return items;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function elementKey(el: ScrapedElement, idx: number) {
  return `${el.path || ''}|${el.selector}|${el.dataId || ''}|${el.text || ''}|${idx}`;
}

export function TestCaseDetailModal({
  open,
  test,
  suiteCases,
  baseUrl = 'http://localhost:4200',
  apiUrl = '',
  flowRole,
  model = OPENROUTER_AUTO,
  models = [],
  onClose,
  onCaseUpdated,
  onSavedReplace,
}: {
  open: boolean;
  test: WebTestCase | null;
  /** Other cases in the library / draft list — used to show Positive+Negative in one suite chart */
  suiteCases?: WebTestCase[];
  baseUrl?: string;
  apiUrl?: string;
  flowRole?: 'public' | 'buyer' | 'seller' | 'admin';
  model?: string;
  models?: OpenRouterModelOption[];
  onClose: () => void;
  onCaseUpdated?: (next: WebTestCase) => void;
  onSavedReplace?: (next: WebTestCase) => void;
}) {
  const aiProvider = useAppStore((s) => s.aiProvider);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [checked, setChecked] = useState<Set<string>>(() => new Set());

  const [inspectSessionId, setInspectSessionId] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectLog, setInspectLog] = useState('');
  const [scraped, setScraped] = useState<ScrapedElement[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [guideEntries, setGuideEntries] = useState<GuideEntry[]>([]);
  const [guideBusy, setGuideBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab('overview');
    setRegenPrompt('');
    setMsg('');
    setErr('');
    setChecked(new Set());
    setInspectSessionId(null);
    setInspecting(false);
    setInspectLog('');
    setScraped([]);
    setSelectedKeys(new Set());
  }, [open, test?.id]);

  useEffect(() => {
    if (!open) return;
    void loadGuideEntries();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !regenerating && !inspecting) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, regenerating, inspecting, onClose]);

  const jsonText = useMemo(
    () => (test ? JSON.stringify(test, null, 2) : ''),
    [test],
  );
  const pwText = useMemo(
    () => (test ? buildPlaywrightScript(test, baseUrl) : ''),
    [test, baseUrl],
  );
  const htmlText = useMemo(
    () => (test ? buildHtmlChecklist(test) : ''),
    [test],
  );
  const verifyItems = useMemo(
    () => (test ? collectVerifyItems(test) : []),
    [test],
  );

  async function loadGuideEntries() {
    try {
      const res = await fetch('/api/guide/selectors');
      const data = await res.json();
      if (res.ok) setGuideEntries((data.entries || []) as GuideEntry[]);
    } catch {
      // ignore
    }
  }

  if (!open || !test) return null;

  const sibling =
    suiteCases && suiteCases.length
      ? findExpectationSibling(test, suiteCases.filter((c) => c.id !== test.id))
      : null;

  function stripSuiteName(name: string) {
    return name.replace(/\s*\((Positive|Negative)\)\s*$/i, '').trim();
  }

  const suitePair = (() => {
    if (
      test.suiteMode === 'combined' ||
      (test.positiveSteps?.length && test.negativeSteps?.length)
    ) {
      const base = stripSuiteName(test.name);
      return {
        positive: {
          ...test,
          id: `${test.id}-positive`,
          name: `${base} (Positive)`,
          steps: test.positiveSteps || test.steps,
          expectation: 'positive' as const,
        },
        negative: {
          ...test,
          id: `${test.id}-negative`,
          name: `${base} (Negative)`,
          steps: test.negativeSteps || [],
          expectation: 'negative' as const,
        },
      };
    }
    return pickSuitePair([test, ...(sibling ? [sibling] : [])], test);
  })();
  const hasSuitePair = !!(suitePair.positive && suitePair.negative);

  async function handleCopy(kind: 'json' | 'playwright' | 'html') {
    const map = { json: jsonText, playwright: pwText, html: htmlText };
    const ok = await copyText(map[kind]);
    setMsg(ok ? `Copied ${kind} to clipboard` : 'Copy failed');
    setTimeout(() => setMsg(''), 2500);
  }

  function downloadFile(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runMcpInspect() {
    if (!test) return;
    setInspecting(true);
    setErr('');
    setMsg('');
    setInspectLog('Starting MCP inspect…');
    setScraped([]);
    setSelectedKeys(new Set());
    setTab('mcp');

    const gotoPaths = (test.steps || [])
      .filter((s) => s.action === 'goto' && s.url)
      .map((s) => s.url!)
      .join(' ');

    try {
      const res = await fetch('/api/tests/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          apiUrl,
          role: flowRole || test.role,
          testId: test.id,
          prompt: `${test.name}\n${test.description || ''}\n${(test.steps || [])
            .map((s) => s.label)
            .join(' ')}`,
          pathsHint: gotoPaths,
          roleCredentials: roleCredentialsForRun(),
          keepSession: true,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { message?: string; error?: string }).message ||
            (data as { error?: string }).error ||
            'Inspect failed',
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let doneElements: ScrapedElement[] = [];

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
            inspectSessionId?: string;
            elements?: ScrapedElement[];
          };
          try {
            event = JSON.parse(trimmed) as typeof event;
          } catch {
            continue;
          }
          if (event.inspectSessionId) setInspectSessionId(event.inspectSessionId);
          if (event.message) setInspectLog(event.message);
          if (event.type === 'done' && event.elements) {
            doneElements = event.elements;
          }
          if (event.type === 'error') {
            throw new Error(event.message || 'Inspect failed');
          }
        }
      }

      setScraped(doneElements);
      setMsg(
        doneElements.length
          ? `Scraped ${doneElements.length} element(s). Select data-id / selectors to add to AI guide.`
          : 'Inspect finished — no interactive elements found.',
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Inspect failed');
    } finally {
      setInspecting(false);
    }
  }

  function toggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllScraped() {
    setSelectedKeys(new Set(scraped.map((el, i) => elementKey(el, i))));
  }

  async function addSelectedToGuide() {
    if (!test) return;
    const picked = scraped.filter((el, i) => selectedKeys.has(elementKey(el, i)));
    if (!picked.length) {
      setErr('Select at least one element');
      return;
    }
    setGuideBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/guide/selectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: picked.map((el) => ({
            selector: el.selector,
            dataId: el.dataId,
            dataTestId: el.dataTestId,
            text: el.text || el.name || el.placeholder,
            tag: el.tag,
            path: el.path,
            role: flowRole || test.role,
            suggestedDataId: el.suggestedDataId,
            note: `MCP pick · ${test.name}`,
            sourceTestId: test.id,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setGuideEntries((data.entries || []) as GuideEntry[]);
      setMsg(data.message || `Added ${data.added} selector(s) to AI guide`);
      setSelectedKeys(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save to AI guide');
    } finally {
      setGuideBusy(false);
    }
  }

  async function addStepSelectorsToGuide() {
    if (!test) return;
    const entries = (test.steps || [])
      .filter((s) => s.selector)
      .map((s) => ({
        selector: s.selector!.split(/\s*\|\|\s*/)[0]!.trim(),
        text: s.text || s.label,
        path: (test.steps || []).find((x) => x.action === 'goto')?.url,
        role: flowRole || test.role,
        note: `From case step · ${s.label}`,
        sourceTestId: test.id,
      }));
    if (!entries.length) {
      setErr('This case has no selectors on steps');
      return;
    }
    setGuideBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/guide/selectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setGuideEntries((data.entries || []) as GuideEntry[]);
      setMsg(data.message || 'Step selectors added to AI guide');
      setTab('mcp');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setGuideBusy(false);
    }
  }

  async function removeGuideEntry(id: string) {
    setGuideBusy(true);
    try {
      const res = await fetch(`/api/guide/selectors?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setGuideEntries((data.entries || []) as GuideEntry[]);
      setMsg('Removed from AI guide');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setGuideBusy(false);
    }
  }

  async function handleRegenerate() {
    if (!test) return;
    if (!activeProviderHasKey(aiProvider)) {
      setErr(
        `No ${aiProvider === 'claude' ? 'Claude' : 'OpenRouter'} key — open header → AI setup, paste key, Save for this tab.`,
      );
      return;
    }
    setRegenerating(true);
    setErr('');
    setMsg('');
    setTab('mcp');
    const notes = regenPrompt.trim() || 'Improve selectors and steps for reliability.';
    const prompt = [
      `Regenerate and IMPROVE this existing web test case. Keep the SAME id "${test.id}" and role "${test.role || flowRole || 'public'}".`,
      `User improvement notes: ${notes}`,
      `Return exactly ONE case in {"cases":[...]} with corrected selectors (wishlist uses button.wishlist-trigger .cart-text NOT .badge; hearts use i.ph-heart / i.ph-fill.ph-heart). Prefer CURATED MCP / LEARNED selectors and live data-id.`,
      `Current case JSON:`,
      JSON.stringify(test),
    ].join('\n\n');

    try {
      const res = await fetch('/api/tests/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          baseUrl,
          apiUrl,
          model: model || OPENROUTER_AUTO,
          provider: aiProvider,
          role: flowRole || test.role,
          stream: true,
          forceGenerate: true,
          liveInspect: true,
          roleCredentials: roleCredentialsForRun(),
          ...aiKeysForRun(),
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Regenerate failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let novel: WebTestCase[] = [];
      let streamError = '';

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
            inspectSessionId?: string;
            novel?: WebTestCase[];
            cases?: WebTestCase[];
          };
          try {
            event = JSON.parse(trimmed) as typeof event;
          } catch {
            continue;
          }
          if (event.inspectSessionId) setInspectSessionId(event.inspectSessionId);
          if (event.message) setInspectLog(event.message);
          if (event.type === 'done') {
            novel = (event.novel || event.cases || []) as WebTestCase[];
          }
          if (event.type === 'error') {
            streamError = event.message || 'Regenerate failed';
          }
        }
      }

      if (streamError) throw new Error(streamError);
      const next = novel[0];
      if (!next) {
        throw new Error(
          'No new case returned (maybe treated as duplicate). Try a clearer improvement note.',
        );
      }
      const merged: WebTestCase = {
        ...next,
        id: test.id,
        role: test.role || next.role,
        kind: 'web-flow',
      };
      onCaseUpdated?.(merged);
      setMsg(`Regenerated “${merged.name}” · ${merged.steps?.length ?? 0} steps`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Regenerate failed');
    } finally {
      setRegenerating(false);
    }
  }

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'steps', label: 'Steps' },
    { id: 'flowchart', label: 'Flow chart' },
    { id: 'mcp', label: 'MCP & Select' },
    { id: 'json', label: 'JSON' },
    { id: 'playwright', label: 'Playwright' },
    { id: 'verify', label: 'Verify HTML' },
  ];

  const busy = regenerating || inspecting;

  return (
    <div
      className="report-modal-root tc-detail-root"
      role="dialog"
      aria-modal="true"
      aria-label={`View test case ${test.name}`}
    >
      <div className="report-modal-backdrop" onClick={busy ? undefined : onClose} />
      <div className="report-modal tc-detail-modal tc-detail-modal-wide">
        <header className="report-modal-header">
          <div className="modal-header-copy">
            <h2>
              {test.name}{' '}
              <span
                className={`tag expectation-tag expectation-${resolveExpectation(test)}`}
              >
                {resolveExpectation(test)}
              </span>
            </h2>
            <p className="history-meta">
              <code>{test.id}</code> · {test.role || 'public'} ·{' '}
              {test.steps?.length ?? 0} steps
              {test.source ? ` · ${test.source}` : ''}
            </p>
          </div>
          <div className="report-modal-actions">
            <ModalCloseButton onClick={onClose} disabled={busy} />
          </div>
        </header>

        <div className="tc-detail-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              disabled={busy && t.id !== 'mcp'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="report-modal-body tc-detail-body">
          {tab === 'overview' ? (
            <div className="tc-detail-overview">
              <p>{test.description || 'No description'}</p>
              <div className="tag-row">
                {(test.tags || []).map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
                <span className="tag">~{test.estimatedMinutes} min</span>
              </div>
              <div className="tc-detail-stat-grid">
                <div className="tc-detail-stat">
                  <span>Steps</span>
                  <strong>{test.steps?.length ?? 0}</strong>
                </div>
                <div className="tc-detail-stat">
                  <span>Clicks</span>
                  <strong>
                    {(test.steps || []).filter((s) => s.action === 'click').length}
                  </strong>
                </div>
                <div className="tc-detail-stat">
                  <span>Asserts</span>
                  <strong>
                    {
                      (test.steps || []).filter((s) => s.action.startsWith('assert'))
                        .length
                    }
                  </strong>
                </div>
                <div className="tc-detail-stat">
                  <span>Selectors</span>
                  <strong>
                    {(test.steps || []).filter((s) => s.selector).length}
                  </strong>
                </div>
              </div>
              <h3 className="tc-detail-subhead">Quick actions</h3>
              <div className="tc-detail-quick">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleCopy('json')}
                >
                  📋 Copy JSON
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleCopy('playwright')}
                >
                  📋 Copy Playwright
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleCopy('html')}
                >
                  📋 Copy HTML checklist
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void runMcpInspect()}
                >
                  🎥 Open MCP & select
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={guideBusy || busy}
                  onClick={() => void addStepSelectorsToGuide()}
                >
                  📌 Add step selectors to AI guide
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    downloadFile(`${test.id}.json`, jsonText, 'application/json')
                  }
                >
                  ⬇ Download JSON
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    downloadFile(`${test.id}.verify.html`, htmlText, 'text/html')
                  }
                >
                  ⬇ Download HTML
                </button>
              </div>
            </div>
          ) : null}

          {tab === 'steps' ? (
            <div className="tc-detail-steps">
              {(test.steps || []).map((s, i) => {
                const meta = ACTION_META[s.action] || {
                  icon: '•',
                  label: s.action,
                  color: '#64748b',
                };
                return (
                  <div key={s.id || i} className="tc-detail-step">
                    <div
                      className="tc-detail-step-badge"
                      style={{ background: meta.color }}
                      title={meta.label}
                    >
                      <span aria-hidden>{meta.icon}</span>
                      <span>{i + 1}</span>
                    </div>
                    <div className="tc-detail-step-body">
                      <div className="tc-detail-step-top">
                        <strong>{s.label}</strong>
                        <span className="tag">{meta.label}</span>
                      </div>
                      <div className="tc-detail-step-meta">
                        {s.selector ? (
                          <div>
                            <span className="history-meta">selector</span>{' '}
                            <code>{s.selector}</code>
                          </div>
                        ) : null}
                        {s.text ? (
                          <div>
                            <span className="history-meta">text</span>{' '}
                            <code>{s.text}</code>
                          </div>
                        ) : null}
                        {s.url ? (
                          <div>
                            <span className="history-meta">url</span>{' '}
                            <code>{s.url}</code>
                          </div>
                        ) : null}
                        {s.value && s.action !== 'assertUrl' ? (
                          <div>
                            <span className="history-meta">value</span>{' '}
                            <code>{s.value}</code>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {tab === 'flowchart' ? (
            <div className="tc-detail-flowchart">
              {hasSuitePair ? (
                <>
                  <p className="field-hint">
                    Both Positive and Negative live in the <strong>same test suite</strong> (shared
                    group/pair). One chart, two branches — runs still execute each path on its own.
                  </p>
                  <SuitePairFlowChart
                    positive={suitePair.positive}
                    negative={suitePair.negative}
                    activeExpectation={resolveExpectation(test)}
                    title="Suite flow chart · Positive + Negative"
                  />
                </>
              ) : (
                <>
                  <p className="field-hint">
                    Single-path chart for this case. Generate via MCP / AI to create Positive +
                    Negative in the same suite, then both appear here together.
                  </p>
                  <ReportFlowChart
                    title={`${resolveExpectation(test)} flow chart`}
                    nodes={buildReportFlowChart(
                      (test.steps || []).map((s) => ({
                        id: s.id,
                        label: s.label,
                        status: 'pending' as const,
                        action: s.action,
                        description: s.label,
                      })),
                    )}
                  />
                </>
              )}
            </div>
          ) : null}

          {tab === 'mcp' ? (
            <div className="tc-detail-mcp">
              <p className="field-hint">
                Open the live portal in MCP, watch highlights, then select elements (
                <code>data-id</code> / selectors). Saved picks go into the AI guide and
                feed every new test-case generation.
              </p>
              <div className="tc-detail-mcp-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void runMcpInspect()}
                >
                  {inspecting ? 'Inspecting…' : '🎥 Open MCP inspect'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!scraped.length || guideBusy}
                  onClick={selectAllScraped}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!selectedKeys.size || guideBusy || busy}
                  onClick={() => void addSelectedToGuide()}
                >
                  {guideBusy
                    ? 'Saving…'
                    : `📌 Add ${selectedKeys.size || ''} selected to AI guide`}
                </button>
              </div>
              {inspectLog ? <p className="history-meta">{inspectLog}</p> : null}

              <div className="tc-detail-mcp-layout">
                <McpLiveView
                  runId={inspectSessionId}
                  active={
                    !!inspectSessionId &&
                    (inspecting || regenerating || !!scraped.length)
                  }
                  title="MCP live browser"
                  idleHint="Press Open MCP inspect to stream the portal and scrape data-id / selectors."
                />
                <div className="tc-detail-mcp-pick">
                  <h3 className="tc-detail-subhead">
                    Live elements ({scraped.length})
                  </h3>
                  {!scraped.length ? (
                    <p className="step-msg">
                      No scrape yet — run Open MCP inspect (needs portal URL in settings).
                    </p>
                  ) : (
                    <ul className="tc-mcp-el-list">
                      {scraped.map((el, idx) => {
                        const key = elementKey(el, idx);
                        const on = selectedKeys.has(key);
                        return (
                          <li key={key} className={on ? 'selected' : ''}>
                            <label>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={guideBusy}
                                onChange={() => toggleSelect(key)}
                              />
                              <span className="tc-mcp-el-body">
                                <span className="tc-mcp-el-top">
                                  <code>{el.tag}</code>
                                  {el.path ? (
                                    <span className="tag">{el.path}</span>
                                  ) : null}
                                  {el.dataId ? (
                                    <span className="tag tag-accent">
                                      data-id={el.dataId}
                                    </span>
                                  ) : null}
                                  {el.dataTestId ? (
                                    <span className="tag tag-accent">
                                      data-testid={el.dataTestId}
                                    </span>
                                  ) : null}
                                </span>
                                <code className="tc-mcp-el-sel">{el.selector}</code>
                                {el.text || el.suggestedDataId ? (
                                  <span className="history-meta">
                                    {el.text || ''}
                                    {el.suggestedDataId
                                      ? ` · suggest ${el.suggestedDataId}`
                                      : ''}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <h3 className="tc-detail-subhead">
                AI guide selectors ({guideEntries.length})
              </h3>
              <p className="field-hint">
                These are injected into every new AI generate (and into{' '}
                <code>learned-selectors.md</code>).
              </p>
              {!guideEntries.length ? (
                <p className="step-msg">No curated selectors yet.</p>
              ) : (
                <ul className="tc-guide-list">
                  {guideEntries.map((e) => (
                    <li key={e.id}>
                      <div>
                        <code>{e.selector}</code>
                        <div className="history-meta">
                          {[
                            e.dataId ? `data-id=${e.dataId}` : '',
                            e.dataTestId ? `data-testid=${e.dataTestId}` : '',
                            e.path || '',
                            e.text || '',
                            e.sourceTestId ? `from ${e.sourceTestId}` : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={guideBusy}
                        onClick={() => void removeGuideEntry(e.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {tab === 'json' ? (
            <div className="tc-detail-code-wrap">
              <div className="tc-detail-code-bar">
                <span>Test case JSON</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleCopy('json')}
                >
                  Copy
                </button>
              </div>
              <pre className="tc-detail-code">{jsonText}</pre>
            </div>
          ) : null}

          {tab === 'playwright' ? (
            <div className="tc-detail-code-wrap">
              <div className="tc-detail-code-bar">
                <span>Playwright sketch (for verification)</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleCopy('playwright')}
                >
                  Copy
                </button>
              </div>
              <pre className="tc-detail-code">{pwText}</pre>
            </div>
          ) : null}

          {tab === 'verify' ? (
            <div className="tc-detail-verify">
              <p className="field-hint">
                Checklist of selectors, button labels, and URLs to confirm on the live
                portal / MCP inspect before saving or running.
              </p>
              <div className="tc-detail-code-bar">
                <span>HTML verify checklist</span>
                <div className="tc-detail-code-bar-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void handleCopy('html')}
                  >
                    Copy HTML
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      downloadFile(`${test.id}.verify.html`, htmlText, 'text/html')
                    }
                  >
                    Download
                  </button>
                </div>
              </div>
              <ul className="tc-verify-list">
                {verifyItems.map((item, idx) => {
                  const key = `${item.kind}:${item.value}:${idx}`;
                  const on = checked.has(key);
                  return (
                    <li key={key} className={on ? 'checked' : ''}>
                      <label>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            });
                          }}
                        />
                        <span className="tc-verify-kind">{item.kind}</span>
                        <code>{item.value}</code>
                      </label>
                      <div className="history-meta">
                        {item.stepLabel} · {item.tip}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {!verifyItems.length ? (
                <p className="step-msg">No selectors/text to verify on this case.</p>
              ) : null}
            </div>
          ) : null}

          <section className="tc-detail-regen">
            <h3 className="tc-detail-subhead">↻ Regenerate with prompt</h3>
            <p className="field-hint">
              Describe what to fix. AI re-opens MCP live inspect (watch the MCP & Select
              tab) and returns an improved case — using curated guide selectors.
            </p>
            <textarea
              className="ai-textarea"
              rows={3}
              placeholder="e.g. Fix wishlist assert to use button.wishlist-trigger .cart-text"
              value={regenPrompt}
              onChange={(e) => setRegenPrompt(e.target.value)}
              disabled={busy}
            />
            <div className="tc-detail-regen-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void handleRegenerate()}
              >
                {regenerating ? 'Regenerating…' : '↻ Regenerate this case'}
              </button>
              {onSavedReplace ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => onSavedReplace(test)}
                >
                  Save this version
                </button>
              ) : null}
              {models.length ? (
                <span className="history-meta">Model: {model || OPENROUTER_AUTO}</span>
              ) : null}
            </div>
          </section>

          {msg ? <p className="ai-success">{msg}</p> : null}
          {err ? (
            <div className="ai-error-banner" role="alert">
              <strong>Action failed</strong>
              <pre className="ai-error-pre">{err}</pre>
            </div>
          ) : null}
        </div>

        <footer className="tc-select-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
