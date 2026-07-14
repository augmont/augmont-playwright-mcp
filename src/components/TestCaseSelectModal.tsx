'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WebTestCase } from '@/lib/types';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { TestCaseDetailModal } from '@/components/TestCaseDetailModal';
import { OPENROUTER_AUTO } from '@/lib/openrouter-models';
import {
  resolveExpectation,
  type TestExpectation,
} from '@/lib/test-expectation';

type ViewMode = 'card' | 'table';
type ProductFilter = 'lgd-diamonds' | 'non-cert';
type ExpectationFilter = 'all' | TestExpectation;

export type DuplicatePreview = {
  message: string;
  reason: string;
  score: number;
  generated: WebTestCase;
  existing: WebTestCase;
};

const PRODUCT_FILTERS: { id: ProductFilter; label: string; tags: string[] }[] = [
  { id: 'lgd-diamonds', label: 'Lab Grow Diamonds', tags: ['lgd-diamonds', 'certified'] },
  { id: 'non-cert', label: 'Lab grow non-cert', tags: ['non-cert', 'melee'] },
];

const UNGROUPED = 'Ungrouped';

function matchesProductFilter(test: WebTestCase, filter: ProductFilter): boolean {
  const conf = PRODUCT_FILTERS.find((f) => f.id === filter);
  if (!conf) return false;
  const hay = [test.id, test.name, test.description, ...(test.tags || [])]
    .join(' ')
    .toLowerCase();
  return conf.tags.some((t) => hay.includes(t.toLowerCase()));
}

function CaseCardBody({
  c,
  hideRole = false,
}: {
  c: WebTestCase;
  hideRole?: boolean;
}) {
  return (
    <div className="tc-select-card-body">
      <div className="tc-select-card-top">
        <strong>{c.name}</strong>
        <span
          className={`tag expectation-tag expectation-${resolveExpectation(c)}`}
        >
          {resolveExpectation(c)}
        </span>
        {!hideRole ? <span className="tag">{c.role || 'public'}</span> : null}
      </div>
      <p>{c.description || 'No description'}</p>
      <div className="tag-row">
        {c.group ? <span className="tag tag-accent">{c.group}</span> : null}
        <span className="tag">{c.id}</span>
        {(c.tags || []).slice(0, 4).map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
        <span className="tag">
          {c.steps?.length ?? 0} step{(c.steps?.length ?? 0) === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

function matchReasonLabel(reason: string) {
  if (reason === 'same-id') return 'Same id';
  if (reason === 'same-name') return 'Same name';
  if (reason === 'similar-flow') return 'Similar flow';
  return reason;
}

function caseIdsKey(list: WebTestCase[]) {
  return list
    .map((c) => c.id)
    .sort()
    .join('|');
}

export function TestCaseSelectModal({
  open,
  cases,
  duplicates = [],
  title,
  saving,
  onCancel,
  onSave,
  showProductFilters = false,
  baseUrl,
  apiUrl,
  flowRole,
  model,
  onCaseUpdated,
  onCasesChange,
}: {
  open: boolean;
  cases: WebTestCase[];
  duplicates?: DuplicatePreview[];
  title?: string;
  saving?: boolean;
  onCancel: () => void;
  onSave: (selected: WebTestCase[]) => void;
  showProductFilters?: boolean;
  baseUrl?: string;
  apiUrl?: string;
  flowRole?: 'public' | 'buyer' | 'seller' | 'admin';
  model?: string;
  onCaseUpdated?: (next: WebTestCase) => void;
  /** Sync group moves / create-group edits back to parent (import + generate review) */
  onCasesChange?: (next: WebTestCase[]) => void;
}) {
  const [view, setView] = useState<ViewMode>('card');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activeFilters, setActiveFilters] = useState<Set<ProductFilter>>(
    () => new Set(['lgd-diamonds', 'non-cert']),
  );
  const [detailCase, setDetailCase] = useState<WebTestCase | null>(null);
  const [draftCases, setDraftCases] = useState<WebTestCase[]>([]);
  const [extraGroups, setExtraGroups] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [groupMsg, setGroupMsg] = useState('');
  const [expectationFilter, setExpectationFilter] =
    useState<ExpectationFilter>('all');
  const lastIdsKey = useRef('');

  function commitCases(next: WebTestCase[]) {
    setDraftCases(next);
    onCasesChange?.(next);
  }

  useEffect(() => {
    if (!open) {
      lastIdsKey.current = '';
      return;
    }
    const key = caseIdsKey(cases);
    const isFreshOpen = !lastIdsKey.current;
    const idsChanged = lastIdsKey.current !== key;
    if (isFreshOpen || idsChanged) {
      setDraftCases(cases);
      setExtraGroups([]);
      setNewGroupName('');
      setMoveTarget('');
      setGroupMsg('');
      setView('card');
      setSearch('');
      setActiveFilters(new Set(['lgd-diamonds', 'non-cert']));
      setExpectationFilter('all');
      setSelectedIds(new Set(cases.map((c) => c.id)));
      setDetailCase(null);
      lastIdsKey.current = key;
    } else {
      // Same ids — merge group/name updates from parent without wiping selection
      setDraftCases(cases);
    }
  }, [open, cases]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, saving, onCancel]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return draftCases.filter((c) => {
      if (expectationFilter !== 'all') {
        if (resolveExpectation(c) !== expectationFilter) return false;
      }
      if (showProductFilters) {
        const productOk =
          activeFilters.size !== 1 ||
          [...activeFilters].some((f) => matchesProductFilter(c, f));
        if (!productOk) return false;
      }
      if (!q) return true;
      const hay = [
        c.id,
        c.name,
        c.description,
        c.group || '',
        ...(c.tags || []),
        c.role || '',
        c.expectation || '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [draftCases, search, activeFilters, showProductFilters, expectationFilter]);

  const knownGroups = useMemo(() => {
    const set = new Set<string>();
    for (const c of draftCases) {
      const g = (c.group || '').trim();
      if (g) set.add(g);
    }
    for (const g of extraGroups) {
      if (g.trim()) set.add(g.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [draftCases, extraGroups]);

  const grouped = useMemo(() => {
    const map = new Map<string, WebTestCase[]>();
    for (const g of knownGroups) map.set(g, []);
    map.set(UNGROUPED, []);
    for (const c of filtered) {
      const g = (c.group || '').trim() || UNGROUPED;
      const list = map.get(g) || [];
      list.push(c);
      map.set(g, list);
    }
    // Drop empty ungrouped if unused; keep empty custom groups so user can move into them
    return [...map.entries()]
      .filter(([name, list]) => name !== UNGROUPED || list.length > 0 || knownGroups.length === 0)
      .sort((a, b) => {
        if (a[0] === UNGROUPED) return 1;
        if (b[0] === UNGROUPED) return -1;
        return a[0].localeCompare(b[0]);
      });
  }, [filtered, knownGroups]);

  const hasGroups =
    grouped.length > 1 ||
    (grouped.length === 1 && grouped[0]![0] !== UNGROUPED) ||
    knownGroups.length > 0;

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
  const someFilteredSelected = filtered.some((c) => selectedIds.has(c.id));
  const selectedCount = [...selectedIds].filter((id) =>
    draftCases.some((c) => c.id === id),
  ).length;
  const onlyDuplicates = draftCases.length === 0 && duplicates.length > 0;

  function toggleFilter(id: ProductFilter) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const c of filtered) next.delete(c.id);
      } else {
        for (const c of filtered) next.add(c.id);
      }
      return next;
    });
  }

  function toggleGroup(groupCases: WebTestCase[]) {
    const ids = groupCases.map((c) => c.id);
    const allOn = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function moveIdsToGroup(ids: string[], groupName: string) {
    const g = groupName === UNGROUPED ? undefined : groupName.trim() || undefined;
    if (!ids.length) {
      setGroupMsg('Select at least one test case to move');
      setTimeout(() => setGroupMsg(''), 2500);
      return;
    }
    const idSet = new Set(ids);
    const next = draftCases.map((c) =>
      idSet.has(c.id) ? { ...c, group: g } : c,
    );
    commitCases(next);
    setGroupMsg(
      g
        ? `Moved ${ids.length} case(s) → “${g}”`
        : `Moved ${ids.length} case(s) → Ungrouped`,
    );
    setTimeout(() => setGroupMsg(''), 2800);
  }

  function createGroup(andMoveSelected: boolean) {
    const name = newGroupName.trim();
    if (!name) {
      setGroupMsg('Enter a group name');
      setTimeout(() => setGroupMsg(''), 2500);
      return;
    }
    if (name.toLowerCase() === UNGROUPED.toLowerCase()) {
      setGroupMsg('Pick a different group name');
      setTimeout(() => setGroupMsg(''), 2500);
      return;
    }
    setExtraGroups((prev) =>
      prev.some((g) => g.toLowerCase() === name.toLowerCase())
        ? prev
        : [...prev, name],
    );
    setNewGroupName('');
    setMoveTarget(name);
    if (andMoveSelected) {
      const ids = [...selectedIds].filter((id) => draftCases.some((c) => c.id === id));
      if (ids.length) moveIdsToGroup(ids, name);
      else {
        setGroupMsg(`Created group “${name}” — select cases then Move`);
        setTimeout(() => setGroupMsg(''), 3200);
      }
    } else {
      setGroupMsg(`Created group “${name}”`);
      setTimeout(() => setGroupMsg(''), 2500);
    }
  }

  function handleSave() {
    const selected = draftCases.filter((c) => selectedIds.has(c.id));
    onSave(selected);
  }

  function renderMoveSelect(c: WebTestCase) {
    return (
      <label className="tc-move-inline" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Move to group</span>
        <select
          className="tc-move-select"
          value={c.group || UNGROUPED}
          disabled={saving}
          title="Move this case to a group"
          onChange={(e) => moveIdsToGroup([c.id], e.target.value)}
        >
          <option value={UNGROUPED}>{UNGROUPED}</option>
          {knownGroups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function renderCaseCard(c: WebTestCase) {
    const checked = selectedIds.has(c.id);
    return (
      <div
        key={c.id}
        className={`tc-select-card tc-select-card-with-actions ${checked ? 'selected' : ''}`}
      >
        <label className="tc-select-card-checkrow">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleOne(c.id)}
            disabled={saving}
          />
          <CaseCardBody c={c} />
        </label>
        <div className="tc-select-card-actions">
          {renderMoveSelect(c)}
          <button
            type="button"
            className="btn btn-ghost buyer-case-action-btn"
            disabled={saving}
            onClick={() => setDetailCase(c)}
          >
            👁 View test case
          </button>
        </div>
      </div>
    );
  }

  if (!open) return null;

  return (
    <div
      className="report-modal-root tc-select-modal-root"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Review test cases'}
    >
      <div className="report-modal-backdrop" onClick={saving ? undefined : onCancel} />
      <div className="report-modal tc-select-modal">
        <header className="report-modal-header">
          <div className="modal-header-copy">
            <h2>{title || 'Review test cases'}</h2>
            <p className="history-meta">
              {onlyDuplicates
                ? `${duplicates.length} already in library`
                : `${selectedCount} of ${draftCases.length} new selected`}
              {duplicates.length && !onlyDuplicates
                ? ` · ${duplicates.length} already added`
                : ''}
              {search.trim() || activeFilters.size === 1
                ? ` · showing ${filtered.length}`
                : ''}
              {knownGroups.length ? ` · ${knownGroups.length} group(s)` : ''}
            </p>
          </div>
          <div className="report-modal-actions">
            {!onlyDuplicates ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || selectedCount === 0}
              >
                {saving ? 'Saving…' : `Save (${selectedCount})`}
              </button>
            ) : null}
            <ModalCloseButton onClick={onCancel} disabled={saving} />
          </div>
        </header>

        {duplicates.length ? (
          <div className="tc-already-banner" role="status">
            <strong>Already in your library</strong>
            <span>
              {duplicates.length === 1
                ? `“${duplicates[0]!.existing.name}” is already saved — nothing new to add.`
                : `${duplicates.length} generated case(s) already exist in your library.`}
            </span>
          </div>
        ) : null}

        {duplicates.length ? (
          <section className="tc-already-section" aria-label="Already added test cases">
            <h3 className="tc-already-heading">Saved matches (not re-added)</h3>
            <div className="tc-select-cards tc-already-cards">
              {duplicates.map((d) => (
                <div
                  key={`dup-${d.existing.id}-${d.generated.id}`}
                  className="tc-select-card tc-already-card tc-select-card-with-actions"
                >
                  <div className="tc-already-card-header">
                    <span className="tc-already-badge">Already in library</span>
                    <span className="tag">{d.existing.role || 'public'}</span>
                  </div>
                  <CaseCardBody c={d.existing} hideRole />
                  <p className="tc-already-reason">
                    {matchReasonLabel(d.reason)}
                    {' · '}
                    <code>{d.existing.id}</code>
                  </p>
                  <div className="tc-select-card-actions">
                    <button
                      type="button"
                      className="btn btn-ghost buyer-case-action-btn"
                      onClick={() => setDetailCase(d.existing)}
                    >
                      👁 View test case
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {!onlyDuplicates ? (
          <>
            <div className="tc-group-toolbar" aria-label="Create and move groups">
              <div className="tc-group-create">
                <input
                  className="url-input tc-group-input"
                  type="text"
                  placeholder="New group name…"
                  value={newGroupName}
                  disabled={saving}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      createGroup(true);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving || !newGroupName.trim()}
                  onClick={() => createGroup(false)}
                >
                  Create group
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !newGroupName.trim()}
                  title="Create group and move selected cases into it"
                  onClick={() => createGroup(true)}
                >
                  Create & move selected
                </button>
              </div>
              <div className="tc-group-move">
                <select
                  className="tc-move-select tc-move-select-lg"
                  value={moveTarget}
                  disabled={saving || !selectedCount}
                  onChange={(e) => setMoveTarget(e.target.value)}
                >
                  <option value="">Move selected to…</option>
                  <option value={UNGROUPED}>{UNGROUPED}</option>
                  {knownGroups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving || !selectedCount || !moveTarget}
                  onClick={() => {
                    const ids = [...selectedIds].filter((id) =>
                      draftCases.some((c) => c.id === id),
                    );
                    moveIdsToGroup(ids, moveTarget);
                  }}
                >
                  Move selected
                </button>
              </div>
              {groupMsg ? <p className="tc-group-msg">{groupMsg}</p> : null}
            </div>

            <div className="tc-select-toolbar">
              <label className="tc-select-all">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                  }}
                  onChange={toggleSelectAll}
                  disabled={!filtered.length || saving}
                />
                <span>Select all</span>
              </label>

              <div className="expectation-tabs" role="tablist" aria-label="Positive or negative">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'positive', label: 'Positive' },
                    { id: 'negative', label: 'Negative' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={expectationFilter === tab.id}
                    className={`mode-btn ${expectationFilter === tab.id ? 'active' : ''}`}
                    disabled={saving}
                    onClick={() => setExpectationFilter(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {showProductFilters ? (
                <div className="buyer-product-selects" role="group" aria-label="Product type">
                  {PRODUCT_FILTERS.map((f) => {
                    const on = activeFilters.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`buyer-product-chip ${on ? 'active' : ''}`}
                        aria-pressed={on}
                        disabled={saving}
                        onClick={() => toggleFilter(f.id)}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <input
                className="url-input tc-select-search"
                type="search"
                placeholder="Search new test cases…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={saving}
              />

              <div className="tc-view-toggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={view === 'card' ? 'active' : ''}
                  onClick={() => setView('card')}
                  disabled={saving}
                >
                  Card view
                </button>
                <button
                  type="button"
                  className={view === 'table' ? 'active' : ''}
                  onClick={() => setView('table')}
                  disabled={saving}
                >
                  Table view
                </button>
              </div>
            </div>

            <div className="report-modal-body tc-select-body">
              {draftCases.length === 0 ? (
                <p className="step-msg">No new test cases to save.</p>
              ) : !filtered.length ? (
                <p className="step-msg">No test cases match your filters.</p>
              ) : view === 'card' ? (
                hasGroups ? (
                  <div className="tc-select-groups">
                    {grouped.map(([groupName, groupCases]) => {
                      const allOn =
                        groupCases.length > 0 &&
                        groupCases.every((c) => selectedIds.has(c.id));
                      const someOn = groupCases.some((c) => selectedIds.has(c.id));
                      return (
                        <section key={groupName} className="tc-select-group">
                          <header className="tc-select-group-header">
                            <label className="tc-select-group-title">
                              <input
                                type="checkbox"
                                checked={allOn}
                                ref={(el) => {
                                  if (el) el.indeterminate = someOn && !allOn;
                                }}
                                disabled={saving || !groupCases.length}
                                onChange={() => toggleGroup(groupCases)}
                              />
                              <span>{groupName}</span>
                              <span className="tag">{groupCases.length} cases</span>
                            </label>
                            {groupCases.length === 0 ? (
                              <span className="history-meta">Empty — move cases here</span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost buyer-case-action-btn"
                                disabled={saving || !selectedCount}
                                onClick={() => {
                                  const ids = [...selectedIds].filter((id) =>
                                    draftCases.some((c) => c.id === id),
                                  );
                                  moveIdsToGroup(ids, groupName);
                                }}
                              >
                                Move selected here
                              </button>
                            )}
                          </header>
                          {groupCases.length ? (
                            <div className="tc-select-cards">
                              {groupCases.map(renderCaseCard)}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="tc-select-cards">{filtered.map(renderCaseCard)}</div>
                )
              ) : (
                <div className="tc-select-table-wrap">
                  <table className="tc-select-table">
                    <thead>
                      <tr>
                        <th className="tc-select-col-check">
                          <span className="sr-only">Select</span>
                        </th>
                        <th>Group</th>
                        <th>Name</th>
                        <th>ID</th>
                        <th>Role</th>
                        <th>Steps</th>
                        <th>Move</th>
                        <th>View</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => {
                        const checked = selectedIds.has(c.id);
                        return (
                          <tr
                            key={c.id}
                            className={checked ? 'selected' : ''}
                            onClick={() => !saving && toggleOne(c.id)}
                          >
                            <td
                              className="tc-select-col-check"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleOne(c.id)}
                                disabled={saving}
                              />
                            </td>
                            <td>
                              <span className="tag">{c.group || '—'}</span>
                            </td>
                            <td>
                              <div className="tc-select-table-name">{c.name}</div>
                              <div className="history-meta">{c.description}</div>
                            </td>
                            <td>
                              <code>{c.id}</code>
                            </td>
                            <td>{c.role || 'public'}</td>
                            <td>{c.steps?.length ?? 0}</td>
                            <td onClick={(e) => e.stopPropagation()}>{renderMoveSelect(c)}</td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="btn btn-ghost buyer-case-action-btn"
                                disabled={saving}
                                onClick={() => setDetailCase(c)}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="report-modal-body tc-select-body">
            <p className="step-msg">
              Nothing new to save — open the matched case from your flow list to run it.
            </p>
          </div>
        )}

        <footer className="tc-select-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            {onlyDuplicates ? 'Close' : 'Cancel'}
          </button>
          {!onlyDuplicates ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || selectedCount === 0}
            >
              {saving ? 'Saving…' : `Save (${selectedCount})`}
            </button>
          ) : null}
        </footer>
      </div>

      <TestCaseDetailModal
        open={!!detailCase}
        test={detailCase}
        suiteCases={draftCases}
        baseUrl={baseUrl}
        apiUrl={apiUrl}
        flowRole={flowRole}
        model={model || OPENROUTER_AUTO}
        onClose={() => setDetailCase(null)}
        onCaseUpdated={(next) => {
          const nextList = draftCases.map((c) => (c.id === next.id ? next : c));
          if (!nextList.some((c) => c.id === next.id)) nextList.push(next);
          commitCases(nextList);
          onCaseUpdated?.(next);
          setDetailCase(next);
        }}
      />
    </div>
  );
}
