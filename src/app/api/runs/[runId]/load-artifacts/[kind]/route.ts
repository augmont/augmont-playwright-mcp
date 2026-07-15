import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { getSession } from '@/server/session-manager';
import { getReport } from '@/server/run-history';
import type { LoadLabelAggregate } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOAD_RUNS = path.join(process.cwd(), 'data', 'load-runs');

type ArtifactKind = 'jtl' | 'jmx' | 'log' | 'aggregate-csv' | 'summary-csv';

function csvEscape(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function aggregateCsv(rows: LoadLabelAggregate[]): string {
  const header = [
    'Label',
    'Samples',
    'Average',
    'Median',
    'Min',
    'Max',
    'p90',
    'p95',
    'p99',
    'Error%',
    'Throughput',
    'ReceivedKB/s',
    'SentKB/s',
    'AvgBytes',
    'ReceivedKB',
    'SentKB',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.label,
        r.samples,
        r.avgMs,
        r.medianMs ?? r.p50Ms,
        r.minMs,
        r.maxMs,
        r.p90Ms,
        r.p95Ms,
        r.p99Ms,
        r.errorPct,
        r.throughput,
        r.kbPerSec,
        r.sentKbPerSec ?? '',
        r.avgBytes ?? '',
        r.receivedKB ?? '',
        r.sentKB ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function summaryCsv(rows: LoadLabelAggregate[]): string {
  const header = [
    'Label',
    '#Samples',
    'Average',
    'Min',
    'Max',
    'Std.Dev.',
    'Error%',
    'Throughput',
    'ReceivedKB/sec',
    'SentKB/sec',
    'Avg.Bytes',
    'ReceivedKB',
    'SentKB',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.label,
        r.samples,
        r.avgMs,
        r.minMs,
        r.maxMs,
        r.stddevMs ?? '',
        r.errorPct,
        r.throughput,
        r.kbPerSec,
        r.sentKbPerSec ?? '',
        r.avgBytes ?? '',
        r.receivedKB ?? '',
        r.sentKB ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function resolveRunFile(
  runId: string,
  kind: 'jtl' | 'jmx' | 'log',
): Promise<string | null> {
  const session = getSession(runId);
  const report = await getReport(runId);
  const metrics = session?.loadMetrics || report?.loadMetrics;
  const rel =
    kind === 'jtl'
      ? metrics?.jtlPath
      : kind === 'jmx'
        ? metrics?.jmxPath
        : undefined;

  const candidates: string[] = [];
  if (rel) {
    candidates.push(path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel));
  }
  const runDir = path.join(LOAD_RUNS, runId);
  if (kind === 'jtl') candidates.push(path.join(runDir, 'results.jtl'));
  if (kind === 'jmx') candidates.push(path.join(runDir, 'plan.jmx'));
  if (kind === 'log') candidates.push(path.join(runDir, 'jmeter.log'));

  const allowed = path.normalize(runDir);
  for (const c of candidates) {
    const n = path.normalize(c);
    if (!n.startsWith(allowed)) continue;
    if (existsSync(n)) return n;
  }
  return null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; kind: string }> },
) {
  const { runId, kind: rawKind } = await context.params;
  if (!runId || /[^a-zA-Z0-9_-]/.test(runId)) {
    return new Response('Invalid run id', { status: 400 });
  }

  const kind = rawKind as ArtifactKind;
  const allowed: ArtifactKind[] = [
    'jtl',
    'jmx',
    'log',
    'aggregate-csv',
    'summary-csv',
  ];
  if (!allowed.includes(kind)) {
    return new Response('Unknown artifact. Use jtl|jmx|log|aggregate-csv|summary-csv', {
      status: 400,
    });
  }

  if (kind === 'aggregate-csv' || kind === 'summary-csv') {
    const session = getSession(runId);
    const report = await getReport(runId);
    const rows =
      session?.loadMetrics?.byLabel || report?.loadMetrics?.byLabel || [];
    if (!rows.length) {
      return new Response('No Aggregate/Summary data yet for this run.', {
        status: 404,
      });
    }
    const body = kind === 'aggregate-csv' ? aggregateCsv(rows) : summaryCsv(rows);
    const filename =
      kind === 'aggregate-csv'
        ? `aggregate-${runId.slice(0, 8)}.csv`
        : `summary-${runId.slice(0, 8)}.csv`;
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const filePath = await resolveRunFile(runId, kind);
  if (!filePath) {
    return new Response(`Artifact not found: ${kind}`, { status: 404 });
  }

  const buf = await fs.readFile(filePath);
  const filename =
    kind === 'jtl'
      ? `results-${runId.slice(0, 8)}.jtl`
      : kind === 'jmx'
        ? `plan-${runId.slice(0, 8)}.jmx`
        : `jmeter-${runId.slice(0, 8)}.log`;
  const contentType =
    kind === 'jmx'
      ? 'application/xml; charset=utf-8'
      : kind === 'jtl'
        ? 'text/csv; charset=utf-8'
        : 'text/plain; charset=utf-8';

  return new Response(buf, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
