'use client';

import { useState } from 'react';
import type {
  LoadLabelAggregate,
  LoadLatencyHistogramBucket,
  LoadSeriesPoint,
  WebLoadLiveMetrics,
} from '@/lib/types';
import {
  LOAD_GRAPH_DEFS,
  LOAD_SUMMARY_METRIC_DEFS,
  LOAD_TABLE_COLUMN_DEFS,
  type LoadDefItem,
} from '@/lib/load-metric-defs';

type SeriesKey =
  | 'rps'
  | 'successRps'
  | 'errorRps'
  | 'avgMs'
  | 'medianMs'
  | 'p90Ms'
  | 'p95Ms'
  | 'p99Ms'
  | 'activeThreads'
  | 'errorPct'
  | 'kbPerSec'
  | 'kbSentPerSec'
  | 'avgTtfbMs'
  | 'avgConnectMs'
  | 'cumulativeSamples'
  | 'cumulativeErrors'
  | 'status2xx'
  | 'status4xx'
  | 'status5xx'
  | 'statusOther';

type ChartSection =
  | 'overtime'
  | 'codes'
  | 'distribution'
  | 'reports'
  | 'errors'
  | 'downloads'
  | 'definitions';

const OVERTIME_CHARTS: {
  key: SeriesKey;
  title: string;
  unit: string;
  color: string;
  defId: string;
}[] = [
  { key: 'rps', title: 'Hits per second (RPS)', unit: 'rps', color: '#2f6fed', defId: 'hits' },
  { key: 'avgMs', title: 'Avg response time', unit: 'ms', color: '#0d9488', defId: 'response-times' },
  { key: 'medianMs', title: 'Median (p50)', unit: 'ms', color: '#0891b2', defId: 'response-times' },
  { key: 'p90Ms', title: 'p90 response time', unit: 'ms', color: '#ca8a04', defId: 'response-times' },
  { key: 'p95Ms', title: 'p95 response time', unit: 'ms', color: '#c27803', defId: 'response-times' },
  { key: 'p99Ms', title: 'p99 response time', unit: 'ms', color: '#ea580c', defId: 'response-times' },
  { key: 'activeThreads', title: 'Active threads', unit: '', color: '#7c3aed', defId: 'active-threads' },
  { key: 'errorPct', title: 'Error %', unit: '%', color: '#d45d5d', defId: 'errors' },
  { key: 'kbPerSec', title: 'Received KB/s', unit: 'KB/s', color: '#2563eb', defId: 'kb-s' },
  { key: 'kbSentPerSec', title: 'Sent KB/s', unit: 'KB/s', color: '#1d4ed8', defId: 'kb-sent' },
  { key: 'avgTtfbMs', title: 'Latency / TTFB', unit: 'ms', color: '#db2777', defId: 'latency-ttfb' },
  { key: 'avgConnectMs', title: 'Connect time', unit: 'ms', color: '#65a30d', defId: 'connect' },
  {
    key: 'cumulativeSamples',
    title: 'Cumulative samples',
    unit: '',
    color: '#475569',
    defId: 'cumulative',
  },
  {
    key: 'cumulativeErrors',
    title: 'Cumulative errors',
    unit: '',
    color: '#b91c1c',
    defId: 'cumulative',
  },
];

function niceMax(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  const pad = n * 1.1;
  const mag = 10 ** Math.floor(Math.log10(pad));
  const norm = pad / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function seriesValue(p: LoadSeriesPoint, key: SeriesKey): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNum(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

function pointSnapshot(p: LoadSeriesPoint): string[] {
  return [
    `t = ${fmtNum(p.tSec)}s`,
    `Hits ${fmtNum(p.rps)}/s · OK ${fmtNum(p.successRps ?? p.successCount)} · KO ${fmtNum(p.errorRps ?? p.errorCount)}`,
    `Avg ${fmtNum(p.avgMs)}ms · Med ${fmtNum(p.medianMs ?? 0)}ms · p90 ${fmtNum(p.p90Ms ?? 0)} · p95 ${fmtNum(p.p95Ms)} · p99 ${fmtNum(p.p99Ms ?? 0)}`,
    `Threads ${p.activeThreads} · Err ${fmtNum(p.errorPct)}%`,
    `Recv ${fmtNum(p.kbPerSec ?? 0)} KB/s · Sent ${fmtNum(p.kbSentPerSec ?? 0)} KB/s`,
    `TTFB ${fmtNum(p.avgTtfbMs ?? 0)}ms · Connect ${fmtNum(p.avgConnectMs ?? 0)}ms`,
    `Cum samples ${p.cumulativeSamples ?? '—'} · Cum errors ${p.cumulativeErrors ?? '—'}`,
    `2xx ${p.status2xx ?? 0} · 4xx ${p.status4xx ?? 0} · 5xx ${p.status5xx ?? 0} · other ${p.statusOther ?? 0}`,
  ];
}

function DefHint({ text }: { text: string }) {
  return (
    <span className="load-def-hint" title={text} aria-label={text}>
      ?
    </span>
  );
}

function ChartTooltip({
  x,
  y,
  lines,
}: {
  x: number;
  y: number;
  lines: string[];
}) {
  return (
    <div
      className="load-chart-tooltip"
      style={{ left: x, top: y }}
      role="tooltip"
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

function nearestIndex(
  series: LoadSeriesPoint[],
  clientX: number,
  svg: SVGSVGElement,
  padL: number,
  plotW: number,
  minT: number,
  spanT: number,
): number {
  const rect = svg.getBoundingClientRect();
  const scaleX = svg.viewBox.baseVal.width / Math.max(1, rect.width);
  const localX = (clientX - rect.left) * scaleX;
  const t = minT + ((localX - padL) / plotW) * spanT;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < series.length; i++) {
    const d = Math.abs(series[i]!.tSec - t);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function LineChart({
  title,
  unit,
  color,
  series,
  seriesKey,
  definition,
}: {
  title: string;
  unit: string;
  color: string;
  series: LoadSeriesPoint[];
  seriesKey: SeriesKey;
  definition?: string;
}) {
  const [hover, setHover] = useState<{
    idx: number;
    px: number;
    py: number;
  } | null>(null);
  const w = 360;
  const h = 140;
  const padL = 40;
  const padR = 10;
  const padT = 14;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  if (!series.length) {
    return (
      <div className="load-chart-card">
        <h3 className="load-chart-title">
          {title}
          {definition ? <DefHint text={definition} /> : null}
        </h3>
        <p className="load-metrics-empty">Waiting for samples…</p>
      </div>
    );
  }

  const values = series.map((p) => seriesValue(p, seriesKey));
  const maxY = niceMax(Math.max(...values, 0));
  const minT = series[0]!.tSec;
  const maxT = series[series.length - 1]!.tSec;
  const spanT = Math.max(0.1, maxT - minT);

  const coords = series.map((p, i) => {
    const x = padL + ((p.tSec - minT) / spanT) * plotW;
    const y = padT + plotH - (Math.max(0, values[i]!) / maxY) * plotH;
    return { x, y };
  });
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${padL},${padT + plotH} ${line} ${padL + plotW},${padT + plotH}`;
  const last = values[values.length - 1]!;
  const hi = hover ? series[hover.idx]! : null;
  const hiVal = hover ? values[hover.idx]! : null;

  return (
    <div className="load-chart-card load-chart-interactive">
      <div className="load-chart-head">
        <h3 className="load-chart-title">
          {title}
          {definition ? <DefHint text={definition} /> : null}
        </h3>
        <strong className="load-chart-live-val">
          {hiVal != null
            ? `${fmtNum(hiVal)}${unit ? ` ${unit}` : ''} @ ${fmtNum(hi!.tSec)}s`
            : `${fmtNum(last)}${unit ? ` ${unit}` : ''}`}
        </strong>
      </div>
      <div className="load-chart-svg-wrap">
        <svg
          className="load-chart-svg"
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={title}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(ev) => {
            const svg = ev.currentTarget;
            const idx = nearestIndex(series, ev.clientX, svg, padL, plotW, minT, spanT);
            const rect = svg.getBoundingClientRect();
            setHover({
              idx,
              px: ev.clientX - rect.left,
              py: ev.clientY - rect.top,
            });
          }}
        >
          <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} className="load-chart-axis" />
          <line
            x1={padL}
            y1={padT + plotH}
            x2={padL + plotW}
            y2={padT + plotH}
            className="load-chart-axis"
          />
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={padL}
              y1={padT + plotH * (1 - f)}
              x2={padL + plotW}
              y2={padT + plotH * (1 - f)}
              className="load-chart-grid"
            />
          ))}
          <polygon points={area} fill={color} opacity={0.12} />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hover ? (
            <>
              <line
                x1={coords[hover.idx]!.x}
                y1={padT}
                x2={coords[hover.idx]!.x}
                y2={padT + plotH}
                className="load-chart-crosshair"
              />
              <circle
                cx={coords[hover.idx]!.x}
                cy={coords[hover.idx]!.y}
                r={4}
                fill={color}
                stroke="#fff"
                strokeWidth={1.5}
              />
            </>
          ) : null}
          <text x={4} y={padT + 4} className="load-chart-tick">
            {Math.round(maxY)}
          </text>
          <text x={4} y={padT + plotH} className="load-chart-tick">
            0
          </text>
          <text x={padL} y={h - 4} className="load-chart-tick">
            {minT}s
          </text>
          <text x={padL + plotW - 28} y={h - 4} className="load-chart-tick">
            {maxT}s
          </text>
        </svg>
        {hover && hi ? (
          <ChartTooltip
            x={Math.min(hover.px + 12, 200)}
            y={Math.max(8, hover.py - 8)}
            lines={[
              `${title}: ${fmtNum(hiVal!)}${unit ? ` ${unit}` : ''}`,
              ...pointSnapshot(hi),
            ]}
          />
        ) : null}
      </div>
      <p className="load-chart-hover-hint">Hover chart for point details</p>
    </div>
  );
}

function MultiLineChart({
  title,
  definition,
  series,
  lines,
  unit,
}: {
  title: string;
  definition?: string;
  series: LoadSeriesPoint[];
  lines: { key: SeriesKey; color: string; label: string }[];
  unit?: string;
}) {
  const [hover, setHover] = useState<{
    idx: number;
    px: number;
    py: number;
  } | null>(null);
  const w = 520;
  const h = 160;
  const padL = 40;
  const padR = 12;
  const padT = 16;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  if (!series.length) {
    return (
      <div className="load-chart-card load-chart-card-wide">
        <h3 className="load-chart-title">
          {title}
          {definition ? <DefHint text={definition} /> : null}
        </h3>
        <p className="load-metrics-empty">Waiting for samples…</p>
      </div>
    );
  }

  const maxY = niceMax(
    Math.max(1, ...series.flatMap((p) => lines.map((l) => seriesValue(p, l.key)))),
  );
  const minT = series[0]!.tSec;
  const maxT = series[series.length - 1]!.tSec;
  const spanT = Math.max(0.1, maxT - minT);

  function pathFor(key: SeriesKey) {
    return series
      .map((p) => {
        const x = padL + ((p.tSec - minT) / spanT) * plotW;
        const y = padT + plotH - (seriesValue(p, key) / maxY) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  function xy(key: SeriesKey, i: number) {
    const p = series[i]!;
    return {
      x: padL + ((p.tSec - minT) / spanT) * plotW,
      y: padT + plotH - (seriesValue(p, key) / maxY) * plotH,
    };
  }

  const hi = hover ? series[hover.idx]! : null;

  return (
    <div className="load-chart-card load-chart-card-wide load-chart-interactive">
      <div className="load-chart-head">
        <h3 className="load-chart-title">
          {title}
          {definition ? <DefHint text={definition} /> : null}
        </h3>
        <div className="load-chart-legend">
          {lines.map((l) => (
            <span key={l.key} className="load-chart-legend-item">
              <i style={{ background: l.color }} />
              {l.label}
              {unit ? ` (${unit})` : ''}
              {hi ? ` ${fmtNum(seriesValue(hi, l.key))}` : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="load-chart-svg-wrap">
        <svg
          className="load-chart-svg"
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={title}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(ev) => {
            const svg = ev.currentTarget;
            const idx = nearestIndex(series, ev.clientX, svg, padL, plotW, minT, spanT);
            const rect = svg.getBoundingClientRect();
            setHover({
              idx,
              px: ev.clientX - rect.left,
              py: ev.clientY - rect.top,
            });
          }}
        >
          <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} className="load-chart-axis" />
          <line
            x1={padL}
            y1={padT + plotH}
            x2={padL + plotW}
            y2={padT + plotH}
            className="load-chart-axis"
          />
          {lines.map((l) => (
            <polyline
              key={l.key}
              points={pathFor(l.key)}
              fill="none"
              stroke={l.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover ? (
            <>
              <line
                x1={xy(lines[0]!.key, hover.idx).x}
                y1={padT}
                x2={xy(lines[0]!.key, hover.idx).x}
                y2={padT + plotH}
                className="load-chart-crosshair"
              />
              {lines.map((l) => {
                const c = xy(l.key, hover.idx);
                return (
                  <circle
                    key={l.key}
                    cx={c.x}
                    cy={c.y}
                    r={3.5}
                    fill={l.color}
                    stroke="#fff"
                    strokeWidth={1.25}
                  />
                );
              })}
            </>
          ) : null}
          <text x={4} y={padT + 4} className="load-chart-tick">
            {Math.round(maxY)}
          </text>
          <text x={padL} y={h - 4} className="load-chart-tick">
            {minT}s
          </text>
          <text x={padL + plotW - 28} y={h - 4} className="load-chart-tick">
            {maxT}s
          </text>
        </svg>
        {hover && hi ? (
          <ChartTooltip
            x={Math.min(hover.px + 12, 320)}
            y={Math.max(8, hover.py - 8)}
            lines={[
              `${title} @ ${fmtNum(hi.tSec)}s`,
              ...lines.map(
                (l) =>
                  `${l.label}: ${fmtNum(seriesValue(hi, l.key))}${unit ? ` ${unit}` : ''}`,
              ),
              ...pointSnapshot(hi).slice(1),
            ]}
          />
        ) : null}
      </div>
      <p className="load-chart-hover-hint">Hover chart for all series values at that second</p>
    </div>
  );
}

function MultiStatusChart({ series }: { series: LoadSeriesPoint[] }) {
  const def = LOAD_GRAPH_DEFS.find((d) => d.id === 'codes-over-time');
  return (
    <MultiLineChart
      title="Response codes per second"
      definition={def?.definition}
      series={series}
      lines={[
        { key: 'status2xx', color: '#3d9a6a', label: '2xx' },
        { key: 'status4xx', color: '#c27803', label: '4xx' },
        { key: 'status5xx', color: '#d45d5d', label: '5xx' },
        { key: 'statusOther', color: '#64748b', label: 'other' },
      ]}
    />
  );
}

function HistogramChart({ buckets }: { buckets: LoadLatencyHistogramBucket[] }) {
  const def = LOAD_GRAPH_DEFS.find((d) => d.id === 'distribution');
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((a, b) => a + b.count, 0);
  if (!total) {
    return (
      <div className="load-chart-card load-chart-card-wide">
        <h3 className="load-chart-title">
          Response time distribution
          {def ? <DefHint text={def.definition} /> : null}
        </h3>
        <p className="load-metrics-empty">No latency samples yet.</p>
      </div>
    );
  }
  const hovered = hoverLabel
    ? buckets.find((b) => b.bucketLabel === hoverLabel)
    : null;
  return (
    <div className="load-chart-card load-chart-card-wide load-chart-interactive">
      <h3 className="load-chart-title">
        Response time distribution (ms)
        {def ? <DefHint text={def.definition} /> : null}
      </h3>
      <p className="load-chart-desc">
        How many samples fell into each elapsed-time bucket (JMeter Response Time Distribution).
        {hovered
          ? ` · ${hovered.bucketLabel} ms: ${hovered.count} samples (${fmtNum((hovered.count / total) * 100)}%)`
          : ' · Hover a bar for details'}
      </p>
      <div className="load-hist-bars">
        {buckets.map((b) => {
          const pct = Math.round((b.count / max) * 100);
          const share = Math.round((b.count / total) * 1000) / 10;
          return (
            <div
              key={b.bucketLabel}
              className={`load-hist-col${hoverLabel === b.bucketLabel ? ' is-hover' : ''}`}
              onMouseEnter={() => setHoverLabel(b.bucketLabel)}
              onMouseLeave={() => setHoverLabel(null)}
              title={`Bucket ${b.bucketLabel} ms\n${b.count} samples (${share}% of ${total})\nJMeter Response Time Distribution`}
            >
              <span className="load-hist-count">{b.count}</span>
              <div className="load-hist-track">
                <div className="load-hist-fill" style={{ height: `${pct}%` }} />
              </div>
              <span className="load-hist-label">{b.bucketLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusCodeChart({
  statusCounts,
  total,
}: {
  statusCounts: Record<string, number>;
  total: number;
}) {
  const def = LOAD_GRAPH_DEFS.find((d) => d.id === 'codes-bar');
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const entries = Object.entries(statusCounts).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) {
    return (
      <div className="load-chart-card">
        <h3 className="load-chart-title">HTTP status codes</h3>
        <p className="load-metrics-empty">—</p>
      </div>
    );
  }
  const family = (code: string) => {
    if (code.startsWith('2')) return 'Success (2xx)';
    if (code.startsWith('3')) return 'Redirect (3xx)';
    if (code.startsWith('4')) return 'Client error (4xx)';
    if (code.startsWith('5')) return 'Server error (5xx)';
    return 'Non-HTTP / other failure';
  };
  return (
    <div className="load-chart-card load-chart-interactive">
      <h3 className="load-chart-title">
        HTTP status codes
        {def ? <DefHint text={def.definition} /> : null}
      </h3>
      <div className="load-status-bars">
        {entries.map(([code, count]) => {
          const pct = total ? Math.round((count / total) * 1000) / 10 : 0;
          return (
            <div
              key={code}
              className={`load-status-bar-row${hoverCode === code ? ' is-hover' : ''}`}
              onMouseEnter={() => setHoverCode(code)}
              onMouseLeave={() => setHoverCode(null)}
              title={`HTTP ${code} — ${family(code)}\n${count} of ${total} samples (${pct}%)`}
            >
              <span className="load-status-code">{code}</span>
              <div className="load-status-track">
                <div
                  className={`load-status-fill ${code.startsWith('2') ? 'ok' : 'err'}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <span className="load-status-count">
                {count} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
      {hoverCode ? (
        <p className="load-chart-hover-hint">
          {hoverCode}: {family(hoverCode)} · {statusCounts[hoverCode]} samples
        </p>
      ) : (
        <p className="load-chart-hover-hint">Hover a status row for details</p>
      )}
    </div>
  );
}

function buildTotalRow(rows: LoadLabelAggregate[]): LoadLabelAggregate | null {
  if (!rows.length) return null;
  const samples = rows.reduce((a, r) => a + r.samples, 0);
  if (!samples) return null;
  const weightedAvg = Math.round(
    rows.reduce((a, r) => a + r.avgMs * r.samples, 0) / samples,
  );
  const errSamples = rows.reduce((a, r) => a + (r.errorPct / 100) * r.samples, 0);
  const thrpt = Math.round(rows.reduce((a, r) => a + r.throughput, 0) * 10) / 10;
  const kb = Math.round(rows.reduce((a, r) => a + r.kbPerSec, 0) * 10) / 10;
  const sentKb = Math.round(rows.reduce((a, r) => a + (r.sentKbPerSec || 0), 0) * 10) / 10;
  const receivedKB = Math.round(
    rows.reduce((a, r) => a + (r.receivedKB || 0), 0) * 10,
  ) / 10;
  const sentKB = Math.round(rows.reduce((a, r) => a + (r.sentKB || 0), 0) * 10) / 10;
  return {
    label: 'TOTAL',
    samples,
    avgMs: weightedAvg,
    minMs: Math.min(...rows.map((r) => r.minMs)),
    maxMs: Math.max(...rows.map((r) => r.maxMs)),
    medianMs: undefined,
    stddevMs: undefined,
    p50Ms: Math.round(rows.reduce((a, r) => a + r.p50Ms * r.samples, 0) / samples),
    p90Ms: Math.round(rows.reduce((a, r) => a + r.p90Ms * r.samples, 0) / samples),
    p95Ms: Math.round(rows.reduce((a, r) => a + r.p95Ms * r.samples, 0) / samples),
    p99Ms: Math.round(rows.reduce((a, r) => a + r.p99Ms * r.samples, 0) / samples),
    errorPct: Math.round((errSamples / samples) * 1000) / 10,
    throughput: thrpt,
    kbPerSec: kb,
    sentKbPerSec: sentKb,
    avgBytes: Math.round(
      rows.reduce((a, r) => a + (r.avgBytes || 0) * r.samples, 0) / samples,
    ),
    receivedKB,
    sentKB,
  };
}

function labelRowTitle(r: LoadLabelAggregate): string {
  return [
    `Label: ${r.label}`,
    `Samples: ${r.samples}`,
    `Avg ${r.avgMs}ms · Med ${r.medianMs ?? r.p50Ms}ms · Min ${r.minMs} · Max ${r.maxMs}`,
    `p90 ${r.p90Ms} · p95 ${r.p95Ms} · p99 ${r.p99Ms}`,
    `Error ${r.errorPct}% · Throughput ${r.throughput}/s`,
    `Recv ${r.kbPerSec} KB/s · Sent ${r.sentKbPerSec ?? '—'} KB/s · Avg ${r.avgBytes ?? '—'} B`,
    `Total recv ${r.receivedKB ?? '—'} KB · Total sent ${r.sentKB ?? '—'} KB`,
  ].join('\n');
}

function AggregateTable({ rows }: { rows: LoadLabelAggregate[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof LoadLabelAggregate>('samples');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  if (!rows.length) {
    return (
      <div className="load-chart-card load-chart-card-wide">
        <h3 className="load-chart-title">Aggregate Report</h3>
        <p className="load-metrics-empty">No sampler labels yet.</p>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const an = Number(av ?? 0);
    const bn = Number(bv ?? 0);
    return sortDir === 'asc' ? an - bn : bn - an;
  });
  const total = buildTotalRow(rows);
  const all = total ? [...sorted, total] : sorted;
  const hovered = hover ? all.find((r) => r.label === hover) : null;

  function toggleSort(key: keyof LoadLabelAggregate) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'label' ? 'asc' : 'desc');
    }
  }

  function Th({
    k,
    label,
    title,
  }: {
    k: keyof LoadLabelAggregate;
    label: string;
    title: string;
  }) {
    return (
      <th
        title={`${title} — click to sort`}
        className="load-agg-th-sort"
        onClick={() => toggleSort(k)}
      >
        {label}
        {sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  return (
    <div className="load-chart-card load-chart-card-wide load-chart-interactive">
      <h3 className="load-chart-title">
        Aggregate Report (by label)
        <DefHint text="JMeter Aggregate Report — percentiles, error %, throughput and KB/s per sampler." />
      </h3>
      <p className="load-chart-desc">
        Hover a row for full sampler details. Click column headers to sort.
      </p>
      {hovered ? (
        <div className="load-row-detail">
          <strong>{hovered.label}</strong>
          <span>
            {hovered.samples} samples · avg {hovered.avgMs}ms · p95 {hovered.p95Ms}ms · err{' '}
            {hovered.errorPct}% · {hovered.throughput}/s · recv {hovered.kbPerSec} KB/s
          </span>
        </div>
      ) : null}
      <div className="load-agg-table-wrap">
        <table className="load-agg-table">
          <thead>
            <tr>
              <Th k="label" label="Label" title="Sampler label" />
              <Th k="samples" label="#" title="# Samples" />
              <Th k="avgMs" label="Avg" title="Average elapsed (ms)" />
              <Th k="minMs" label="Min" title="Min elapsed (ms)" />
              <Th k="maxMs" label="Max" title="Max elapsed (ms)" />
              <Th k="p50Ms" label="Med" title="Median / p50 (ms)" />
              <Th k="p90Ms" label="p90" title="p90 (ms)" />
              <Th k="p95Ms" label="p95" title="p95 (ms)" />
              <Th k="p99Ms" label="p99" title="p99 (ms)" />
              <Th k="errorPct" label="Err%" title="Error %" />
              <Th k="throughput" label="Thrpt" title="Throughput (req/s)" />
              <Th k="kbPerSec" label="KB/s" title="Received KB/s" />
              <Th k="sentKbPerSec" label="Sent" title="Sent KB/s" />
              <Th k="avgBytes" label="Avg B" title="Average response bytes" />
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr
                key={r.label}
                className={[
                  r.errorPct > 0 ? 'row-err' : '',
                  r.label === 'TOTAL' ? 'row-total' : '',
                  hover === r.label ? 'is-hover' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined}
                title={labelRowTitle(r)}
                onMouseEnter={() => setHover(r.label)}
                onMouseLeave={() => setHover(null)}
              >
                <td className="load-agg-label">{r.label}</td>
                <td>{r.samples}</td>
                <td>{r.avgMs}</td>
                <td>{r.minMs}</td>
                <td>{r.maxMs}</td>
                <td>{r.medianMs ?? r.p50Ms}</td>
                <td>{r.p90Ms}</td>
                <td>{r.p95Ms}</td>
                <td>{r.p99Ms}</td>
                <td>{r.errorPct}</td>
                <td>{r.throughput}</td>
                <td>{r.kbPerSec}</td>
                <td>{r.sentKbPerSec ?? '—'}</td>
                <td>{r.avgBytes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryReportTable({ rows }: { rows: LoadLabelAggregate[] }) {
  const [hover, setHover] = useState<string | null>(null);
  if (!rows.length) {
    return (
      <div className="load-chart-card load-chart-card-wide">
        <h3 className="load-chart-title">Summary Report</h3>
        <p className="load-metrics-empty">No sampler labels yet.</p>
      </div>
    );
  }
  const total = buildTotalRow(rows);
  const all = total ? [...rows, total] : rows;
  const hovered = hover ? all.find((r) => r.label === hover) : null;
  return (
    <div className="load-chart-card load-chart-card-wide load-chart-interactive">
      <h3 className="load-chart-title">
        Summary Report
        <DefHint text="JMeter Summary Report — samples, avg, min, max, stddev, error %, throughput, received KB." />
      </h3>
      <p className="load-chart-desc">
        Classic JMeter Summary Report. Hover a row for full details.
      </p>
      {hovered ? (
        <div className="load-row-detail">
          <strong>{hovered.label}</strong>
          <span>
            avg {hovered.avgMs} · min {hovered.minMs} · max {hovered.maxMs} · stddev{' '}
            {hovered.stddevMs ?? '—'} · err {hovered.errorPct}% · thrpt {hovered.throughput}/s
          </span>
        </div>
      ) : null}
      <div className="load-agg-table-wrap">
        <table className="load-agg-table">
          <thead>
            <tr>
              <th title="Label">Label</th>
              <th title="# Samples">#</th>
              <th title="Average">Average</th>
              <th title="Min">Min</th>
              <th title="Max">Max</th>
              <th title="Std. Dev.">Std.Dev</th>
              <th title="Error %">Error %</th>
              <th title="Throughput">Throughput</th>
              <th title="Received KB/sec">KB/sec</th>
              <th title="Sent KB/sec">Sent KB/s</th>
              <th title="Avg Bytes">Avg B</th>
              <th title="Total received KB">Received KB</th>
              <th title="Total sent KB">Sent KB</th>
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr
                key={`sum-${r.label}`}
                className={[
                  r.errorPct > 0 ? 'row-err' : '',
                  r.label === 'TOTAL' ? 'row-total' : '',
                  hover === r.label ? 'is-hover' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined}
                title={labelRowTitle(r)}
                onMouseEnter={() => setHover(r.label)}
                onMouseLeave={() => setHover(null)}
              >
                <td className="load-agg-label">{r.label}</td>
                <td>{r.samples}</td>
                <td>{r.avgMs}</td>
                <td>{r.minMs}</td>
                <td>{r.maxMs}</td>
                <td>{r.stddevMs ?? '—'}</td>
                <td>{r.errorPct}</td>
                <td>{r.throughput}/s</td>
                <td>{r.kbPerSec}</td>
                <td>{r.sentKbPerSec ?? '—'}</td>
                <td>{r.avgBytes ?? '—'}</td>
                <td>{r.receivedKB ?? '—'}</td>
                <td>{r.sentKB ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ErrorsPanel({ metrics }: { metrics: WebLoadLiveMetrics }) {
  const errors = metrics.recentErrors || [];
  return (
    <div className="load-chart-card load-chart-card-wide">
      <h3 className="load-chart-title">
        Failed samples (View Results Tree–style)
        <DefHint text="Recent failed JTL samples with label, URL, status, and failure message — like JMeter View Results Tree filtered to errors." />
      </h3>
      <p className="load-chart-desc">
        Showing the latest {errors.length} failures (capped). Download the full JTL from Downloads
        for every sample.
      </p>
      {!errors.length ? (
        <p className="load-metrics-empty">No failed samples yet — good.</p>
      ) : (
        <ul className="load-error-ul load-error-tree">
          {errors
            .slice()
            .reverse()
            .map((e, i) => (
              <li
                key={`${e.label}-${e.at || i}-${i}`}
                title={[
                  e.method ? `${e.method} ${e.label}` : e.label,
                  e.status ? `HTTP ${e.status}` : null,
                  e.url || null,
                  e.message,
                  e.at || null,
                ]
                  .filter(Boolean)
                  .join('\n')}
              >
                <strong>
                  {e.method ? `${e.method} ` : ''}
                  {e.label}
                </strong>
                {e.status ? ` · HTTP ${e.status}` : ''}
                {e.at ? (
                  <span className="history-meta"> · {new Date(e.at).toLocaleTimeString()}</span>
                ) : null}
                {e.url ? (
                  <>
                    <br />
                    <code>{e.url}</code>
                  </>
                ) : null}
                <br />
                <span className="api-error-inline">{e.message}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function DownloadsPanel({
  runId,
  metrics,
}: {
  runId?: string | null;
  metrics: WebLoadLiveMetrics;
}) {
  if (!runId) {
    return (
      <div className="load-charts-empty">
        Start a run to download JTL, JMX, Aggregate/Summary CSV, and the HTML Dashboard.
      </div>
    );
  }
  const base = `/api/runs/${encodeURIComponent(runId)}/load-artifacts`;
  const items: { href: string; label: string; hint: string; ready?: boolean }[] = [
    {
      href: `${base}/jtl`,
      label: 'Download JTL (results)',
      hint: 'Raw JMeter CSV results — open in GUI JMeter or Excel',
      ready: Boolean(metrics.jtlPath || metrics.totalRequests),
    },
    {
      href: `${base}/jmx`,
      label: 'Download JMX (test plan)',
      hint: 'Generated Apache JMeter plan used for this run',
      ready: Boolean(metrics.jmxPath),
    },
    {
      href: `${base}/log`,
      label: 'Download jmeter.log',
      hint: 'JMeter engine log for troubleshooting',
      ready: true,
    },
    {
      href: `${base}/aggregate-csv`,
      label: 'Export Aggregate Report CSV',
      hint: 'Same columns as the Aggregate Report table',
      ready: Boolean(metrics.byLabel?.length),
    },
    {
      href: `${base}/summary-csv`,
      label: 'Export Summary Report CSV',
      hint: 'Same columns as the Summary Report table',
      ready: Boolean(metrics.byLabel?.length),
    },
  ];
  return (
    <div className="load-downloads-panel">
      <p className="load-chart-desc" style={{ marginTop: 0 }}>
        Artifacts for this run — same files a JMeter GUI user would keep after a non-GUI test.
      </p>
      <div className="load-downloads-grid">
        {items.map((item) => (
          <a
            key={item.href}
            className={`btn btn-ghost load-download-btn${!item.ready ? ' is-disabled' : ''}`}
            href={item.ready ? item.href : undefined}
            aria-disabled={!item.ready}
            onClick={(ev) => {
              if (!item.ready) ev.preventDefault();
            }}
          >
            <strong>{item.label}</strong>
            <span className="history-meta">{item.hint}</span>
          </a>
        ))}
        {metrics.htmlReportReady ? (
          <a
            className="btn btn-ghost load-download-btn"
            href={`/api/runs/${encodeURIComponent(runId)}/load-report/`}
            target="_blank"
            rel="noreferrer"
          >
            <strong>Open JMeter HTML Dashboard</strong>
            <span className="history-meta">
              Full Apache JMeter dashboard (graphs, statistics, Apdex)
            </span>
          </a>
        ) : (
          <div className="btn btn-ghost load-download-btn is-disabled">
            <strong>JMeter HTML Dashboard</strong>
            <span className="history-meta">Generated after JMeter finishes</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DefinitionsPanel() {
  function Block({ title, items }: { title: string; items: LoadDefItem[] }) {
    return (
      <div className="load-defs-block">
        <h3 className="load-chart-title">{title}</h3>
        <dl className="load-defs-list">
          {items.map((item) => (
            <div key={item.id} className="load-defs-item">
              <dt>
                {item.name}
                {item.jmeterListener ? (
                  <span className="load-defs-jmeter"> · {item.jmeterListener}</span>
                ) : null}
              </dt>
              <dd>{item.definition}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  return (
    <div className="load-defs-panel">
      <p className="load-chart-desc" style={{ marginTop: 0 }}>
        These match Apache JMeter listeners and Aggregate / Summary Report fields so results are
        easy to compare with GUI JMeter or the HTML Dashboard.
      </p>
      <Block title="Graphs & listeners" items={LOAD_GRAPH_DEFS} />
      <Block title="Table columns" items={LOAD_TABLE_COLUMN_DEFS} />
      <Block title="Run summary" items={LOAD_SUMMARY_METRIC_DEFS} />
    </div>
  );
}

function OverviewStrip({ metrics }: { metrics: WebLoadLiveMetrics }) {
  const cells: { label: string; value: string; title: string }[] = [
    {
      label: 'Samples',
      value: String(metrics.totalRequests),
      title: '# Samples — total sampler results (OK + errors) across the run',
    },
    {
      label: 'RPS',
      value: String(metrics.rps),
      title: 'Throughput — requests per second over wall-clock (JMeter Aggregate)',
    },
    {
      label: 'Avg / p95',
      value: `${metrics.avgMs} / ${metrics.p95Ms}ms`,
      title: 'Mean elapsed vs 95th percentile — use p95 for SLAs',
    },
    {
      label: 'Error %',
      value: `${metrics.errorRatePct}%`,
      title: '(Failed / total) × 100 — keep under your threshold',
    },
    {
      label: 'Threads',
      value: `${metrics.latestThreads ?? metrics.activeUsers}/${metrics.virtualUsers}`,
      title: 'Active / configured virtual users (JMeter allThreads)',
    },
    {
      label: 'KB/s',
      value: String(metrics.kbPerSec ?? '—'),
      title: 'Received network throughput (KB/sec)',
    },
  ];
  if (metrics.htmlReportReady) {
    cells.push({
      label: 'JMeter HTML',
      value: 'Ready',
      title: 'Apache JMeter HTML Dashboard generated — open from Downloads tab',
    });
  }
  return (
    <div className="load-graphs-overview">
      {cells.map((c) => (
        <div key={c.label} className="load-graphs-overview-cell" title={c.title}>
          <span className="load-metric-label">{c.label}</span>
          <strong>{c.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function LoadLiveCharts({
  metrics,
  compact,
  runId,
}: {
  metrics?: WebLoadLiveMetrics | null;
  compact?: boolean;
  /** Enables Downloads tab (JTL / JMX / CSV / HTML) */
  runId?: string | null;
}) {
  const [section, setSection] = useState<ChartSection>('overtime');

  if (!metrics) {
    return (
      <div className="load-charts-empty">
        Start the load test to see live JMeter-style graphs (hits/sec, TPS, percentiles, threads,
        codes, Aggregate &amp; Summary Report, errors, downloads). Open Definitions for every
        metric explained.
      </div>
    );
  }

  const series = metrics.series || [];
  const byLabel = metrics.byLabel || [];
  const hist = metrics.latencyHistogram || [];
  const defMap = Object.fromEntries(LOAD_GRAPH_DEFS.map((d) => [d.id, d.definition]));
  const errCount = metrics.recentErrors?.length || 0;

  return (
    <div className={`load-charts-wrap${compact ? ' is-compact' : ''}`}>
      <OverviewStrip metrics={metrics} />

      <div className="load-chart-section-tabs" role="tablist" aria-label="Graph sections">
        {(
          [
            ['overtime', 'Over time'],
            ['codes', 'Codes'],
            ['distribution', 'Distribution'],
            ['reports', 'Reports'],
            ['errors', errCount ? `Errors (${errCount})` : 'Errors'],
            ['downloads', 'Downloads'],
            ['definitions', 'Definitions'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={`load-chart-section-tab ${section === id ? 'active' : ''}`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'overtime' ? (
        <>
          <p className="load-chart-desc">
            Live ~1s buckets from the JTL (same data JMeter Graphs / Dashboard use). Hover{' '}
            <span className="load-def-hint" style={{ display: 'inline-flex' }}>
              ?
            </span>{' '}
            for each chart&apos;s definition.
          </p>
          <MultiLineChart
            title="Transactions per second (success vs error)"
            definition={defMap.tps}
            series={series}
            unit="tps"
            lines={[
              { key: 'successRps', color: '#3d9a6a', label: 'OK' },
              { key: 'errorRps', color: '#d45d5d', label: 'KO' },
              { key: 'rps', color: '#2f6fed', label: 'Total' },
            ]}
          />
          <MultiLineChart
            title="Response time percentiles over time"
            definition={defMap['response-times']}
            series={series}
            unit="ms"
            lines={[
              { key: 'medianMs', color: '#0891b2', label: 'p50' },
              { key: 'p90Ms', color: '#ca8a04', label: 'p90' },
              { key: 'p95Ms', color: '#c27803', label: 'p95' },
              { key: 'p99Ms', color: '#ea580c', label: 'p99' },
            ]}
          />
          <div className="load-charts-grid">
            {OVERTIME_CHARTS.map((c) => (
              <LineChart
                key={c.key}
                title={c.title}
                unit={c.unit}
                color={c.color}
                series={series}
                seriesKey={c.key}
                definition={defMap[c.defId]}
              />
            ))}
          </div>
        </>
      ) : null}

      {section === 'codes' ? (
        <div className="load-charts-grid">
          <MultiStatusChart series={series} />
          <StatusCodeChart
            statusCounts={metrics.statusCounts}
            total={metrics.totalRequests}
          />
        </div>
      ) : null}

      {section === 'distribution' ? (
        hist.length ? (
          <HistogramChart buckets={hist} />
        ) : (
          <p className="load-metrics-empty">No distribution data yet.</p>
        )
      ) : null}

      {section === 'reports' ? (
        <>
          <AggregateTable rows={byLabel} />
          <SummaryReportTable rows={byLabel} />
        </>
      ) : null}

      {section === 'errors' ? <ErrorsPanel metrics={metrics} /> : null}

      {section === 'downloads' ? (
        <DownloadsPanel runId={runId} metrics={metrics} />
      ) : null}

      {section === 'definitions' ? <DefinitionsPanel /> : null}
    </div>
  );
}
