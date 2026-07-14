import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'ai-selector-guide.json');
const LEARNED_MD_PATH = path.join(
  process.cwd(),
  'src',
  'server',
  'guides',
  'learned-selectors.md',
);

export type GuideSelectorEntry = {
  id: string;
  /** Stable CSS / Playwright selector */
  selector: string;
  dataId?: string;
  dataTestId?: string;
  text?: string;
  tag?: string;
  path?: string;
  role?: string;
  suggestedDataId?: string;
  note?: string;
  /** Test case id this was picked from (if any) */
  sourceTestId?: string;
  createdAt: string;
};

type StoreFile = {
  version: number;
  entries: GuideSelectorEntry[];
};

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readStore(): GuideSelectorEntry[] {
  ensureDir();
  if (!existsSync(STORE_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as StoreFile;
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    return [];
  }
}

function writeLearnedMarkdown(entries: GuideSelectorEntry[]) {
  const lines = [
    '## LEARNED SELECTORS (from MCP pick — use these first)',
    '',
    'These were verified on the live portal via MCP inspect. Prefer `data-id` / `data-testid` / listed selector exactly when generating new test cases.',
    '',
  ];
  if (!entries.length) {
    lines.push('_No curated selectors yet. Use View test case → MCP & Select to add them._');
    lines.push('');
  } else {
    lines.push('| Path | data-id / data-testid | Selector | Text / note |');
    lines.push('| --- | --- | --- | --- |');
    for (const e of entries) {
      const ids = [e.dataId ? `data-id=${e.dataId}` : '', e.dataTestId ? `data-testid=${e.dataTestId}` : '']
        .filter(Boolean)
        .join(' · ') || '—';
      const note = [e.text, e.note, e.sourceTestId ? `from:${e.sourceTestId}` : '']
        .filter(Boolean)
        .join(' · ')
        .replace(/\|/g, '/');
      lines.push(
        `| ${e.path || '—'} | ${ids} | \`${e.selector.replace(/\|/g, '\\|')}\` | ${note || '—'} |`,
      );
    }
    lines.push('');
    lines.push('### Compact list for AI');
    lines.push('');
    for (const e of entries) {
      const bits = [
        e.path ? `path=${e.path}` : '',
        e.dataId ? `data-id=${e.dataId}` : '',
        e.dataTestId ? `data-testid=${e.dataTestId}` : '',
        e.suggestedDataId ? `suggested-data-id=${e.suggestedDataId}` : '',
        `selector=${e.selector}`,
        e.text ? `text="${e.text}"` : '',
        e.note ? `note="${e.note}"` : '',
        e.role ? `role=${e.role}` : '',
      ].filter(Boolean);
      lines.push(`- ${bits.join(' | ')}`);
    }
    lines.push('');
  }
  const guidesDir = path.dirname(LEARNED_MD_PATH);
  if (!existsSync(guidesDir)) mkdirSync(guidesDir, { recursive: true });
  writeFileSync(LEARNED_MD_PATH, lines.join('\n'), 'utf8');
}

function writeStore(entries: GuideSelectorEntry[]) {
  ensureDir();
  writeFileSync(
    STORE_PATH,
    JSON.stringify({ version: 1, entries }, null, 2),
    'utf8',
  );
  writeLearnedMarkdown(entries);
}

function entryKey(e: Pick<GuideSelectorEntry, 'selector' | 'dataId' | 'dataTestId' | 'path'>) {
  return [
    (e.path || '').toLowerCase(),
    (e.dataId || '').toLowerCase(),
    (e.dataTestId || '').toLowerCase(),
    (e.selector || '').toLowerCase(),
  ].join('|');
}

export function listGuideSelectors(): GuideSelectorEntry[] {
  return readStore();
}

export function upsertGuideSelectors(
  incoming: Array<Partial<GuideSelectorEntry> & { selector: string }>,
): { added: number; entries: GuideSelectorEntry[] } {
  const current = readStore();
  const byKey = new Map(current.map((e) => [entryKey(e), e]));
  let added = 0;
  const now = new Date().toISOString();

  for (const raw of incoming) {
    const selector = (raw.selector || '').trim();
    if (!selector) continue;
    const next: GuideSelectorEntry = {
      id:
        (raw.id || '').trim() ||
        `sel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      selector,
      dataId: raw.dataId?.trim() || undefined,
      dataTestId: raw.dataTestId?.trim() || undefined,
      text: raw.text?.trim() || undefined,
      tag: raw.tag?.trim() || undefined,
      path: raw.path?.trim() || undefined,
      role: raw.role?.trim() || undefined,
      suggestedDataId: raw.suggestedDataId?.trim() || undefined,
      note: raw.note?.trim() || undefined,
      sourceTestId: raw.sourceTestId?.trim() || undefined,
      createdAt: raw.createdAt || now,
    };
    const key = entryKey(next);
    if (byKey.has(key)) {
      const prev = byKey.get(key)!;
      byKey.set(key, {
        ...prev,
        ...next,
        id: prev.id,
        createdAt: prev.createdAt,
      });
    } else {
      byKey.set(key, next);
      added += 1;
    }
  }

  const entries = [...byKey.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  writeStore(entries);
  return { added, entries };
}

export function deleteGuideSelector(id: string): GuideSelectorEntry[] {
  const next = readStore().filter((e) => e.id !== id);
  writeStore(next);
  return next;
}

export function clearGuideSelectors(): GuideSelectorEntry[] {
  writeStore([]);
  return [];
}

/** Compact block injected into every AI generate prompt. */
export function formatGuideSelectorsForPrompt(maxEntries = 80): string {
  const entries = readStore().slice(0, maxEntries);
  if (!entries.length) return '';
  const lines = [
    'CURATED MCP SELECTORS (human-verified — prefer these data-id / selectors when writing new cases):',
  ];
  for (const e of entries) {
    const bits = [
      e.path ? `path=${e.path}` : '',
      e.dataId ? `data-id=${e.dataId}` : '',
      e.dataTestId ? `data-testid=${e.dataTestId}` : '',
      e.suggestedDataId ? `suggested-data-id=${e.suggestedDataId}` : '',
      `selector=${e.selector}`,
      e.text ? `text="${e.text}"` : '',
      e.note ? `note="${e.note}"` : '',
      e.sourceTestId ? `from=${e.sourceTestId}` : '',
    ].filter(Boolean);
    lines.push(`- ${bits.join(' | ')}`);
  }
  return lines.join('\n');
}

/** Ensure learned-selectors.md exists for guide excerpt loader. */
export function ensureLearnedSelectorsMarkdown() {
  if (!existsSync(LEARNED_MD_PATH)) {
    writeLearnedMarkdown(readStore());
  }
}
