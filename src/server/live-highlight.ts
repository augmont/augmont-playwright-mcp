import type { Page } from 'playwright';

const LIVE_OVERLAY_ID = '__lgd_live_action_highlight__';

export type LiveHighlightTone = 'click' | 'fill' | 'assert' | 'inspect' | 'goto' | 'info';

export type LiveHighlightBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  note: string;
};

const TONE_COLOR: Record<LiveHighlightTone, string> = {
  click: '#2563eb',
  fill: '#7c3aed',
  assert: '#059669',
  inspect: '#c9a227',
  goto: '#0ea5e9',
  info: '#64748b',
};

const TONE_LABEL: Record<LiveHighlightTone, string> = {
  click: 'CLICK',
  fill: 'FILL',
  assert: 'ASSERT',
  inspect: 'INSPECT',
  goto: 'NAVIGATE',
  info: 'ACTION',
};

async function resolveBoxes(
  page: Page,
  opts: { selector?: string; text?: string },
): Promise<LiveHighlightBox[]> {
  const boxes: LiveHighlightBox[] = [];
  const selectors = (opts.selector || '')
    .split(/\s*\|\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sel of selectors) {
    try {
      const loc = page.locator(sel);
      const count = Math.min(await loc.count(), 5);
      for (let i = 0; i < count; i++) {
        const el = loc.nth(i);
        const box = await el.boundingBox().catch(() => null);
        if (!box || box.width < 2 || box.height < 2) continue;
        boxes.push({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          note: sel.slice(0, 48),
        });
      }
      if (boxes.length) break;
    } catch {
      // next
    }
  }

  if (!boxes.length && opts.text?.trim()) {
    try {
      const re = new RegExp(opts.text, 'i');
      const btn = page.getByRole('button', { name: re });
      const byText = page.getByText(re);
      for (const loc of [btn, byText]) {
        const count = Math.min(await loc.count(), 4);
        for (let i = 0; i < count; i++) {
          const box = await loc.nth(i).boundingBox().catch(() => null);
          if (!box || box.width < 2 || box.height < 2) continue;
          boxes.push({
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            note: `"${opts.text.slice(0, 40)}"`,
          });
        }
        if (boxes.length) break;
      }
    } catch {
      // ignore
    }
  }

  return boxes.slice(0, 8);
}

/** Remove live action highlight overlay from the page. */
export async function clearLiveActionHighlight(page: Page) {
  await page
    .evaluate((id) => document.getElementById(id)?.remove(), LIVE_OVERLAY_ID)
    .catch(() => undefined);
}

/**
 * Draw a bright overlay on target elements so MCP screencast / live view
 * shows what is about to be clicked, filled, asserted, or inspected.
 */
export async function showLiveActionHighlight(
  page: Page,
  opts: {
    tone: LiveHighlightTone;
    title: string;
    detail?: string;
    selector?: string;
    text?: string;
    /** Extra boxes (e.g. bulk inspect) */
    boxes?: LiveHighlightBox[];
    holdMs?: number;
  },
): Promise<void> {
  const resolved =
    opts.boxes && opts.boxes.length
      ? opts.boxes
      : await resolveBoxes(page, { selector: opts.selector, text: opts.text });

  const color = TONE_COLOR[opts.tone];
  const badge = TONE_LABEL[opts.tone];

  await page
    .evaluate(
      ({ overlayId, payload }) => {
        document.getElementById(overlayId)?.remove();
        const root = document.createElement('div');
        root.id = overlayId;
        root.setAttribute('data-lgd-live-highlight', '1');
        Object.assign(root.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: '100vw',
          height: '100vh',
          zIndex: '2147483645',
          pointerEvents: 'none',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        });

        const banner = document.createElement('div');
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="background:#fff;color:${payload.color};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.04em;">${payload.badge}</span>
            <span style="font-size:13px;font-weight:700;">${payload.title}</span>
          </div>
          ${payload.detail ? `<div style="margin-top:4px;font-size:11px;opacity:0.95;">${payload.detail}</div>` : ''}
        `;
        Object.assign(banner.style, {
          position: 'fixed',
          left: '12px',
          top: '12px',
          maxWidth: 'min(520px, calc(100% - 24px))',
          padding: '10px 12px',
          borderRadius: '10px',
          background: payload.color,
          color: '#fff',
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
          border: '2px solid #fff',
          zIndex: '2',
        });
        root.appendChild(banner);

        for (const box of payload.boxes) {
          const ring = document.createElement('div');
          Object.assign(ring.style, {
            position: 'fixed',
            left: `${box.x - 4}px`,
            top: `${box.y - 4}px`,
            width: `${box.width + 8}px`,
            height: `${box.height + 8}px`,
            border: `3px solid ${payload.color}`,
            borderRadius: '8px',
            boxShadow: `0 0 0 2px #fff, 0 0 24px ${payload.color}99`,
            background: `${payload.color}22`,
            zIndex: '1',
            animation: 'lgdPulse 0.9s ease-in-out infinite',
          });
          root.appendChild(ring);

          const tag = document.createElement('div');
          tag.textContent = box.note;
          Object.assign(tag.style, {
            position: 'fixed',
            left: `${box.x}px`,
            top: `${Math.max(8, box.y - 28)}px`,
            maxWidth: '280px',
            padding: '2px 8px',
            borderRadius: '4px',
            background: payload.color,
            color: '#fff',
            fontSize: '11px',
            fontWeight: '700',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            zIndex: '2',
          });
          root.appendChild(tag);
        }

        if (!document.getElementById('__lgd_live_hl_style')) {
          const style = document.createElement('style');
          style.id = '__lgd_live_hl_style';
          style.textContent = `@keyframes lgdPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.02);opacity:0.85}}`;
          document.head.appendChild(style);
        }

        document.documentElement.appendChild(root);
      },
      {
        overlayId: LIVE_OVERLAY_ID,
        payload: {
          badge,
          color,
          title: escapeForHtml(opts.title).slice(0, 120),
          detail: opts.detail ? escapeForHtml(opts.detail).slice(0, 200) : '',
          boxes: resolved,
        },
      },
    )
    .catch(() => undefined);

  const hold = opts.holdMs ?? 550;
  if (hold > 0) await page.waitForTimeout(hold);
}

function escapeForHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Highlight many scraped interactive elements during AI live inspect.
 * Shows a subset so the MCP view stays readable.
 */
export async function showInspectElementHighlights(
  page: Page,
  elements: Array<{ selector: string; text?: string; suggestedDataId?: string }>,
  title = 'Capturing selectors for AI',
): Promise<void> {
  const boxes: LiveHighlightBox[] = [];
  for (const el of elements.slice(0, 12)) {
    try {
      const loc = page.locator(el.selector).first();
      const box = await loc.boundingBox().catch(() => null);
      if (!box || box.width < 2 || box.height < 2) continue;
      boxes.push({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        note: (el.suggestedDataId || el.text || el.selector).slice(0, 40),
      });
    } catch {
      // skip
    }
  }

  await showLiveActionHighlight(page, {
    tone: 'inspect',
    title,
    detail: `${boxes.length} control(s) highlighted · data-id / selectors`,
    boxes,
    holdMs: 900,
  });
}
