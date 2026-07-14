'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReportDetailModal } from '@/components/ReportDetailModal';
import { TestCaseDetailModal } from '@/components/TestCaseDetailModal';
import { TestCaseGroupModal } from '@/components/TestCaseGroupModal';
import type { RunReport, TestCaseMeta, WebTestCase } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { OPENROUTER_AUTO } from '@/lib/openrouter-models';
import {
  findExpectationSibling,
  resolveExpectation,
  type TestExpectation,
} from '@/lib/test-expectation';

type ViewMode = 'card' | 'table';
type ProductFilter = 'lgd-diamonds' | 'non-cert';
type ExpectationFilter = 'all' | TestExpectation;

const PAGE_SIZE = 9;

function isDurationTag(tag: string): boolean {
  return /^~?\s*\d+(\.\d+)?\s*mins?$/i.test(tag.trim());
}
const UNGROUPED_FILTER = '__ungrouped__';
const ALL_GROUPS_FILTER = '__all__';

const PRODUCT_FILTERS: { id: ProductFilter; label: string; tags: string[] }[] = [
  {
    id: 'lgd-diamonds',
    label: 'Lab Grow Diamonds',
    tags: ['lgd-diamonds', 'certified'],
  },
  {
    id: 'non-cert',
    label: 'Lab grow non-cert',
    tags: ['non-cert', 'melee'],
  },
];

function matchesProductFilter(test: TestCaseMeta, filter: ProductFilter): boolean {
  const conf = PRODUCT_FILTERS.find((f) => f.id === filter);
  if (!conf) return false;
  const hay = [test.id, test.name, test.description, ...(test.tags || [])]
    .join(' ')
    .toLowerCase();
  return conf.tags.some((t) => hay.includes(t.toLowerCase()));
}

/** Shared test-case browser for all flows (and mobile): search, views, pagination, run, reports. */
export function FlowTestCaseBrowser({
  cases,
  showProductFilters = false,
  onDeleted,
}: {
  cases: TestCaseMeta[];
  /** Buyer-only Lab Grow Diamonds / non-cert chips */
  showProductFilters?: boolean;
  /** Called after a case is deleted so the parent can refresh the list */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [activeFilters, setActiveFilters] = useState<Set<ProductFilter>>(
    () => new Set(['lgd-diamonds', 'non-cert']),
  );
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('card');
  const [page, setPage] = useState(1);
  const [latestByTestId, setLatestByTestId] = useState<Record<string, RunReport>>({});
  const [selectedReport, setSelectedReport] = useState<RunReport | null>(null);
  const [reportMsg, setReportMsg] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const baseUrl = useAppStore((s) => s.baseUrl);
  const apiUrl = useAppStore((s) => s.apiUrl);
  const [confirmDelete, setConfirmDelete] = useState<TestCaseMeta | null>(null);
  const [viewCase, setViewCase] = useState<WebTestCase | null>(null);
  const [suiteCases, setSuiteCases] = useState<WebTestCase[]>([]);
  const [viewLoadingId, setViewLoadingId] = useState<string | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState(ALL_GROUPS_FILTER);
  const [expectationFilter, setExpectationFilter] =
    useState<ExpectationFilter>('all');

  const libraryGroups = useMemo(() => {
    const set = new Set<string>();
    for (const c of cases) {
      const g = (c.group || '').trim();
      if (g) set.add(g);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [cases]);

  const loadReports = useCallback(() => {
    fetch('/api/reports')
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, RunReport> = {};
        for (const report of (data.reports || []) as RunReport[]) {
          if (!map[report.testId]) map[report.testId] = report;
        }
        setLatestByTestId(map);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  function toggleFilter(id: ProductFilter) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPage(1);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = cases.filter((c) => {
      if (showProductFilters) {
        const productOk =
          activeFilters.size !== 1 ||
          [...activeFilters].some((f) => matchesProductFilter(c, f));
        if (!productOk) return false;
      }
      if (groupFilter === UNGROUPED_FILTER) {
        if ((c.group || '').trim()) return false;
      } else if (groupFilter !== ALL_GROUPS_FILTER) {
        if ((c.group || '').trim() !== groupFilter) return false;
      }
      if (expectationFilter !== 'all') {
        if (c.suiteMode === 'combined') {
          // Combined suites include both paths — always match polarity filters
        } else if (resolveExpectation(c) !== expectationFilter) {
          return false;
        }
      }
      if (!q) return true;
      const hay = [c.id, c.name, c.description, c.group || '', ...(c.tags || [])]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
    return [...list].sort((a, b) => {
      const ga = (a.group || '').toLowerCase();
      const gb = (b.group || '').toLowerCase();
      if (ga !== gb) {
        if (!ga) return 1;
        if (!gb) return -1;
        return ga.localeCompare(gb);
      }
      return a.name.localeCompare(b.name);
    });
  }, [cases, activeFilters, search, showProductFilters, groupFilter, expectationFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  function onSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  function runTest(testId: string) {
    router.push(`/tests/${encodeURIComponent(testId)}?autostart=1`);
  }

  function viewReport(testId: string) {
    const report = latestByTestId[testId];
    if (!report) {
      setReportMsg('No report yet for this test. Run it first.');
      setTimeout(() => setReportMsg(''), 3200);
      return;
    }
    setSelectedReport(report);
  }

  async function deleteTestCase(test: TestCaseMeta) {
    setDeletingId(test.id);
    setReportMsg('');
    try {
      const res = await fetch(`/api/tests/${encodeURIComponent(test.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : `Delete failed (HTTP ${res.status})`,
        );
      }
      setConfirmDelete(null);
      setReportMsg(`Deleted “${test.name}”.`);
      setTimeout(() => setReportMsg(''), 3200);
      onDeleted?.();
    } catch (err) {
      setReportMsg(err instanceof Error ? err.message : 'Delete failed');
      setTimeout(() => setReportMsg(''), 4000);
    } finally {
      setDeletingId(null);
    }
  }

  async function openViewCase(test: TestCaseMeta) {
    if (test.kind !== 'web-flow') {
      setReportMsg('View details is available for web-flow cases.');
      setTimeout(() => setReportMsg(''), 3200);
      return;
    }
    setViewLoadingId(test.id);
    setReportMsg('');
    try {
      const res = await fetch(`/api/tests/${encodeURIComponent(test.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load test case');
      const loaded = data.case as WebTestCase;
      const suite: WebTestCase[] = [loaded];
      const sibMeta = findExpectationSibling(loaded, cases);
      if (sibMeta) {
        try {
          const sibRes = await fetch(`/api/tests/${encodeURIComponent(sibMeta.id)}`);
          const sibData = await sibRes.json();
          if (sibRes.ok && sibData?.case) suite.push(sibData.case as WebTestCase);
        } catch {
          // pair chart still works with one side
        }
      }
      setSuiteCases(suite);
      setViewCase(loaded);
    } catch (err) {
      setReportMsg(err instanceof Error ? err.message : 'Failed to load test case');
      setTimeout(() => setReportMsg(''), 4000);
    } finally {
      setViewLoadingId(null);
    }
  }

  function renderActions(test: TestCaseMeta) {
    const hasReport = Boolean(latestByTestId[test.id]);
    const canDelete = test.kind === 'web-flow';
    return (
      <div className="buyer-case-actions" onClick={(e) => e.preventDefault()}>
        <button
          type="button"
          className="btn btn-ghost buyer-case-action-btn"
          disabled={viewLoadingId === test.id || test.kind !== 'web-flow'}
          title="View steps, JSON, Playwright & verify checklist"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void openViewCase(test);
          }}
        >
          {viewLoadingId === test.id ? 'Loading…' : '👁 View test case'}
        </button>
        <button
          type="button"
          className="btn btn-primary buyer-case-action-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            runTest(test.id);
          }}
        >
          Run test case
        </button>
        <button
          type="button"
          className="btn btn-ghost buyer-case-action-btn"
          disabled={!hasReport}
          title={hasReport ? 'Open latest report' : 'No report yet — run the test first'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            viewReport(test.id);
          }}
        >
          View report
        </button>
        {canDelete ? (
          <button
            type="button"
            className="btn btn-ghost buyer-case-action-btn buyer-case-delete-btn"
            disabled={deletingId === test.id}
            title="Delete this test case"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirmDelete(test);
            }}
          >
            {deletingId === test.id ? 'Deleting…' : 'Delete'}
          </button>
        ) : null}
      </div>
    );
  }

  function setGroupFilterAndReset(value: string) {
    setGroupFilter(value);
    setPage(1);
  }

  const filterHintParts = [
    expectationFilter === 'all'
      ? ''
      : expectationFilter === 'positive'
        ? 'Positive'
        : 'Negative',
    !showProductFilters
      ? ''
      : activeFilters.size === 2
        ? 'both product types'
        : activeFilters.size === 1
          ? PRODUCT_FILTERS.find((f) => activeFilters.has(f.id))?.label
          : 'all products',
    groupFilter === ALL_GROUPS_FILTER
      ? ''
      : groupFilter === UNGROUPED_FILTER
        ? 'Ungrouped'
        : groupFilter,
  ].filter(Boolean);
  const filterHint = filterHintParts.length ? ` · ${filterHintParts.join(' · ')}` : '';

  return (
    <section className="buyer-case-browser">
      <div className="buyer-case-toolbar">
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
              onClick={() => {
                setExpectationFilter(tab.id);
                setPage(1);
              }}
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
                  onClick={() => toggleFilter(f.id)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <input
          className="url-input buyer-case-search"
          type="search"
          placeholder="Search test cases…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />

        <div className="buyer-group-filter" role="group" aria-label="Filter by group">
          <select
            className="tc-move-select tc-move-select-lg"
            value={groupFilter}
            aria-label="Group filter"
            onChange={(e) => setGroupFilterAndReset(e.target.value)}
          >
            <option value={ALL_GROUPS_FILTER}>All groups</option>
            <option value={UNGROUPED_FILTER}>Ungrouped</option>
            {libraryGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setGroupsOpen(true)}
          >
            Manage groups
          </button>
        </div>

        <div className="tc-view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={view === 'card' ? 'active' : ''}
            onClick={() => setView('card')}
          >
            Card view
          </button>
          <button
            type="button"
            className={view === 'table' ? 'active' : ''}
            onClick={() => setView('table')}
          >
            Table view
          </button>
        </div>
      </div>

      <div className="buyer-case-meta-row">
        <p className="buyer-case-meta">
          Showing {rangeStart}–{rangeEnd} of {filtered.length}
          {filtered.length !== cases.length ? ` (filtered from ${cases.length})` : ''}
          {' · '}
          {view === 'card' ? 'card' : 'table'} view
          {filterHint}
        </p>
        {reportMsg ? <p className="error-text buyer-case-report-msg">{reportMsg}</p> : null}
      </div>

      {!filtered.length ? (
        <p className="hero-sub">No test cases match these filters.</p>
      ) : view === 'card' ? (
        <div className="cards-grid buyer-cards-grid">
          {pageItems.map((test) => (
            <div key={test.id} className="test-card buyer-case-card">
              <Link href={`/tests/${test.id}`} className="buyer-case-card-link">
                <h2>
                  {test.name}{' '}
                  <span
                    className={`tag expectation-tag expectation-${test.suiteMode === 'combined' ? 'positive' : resolveExpectation(test)}`}
                  >
                    {test.suiteMode === 'combined'
                      ? 'combined +/−'
                      : resolveExpectation(test)}
                  </span>
                </h2>
                <p>{test.description}</p>
                <div className="tag-row">
                  {test.group ? (
                    <span className="tag tag-accent">{test.group}</span>
                  ) : null}
                  {test.tags
                    .filter(
                      (tag) =>
                        !isDurationTag(tag) &&
                        !/^(positive|negative)$/i.test(tag),
                    )
                    .map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  <span className="tag">~{test.estimatedMinutes} min</span>
                </div>
              </Link>
              {renderActions(test)}
            </div>
          ))}
        </div>
      ) : (
        <div className="tc-select-table-wrap buyer-case-table-wrap">
          <table className="tc-select-table buyer-case-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Group</th>
                <th>Name</th>
                <th>ID</th>
                <th>Tags</th>
                <th>Est.</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((test, idx) => (
                <tr key={test.id}>
                  <td className="buyer-case-row-num">{rangeStart + idx}</td>
                  <td>
                    {test.group ? <span className="tag tag-accent">{test.group}</span> : '—'}
                  </td>
                  <td>
                    <Link href={`/tests/${test.id}`} className="buyer-case-table-link">
                      <div className="tc-select-table-name">
                        {test.name}{' '}
                        <span
                          className={`tag expectation-tag expectation-${test.suiteMode === 'combined' ? 'positive' : resolveExpectation(test)}`}
                        >
                          {test.suiteMode === 'combined'
                            ? 'combined +/−'
                            : resolveExpectation(test)}
                        </span>
                      </div>
                      <div className="history-meta">{test.description}</div>
                    </Link>
                  </td>
                  <td>
                    <code>{test.id}</code>
                  </td>
                  <td>{(test.tags || []).join(', ') || '—'}</td>
                  <td>~{test.estimatedMinutes} min</td>
                  <td>{renderActions(test)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="buyer-case-pagination">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="buyer-case-page-label">
            Page {safePage} of {totalPages} · {PAGE_SIZE} per page
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}

      <ReportDetailModal
        open={!!selectedReport}
        report={selectedReport}
        onClose={() => {
          setSelectedReport(null);
          loadReports();
        }}
      />

      {confirmDelete ? (
        <div
          className="report-modal-root"
          role="dialog"
          aria-modal="true"
          aria-label="Delete test case"
        >
          <div
            className="report-modal-backdrop"
            onClick={deletingId ? undefined : () => setConfirmDelete(null)}
          />
          <div className="report-modal tc-delete-modal">
            <header className="report-modal-header">
              <div className="modal-header-copy">
                <h2>Delete test case?</h2>
                <p className="history-meta">
                  {confirmDelete.source === 'seed'
                    ? 'This is a built-in seed case. It will be removed from your library until you reset seeds.'
                    : 'This permanently removes the case from your library.'}
                </p>
              </div>
            </header>
            <div className="report-modal-body">
              <p>
                <strong>{confirmDelete.name}</strong>
              </p>
              <p className="history-meta">
                <code>{confirmDelete.id}</code>
                {confirmDelete.source ? ` · ${confirmDelete.source}` : ''}
              </p>
            </div>
            <footer className="tc-select-footer">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!!deletingId}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary buyer-case-delete-confirm"
                disabled={!!deletingId}
                onClick={() => void deleteTestCase(confirmDelete)}
              >
                {deletingId ? 'Deleting…' : 'Delete'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      <TestCaseDetailModal
        open={!!viewCase}
        test={viewCase}
        suiteCases={suiteCases}
        baseUrl={baseUrl}
        apiUrl={apiUrl}
        flowRole={
          viewCase?.role === 'buyer' ||
          viewCase?.role === 'admin' ||
          viewCase?.role === 'seller' ||
          viewCase?.role === 'public'
            ? viewCase.role
            : undefined
        }
        model={OPENROUTER_AUTO}
        onClose={() => {
          setViewCase(null);
          setSuiteCases([]);
        }}
        onCaseUpdated={(next) => {
          setViewCase(next);
          setSuiteCases((prev) => {
            const i = prev.findIndex((c) => c.id === next.id);
            if (i < 0) return [...prev, next];
            const copy = [...prev];
            copy[i] = next;
            return copy;
          });
        }}
        onSavedReplace={async (next) => {
          try {
            const res = await fetch('/api/tests/apply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cases: [next], source: 'claude' }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            setReportMsg(`Saved “${next.name}”.`);
            setTimeout(() => setReportMsg(''), 3200);
            onDeleted?.();
          } catch (err) {
            setReportMsg(err instanceof Error ? err.message : 'Save failed');
            setTimeout(() => setReportMsg(''), 4000);
          }
        }}
      />

      <TestCaseGroupModal
        open={groupsOpen}
        cases={cases}
        onClose={() => setGroupsOpen(false)}
        onChanged={() => onDeleted?.()}
      />
    </section>
  );
}

/** @deprecated Use FlowTestCaseBrowser — kept for existing imports */
export function BuyerTestCaseBrowser({ cases }: { cases: TestCaseMeta[] }) {
  return <FlowTestCaseBrowser cases={cases} showProductFilters />;
}
