'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  LoadApiMapping,
  LoadApiMappingTarget,
  LoadJsonExtract,
  WebLoadRequestStep,
} from '@/lib/types';
import {
  applyApiMappingsToStep,
  listJsonExtracts,
  newApiMapping,
  newEmptyExtract,
} from '@/lib/load-chain';

const CHAIN_PATH_PRESETS = [
  { label: 'data.id', path: '$.data.id' },
  { label: 'data[0].id', path: '$.data[0].id' },
  { label: 'data.token', path: '$.data.token' },
  { label: 'id', path: '$.id' },
  { label: 'data.name', path: '$.data.name' },
  { label: 'data.email', path: '$.data.email' },
  { label: 'message', path: '$.message' },
  { label: 'status', path: '$.status' },
];

const MAP_TARGETS: { id: LoadApiMappingTarget; label: string; icon: string; desc: string }[] = [
  { id: 'body', label: 'Body JSON', icon: '{ }', desc: 'Set a JSON key in the request body' },
  { id: 'query', label: 'Query Param', icon: '?=', desc: 'Add as URL query parameter' },
  { id: 'path', label: 'Path Param', icon: '/:id', desc: 'Replace a path token like :id' },
  { id: 'header', label: 'Header', icon: 'H', desc: 'Set a request header value' },
  { id: 'form', label: 'Form Field', icon: '⊞', desc: 'Set a form-data field value' },
];

function sanitizeVarName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64);
}

export type ChainVarChip = {
  varName: string;
  fromStep: string;
};

type Props = {
  active: WebLoadRequestStep;
  scenarioIndex: number;
  chainVars: ChainVarChip[];
  extractPreview: string | null;
  onPatch: (patch: Partial<WebLoadRequestStep>) => void;
  onInsertToken: (token: string) => void;
  /** All scenarios in the load case — used for scenario-to-chain drag-drop */
  allScenarios?: WebLoadRequestStep[];
  /** Patch a scenario by index (for auto-adding extracts on the source) */
  onPatchScenario?: (index: number, patch: Partial<WebLoadRequestStep>) => void;
};

type DragData = {
  type: 'var-chip' | 'extract-row' | 'mapping-row';
  varName?: string;
  fromStep?: string;
  index?: number;
};

type ScenarioDragData = {
  type: 'scenario-drag';
  index: number;
  method: string;
  path: string;
  extractJsons?: LoadJsonExtract[];
};

function guessDefaultExtractVar(path: string): { varName: string; jsonPath: string } {
  const segments = path.replace(/^\//, '').split('/');
  const last = segments[segments.length - 1] || 'response';
  if (last.startsWith(':') || last.startsWith('{')) {
    const clean = last.replace(/[:{}]/g, '');
    return { varName: clean || 'id', jsonPath: '$.data.id' };
  }
  const resource = last.replace(/[^a-zA-Z0-9]/g, '');
  return { varName: `${resource}Id`, jsonPath: '$.data.id' };
}

function guessDefaultMappingTarget(
  currentPath: string,
): { target: LoadApiMappingTarget; targetKey: string } {
  if (currentPath.includes(':') || currentPath.includes('{')) {
    const match = currentPath.match(/[:{}]([a-zA-Z0-9_]+)/);
    return { target: 'path', targetKey: match?.[1] || 'id' };
  }
  return { target: 'body', targetKey: 'id' };
}

export function LoadChainPanel({
  active,
  scenarioIndex,
  chainVars,
  extractPreview,
  onPatch,
  onInsertToken,
  allScenarios,
  onPatchScenario,
}: Props) {
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  const extracts = useMemo(() => listJsonExtracts(active), [active]);
  const mappings = active.apiMappings || [];
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [expandedMapping, setExpandedMapping] = useState<string | null>(null);
  const [showJsonHelper, setShowJsonHelper] = useState(false);
  const [customJsonPath, setCustomJsonPath] = useState('');
  const dragDataRef = useRef<DragData | null>(null);

  function setExtracts(next: LoadJsonExtract[]) {
    const cleaned = next
      .map((ex) => ({
        ...ex,
        varName: sanitizeVarName(ex.varName),
        jsonPath: ex.jsonPath.trim(),
      }))
      .filter((ex) => ex.varName || ex.jsonPath);
    onPatch({
      extractJsons: cleaned.length ? cleaned : undefined,
      extractJson: cleaned[0],
    });
  }

  function updateExtract(i: number, patch: Partial<LoadJsonExtract>) {
    const base = extracts.length ? [...extracts] : [newEmptyExtract(0)];
    while (base.length <= i) base.push(newEmptyExtract(base.length));
    base[i] = { ...base[i]!, ...patch };
    setExtracts(base);
  }

  function removeExtract(i: number) {
    setExtracts(extracts.filter((_, j) => j !== i));
  }

  function setMappings(next: LoadApiMapping[]) {
    onPatch({
      apiMappings: next.length ? next : undefined,
    });
  }

  function applyMappingsNow() {
    const mapped = applyApiMappingsToStep(active);
    onPatch({
      pathParams: mapped.pathParams,
      queryParams: mapped.queryParams,
      headers: mapped.headers,
      formFields: mapped.formFields,
      body: mapped.body,
      apiMappings: active.apiMappings,
    });
  }

  const [scenarioDropOver, setScenarioDropOver] = useState(false);
  const [linkedScenarios, setLinkedScenarios] = useState<
    { index: number; method: string; path: string; varName: string }[]
  >([]);

  const handleScenarioDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setScenarioDropOver(false);
      const raw = e.dataTransfer.getData('application/x-scenario');
      if (!raw) return;
      let data: ScenarioDragData;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      if (data.type !== 'scenario-drag') return;
      if (data.index === scenarioIndex) return;
      if (data.index >= scenarioIndex) return; // only chain from earlier scenarios

      const sourceScenario = allScenarios?.[data.index];
      if (!sourceScenario) return;

      const guess = guessDefaultExtractVar(data.path);
      const existingExtracts = sourceScenario.extractJsons || (sourceScenario.extractJson ? [sourceScenario.extractJson] : []);
      const alreadyHasExtract = existingExtracts.some((ex) => ex.varName === guess.varName);

      if (!alreadyHasExtract && onPatchScenario) {
        onPatchScenario(data.index, {
          extractJsons: [...existingExtracts, { varName: guess.varName, jsonPath: guess.jsonPath, defaultValue: 'NOT_FOUND' }],
          extractJson: existingExtracts[0] || { varName: guess.varName, jsonPath: guess.jsonPath, defaultValue: 'NOT_FOUND' },
        });
      }

      const mappingTarget = guessDefaultMappingTarget(active.path);
      const alreadyMapped = mappings.some(
        (m) => m.sourceVar === guess.varName && m.target === mappingTarget.target,
      );
      if (!alreadyMapped) {
        setMappings([
          ...mappings,
          {
            ...newApiMapping(guess.varName),
            target: mappingTarget.target,
            targetKey: mappingTarget.targetKey,
          },
        ]);
      }

      setLinkedScenarios((prev) => {
        if (prev.some((l) => l.index === data.index)) return prev;
        return [...prev, { index: data.index, method: data.method, path: data.path, varName: guess.varName }];
      });

      if (mode === 'simple') setMode('advanced');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenarioIndex, allScenarios, onPatchScenario, mappings, active.path, mode],
  );

  function readDragData(e: React.DragEvent): DragData | null {
    try {
      const raw =
        e.dataTransfer.getData('application/json') ||
        e.dataTransfer.getData('text/plain');
      if (!raw) return dragDataRef.current;
      const parsed = JSON.parse(raw) as DragData;
      return parsed || dragDataRef.current;
    } catch {
      return dragDataRef.current;
    }
  }

  const handleDragStart = useCallback(
    (e: React.DragEvent, data: DragData) => {
      dragDataRef.current = data;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/json', JSON.stringify(data));
      e.dataTransfer.setData('text/plain', JSON.stringify(data));
      if (data.index != null) setDragIdx(data.index);
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    dragDataRef.current = null;
    setDragOver(null);
    setDragIdx(null);
  }, []);

  const handleDropOnTarget = useCallback(
    (target: LoadApiMappingTarget, e: React.DragEvent) => {
      const data = readDragData(e);
      if (!data?.varName) return;
      const existing = mappings.find(
        (m) => m.sourceVar === data.varName && m.target === target,
      );
      if (!existing) {
        setMappings([...mappings, { ...newApiMapping(data.varName!), target }]);
      }
      setDragOver(null);
      dragDataRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mappings],
  );

  const reorderExtracts = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const next = [...extracts];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      setExtracts(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extracts],
  );

  const reorderMappings = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const next = [...mappings];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      setMappings(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mappings],
  );

  return (
    <div className="scenario-tab-panel load-chain-panel">
      <div className="chain-hero">
        <div className="chain-hero-icon">⛓</div>
        <div className="chain-hero-text">
          <h3>API Chain &amp; Mapping</h3>
          <p>
            Extract response fields and wire them into later APIs.
            Drag variables onto targets or use <code>{'${var}'}</code> tokens.
          </p>
        </div>
      </div>

      <div className="chain-mode-switch">
        <button
          type="button"
          className={`chain-mode-btn ${mode === 'simple' ? 'active' : ''}`}
          onClick={() => setMode('simple')}
        >
          <span className="chain-mode-icon">⚡</span>
          <span className="chain-mode-label">Simple</span>
          <span className="chain-mode-desc">Quick extract &amp; paste</span>
        </button>
        <button
          type="button"
          className={`chain-mode-btn ${mode === 'advanced' ? 'active' : ''}`}
          onClick={() => setMode('advanced')}
        >
          <span className="chain-mode-icon">🔧</span>
          <span className="chain-mode-label">Advanced</span>
          <span className="chain-mode-desc">Drag-drop mapping builder</span>
        </button>
      </div>

      <div className="chain-dnd-guide">
        {mode === 'simple' ? (
          <p className="history-meta">
            Simple mode: click variable chips to insert <code>{'${varName}'}</code>.
            Drag extract cards to reorder JSONPaths.
          </p>
        ) : (
          <p className="history-meta">
            Advanced mode: drag a variable chip onto a target box (Body / Query / Path / Header / Form).
            Then edit the mapping <strong>Field</strong> value and click <strong>Apply mappings to this request</strong>.
          </p>
        )}
      </div>

      {/* Available chain vars from earlier APIs */}
      {chainVars.length > 0 ? (
        <div className="chain-vars-pool">
          <div className="chain-vars-pool-head">
            <span className="chain-vars-pool-label">Available Variables</span>
            <span className="chain-vars-pool-hint">
              {mode === 'advanced' ? 'Drag onto targets below' : 'Click to copy'}
            </span>
          </div>
          <div className="chain-vars-chips">
            {chainVars.map((c) => (
              <div
                key={c.varName}
                className="chain-var-chip"
                draggable={mode === 'advanced'}
                onDragStart={(e) =>
                  handleDragStart(e, {
                    type: 'var-chip',
                    varName: c.varName,
                    fromStep: c.fromStep,
                  })
                }
                onDragEnd={handleDragEnd}
                onClick={() => {
                  if (mode !== 'simple') return;
                  onInsertToken(`\${${c.varName}}`);
                }}
                title={`From "${c.fromStep}" — ${mode === 'advanced' ? 'drag to map' : 'click to copy'}`}
              >
                <span className="chain-var-chip-icon">$</span>
                <span className="chain-var-chip-name">{c.varName}</span>
                <span className="chain-var-chip-from">← {c.fromStep}</span>
                {mode === 'advanced' && (
                  <span className="chain-var-chip-grip">⠿</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : scenarioIndex === 0 ? (
        <div className="chain-empty-hint">
          <span className="chain-empty-icon">1️⃣</span>
          <p>
            First scenario — extract response fields below, then map them on later APIs.
          </p>
        </div>
      ) : (
        <div className="chain-empty-hint">
          <span className="chain-empty-icon">📭</span>
          <p>
            No extracts on earlier scenarios yet. Open a previous scenario and save response fields.
          </p>
        </div>
      )}

      {/* ─── SCENARIO CHAIN DROP ZONE ─── */}
      {scenarioIndex > 0 && (
        <div
          className={`chain-scenario-drop-zone ${scenarioDropOver ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            const hasScenario = e.dataTransfer.types.includes('application/x-scenario');
            if (hasScenario) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'link';
              setScenarioDropOver(true);
            }
          }}
          onDragLeave={() => setScenarioDropOver(false)}
          onDrop={handleScenarioDrop}
        >
          <div className="chain-scenario-drop-icon">🔗</div>
          <div className="chain-scenario-drop-text">
            <strong>Drop a scenario here to auto-chain</strong>
            <span>Drag an earlier scenario from the sidebar to automatically extract its response and map it into this API</span>
          </div>
        </div>
      )}

      {/* Linked scenarios summary */}
      {linkedScenarios.length > 0 && (
        <div className="chain-linked-scenarios">
          <h4>⛓ Chained Dependencies</h4>
          <div className="chain-linked-list">
            {linkedScenarios.map((l) => (
              <div key={l.index} className="chain-linked-item">
                <span className="chain-linked-badge">
                  <span className={`chain-linked-method method-${l.method.toLowerCase()}`}>{l.method}</span>
                  <span className="chain-linked-path">{l.path}</span>
                </span>
                <span className="chain-linked-arrow">→</span>
                <code className="chain-linked-var">${'{' + l.varName + '}'}</code>
                <span className="chain-linked-arrow">→</span>
                <span className="chain-linked-target">this API</span>
                <button
                  type="button"
                  className="chain-linked-remove"
                  onClick={() => setLinkedScenarios((prev) => prev.filter((x) => x.index !== l.index))}
                  title="Remove link"
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── EXTRACT SECTION ─── */}
      <div className="chain-section chain-extract-section">
        <div className="chain-section-head">
          <div className="chain-section-title">
            <span className="chain-section-icon">📤</span>
            <h4>Save Response Fields</h4>
            {extracts.length > 0 && (
              <span className="chain-badge">{extracts.length}</span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              setExtracts([
                ...(extracts.length ? extracts : []),
                newEmptyExtract(extracts.length),
              ])
            }
          >
            + Add Extract
          </button>
        </div>

        {extracts.length === 0 ? (
          <div className="chain-extract-empty">
            <p>Extract values from this API's JSON response to use in later scenarios.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setExtracts([newEmptyExtract(0)])}
            >
              + Enable Extract
            </button>
          </div>
        ) : (
          <div className="chain-extract-list">
            {extracts.map((ex, i) => (
              <div
                key={`${ex.varName}-${i}`}
                className={`chain-extract-card ${dragIdx === i ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) =>
                  handleDragStart(e, { type: 'extract-row', index: i })
                }
                onDragEnd={handleDragEnd}
                onDragOver={(e) => {
                  e.preventDefault();
                  const data = dragDataRef.current;
                  if (data?.type === 'extract-row' && data.index !== i) {
                    setDragOver(`extract-${i}`);
                  }
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  const data = readDragData(e);
                  if (data?.type === 'extract-row' && data.index != null) {
                    reorderExtracts(data.index, i);
                  }
                  setDragOver(null);
                }}
              >
                <div
                  className={`chain-extract-drop-indicator ${dragOver === `extract-${i}` ? 'visible' : ''}`}
                />
                <div className="chain-extract-grip" title="Drag to reorder">⠿</div>
                <div className="chain-extract-fields">
                  <div className="chain-field">
                    <label>Variable name</label>
                    <div className="chain-field-input-wrap">
                      <span className="chain-field-prefix">$</span>
                      <input
                        type="text"
                        placeholder="countryId"
                        value={ex.varName}
                        onChange={(e) =>
                          updateExtract(i, { varName: sanitizeVarName(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                  <div className="chain-field">
                    <label>JSONPath expression</label>
                    <input
                      type="text"
                      placeholder="$.data.id"
                      value={ex.jsonPath}
                      onChange={(e) => updateExtract(i, { jsonPath: e.target.value })}
                    />
                  </div>
                  <div className="chain-field chain-field-default">
                    <label>Fallback</label>
                    <input
                      type="text"
                      placeholder="NOT_FOUND"
                      value={ex.defaultValue || ''}
                      onChange={(e) =>
                        updateExtract(i, { defaultValue: e.target.value })
                      }
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="chain-extract-remove"
                  title="Remove extract"
                  onClick={() => removeExtract(i)}
                >
                  ✕
                </button>
              </div>
            ))}

            {/* JSONPath quick-pick */}
            <div className="chain-jsonpath-bar">
              <span className="chain-jsonpath-label">Quick paths:</span>
              <div className="chain-jsonpath-chips">
                {CHAIN_PATH_PRESETS.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    className="chain-jsonpath-chip"
                    onClick={() => {
                      if (!extracts.length) {
                        setExtracts([{ ...newEmptyExtract(0), jsonPath: p.path }]);
                      } else {
                        updateExtract(extracts.length - 1, { jsonPath: p.path });
                      }
                    }}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`chain-jsonpath-chip chain-jsonpath-custom ${showJsonHelper ? 'active' : ''}`}
                  onClick={() => setShowJsonHelper(!showJsonHelper)}
                >
                  Custom…
                </button>
              </div>
            </div>

            {showJsonHelper && (
              <div className="chain-jsonpath-helper">
                <input
                  type="text"
                  placeholder="Type a custom JSONPath, e.g. $.data.items[0].name"
                  value={customJsonPath}
                  onChange={(e) => setCustomJsonPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customJsonPath.trim()) {
                      if (!extracts.length) {
                        setExtracts([
                          { ...newEmptyExtract(0), jsonPath: customJsonPath.trim() },
                        ]);
                      } else {
                        updateExtract(extracts.length - 1, {
                          jsonPath: customJsonPath.trim(),
                        });
                      }
                      setCustomJsonPath('');
                      setShowJsonHelper(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!customJsonPath.trim()}
                  onClick={() => {
                    if (!extracts.length) {
                      setExtracts([
                        { ...newEmptyExtract(0), jsonPath: customJsonPath.trim() },
                      ]);
                    } else {
                      updateExtract(extracts.length - 1, {
                        jsonPath: customJsonPath.trim(),
                      });
                    }
                    setCustomJsonPath('');
                    setShowJsonHelper(false);
                  }}
                >
                  Apply
                </button>
              </div>
            )}

            {/* Usage hint */}
            {extracts.some((e) => e.varName) && (
              <div className="chain-extract-usage">
                <span className="chain-extract-usage-label">Use in later APIs:</span>
                {extracts
                  .filter((e) => e.varName)
                  .map((e) => (
                    <code
                      key={e.varName}
                      className="chain-extract-usage-token"
                      onClick={() => onInsertToken(`\${${e.varName}}`)}
                      title="Click to copy"
                    >
                      {`\${${e.varName}}`}
                    </code>
                  ))}
              </div>
            )}

            {extractPreview ? (
              <div className="chain-extract-preview">
                <span className="chain-extract-preview-icon">✓</span>
                <code>{extractPreview}</code>
              </div>
            ) : extracts.length > 0 ? (
              <p className="history-meta">
                Click <strong>Send</strong> to preview extracted values from the live response.
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* ─── ADVANCED: DRAG-DROP MAPPING BUILDER ─── */}
      {mode === 'advanced' && (
        <div className="chain-section chain-mapping-section">
          <div className="chain-section-head">
            <div className="chain-section-title">
              <span className="chain-section-icon">🔗</span>
              <h4>API Mapping</h4>
              {mappings.length > 0 && (
                <span className="chain-badge">{mappings.length}</span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setMappings([
                  ...mappings,
                  newApiMapping(chainVars[0]?.varName || 'myVar'),
                ])
              }
            >
              + Add Mapping
            </button>
          </div>

          {/* Drop targets — always visible in Advanced */}
          <div className="chain-drop-targets">
            <p className="chain-drop-targets-hint">
              {chainVars.length
                ? 'Drag a variable chip and drop it onto a target, or click a target to add a mapping:'
                : 'Click a target to add a mapping (extract variables on earlier scenarios to enable drag-drop):'}
            </p>
            <div className="chain-drop-grid">
              {MAP_TARGETS.map((t) => {
                const isOver = dragOver === `target-${t.id}`;
                const count = mappings.filter((m) => m.target === t.id).length;
                return (
                  <div
                    key={t.id}
                    className={`chain-drop-zone ${isOver ? 'drag-over' : ''} ${count > 0 ? 'has-mappings' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragDataRef.current?.type === 'var-chip') {
                        setDragOver(`target-${t.id}`);
                      }
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDropOnTarget(t.id, e);
                    }}
                    onClick={() => {
                      const srcVar = chainVars[0]?.varName || 'myVar';
                      const existing = mappings.find(
                        (m) => m.sourceVar === srcVar && m.target === t.id && !m.targetKey,
                      );
                      if (!existing) {
                        setMappings([
                          ...mappings,
                          { ...newApiMapping(srcVar), target: t.id, targetKey: '' },
                        ]);
                      }
                    }}
                  >
                    <span className="chain-drop-zone-icon">{t.icon}</span>
                    <span className="chain-drop-zone-label">{t.label}</span>
                    <span className="chain-drop-zone-desc">{t.desc}</span>
                    {count > 0 && (
                      <span className="chain-drop-zone-badge">{count}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mapping rows */}
          {mappings.length === 0 ? (
            <div className="chain-mapping-empty">
              <p>Click a target box above or <strong>+ Add Mapping</strong> to create your first mapping.</p>
            </div>
          ) : (
            <div className="chain-mapping-list">
              {mappings.map((m, i) => {
                const targetMeta = MAP_TARGETS.find((t) => t.id === m.target);
                const isExpanded = expandedMapping === m.id;
                return (
                  <div
                    key={m.id}
                    className={`chain-mapping-card ${dragIdx === i ? 'dragging' : ''} ${isExpanded ? 'expanded' : ''}`}
                    draggable
                    onDragStart={(e) =>
                      handleDragStart(e, { type: 'mapping-row', index: i })
                    }
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => {
                      e.preventDefault();
                      const data = dragDataRef.current;
                      if (data?.type === 'mapping-row' && data.index !== i) {
                        setDragOver(`mapping-${i}`);
                      }
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      const data = readDragData(e);
                      if (data?.type === 'mapping-row' && data.index != null) {
                        reorderMappings(data.index, i);
                      }
                      setDragOver(null);
                    }}
                  >
                    <div
                      className={`chain-mapping-drop-indicator ${dragOver === `mapping-${i}` ? 'visible' : ''}`}
                    />
                    <div className="chain-mapping-grip" title="Drag to reorder">⠿</div>
                    <div className="chain-mapping-flow">
                      <div className="chain-mapping-source">
                        {chainVars.length > 0 ? (
                          <select
                            value={m.sourceVar}
                            onChange={(e) => {
                              const next = [...mappings];
                              next[i] = { ...m, sourceVar: e.target.value };
                              setMappings(next);
                            }}
                          >
                            {!chainVars.some((c) => c.varName === m.sourceVar) &&
                            m.sourceVar ? (
                              <option value={m.sourceVar}>{m.sourceVar}</option>
                            ) : null}
                            {chainVars.map((c) => (
                              <option key={c.varName} value={c.varName}>
                                ${'{'}
                                {c.varName}
                                {'}'} ← {c.fromStep}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder="Variable name"
                            value={m.sourceVar}
                            onChange={(e) => {
                              const next = [...mappings];
                              next[i] = { ...m, sourceVar: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') };
                              setMappings(next);
                            }}
                          />
                        )}
                      </div>
                      <div className="chain-mapping-arrow">→</div>
                      <div className="chain-mapping-target-badge">
                        <span className="chain-mapping-target-icon">
                          {targetMeta?.icon || '?'}
                        </span>
                        <select
                          value={m.target}
                          onChange={(e) => {
                            const next = [...mappings];
                            next[i] = {
                              ...m,
                              target: e.target.value as LoadApiMappingTarget,
                            };
                            setMappings(next);
                          }}
                        >
                          {MAP_TARGETS.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="chain-mapping-field">
                        <input
                          type="text"
                          placeholder={
                            m.target === 'body'
                              ? 'JSON key, e.g. data.id'
                              : m.target === 'header'
                                ? 'Header name, e.g. X-Id'
                                : 'Field name'
                          }
                          value={m.targetKey}
                          onChange={(e) => {
                            const next = [...mappings];
                            next[i] = { ...m, targetKey: e.target.value };
                            setMappings(next);
                          }}
                        />
                      </div>
                    </div>
                    <div className="chain-mapping-actions">
                      <button
                        type="button"
                        className="chain-mapping-expand"
                        title={isExpanded ? 'Collapse' : 'Expand'}
                        onClick={() =>
                          setExpandedMapping(isExpanded ? null : m.id)
                        }
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                      <button
                        type="button"
                        className="chain-mapping-remove"
                        title="Remove mapping"
                        onClick={() =>
                          setMappings(mappings.filter((_, j) => j !== i))
                        }
                      >
                        ✕
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="chain-mapping-detail">
                        <p className="chain-mapping-detail-text">
                          <strong>${'{'}
                          {m.sourceVar}
                          {'}'}</strong>{' '}
                          will be injected into <strong>{targetMeta?.label}</strong>
                          {m.targetKey ? (
                            <>
                              {' '}
                              at key <code>{m.targetKey}</code>
                            </>
                          ) : null}
                          . During load runs, this is applied automatically before each
                          request fires.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Mapping summary & apply */}
          {mappings.length > 0 && (
            <div className="chain-mapping-footer">
              <div className="chain-mapping-preview">
                <span className="chain-mapping-preview-label">Preview:</span>
                {mappings
                  .filter((m) => m.sourceVar && m.targetKey)
                  .map((m) => (
                    <code key={m.id} className="chain-mapping-preview-item">
                      {m.target}.{m.targetKey} = ${'{'}
                      {m.sourceVar}
                      {'}'}
                    </code>
                  ))}
              </div>
              <div className="chain-mapping-apply-bar">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={applyMappingsNow}
                >
                  Apply mappings to this request
                </button>
                <span className="history-meta">
                  Updates editor fields now. Load runs always apply saved mappings.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
