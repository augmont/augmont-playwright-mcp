import type { WebFlowStep, WebTestCase } from '@/lib/types';
import { groupNameFromFile } from '@/server/import-case-groups';

/** Strip Python/JS string quotes and unescape common sequences. */
function unquote(raw: string): string {
  const s = raw.trim();
  const q = s[0];
  if ((q === '"' || q === "'" || q === '`') && s.endsWith(q) && s.length >= 2) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  // Python raw / regex: r"..." or re.compile("...")
  const m = s.match(/^[rfRbBuU]?(['"])([\s\S]*)\1$/);
  if (m) return m[2]!;
  return s;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/^test[_\s-]+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function inferRole(
  text: string,
  hint?: 'public' | 'buyer' | 'seller' | 'admin',
): 'public' | 'buyer' | 'seller' | 'admin' {
  if (hint) return hint;
  const t = text.toLowerCase();
  if (/\b\/admin\b|\brole\s*=\s*['"]admin['"]|\badmin\b/.test(t)) return 'admin';
  if (/\b\/seller\b|\brole\s*=\s*['"]seller['"]/.test(t)) return 'seller';
  if (/\b\/buyer\b|\bbuyer\b|\bwishlist\b|\bcart\b/.test(t)) return 'buyer';
  return 'public';
}

function firstStringArg(callArgs: string): string | undefined {
  const m = callArgs.match(/(['"`])((?:\\.|(?!\1).)*)\1/);
  if (!m) return undefined;
  return unquote(m[0]!);
}

function namedStringArg(callArgs: string, name: string): string | undefined {
  const re = new RegExp(
    `${name}\\s*=\\s*([rfRbBuU]?(['"\`])(?:\\\\.|(?!\\2).)*\\2)`,
  );
  const m = callArgs.match(re);
  if (!m) return undefined;
  return unquote(m[1]!);
}

function extractBalancedArgs(src: string, openAt: number): string | undefined {
  if (src[openAt] !== '(') return undefined;
  let depth = 0;
  let q: string | null = null;
  for (let i = openAt; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      q = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(openAt + 1, i);
    }
  }
  return undefined;
}

function extractMethodArgs(line: string, method: string): string | undefined {
  const re = new RegExp(`\\.${method}\\s*\\(`);
  const m = re.exec(line);
  if (!m || m.index == null) return undefined;
  const openAt = m.index + m[0].length - 1;
  return extractBalancedArgs(line, openAt);
}

function extractCallArgs(line: string, method: string): string | undefined {
  return extractMethodArgs(line, method);
}

function extractPageMethodArgs(line: string, method: string): string | undefined {
  const re = new RegExp(`\\bpage\\.${method}\\s*\\(`);
  const m = re.exec(line);
  if (!m || m.index == null) return undefined;
  const openAt = m.index + m[0].length - 1;
  return extractBalancedArgs(line, openAt);
}

/** Split args by commas not inside quotes/parens. */
function splitTopLevelArgs(args: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let q: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if (q) {
      cur += ch;
      if (ch === '\\') {
        i += 1;
        if (i < args.length) cur += args[i];
        continue;
      }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      cur += ch;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function looksLikePythonPlaywright(content: string): boolean {
  const t = content;
  return (
    /\bfrom\s+playwright|\bimport\s+playwright|\bpage\.(goto|locator|fill|click|get_by_)/.test(
      t,
    ) ||
    /\bexpect\s*\(\s*page/.test(t) ||
    /\bdef\s+test_/.test(t)
  );
}

type FnBlock = { name: string; body: string };

/** Split Python source into test_ function bodies (best-effort, indentation-based). */
function extractTestFunctions(source: string): FnBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: FnBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const def = line.match(/^(\s*)(?:async\s+)?def\s+(test_[\w]+)\s*\(/);
    if (!def) {
      i += 1;
      continue;
    }
    const indent = def[1]!.length;
    const name = def[2]!;
    i += 1;
    const bodyLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i]!;
      if (cur.trim() === '') {
        bodyLines.push(cur);
        i += 1;
        continue;
      }
      const lead = cur.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (lead <= indent && /\S/.test(cur)) break;
      bodyLines.push(cur);
      i += 1;
    }
    blocks.push({ name, body: bodyLines.join('\n') });
  }
  return blocks;
}

function stripComments(line: string): string {
  // naive: drop # comments outside quotes
  let out = '';
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      out += ch;
      if (ch === '\\' && i + 1 < line.length) {
        out += line[++i];
        continue;
      }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      out += ch;
      continue;
    }
    if (ch === '#') break;
    out += ch;
  }
  return out.trim();
}

function parseStepsFromBody(body: string): WebFlowStep[] {
  const steps: WebFlowStep[] = [];
  const lines = body.split('\n');
  let stepN = 0;

  const push = (partial: Omit<WebFlowStep, 'id'> & { id?: string }) => {
    stepN += 1;
    steps.push({
      id: partial.id || `step-${stepN}`,
      label: partial.label,
      action: partial.action,
      url: partial.url,
      selector: partial.selector,
      value: partial.value,
      text: partial.text,
      timeoutMs: partial.timeoutMs,
    });
  };

  for (const rawLine of lines) {
    let line = stripComments(rawLine);
    if (!line) continue;
    // flatten chained awaits
    line = line.replace(/^await\s+/, '');

    // page.goto("...")
    if (/\bpage\.goto\s*\(/.test(line)) {
      const args = extractPageMethodArgs(line, 'goto') || '';
      const url = firstStringArg(args);
      if (url) {
        let path = url;
        try {
          if (/^https?:\/\//i.test(url)) path = new URL(url).pathname || '/';
        } catch {
          // keep raw
        }
        push({
          label: `Go to ${path}`,
          action: 'goto',
          url: path,
        });
      }
      continue;
    }

    // page.wait_for_timeout(500) / page.wait_for_timeout(ms=500)
    if (/\bpage\.wait_for_timeout\s*\(/.test(line)) {
      const args = extractPageMethodArgs(line, 'wait_for_timeout') || '';
      const ms = Number(args.match(/(\d+)/)?.[1] || 500);
      push({ label: `Wait ${ms}ms`, action: 'wait', value: String(ms) });
      continue;
    }

    // expect(page).to_have_url(...)
    if (/expect\s*\(\s*page\s*\)\s*\.to_have_url\s*\(/.test(line)) {
      const args = extractMethodArgs(line, 'to_have_url') || '';
      let url = firstStringArg(args) || '';
      if (!url) {
        const reM = args.match(/r?(['"`])((?:\\.|(?!\1).)*)\1/);
        if (reM) url = unquote(reM[0]!);
      }
      if (url) {
        push({
          label: `Assert URL ${url}`,
          action: 'assertUrl',
          url,
          value: url,
        });
      }
      continue;
    }

    // expect(page.locator(...)).to_be_visible() / expect(page.get_by_...).to_be_visible()
    if (/expect\s*\(/.test(line) && /\.to_be_visible\s*\(/.test(line)) {
      const locArgs = extractPageMethodArgs(line, 'locator');
      const roleArgs = extractPageMethodArgs(line, 'get_by_role');
      const textArgs = extractPageMethodArgs(line, 'get_by_text');
      if (locArgs != null) {
        const sel = firstStringArg(locArgs);
        if (sel) {
          push({
            label: `Assert visible ${sel}`,
            action: 'assertVisible',
            selector: sel,
          });
        }
      } else if (roleArgs != null) {
        const name =
          namedStringArg(roleArgs, 'name') ||
          firstStringArg(roleArgs.split(',').slice(1).join(','));
        push({
          label: `Assert visible ${name || 'role'}`,
          action: 'assertVisible',
          text: name,
        });
      } else if (textArgs != null) {
        const text = firstStringArg(textArgs);
        if (text) {
          push({
            label: `Assert visible “${text}”`,
            action: 'assertVisible',
            text,
          });
        }
      }
      continue;
    }

    // page.fill(selector, value) — sync API
    if (/\bpage\.fill\s*\(/.test(line) && !/\.locator\s*\(/.test(line) && !/\.get_by_/.test(line)) {
      const args = extractPageMethodArgs(line, 'fill') || '';
      const parts = splitTopLevelArgs(args);
      const selector = firstStringArg(parts[0] || '');
      const value = firstStringArg(parts[1] || '');
      if (selector) {
        push({
          label: `Fill ${selector}`,
          action: 'fill',
          selector,
          value: value || '',
        });
      }
      continue;
    }

    // page.click(selector)
    if (/\bpage\.click\s*\(/.test(line) && !/\.locator\s*\(/.test(line) && !/\.get_by_/.test(line)) {
      const args = extractPageMethodArgs(line, 'click') || '';
      const selector = firstStringArg(args);
      if (selector) {
        push({
          label: `Click ${selector}`,
          action: 'click',
          selector,
        });
      }
      continue;
    }

    // page.get_by_role(...).click() / .fill()
    if (/\bpage\.get_by_role\s*\(/.test(line)) {
      const args = extractPageMethodArgs(line, 'get_by_role') || '';
      const name = namedStringArg(args, 'name');
      const roleType = firstStringArg(args);
      if (/\.fill\s*\(/.test(line)) {
        const fillArgs = extractMethodArgs(line, 'fill') || '';
        const value = firstStringArg(fillArgs) || '';
        push({
          label: `Fill ${name || roleType || 'field'}`,
          action: 'fill',
          text: name,
          value,
        });
      } else if (/\.click\s*\(/.test(line)) {
        push({
          label: `Click ${name || roleType || 'control'}`,
          action: 'click',
          text: name || roleType,
        });
      }
      continue;
    }

    // page.get_by_text(...).click()
    if (/\bpage\.get_by_text\s*\(/.test(line) && /\.click\s*\(/.test(line)) {
      const args = extractPageMethodArgs(line, 'get_by_text') || '';
      const text = firstStringArg(args);
      if (text) {
        push({
          label: `Click “${text}”`,
          action: 'click',
          text,
        });
      }
      continue;
    }

    // page.get_by_label(...).fill(...)
    if (/\bpage\.get_by_label\s*\(/.test(line) && /\.fill\s*\(/.test(line)) {
      const args = extractPageMethodArgs(line, 'get_by_label') || '';
      const text = firstStringArg(args);
      const fillArgs = extractMethodArgs(line, 'fill') || '';
      const value = firstStringArg(fillArgs) || '';
      push({
        label: `Fill ${text || 'label'}`,
        action: 'fill',
        text: text,
        value,
      });
      continue;
    }

    // page.locator(...).click() / .fill()
    if (/\bpage\.locator\s*\(/.test(line)) {
      const locArgs = extractPageMethodArgs(line, 'locator') || '';
      const selector = firstStringArg(locArgs);
      if (!selector) continue;
      if (/\.fill\s*\(/.test(line)) {
        const fillArgs = extractMethodArgs(line, 'fill') || '';
        const value = firstStringArg(fillArgs) || '';
        push({
          label: `Fill ${selector}`,
          action: 'fill',
          selector,
          value,
        });
      } else if (/\.click\s*\(/.test(line)) {
        const chained = line.match(/\.get_by_(?:role|text)\s*\(/);
        let text: string | undefined;
        if (chained) {
          const idx = line.indexOf(chained[0]!);
          const openAt = idx + chained[0]!.length - 1;
          const cArgs = extractBalancedArgs(line, openAt) || '';
          text = namedStringArg(cArgs, 'name') || firstStringArg(cArgs);
        }
        push({
          label: text ? `Click ${text}` : `Click ${selector}`,
          action: 'click',
          selector,
          text: text || undefined,
        });
      } else if (/\.wait_for\s*\(/.test(line)) {
        push({
          label: `Wait for ${selector}`,
          action: 'assertVisible',
          selector,
        });
      }
      continue;
    }
  }

  return steps;
}

/**
 * Parse a Python Playwright / pytest-playwright file into declarative WebTestCase[].
 * Best-effort — falls back empty when no recognizable steps found.
 */
export function parsePythonPlaywright(
  content: string,
  opts?: {
    fileName?: string;
    roleHint?: 'public' | 'buyer' | 'seller' | 'admin';
  },
): WebTestCase[] {
  if (!content.trim()) return [];
  if (!looksLikePythonPlaywright(content) && !/\.py$/i.test(opts?.fileName || '')) {
    // Still try if caller forced .py
    if (!opts?.fileName?.toLowerCase().endsWith('.py')) return [];
  }

  const blocks = extractTestFunctions(content);
  const sources =
    blocks.length > 0
      ? blocks
      : [
          {
            name: slugify(opts?.fileName || 'python-playwright') || 'python-flow',
            body: content,
          },
        ];

  const group = groupNameFromFile(opts?.fileName);

  const cases: WebTestCase[] = [];
  for (const block of sources) {
    const steps = parseStepsFromBody(block.body);
    if (!steps.length) continue;

    const pretty = block.name
      .replace(/^test_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const id = slugify(block.name) || `py-${Date.now()}`;
    const role = inferRole(`${block.name}\n${block.body}`, opts?.roleHint);

    cases.push({
      id,
      name: pretty || id,
      description: `Imported from Python Playwright (${opts?.fileName || 'upload'})`,
      tags: ['web', 'upload', 'python-playwright', role],
      estimatedMinutes: Math.max(2, Math.ceil(steps.length / 2)),
      kind: 'web-flow',
      role,
      steps,
      source: 'upload',
      group,
    });
  }

  return cases;
}

export function isPythonPlaywrightUpload(
  fileName: string,
  content: string,
): boolean {
  if (/\.py$/i.test(fileName)) return true;
  return looksLikePythonPlaywright(content);
}
