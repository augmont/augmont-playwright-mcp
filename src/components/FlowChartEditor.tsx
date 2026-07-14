'use client';

import { useState, type DragEvent } from 'react';
import {
  FLOW_ACTION_OPTIONS,
  createEmptyFork,
  findTrunkFork,
  type FlowBranchFork,
  type FlowChartNode,
  type FlowNodeAction,
} from '@/lib/flow-chart';

type BranchKey = 'positive' | 'negative';
type DropZone = { scope: 'trunk' | BranchKey; index: number };

type Props = {
  nodes: FlowChartNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (nodes: FlowChartNode[]) => void;
  disabled?: boolean;
  title?: string;
  emptyHint?: string;
};

function freshStep(label = 'New step'): FlowChartNode {
  return {
    id: `flow-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    action: 'click',
    label,
  };
}

function reorderList(list: FlowChartNode[], from: number, to: number): FlowChartNode[] {
  if (from === to || from < 0 || to < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (!item) return list;
  const insertAt = from < to ? to - 1 : to;
  next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, item);
  return next;
}

function ensureEndsLast(list: FlowChartNode[]): FlowChartNode[] {
  const end = list.filter((n) => n.action === 'end');
  const rest = list.filter((n) => n.action !== 'end');
  return [...rest, ...end];
}

export function FlowChartEditor({
  nodes,
  selectedId,
  onSelect,
  onChange,
  disabled = false,
  title = 'Flow chart editor',
  emptyHint = 'Capture MCP clicks to build the flow chart, or add steps manually.',
}: Props) {
  const editable = nodes.filter((n) => !n.locked);
  const selected = findNodeById(nodes, selectedId);
  const trunkFork = findTrunkFork(nodes);
  const [dragFrom, setDragFrom] = useState<{
    scope: 'trunk' | BranchKey;
    id: string;
  } | null>(null);
  const [dropHint, setDropHint] = useState<DropZone | null>(null);

  function findNodeById(
    list: FlowChartNode[],
    id: string | null,
  ): FlowChartNode | null {
    if (!id) return null;
    for (const n of list) {
      if (n.id === id) return n;
      if (n.fork?.enabled) {
        const inPos = findNodeById(n.fork.positive, id);
        if (inPos) return inPos;
        const inNeg = findNodeById(n.fork.negative, id);
        if (inNeg) return inNeg;
      }
    }
    return null;
  }

  function mapTrunk(
    mapper: (list: FlowChartNode[]) => FlowChartNode[],
  ): void {
    onChange(ensureEndsLast(mapper(nodes)));
  }

  function updateNodeDeep(
    id: string,
    patch: Partial<FlowChartNode> | ((n: FlowChartNode) => FlowChartNode),
  ) {
    function walk(list: FlowChartNode[]): FlowChartNode[] {
      return list.map((n) => {
        if (n.id === id && !n.locked) {
          return typeof patch === 'function' ? patch(n) : { ...n, ...patch };
        }
        if (n.fork?.enabled) {
          return {
            ...n,
            fork: {
              ...n.fork,
              positive: walk(n.fork.positive),
              negative: walk(n.fork.negative),
            },
          };
        }
        return n;
      });
    }
    onChange(walk(nodes));
  }

  function updateFork(ownerId: string, patch: Partial<FlowBranchFork>) {
    updateNodeDeep(ownerId, (n) => ({
      ...n,
      fork: n.fork ? { ...n.fork, ...patch } : createEmptyFork(patch),
    }));
  }

  function enableForkOn(id: string) {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx < 0 || nodes[idx]?.locked) return;
    // Clear other forks on trunk; move steps after this node into Positive by default
    const after = nodes
      .slice(idx + 1)
      .filter((n) => !n.locked && n.action !== 'end')
      .map((n) => {
        const { fork: _f, ...rest } = n;
        return rest;
      });
    const before = nodes.slice(0, idx).map((n) => {
      if (!n.fork) return n;
      const { fork: _f, ...rest } = n;
      return rest;
    });
    const target = nodes[idx]!;
    const { fork: _old, ...targetRest } = target;
    const forked: FlowChartNode = {
      ...targetRest,
      fork: createEmptyFork({
        positive: after,
        negative: [
          freshStep('Assert error / invalid result'),
        ],
      }),
    };
    const end = nodes.filter((n) => n.action === 'end');
    onChange([...before, forked, ...end]);
    onSelect(id);
  }

  function disableForkOn(id: string) {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const node = nodes[idx]!;
    const fork = node.fork;
    const { fork: _f, ...rest } = node;
    const absorbed = [
      ...(fork?.positive || []),
      ...(fork?.negative || []),
    ];
    const before = nodes.slice(0, idx);
    const after = nodes.slice(idx + 1);
    onChange(ensureEndsLast([...before, rest, ...absorbed, ...after]));
  }

  function addAfter(afterId: string | null, scope: 'trunk' | BranchKey = 'trunk') {
    const fresh = freshStep();
    if (scope === 'trunk') {
      if (!afterId) {
        const endIdx = nodes.findIndex((n) => n.action === 'end');
        if (endIdx >= 0) {
          const next = [...nodes];
          next.splice(endIdx, 0, fresh);
          onChange(next);
        } else {
          onChange([...nodes, fresh]);
        }
        onSelect(fresh.id);
        return;
      }
      // If adding after a forked node, add into positive by default
      const owner = nodes.find((n) => n.id === afterId);
      if (owner?.fork?.enabled) {
        updateFork(afterId, { positive: [...owner.fork.positive, fresh] });
        onSelect(fresh.id);
        return;
      }
      const idx = nodes.findIndex((n) => n.id === afterId);
      if (idx < 0) {
        onChange(
          ensureEndsLast([
            ...nodes.filter((n) => n.action !== 'end'),
            fresh,
          ]),
        );
        onSelect(fresh.id);
        return;
      }
      const next = [...nodes];
      next.splice(idx + 1, 0, fresh);
      onChange(ensureEndsLast(next));
      onSelect(fresh.id);
      return;
    }

    // Branch scope — need parent with fork
    const owner = trunkFork?.node;
    if (!owner?.fork) return;
    const list = scope === 'positive' ? owner.fork.positive : owner.fork.negative;
    let nextList: FlowChartNode[];
    if (!afterId) {
      nextList = [...list, fresh];
    } else {
      const i = list.findIndex((n) => n.id === afterId);
      nextList = [...list];
      nextList.splice(i < 0 ? nextList.length : i + 1, 0, fresh);
    }
    updateFork(owner.id, { [scope]: nextList });
    onSelect(fresh.id);
  }

  function removeNode(id: string) {
    function walk(list: FlowChartNode[]): FlowChartNode[] {
      return list
        .filter((n) => n.id !== id)
        .map((n) => {
          if (!n.fork?.enabled) return n;
          return {
            ...n,
            fork: {
              ...n.fork,
              positive: walk(n.fork.positive),
              negative: walk(n.fork.negative),
            },
          };
        });
    }
    onChange(walk(nodes));
    if (selectedId === id) onSelect(null);
  }

  function moveNode(id: string, dir: -1 | 1) {
    const trunkIdx = nodes.findIndex((n) => n.id === id);
    if (trunkIdx >= 0) {
      const target = trunkIdx + dir;
      if (target < 0 || target >= nodes.length) return;
      if (nodes[target]?.locked || nodes[trunkIdx]?.locked) return;
      const next = [...nodes];
      const tmp = next[trunkIdx]!;
      next[trunkIdx] = next[target]!;
      next[target] = tmp;
      onChange(next);
      return;
    }
    if (!trunkFork?.node.fork) return;
    for (const key of ['positive', 'negative'] as BranchKey[]) {
      const list = trunkFork.node.fork[key];
      const i = list.findIndex((n) => n.id === id);
      if (i < 0) continue;
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      const next = [...list];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      updateFork(trunkFork.node.id, { [key]: next });
      return;
    }
  }

  function onDragStart(scope: 'trunk' | BranchKey, id: string, e: DragEvent) {
    if (disabled) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragFrom({ scope, id });
  }

  function onDragOverZone(zone: DropZone, e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropHint(zone);
  }

  function onDropZone(zone: DropZone, e: DragEvent) {
    e.preventDefault();
    setDropHint(null);
    if (!dragFrom || disabled) return;

    if (dragFrom.scope === 'trunk' && zone.scope === 'trunk') {
      const from = nodes.findIndex((n) => n.id === dragFrom.id);
      if (from < 0 || nodes[from]?.locked) return;
      mapTrunk((list) => reorderList(list, from, zone.index));
      setDragFrom(null);
      return;
    }

    if (
      trunkFork?.node.fork &&
      (dragFrom.scope === 'positive' || dragFrom.scope === 'negative') &&
      zone.scope === dragFrom.scope
    ) {
      const list = trunkFork.node.fork[dragFrom.scope];
      const from = list.findIndex((n) => n.id === dragFrom.id);
      if (from < 0) return;
      updateFork(trunkFork.node.id, {
        [dragFrom.scope]: reorderList(list, from, zone.index),
      });
    }
    setDragFrom(null);
  }

  function renderNodeButton(node: FlowChartNode, opts?: { branch?: BranchKey }) {
    const isSelected = selectedId === node.id;
    const hasFork = !!node.fork?.enabled;
    return (
      <button
        type="button"
        draggable={!disabled && !node.locked}
        onDragStart={(e) =>
          onDragStart(opts?.branch || 'trunk', node.id, e)
        }
        onDragEnd={() => {
          setDragFrom(null);
          setDropHint(null);
        }}
        className={`flow-chart-node action-${node.action}${isSelected ? ' selected' : ''}${node.locked ? ' locked' : ''}${hasFork ? ' has-fork' : ''}${opts?.branch ? ` branch-${opts.branch}` : ''}`}
        disabled={disabled}
        onClick={() => onSelect(node.id)}
      >
        {!node.locked ? (
          <span className="flow-chart-drag" title="Drag to reorder" aria-hidden>
            ⋮⋮
          </span>
        ) : null}
        <span className="flow-chart-node-badge">{node.action}</span>
        <span className="flow-chart-node-label">{node.label}</span>
        {hasFork ? (
          <span className="flow-chart-fork-pill">+/− fork</span>
        ) : null}
        {node.selector || node.url || node.text ? (
          <span className="flow-chart-node-meta">
            {node.url || node.selector || node.text}
          </span>
        ) : null}
      </button>
    );
  }

  function renderDropLine(zone: DropZone) {
    const active =
      dropHint?.scope === zone.scope && dropHint.index === zone.index;
    return (
      <div
        className={`flow-chart-drop${active ? ' active' : ''}`}
        onDragOver={(e) => onDragOverZone(zone, e)}
        onDrop={(e) => onDropZone(zone, e)}
        aria-hidden
      />
    );
  }

  function renderBranchColumn(
    owner: FlowChartNode,
    key: BranchKey,
  ) {
    const fork = owner.fork!;
    const list = fork[key];
    const label = key === 'positive' ? fork.positiveLabel : fork.negativeLabel;
    const definition =
      key === 'positive' ? fork.positiveDefinition : fork.negativeDefinition;

    return (
      <div className={`flow-branch-col flow-branch-${key}`}>
        <div className={`flow-branch-head expectation-tag expectation-${key}`}>
          {key === 'positive' ? '✓' : '✕'} {label}
        </div>
        <p className="flow-branch-def">{definition}</p>
        <div className="flow-branch-steps">
          {renderDropLine({ scope: key, index: 0 })}
          {list.map((node, index) => (
            <div key={node.id} className="flow-chart-item">
              {renderNodeButton(node, { branch: key })}
              {renderDropLine({ scope: key, index: index + 1 })}
            </div>
          ))}
          {!list.length ? (
            <p className="step-msg">No steps on this path yet</p>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled}
          onClick={() => addAfter(null, key)}
        >
          + Add {key} step
        </button>
        <div className={`flow-branch-end expectation-${key}`}>
          End · {key === 'positive' ? 'success' : 'error path'}
        </div>
      </div>
    );
  }

  const selectedOnTrunk = selected && nodes.some((n) => n.id === selected.id);
  const selectedInBranch: BranchKey | null =
    trunkFork?.node.fork && selected
      ? trunkFork.node.fork.positive.some((n) => n.id === selected.id)
        ? 'positive'
        : trunkFork.node.fork.negative.some((n) => n.id === selected.id)
          ? 'negative'
          : null
      : null;

  return (
    <div className={`flow-chart-editor${disabled ? ' is-disabled' : ''}`}>
      <div className="flow-chart-toolbar">
        <div>
          <strong>{title}</strong>
          <p className="field-hint flow-chart-toolbar-hint">
            Drag steps (⋮⋮) to reorder. On any step enable{' '}
            <strong>Positive / Negative fork</strong> — define where each path goes
            after that step.
          </p>
        </div>
        <div className="flow-chart-toolbar-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => addAfter(selectedId && !selected?.locked ? selectedId : null, selectedInBranch || 'trunk')}
          >
            + Add step
          </button>
        </div>
      </div>

      {!editable.length ? (
        <p className="step-msg flow-chart-empty">{emptyHint}</p>
      ) : null}

      <div className="flow-chart-layout">
        <div className="flow-chart-canvas" role="list">
          {renderDropLine({ scope: 'trunk', index: 0 })}
          {nodes.map((node, index) => {
            const isLast = index === nodes.length - 1;
            return (
              <div key={node.id} className="flow-chart-item" role="listitem">
                {renderNodeButton(node)}
                {node.fork?.enabled ? (
                  <div className="flow-fork-panel">
                    <div className="flow-fork-split" aria-hidden>
                      <span className="flow-fork-arm pos" />
                      <span className="flow-fork-arm neg" />
                    </div>
                    <div className="flow-fork-cols">
                      {renderBranchColumn(node, 'positive')}
                      {renderBranchColumn(node, 'negative')}
                    </div>
                  </div>
                ) : !isLast ? (
                  <div className="flow-chart-connector" aria-hidden />
                ) : null}
                {renderDropLine({ scope: 'trunk', index: index + 1 })}
              </div>
            );
          })}
        </div>

        <div className="flow-chart-inspector">
          <h3 className="tc-detail-subhead">Edit node</h3>
          {!selected || selected.locked ? (
            <p className="step-msg">
              {selected?.locked
                ? 'Start / End nodes are fixed.'
                : 'Select a step to edit. Enable a Positive / Negative fork to split what happens next.'}
            </p>
          ) : (
            <div className="flow-chart-fields">
              <label className="field">
                <span>Action</span>
                <select
                  value={selected.action}
                  disabled={disabled}
                  onChange={(e) =>
                    updateNodeDeep(selected.id, {
                      action: e.target.value as FlowNodeAction,
                    })
                  }
                >
                  {FLOW_ACTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Label</span>
                <input
                  type="text"
                  value={selected.label}
                  disabled={disabled}
                  onChange={(e) =>
                    updateNodeDeep(selected.id, { label: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Selector</span>
                <input
                  type="text"
                  value={selected.selector || ''}
                  disabled={disabled}
                  onChange={(e) =>
                    updateNodeDeep(selected.id, { selector: e.target.value })
                  }
                  placeholder="CSS / data-id selector"
                />
              </label>
              <label className="field">
                <span>Text</span>
                <input
                  type="text"
                  value={selected.text || ''}
                  disabled={disabled}
                  onChange={(e) =>
                    updateNodeDeep(selected.id, { text: e.target.value })
                  }
                  placeholder="Visible button / assert text"
                />
              </label>
              <label className="field">
                <span>URL / path</span>
                <input
                  type="text"
                  value={selected.url || ''}
                  disabled={disabled}
                  onChange={(e) =>
                    updateNodeDeep(selected.id, { url: e.target.value })
                  }
                  placeholder="/buyer/cart"
                />
              </label>
              <label className="field">
                <span>Value</span>
                <input
                  type="text"
                  value={selected.value || ''}
                  disabled={disabled}
                  onChange={(e) =>
                    updateNodeDeep(selected.id, { value: e.target.value })
                  }
                  placeholder="Fill value / wait ms / role"
                />
              </label>

              {selectedOnTrunk ? (
                <div className="flow-fork-controls">
                  <h4 className="tc-detail-subhead">Positive / Negative paths</h4>
                  <p className="field-hint">
                    After this step, the suite forks: <strong>Positive</strong> = happy
                    path (what goes next on success). <strong>Negative</strong> = error
                    path (what goes next on failure / invalid).
                  </p>
                  {selected.fork?.enabled ? (
                    <>
                      <label className="field">
                        <span>Positive definition</span>
                        <textarea
                          rows={2}
                          value={selected.fork.positiveDefinition}
                          disabled={disabled}
                          onChange={(e) =>
                            updateFork(selected.id, {
                              positiveDefinition: e.target.value,
                            })
                          }
                          placeholder="When success — which part continues"
                        />
                      </label>
                      <label className="field">
                        <span>Positive path label</span>
                        <input
                          type="text"
                          value={selected.fork.positiveLabel}
                          disabled={disabled}
                          onChange={(e) =>
                            updateFork(selected.id, {
                              positiveLabel: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Negative definition</span>
                        <textarea
                          rows={2}
                          value={selected.fork.negativeDefinition}
                          disabled={disabled}
                          onChange={(e) =>
                            updateFork(selected.id, {
                              negativeDefinition: e.target.value,
                            })
                          }
                          placeholder="When fail — which part continues"
                        />
                      </label>
                      <label className="field">
                        <span>Negative path label</span>
                        <input
                          type="text"
                          value={selected.fork.negativeLabel}
                          disabled={disabled}
                          onChange={(e) =>
                            updateFork(selected.id, {
                              negativeLabel: e.target.value,
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={disabled}
                        onClick={() => disableForkOn(selected.id)}
                      >
                        Remove fork (merge paths back)
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={disabled || (!!trunkFork && trunkFork.node.id !== selected.id)}
                      title={
                        trunkFork && trunkFork.node.id !== selected.id
                          ? 'Only one fork per chart — remove the other first'
                          : 'Split Positive / Negative after this step'
                      }
                      onClick={() => enableForkOn(selected.id)}
                    >
                      ⊕ Add Positive / Negative fork
                    </button>
                  )}
                </div>
              ) : selectedInBranch ? (
                <p className="field-hint">
                  This step is on the <strong>{selectedInBranch}</strong> path only.
                  Drag to reorder within that path.
                </p>
              ) : null}

              <div className="flow-chart-node-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => moveNode(selected.id, -1)}
                >
                  ↑ Up
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => moveNode(selected.id, 1)}
                >
                  ↓ Down
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() =>
                    addAfter(selected.id, selectedInBranch || 'trunk')
                  }
                >
                  + After
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => removeNode(selected.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
