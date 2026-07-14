'use client';

import { useEffect, useMemo, useState } from 'react';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import type { TestCaseMeta, WebTestCase } from '@/lib/types';

const UNGROUPED = 'Ungrouped';

/**
 * Separate modal for creating groups and moving library cases into groups.
 * Saves immediately via /api/tests/apply.
 */
export function TestCaseGroupModal({
  open,
  cases,
  onClose,
  onChanged,
}: {
  open: boolean;
  cases: TestCaseMeta[];
  onClose: () => void;
  /** Refresh parent list after a move */
  onChanged?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('__all__');
  const [extraGroups, setExtraGroups] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [movingId, setMovingId] = useState<string | null>(null);
  const [bulkTarget, setBulkTarget] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const webCases = useMemo(
    () => cases.filter((c) => c.kind === 'web-flow'),
    [cases],
  );

  const knownGroups = useMemo(() => {
    const set = new Set<string>();
    for (const c of webCases) {
      const g = (c.group || '').trim();
      if (g) set.add(g);
    }
    for (const g of extraGroups) if (g.trim()) set.add(g.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [webCases, extraGroups]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setGroupFilter('__all__');
    setNewGroupName('');
    setSelectedIds(new Set());
    setBulkTarget('');
    setMsg('');
    setErr('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !movingId) {
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
  }, [open, movingId, onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return webCases.filter((c) => {
      if (groupFilter === '__ungrouped__') {
        if ((c.group || '').trim()) return false;
      } else if (groupFilter !== '__all__') {
        if ((c.group || '').trim() !== groupFilter) return false;
      }
      if (!q) return true;
      const hay = [c.id, c.name, c.description, c.group || '', ...(c.tags || [])]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [webCases, search, groupFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, TestCaseMeta[]>();
    for (const c of filtered) {
      const g = (c.group || '').trim() || UNGROUPED;
      const list = map.get(g) || [];
      list.push(c);
      map.set(g, list);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === UNGROUPED) return 1;
      if (b[0] === UNGROUPED) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  if (!open) return null;

  function flash(ok: string) {
    setMsg(ok);
    setErr('');
    setTimeout(() => setMsg(''), 3200);
  }

  function createGroup(andMoveSelected: boolean) {
    const name = newGroupName.trim();
    if (!name) {
      setErr('Enter a group name');
      return;
    }
    if (name.toLowerCase() === UNGROUPED.toLowerCase()) {
      setErr('Pick a different group name');
      return;
    }
    setExtraGroups((prev) =>
      prev.some((g) => g.toLowerCase() === name.toLowerCase())
        ? prev
        : [...prev, name],
    );
    setNewGroupName('');
    setBulkTarget(name);
    if (andMoveSelected && selectedIds.size) {
      void moveIds([...selectedIds], name);
    } else {
      flash(`Created group “${name}”`);
    }
  }

  async function moveCaseToGroup(test: TestCaseMeta, groupName: string) {
    const nextGroup =
      !groupName || groupName === UNGROUPED ? undefined : groupName.trim();
    if ((test.group || undefined) === nextGroup) return;
    setMovingId(test.id);
    setErr('');
    try {
      const res = await fetch(`/api/tests/${encodeURIComponent(test.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load test case');
      const full = data.case as WebTestCase;
      const updated: WebTestCase = { ...full, group: nextGroup };
      const save = await fetch('/api/tests/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cases: [updated],
          source: full.source === 'upload' ? 'upload' : 'claude',
        }),
      });
      const saveData = await save.json();
      if (!save.ok) throw new Error(saveData.error || 'Failed to update group');
      flash(
        nextGroup
          ? `Moved “${test.name}” → ${nextGroup}`
          : `Removed “${test.name}” from group`,
      );
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Move failed');
    } finally {
      setMovingId(null);
    }
  }

  async function moveIds(ids: string[], groupName: string) {
    if (!ids.length) {
      setErr('Select at least one case');
      return;
    }
    setMovingId('bulk');
    setErr('');
    let ok = 0;
    try {
      for (const id of ids) {
        const test = webCases.find((c) => c.id === id);
        if (!test) continue;
        const nextGroup =
          !groupName || groupName === UNGROUPED ? undefined : groupName.trim();
        if ((test.group || undefined) === nextGroup) {
          ok += 1;
          continue;
        }
        const res = await fetch(`/api/tests/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to load ${id}`);
        const full = data.case as WebTestCase;
        const updated: WebTestCase = { ...full, group: nextGroup };
        const save = await fetch('/api/tests/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cases: [updated],
            source: full.source === 'upload' ? 'upload' : 'claude',
          }),
        });
        const saveData = await save.json();
        if (!save.ok) throw new Error(saveData.error || `Failed to move ${id}`);
        ok += 1;
      }
      flash(`Moved ${ok} case(s) → ${groupName === UNGROUPED ? UNGROUPED : groupName}`);
      setSelectedIds(new Set());
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Bulk move failed');
    } finally {
      setMovingId(null);
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    const allOn =
      filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of filtered) {
        if (allOn) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  const busy = !!movingId;
  const selectedCount = [...selectedIds].filter((id) =>
    webCases.some((c) => c.id === id),
  ).length;

  return (
    <div
      className="report-modal-root tc-group-modal-root"
      role="dialog"
      aria-modal="true"
      aria-label="Manage test case groups"
    >
      <div
        className="report-modal-backdrop"
        onClick={busy ? undefined : onClose}
      />
      <div className="report-modal tc-group-modal">
        <header className="report-modal-header">
          <div className="modal-header-copy">
            <h2>Manage groups</h2>
            <p className="history-meta">
              Create groups and move cases · {webCases.length} web-flow case(s)
              {knownGroups.length ? ` · ${knownGroups.length} group(s)` : ''}
            </p>
          </div>
          <ModalCloseButton onClick={onClose} disabled={busy} />
        </header>

        <div className="tc-group-modal-toolbar">
          <div className="tc-group-create">
            <input
              className="url-input tc-group-input"
              type="text"
              placeholder="New group name…"
              value={newGroupName}
              disabled={busy}
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
              disabled={busy || !newGroupName.trim()}
              onClick={() => createGroup(false)}
            >
              Create group
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !newGroupName.trim()}
              onClick={() => createGroup(true)}
            >
              Create & move selected
            </button>
          </div>

          <div className="tc-group-filters">
            <input
              className="url-input tc-select-search"
              type="search"
              placeholder="Filter by name, id, tag…"
              value={search}
              disabled={busy}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="tc-move-select tc-move-select-lg"
              value={groupFilter}
              disabled={busy}
              aria-label="Filter by group"
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="__all__">All groups</option>
              <option value="__ungrouped__">{UNGROUPED}</option>
              {knownGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <div className="tc-group-filter-chips" role="group" aria-label="Quick group filter">
              <button
                type="button"
                className={`buyer-product-chip ${groupFilter === '__all__' ? 'active' : ''}`}
                disabled={busy}
                onClick={() => setGroupFilter('__all__')}
              >
                All
              </button>
              <button
                type="button"
                className={`buyer-product-chip ${groupFilter === '__ungrouped__' ? 'active' : ''}`}
                disabled={busy}
                onClick={() => setGroupFilter('__ungrouped__')}
              >
                {UNGROUPED}
              </button>
              {knownGroups.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`buyer-product-chip ${groupFilter === g ? 'active' : ''}`}
                  disabled={busy}
                  onClick={() => setGroupFilter(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="tc-group-move">
            <label className="tc-select-all">
              <input
                type="checkbox"
                checked={
                  filtered.length > 0 &&
                  filtered.every((c) => selectedIds.has(c.id))
                }
                ref={(el) => {
                  if (el) {
                    const some = filtered.some((c) => selectedIds.has(c.id));
                    const all =
                      filtered.length > 0 &&
                      filtered.every((c) => selectedIds.has(c.id));
                    el.indeterminate = some && !all;
                  }
                }}
                disabled={busy || !filtered.length}
                onChange={toggleAllFiltered}
              />
              <span>Select filtered ({selectedCount})</span>
            </label>
            <select
              className="tc-move-select tc-move-select-lg"
              value={bulkTarget}
              disabled={busy || !selectedCount}
              onChange={(e) => setBulkTarget(e.target.value)}
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
              disabled={busy || !selectedCount || !bulkTarget}
              onClick={() => void moveIds([...selectedIds], bulkTarget)}
            >
              {movingId === 'bulk' ? 'Moving…' : 'Move selected'}
            </button>
          </div>

          {msg ? <p className="tc-group-msg">{msg}</p> : null}
          {err ? <p className="error-text">{err}</p> : null}
        </div>

        <div className="report-modal-body tc-group-modal-body">
          {!filtered.length ? (
            <p className="step-msg">No cases match these filters.</p>
          ) : (
            <div className="tc-select-groups">
              {grouped.map(([groupName, groupCases]) => (
                <section key={groupName} className="tc-select-group">
                  <header className="tc-select-group-header">
                    <div className="tc-select-group-title">
                      <span>{groupName}</span>
                      <span className="tag">{groupCases.length}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost buyer-case-action-btn"
                      disabled={busy || !selectedCount}
                      onClick={() => void moveIds([...selectedIds], groupName)}
                    >
                      Move selected here
                    </button>
                  </header>
                  <ul className="tc-group-case-list">
                    {groupCases.map((c) => {
                      const checked = selectedIds.has(c.id);
                      return (
                        <li key={c.id} className={checked ? 'selected' : ''}>
                          <label className="tc-group-case-row">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy}
                              onChange={() => toggleOne(c.id)}
                            />
                            <span className="tc-group-case-copy">
                              <strong>{c.name}</strong>
                              <span className="history-meta">
                                <code>{c.id}</code>
                                {c.role ? ` · ${c.role}` : ''}
                              </span>
                            </span>
                          </label>
                          <select
                            className="tc-move-select"
                            value={c.group || UNGROUPED}
                            disabled={busy || movingId === c.id}
                            title="Move this case"
                            onChange={(e) =>
                              void moveCaseToGroup(c, e.target.value)
                            }
                          >
                            <option value={UNGROUPED}>{UNGROUPED}</option>
                            {knownGroups.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <footer className="tc-select-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
