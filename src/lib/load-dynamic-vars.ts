/**
 * Dynamic / compatibility values for Params, Headers, and Body.
 * - Probe (Send): expands to concrete sample values
 * - JMeter load: expands to native JMeter functions / variables (not URL-encoded)
 */

export type DynamicPreset = {
  id: string;
  label: string;
  /** Friendly token users paste in params/headers/body */
  token: string;
  /** JMeter expression when running load */
  jmeter: string;
  /** Sample value for Send / validate */
  sample: () => string;
  hint: string;
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const LOAD_DYNAMIC_PRESETS: DynamicPreset[] = [
  {
    id: 'uuid',
    label: 'UUID',
    token: '${uuid}',
    jmeter: '${__UUID}',
    sample: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `id-${Date.now()}-${randomInt(1000, 9999)}`,
    hint: 'Unique id per request (compatibility / create APIs)',
  },
  {
    id: 'timestamp',
    label: 'Timestamp',
    token: '${timestamp}',
    jmeter: '${__time()}',
    sample: () => String(Date.now()),
    hint: 'Epoch ms — useful for unique keys',
  },
  {
    id: 'isoDate',
    label: 'ISO date',
    token: '${isoDate}',
    jmeter: '${__time(yyyy-MM-dd)}',
    sample: () => new Date().toISOString().slice(0, 10),
    hint: 'Current date yyyy-MM-dd',
  },
  {
    id: 'random',
    label: 'Random int',
    token: '${random}',
    jmeter: '${__Random(100000,999999)}',
    sample: () => String(randomInt(100000, 999999)),
    hint: '6-digit random number',
  },
  {
    id: 'randomPhone',
    label: 'Random mobile',
    token: '${randomPhone}',
    jmeter: '9${__Random(100000000,999999999)}',
    sample: () => `9${randomInt(100000000, 999999999)}`,
    hint: 'Fake 10-digit mobile-style number',
  },
  {
    id: 'thread',
    label: 'VU / thread',
    token: '${thread}',
    jmeter: '${__threadNum}',
    sample: () => '1',
    hint: 'Virtual user number during load',
  },
  {
    id: 'iteration',
    label: 'Iteration',
    token: '${iteration}',
    jmeter: '${__iterationNum}',
    sample: () => '1',
    hint: 'Loop iteration counter in JMeter',
  },
  {
    id: 'authToken',
    label: 'Auth token',
    token: '${authToken}',
    jmeter: '${authToken}',
    sample: () => 'Bearer <from-login>',
    hint: 'From auth CSV (Authorization required)',
  },
];

const FRIENDLY_TO_JMETER: Record<string, string> = Object.fromEntries(
  LOAD_DYNAMIC_PRESETS.map((p) => [
    p.token.replace(/^\$\{|\}$/g, '').toLowerCase(),
    p.jmeter,
  ]),
);

const FRIENDLY_TO_SAMPLE: Record<string, () => string> = Object.fromEntries(
  LOAD_DYNAMIC_PRESETS.map((p) => [
    p.token.replace(/^\$\{|\}$/g, '').toLowerCase(),
    p.sample,
  ]),
);

/** True if value contains JMeter / friendly `${…}` expressions. */
export function hasDynamicExpr(value: string): boolean {
  return /\$\{[^}]+\}/.test(value);
}

/**
 * Expand friendly tokens → JMeter functions.
 * Leaves unknown `${foo}` alone (e.g. extractJson var names, authToken).
 */
export function expandDynamicForJmeter(text: string): string {
  if (!text) return text;
  return text.replace(/\$\{([^}]+)\}/g, (full, raw: string) => {
    const key = String(raw).trim().toLowerCase();
    // Already a JMeter function: ${__UUID}, ${__time()}, ${__Random(...)}
    if (key.startsWith('__')) return full;
    const mapped = FRIENDLY_TO_JMETER[key];
    return mapped || full;
  });
}

/** Expand friendly tokens → concrete sample values for Send / validate. */
export function expandDynamicForProbe(text: string): string {
  if (!text) return text;
  return text.replace(/\$\{([^}]+)\}/g, (full, raw: string) => {
    const key = String(raw).trim().toLowerCase();
    if (key.startsWith('__')) {
      // Rough probe stand-ins for common JMeter funcs
      if (key === '__uuid') return FRIENDLY_TO_SAMPLE.uuid?.() || full;
      if (key.startsWith('__time')) return String(Date.now());
      if (key.startsWith('__random')) return String(randomInt(100000, 999999));
      return full;
    }
    const sample = FRIENDLY_TO_SAMPLE[key];
    return sample ? sample() : full;
  });
}

/**
 * Encode for URL path/query:
 * - Probe: expand then encodeURIComponent
 * - JMeter: expand to functions; do not encode `${…}` expressions (breaks JMeter)
 */
export function encodeDynamicParamValue(
  value: string,
  mode: 'probe' | 'jmeter',
): string {
  const expanded =
    mode === 'jmeter'
      ? expandDynamicForJmeter(value)
      : expandDynamicForProbe(value);
  if (mode === 'jmeter' && hasDynamicExpr(expanded)) {
    return expanded;
  }
  return encodeURIComponent(expanded);
}

/** Deep-expand string fields for headers / body / form values. */
export function expandDynamicString(
  value: string | undefined,
  mode: 'probe' | 'jmeter',
): string | undefined {
  if (value == null) return value;
  return mode === 'jmeter'
    ? expandDynamicForJmeter(value)
    : expandDynamicForProbe(value);
}

export function expandDynamicRecord(
  record: Record<string, string> | undefined,
  mode: 'probe' | 'jmeter',
): Record<string, string> | undefined {
  if (!record) return record;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = expandDynamicString(String(v), mode) || '';
  }
  return out;
}

/** Treat dynamic tokens as “filled” for required-field validation. */
export function isDynamicOrFilled(value: unknown): boolean {
  if (value == null) return false;
  const s = String(value).trim();
  if (!s) return false;
  if (hasDynamicExpr(s)) return true;
  return true;
}
