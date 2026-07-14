import { existsSync, readdirSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { createWriteStream, mkdirSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const SDK_ROOT =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  join(homedir(), 'Library/Android/sdk');

function sdkBin(...parts: string[]) {
  return join(SDK_ROOT, ...parts);
}

export function androidSdkPaths() {
  const adb = sdkBin('platform-tools', 'adb');
  const emulator = sdkBin('emulator', 'emulator');
  const buildToolsRoot = sdkBin('build-tools');
  let aapt = '';
  if (existsSync(buildToolsRoot)) {
    const versions = readdirSync(buildToolsRoot)
      .filter((v) => existsSync(join(buildToolsRoot, v, 'aapt')))
      .sort();
    if (versions.length) {
      aapt = join(buildToolsRoot, versions[versions.length - 1]!, 'aapt');
    }
  }
  return { sdkRoot: SDK_ROOT, adb, emulator, aapt };
}

function run(
  bin: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: opts?.timeoutMs ?? 120_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              `Command not found: ${bin}. Is Android SDK installed at ${SDK_ROOT}?`,
            ),
          );
          return;
        }
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? ((err as { code: number }).code)
            : err
              ? 1
              : 0;
        resolve({
          code,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

export function extractDriveFileId(url: string): string | null {
  const m1 = /\/file\/d\/([^/]+)/.exec(url);
  if (m1?.[1]) return m1[1];
  const m2 = /[?&]id=([^&]+)/.exec(url);
  if (m2?.[1]) return m2[1];
  return null;
}

export async function downloadDriveApk(driveUrl: string, destPath: string): Promise<string> {
  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) {
    throw new Error('Could not parse Google Drive file id from the URL.');
  }

  mkdirSync(join(destPath, '..'), { recursive: true });

  const firstUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  let res = await fetch(firstUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = await res.text();
    // Modern Drive warning page: form → drive.usercontent.google.com/download
    const action =
      /<form[^>]*id="download-form"[^>]*action="([^"]+)"/i.exec(html)?.[1] ||
      /action="(https:\/\/drive\.usercontent\.google\.com\/download)"/i.exec(html)?.[1];
    const id = /name="id"\s+value="([^"]+)"/i.exec(html)?.[1] || fileId;
    const confirm = /name="confirm"\s+value="([^"]+)"/i.exec(html)?.[1] || 't';
    const uuid = /name="uuid"\s+value="([^"]+)"/i.exec(html)?.[1];

    if (action) {
      const params = new URLSearchParams({
        id,
        export: 'download',
        confirm,
      });
      if (uuid) params.set('uuid', uuid);
      res = await fetch(`${action}?${params.toString()}`, {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
    } else {
      const legacyConfirm = /confirm=([0-9A-Za-z_]+)/.exec(html)?.[1];
      if (legacyConfirm) {
        res = await fetch(
          `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${legacyConfirm}`,
          { redirect: 'follow' },
        );
      } else {
        throw new Error(
          'Google Drive blocked automatic download (virus scan / login). Share as “Anyone with the link” or host the APK on a direct URL.',
        );
      }
    }
  }

  const finalType = res.headers.get('content-type') || '';
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download APK from Drive (HTTP ${res.status}).`);
  }
  if (finalType.includes('text/html')) {
    throw new Error(
      'Google Drive still returned HTML instead of the APK. Make sure the file is shared publicly (“Anyone with the link”).',
    );
  }

  const nodeStream = Readable.fromWeb(
    res.body as import('stream/web').ReadableStream,
  );
  await pipeline(nodeStream, createWriteStream(destPath));

  const stat = await fs.stat(destPath);
  if (stat.size < 50_000) {
    const head = await fs.readFile(destPath, 'utf8').catch(() => '');
    if (head.includes('<!DOCTYPE') || head.includes('<html')) {
      await fs.unlink(destPath).catch(() => undefined);
      throw new Error(
        'Download looked like HTML, not an APK. Check Drive sharing permissions.',
      );
    }
  }

  return destPath;
}

export async function listAvds(): Promise<string[]> {
  const { emulator } = androidSdkPaths();
  if (!existsSync(emulator)) return [];
  const { stdout } = await run(emulator, ['-list-avds']);
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function listAdbDevices(): Promise<string[]> {
  const { adb } = androidSdkPaths();
  if (!existsSync(adb)) {
    throw new Error(`adb not found at ${adb}`);
  }
  const { stdout } = await run(adb, ['devices']);
  return stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0]!)
    .filter(Boolean);
}

export async function ensureEmulatorRunning(
  preferredAvd?: string,
  onLog?: (msg: string) => void,
): Promise<string> {
  const { adb, emulator } = androidSdkPaths();
  const existing = await listAdbDevices();
  if (existing[0]) {
    onLog?.(`Emulator already running: ${existing[0]}`);
    return existing[0];
  }

  if (!existsSync(emulator)) {
    throw new Error(
      `Android emulator not found at ${emulator}. Install Android Studio SDK emulator.`,
    );
  }

  const avds = await listAvds();
  if (!avds.length) {
    throw new Error(
      'No Android Virtual Devices found. Create one in Android Studio → Device Manager.',
    );
  }

  const avd =
    (preferredAvd && avds.includes(preferredAvd) ? preferredAvd : null) ||
    avds.find((a) => /medium|pixel|phone/i.test(a)) ||
    avds[0]!;

  onLog?.(`Starting AVD: ${avd}`);
  const child = spawn(
    emulator,
    ['-avd', avd, '-netdelay', 'none', '-netspeed', 'full'],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ANDROID_HOME: SDK_ROOT,
        ANDROID_SDK_ROOT: SDK_ROOT,
      },
    },
  );
  child.unref();

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await run(adb, ['wait-for-device'], { timeoutMs: 5000 });
      const boot = await run(adb, ['shell', 'getprop', 'sys.boot_completed'], {
        timeoutMs: 5000,
      });
      if (boot.stdout.trim() === '1') {
        const devices = await listAdbDevices();
        if (devices[0]) {
          onLog?.(`Emulator ready: ${devices[0]}`);
          return devices[0];
        }
      }
    } catch {
      // still booting
    }
    onLog?.('Waiting for emulator boot…');
  }

  throw new Error('Emulator started but did not become ready within 3 minutes.');
}

export async function installApk(
  apkPath: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  const { adb } = androidSdkPaths();
  onLog?.(`Installing APK…`);
  const result = await run(adb, ['install', '-r', apkPath], { timeoutMs: 180_000 });
  const out = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0 && !/Success/i.test(out)) {
    throw new Error(`adb install failed: ${out.trim() || 'unknown error'}`);
  }
  onLog?.('APK installed');
}

export async function readApkPackage(apkPath: string): Promise<{
  packageName: string;
  launchableActivity?: string;
}> {
  const { aapt } = androidSdkPaths();
  if (!aapt || !existsSync(aapt)) {
    throw new Error('aapt not found in Android build-tools.');
  }
  const { stdout } = await run(aapt, ['dump', 'badging', apkPath]);
  const pkg = /package: name='([^']+)'/.exec(stdout)?.[1];
  const activity = /launchable-activity: name='([^']+)'/.exec(stdout)?.[1];
  if (!pkg) throw new Error('Could not parse package name from APK.');
  return { packageName: pkg, launchableActivity: activity };
}

export async function launchApp(
  packageName: string,
  activity?: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  const { adb } = androidSdkPaths();
  if (activity) {
    onLog?.(`Launching ${packageName}/${activity}`);
    const r = await run(adb, ['shell', 'am', 'start', '-n', `${packageName}/${activity}`]);
    if (r.code !== 0) {
      throw new Error(`Failed to start activity: ${r.stderr || r.stdout}`);
    }
    return;
  }
  onLog?.(`Launching ${packageName}`);
  await run(adb, [
    'shell',
    'monkey',
    '-p',
    packageName,
    '-c',
    'android.intent.category.LAUNCHER',
    '1',
  ]);
}

export async function checkAppiumStatus(appiumUrl: string): Promise<boolean> {
  try {
    const base = appiumUrl.replace(/\/+$/, '');
    for (const url of [`${base}/status`, `${base}/wd/hub/status`]) {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    }
  } catch {
    // not running
  }
  return false;
}

export async function openAndroidAppFromDrive(opts: {
  driveUrl: string;
  appiumUrl: string;
  avdHint?: string;
  onLog?: (msg: string) => void;
  /** If true, only download+install — caller launches and handles ANR. */
  skipLaunch?: boolean;
}): Promise<{
  deviceId: string;
  apkPath: string;
  packageName: string;
  launchableActivity?: string;
  usedAppium: boolean;
}> {
  const { onLog } = opts;
  const cacheDir = join(process.cwd(), 'data', 'mobile-apps');
  mkdirSync(cacheDir, { recursive: true });
  const fileId = extractDriveFileId(opts.driveUrl) || 'app';
  const apkPath = join(cacheDir, `${fileId}.apk`);

  if (!existsSync(apkPath)) {
    onLog?.('Downloading APK from Google Drive…');
    await downloadDriveApk(opts.driveUrl, apkPath);
  } else {
    onLog?.('Using cached APK');
  }

  // Cold-ish boot: wait for full boot before install to reduce System UI ANR
  const deviceId = await ensureEmulatorRunning(opts.avdHint, onLog);
  onLog?.('Waiting for emulator to settle…');
  await new Promise((r) => setTimeout(r, 8000));

  const { packageName, launchableActivity } = await readApkPackage(apkPath);
  await installApk(apkPath, onLog);

  if (opts.skipLaunch) {
    return {
      deviceId,
      apkPath,
      packageName,
      launchableActivity,
      usedAppium: false,
    };
  }

  const appiumUp = await checkAppiumStatus(opts.appiumUrl);
  if (appiumUp) {
    onLog?.(`Appium is up — creating session…`);
    try {
      const { remote } = await import('webdriverio');
      const parsed = new URL(opts.appiumUrl);
      const driver = await remote({
        hostname: parsed.hostname,
        port: Number(parsed.port || 4723),
        path: parsed.pathname.replace(/\/$/, '') || '/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': deviceId,
          'appium:appPackage': packageName,
          ...(launchableActivity
            ? { 'appium:appActivity': launchableActivity }
            : {}),
          'appium:noReset': true,
          'appium:newCommandTimeout': 300,
          'appium:autoGrantPermissions': true,
        },
      });
      (globalThis as { __lgdAppiumDriver?: unknown }).__lgdAppiumDriver = driver;
      onLog?.('Appium session started — app open on emulator');
      return {
        deviceId,
        apkPath,
        packageName,
        launchableActivity,
        usedAppium: true,
      };
    } catch (err) {
      onLog?.(
        `Appium session failed (${err instanceof Error ? err.message : 'error'}) — using adb`,
      );
    }
  } else {
    onLog?.(
      `Appium not running at ${opts.appiumUrl} — opening app with adb.`,
    );
  }

  await launchApp(packageName, launchableActivity, onLog);
  // Settle after launch — reduces "System UI isn't responding"
  onLog?.('Waiting after launch for System UI to settle…');
  await new Promise((r) => setTimeout(r, 6000));
  return {
    deviceId,
    apkPath,
    packageName,
    launchableActivity,
    usedAppium: false,
  };
}

export function avdHintFromDeviceVersion(
  _deviceVersion: string,
  osVersion: string,
): string | undefined {
  // Match the AVD present on this machine when possible
  if (osVersion === '15' || osVersion === '14') return 'Medium_Phone_API_36.0';
  return 'Medium_Phone_API_36.0';
}
