import type { WebFlowStep, WebTestCase } from '@/lib/types';

/** Pretty suite name from an uploaded file name. */
export function groupNameFromFile(fileName?: string): string {
  if (!fileName) return 'Imported suite';
  const base = fileName.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '');
  const pretty = base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return pretty || 'Imported suite';
}

/**
 * If AI collapsed many flows into one mega-case, split on subsequent goto steps
 * (after real interactions) so each flow stays a separate case.
 */
export function splitMergedCaseByGoto(
  c: WebTestCase,
  group?: string,
): WebTestCase[] {
  const steps = c.steps || [];
  if (steps.length < 8) return [c];

  const chunks: WebFlowStep[][] = [];
  let cur: WebFlowStep[] = [];
  const hasInteraction = (list: WebFlowStep[]) =>
    list.some(
      (s) =>
        s.action === 'click' ||
        s.action === 'fill' ||
        s.action === 'assertVisible' ||
        s.action === 'assertUrl',
    );

  for (const step of steps) {
    if (
      step.action === 'goto' &&
      cur.length > 0 &&
      hasInteraction(cur)
    ) {
      chunks.push(cur);
      cur = [step];
    } else {
      cur.push(step);
    }
  }
  if (cur.length) chunks.push(cur);
  if (chunks.length < 2) return [c];

  const g = group || c.group;
  return chunks.map((chunk, i) => {
    const goto = chunk.find((s) => s.action === 'goto');
    const pathHint = goto?.url?.replace(/^\//, '').replace(/\//g, '-') || `part-${i + 1}`;
    const idBase = (c.id || 'import').replace(/-part-\d+$/, '');
    return {
      ...c,
      id: `${idBase}-${pathHint}`.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase().slice(0, 64),
      name: chunks.length > 1 ? `${c.name} · ${goto?.url || `Part ${i + 1}`}` : c.name,
      description: c.description,
      group: g,
      estimatedMinutes: Math.max(2, Math.ceil(chunk.length / 2)),
      steps: chunk.map((s, j) => ({ ...s, id: `step-${j + 1}` })),
      tags: Array.from(new Set([...(c.tags || []), 'split-from-import'])),
    };
  });
}

/**
 * Prefer many separate cases over one messy mega-case.
 * Keeps local Python/JSON split when AI collapses them.
 */
export function keepCasesSeparate(
  local: WebTestCase[],
  ai: WebTestCase[],
  group: string,
): { cases: WebTestCase[]; note?: string } {
  const stamp = (list: WebTestCase[]) =>
    list.map((c) => ({
      ...c,
      group: c.group || group,
    }));

  if (!ai.length) return { cases: stamp(local) };

  let aiExpanded = ai.flatMap((c) => splitMergedCaseByGoto(c, group));

  if (local.length >= 2 && aiExpanded.length === 1) {
    const aiOne = aiExpanded[0]!;
    return {
      cases: stamp(
        local.map((c) => ({
          ...c,
          group,
          tags: Array.from(new Set([...(c.tags || []), ...(aiOne.tags || [])])),
        })),
      ),
      note: `Kept ${local.length} separate cases (AI had merged into one)`,
    };
  }

  if (local.length >= 2 && aiExpanded.length >= 2) {
    // Align by id / name order
    const localById = new Map(local.map((c) => [c.id, c]));
    const merged = aiExpanded.map((a, i) => {
      const match =
        localById.get(a.id) ||
        local.find(
          (l) =>
            l.name.toLowerCase() === a.name.toLowerCase() ||
            l.id === a.id,
        ) ||
        local[i];
      return {
        ...a,
        id: match?.id || a.id,
        name: a.name || match?.name || a.id,
        group,
        source: 'upload' as const,
      };
    });
    // Include any local cases AI dropped
    for (const l of local) {
      if (!merged.some((m) => m.id === l.id)) {
        merged.push({ ...l, group, source: 'upload' });
      }
    }
    return { cases: stamp(merged) };
  }

  if (aiExpanded.length === 1 && (aiExpanded[0]!.steps?.length || 0) >= 10) {
    const split = splitMergedCaseByGoto(aiExpanded[0]!, group);
    if (split.length >= 2) {
      return {
        cases: stamp(split),
        note: `Split 1 mega-case into ${split.length} separate cases`,
      };
    }
  }

  return { cases: stamp(aiExpanded.length ? aiExpanded : local) };
}
