import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { ensureLearnedSelectorsMarkdown } from '@/server/selector-guide-store';

const GUIDE_PATH = path.join(
  process.cwd(),
  'src',
  'server',
  'guides',
  'lgd-portal-ui-guide.md',
);

const LEARNED_PATH = path.join(
  process.cwd(),
  'src',
  'server',
  'guides',
  'learned-selectors.md',
);

/** Always include these prefixes (overview + selectors + toast UX). */
const ALWAYS_HEADERS = [
  '## LEARNED SELECTORS (from MCP pick',
  '## 1. Application Overview',
  '## 2. Selector Strategy for MCP / Playwright (IMPORTANT)',
  '## 3. Test Login & Role Setup',
  '## GLOBAL ERROR / TOAST UX (read first — testers)',
];

type GuideChunk = { header: string; body: string };

function readGuide(): string {
  if (!existsSync(GUIDE_PATH)) return '';
  return readFileSync(GUIDE_PATH, 'utf8');
}

/** Split markdown on ## / # SECTION headers (keep header on chunk). */
function splitGuide(md: string): GuideChunk[] {
  const lines = md.split('\n');
  const chunks: GuideChunk[] = [];
  let header = '';
  let buf: string[] = [];

  const flush = () => {
    if (!header && !buf.length) return;
    chunks.push({ header, body: buf.join('\n').trim() });
    buf = [];
  };

  for (const line of lines) {
    if (/^# SECTION:/.test(line) || /^## /.test(line)) {
      flush();
      header = line.trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return chunks;
}

function roleKeywords(role?: string): string[] {
  if (role === 'buyer') {
    return [
      'buyer',
      'products',
      'melee',
      'cart',
      'wishlist',
      'orders',
      'buyback',
      'request',
      'my-account',
      'resource',
      'filter',
      'share stone',
      'matching',
      'app-filters',
    ];
  }
  if (role === 'admin') {
    return [
      'admin',
      'sellers',
      'buyers',
      'orders',
      'unapproved',
      'internal',
      'role',
      'permission',
      'user type',
      'book demo',
      'contact us queries',
      'buy-back',
    ];
  }
  if (role === 'seller') {
    return ['seller', 'login', 'auth'];
  }
  if (role === 'public') {
    return [
      'login',
      'sign up',
      'register',
      'forgot',
      'contact',
      'home',
      'book a demo',
      'blog',
      'about',
      'download',
      'public',
      'layout',
    ];
  }
  return [];
}

function promptKeywords(prompt: string): string[] {
  const p = prompt.toLowerCase();
  const keys: Array<[RegExp, string]> = [
    [/\blogin\b/, 'login'],
    [/\bregister\b|\bsign\s*up\b/, 'sign up'],
    [/\bforgot\b|\bpassword\b/, 'forgot'],
    [/\bcart\b|\bcheckout\b/, 'cart'],
    [/\bwishlist\b/, 'wishlist'],
    [/\border/, 'orders'],
    [/\bbuyback\b|\bbuy.?back\b/, 'buyback'],
    [/\bmelee\b|\bnon.?cert\b/, 'melee'],
    [/\bfilter/, 'filter'],
    [/\bproduct/, 'products'],
    [/\bwishlist\b/, 'wishlist'],
    [/\brequest/, 'request'],
    [/\baccount\b|\baddress\b|\bcurrency\b/, 'my account'],
    [/\bresource\b|\bmarkup\b|\bshopify\b|\bapi\b/, 'resource'],
    [/\bseller/, 'sellers'],
    [/\bbuyer/, 'buyers'],
    [/\bunapproved\b|\binventory\b/, 'unapproved'],
    [/\brole\b|\bpermission\b/, 'role'],
    [/\bdemo\b/, 'book a demo'],
    [/\bcontact\b/, 'contact'],
    [/\bblog\b|\binsight/, 'blog'],
    [/\babout\b/, 'about'],
    [/\bshare\b/, 'share stone'],
    [/\bmatch/, 'matching'],
  ];
  const out: string[] = [];
  for (const [re, label] of keys) {
    if (re.test(p)) out.push(label);
  }
  return out;
}

function scoreChunk(chunk: GuideChunk, needles: string[]): number {
  const hay = `${chunk.header}\n${chunk.body}`.toLowerCase();
  let score = 0;
  for (const n of needles) {
    if (hay.includes(n.toLowerCase())) score += 1;
  }
  // Prefer page sections over giant shared dumps
  if (/^## /.test(chunk.header) && !ALWAYS_HEADERS.includes(chunk.header)) {
    score += 0.2;
  }
  return score;
}

/**
 * Build a bounded excerpt of the portal UI guide for AI test generation.
 * Always includes overview + selector strategy; adds role/prompt-matched pages.
 */
export function loadPortalUiGuideExcerpt(input: {
  prompt: string;
  role?: string;
  maxChars?: number;
}): string {
  const maxChars = input.maxChars ?? 18_000;
  ensureLearnedSelectorsMarkdown();
  const md = readGuide();
  if (!md) {
    return '(Portal UI guide file missing at src/server/guides/lgd-portal-ui-guide.md)';
  }

  let learned = '';
  if (existsSync(LEARNED_PATH)) {
    try {
      learned = readFileSync(LEARNED_PATH, 'utf8').trim();
    } catch {
      learned = '';
    }
  }

  const chunks = splitGuide(
    learned ? `${learned}\n\n${md}` : md,
  );
  const needles = [
    ...roleKeywords(input.role),
    ...promptKeywords(input.prompt),
  ];

  const always = chunks.filter((c) =>
    ALWAYS_HEADERS.some((h) => c.header.startsWith(h) || c.header.includes(h.replace('## ', ''))),
  );

  // Also pull layout/routing when auth/navigation mentioned
  const routing = chunks.filter((c) =>
    /Routing & Layout|Route Table|Layouts —|Guards/.test(c.header),
  );

  const scored = chunks
    .filter((c) => !always.includes(c) && !routing.includes(c))
    .map((c) => ({ c, score: scoreChunk(c, needles) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: GuideChunk[] = [];
  const used = new Set<string>();
  const push = (c: GuideChunk) => {
    const key = c.header || c.body.slice(0, 40);
    if (used.has(key)) return;
    used.add(key);
    picked.push(c);
  };

  for (const c of always) push(c);
  for (const c of routing.slice(0, 2)) push(c);
  for (const { c } of scored) push(c);

  // Role section fallbacks if nothing scored
  if (scored.length === 0) {
    const sectionHint =
      input.role === 'buyer'
        ? 'Buyer Pages'
        : input.role === 'admin'
          ? 'Admin & Seller'
          : input.role === 'seller'
            ? 'Seller Home'
            : 'Public Pages';
    for (const c of chunks) {
      if (c.header.includes(sectionHint) || c.body.includes(`# SECTION: ${sectionHint}`)) {
        push(c);
      }
      if (
        input.role === 'public' &&
        /Login|Sign Up|Forgot|Home —|Book a Demo|Contact Us/.test(c.header)
      ) {
        push(c);
      }
      if (
        input.role === 'buyer' &&
        /^## (1\. Home|2\. Products|5\. Cart|6\. Wishlist)/.test(c.header)
      ) {
        push(c);
      }
    }
  }

  let out = '';
  for (const c of picked) {
    const block = `${c.header}\n\n${c.body}`.trim();
    if (!block) continue;
    if (out.length + block.length + 4 > maxChars) {
      const room = maxChars - out.length - 80;
      if (room > 400) {
        out += `\n\n${block.slice(0, room)}\n\n…(truncated)`;
      }
      break;
    }
    out += (out ? '\n\n' : '') + block;
  }

  return out || md.slice(0, maxChars);
}
