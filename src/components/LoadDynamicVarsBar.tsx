'use client';

import { LOAD_DYNAMIC_PRESETS } from '@/lib/load-dynamic-vars';

export type ChainVarChip = {
  varName: string;
  /** Scenario name that extracts it */
  fromStep: string;
};

/** Chip bar to insert dynamic/compatibility tokens and chained API vars. */
export function LoadDynamicVarsBar({
  onInsert,
  chainVars = [],
}: {
  /** Called with e.g. `${uuid}` — caller inserts into active field or copies. */
  onInsert: (token: string) => void;
  /** Vars extracted by earlier scenarios (use in this request’s params/headers/body). */
  chainVars?: ChainVarChip[];
}) {
  return (
    <div className="load-dynamic-bar">
      <span className="load-dynamic-bar-label">Dynamic (compatibility)</span>
      <div className="load-dynamic-chips">
        {LOAD_DYNAMIC_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="btn btn-ghost btn-sm load-dynamic-chip"
            title={`${p.hint} → JMeter ${p.jmeter}`}
            onClick={() => onInsert(p.token)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {chainVars.length > 0 ? (
        <>
          <span className="load-dynamic-bar-label" style={{ marginTop: '0.55rem' }}>
            From earlier APIs
          </span>
          <div className="load-dynamic-chips">
            {chainVars.map((c) => (
              <button
                key={c.varName}
                type="button"
                className="btn btn-ghost btn-sm load-dynamic-chip load-chain-chip"
                title={`From “${c.fromStep}” → use \${${c.varName}}`}
                onClick={() => onInsert(`\${${c.varName}}`)}
              >
                {`\${${c.varName}}`}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p className="history-meta" style={{ margin: '0.35rem 0 0' }}>
        Paste tokens like <code>{'${uuid}'}</code> for unique VU data.{' '}
        <strong>Send</strong> uses a sample; <strong>Load test</strong> uses JMeter.
        Chain vars (e.g. <code>{'${countryId}'}</code>) come from an earlier scenario’s
        Extract setup — filled during load runs in order.
      </p>
    </div>
  );
}
