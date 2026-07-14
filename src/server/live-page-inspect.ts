import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import type { RoleCredentialsMap } from '@/lib/role-credentials';
import {
  clearLiveActionHighlight,
  showInspectElementHighlights,
  showLiveActionHighlight,
} from '@/server/live-highlight';
import { setInspectFrame } from '@/server/inspect-session';
import { captureLivePreviewJpeg } from '@/server/report-capture';

export type LiveDomElement = {
  tag: string;
  role?: string;
  text?: string;
  name?: string;
  placeholder?: string;
  /** Best Playwright/CSS selector for this element */
  selector: string;
  /** Prefer these when present on the live page */
  dataTestId?: string;
  dataId?: string;
  id?: string;
  formControlName?: string;
  ariaLabel?: string;
  href?: string;
  type?: string;
  /** Suggested durable test id (for docs / future portal attrs) */
  suggestedDataId?: string;
};

export type LivePageSnapshot = {
  url: string;
  path: string;
  title: string;
  elements: LiveDomElement[];
  error?: string;
};

export type LiveInspectResult = {
  ok: boolean;
  pages: LivePageSnapshot[];
  loggedInAs?: string;
  message: string;
  inspectSessionId?: string;
};

export async function attachInspectScreencast(
  inspectSessionId: string,
  page: Page,
): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    maxWidth: 1280,
    maxHeight: 800,
    everyNthFrame: 1,
  });
  client.on('Page.screencastFrame', async (event) => {
    try {
      setInspectFrame(inspectSessionId, Buffer.from(event.data, 'base64'));
      await client.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    } catch {
      // closed
    }
  });
  return client;
}

export async function pushCrispInspectFrame(inspectSessionId: string | undefined, page: Page) {
  if (!inspectSessionId) return;
  const jpeg = await captureLivePreviewJpeg(page);
  if (jpeg) setInspectFrame(inspectSessionId, jpeg);
}

export function resolvePortalUrl(baseUrl: string, maybePath: string): string {
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  const base = baseUrl.replace(/\/+$/, '');
  const pathPart = maybePath.startsWith('/') ? maybePath : `/${maybePath}`;
  return `${base}${pathPart}`;
}

/** @deprecated use resolvePortalUrl */
function resolveUrl(baseUrl: string, maybePath: string): string {
  return resolvePortalUrl(baseUrl, maybePath);
}

function slugifyLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** Infer portal paths to open from the user prompt + role. */
export function inferInspectPaths(
  prompt: string,
  role?: 'public' | 'buyer' | 'seller' | 'admin',
): string[] {
  const p = prompt.toLowerCase();
  const paths = new Set<string>();

  const add = (path: string) => paths.add(path);

  if (role === 'buyer' || /\bbuyer\b/.test(p)) {
    add('/buyer');
    if (/\bmelee\b|\bnon.?cert\b/.test(p)) add('/buyer/products/melee');
    else if (/\bproduct\b|\bdiamond\b|\bcatalog\b|\bfilter\b|\bsearch\b/.test(p)) {
      add('/buyer/products');
    }
    if (/\bcart\b|\bcheckout\b/.test(p)) add('/buyer/cart');
    if (/\bwishlist\b/.test(p)) add('/buyer/wishlist');
    if (/\border/.test(p)) add('/buyer/orders');
    if (/\bbuyback\b|\bbuy.?back\b/.test(p)) add('/buyer/buyback');
    if (/\brequest/.test(p)) add('/buyer/requests');
    if (/\baccount\b|\bpassword\b|\baddress\b|\bcurrency\b/.test(p)) {
      add('/buyer/my-account');
    }
    if (/\bresource\b|\bmarkup\b|\bshopify\b|\bapi\b/.test(p)) {
      add('/buyer/resource/overview');
    }
    if (paths.size <= 1) add('/buyer/products');
  } else if (role === 'admin' || /\badmin\b/.test(p)) {
    add('/admin');
    if (/\bseller/.test(p)) add('/admin/sellers');
    if (/\bbuyer/.test(p)) add('/admin/buyers');
    if (/\border/.test(p)) add('/admin/orders');
    if (/\bunapproved\b|\bproduct/.test(p)) add('/admin/unapproved-products');
    if (/\brole\b|\bpermission\b/.test(p)) add('/admin/roles');
    if (/\binternal\b/.test(p)) add('/admin/internal-users');
    if (/\bdemo\b/.test(p)) add('/admin/book-a-demo');
    if (paths.size <= 1) add('/admin/orders');
  } else if (role === 'seller' || /\bseller\b/.test(p)) {
    add('/seller');
  } else {
    // public
    if (/\blogin\b/.test(p)) add('/login');
    if (/\bregister\b|\bsign\s*up\b/.test(p)) add('/register');
    if (/\bforgot\b|\bpassword\b/.test(p)) add('/forgot-password');
    if (/\bdemo\b/.test(p)) add('/bookademo');
    if (/\bcontact\b/.test(p)) add('/contact-us');
    if (/\babout\b/.test(p)) add('/about-us');
    if (/\bblog\b|\binsight/.test(p)) add('/news-insights');
    if (paths.size === 0) {
      add('/');
      add('/login');
    }
  }

  // Cap visits for speed
  return [...paths].slice(0, 4);
}

export async function loginWithCreds(page: Page, baseUrl: string, email: string, password: string) {
  await page.goto(resolvePortalUrl(baseUrl, '/login'), {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  await page.locator('#mobileNumber, [formcontrolname="mobileNumber"]').first().fill(email);
  await page
    .locator('[formcontrolname="password"] input, #password, input[type="password"]')
    .first()
    .fill(password);
  await page.getByRole('button', { name: /log\s*in|sign\s*in|submit/i }).first().click();
  await page.waitForTimeout(2200);
  if (/\/login/i.test(page.url())) {
    throw new Error(`Live inspect login failed for ${email} (still on /login)`);
  }
}

export async function maybeLogin(
  page: Page,
  baseUrl: string,
  role: 'public' | 'buyer' | 'seller' | 'admin' | undefined,
  credentials?: RoleCredentialsMap,
): Promise<string | undefined> {
  if (!role || role === 'public') return undefined;
  const creds = credentials?.[role];
  if (!creds?.email?.trim() || !creds.password) {
    return undefined;
  }
  await loginWithCreds(page, baseUrl, creds.email.trim(), creds.password);
  return `${role}:${creds.email.trim()}`;
}

export async function scrapePage(page: Page): Promise<LivePageSnapshot> {
  const url = page.url();
  let path = '/';
  try {
    path = new URL(url).pathname || '/';
  } catch {
    // keep
  }
  const title = await page.title().catch(() => '');

  const elements = await page.evaluate(() => {
    const MAX = 80;
    const out: Array<Record<string, string | undefined>> = [];
    const seen = new Set<string>();

    const visible = (el: Element) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const cssEscape = (s: string) => {
      if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
      return s.replace(/["\\]/g, '\\$&');
    };

    const pickSelector = (el: HTMLElement): {
      selector: string;
      dataTestId?: string;
      dataId?: string;
      id?: string;
      formControlName?: string;
      ariaLabel?: string;
    } => {
      const dataTestId =
        el.getAttribute('data-testid') ||
        el.getAttribute('data-test-id') ||
        undefined;
      const dataId = el.getAttribute('data-id') || undefined;
      const id = el.id || undefined;
      const formControlName =
        el.getAttribute('formcontrolname') ||
        el.getAttribute('ng-reflect-name') ||
        undefined;
      const ariaLabel = el.getAttribute('aria-label') || undefined;

      if (dataTestId) {
        return {
          selector: `[data-testid="${cssEscape(dataTestId)}"]`,
          dataTestId,
          dataId,
          id,
          formControlName,
          ariaLabel,
        };
      }
      if (dataId) {
        return {
          selector: `[data-id="${cssEscape(dataId)}"]`,
          dataTestId,
          dataId,
          id,
          formControlName,
          ariaLabel,
        };
      }
      if (id && !/^[0-9]/.test(id) && !id.includes(' ')) {
        return {
          selector: `#${cssEscape(id)}`,
          dataTestId,
          dataId,
          id,
          formControlName,
          ariaLabel,
        };
      }
      if (formControlName) {
        return {
          selector: `[formControlName="${cssEscape(formControlName)}"]`,
          dataTestId,
          dataId,
          id,
          formControlName,
          ariaLabel,
        };
      }
      if (ariaLabel) {
        return {
          selector: `[aria-label="${cssEscape(ariaLabel)}"]`,
          dataTestId,
          dataId,
          id,
          formControlName,
          ariaLabel,
        };
      }

      const classes = [...el.classList]
        .filter(
          (c) =>
            c &&
            !/^(ng-|p-|cdk-|mat-|flex|grid|text-|bg-|w-|h-|m[trblxy]?-|p[trblxy]?-|gap-|rounded|border|cursor|absolute|relative|block|inline|hidden|opacity)/i.test(
              c,
            ),
        )
        .slice(0, 2);
      if (classes.length) {
        return {
          selector: `${el.tagName.toLowerCase()}.${classes.map(cssEscape).join('.')}`,
          dataTestId,
          dataId,
          id,
          formControlName,
          ariaLabel,
        };
      }

      return {
        selector: el.tagName.toLowerCase(),
        dataTestId,
        dataId,
        id,
        formControlName,
        ariaLabel,
      };
    };

    const push = (el: HTMLElement, roleHint?: string) => {
      if (!visible(el)) return;
      const text = (el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      const name =
        el.getAttribute('name') ||
        el.getAttribute('aria-label') ||
        (el as HTMLInputElement).placeholder ||
        undefined;
      const picked = pickSelector(el);
      const key = `${picked.selector}|${text}|${name || ''}`;
      if (seen.has(key)) return;
      seen.add(key);

      const labelForSuggest = slugify(
        text || name || picked.dataTestId || picked.dataId || picked.id || el.tagName,
      );
      out.push({
        tag: el.tagName.toLowerCase(),
        role: roleHint || el.getAttribute('role') || undefined,
        text: text || undefined,
        name: name || undefined,
        placeholder: (el as HTMLInputElement).placeholder || undefined,
        selector: picked.selector,
        dataTestId: picked.dataTestId,
        dataId: picked.dataId,
        id: picked.id,
        formControlName: picked.formControlName,
        ariaLabel: picked.ariaLabel,
        href: (el as HTMLAnchorElement).href || undefined,
        type: (el as HTMLInputElement).type || undefined,
        suggestedDataId: labelForSuggest ? `lgd-${labelForSuggest}` : undefined,
      });
    };

    function slugify(raw: string): string {
      return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
    }

    const nodes = document.querySelectorAll(
      'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="tab"], [formcontrolname], [data-testid], [data-id], p-button, p-select, p-checkbox, p-toggleswitch',
    );
    for (const node of Array.from(nodes)) {
      if (out.length >= MAX) break;
      push(node as HTMLElement);
    }

    return out;
  });

  return {
    url,
    path,
    title,
    elements: elements as LiveDomElement[],
  };
}

/** Format snapshots for the AI prompt (compact). */
export function formatLiveSnapshotsForPrompt(pages: LivePageSnapshot[]): string {
  if (!pages.length) return '(no live pages inspected)';
  const blocks: string[] = [];
  for (const page of pages) {
    const lines = [
      `### LIVE PAGE ${page.path}`,
      `url: ${page.url}`,
      `title: ${page.title || '—'}`,
    ];
    if (page.error) {
      lines.push(`error: ${page.error}`);
      blocks.push(lines.join('\n'));
      continue;
    }
    lines.push('interactive elements (prefer selector / dataTestId / dataId for click+fill):');
    for (const el of page.elements.slice(0, 60)) {
      const bits = [
        el.tag,
        el.dataTestId ? `data-testid=${el.dataTestId}` : '',
        el.dataId ? `data-id=${el.dataId}` : '',
        el.id ? `id=${el.id}` : '',
        el.formControlName ? `formControlName=${el.formControlName}` : '',
        el.text ? `text="${el.text}"` : '',
        el.placeholder ? `placeholder="${el.placeholder}"` : '',
        el.ariaLabel ? `aria-label="${el.ariaLabel}"` : '',
        `selector=${el.selector}`,
        el.suggestedDataId ? `suggested-data-id=${el.suggestedDataId}` : '',
      ].filter(Boolean);
      lines.push(`- ${bits.join(' | ')}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * Internal Playwright "MCP" inspect: open portal pages for the prompt,
 * optionally log in, and scrape real selectors / data-id / data-testid.
 */
export async function inspectPortalForGenerate(input: {
  baseUrl: string;
  prompt: string;
  role?: 'public' | 'buyer' | 'seller' | 'admin';
  credentials?: RoleCredentialsMap;
  /** When set, stream JPEG frames for MCP live view */
  inspectSessionId?: string;
  onProgress?: (message: string) => void;
}): Promise<LiveInspectResult> {
  const baseUrl = (input.baseUrl || '').trim();
  if (!baseUrl) {
    return {
      ok: false,
      pages: [],
      message: 'No portal URL — skipped live page inspect',
      inspectSessionId: input.inspectSessionId,
    };
  }

  const paths = inferInspectPaths(input.prompt, input.role);
  input.onProgress?.(
    `Opening live portal (${paths.length} page(s)): ${paths.join(', ')}…`,
  );

  let browser: Browser | undefined;
  let cdp: CDPSession | undefined;
  const pages: LivePageSnapshot[] = [];
  let loggedInAs: string | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    if (input.inspectSessionId) {
      cdp = await attachInspectScreencast(input.inspectSessionId, page);
    }

    try {
      loggedInAs = await maybeLogin(page, baseUrl, input.role, input.credentials);
      if (loggedInAs) {
        input.onProgress?.(`Logged in as ${loggedInAs} for live inspect`);
        await showLiveActionHighlight(page, {
          tone: 'info',
          title: `Logged in · ${loggedInAs}`,
          holdMs: 600,
        });
        await pushCrispInspectFrame(input.inspectSessionId, page);
        await clearLiveActionHighlight(page);
      } else if (input.role && input.role !== 'public') {
        input.onProgress?.(
          `No ${input.role} credentials — inspecting public/login pages only where possible`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      input.onProgress?.(`Live inspect login skipped: ${msg}`);
    }

    for (const path of paths) {
      input.onProgress?.(`Live view: ${path}`);
      try {
        await page.goto(resolveUrl(baseUrl, path), {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await page.waitForTimeout(700);
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);

        await showLiveActionHighlight(page, {
          tone: 'goto',
          title: `Inspecting ${path}`,
          detail: 'Reading buttons · inputs · data-id / selectors',
          holdMs: 500,
        });
        await pushCrispInspectFrame(input.inspectSessionId, page);

        const snap = await scrapePage(page);
        if (
          input.role &&
          input.role !== 'public' &&
          /\/login/i.test(snap.path) &&
          !/\/login/i.test(path)
        ) {
          snap.error = `Redirected to login (set ${input.role} credentials to inspect ${path})`;
        }

        if (snap.elements.length) {
          await showInspectElementHighlights(
            page,
            snap.elements.map((e) => ({
              selector: e.selector,
              text: e.text,
              suggestedDataId: e.suggestedDataId,
            })),
            `Capturing ${snap.elements.length} controls on ${path}`,
          );
          await pushCrispInspectFrame(input.inspectSessionId, page);
          await clearLiveActionHighlight(page);
        } else {
          await clearLiveActionHighlight(page);
        }

        pages.push(snap);
      } catch (err) {
        pages.push({
          url: resolveUrl(baseUrl, path),
          path,
          title: '',
          elements: [],
          error: err instanceof Error ? err.message : 'Failed to open page',
        });
      }
    }

    const elCount = pages.reduce((n, p) => n + p.elements.length, 0);
    return {
      ok: pages.some((p) => p.elements.length > 0),
      pages,
      loggedInAs,
      inspectSessionId: input.inspectSessionId,
      message: `Live inspected ${pages.length} page(s), ${elCount} interactive element(s)`,
    };
  } catch (err) {
    return {
      ok: false,
      pages,
      loggedInAs,
      inspectSessionId: input.inspectSessionId,
      message: err instanceof Error ? err.message : 'Live page inspect failed',
    };
  } finally {
    try {
      await cdp?.send('Page.stopScreencast').catch(() => undefined);
      await cdp?.detach().catch(() => undefined);
    } catch {
      // ignore
    }
    await browser?.close().catch(() => undefined);
  }
}
