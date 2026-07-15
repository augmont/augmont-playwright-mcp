'use client';

import { useMemo, useState } from 'react';
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
];

const MAP_TARGETS: { id: LoadApiMappingTarget; label: string }[] = [
  { id: 'body', label: 'Body JSON' },
  { id: 'query', label: 'Query' },
  { id: 'path', label: 'Path param' },
  { id: 'header', label: 'Header' },
  { id: 'form', label: 'Form field' },
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
};

export function LoadChainPanel({
  active,
  scenarioIndex,
  chainVars,
  extractPreview,
  onPatch,
  onInsertToken,
}: Props) {
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  const extracts = useMemo(() => listJsonExtracts(active), [active]);
  const mappings = active.apiMappings || [];

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

  return (
    <div className="scenario-tab-panel load-chain-panel">
      <p className="history-meta">
        Pass data from one API into the next. Scenarios run <strong>in list order</strong>.
        Extract fields here → map or paste <code>{'${var}'}</code> into later APIs.
      </p>

      <div className="swagger-docs-auth-modes" style={{ marginBottom: '0.75rem' }}>
        <button
          type="button"
          className={`creds-role-tab ${mode === 'simple' ? 'active' : ''}`}
          onClick={() => setMode('simple')}
        >
          Simple
        </button>
        <button
          type="button"
          className={`creds-role-tab ${mode === 'advanced' ? 'active' : ''}`}
          onClick={() => setMode('advanced')}
        >
          Advanced mapping
        </button>
      </div>

      {chainVars.length > 0 ? (
        <div className="load-chain-use-box">
          <span className="load-dynamic-bar-label">From earlier APIs</span>
          <div className="load-dynamic-chips">
            {chainVars.map((c) => (
              <button
                key={c.varName}
                type="button"
                className="btn btn-ghost btn-sm load-dynamic-chip load-chain-chip"
                title={`From “${c.fromStep}”`}
                onClick={() => onInsertToken(`\${${c.varName}}`)}
              >
                {`\${${c.varName}}`}
                <span className="load-chain-chip-from">← {c.fromStep}</span>
              </button>
            ))}
          </div>
        </div>
      ) : scenarioIndex === 0 ? (
        <p className="history-meta">
          First scenario — extract one or more fields below, then map them on later APIs.
        </p>
      ) : (
        <p className="history-meta">
          No extracts on earlier scenarios yet. Open a previous scenario → save response
          fields.
        </p>
      )}

      <div className="load-chain-extract-box">
        <div className="probe-section-head">
          <h4>Save response fields (multiple)</h4>
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
            + Add extract
          </button>
        </div>

        {extracts.length === 0 ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setExtracts([newEmptyExtract(0)])}
          >
            Enable extract
          </button>
        ) : (
          <div className="load-chain-extract-list">
            {extracts.map((ex, i) => (
              <div key={`${ex.varName}-${i}`} className="load-chain-extract-row">
                <label>
                  Variable
                  <input
                    type="text"
                    placeholder="countryId"
                    value={ex.varName}
                    onChange={(e) =>
                      updateExtract(i, { varName: sanitizeVarName(e.target.value) })
                    }
                  />
                </label>
                <label>
                  JSONPath
                  <input
                    type="text"
                    placeholder="$.data.id"
                    value={ex.jsonPath}
                    onChange={(e) =>
                      updateExtract(i, { jsonPath: e.target.value })
                    }
                  />
                </label>
                <label>
                  Default
                  <input
                    type="text"
                    placeholder="NOT_FOUND"
                    value={ex.defaultValue || ''}
                    onChange={(e) =>
                      updateExtract(i, { defaultValue: e.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Remove"
                  onClick={() => removeExtract(i)}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="load-dynamic-chips">
              {CHAIN_PATH_PRESETS.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  className="btn btn-ghost btn-sm load-dynamic-chip"
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
            </div>
            {extracts.some((e) => e.varName) ? (
              <p className="step-msg">
                Later APIs can use{' '}
                {extracts
                  .filter((e) => e.varName)
                  .map((e) => `\${${e.varName}}`)
                  .join(', ')}
              </p>
            ) : null}
            {extractPreview ? (
              <p className="load-extract-preview">{extractPreview}</p>
            ) : extracts.length > 0 ? (
              <p className="history-meta">
                Click <strong>Send</strong> to preview extracted values from the live
                response.
              </p>
            ) : null}
          </div>
        )}
      </div>

      {mode === 'advanced' ? (
        <div className="load-chain-extract-box load-chain-map-box">
          <div className="probe-section-head">
            <h4>API mapping</h4>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!chainVars.length}
              onClick={() =>
                setMappings([
                  ...mappings,
                  newApiMapping(chainVars[0]?.varName || ''),
                ])
              }
            >
              + Add mapping
            </button>
          </div>
          <p className="history-meta">
            Wire earlier API variables into this request’s path, query, header, body, or
            form fields. Load runs always apply saved mappings; click Apply to update
            the editor fields now.
          </p>

          {mappings.length === 0 ? (
            <p className="history-meta">
              {chainVars.length
                ? 'Add a mapping row: source var → target field.'
                : 'Extract data on an earlier scenario first.'}
            </p>
          ) : (
            <div className="load-chain-map-list">
              {mappings.map((m, i) => (
                <div key={m.id} className="load-chain-map-row">
                  <label>
                    From var
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
                          {`\${${c.varName}}`} ← {c.fromStep}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Into
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
                  </label>
                  <label>
                    Field
                    <input
                      type="text"
                      placeholder={
                        m.target === 'body'
                          ? 'value or data.id'
                          : m.target === 'header'
                            ? 'X-Id'
                            : 'fieldName'
                      }
                      value={m.targetKey}
                      onChange={(e) => {
                        const next = [...mappings];
                        next[i] = { ...m, targetKey: e.target.value };
                        setMappings(next);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setMappings(mappings.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="load-chain-map-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!mappings.length}
              onClick={applyMappingsNow}
            >
              Apply mapping to this request
            </button>
            {mappings.length > 0 ? (
              <span className="history-meta">
                Preview:{' '}
                {mappings
                  .filter((m) => m.sourceVar && m.targetKey)
                  .map(
                    (m) =>
                      `${m.target}.${m.targetKey}=\${${m.sourceVar}}`,
                  )
                  .join(' · ')}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
