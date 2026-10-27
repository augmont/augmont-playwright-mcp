'use client';

import { FormEvent, useMemo, useState } from 'react';
import type {
  VaptCaseIntent,
  VaptCheckId,
  VaptProfile,
  VaptSeverity,
  VaptTestCase,
  WebLoadHttpMethod,
} from '@/lib/types';
import { VAPT_ATTACK_LABELS, VAPT_CATALOGUE_ATTACKS } from '@/lib/vapt-attacks';
import { vaptProfileHint } from '@/lib/vapt-profile';
import { ModalCloseButton } from '@/components/ModalCloseButton';

const METHODS: WebLoadHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
];

const SEVERITIES: VaptSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

const ALL_CHECKS = Object.keys(VAPT_ATTACK_LABELS) as VaptCheckId[];

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function VaptManualCaseModal({ open, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startUrl, setStartUrl] = useState('/login');
  const [targetUrl, setTargetUrl] = useState('/location');
  const [method, setMethod] = useState<WebLoadHttpMethod>('POST');
  const [useApiBase, setUseApiBase] = useState(true);
  const [body, setBody] = useState('{"key":"country"}');
  const [headersJson, setHeadersJson] = useState('{"Content-Type":"application/json"}');
  const [severityGate, setSeverityGate] = useState<VaptSeverity>('high');
  const [intent, setIntent] = useState<VaptCaseIntent>('pass');
  const [profile, setProfile] = useState<VaptProfile>('higher');
  const [checks, setChecks] = useState<VaptCheckId[]>([...VAPT_CATALOGUE_ATTACKS]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedCount = checks.length;

  const checkGroups = useMemo(() => {
    const catalogue = new Set(VAPT_CATALOGUE_ATTACKS);
    return {
      catalogue: VAPT_CATALOGUE_ATTACKS,
      supporting: ALL_CHECKS.filter((c) => !catalogue.has(c)),
    };
  }, []);

  if (!open) return null;

  function toggleCheck(id: VaptCheckId) {
    setChecks((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function selectCatalogue() {
    setChecks([...VAPT_CATALOGUE_ATTACKS]);
  }

  function selectHygieneFail() {
    setChecks([
      'security-headers',
      'cookie-flags',
      'tls-url',
      'api-auth-bypass',
      'api-error-hygiene',
      'info-disclosure',
      'injection-surface',
      'cors-preflight',
    ]);
    setIntent('fail');
    setSeverityGate('medium');
  }

  function clearChecks() {
    setChecks([]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!targetUrl.trim()) {
      setError('Target URL / path is required.');
      return;
    }
    if (!checks.length) {
      setError('Select at least one VAPT check.');
      return;
    }

    let headers: Record<string, string> | undefined;
    if (headersJson.trim()) {
      try {
        const parsed = JSON.parse(headersJson) as Record<string, unknown>;
        headers = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (k && v != null) headers[k] = String(v);
        }
      } catch {
        setError('Headers must be valid JSON object.');
        return;
      }
    }

    const idBase = slugify(name) || `custom-${Date.now()}`;
    const id = `vapt-${intent}-${profile}-${idBase}`.replace(/-+/g, '-');

    const draft: VaptTestCase = {
      id,
      name: name.trim(),
      description:
        description.trim() ||
        `Manual ${intent} case · ${profile} · ${checks.length} check(s)`,
      tags: ['vapt', 'manual', intent, profile],
      estimatedMinutes: Math.max(1, Math.min(120, Math.ceil(checks.length / 3))),
      kind: 'vapt',
      source: 'manual',
      group: `manual-${intent}`,
      suiteMode: 'single',
      vapt: {
        startUrl: startUrl.trim() || '/login',
        targetUrl: targetUrl.trim(),
        method,
        useApiBase,
        body: body.trim() || undefined,
        headers,
        checks,
        severityGate,
        intent,
        profile,
      },
    };

    setSaving(true);
    try {
      const res = await fetch('/api/tests/vapt/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases: [draft], source: 'manual' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Save failed');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="report-modal-root ai-action-modal-root"
      role="dialog"
      aria-modal="true"
      aria-label="Manual VAPT case"
    >
      <div
        className="report-modal-backdrop"
        onClick={saving ? undefined : onClose}
      />
      <div className="ai-action-modal ai-action-modal-wide">
        <div className="ai-action-modal-header">
          <div className="modal-header-copy">
            <h2>Manual VAPT case</h2>
            <p className="history-meta">
              Add your own suite — pick pass/fail intent, basic/advanced/higher depth, and
              checks.
            </p>
          </div>
          <ModalCloseButton disabled={saving} onClick={onClose} />
        </div>

        <form className="ai-action-modal-body" onSubmit={onSubmit}>
          <div className="vapt-manual-grid">
            <label className="field">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Custom login auth bypass (Fail · Advanced)"
                disabled={saving}
                required
              />
            </label>
            <label className="field">
              Description
              <textarea
                className="ai-textarea"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes for QA / AppSec"
                disabled={saving}
              />
            </label>
          </div>

          <div className="vapt-manual-row">
            <div className="field" style={{ margin: 0 }}>
              <span className="field-hint">Case intent</span>
              <div className="expectation-tabs" role="tablist" aria-label="Pass or fail case">
                {(
                  [
                    { id: 'pass', label: 'Pass case' },
                    { id: 'fail', label: 'Fail case' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={intent === tab.id}
                    className={`mode-btn ${intent === tab.id ? 'active' : ''}`}
                    disabled={saving}
                    onClick={() => setIntent(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <span className="field-hint">Probe level</span>
              <div className="expectation-tabs" role="tablist" aria-label="VAPT profile">
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
                    disabled={saving}
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

          <div className="vapt-manual-grid vapt-manual-grid-3">
            <label className="field">
              Start URL (MCP)
              <input
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                disabled={saving}
              />
            </label>
            <label className="field">
              Target URL / path
              <input
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                disabled={saving}
                required
              />
            </label>
            <label className="field">
              Method
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as WebLoadHttpMethod)}
                disabled={saving}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="vapt-manual-grid vapt-manual-grid-3">
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={useApiBase}
                onChange={(e) => setUseApiBase(e.target.checked)}
                disabled={saving}
              />
              Resolve target against API base
            </label>
            <label className="field">
              Severity gate
              <select
                value={severityGate}
                onChange={(e) => setSeverityGate(e.target.value as VaptSeverity)}
                disabled={saving}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="field" style={{ margin: 0 }}>
              <span className="field-hint">Quick check presets</span>
              <div className="creds-actions" style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving}
                  onClick={selectCatalogue}
                >
                  Full catalogue
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving}
                  onClick={selectHygieneFail}
                >
                  Fail hygiene set
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving}
                  onClick={clearChecks}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <label className="field">
            Headers (JSON)
            <textarea
              className="ai-textarea"
              rows={2}
              value={headersJson}
              onChange={(e) => setHeadersJson(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="field">
            Body
            <textarea
              className="ai-textarea"
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={saving}
            />
          </label>

          <div className="field">
            <span className="field-hint">
              Checks ({selectedCount} selected)
            </span>
            <div className="vapt-check-picker">
              <div className="load-metrics-section-label">Catalogue attacks</div>
              <ul className="vapt-check-picker-list">
                {checkGroups.catalogue.map((id) => (
                  <li key={id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checks.includes(id)}
                        onChange={() => toggleCheck(id)}
                        disabled={saving}
                      />
                      <span>{VAPT_ATTACK_LABELS[id]}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="load-metrics-section-label" style={{ marginTop: '0.75rem' }}>
                Supporting probes
              </div>
              <ul className="vapt-check-picker-list">
                {checkGroups.supporting.map((id) => (
                  <li key={id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checks.includes(id)}
                        onChange={() => toggleCheck(id)}
                        disabled={saving}
                      />
                      <span>{VAPT_ATTACK_LABELS[id]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          <div className="creds-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save manual case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
