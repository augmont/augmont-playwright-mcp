import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { randomUUID } from 'crypto';
import type { RoleCredentialsMap } from '@/lib/role-credentials';
import {
  attachInspectScreencast,
  formatLiveSnapshotsForPrompt,
  inferInspectPaths,
  loginWithCreds,
  maybeLogin,
  pushCrispInspectFrame,
  resolvePortalUrl,
  scrapePage,
  type LiveDomElement,
  type LivePageSnapshot,
} from '@/server/live-page-inspect';
import {
  clearLiveActionHighlight,
  showLiveActionHighlight,
} from '@/server/live-highlight';
import { createInspectSession, endInspectSession } from '@/server/inspect-session';

export type RecordedAction =
  | 'goto'
  | 'click'
  | 'fill'
  | 'press'
  | 'scroll'
  | 'assertVisible'
  | 'assertUrl'
  | 'page';

export type RecordedEvent = {
  id: string;
  at: string;
  action: RecordedAction;
  label: string;
  url?: string;
  path?: string;
  selector?: string;
  text?: string;
  value?: string;
  tag?: string;
  dataId?: string;
  dataTestId?: string;
  pageTitle?: string;
  /** Normalized click position (0–1) relative to viewport */
  x?: number;
  y?: number;
};

export type RecordSessionStatus = 'starting' | 'recording' | 'generating' | 'closed' | 'error';

type RecordSession = {
  id: string;
  baseUrl: string;
  role?: 'public' | 'buyer' | 'seller' | 'admin';
  status: RecordSessionStatus;
  createdAt: number;
  events: RecordedEvent[];
  pagesScraped: LivePageSnapshot[];
  loggedInAs?: string;
  error?: string;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  cdp?: CDPSession;
  viewport: { width: number; height: number };
  /** Last input/control clicked — used when user types without a selector */
  lastFocusedSelector?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __lgdRecordSessions: Map<string, RecordSession> | undefined;
}

function store(): Map<string, RecordSession> {
  if (!globalThis.__lgdRecordSessions) {
    globalThis.__lgdRecordSessions = new Map();
  }
  return globalThis.__lgdRecordSessions;
}

function pruneStale() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, s] of store()) {
    if (s.createdAt < cutoff || s.status === 'closed') {
      void closeRecordSession(id).catch(() => undefined);
    }
  }
}

function pushEvent(session: RecordSession, partial: Omit<RecordedEvent, 'id' | 'at'>) {
  const event: RecordedEvent = {
    id: `ev-${session.events.length + 1}-${randomUUID().slice(0, 6)}`,
    at: new Date().toISOString(),
    ...partial,
  };
  session.events.push(event);
  return event;
}

async function elementAtPoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ px, py }) => {
      const cssEscape = (s: string) => {
        if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
        return s.replace(/["\\]/g, '\\$&');
      };

      const el = document.elementFromPoint(px, py) as HTMLElement | null;
      if (!el) return null;

      let target: HTMLElement = el;
      const interactive = el.closest(
        'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="tab"], [formcontrolname], [data-testid], [data-id], p-button, label',
      ) as HTMLElement | null;
      if (interactive) target = interactive;

      const dataTestId =
        target.getAttribute('data-testid') ||
        target.getAttribute('data-test-id') ||
        undefined;
      const dataId = target.getAttribute('data-id') || undefined;
      const id = target.id || undefined;
      const formControlName =
        target.getAttribute('formcontrolname') ||
        target.getAttribute('ng-reflect-name') ||
        undefined;
      const ariaLabel = target.getAttribute('aria-label') || undefined;
      const placeholder =
        (target as HTMLInputElement).placeholder ||
        target.getAttribute('placeholder') ||
        undefined;
      const type = (target as HTMLInputElement).type || undefined;
      const href = (target as HTMLAnchorElement).href || undefined;
      const text = (target.innerText || target.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

      let selector = '';
      if (dataTestId) selector = `[data-testid="${cssEscape(dataTestId)}"]`;
      else if (dataId) selector = `[data-id="${cssEscape(dataId)}"]`;
      else if (id && !/^[0-9]/.test(id) && !id.includes(' ')) {
        selector = `#${cssEscape(id)}`;
      } else if (formControlName) {
        selector = `[formControlName="${cssEscape(formControlName)}"]`;
      } else if (ariaLabel) {
        selector = `[aria-label="${cssEscape(ariaLabel)}"]`;
      } else {
        const classes = [...target.classList]
          .filter(
            (c) =>
              c &&
              !/^(ng-|p-|cdk-|mat-|flex|grid|text-|bg-|w-|h-|m[trblxy]?-|p[trblxy]?-|gap-|rounded|border|cursor|absolute|relative|block|inline|hidden|opacity)/i.test(
                c,
              ),
          )
          .slice(0, 2);
        selector = classes.length
          ? `${target.tagName.toLowerCase()}.${classes.map(cssEscape).join('.')}`
          : target.tagName.toLowerCase();
      }

      return {
        tag: target.tagName.toLowerCase(),
        selector,
        text: text || undefined,
        dataTestId,
        dataId,
        id,
        formControlName,
        ariaLabel,
        placeholder,
        type,
        href,
        isInput:
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          !!formControlName,
      };
    },
    { px: x, py: y },
  );
}

async function capturePageMeta(session: RecordSession, forceEvent = false) {
  const page = session.page;
  if (!page) return;
  const url = page.url();
  let path = '/';
  try {
    path = new URL(url).pathname || '/';
  } catch {
    // keep
  }
  const title = await page.title().catch(() => '');
  const lastPage = [...session.events].reverse().find((e) => e.action === 'page');
  if (forceEvent || !lastPage || lastPage.path !== path || lastPage.url !== url) {
    pushEvent(session, {
      action: 'page',
      label: `Page · ${path}`,
      url,
      path,
      pageTitle: title,
    });
  }
  try {
    const snap = await scrapePage(page);
    const existingIdx = session.pagesScraped.findIndex((p) => p.path === snap.path);
    if (existingIdx >= 0) session.pagesScraped[existingIdx] = snap;
    else session.pagesScraped.push(snap);
  } catch {
    // ignore scrape errors during recording
  }
}

export function getRecordSession(id: string): RecordSession | undefined {
  return store().get(id);
}

export function listRecordEvents(id: string): RecordedEvent[] {
  return store().get(id)?.events.slice() || [];
}

export type StartRecordInput = {
  baseUrl: string;
  role?: 'public' | 'buyer' | 'seller' | 'admin';
  credentials?: RoleCredentialsMap;
  /** Optional starting path override */
  startPath?: string;
  /** Prompt/name used to infer start path when startPath omitted */
  hint?: string;
  onProgress?: (message: string) => void;
};

export async function startRecordSession(
  input: StartRecordInput,
): Promise<{ sessionId: string; startPath: string; loggedInAs?: string }> {
  pruneStale();
  const baseUrl = (input.baseUrl || '').trim();
  if (!baseUrl) throw new Error('baseUrl is required');

  const sessionId = createInspectSession('mcp-click-flow');
  const viewport = { width: 1280, height: 800 };
  const session: RecordSession = {
    id: sessionId,
    baseUrl,
    role: input.role,
    status: 'starting',
    createdAt: Date.now(),
    events: [],
    pagesScraped: [],
    viewport,
  };
  store().set(sessionId, session);

  const paths = inferInspectPaths(input.hint || input.role || 'home', input.role);
  const startPath =
    (input.startPath || '').trim() ||
    paths[0] ||
    (input.role === 'buyer'
      ? '/buyer'
      : input.role === 'admin'
        ? '/admin'
        : input.role === 'seller'
          ? '/seller'
          : '/');

  try {
    input.onProgress?.('Launching MCP browser for click-flow capture…');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    session.browser = browser;
    session.context = context;
    session.page = page;
    session.cdp = await attachInspectScreencast(sessionId, page);

    try {
      session.loggedInAs = await maybeLogin(page, baseUrl, input.role, input.credentials);
      if (session.loggedInAs) {
        input.onProgress?.(`Logged in as ${session.loggedInAs}`);
        await showLiveActionHighlight(page, {
          tone: 'info',
          title: `Logged in · ${session.loggedInAs}`,
          holdMs: 500,
        });
        await pushCrispInspectFrame(sessionId, page);
        await clearLiveActionHighlight(page);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      input.onProgress?.(`Login skipped: ${msg}`);
    }

    input.onProgress?.(`Opening ${startPath}…`);
    await page.goto(resolvePortalUrl(baseUrl, startPath), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);

    pushEvent(session, {
      action: 'goto',
      label: `Open ${startPath}`,
      url: startPath,
      path: startPath,
    });
    await capturePageMeta(session, true);
    await pushCrispInspectFrame(sessionId, page);

    session.status = 'recording';
    input.onProgress?.('MCP click-flow ready — click the live view to capture steps');
    return { sessionId, startPath, loggedInAs: session.loggedInAs };
  } catch (err) {
    session.status = 'error';
    session.error = err instanceof Error ? err.message : 'Failed to start recording';
    await closeRecordSession(sessionId).catch(() => undefined);
    throw err;
  }
}

export type RecordActionInput =
  | {
      type: 'click';
      /** Normalized 0–1 relative to the displayed frame */
      nx: number;
      ny: number;
    }
  | { type: 'fill'; value: string; selector?: string }
  /** Type without clearing (append) into focused / selector field */
  | { type: 'type'; text: string; selector?: string }
  | { type: 'press'; key: string }
  | { type: 'goto'; url: string }
  | { type: 'scroll'; dy?: number; dx?: number }
  | { type: 'scrape' }
  /** Go to /login, fill email+password, submit — records steps for test generation */
  | { type: 'login'; email: string; password: string; role?: string };

export async function applyRecordAction(
  sessionId: string,
  action: RecordActionInput,
): Promise<{ event?: RecordedEvent; events: RecordedEvent[]; url: string }> {
  const session = store().get(sessionId);
  if (!session || !session.page) {
    throw new Error('Recording session not found or already closed');
  }
  if (session.status !== 'recording') {
    throw new Error(`Session is not recording (status: ${session.status})`);
  }

  const page = session.page;
  let event: RecordedEvent | undefined;

  if (action.type === 'click') {
    const nx = Math.min(1, Math.max(0, action.nx));
    const ny = Math.min(1, Math.max(0, action.ny));
    const x = Math.round(nx * session.viewport.width);
    const y = Math.round(ny * session.viewport.height);
    const hit = await elementAtPoint(page, x, y);

    await showLiveActionHighlight(page, {
      tone: 'click',
      title: hit?.text || hit?.selector || 'Click',
      detail: hit?.selector,
      selector: hit?.selector,
      holdMs: 350,
    }).catch(() => undefined);

    await page.mouse.click(x, y);
    await page.waitForTimeout(350);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
    await clearLiveActionHighlight(page).catch(() => undefined);

    const labelBits = [
      hit?.text || hit?.ariaLabel || hit?.placeholder || hit?.tag || 'element',
      hit?.selector ? `(${hit.selector})` : '',
    ]
      .filter(Boolean)
      .join(' ');

    event = pushEvent(session, {
      action: 'click',
      label: `Click ${labelBits}`.trim(),
      selector: hit?.selector,
      text: hit?.text || hit?.ariaLabel,
      tag: hit?.tag,
      dataId: hit?.dataId,
      dataTestId: hit?.dataTestId,
      x: nx,
      y: ny,
      url: page.url(),
      path: (() => {
        try {
          return new URL(page.url()).pathname;
        } catch {
          return undefined;
        }
      })(),
    });

    session.lastFocusedSelector = hit?.isInput ? hit.selector : undefined;

    await capturePageMeta(session);
  } else if (action.type === 'fill') {
    const value = action.value;
    const sel = (action.selector || session.lastFocusedSelector || '').trim();
    if (sel) {
      await page.locator(sel).first().fill(value, { timeout: 8000 });
    } else {
      await page.keyboard.type(value, { delay: 20 });
    }
    await showLiveActionHighlight(page, {
      tone: 'fill',
      title: 'Fill',
      detail: value.slice(0, 40),
      selector: sel || undefined,
      holdMs: 300,
    }).catch(() => undefined);
    await pushCrispInspectFrame(sessionId, page);
    await clearLiveActionHighlight(page).catch(() => undefined);

    event = pushEvent(session, {
      action: 'fill',
      label: `Fill ${sel || 'focused input'} → ${value.slice(0, 40)}`,
      selector: sel || undefined,
      value,
    });
  } else if (action.type === 'type') {
    const text = action.text;
    const sel = (action.selector || session.lastFocusedSelector || '').trim();
    if (sel) {
      await page.locator(sel).first().focus({ timeout: 5000 }).catch(() => undefined);
    }
    await page.keyboard.type(text, { delay: 25 });
    await pushCrispInspectFrame(sessionId, page);
    event = pushEvent(session, {
      action: 'fill',
      label: `Type into ${sel || 'focused field'} → ${text.slice(0, 40)}`,
      selector: sel || undefined,
      value: text,
    });
  } else if (action.type === 'press') {
    await page.keyboard.press(action.key);
    event = pushEvent(session, {
      action: 'press',
      label: `Press ${action.key}`,
      value: action.key,
    });
    await page.waitForTimeout(200);
  } else if (action.type === 'goto') {
    const target = action.url.trim();
    const path = target.startsWith('http')
      ? (() => {
          try {
            return new URL(target).pathname;
          } catch {
            return target;
          }
        })()
      : target.startsWith('/')
        ? target
        : `/${target}`;
    await page.goto(resolvePortalUrl(session.baseUrl, target), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    event = pushEvent(session, {
      action: 'goto',
      label: `Go to ${path}`,
      url: path,
      path,
    });
    await capturePageMeta(session);
  } else if (action.type === 'scroll') {
    const dy = action.dy ?? 400;
    const dx = action.dx ?? 0;
    await page.mouse.wheel(dx, dy);
    event = pushEvent(session, {
      action: 'scroll',
      label: `Scroll ${dy > 0 ? 'down' : 'up'}`,
      value: String(dy),
    });
    await page.waitForTimeout(200);
  } else if (action.type === 'scrape') {
    await capturePageMeta(session);
  } else if (action.type === 'login') {
    const email = (action.email || '').trim();
    const password = action.password || '';
    if (!email || !password) {
      throw new Error('Email and password are required for MCP login');
    }
    const roleLabel = action.role || session.role || 'user';

    pushEvent(session, {
      action: 'goto',
      label: 'Open /login',
      url: '/login',
      path: '/login',
    });
    pushEvent(session, {
      action: 'fill',
      label: `Fill email/mobile → ${email}`,
      selector: '#mobileNumber, [formControlName="mobileNumber"]',
      value: email,
      text: 'Email / mobile',
    });
    pushEvent(session, {
      action: 'fill',
      label: 'Fill password',
      selector: '[formControlName="password"] input, #password, input[type="password"]',
      value: password,
      text: 'Password',
    });
    pushEvent(session, {
      action: 'click',
      label: 'Click Log in',
      text: 'Log in',
      selector: 'button',
    });

    await showLiveActionHighlight(page, {
      tone: 'info',
      title: `Logging in · ${roleLabel}`,
      detail: email,
      holdMs: 400,
    }).catch(() => undefined);
    await loginWithCreds(page, session.baseUrl, email, password);
    session.loggedInAs = `${roleLabel}:${email}`;
    await pushCrispInspectFrame(sessionId, page);
    await clearLiveActionHighlight(page).catch(() => undefined);
    await capturePageMeta(session, true);
    event = pushEvent(session, {
      action: 'assertUrl',
      label: `Logged in as ${email}`,
      path: (() => {
        try {
          return new URL(page.url()).pathname;
        } catch {
          return undefined;
        }
      })(),
      url: page.url(),
      text: email,
    });
  }

  await pushCrispInspectFrame(sessionId, page);
  return { event, events: session.events.slice(), url: page.url() };
}

export function formatRecordedFlowForPrompt(session: RecordSession): string {
  const lines: string[] = [
    '### RECORDED MCP CLICK FLOW (user-driven — convert into accurate test steps)',
    `role: ${session.role || 'public'}`,
    `events: ${session.events.length}`,
    '',
    'Captured sequence (use these selectors/text/urls exactly when possible):',
  ];

  for (const [i, ev] of session.events.entries()) {
    if (ev.action === 'page') {
      lines.push(
        `${i + 1}. [page] path=${ev.path || '?'} title="${ev.pageTitle || ''}" url=${ev.url || ''}`,
      );
      continue;
    }
    const bits = [
      ev.action,
      ev.selector ? `selector=${ev.selector}` : '',
      ev.text ? `text="${ev.text}"` : '',
      ev.value ? `value="${ev.value}"` : '',
      ev.dataId ? `data-id=${ev.dataId}` : '',
      ev.dataTestId ? `data-testid=${ev.dataTestId}` : '',
      ev.url && ev.action === 'goto' ? `url=${ev.url}` : '',
      ev.path ? `path=${ev.path}` : '',
    ].filter(Boolean);
    lines.push(`${i + 1}. ${bits.join(' | ')}  — ${ev.label}`);
  }

  if (session.pagesScraped.length) {
    lines.push('', formatLiveSnapshotsForPrompt(session.pagesScraped));
  }

  return lines.join('\n');
}

export function getRecordedFlowSnapshot(sessionId: string): string | undefined {
  const session = store().get(sessionId);
  if (!session) return undefined;
  return formatRecordedFlowForPrompt(session);
}

export async function closeRecordSession(sessionId: string): Promise<void> {
  const session = store().get(sessionId);
  if (!session) {
    endInspectSession(sessionId);
    return;
  }
  session.status = 'closed';
  try {
    await session.cdp?.send('Page.stopScreencast').catch(() => undefined);
    await session.cdp?.detach().catch(() => undefined);
  } catch {
    // ignore
  }
  await session.browser?.close().catch(() => undefined);
  session.browser = undefined;
  session.context = undefined;
  session.page = undefined;
  session.cdp = undefined;
  endInspectSession(sessionId);
  store().delete(sessionId);
}

export function recordSessionPublicState(sessionId: string) {
  const s = store().get(sessionId);
  if (!s) return null;
  return {
    sessionId: s.id,
    status: s.status,
    role: s.role,
    baseUrl: s.baseUrl,
    loggedInAs: s.loggedInAs,
    error: s.error,
    eventCount: s.events.length,
    events: s.events,
    pages: s.pagesScraped.map((p) => ({
      path: p.path,
      url: p.url,
      title: p.title,
      elementCount: p.elements.length,
      error: p.error,
    })),
    currentUrl: s.page?.url(),
    lastFocusedSelector: s.lastFocusedSelector,
  };
}

export type { LiveDomElement, LivePageSnapshot };
