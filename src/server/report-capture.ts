import { promises as fs } from 'fs';
import path from 'path';
import type { Locator, Page } from 'playwright';
import type { WebFlowStep } from '@/lib/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const OVERLAY_ID = '__lgd_fail_highlight__';
/** Cap tall SPAs (catalog grids) so capture stays fast and live view stays sharp. */
const MAX_SHOT_HEIGHT = 3200;
const CAPTURE_BUDGET_MS = 12000;

export type FailureHighlight = {
  label?: string;
  action?: string;
  /** Expected text, selector, or URL fragment */
  expected?: string;
  message?: string;
};

type BoxHit = {
  x: number;
  y: number;
  width: number;
  height: number;
  note: string;
  tone: 'fail' | 'near';
};

/**
 * Persist a full-document PNG with mismatch highlights.
 * SPAs often use overflow:hidden so Playwright fullPage alone only captures
 * the viewport — we briefly expand height, then restore it.
 *
 * Important: do NOT walk every DOM node (catalog pages can have huge trees).
 * That hung capture, blurred the live screencast, and delayed reports.
 */
export async function captureFailureScreenshot(
  page: Page,
  runId: string,
  stepId: string,
  highlight?: FailureHighlight,
): Promise<string | undefined> {
  const prevViewport = page.viewportSize() || { width: 1280, height: 800 };

  const run = async (): Promise<string | undefined> => {
    const dir = path.join(DATA_DIR, 'reports', runId);
    await fs.mkdir(dir, { recursive: true });
    const file = `${stepId.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const abs = path.join(dir, file);

    await unlockPageForFullCapture(page);
    const contentSize = await measurePageContentSize(page);
    const shotHeight = Math.min(
      Math.max(contentSize.height, prevViewport.height),
      MAX_SHOT_HEIGHT,
    );
    const shotWidth = Math.min(Math.max(contentSize.width, prevViewport.width), 1920);

    await page.setViewportSize({ width: shotWidth, height: shotHeight });
    await page.waitForTimeout(80);
    await page.evaluate(() => window.scrollTo(0, 0));

    const boxes = highlight ? await collectHighlightBoxes(page, highlight) : [];
    await injectHighlightOverlay(page, {
      title: highlight?.label || 'Step failed',
      expected: highlight?.expected || '',
      action: highlight?.action || '',
      message: highlight?.message || '',
      boxes,
    });

    try {
      await page.screenshot({
        path: abs,
        type: 'png',
        fullPage: false,
        animations: 'disabled',
      });
    } finally {
      await removeHighlightOverlay(page);
      await page.setViewportSize(prevViewport).catch(() => undefined);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    }

    return path.join('reports', runId, file);
  };

  try {
    return await Promise.race([
      run(),
      new Promise<undefined>((_, reject) => {
        setTimeout(() => reject(new Error('Failure screenshot timed out')), CAPTURE_BUDGET_MS);
      }),
    ]);
  } catch (err) {
    console.error('[report] screenshot failed', err);
    await page.setViewportSize(prevViewport).catch(() => undefined);
    try {
      const dir = path.join(DATA_DIR, 'reports', runId);
      await fs.mkdir(dir, { recursive: true });
      const file = `${stepId.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
      const abs = path.join(dir, file);
      await page.screenshot({
        path: abs,
        type: 'png',
        fullPage: false,
        animations: 'disabled',
      });
      return path.join('reports', runId, file);
    } catch {
      return undefined;
    }
  }
}

/** Crisp JPEG of the current viewport for the MCP live panel (avoids blurry screencast frames). */
export async function captureLivePreviewJpeg(page: Page): Promise<Buffer | undefined> {
  try {
    return await page.screenshot({
      type: 'jpeg',
      quality: 82,
      fullPage: false,
      animations: 'disabled',
    });
  } catch {
    return undefined;
  }
}

/** Persist a PNG viewport shot for load-test / success reports (no failure overlay). */
export async function captureViewportScreenshot(
  page: Page,
  runId: string,
  stepId: string,
): Promise<string | undefined> {
  try {
    const dir = path.join(DATA_DIR, 'reports', runId);
    await fs.mkdir(dir, { recursive: true });
    const file = `${stepId.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const abs = path.join(dir, file);
    await page.screenshot({
      path: abs,
      type: 'png',
      fullPage: false,
      animations: 'disabled',
    });
    return path.join('reports', runId, file);
  } catch (err) {
    console.error('[report] viewport screenshot failed', err);
    return undefined;
  }
}

/** SPA pages often clip scroll on html/body — unlock a small set of containers only. */
async function unlockPageForFullCapture(page: Page) {
  await page.evaluate(() => {
    const unlock = (el: Element | null) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.setProperty('overflow', 'visible', 'important');
      el.style.setProperty('overflow-x', 'visible', 'important');
      el.style.setProperty('overflow-y', 'visible', 'important');
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('max-height', 'none', 'important');
    };

    unlock(document.documentElement);
    unlock(document.body);

    const roots = Array.from(
      document.querySelectorAll(
        'app-root, #root, #app, main, .main, .content, .page, .layout, .wrapper, [class*="scroll"]',
      ),
    );
    for (const el of roots.slice(0, 40)) unlock(el);

    // Only inspect direct body children + one level — never all body * (catalog DOMs are huge)
    const candidates = [
      ...Array.from(document.body?.children || []),
      ...Array.from(document.body?.querySelectorAll(':scope > * > *') || []),
    ];
    for (const el of candidates.slice(0, 80)) {
      if (!(el instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      if (
        (oy === 'auto' || oy === 'scroll' || oy === 'hidden' || style.overflow === 'hidden') &&
        el.scrollHeight > el.clientHeight + 60 &&
        el.clientHeight >= 120
      ) {
        unlock(el);
      }
    }

    void document.body.offsetHeight;
  });
}

async function measurePageContentSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const widths = [
      document.documentElement.scrollWidth,
      document.documentElement.offsetWidth,
      document.body?.scrollWidth || 0,
      document.body?.offsetWidth || 0,
      window.innerWidth,
    ];
    const heights = [
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight,
      document.body?.scrollHeight || 0,
      document.body?.offsetHeight || 0,
      window.innerHeight,
    ];

    // Sample a few large containers — avoid getBoundingClientRect on every node
    const sample = Array.from(
      document.querySelectorAll(
        'app-root, #root, main, .content, .page, .product-list, .card-list, [class*="grid"], [class*="list"]',
      ),
    ).slice(0, 30);
    for (const el of sample) {
      if (el instanceof HTMLElement) {
        heights.push(el.scrollHeight, Math.ceil(el.getBoundingClientRect().bottom + window.scrollY));
      }
    }

    return {
      width: Math.ceil(Math.max(...widths)),
      height: Math.ceil(Math.max(...heights)),
    };
  });
}

export function highlightFromWebStep(
  step: WebFlowStep,
  errMsg: string,
): FailureHighlight {
  const expected =
    step.action === 'assertUrl'
      ? step.url || step.value || ''
      : step.text || step.selector || step.value || step.url || '';
  return {
    label: step.label,
    action: step.action,
    expected,
    message: errMsg,
  };
}

async function collectHighlightBoxes(
  page: Page,
  highlight: FailureHighlight,
): Promise<BoxHit[]> {
  const boxes: BoxHit[] = [];
  const expected = (highlight.expected || '').trim();
  if (!expected) return boxes;

  // 1) Direct locator attempts (attached but not visible, or multi-match)
  const candidates: Locator[] = [];
  if (highlight.action !== 'assertUrl') {
    if (expected.startsWith('#') || expected.startsWith('.') || expected.includes('[')) {
      candidates.push(page.locator(expected));
    }
    try {
      candidates.push(page.getByText(new RegExp(escapeRegExp(expected), 'i')));
      candidates.push(page.getByRole('button', { name: new RegExp(escapeRegExp(expected), 'i') }));
      candidates.push(page.getByLabel(new RegExp(escapeRegExp(expected), 'i')));
    } catch {
      // ignore invalid regex
    }
  }

  for (const loc of candidates) {
    try {
      const count = await loc.count();
      const limit = Math.min(count, 6);
      for (let i = 0; i < limit; i++) {
        const el = loc.nth(i);
        const box = await el.boundingBox().catch(() => null);
        if (!box || box.width < 2 || box.height < 2) continue;
        const visible = await el.isVisible().catch(() => false);
        boxes.push({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          note: visible
            ? `Found: "${truncate(expected, 40)}"`
            : `Present but not visible: "${truncate(expected, 36)}"`,
          tone: visible ? 'near' : 'fail',
        });
      }
      if (boxes.length) break;
    } catch {
      // try next locator strategy
    }
  }

  // 2) Soft DOM search for near-matches when nothing was found
  if (!boxes.length && highlight.action !== 'assertUrl') {
    const soft = await page
      .evaluate((needle) => {
        const n = (needle || '').trim().toLowerCase();
        if (!n || n.length < 2) return [] as BoxHit[];
        const tokens = n.split(/\s+/).filter((t) => t.length >= 3);
        const hits: BoxHit[] = [];
        const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
        for (const el of all) {
          if (hits.length >= 8) break;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
            .trim()
            .replace(/\s+/g, ' ');
          if (!text || text.length > 120) continue;
          const lower = text.toLowerCase();
          const exactish = lower.includes(n) || n.includes(lower);
          const tokenHit = tokens.length ? tokens.some((t) => lower.includes(t)) : false;
          if (!exactish && !tokenHit) continue;
          // Prefer leaf-ish nodes
          if (el.children.length > 4) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight * 3) continue;
          hits.push({
            x: r.left + window.scrollX,
            y: r.top + window.scrollY,
            width: r.width,
            height: r.height,
            note: exactish ? `Near match: "${text.slice(0, 48)}"` : `Partial: "${text.slice(0, 48)}"`,
            tone: exactish ? 'fail' : 'near',
          });
        }
        return hits;
      }, expected)
      .catch(() => [] as BoxHit[]);
    boxes.push(...soft);
  }

  return boxes.slice(0, 8);
}

async function injectHighlightOverlay(
  page: Page,
  payload: {
    title: string;
    expected: string;
    action: string;
    message: string;
    boxes: BoxHit[];
  },
) {
  await page.evaluate(
    ({ overlayId, payload: p }) => {
      document.getElementById(overlayId)?.remove();

      const root = document.createElement('div');
      root.id = overlayId;
      root.setAttribute('data-lgd-fail-overlay', '1');
      Object.assign(root.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)}px`,
        height: `${Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)}px`,
        zIndex: '2147483646',
        pointerEvents: 'none',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      });

      // Dim layer
      const dim = document.createElement('div');
      Object.assign(dim.style, {
        position: 'absolute',
        inset: '0',
        background: 'rgba(120, 0, 20, 0.12)',
      });
      root.appendChild(dim);

      // Top banner at document top (full-page shot starts here)
      const banner = document.createElement('div');
      const notFound = !p.boxes.length;
      banner.innerHTML = [
        `<div style="font-size:13px;font-weight:700;letter-spacing:0.02em;">FAIL — ${escapeHtml(p.title)}</div>`,
        p.expected
          ? `<div style="margin-top:4px;font-size:12px;"><strong>Expected:</strong> ${escapeHtml(truncate(p.expected, 120))}${notFound ? ' <span style="background:#fff;color:#b00020;padding:1px 6px;border-radius:4px;margin-left:6px;">NOT MATCHED</span>' : ''}</div>`
          : '',
        p.action ? `<div style="margin-top:2px;font-size:11px;opacity:0.9;">Action: ${escapeHtml(p.action)}</div>` : '',
        p.message
          ? `<div style="margin-top:6px;font-size:11px;opacity:0.95;max-width:920px;white-space:pre-wrap;">${escapeHtml(truncate(p.message, 280))}</div>`
          : '',
        notFound
          ? `<div style="margin-top:8px;font-size:11px;font-weight:600;">No matching UI found on this page — red banner marks the mismatch.</div>`
          : `<div style="margin-top:8px;font-size:11px;font-weight:600;">Highlighted boxes show matched / near-matched UI for this failure.</div>`,
      ]
        .filter(Boolean)
        .join('');
      Object.assign(banner.style, {
        position: 'absolute',
        left: '12px',
        top: '12px',
        maxWidth: 'min(720px, calc(100% - 24px))',
        padding: '12px 14px',
        borderRadius: '10px',
        background: 'rgba(176, 0, 32, 0.94)',
        color: '#fff',
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
        border: '2px solid #fff',
        zIndex: '2',
      });
      root.appendChild(banner);

      for (const box of p.boxes) {
        const color = box.tone === 'fail' ? '#b00020' : '#d97706';
        const ring = document.createElement('div');
        Object.assign(ring.style, {
          position: 'absolute',
          left: `${box.x - 3}px`,
          top: `${box.y - 3}px`,
          width: `${box.width + 6}px`,
          height: `${box.height + 6}px`,
          border: `3px solid ${color}`,
          borderRadius: '6px',
          boxShadow: `0 0 0 2px #fff, 0 0 0 9999px rgba(0,0,0,0.08)`,
          background: box.tone === 'fail' ? 'rgba(176,0,32,0.12)' : 'rgba(217,119,6,0.12)',
          zIndex: '1',
        });
        root.appendChild(ring);

        const tag = document.createElement('div');
        tag.textContent = box.note;
        Object.assign(tag.style, {
          position: 'absolute',
          left: `${box.x}px`,
          top: `${Math.max(0, box.y - 26)}px`,
          maxWidth: '360px',
          padding: '3px 8px',
          borderRadius: '4px',
          background: color,
          color: '#fff',
          fontSize: '11px',
          fontWeight: '700',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          zIndex: '2',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        });
        root.appendChild(tag);
      }

      // If nothing matched, draw a center callout on the viewport
      if (!p.boxes.length) {
        const callout = document.createElement('div');
        callout.textContent = p.expected
          ? `✗ Missing / not matched: ${truncate(p.expected, 80)}`
          : '✗ Expected UI did not match';
        Object.assign(callout.style, {
          position: 'absolute',
          left: '50%',
          top: '220px',
          transform: 'translateX(-50%)',
          padding: '10px 16px',
          borderRadius: '8px',
          background: 'rgba(176, 0, 32, 0.92)',
          color: '#fff',
          fontSize: '14px',
          fontWeight: '700',
          border: '2px dashed #fff',
          zIndex: '2',
          maxWidth: '80%',
          textAlign: 'center',
        });
        root.appendChild(callout);
      }

      document.documentElement.appendChild(root);
      window.scrollTo(0, 0);

      function escapeHtml(s: string) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }
      function truncate(s: string, n: number) {
        return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
      }
    },
    { overlayId: OVERLAY_ID, payload },
  );

  // Let layout paint
  await page.waitForTimeout(80);
}

async function removeHighlightOverlay(page: Page) {
  await page
    .evaluate((overlayId) => {
      document.getElementById(overlayId)?.remove();
    }, OVERLAY_ID)
    .catch(() => undefined);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function stepFailDetail(label: string, errMsg: string): string {
  const tips: string[] = [];
  if (/timeout/i.test(errMsg)) {
    tips.push(
      'Timed out waiting for UI — check loading, auth, selectors, and whether the portal route changed.',
    );
  }
  if (/strict mode violation/i.test(errMsg)) {
    tips.push('Multiple elements matched — use a more unique text/selector.');
  }
  if (/net::|ERR_/i.test(errMsg)) {
    tips.push('Network/navigation issue — confirm portal URL and that the app is running.');
  }
  if (!tips.length) {
    tips.push(
      'Compare the highlighted failure screenshot with the expected UI, then fix the step or the product bug.',
    );
  }
  return `FAIL — ${label}. ${errMsg} Guidance: ${tips.join(' ')}`;
}

export function stepPassDetail(label: string, message: string): string {
  return `PASS — ${label}. ${message} Expected behaviour confirmed for developers and testers studying this flow.`;
}
