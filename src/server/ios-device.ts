import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function run(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts?.timeoutMs ?? 120_000,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env, ...opts?.env },
      },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`${cmd} not found`));
          return;
        }
        resolve({
          code: err ? ((err as { code?: number }).code as number) || 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

export function xcodeAppPath(): string {
  return '/Applications/Xcode.app';
}

export function developerDir(): string {
  const fromXcode = join(xcodeAppPath(), 'Contents/Developer');
  if (existsSync(join(fromXcode, 'usr/bin/simctl'))) return fromXcode;
  return process.env.DEVELOPER_DIR || fromXcode;
}

export function hasXcode(): boolean {
  return existsSync(join(developerDir(), 'usr/bin/simctl'));
}

export async function simctl(
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!hasXcode()) {
    throw new Error(
      'Xcode / iOS Simulator not installed. Install Xcode from the Mac App Store, open it once, then retry.',
    );
  }
  const simctlBin = join(developerDir(), 'usr/bin/simctl');
  return run(simctlBin, args, {
    timeoutMs: opts?.timeoutMs,
    env: {
      ...process.env,
      DEVELOPER_DIR: developerDir(),
    },
  });
}

/** Map UI device id → Simulator device name preference. */
export function simulatorDeviceName(deviceVersion: string): string {
  const map: Record<string, string> = {
    'iphone-16': 'iPhone 16',
    'iphone-15': 'iPhone 15',
    'iphone-14': 'iPhone 14',
    'iphone-13': 'iPhone 13',
    'ipad-pro': 'iPad Pro',
    'generic-iphone': 'iPhone 16',
  };
  return map[deviceVersion] || 'iPhone 16';
}

export type SimDevice = {
  udid: string;
  name: string;
  state: string;
  runtime: string;
};

export async function listSimulators(): Promise<SimDevice[]> {
  const { stdout, code, stderr } = await simctl(['list', 'devices', '-j']);
  if (code !== 0) throw new Error(`simctl list failed: ${stderr || stdout}`);
  const json = JSON.parse(stdout) as {
    devices: Record<string, Array<{ udid: string; name: string; state: string; isAvailable?: boolean }>>;
  };
  const out: SimDevice[] = [];
  for (const [runtime, devices] of Object.entries(json.devices || {})) {
    for (const d of devices) {
      if (d.isAvailable === false) continue;
      out.push({
        udid: d.udid,
        name: d.name,
        state: d.state,
        runtime,
      });
    }
  }
  return out;
}

export async function findSimulator(
  deviceVersion: string,
  osVersion: string,
): Promise<SimDevice | null> {
  const wantName = simulatorDeviceName(deviceVersion);
  const devices = await listSimulators();
  const runtimeHint = osVersion ? `iOS-${osVersion.replace(/\./g, '-')}` : '';

  const booted = devices.find(
    (d) => d.state === 'Booted' && d.name.includes(wantName.split(' ')[0] || 'iPhone'),
  );
  if (booted) return booted;

  const byNameAndOs = devices.find(
    (d) =>
      d.name === wantName &&
      (!runtimeHint || d.runtime.includes(runtimeHint) || d.runtime.includes(`-${osVersion}-`)),
  );
  if (byNameAndOs) return byNameAndOs;

  const byName = devices.find((d) => d.name === wantName);
  if (byName) return byName;

  // Fallback: any iPhone
  return (
    devices.find((d) => /iPhone/i.test(d.name) && d.state === 'Booted') ||
    devices.find((d) => /iPhone 16/i.test(d.name)) ||
    devices.find((d) => /iPhone/i.test(d.name)) ||
    null
  );
}

export async function openSimulatorApp(): Promise<void> {
  await run('open', ['-a', 'Simulator']);
}

export async function bootSimulator(
  deviceVersion: string,
  osVersion: string,
  onLog?: (m: string) => void,
): Promise<SimDevice> {
  if (!hasXcode()) {
    throw new Error(
      'iOS Simulator needs Xcode. Install from Mac App Store → open Xcode once → retry Start.',
    );
  }

  let device = await findSimulator(deviceVersion, osVersion);
  if (!device) {
    throw new Error(
      `No iOS Simulator found for ${simulatorDeviceName(deviceVersion)} (iOS ${osVersion}). Open Xcode → Settings → Platforms and download an iOS runtime.`,
    );
  }

  onLog?.(`Using Simulator ${device.name} (${device.udid.slice(0, 8)}…) · ${device.state}`);

  if (device.state !== 'Booted') {
    onLog?.('Booting iOS Simulator…');
    await openSimulatorApp();
    const boot = await simctl(['boot', device.udid], { timeoutMs: 180_000 });
    // "Unable to boot device in current state: Booted" is fine
    if (boot.code !== 0 && !/Booted|current state/i.test(boot.stderr + boot.stdout)) {
      throw new Error(`Failed to boot Simulator: ${boot.stderr || boot.stdout}`);
    }
    // Wait until Booted
    for (let i = 0; i < 60; i++) {
      const again = await findSimulator(deviceVersion, osVersion);
      if (again?.state === 'Booted') {
        device = again;
        break;
      }
      await delay(2000);
    }
  } else {
    await openSimulatorApp();
  }

  onLog?.(`Simulator ready · ${device.name}`);
  return device;
}

export function isSimulatorBuildPath(path: string): boolean {
  return path.endsWith('.app') && existsSync(path);
}

/**
 * Diawi/App Store IPAs are device (arm64) builds — they do not install on Simulator.
 * Simulator needs an .app built for iphonesimulator.
 */
export function iosInstallBlockerMessage(appUrl: string): string {
  if (/diawi\.com/i.test(appUrl)) {
    return (
      'This Mac does not see a physical iPhone, so the Diawi IPA cannot be used here. ' +
      'Having the app already installed on the phone (via Diawi Safari) is not enough — ' +
      'the phone must also be paired with this Mac for automation. ' +
      'Fix: USB cable → unlock → Trust, or Xcode → Window → Devices and Simulators → enable Connect via network. ' +
      'Then Start again. ' +
      'Diawi IPA still cannot run on the iOS Simulator (needs a Simulator .app at data/mobile-apps/Augmont.app).'
    );
  }
  if (/apps\.apple\.com/i.test(appUrl)) {
    return 'App Store links cannot install on Simulator. Use a Simulator .app build or a Diawi IPA on a real iPhone.';
  }
  return (
    'For Simulator, provide a Simulator .app. Device IPAs (Diawi) need a physical iPhone paired with this Mac.'
  );
}

export async function listPhysicalIosDevices(): Promise<string[]> {
  // Prefer ios-deploy (works with Xcode device support)
  try {
    const { stdout, code } = await run('ios-deploy', ['-c', '-t', '3'], {
      timeoutMs: 15_000,
    });
    if (code === 0 || stdout) {
      const ids = [...stdout.matchAll(/Found\s+[^\(]*\(([0-9A-Fa-f-]+)\)/g)].map(
        (m) => m[1],
      );
      if (ids.length) return ids;
      // newer ios-deploy formats
      const ids2 = [...stdout.matchAll(/\b([0-9a-f]{40}|[0-9A-F-]{25,})\b/g)].map(
        (m) => m[1],
      );
      if (ids2.length) return [...new Set(ids2)];
    }
  } catch {
    // fall through
  }
  try {
    const { stdout } = await run('idevice_id', ['-l'], { timeoutMs: 10_000 });
    return stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function hasPhysicalIosDevice(): Promise<boolean> {
  const devices = await listPhysicalIosDevices();
  return devices.length > 0;
}

/** Returns true if bundle id is installed on the first connected physical iPhone. */
export async function isAppInstalledOnPhysicalDevice(
  bundleId: string,
): Promise<boolean> {
  const devices = await listPhysicalIosDevices();
  if (!devices.length) return false;
  try {
    const { stdout, code } = await run(
      'ideviceinstaller',
      ['-u', devices[0], '-l'],
      { timeoutMs: 30_000 },
    );
    if (code !== 0) return false;
    return stdout.includes(bundleId);
  } catch {
    return false;
  }
}

/** Install IPA on a connected physical iPhone via ideviceinstaller or ios-deploy. */
export async function installIpaOnPhysicalDevice(
  ipaPath: string,
  onLog?: (m: string) => void,
): Promise<string> {
  if (!existsSync(ipaPath)) {
    throw new Error(`IPA not found: ${ipaPath}`);
  }
  const devices = await listPhysicalIosDevices();
  if (!devices.length) {
    throw new Error(
      'No physical iPhone detected. Plug in USB (or enable Connect via network in Xcode), unlock, tap Trust, then retry.',
    );
  }
  onLog?.(`Physical iPhone detected (${devices[0]}) — installing IPA…`);

  // ideviceinstaller accepts .ipa directly
  try {
    const { code, stdout, stderr } = await run(
      'ideviceinstaller',
      ['-u', devices[0], '-i', ipaPath],
      { timeoutMs: 300_000 },
    );
    if (code === 0) {
      return `Installed IPA on ${devices[0]} via ideviceinstaller`;
    }
    onLog?.(`ideviceinstaller failed (${stderr || stdout}) — trying ios-deploy…`);
  } catch (err) {
    onLog?.(
      `ideviceinstaller unavailable (${err instanceof Error ? err.message : 'error'}) — trying ios-deploy…`,
    );
  }

  // ios-deploy wants .app — use extracted Diawi app if present
  const extracted = join(process.cwd(), 'data', 'mobile-apps', 'Augmont-from-diawi.app');
  const appPath = existsSync(extracted) ? extracted : ipaPath;
  const { code, stdout, stderr } = await run(
    'ios-deploy',
    ['--id', devices[0], '--bundle', appPath, '--noninteractive'],
    { timeoutMs: 300_000 },
  );
  if (code !== 0) {
    throw new Error(
      `Failed to install on iPhone: ${stderr || stdout || 'unknown'}. ` +
        'Confirm the device UDID is in the Diawi Development profile, then install via Safari on the phone as fallback.',
    );
  }
  return `Installed on ${devices[0]} via ios-deploy`;
}

export async function launchAppOnPhysicalDevice(
  bundleId: string,
  onLog?: (m: string) => void,
): Promise<void> {
  const devices = await listPhysicalIosDevices();
  if (!devices.length) throw new Error('No physical iPhone connected');
  onLog?.(`Launching ${bundleId} on ${devices[0]}…`);
  const { code, stderr, stdout } = await run(
    'ios-deploy',
    ['--id', devices[0], '--bundle_id', bundleId, '--justlaunch', '--noninteractive'],
    { timeoutMs: 60_000 },
  );
  if (code !== 0) {
    // Non-fatal for some ios-deploy versions
    onLog?.(`Launch warning: ${stderr || stdout || 'check phone home screen'}`);
  }
}

export async function installAppOnSimulator(
  udid: string,
  appPath: string,
  onLog?: (m: string) => void,
): Promise<void> {
  if (!isSimulatorBuildPath(appPath)) {
    throw new Error(`Not a Simulator .app: ${appPath}`);
  }
  onLog?.(`Installing ${appPath} on Simulator…`);
  const { code, stderr, stdout } = await simctl(['install', udid, appPath], {
    timeoutMs: 180_000,
  });
  if (code !== 0) {
    throw new Error(`simctl install failed: ${stderr || stdout}`);
  }
}

export async function launchAppOnSimulator(
  udid: string,
  bundleId: string,
  onLog?: (m: string) => void,
): Promise<void> {
  onLog?.(`Launching ${bundleId}…`);
  const { code, stderr, stdout } = await simctl(['launch', udid, bundleId]);
  if (code !== 0) {
    throw new Error(`simctl launch failed: ${stderr || stdout}`);
  }
}

/** Default bundle id for Augmont LGD. */
export const AUGMONT_IOS_BUNDLE_ID = 'com.augmont.labgrowndiamonds';

export function defaultIosBundleId(): string {
  return AUGMONT_IOS_BUNDLE_ID;
}

/** Optional local Simulator .app override via env. */
export function localSimulatorAppPath(): string | null {
  const p =
    process.env.IOS_SIMULATOR_APP ||
    join(process.cwd(), 'data', 'mobile-apps', 'Augmont.app');
  return existsSync(p) ? p : null;
}

export function spawnDetached(cmd: string, args: string[]) {
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

export function iosHome(): string {
  return join(homedir(), 'Library', 'Developer', 'CoreSimulator');
}
