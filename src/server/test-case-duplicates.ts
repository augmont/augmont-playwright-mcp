import type { WebFlowStep, WebTestCase } from '@/lib/types';

export type DuplicateReason = 'same-id' | 'same-name' | 'similar-flow';

export type DuplicateMatch = {
  generated: WebTestCase;
  existing: WebTestCase;
  reason: DuplicateReason;
  score: number;
  message: string;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(' ')
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function stepUrls(steps: WebFlowStep[] | undefined): string[] {
  if (!steps?.length) return [];
  const urls: string[] = [];
  for (const s of steps) {
    if ((s.action === 'goto' || s.action === 'assertUrl') && s.url) {
      const u = s.url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0] || '/';
      urls.push(u.toLowerCase());
    }
  }
  return [...new Set(urls)];
}

function stepTexts(steps: WebFlowStep[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!steps) return out;
  for (const s of steps) {
    if (s.text) out.add(norm(s.text));
    if (s.label) {
      for (const t of tokens(s.label)) out.add(t);
    }
  }
  return out;
}

function urlOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  let hit = 0;
  for (const u of a) if (bs.has(u)) hit += 1;
  return hit / Math.max(a.length, b.length);
}

/** Score how similar two cases are (0–1). */
export function similarityScore(a: WebTestCase, b: WebTestCase): number {
  if (a.id === b.id) return 1;
  const nameA = norm(a.name);
  const nameB = norm(b.name);
  if (nameA && nameA === nameB) return 0.98;

  const nameSim = jaccard(tokens(`${a.name} ${a.description}`), tokens(`${b.name} ${b.description}`));
  const urlsA = stepUrls(a.steps);
  const urlsB = stepUrls(b.steps);
  const urlSim = urlOverlap(urlsA, urlsB);
  const textSim = jaccard(stepTexts(a.steps), stepTexts(b.steps));

  // Weighted blend — name+url dominate
  return Math.min(1, nameSim * 0.45 + urlSim * 0.4 + textSim * 0.15);
}

function bestMatch(
  generated: WebTestCase,
  existing: WebTestCase[],
  role?: string,
): { existing: WebTestCase; score: number; reason: DuplicateReason } | null {
  let best: { existing: WebTestCase; score: number; reason: DuplicateReason } | null = null;

  for (const ex of existing) {
    if (role && ex.role && generated.role && ex.role !== generated.role) {
      // Still allow same-id across roles to catch collisions
      if (ex.id !== generated.id) continue;
    }

    if (ex.id === generated.id) {
      return { existing: ex, score: 1, reason: 'same-id' };
    }

    const nameA = norm(generated.name);
    const nameB = norm(ex.name);
    if (nameA && nameA === nameB) {
      const hit = { existing: ex, score: 0.98, reason: 'same-name' as const };
      if (!best || hit.score > best.score) best = hit;
      continue;
    }

    const score = similarityScore(generated, ex);
    // High bar — only skip near-identical flows; otherwise create the new case
    if (score >= 0.88) {
      const hit = { existing: ex, score, reason: 'similar-flow' as const };
      if (!best || hit.score > best.score) best = hit;
    }
  }

  return best;
}

function messageFor(reason: DuplicateReason, existing: WebTestCase): string {
  if (reason === 'same-id') {
    return `Already this test case added — id "${existing.id}" (${existing.name}).`;
  }
  if (reason === 'same-name') {
    return `Already this test case added — same name "${existing.name}" (id: ${existing.id}).`;
  }
  return `Already this test case added — similar flow matches "${existing.name}" (id: ${existing.id}).`;
}

/**
 * Split generated cases into novel vs duplicates of the store.
 * Duplicates are not re-added; UI should show the existing case + message.
 */
export function partitionAgainstExisting(
  generated: WebTestCase[],
  existing: WebTestCase[],
  opts?: { role?: string },
): { novel: WebTestCase[]; duplicates: DuplicateMatch[] } {
  const novel: WebTestCase[] = [];
  const duplicates: DuplicateMatch[] = [];
  const seenDupIds = new Set<string>();

  for (const g of generated) {
    const match = bestMatch(g, existing, opts?.role);
    if (match) {
      const key = `${g.id}→${match.existing.id}`;
      if (seenDupIds.has(key)) continue;
      seenDupIds.add(key);
      duplicates.push({
        generated: g,
        existing: match.existing,
        reason: match.reason,
        score: match.score,
        message: messageFor(match.reason, match.existing),
      });
    } else {
      novel.push(g);
    }
  }

  return { novel, duplicates };
}

/**
 * Fast path: skip AI only when the prompt is clearly the same as a saved case
 * (exact id or exact name). Vague / partial prompts must fall through so we CREATE.
 */
export function findExistingForPrompt(
  prompt: string,
  existing: WebTestCase[],
  opts?: { role?: string; limit?: number },
): DuplicateMatch[] {
  const q = norm(prompt);
  if (!q || q.length < 4) return [];
  const limit = opts?.limit ?? 5;
  const hits: DuplicateMatch[] = [];

  for (const ex of existing) {
    if (opts?.role && ex.role && ex.role !== opts.role) continue;

    const id = norm(ex.id);
    const name = norm(ex.name);
    // Exact id or exact name only — do not substring-match descriptions
    const idHit = q === id || q.replace(/\s+/g, '-') === id;
    const nameHit = !!name && q === name;

    if (idHit || nameHit) {
      hits.push({
        generated: ex,
        existing: ex,
        reason: idHit ? 'same-id' : 'same-name',
        score: idHit ? 1 : 0.98,
        message: messageFor(idHit ? 'same-id' : 'same-name', ex),
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Compact list for AI prompt — ids/names/descriptions/urls only. */
export function summarizeExistingCasesForPrompt(
  cases: WebTestCase[],
  opts?: { role?: string; maxCases?: number },
): string {
  const max = opts?.maxCases ?? 40;
  const filtered = opts?.role
    ? cases.filter((c) => !c.role || c.role === opts.role)
    : cases;
  const slice = filtered.slice(0, max);

  const lines = slice.map((c) => {
    const urls = stepUrls(c.steps).slice(0, 6).join(', ') || '—';
    return `- id=${c.id} | role=${c.role || 'public'} | name="${c.name}" | desc="${(c.description || '').slice(0, 120)}" | urls=[${urls}]`;
  });

  if (!lines.length) return '(none)';
  const more =
    filtered.length > max ? `\n…and ${filtered.length - max} more existing cases` : '';
  return lines.join('\n') + more;
}
