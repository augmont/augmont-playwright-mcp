import {
  existsSync,
  mkdirSync,
  chmodSync,
  createWriteStream,
  unlinkSync,
} from 'fs';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const JMETER_VERSION = process.env.JMETER_VERSION || '5.6.3';
const TOOLS_DIR = path.join(process.cwd(), 'tools');
const BUNDLE_DIR = path.join(TOOLS_DIR, `apache-jmeter-${JMETER_VERSION}`);
const BUNDLE_BIN = path.join(
  BUNDLE_DIR,
  'bin',
  process.platform === 'win32' ? 'jmeter.bat' : 'jmeter',
);

/** Common Mac Homebrew OpenJDK locations when JAVA_HOME is unset. */
function resolveJavaHome(): string | undefined {
  if (process.env.JAVA_HOME?.trim()) return process.env.JAVA_HOME.trim();
  const candidates = [
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk',
    '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk',
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, 'bin', 'java'))) return c;
  }
  return undefined;
}

function isExecutable(p: string): boolean {
  if (!existsSync(p)) return false;
  const javaHome = resolveJavaHome();
  const env = {
    ...process.env,
    ...(javaHome ? { JAVA_HOME: javaHome, JRE_HOME: javaHome } : {}),
  };
  try {
    const r = spawnSync(p, ['-v'], { encoding: 'utf8', timeout: 20_000, env });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    return r.status === 0 || /Apache|JMeter|jmeter/i.test(out);
  } catch {
    return false;
  }
}

/** Resolve jmeter CLI: JMETER_BIN → JMETER_HOME → PATH → tools/apache-jmeter-*. */
export function resolveJmeterBin(): string | null {
  const envBin = (process.env.JMETER_BIN || '').trim();
  if (envBin && isExecutable(envBin)) return envBin;

  const home = (process.env.JMETER_HOME || '').trim().replace(/\/+$/, '');
  if (home) {
    const cand = path.join(
      home,
      'bin',
      process.platform === 'win32' ? 'jmeter.bat' : 'jmeter',
    );
    if (isExecutable(cand)) return cand;
  }

  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['jmeter'], {
    encoding: 'utf8',
  });
  const fromPath = (which.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (fromPath && isExecutable(fromPath)) return fromPath;

  if (isExecutable(BUNDLE_BIN)) return BUNDLE_BIN;
  return null;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download JMeter (${res.status}) from ${url}`);
  }
  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  await pipeline(nodeStream, createWriteStream(dest));
}

function extractTgz(archivePath: string, cwd: string): void {
  const r = spawnSync('tar', ['-xzf', archivePath, '-C', cwd], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `tar extract failed: ${(r.stderr || r.stdout || 'unknown error').slice(0, 400)}`,
    );
  }
}

/**
 * Ensure a local Apache JMeter exists under tools/ (downloads once if missing).
 */
export async function ensureJmeterBin(onLog?: (line: string) => void): Promise<string> {
  const existing = resolveJmeterBin();
  if (existing) {
    onLog?.(`Using JMeter at ${existing}`);
    return existing;
  }

  mkdirSync(TOOLS_DIR, { recursive: true });
  if (isExecutable(BUNDLE_BIN)) {
    onLog?.(`Using bundled JMeter at ${BUNDLE_BIN}`);
    return BUNDLE_BIN;
  }

  // Need Java for JMeter
  const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (java.status !== 0 && java.error) {
    throw new Error(
      'Java is required for JMeter. Install a JDK (e.g. brew install temurin) then retry.',
    );
  }

  const archiveName = `apache-jmeter-${JMETER_VERSION}.tgz`;
  const archivePath = path.join(TOOLS_DIR, archiveName);
  const url =
    process.env.JMETER_DOWNLOAD_URL ||
    `https://archive.apache.org/dist/jmeter/binaries/${archiveName}`;

  onLog?.(`Downloading Apache JMeter ${JMETER_VERSION}…`);
  onLog?.(url);
  await downloadToFile(url, archivePath);
  onLog?.(`Extracting to ${TOOLS_DIR}…`);
  extractTgz(archivePath, TOOLS_DIR);
  try {
    unlinkSync(archivePath);
  } catch {
    // keep archive if delete fails
  }

  if (!existsSync(BUNDLE_BIN)) {
    throw new Error(
      `JMeter extract succeeded but binary missing at ${BUNDLE_BIN}. Set JMETER_HOME or run npm run jmeter:install`,
    );
  }
  try {
    chmodSync(BUNDLE_BIN, 0o755);
  } catch {
    // ignore
  }
  onLog?.(`JMeter ready: ${BUNDLE_BIN}`);
  return BUNDLE_BIN;
}

export type JmeterRunHandle = {
  proc: ChildProcess;
  done: Promise<{ code: number | null; stdout: string; stderr: string }>;
};

/** Non-GUI JMeter run. */
export function spawnJmeter(opts: {
  jmeterBin: string;
  jmxPath: string;
  jtlPath: string;
  logFile?: string;
  reportDir?: string;
  extraArgs?: string[];
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}): JmeterRunHandle {
  const args = [
    '-n',
    '-t',
    opts.jmxPath,
    '-l',
    opts.jtlPath,
    '-Jjmeter.save.saveservice.output_format=csv',
    '-Jjmeter.save.saveservice.response_code=true',
    '-Jjmeter.save.saveservice.successful=true',
    '-Jjmeter.save.saveservice.thread_counts=true',
    '-Jjmeter.save.saveservice.latency=true',
    '-Jjmeter.save.saveservice.connect_time=true',
    '-Jjmeter.save.saveservice.bytes=true',
    '-Jjmeter.save.saveservice.sent_bytes=true',
    '-Jjmeter.save.saveservice.label=true',
    '-Jjmeter.save.saveservice.timestamp=true',
    '-Jjmeter.save.saveservice.time=true',
    ...(opts.logFile ? ['-j', opts.logFile] : []),
    ...(opts.reportDir ? ['-e', '-o', opts.reportDir] : []),
    ...(opts.extraArgs || []),
  ];

  const javaHome = resolveJavaHome();
  const proc = spawn(opts.jmeterBin, args, {
    env: {
      ...process.env,
      ...(javaHome ? { JAVA_HOME: javaHome, JRE_HOME: javaHome } : {}),
      JAVA_OPTS: process.env.JAVA_OPTS || '-Xms256m -Xmx1024m',
    },
  });

  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8');
    stdout += text;
    for (const line of text.split(/\r?\n/).filter(Boolean)) opts.onStdout?.(line);
  });
  proc.stderr?.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8');
    stderr += text;
    for (const line of text.split(/\r?\n/).filter(Boolean)) opts.onStderr?.(line);
  });

  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err) => {
      stderr += `\n${err.message}`;
      resolve({ code: 1, stdout, stderr });
    });
  });

  return { proc, done };
}

export function killJmeterProcess(proc: ChildProcess | undefined) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      if (!proc.killed) proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 2000);
}

/** @internal test helper — export paths */
export const JMETER_BUNDLE = { version: JMETER_VERSION, dir: BUNDLE_DIR, bin: BUNDLE_BIN };
