import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from 'fs';
import type { WebLoadLiveMetrics } from '@/lib/types';

/** Sliding window for live RPS / avg smoothing (ms). */
const LIVE_WINDOW_MS = 15_000;

/**
 * Linear-interpolation percentile (Excel/JMeter Aggregate Report style).
 * Avoids nearest-rank undershoot that made p95 look too good.
 */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const w = rank - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function stddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

type TimedSample = { ts: number; elapsed: number };

export type JtlErrorSample = {
  at?: string;
  label: string;
  method?: string;
  url?: string;
  status?: string;
  message: string;
  success: boolean;
};

export type JtlAgg = {
  latencies: number[];
  /** Time-to-first-byte samples (Latency column) */
  ttfb: number[];
  /** TCP connect time samples */
  connect: number[];
  /** Recent samples for live smoothing */
  recent: TimedSample[];
  successCount: number;
  errorCount: number;
  statusCounts: Record<string, number>;
  bytesTotal: number;
  sentBytesTotal: number;
  maxThreads: number;
  latestThreads: number;
  firstTs: number;
  lastTs: number;
  /** Cap recent failures for UI / reports */
  recentErrors: JtlErrorSample[];
};

function emptyAgg(): JtlAgg {
  return {
    latencies: [],
    ttfb: [],
    connect: [],
    recent: [],
    successCount: 0,
    errorCount: 0,
    statusCounts: {},
    bytesTotal: 0,
    sentBytesTotal: 0,
    maxThreads: 0,
    latestThreads: 0,
    firstTs: 0,
    lastTs: 0,
    recentErrors: [],
  };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function pruneRecent(agg: JtlAgg) {
  if (!agg.recent.length || !agg.lastTs) return;
  const cutoff = agg.lastTs - LIVE_WINDOW_MS;
  while (agg.recent.length && agg.recent[0]!.ts < cutoff) {
    agg.recent.shift();
  }
}

function parseOptionalMs(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function ingestRow(agg: JtlAgg, header: string[], cols: string[]) {
  const map: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    map[header[i]!.toLowerCase()] = cols[i] ?? '';
  }

  const elapsed = parseOptionalMs(map.elapsed);
  const latency = parseOptionalMs(map.latency);
  const connect = parseOptionalMs(map.connect || map['connect time']);
  const success = String(map.success || '').toLowerCase() === 'true';
  const code = map.responsecode || map['response code'] || (success ? '200' : 'error');
  const ts = Number(map.timestamp || 0);
  const bytes = Number(map.bytes || 0);
  const sent = Number(map.sentbytes || map['sent bytes'] || map.bytessent || 0);
  const threads = Number(map.allthreads || map.grpthreads || 0);

  if (elapsed != null) {
    agg.latencies.push(elapsed);
    if (Number.isFinite(ts) && ts > 0) {
      agg.recent.push({ ts, elapsed });
    }
  }
  if (latency != null) agg.ttfb.push(latency);
  if (connect != null) agg.connect.push(connect);
  if (success) agg.successCount += 1;
  else agg.errorCount += 1;
  agg.statusCounts[code] = (agg.statusCounts[code] || 0) + 1;
  if (Number.isFinite(bytes) && bytes > 0) agg.bytesTotal += bytes;
  if (Number.isFinite(sent) && sent > 0) agg.sentBytesTotal += sent;
  if (Number.isFinite(threads) && threads > 0) {
    agg.latestThreads = threads;
    if (threads > agg.maxThreads) agg.maxThreads = threads;
  }
  if (Number.isFinite(ts) && ts > 0) {
    if (!agg.firstTs || ts < agg.firstTs) agg.firstTs = ts;
    if (ts > agg.lastTs) agg.lastTs = ts;
  }
  if (!success) {
    const label = map.label || map.samplerlabel || 'request';
    const failure =
      map.failuremessage ||
      map.responsemessage ||
      map.message ||
      `HTTP ${code}`;
    const responseBody = (
      map.responsedata ||
      map['response data'] ||
      map.responsebody ||
      ''
    ).trim();
    const methodGuess =
      map.method ||
      map.httpmethod ||
      (label.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\b/i)?.[1]?.toUpperCase() ??
        undefined);
    const parts = [String(failure)];
    if (responseBody) {
      parts.push(`Response: ${responseBody.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    agg.recentErrors.push({
      at: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : undefined,
      label,
      method: methodGuess,
      url: map.url || undefined,
      status: code,
      message: parts.join(' · ').slice(0, 800),
      success: false,
    });
    if (agg.recentErrors.length > 40) {
      agg.recentErrors = agg.recentErrors.slice(-40);
    }
  }
  pruneRecent(agg);
}

/** Parse entire JTL (CSV with header) into aggregate. */
export function parseJtlFile(jtlPath: string): JtlAgg {
  const agg = emptyAgg();
  if (!existsSync(jtlPath)) return agg;
  const text = readFileSync(jtlPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return agg;
  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  for (let i = 1; i < lines.length; i++) {
    ingestRow(agg, header, parseCsvLine(lines[i]!));
  }
  return agg;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function jtlToMetrics(
  agg: JtlAgg,
  opts: {
    virtualUsers: number;
    startedAt: number;
    engine?: 'jmeter' | 'node-fetch';
    jtlPath?: string;
    jmxPath?: string;
    reportDir?: string;
    logLines?: string[];
  },
): WebLoadLiveMetrics {
  const total = agg.successCount + agg.errorCount;
  // Wall-clock for RPS / throughput — first→last sample span inflated early RPS
  const wallSec = Math.max(0.5, (Date.now() - opts.startedAt) / 1000);
  const sorted = [...agg.latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sorted.length ? sum / sorted.length : 0;
  const bytesPerSec = Math.round(agg.bytesTotal / wallSec);
  const errorRatePct = total ? Math.round((agg.errorCount / total) * 1000) / 10 : 0;

  pruneRecent(agg);
  const recent = agg.recent;
  let rpsLive: number | undefined;
  let windowAvgMs: number | undefined;
  let windowSec: number | undefined;
  if (recent.length >= 2) {
    const spanMs = Math.max(1, recent[recent.length - 1]!.ts - recent[0]!.ts);
    windowSec = Math.round((spanMs / 1000) * 10) / 10;
    rpsLive = Math.round((recent.length / (spanMs / 1000)) * 10) / 10;
    windowAvgMs = avg(recent.map((s) => s.elapsed));
  } else if (recent.length === 1) {
    windowSec = Math.min(LIVE_WINDOW_MS / 1000, wallSec);
    rpsLive = Math.round((1 / Math.max(windowSec, 0.5)) * 10) / 10;
    windowAvgMs = Math.round(recent[0]!.elapsed);
  }

  const peakThreads = agg.maxThreads || 0;
  const latestThreads = agg.latestThreads || peakThreads;

  return {
    elapsedSec: Math.round(wallSec * 10) / 10,
    virtualUsers: opts.virtualUsers,
    activeUsers: latestThreads,
    totalRequests: total,
    successCount: agg.successCount,
    errorCount: agg.errorCount,
    rps: Math.round((total / wallSec) * 10) / 10,
    rpsLive,
    windowAvgMs,
    windowSec,
    errorRatePct,
    successRatePct: total ? Math.round((agg.successCount / total) * 1000) / 10 : 0,
    p50Ms: Math.round(percentile(sorted, 50)),
    p75Ms: Math.round(percentile(sorted, 75)),
    p90Ms: Math.round(percentile(sorted, 90)),
    p95Ms: Math.round(percentile(sorted, 95)),
    p99Ms: Math.round(percentile(sorted, 99)),
    avgMs: sorted.length ? Math.round(mean) : 0,
    minMs: sorted.length ? Math.round(sorted[0]!) : 0,
    maxMs: sorted.length ? Math.round(sorted[sorted.length - 1]!) : 0,
    stddevMs: sorted.length ? Math.round(stddev(sorted, mean)) : 0,
    statusCounts: { ...agg.statusCounts },
    engine: opts.engine || 'jmeter',
    jtlPath: opts.jtlPath,
    jmxPath: opts.jmxPath,
    reportDir: opts.reportDir,
    logLines: opts.logLines,
    bytesPerSec,
    totalBytes: agg.bytesTotal,
    kbPerSec: Math.round((bytesPerSec / 1024) * 10) / 10,
    avgLatencyMs: agg.ttfb.length ? avg(agg.ttfb) : undefined,
    avgConnectMs: agg.connect.length ? avg(agg.connect) : undefined,
    sentBytesTotal: agg.sentBytesTotal || undefined,
    sentBytesPerSec: agg.sentBytesTotal
      ? Math.round(agg.sentBytesTotal / wallSec)
      : undefined,
    jmeterThreads: peakThreads,
    latestThreads,
    recentErrors: agg.recentErrors.length ? [...agg.recentErrors] : undefined,
  };
}

/**
 * Tail a growing JTL CSV file and invoke onUpdate with fresh aggregates.
 * Returns a stop function.
 */
export function watchJtlFile(
  jtlPath: string,
  onUpdate: (agg: JtlAgg) => void,
  intervalMs = 800,
): () => void {
  let header: string[] | null = null;
  let offset = 0;
  let buffer = '';
  const agg = emptyAgg();
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    if (!existsSync(jtlPath)) return;
    try {
      const fd = openSync(jtlPath, 'r');
      try {
        const { size } = fstatSync(fd);
        if (size < offset) {
          offset = 0;
          buffer = '';
          header = null;
          Object.assign(agg, emptyAgg());
        }
        if (size === offset) return;
        const chunkSize = size - offset;
        const buf = Buffer.alloc(chunkSize);
        readSync(fd, buf, 0, chunkSize, offset);
        offset = size;
        buffer += buf.toString('utf8');
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() || '';
        for (const line of parts) {
          if (!line.trim()) continue;
          if (!header) {
            header = parseCsvLine(line).map((h) => h.trim());
            continue;
          }
          ingestRow(agg, header, parseCsvLine(line));
        }
        onUpdate(agg);
      } finally {
        closeSync(fd);
      }
    } catch {
      // file may be locked briefly
    }
  };

  const id = setInterval(tick, intervalMs);
  tick();
  return () => {
    stopped = true;
    clearInterval(id);
  };
}
