/** Resolve dotted / bracket-light JSON path like $.data[0].id or data.token */
export function getJsonPathValue(obj: unknown, path: string): unknown {
  const clean = path
    .trim()
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1');
  if (!clean) return undefined;
  const parts = clean.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
