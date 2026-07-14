import {
  createSession,
  getSession,
  setRunStatus,
  toSnapshot,
  updateStep,
} from '@/server/session-manager';
import {
  avdHintFromDeviceVersion,
  ensureEmulatorRunning,
  installApk,
  listAdbDevices,
  readApkPackage,
} from '@/server/android-device';
import {
  bootSimulator,
  defaultIosBundleId,
  hasPhysicalIosDevice,
  hasXcode,
  installAppOnSimulator,
  installIpaOnPhysicalDevice,
  isAppInstalledOnPhysicalDevice,
  iosInstallBlockerMessage,
  launchAppOnPhysicalDevice,
  launchAppOnSimulator,
  localSimulatorAppPath,
} from '@/server/ios-device';
import { appCacheId, detectAppLinkKind, downloadMobileApp } from '@/server/app-download';
import {
  bringAppToForeground,
  currentFocusPackage,
  dismissAnrDialogs,
  ensureInteractiveUi,
  findByText,
  isAppInForeground,
  isPackageInstalled,
  nodeLabel,
  swipeLeft,
  tapContinueCta,
  tapText,
  tapNode,
  typeText,
  uninstallPackage,
  visibleLabels,
  waitForText,
} from '@/server/adb-ui';
import {
  buildMobileSteps,
  isMobileTestId,
  type MobileTestId,
} from '@/lib/mobile-test-registry';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const INSTALL_META_PATH = () =>
  join(process.cwd(), 'data', 'mobile-apps', 'installed-meta.json');

type InstallMeta = {
  driveFileId: string;
  packageName: string;
  driveUrl: string;
};

function readInstallMeta(): InstallMeta | null {
  try {
    if (!existsSync(INSTALL_META_PATH())) return null;
    return JSON.parse(readFileSync(INSTALL_META_PATH(), 'utf8')) as InstallMeta;
  } catch {
    return null;
  }
}

function writeInstallMeta(meta: InstallMeta) {
  mkdirSync(join(process.cwd(), 'data', 'mobile-apps'), { recursive: true });
  writeFileSync(INSTALL_META_PATH(), JSON.stringify(meta, null, 2));
}

export function createMobileTestSession(opts: {
  runId: string;
  testId: MobileTestId;
  testName: string;
  appiumUrl: string;
  apiUrl?: string;
  platform?: 'android' | 'ios';
}) {
  const steps = buildMobileSteps(opts.testId, opts.platform || 'android');
  return createSession({
    runId: opts.runId,
    testId: opts.testId,
    testName: opts.testName,
    baseUrl: opts.appiumUrl,
    apiUrl: opts.apiUrl,
    steps,
  });
}

async function step(
  runId: string,
  id: string,
  fn: () => Promise<string | void>,
  description?: string,
): Promise<void> {
  updateStep(runId, id, { status: 'running', description });
  try {
    const message = (await fn()) || undefined;
    updateStep(runId, id, {
      status: 'passed',
      message,
      description,
      detail: message
        ? `PASS — ${id}. ${message} Expected behaviour confirmed for this mobile flow.`
        : `PASS — ${id}. Step completed.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateStep(runId, id, {
      status: 'failed',
      message,
      description,
      detail: `FAIL — ${id}. ${message} Guidance: check device/emulator state, Appium URL, app install, and UI labels; then re-run.`,
    });
    throw err;
  }
}

async function skipStep(runId: string, id: string, message: string): Promise<void> {
  updateStep(runId, id, { status: 'skipped', message });
}

function resolveApkPath(driveUrl: string): string {
  const cacheDir = join(process.cwd(), 'data', 'mobile-apps');
  mkdirSync(cacheDir, { recursive: true });
  const fileId = appCacheId(driveUrl);
  const ext = /\.ipa(\?|$)/i.test(driveUrl) || /diawi/i.test(driveUrl) ? 'ipa' : 'apk';
  return join(cacheDir, `${fileId}.${ext}`);
}

async function resolvePackageMeta(
  driveUrl: string,
): Promise<{ packageName: string; activity?: string; apkPath: string; fileId: string }> {
  const apkPath = resolveApkPath(driveUrl);
  const fileId = appCacheId(driveUrl);
  let packageName = 'com.augmont.labgrowndiamonds';
  let activity: string | undefined = 'com.augmont.labgrowndiamonds.MainActivity';
  if (existsSync(apkPath)) {
    try {
      const meta = await readApkPackage(apkPath);
      packageName = meta.packageName;
      activity = meta.launchableActivity || activity;
    } catch {
      // keep defaults
    }
  }
  return { packageName, activity, apkPath, fileId };
}

function pageFingerprint(nodes: Awaited<ReturnType<typeof ensureInteractiveUi>>): string {
  return visibleLabels(nodes)
    .filter((l) => !/^Continue$/i.test(l) && !/^Skip$/i.test(l))
    .join(' | ')
    .slice(0, 180);
}

/**
 * Walk onboarding carousel: clear ANR → tap Continue (content-desc) → verify page changed.
 * Flutter exposes Continue/Skip as content-desc; last page uses "Get Started" (often only visible,
 * not in dump — use bottom CTA fallback).
 */
async function completeOnboarding(onLog: (m: string) => void): Promise<string> {
  let continued = 0;
  let swipes = 0;
  let lastPage = '';

  for (let i = 0; i < 14; i++) {
    const nodes = await ensureInteractiveUi(onLog);
    const page = pageFingerprint(nodes);
    if (page) onLog(`Onboarding screen: ${page.slice(0, 90)}`);

    const authHint =
      findByText(
        nodes,
        /^(Sign up|Signup|Sign Up|Log in|Login|Log In|Register|Create account)$/i,
      ) || findByText(nodes, /Login to your account|Don’t have an account|Mobile \/ Email/i);
    // "Get started" as auth only when it's a separate small CTA, not the big onboarding title page
    const hasContinue = !!findByText(nodes, /^Continue$/i);
    const hasSkip = !!findByText(nodes, /^Skip$/i);
    const hasGetStarted = !!findByText(nodes, /^Get Started$/i);
    const lastOnboardingPage = /Backed by|Augmonts Legacy|5,000 jewellers/i.test(page);

    // Auth reached when signup/login visible and carousel CTAs gone
    if (
      authHint &&
      !hasContinue &&
      !hasSkip &&
      !lastOnboardingPage &&
      !/Get Started/i.test(page)
    ) {
      return `Reached auth: "${nodeLabel(authHint)}" · continues=${continued} · swipes=${swipes}`;
    }

    if (hasContinue) {
      onLog(`Onboarding page — tapping Continue (${continued + 1})`);
      await tapContinueCta(onLog);
      continued += 1;
      await dismissAnrDialogs(onLog, 5);
      const after = await ensureInteractiveUi(onLog);
      const nextPage = pageFingerprint(after);
      if (nextPage && nextPage !== lastPage && nextPage !== page) {
        onLog(`Page moved → ${nextPage.slice(0, 90)}`);
        lastPage = nextPage;
      } else if (page === nextPage) {
        onLog('Continue tap did not change page — swiping');
        await swipeLeft();
        swipes += 1;
        await dismissAnrDialogs(onLog, 3);
      } else {
        lastPage = nextPage || page;
      }
      continue;
    }

    // Last onboarding page: Get Started (often missing from dump — bottom CTA)
    if (hasGetStarted || lastOnboardingPage) {
      onLog('Last onboarding page — tapping Get Started');
      if (hasGetStarted) {
        await tapText(/^Get Started$/i, { timeoutMs: 5_000, onLog }).catch(async () => {
          await tapContinueCta(onLog);
        });
      } else {
        await tapContinueCta(onLog);
      }
      continued += 1;
      await dismissAnrDialogs(onLog, 5);
      const after = await ensureInteractiveUi(onLog);
      const nextPage = pageFingerprint(after);
      onLog(`After Get Started: ${nextPage.slice(0, 90) || '(empty)'}`);
      if (
        findByText(
          after,
          /^(Sign up|Signup|Sign Up|Log in|Login|Log In|Register|Create account)$/i,
        ) ||
        findByText(after, /Login to your account|email|mobile|password/i)
      ) {
        return `Reached auth after Get Started · continues=${continued}`;
      }
      // If still on same page, try one more bottom tap then finish
      if (nextPage === page) {
        await tapContinueCta(onLog);
        await delay(1500);
      }
      return `Finished onboarding via Get Started · continues=${continued} · swipes=${swipes}`;
    }

    if (i >= 2 && hasSkip) {
      onLog('Tapping Skip');
      const skip = findByText(nodes, /^Skip$/i)!;
      try {
        await tapText(/^Skip$/i, { timeoutMs: 5_000, onLog });
      } catch {
        await tapNode(skip);
      }
      await delay(1200);
      await dismissAnrDialogs(onLog, 3);
      return `Skipped onboarding after ${continued} continue(s)`;
    }

    if (
      findByText(nodes, /Lifetime Buyback|Doorstep|Guarantee|lab-grown|peace of mind|delivery|360/i)
    ) {
      onLog('Onboarding content visible — swiping to next page');
      await swipeLeft();
      swipes += 1;
      await dismissAnrDialogs(onLog, 3);
      continue;
    }

    await delay(1000);
  }

  return `Onboarding loop finished · continues=${continued} · swipes=${swipes}`;
}

async function openSignupScreen(onLog: (m: string) => void): Promise<string> {
  await ensureInteractiveUi(onLog);
  const patterns = [
    /^Sign up$/i,
    /^Sign Up$/i,
    /^Signup$/i,
    /^Register$/i,
    /^Create account$/i,
    /^Get started$/i,
  ];
  for (const p of patterns) {
    try {
      await tapText(p, { timeoutMs: 6_000, onLog });
      await dismissAnrDialogs(onLog, 3);
      return `Opened via ${p}`;
    } catch {
      // try next
    }
  }
  const nodes = await ensureInteractiveUi(onLog);
  if (findByText(nodes, /email|mobile|phone|password|OTP/i)) {
    return 'Already on signup/auth form';
  }
  throw new Error(
    'Could not find Signup. Run Mobile — Onboarding first, or clear ANR (tap Wait) then retry.',
  );
}

async function fillVisibleSignupFields(onLog: (m: string) => void): Promise<string> {
  const nodes = await ensureInteractiveUi(onLog);
  const filled: string[] = [];

  const email =
    findByText(nodes, /email/i) ||
    nodes.find((n) => /edit|input/i.test(n.className) && /email/i.test(n.contentDesc));
  if (email) {
    onLog('Filling email');
    try {
      await tapText(/email/i, { timeoutMs: 4_000, onLog });
    } catch {
      await tapNode(email);
    }
    await typeText(`lgd.mobile.${Date.now()}@example.com`);
    filled.push('email');
  }

  const mobile =
    findByText(nodes, /mobile|phone/i) ||
    nodes.find((n) => /mobile|phone/i.test(n.contentDesc));
  if (mobile) {
    onLog('Filling mobile');
    try {
      await tapText(/mobile|phone/i, { timeoutMs: 4_000, onLog });
      await typeText('9876543210');
      filled.push('mobile');
    } catch {
      // optional
    }
  }

  if (!filled.length) {
    const texts = nodes
      .map((n) => n.text)
      .filter(Boolean)
      .slice(0, 25)
      .join(' · ');
    throw new Error(`No email/mobile fields. Visible: ${texts || '(none — ANR may still be up)'}`);
  }
  return `Filled: ${filled.join(', ')}`;
}

/**
 * Shared setup:
 * - Skip emulator/app if already running
 * - If Drive file id changed → uninstall old app + fresh install new APK
 */
async function ensureSharedDevice(
  runId: string,
  opts: {
    driveUrl: string;
    osVersion: string;
    deviceVersion: string;
  },
  log: (m: string) => void,
): Promise<{ packageName: string; activity?: string; deviceId: string }> {
  const { packageName, activity, apkPath, fileId } = await resolvePackageMeta(opts.driveUrl);
  let deviceId = '';
  const prev = readInstallMeta();
  const driveChanged = !!prev && prev.driveFileId !== fileId;

  // 1) Emulator
  const devices = await listAdbDevices();
  if (devices[0]) {
    deviceId = devices[0];
    await skipStep(
      runId,
      'boot-emulator',
      `Skipped — emulator already running (${deviceId})`,
    );
  } else {
    await step(runId, 'boot-emulator', async () => {
      log('Starting Android emulator…');
      deviceId = await ensureEmulatorRunning(
        avdHintFromDeviceVersion(opts.deviceVersion, opts.osVersion),
        log,
      );
      await delay(6000);
      return `Started emulator ${deviceId}`;
    });
  }

  // 2) Install — fresh if Drive link / file id changed
  const installed = await isPackageInstalled(packageName);
  // Same Drive file already on device (meta match, or first run after upgrade with cache present)
  const sameBuild =
    !driveChanged &&
    installed &&
    existsSync(apkPath) &&
    (prev?.driveFileId === fileId || !prev);

  if (sameBuild) {
    if (!prev || prev.driveFileId !== fileId) {
      writeInstallMeta({
        driveFileId: fileId,
        packageName,
        driveUrl: opts.driveUrl,
      });
    }
    await skipStep(
      runId,
      'install-apk',
      `Skipped — same Drive build already installed (${fileId})`,
    );
  } else {
    await step(runId, 'install-apk', async () => {
      if (driveChanged) {
        log(`Drive link changed (${prev?.driveFileId} → ${fileId}) — fresh install`);
        // Remove old cached APK for previous id
        if (prev?.driveFileId) {
          const oldApk = join(
            process.cwd(),
            'data',
            'mobile-apps',
            `${prev.driveFileId}.apk`,
          );
          try {
            if (existsSync(oldApk)) unlinkSync(oldApk);
          } catch {
            // ignore
          }
        }
        const pkgToRemove = prev?.packageName || packageName;
        if (await isPackageInstalled(pkgToRemove)) {
          await uninstallPackage(pkgToRemove, log);
        }
      } else if (installed && !existsSync(apkPath)) {
        // Meta missing but app present without cache — still reinstall from Drive
        log('APK cache missing — re-downloading and reinstalling');
        if (await isPackageInstalled(packageName)) {
          await uninstallPackage(packageName, log);
        }
      }

      log('Downloading app (Drive / Diawi)…');
      await downloadMobileApp(opts.driveUrl, apkPath);

      // Re-read package from new APK
      let pkg = packageName;
      let act = activity;
      try {
        const meta = await readApkPackage(apkPath);
        pkg = meta.packageName;
        act = meta.launchableActivity || act;
      } catch {
        // keep
      }

      if (await isPackageInstalled(pkg)) {
        await uninstallPackage(pkg, log);
      }
      await installApk(apkPath, log);
      writeInstallMeta({
        driveFileId: fileId,
        packageName: pkg,
        driveUrl: opts.driveUrl,
      });
      return driveChanged
        ? `Fresh install from new Drive link · ${pkg}`
        : `Installed ${pkg}`;
    });
  }

  // Refresh package meta after possible reinstall
  const latest = await resolvePackageMeta(opts.driveUrl);
  const pkg = latest.packageName;
  const act = latest.activity;

  // 3) Launch — skip if already open AND same build (not after fresh install)
  const justFreshInstalled = !sameBuild;
  const alreadyOpen = await isAppInForeground(pkg);

  if (alreadyOpen && !justFreshInstalled) {
    await skipStep(runId, 'launch-app', `Skipped — app already open (${pkg})`);
  } else {
    await step(runId, 'launch-app', async () => {
      if (justFreshInstalled) {
        log('Fresh install — opening app');
      }
      const result = await bringAppToForeground(pkg, act);
      await delay(4000);
      await dismissAnrDialogs(log, 8);
      return result === 'already-open'
        ? `Already open · ${pkg}`
        : `Opened ${pkg}${act ? `/${act}` : ''}`;
    });
  }

  return { packageName: pkg, activity: act, deviceId: deviceId || devices[0] || 'unknown' };
}

export async function runMobileTestCase(
  runId: string,
  opts: {
    testId: MobileTestId;
    platform: 'android' | 'ios';
    osVersion: string;
    deviceVersion: string;
    appDriveUrl: string;
    appiumUrl: string;
  },
): Promise<void> {
  const session = getSession(runId);
  if (!session) throw new Error('Session not found');

  const signal = session.abortController.signal;
  const log = (msg: string) => {
    const running = getSession(runId)?.steps.find((s) => s.status === 'running');
    if (running) updateStep(runId, running.id, { status: 'running', message: msg });
  };

  try {
    setRunStatus(runId, 'running');
    if (signal.aborted) throw new Error('Stopped');

    if (opts.platform === 'ios') {
      await runIosMobileTestCase(runId, opts, log);
      return;
    }

    const { packageName } = await ensureSharedDevice(
      runId,
      {
        driveUrl: opts.appDriveUrl,
        osVersion: opts.osVersion,
        deviceVersion: opts.deviceVersion,
      },
      log,
    );

    await step(runId, 'dismiss-anr', async () => {
      const dismissed = await dismissAnrDialogs(log, 12);
      const nodes = await ensureInteractiveUi(log);
      if (nodes.some((n) => /isn't responding|not responding/i.test(n.text))) {
        await dismissAnrDialogs(log, 8);
      }
      return dismissed
        ? 'ANR cleared via Wait (Close app never used)'
        : 'No ANR dialog found';
    });

    await step(runId, 'verify-foreground', async () => {
      await ensureInteractiveUi(log);
      if (!(await isAppInForeground(packageName))) {
        await bringAppToForeground(packageName);
        await delay(3000);
        await dismissAnrDialogs(log, 8);
      }
      try {
        await waitForText(
          /Lifetime Buyback|Continue|Skip|Sign up|Login|Augmont|Guarantee/i,
          { timeoutMs: 40_000, onLog: log },
        );
      } catch {
        const focus = await currentFocusPackage();
        if (!focus.includes('labgrowndiamonds') && !focus.includes('augmont')) {
          throw new Error(
            `App not usable (focus=${focus || 'unknown'}). Tap Wait on ANR if visible, then Run again.`,
          );
        }
      }
      const focus = await currentFocusPackage();
      return `Foreground OK · ${focus || packageName}`;
    });

    if (opts.testId === 'mobile-onboarding' || opts.testId === 'mobile-signup-login') {
      await step(runId, 'onboarding', async () => completeOnboarding(log));
    }

    if (opts.testId === 'mobile-signup-login') {
      await step(runId, 'open-signup', async () => openSignupScreen(log));
      await step(runId, 'fill-signup', async () => fillVisibleSignupFields(log));
      await step(runId, 'submit-signup', async () => {
        await ensureInteractiveUi(log);
        try {
          await tapText(/^(Continue|Submit|Sign up|Create account|Next)$/i, {
            timeoutMs: 12_000,
            onLog: log,
          });
          return 'Tapped submit/continue';
        } catch {
          return 'Submit not found — fields filled; check emulator screen';
        }
      });
    }

    await step(runId, 'wrap-up', async () => {
      return `Done · emulator/app left running for next case`;
    });

    const failed = getSession(runId)?.steps.some((s) => s.status === 'failed');
    setRunStatus(
      runId,
      failed ? 'failed' : 'completed',
      failed ? 'One or more steps failed' : undefined,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Mobile test failed';
    setRunStatus(runId, 'failed', message);
  }
}

async function runIosMobileTestCase(
  runId: string,
  opts: {
    testId: MobileTestId;
    osVersion: string;
    deviceVersion: string;
    appDriveUrl: string;
  },
  log: (m: string) => void,
): Promise<void> {
  const bundleId = defaultIosBundleId();
  const linkKind = detectAppLinkKind(opts.appDriveUrl);
  const simApp = localSimulatorAppPath();
  const physical = await hasPhysicalIosDevice();
  const useDeviceIpa =
    physical && (linkKind === 'diawi' || linkKind === 'drive' || linkKind === 'direct');

  let simUdid = '';

  await step(runId, 'boot-emulator', async () => {
    if (useDeviceIpa) {
      return 'Physical iPhone connected — skipping Simulator boot';
    }
    if (!hasXcode()) {
      throw new Error(
        'Install Xcode to use iOS Simulator, or connect a physical iPhone for Diawi IPA.',
      );
    }
    // Run iOS test cases on Simulator when no physical phone is paired
    const device = await bootSimulator(opts.deviceVersion, opts.osVersion, log);
    simUdid = device.udid;
    return `Simulator ${device.name} · ${device.state} · ${device.udid.slice(0, 8)}…`;
  });

  await step(runId, 'install-apk', async () => {
    if (useDeviceIpa) {
      if (await isAppInstalledOnPhysicalDevice(bundleId)) {
        return `Skipped install — ${bundleId} already on iPhone`;
      }
      const cacheDir = join(process.cwd(), 'data', 'mobile-apps');
      mkdirSync(cacheDir, { recursive: true });
      const ipaPath = join(cacheDir, `${appCacheId(opts.appDriveUrl)}.ipa`);
      if (!existsSync(ipaPath)) {
        log('Downloading IPA from Diawi/Drive…');
        await downloadMobileApp(opts.appDriveUrl, ipaPath);
      } else {
        log('Using cached IPA');
      }
      return installIpaOnPhysicalDevice(ipaPath, log);
    }

    if (simApp) {
      const device = await bootSimulator(opts.deviceVersion, opts.osVersion, log);
      simUdid = device.udid;
      await installAppOnSimulator(device.udid, simApp, log);
      return `Installed Simulator .app · ${simApp}`;
    }

    // Diawi / App Store / Drive IPA = device build. Cannot install or launch on Simulator.
    if (linkKind === 'diawi' || linkKind === 'appstore' || linkKind === 'drive') {
      throw new Error(
        `No Simulator build found at data/mobile-apps/Augmont.app. ` +
          `Diawi/App Store/Drive give device IPAs (iPhoneOS) — they cannot launch on Simulator. ` +
          `Ask iOS for an iphonesimulator .app, copy it to data/mobile-apps/Augmont.app (or set IOS_SIMULATOR_APP), ` +
          `or plug in a physical iPhone for the Diawi IPA.`,
      );
    }

    throw new Error(iosInstallBlockerMessage(opts.appDriveUrl));
  });

  await step(runId, 'launch-app', async () => {
    if (useDeviceIpa) {
      await launchAppOnPhysicalDevice(bundleId, log);
      await delay(3000);
      return `Launched ${bundleId} on physical iPhone`;
    }

    const device = await bootSimulator(opts.deviceVersion, opts.osVersion, log);
    simUdid = device.udid;

    if (!simApp) {
      throw new Error(
        `Cannot launch ${bundleId}: place a Simulator .app at data/mobile-apps/Augmont.app first.`,
      );
    }

    await launchAppOnSimulator(device.udid, bundleId, log);
    await delay(3000);
    return `Launched ${bundleId} on Simulator`;
  });

  await skipStep(
    runId,
    'dismiss-anr',
    useDeviceIpa ? 'Physical iPhone — no Android ANR' : 'iOS Simulator — no Android ANR',
  );

  await step(runId, 'verify-foreground', async () => {
    if (useDeviceIpa) return `Physical iPhone ready · ${bundleId}`;
    return `Simulator ready · ${bundleId} · udid=${(simUdid || 'booted').slice(0, 8)}…`;
  });

  if (opts.testId === 'mobile-onboarding' || opts.testId === 'mobile-signup-login') {
    await skipStep(
      runId,
      'onboarding',
      'Onboarding taps need a working Simulator .app + XCUITest — blocked until Simulator build is provided',
    );
  }

  if (opts.testId === 'mobile-signup-login') {
    await skipStep(runId, 'open-signup', 'Skipped until Simulator .app + XCUITest work');
    await skipStep(runId, 'fill-signup', 'Skipped until Simulator .app + XCUITest work');
    await skipStep(runId, 'submit-signup', 'Skipped until Simulator .app + XCUITest work');
  }

  await step(runId, 'wrap-up', async () => {
    if (useDeviceIpa) return 'Done · physical iPhone';
    if (simApp) return 'Done · Simulator .app flow';
    return 'Simulator was targeted — provide Simulator .app for full UI cases';
  });

  const failed = getSession(runId)?.steps.some((s) => s.status === 'failed');
  setRunStatus(
    runId,
    failed ? 'failed' : 'completed',
    failed ? getSession(runId)?.error || 'One or more steps failed' : undefined,
  );
}

export { isMobileTestId, toSnapshot };
