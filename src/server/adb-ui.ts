import { execFile } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { androidSdkPaths } from '@/server/android-device';

export interface UiNode {
  text: string;
  contentDesc: string;
  resourceId: string;
  className: string;
  packageName: string;
  clickable: boolean;
  enabled: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  cx: number;
  cy: number;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeUiText(raw: string): string {
  return raw
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function runAdb(
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { adb } = androidSdkPaths();
  if (!existsSync(adb)) {
    return Promise.reject(new Error(`adb not found at ${adb}`));
  }
  return new Promise((resolve, reject) => {
    execFile(
      adb,
      args,
      { timeout: opts?.timeoutMs ?? 60_000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`adb not found: ${adb}`));
          return;
        }
        resolve({
          code: err ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

function parseBounds(raw: string): UiNode['bounds'] | null {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(raw);
  if (!m) return null;
  return {
    x1: Number(m[1]),
    y1: Number(m[2]),
    x2: Number(m[3]),
    y2: Number(m[4]),
  };
}

export function parseUiDump(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const re = /<node\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const attrs = match[1] || '';
    const get = (name: string) => {
      const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
      return m?.[1] || '';
    };
    const bounds = parseBounds(get('bounds'));
    if (!bounds) continue;
    nodes.push({
      text: decodeUiText(get('text')),
      contentDesc: decodeUiText(get('content-desc')),
      resourceId: get('resource-id'),
      className: get('class'),
      packageName: get('package'),
      clickable: get('clickable') === 'true',
      enabled: get('enabled') !== 'false',
      bounds,
      cx: Math.floor((bounds.x1 + bounds.x2) / 2),
      cy: Math.floor((bounds.y1 + bounds.y2) / 2),
    });
  }
  return nodes;
}

export async function dumpUi(): Promise<UiNode[]> {
  const remote = '/sdcard/lgd-ui-dump.xml';
  const local = join(tmpdir(), `lgd-ui-${Date.now()}.xml`);
  const dump = await runAdb(['shell', 'uiautomator', 'dump', remote], {
    timeoutMs: 25_000,
  });
  if (dump.code !== 0 && !/UI hierchary dumped|UI hierarchy dumped/i.test(dump.stdout + dump.stderr)) {
    throw new Error(`uiautomator dump failed: ${dump.stderr || dump.stdout || 'unknown'}`);
  }
  const pull = await runAdb(['pull', remote, local], { timeoutMs: 15_000 });
  if (pull.code !== 0) {
    throw new Error(`Failed to pull UI dump: ${pull.stderr || pull.stdout}`);
  }
  const xml = readFileSync(local, 'utf8');
  try {
    unlinkSync(local);
  } catch {
    // ignore
  }
  return parseUiDump(xml);
}

export async function getScreenSize(): Promise<{ w: number; h: number }> {
  const { stdout } = await runAdb(['shell', 'wm', 'size']);
  const m = /(\d+)x(\d+)/.exec(stdout);
  if (!m) return { w: 1080, h: 2400 };
  return { w: Number(m[1]), h: Number(m[2]) };
}

export async function tap(x: number, y: number): Promise<void> {
  await runAdb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
}

export async function tapNode(node: UiNode): Promise<void> {
  await tap(node.cx, node.cy);
}

export async function swipe(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 400,
): Promise<void> {
  await runAdb([
    'shell',
    'input',
    'swipe',
    String(Math.round(x1)),
    String(Math.round(y1)),
    String(Math.round(x2)),
    String(Math.round(y2)),
    String(durationMs),
  ]);
}

/** Swipe left to advance onboarding carousels. */
export async function swipeLeft(): Promise<void> {
  const { w, h } = await getScreenSize();
  const y = Math.floor(h * 0.45);
  await swipe(Math.floor(w * 0.82), y, Math.floor(w * 0.18), y, 450);
  await delay(800);
}

export async function pressKey(keycode: string | number): Promise<void> {
  await runAdb(['shell', 'input', 'keyevent', String(keycode)]);
}

export async function typeText(text: string): Promise<void> {
  const escaped = text.replace(/([\\' "`])/g, '\\$1').replace(/ /g, '%s');
  await runAdb(['shell', 'input', 'text', escaped]);
}

export function findByText(
  nodes: UiNode[],
  text: string | RegExp,
  opts?: { clickableOnly?: boolean },
): UiNode | undefined {
  return nodes.find((n) => {
    if (opts?.clickableOnly && !n.clickable) return false;
    if (typeof text === 'string') {
      return (
        n.text === text ||
        n.contentDesc === text ||
        n.text.toLowerCase() === text.toLowerCase() ||
        n.contentDesc.toLowerCase() === text.toLowerCase()
      );
    }
    return text.test(n.text) || text.test(n.contentDesc);
  });
}

export function findAllByText(nodes: UiNode[], text: string | RegExp): UiNode[] {
  return nodes.filter((n) => {
    if (typeof text === 'string') {
      return n.text === text || n.contentDesc === text;
    }
    return text.test(n.text) || text.test(n.contentDesc);
  });
}

export function findByResourceId(nodes: UiNode[], id: string): UiNode | undefined {
  return nodes.find((n) => n.resourceId === id || n.resourceId.endsWith(`/${id}`));
}

/** Label used for Flutter semantics (often content-desc only). */
export function nodeLabel(n: UiNode): string {
  return (n.contentDesc || n.text || '').trim();
}

export function visibleLabels(nodes: UiNode[]): string[] {
  return nodes.map(nodeLabel).filter(Boolean);
}

export function hasAnr(nodes: UiNode[]): boolean {
  return nodes.some(
    (n) =>
      /isn't responding/i.test(n.text) ||
      /isn't responding/i.test(n.contentDesc) ||
      /not responding/i.test(n.text) ||
      n.resourceId === 'android:id/aerr_wait' ||
      n.resourceId === 'android:id/aerr_close' ||
      n.resourceId === 'android:id/aerr_restart' ||
      n.resourceId === 'android:id/alertTitle' ||
      /^Wait$/i.test(n.text) ||
      /^Wait$/i.test(n.contentDesc) ||
      /^Close app$/i.test(n.text) ||
      /^Close app$/i.test(n.contentDesc),
  );
}

async function tapWaitZones(): Promise<void> {
  // Common Wait button band on 1080x2400 ANR dialog (never Close app above it)
  for (const [x, y] of [
    [540, 1327],
    [540, 1264],
    [540, 1390],
    [540, 1331],
  ] as const) {
    await tap(x, y);
    await delay(250);
  }
}

/**
 * Always prefer Wait — never Close app during a test flow
 * (Close app kills the target and blocks page navigation).
 */
export async function dismissAnrDialogs(
  onLog?: (msg: string) => void,
  attempts = 10,
): Promise<boolean> {
  let dismissed = false;

  for (let i = 0; i < attempts; i++) {
    let nodes: UiNode[] = [];
    try {
      nodes = await dumpUi();
    } catch {
      onLog?.(`UI dump blocked — tapping Wait zone (attempt ${i + 1})`);
      await tapWaitZones();
      dismissed = true;
      await delay(2000);
      continue;
    }

    if (!hasAnr(nodes)) {
      return dismissed;
    }

    const waitBtn =
      findByResourceId(nodes, 'android:id/aerr_wait') ||
      findByText(nodes, /^Wait$/i);

    if (waitBtn) {
      onLog?.(`ANR dialog — tapping Wait @ (${waitBtn.cx},${waitBtn.cy})`);
      // Never tap Close app (usually above Wait)
      await tap(waitBtn.cx, waitBtn.cy);
      await delay(400);
      await tap(waitBtn.cx, waitBtn.cy);
      dismissed = true;
      await delay(2500);
      continue;
    }

    onLog?.(`ANR text seen but Wait not parsed — blind Wait taps`);
    await tapWaitZones();
    dismissed = true;
    await delay(2000);
  }

  return dismissed;
}

/** Clear ANR until UI is interactive, then return a fresh dump. */
export async function ensureInteractiveUi(
  onLog?: (msg: string) => void,
): Promise<UiNode[]> {
  for (let i = 0; i < 10; i++) {
    await dismissAnrDialogs(onLog, 4);
    try {
      const nodes = await dumpUi();
      if (!hasAnr(nodes)) return nodes;
    } catch {
      await delay(1000);
    }
  }
  await dismissAnrDialogs(onLog, 4);
  return dumpUi().catch(() => [] as UiNode[]);
}

export async function waitForText(
  pattern: string | RegExp,
  opts?: { timeoutMs?: number; onLog?: (m: string) => void },
): Promise<UiNode> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = await ensureInteractiveUi(opts?.onLog);
    const hit = findByText(nodes, pattern);
    if (hit) return hit;
    await delay(1200);
  }
  throw new Error(
    `Timed out waiting for UI text: ${typeof pattern === 'string' ? pattern : pattern}`,
  );
}

export async function tapText(
  pattern: string | RegExp,
  opts?: { timeoutMs?: number; onLog?: (m: string) => void },
): Promise<void> {
  await waitForText(pattern, opts);
  const nodes = await ensureInteractiveUi(opts?.onLog);
  // Flutter: labels are often content-desc on non-clickable ImageView or clickable View
  const clickable =
    findByText(nodes, pattern, { clickableOnly: true }) || findByText(nodes, pattern);
  if (!clickable) throw new Error(`Could not tap text: ${pattern}`);
  opts?.onLog?.(
    `Tapping "${nodeLabel(clickable)}" @ (${clickable.cx},${clickable.cy})`,
  );
  // Single precise tap — double-tap can skip two onboarding pages
  await tap(clickable.cx, clickable.cy);
  await delay(900);
}

/**
 * Tap Flutter onboarding Continue / Get Started using content-desc bounds,
 * with bottom-CTA fallback (last page often has no separate button node).
 */
export async function tapContinueCta(onLog?: (m: string) => void): Promise<boolean> {
  const nodes = await ensureInteractiveUi(onLog);
  const cont =
    findByText(nodes, /^Continue$/i) ||
    findByText(nodes, /^Next$/i) ||
    findByText(nodes, /^Get Started$/i) ||
    nodes.find((n) => /^(Continue|Next|Get Started)$/i.test(nodeLabel(n)));

  // Prefer a compact bottom button, not the full-screen Flutter semantics node
  if (cont) {
    const h = cont.bounds.y2 - cont.bounds.y1;
    const fullScreen = h > 1800;
    if (!fullScreen) {
      onLog?.(
        `CTA "${nodeLabel(cont)}" @ (${cont.cx},${cont.cy}) bounds=[${cont.bounds.x1},${cont.bounds.y1}][${cont.bounds.x2},${cont.bounds.y2}]`,
      );
      await tap(cont.cx, cont.cy);
      await delay(1100);
      return true;
    }
  }

  const { w, h } = await getScreenSize();
  const x = Math.floor(w / 2);
  // Try primary button band used by this app (~84–91% height on 1080x2400)
  const ys = [
    Math.floor(h * 0.868), // Continue (~2085)
    Math.floor(h * 0.896), // Get Started (~2150)
    Math.floor(h * 0.885),
    Math.floor(h * 0.91),
    Math.floor(h * 0.85),
  ];
  for (const y of ys) {
    onLog?.(`Bottom CTA tap @ (${x},${y})`);
    await tap(x, y);
    await delay(900);
    const after = await dumpUi().catch(() => [] as UiNode[]);
    if (!hasAnr(after)) {
      const labels = visibleLabels(after).join(' ');
      // Left onboarding last page or Continue carousel advanced
      if (
        !/Backed by|Lifetime Buyback|Doorstep Delivery|Experience Perfection/i.test(labels) ||
        /Sign up|Log in|Login|email|mobile/i.test(labels)
      ) {
        return true;
      }
      // Page title changed within onboarding
      const before = visibleLabels(nodes).join(' ');
      if (labels && before && labels !== before) return true;
    }
  }
  return true;
}

export async function currentFocusPackage(): Promise<string> {
  const { stdout } = await runAdb(['shell', 'dumpsys', 'window']);
  const m =
    /mCurrentFocus=Window\{[^ ]+ u0 ([^/\s}]+)/.exec(stdout) ||
    /mFocusedApp=.*? ([\w.]+)\//.exec(stdout);
  return m?.[1] || '';
}

export async function isPackageInstalled(packageName: string): Promise<boolean> {
  const { stdout } = await runAdb(['shell', 'pm', 'path', packageName]);
  return /package:/.test(stdout);
}

export async function uninstallPackage(
  packageName: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  onLog?.(`Uninstalling old app ${packageName}…`);
  await runAdb(['uninstall', packageName], { timeoutMs: 60_000 });
  await delay(1000);
}

export async function isAppInForeground(packageName: string): Promise<boolean> {
  const focus = await currentFocusPackage();
  return (
    focus === packageName ||
    focus.startsWith(`${packageName}/`) ||
    focus.includes(packageName)
  );
}

export async function bringAppToForeground(
  packageName: string,
  activity?: string,
): Promise<'already-open' | 'started'> {
  if (await isAppInForeground(packageName)) {
    return 'already-open';
  }
  if (activity) {
    await runAdb(['shell', 'am', 'start', '-n', `${packageName}/${activity}`]);
  } else {
    await runAdb([
      'shell',
      'monkey',
      '-p',
      packageName,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ]);
  }
  await delay(3000);
  return 'started';
}

export async function relaunchApp(packageName: string, activity?: string): Promise<void> {
  await runAdb(['shell', 'am', 'force-stop', packageName]);
  await delay(1000);
  await bringAppToForeground(packageName, activity);
  await delay(2000);
}

export function writeDumpDebug(xml: string, name = 'last-ui.xml') {
  writeFileSync(join(process.cwd(), 'data', name), xml);
}
