#!/usr/bin/env npx tsx
/**
 * CLI to list / run VAPT suites (same engine as the UI), including runtime AI
 * multi-query + fail-level escalation on pass.
 *
 * Usage:
 *   npm run vapt -- list
 *   npm run vapt -- run --base-url http://localhost:4200 --api-url http://localhost:3000/api/v1
 *   npm run vapt -- run --id vapt-login-main-suite --no-runtime-ai
 *   npm run vapt -- run --checks sql-injection-surface,xss-reflection
 */
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { RunSnapshot, VaptCheckId, VaptTestCase } from '@/lib/types';
import { createSession, getSession, subscribe, toSnapshot } from '@/server/session-manager';
import { createVaptSessionSteps, runVapt } from '@/server/vapt-runner';
import { getVaptCase, listVaptCases } from '@/server/vapt-store';
import { reportPdfAbsolutePath } from '@/server/report-pdf';

type Args = {
  cmd: 'list' | 'run' | 'help';
  id?: string;
  baseUrl?: string;
  apiUrl?: string;
  runtimeAi: boolean;
  provider?: string;
  model?: string;
  checks?: string[];
  json: boolean;
};

function printHelp() {
  console.log(`
LGD VAPT suite CLI

Commands:
  list                          List saved VAPT suites
  run [options]                 Run a VAPT suite (default: vapt-login-main-suite)
  help                          Show this help

Run options:
  --id <suiteId>                Suite id (default: vapt-login-main-suite)
  --base-url <url>              Portal URL (or BASE_URL / NEXT_PUBLIC_DEFAULT_BASE_URL)
  --api-url <url>               API URL (or API_URL / NEXT_PUBLIC_DEFAULT_API_URL)
  --checks a,b,c                Override checks for this run only
  --provider openrouter|claude  AI provider (default: AI_PROVIDER or openrouter)
  --model <id>                  Model override
  --no-runtime-ai               Skip AI multi-query + fail-level escalation
  --json                        Print final snapshot JSON

Examples:
  npm run vapt -- list
  npm run vapt -- run --base-url http://localhost:4200 --api-url http://localhost:3000/api/v1
  npm run vapt -- run --checks brute-force,sql-injection-surface,xss-reflection
  npm run vapt -- run --no-runtime-ai
`);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    cmd: 'help',
    runtimeAi: true,
    json: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    if (a === 'list' || a === 'run' || a === 'help') {
      out.cmd = a;
      continue;
    }
    if (a === '--help' || a === '-h') {
      out.cmd = 'help';
      continue;
    }
    if (a === '--no-runtime-ai') {
      out.runtimeAi = false;
      continue;
    }
    if (a === '--json') {
      out.json = true;
      continue;
    }
    const take = (key: keyof Args) => {
      const v = argv[++i];
      if (!v || v.startsWith('-')) throw new Error(`Missing value for ${a}`);
      (out as Record<string, unknown>)[key] = v;
    };
    if (a === '--id') {
      take('id');
      continue;
    }
    if (a === '--base-url') {
      take('baseUrl');
      continue;
    }
    if (a === '--api-url') {
      take('apiUrl');
      continue;
    }
    if (a === '--provider') {
      take('provider');
      continue;
    }
    if (a === '--model') {
      take('model');
      continue;
    }
    if (a === '--checks') {
      const v = argv[++i];
      if (!v || v.startsWith('-')) throw new Error('Missing value for --checks');
      out.checks = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
    positional.push(a);
  }
  if (positional[0] === 'list' || positional[0] === 'run' || positional[0] === 'help') {
    out.cmd = positional[0];
  } else if (!out.cmd || out.cmd === 'help') {
    if (positional[0]) out.cmd = positional[0] as Args['cmd'];
  }
  return out;
}

async function loadEnvFiles() {
  const roots = [process.cwd()];
  for (const root of roots) {
    for (const name of ['.env.local', '.env']) {
      const file = path.join(root, name);
      try {
        const raw = await fs.readFile(file, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env) || process.env[key] === '') {
            process.env[key] = val;
          }
        }
      } catch {
        // optional
      }
    }
  }
}

function normalizeUrl(raw?: string): string {
  return (raw || '').trim().replace(/\/+$/, '');
}

function cmdList() {
  const cases = listVaptCases();
  if (!cases.length) {
    console.log('No VAPT suites found in data/vapt-cases.json');
    return;
  }
  console.log(`VAPT suites (${cases.length}):\n`);
  for (const c of cases) {
    const n = c.vapt.checks?.length || 0;
    console.log(`  ${c.id}`);
    console.log(`    ${c.name}`);
    console.log(
      `    ${c.vapt.method || 'GET'} ${c.vapt.targetUrl} · ${n} check(s) · gate ${c.vapt.severityGate || 'high'}`,
    );
    if (c.description) console.log(`    ${c.description.slice(0, 120)}`);
    console.log('');
  }
}

function applyCheckOverride(test: VaptTestCase, checks?: string[]): VaptTestCase {
  if (!checks?.length) return test;
  return {
    ...test,
    vapt: {
      ...test.vapt,
      checks: checks as VaptCheckId[],
    },
  };
}

async function waitForTerminal(runId: string): Promise<RunSnapshot> {
  return new Promise((resolve, reject) => {
    let last: RunSnapshot | undefined;
    const unsub = subscribe(runId, (snap) => {
      last = snap;
      const step = snap.steps.find((s) => s.status === 'running');
      if (step) {
        process.stdout.write(
          `\r  [${snap.status}] ${snap.completed}/${snap.total} · ${step.label.slice(0, 60).padEnd(60)}`,
        );
      }
      if (
        snap.status === 'completed' ||
        snap.status === 'failed' ||
        snap.status === 'stopped'
      ) {
        unsub();
        process.stdout.write('\n');
        resolve(snap);
      }
    });
    // Safety: if subscribe missed terminal emit, poll briefly
    const started = Date.now();
    const timer = setInterval(() => {
      const s = getSession(runId);
      if (s) last = toSnapshot(s);
      if (
        last &&
        (last.status === 'completed' ||
          last.status === 'failed' ||
          last.status === 'stopped')
      ) {
        clearInterval(timer);
        unsub();
        process.stdout.write('\n');
        resolve(last);
      } else if (Date.now() - started > 60 * 60 * 1000) {
        clearInterval(timer);
        unsub();
        reject(new Error('VAPT CLI timed out after 60 minutes'));
      }
    }, 2000);
  });
}

function printReport(snap: RunSnapshot) {
  const m = snap.vaptFindings;
  console.log('\n—— VAPT result ——');
  console.log(`  Status:   ${snap.status}`);
  console.log(`  Run ID:   ${snap.runId}`);
  console.log(`  Suite:    ${snap.testId} · ${snap.testName}`);
  if (snap.error) console.log(`  Error:    ${snap.error}`);
  if (m) {
    console.log(
      `  Findings: ${m.checked} checked · ${m.passed} pass · ${m.failed} fail · ${m.info} info · ${m.errors} error`,
    );
    console.log(`  Network:  ${m.networkCaptures?.length || 0} capture(s)`);
    console.log(`  AI rounds:${m.aiProbeRounds?.length || 0}`);
    if (m.aiProbeRounds?.length) {
      for (const r of m.aiProbeRounds) {
        console.log(
          `    · ${r.checkId} [${r.level}] ${r.status} · q=${r.queryCount} pass=${r.passed} fail=${r.failed} · ${r.model || ''}`,
        );
      }
    }
    const fails = (m.findings || []).filter(
      (f) => f.status === 'fail' || f.status === 'error',
    );
    if (fails.length) {
      console.log('\n  Failed findings:');
      for (const f of fails.slice(0, 20)) {
        console.log(
          `    · [${f.severity}/${f.probeRound || 'baseline'}] ${f.title}`,
        );
      }
      if (fails.length > 20) console.log(`    … +${fails.length - 20} more`);
    }
  }
  const steps = snap.steps || [];
  const passed = steps.filter((s) => s.status === 'passed').length;
  const failed = steps.filter((s) => s.status === 'failed').length;
  const skipped = steps.filter((s) => s.status === 'skipped').length;
  console.log(`  Steps:    ${passed} pass · ${failed} fail · ${skipped} skip / ${steps.length}`);
  try {
    const pdf = reportPdfAbsolutePath(snap.runId);
    console.log(`  PDF:      ${pdf}`);
  } catch {
    // ignore
  }
  console.log(`  History:  data/run-history.json`);
  console.log('');
}

async function cmdRun(args: Args) {
  const id = args.id || 'vapt-login-main-suite';
  const baseUrl =
    normalizeUrl(args.baseUrl) ||
    normalizeUrl(process.env.BASE_URL) ||
    normalizeUrl(process.env.NEXT_PUBLIC_DEFAULT_BASE_URL);
  const apiUrl =
    normalizeUrl(args.apiUrl) ||
    normalizeUrl(process.env.API_URL) ||
    normalizeUrl(process.env.NEXT_PUBLIC_DEFAULT_API_URL) ||
    undefined;

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error(
      'Valid --base-url (or BASE_URL / NEXT_PUBLIC_DEFAULT_BASE_URL) is required',
    );
  }

  const raw = getVaptCase(id);
  if (!raw) {
    throw new Error(
      `Unknown VAPT suite "${id}". Run: npm run vapt -- list`,
    );
  }
  const test = applyCheckOverride(raw, args.checks);

  if (test.vapt.useApiBase && (!apiUrl || !/^https?:\/\//i.test(apiUrl))) {
    throw new Error(
      'Valid --api-url (or API_URL / NEXT_PUBLIC_DEFAULT_API_URL) is required for this suite',
    );
  }

  const runId = randomUUID();
  const steps = createVaptSessionSteps(test);
  createSession({
    runId,
    testId: test.id,
    testName: test.name,
    testDescription: test.description,
    baseUrl,
    apiUrl,
    steps,
  });

  console.log(`Starting VAPT · ${test.id}`);
  console.log(`  Portal:     ${baseUrl}`);
  if (apiUrl) console.log(`  API:        ${apiUrl}`);
  console.log(`  Checks:     ${test.vapt.checks.length}`);
  console.log(
    `  Runtime AI: ${args.runtimeAi ? 'on (multi → fail-level on pass)' : 'off'}`,
  );
  console.log(
    `  Provider:   ${args.provider || process.env.AI_PROVIDER || 'openrouter'}`,
  );
  console.log(`  Run ID:     ${runId}\n`);

  const done = waitForTerminal(runId);
  await runVapt(runId, baseUrl, test, {
    apiUrl,
    runtimeAi: args.runtimeAi,
    provider: args.provider || process.env.AI_PROVIDER || undefined,
    model: args.model || undefined,
    openRouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  });
  const snap = await done;

  printReport(snap);
  if (args.json) {
    console.log(JSON.stringify(snap, null, 2));
  }

  if (snap.status === 'completed') process.exitCode = 0;
  else process.exitCode = 1;
}

async function main() {
  await loadEnvFiles();
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    printHelp();
    process.exitCode = 2;
    return;
  }

  try {
    if (args.cmd === 'list') cmdList();
    else if (args.cmd === 'run') await cmdRun(args);
    else printHelp();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

void main();
