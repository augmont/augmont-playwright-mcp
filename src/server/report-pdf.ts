import { createWriteStream, existsSync, promises as fs } from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import type { ReportAiSummary, RunReport, TestStep } from '@/lib/types';
import { ensureReportFlowChart } from '@/lib/flow-chart';
import { resolveExpectation } from '@/lib/test-expectation';
import { listConfiguredThresholdRows } from '@/lib/load-grade-summary';

type PdfDoc = InstanceType<typeof PDFDocument>;

const DATA_DIR = path.join(process.cwd(), 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

const C = {
  text: '#1a2332',
  muted: '#667588',
  line: '#e2e8f0',
  panel: '#f8fafc',
  white: '#ffffff',
  brand: '#0f172a',
  accent: '#b45309',
  pass: '#15803d',
  passBg: '#dcfce7',
  passBorder: '#86efac',
  fail: '#b91c1c',
  failBg: '#fee2e2',
  failBorder: '#fca5a5',
  skip: '#a16207',
  skipBg: '#fef3c7',
  skipBorder: '#fde68a',
  running: '#1d4ed8',
  runningBg: '#dbeafe',
  runningBorder: '#93c5fd',
  pending: '#64748b',
  pendingBg: '#f1f5f9',
  pendingBorder: '#cbd5e1',
  codeBg: '#0f172a',
  codeFg: '#e2e8f0',
};

function formatWhen(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms?: number) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${Math.round(ms / 100) / 10}s`;
}

function stepDuration(step: TestStep): string {
  if (!step.startedAt || !step.finishedAt) return '—';
  const a = Date.parse(step.startedAt);
  const b = Date.parse(step.finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
  return formatDuration(b - a);
}

export function reportPdfAbsolutePath(runId: string): string {
  return path.join(REPORTS_DIR, `${runId}.pdf`);
}

export function reportPdfRelativePath(runId: string): string {
  return path.join('reports', `${runId}.pdf`);
}

function innerW(doc: PdfDoc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function left(doc: PdfDoc) {
  return doc.page.margins.left;
}

function ensureSpace(doc: PdfDoc, need: number) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - need) {
    doc.addPage();
  }
}

function hr(doc: PdfDoc) {
  const y = doc.y + 2;
  doc
    .moveTo(left(doc), y)
    .lineTo(left(doc) + innerW(doc), y)
    .strokeColor(C.line)
    .lineWidth(1)
    .stroke();
  doc.y = y + 10;
}

function sectionHeading(doc: PdfDoc, title: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.35);
  doc.fontSize(12).fillColor(C.brand).text(title);
  hr(doc);
}

function pill(
  doc: PdfDoc,
  label: string,
  opts: { x: number; y: number; bg: string; fg: string; border: string },
) {
  const padX = 8;
  const padY = 3;
  doc.fontSize(8).fillColor(opts.fg);
  const tw = doc.widthOfString(label.toUpperCase());
  const w = tw + padX * 2;
  const h = 16;
  doc.save();
  doc.roundedRect(opts.x, opts.y, w, h, 8).fillAndStroke(opts.bg, opts.border);
  doc.restore();
  doc.fillColor(opts.fg).text(label.toUpperCase(), opts.x + padX, opts.y + padY, {
    width: tw + 2,
    lineBreak: false,
  });
  return w;
}

function writeHeader(doc: PdfDoc, report: RunReport, isFail: boolean) {
  const x = left(doc);
  const w = innerW(doc);

  // Top brand bar
  doc.save();
  doc.rect(0, 0, doc.page.width, 36).fill(C.brand);
  doc.restore();
  doc
    .fillColor(C.white)
    .fontSize(10)
    .text('LGD Playwright MCP  ·  Test Report', x, 12, { width: w, lineBreak: false });
  doc.y = 48;

  // Title + status pill
  doc.fillColor(C.text).fontSize(18).text(report.testName || report.testId || 'Test report', {
    width: w,
  });
  doc.moveDown(0.2);

  const pillY = doc.y;
  const status = String(report.status || 'unknown');
  const pillW = pill(doc, status, {
    x,
    y: pillY,
    bg: isFail ? C.failBg : C.passBg,
    fg: isFail ? C.fail : C.pass,
    border: isFail ? C.failBorder : C.passBorder,
  });
  doc
    .fillColor(C.muted)
    .fontSize(9)
    .text(
      `${formatWhen(report.finishedAt || report.startedAt)}   ·   ${formatDuration(report.durationMs)}   ·   Run ${report.runId.slice(0, 8)}`,
      x + pillW + 10,
      pillY + 3,
      { width: w - pillW - 10, lineBreak: false },
    );
  doc.y = pillY + 22;

  if (report.testDescription) {
    doc.fillColor(C.muted).fontSize(9).text(report.testDescription, { width: w });
  }

  // Meta card
  doc.moveDown(0.35);
  const metaTop = doc.y;
  const metaLines = [
    `Portal  ${report.baseUrl || '—'}`,
    report.apiUrl ? `API  ${report.apiUrl}` : null,
    report.role ? `Role  ${report.role}` : null,
    `Polarity  ${resolveExpectation({
      expectation: report.expectation,
      name: report.testName,
      id: report.testId,
    }).toUpperCase()}`,
    `Test ID  ${report.testId}`,
  ].filter(Boolean) as string[];
  const metaH = 12 + metaLines.length * 13;
  doc.save();
  doc.roundedRect(x, metaTop, w, metaH, 8).fillAndStroke(C.panel, C.line);
  doc.restore();
  let my = metaTop + 8;
  for (const line of metaLines) {
    doc.fillColor(C.muted).fontSize(8).text(line, x + 12, my, { width: w - 24, lineBreak: false });
    my += 13;
  }
  doc.y = metaTop + metaH + 12;
}

function statusColors(status: string) {
  switch (status) {
    case 'passed':
      return { bg: C.passBg, fg: C.pass, border: C.passBorder };
    case 'failed':
      return { bg: C.failBg, fg: C.fail, border: C.failBorder };
    case 'skipped':
      return { bg: C.skipBg, fg: C.skip, border: C.skipBorder };
    case 'running':
      return { bg: C.runningBg, fg: C.running, border: C.runningBorder };
    default:
      return { bg: C.pendingBg, fg: C.pending, border: C.pendingBorder };
  }
}

/** Vertical flow chart with pass/fail coloring — included in every PDF. */
function writeFlowChart(doc: PdfDoc, report: RunReport) {
  const nodes = ensureReportFlowChart(report);
  if (!nodes.length) return;

  sectionHeading(doc, 'Test flow chart (pass / fail)');
  doc
    .fillColor(C.muted)
    .fontSize(8)
    .text(
      'Each node is a step. Failed steps break the path; skipped nodes were not executed.',
      { width: innerW(doc) },
    );
  doc.moveDown(0.35);

  const x = left(doc);
  const w = Math.min(innerW(doc), 420);
  const boxH = 34;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    ensureSpace(doc, boxH + 22);
    const colors = statusColors(node.status);
    const y = doc.y;
    doc.save();
    doc.roundedRect(x, y, w, boxH, 6).fillAndStroke(colors.bg, colors.border);
    doc.restore();
    doc
      .fillColor(colors.fg)
      .fontSize(7)
      .text(
        `${(node.action || 'step').toUpperCase()} · ${node.status.toUpperCase()}`,
        x + 10,
        y + 5,
        { width: w - 20, lineBreak: false },
      );
    doc
      .fillColor(C.text)
      .fontSize(9)
      .text(node.label, x + 10, y + 16, { width: w - 20, lineBreak: false });
    doc.y = y + boxH;

    if (i < nodes.length - 1) {
      const cx = x + w / 2;
      doc
        .moveTo(cx, doc.y)
        .lineTo(cx, doc.y + 10)
        .strokeColor(colors.border)
        .lineWidth(1.5)
        .stroke();
      doc.y += 12;
    } else {
      doc.moveDown(0.4);
    }
  }
}

function writeStats(doc: PdfDoc, counts: RunReport['stepCounts']) {
  ensureSpace(doc, 58);
  const w = innerW(doc);
  const gap = 10;
  const boxW = (w - gap * 2) / 3;
  const y = doc.y;
  const h = 48;
  const items = [
    { label: 'Passed', value: counts.passed, bg: C.passBg, fg: C.pass, border: C.passBorder },
    { label: 'Failed', value: counts.failed, bg: C.failBg, fg: C.fail, border: C.failBorder },
    { label: 'Skipped', value: counts.skipped, bg: C.skipBg, fg: C.skip, border: C.skipBorder },
  ];

  items.forEach((item, i) => {
    const bx = left(doc) + i * (boxW + gap);
    doc.save();
    doc.roundedRect(bx, y, boxW, h, 8).fillAndStroke(item.bg, item.border);
    doc.restore();
    doc.fillColor(item.fg).fontSize(18).text(String(item.value), bx + 12, y + 8, {
      width: boxW - 24,
      lineBreak: false,
    });
    doc.fillColor(C.muted).fontSize(8).text(item.label.toUpperCase(), bx + 12, y + 30, {
      width: boxW - 24,
      lineBreak: false,
    });
  });
  doc.x = left(doc);
  doc.y = y + h + 14;
}

function writeSummaryCard(doc: PdfDoc, report: RunReport, isFail: boolean) {
  const ai = report.aiSummary;
  if (!report.guidance && !ai) return;

  sectionHeading(
    doc,
    isFail ? 'Failure summary' : 'Success summary',
  );

  const x = left(doc);
  const w = innerW(doc);
  const pad = 14;
  const top = doc.y;

  // Build text blocks to estimate height
  const blocks: Array<{ size: number; color: string; text: string; gap?: number }> = [];
  if (ai?.headline) {
    blocks.push({
      size: 11,
      color: isFail ? C.fail : C.pass,
      text: ai.headline,
      gap: 6,
    });
  }
  blocks.push({
    size: 9.5,
    color: C.text,
    text: ai?.narrative || report.guidance || '',
    gap: 8,
  });
  if (isFail && ai?.whyFailed) {
    blocks.push({ size: 10, color: C.fail, text: 'Why it failed', gap: 3 });
    blocks.push({ size: 9.5, color: C.text, text: ai.whyFailed, gap: 4 });
    if (ai.rootCause) {
      blocks.push({ size: 8.5, color: C.muted, text: `Root cause: ${ai.rootCause}`, gap: 8 });
    }
  }
  if (ai?.developerActions?.length) {
    blocks.push({ size: 10, color: C.text, text: 'Developer actions', gap: 3 });
    for (const a of ai.developerActions) {
      blocks.push({ size: 9, color: C.muted, text: `•  ${a}`, gap: 2 });
    }
    blocks.push({ size: 9, color: C.muted, text: ' ', gap: 6 });
  }
  if (ai?.preventionActions?.length) {
    blocks.push({ size: 10, color: C.text, text: 'How to prevent this attack', gap: 3 });
    for (const a of ai.preventionActions) {
      blocks.push({ size: 9, color: C.muted, text: `•  ${a}`, gap: 2 });
    }
    blocks.push({ size: 9, color: C.muted, text: ' ', gap: 6 });
  }
  if (ai?.testerActions?.length) {
    blocks.push({ size: 10, color: C.text, text: 'Tester actions', gap: 3 });
    for (const a of ai.testerActions) {
      blocks.push({ size: 9, color: C.muted, text: `•  ${a}`, gap: 2 });
    }
    blocks.push({ size: 9, color: C.muted, text: ' ', gap: 6 });
  }
  if (ai?.studyNotes) {
    blocks.push({ size: 9, color: C.muted, text: `Study notes: ${ai.studyNotes}`, gap: 4 });
  }
  if (ai?.model) {
    blocks.push({ size: 8, color: C.muted, text: `Summary model: ${ai.model}`, gap: 0 });
  }

  // Measure
  let measureY = 0;
  for (const b of blocks) {
    doc.fontSize(b.size);
    const h = doc.heightOfString(b.text, { width: w - pad * 2 });
    measureY += h + (b.gap ?? 4);
  }
  const cardH = pad * 2 + measureY;

  ensureSpace(doc, Math.min(cardH, 200));
  const drawTop = doc.y;
  doc.save();
  doc
    .roundedRect(x, drawTop, w, cardH, 8)
    .fillAndStroke(isFail ? C.failBg : C.passBg, isFail ? C.failBorder : C.passBorder);
  doc.restore();

  let cy = drawTop + pad;
  for (const b of blocks) {
    if (b.text.trim() === '') {
      cy += b.gap ?? 4;
      continue;
    }
    doc.fillColor(b.color).fontSize(b.size).text(b.text, x + pad, cy, {
      width: w - pad * 2,
    });
    cy = doc.y + (b.gap ?? 4);
  }
  doc.x = x;
  doc.y = drawTop + cardH + 12;
}

function writeSnippets(doc: PdfDoc, ai: ReportAiSummary | undefined, isFail: boolean) {
  if (!ai?.codeSnippets?.length) return;
  sectionHeading(doc, 'Developer code snippets');
  doc
    .fillColor(C.muted)
    .fontSize(8.5)
    .text(
      isFail
        ? 'Reproduce / harden the failed assertion in Playwright.'
        : 'Happy-path reference for onboarding and regression study.',
    );
  doc.moveDown(0.25);

  for (const sn of ai.codeSnippets) {
    ensureSpace(doc, 90);
    const x = left(doc);
    const w = innerW(doc);
    const top = doc.y;

    // Title bar
    doc.save();
    doc.roundedRect(x, top, w, 22, 6).fill(C.panel);
    doc.restore();
    doc
      .fillColor(C.text)
      .fontSize(9)
      .text(`${sn.title}  ·  ${sn.language}`, x + 10, top + 6, {
        width: w - 20,
        lineBreak: false,
      });
    let y = top + 26;
    if (sn.why) {
      doc.fillColor(C.muted).fontSize(8).text(sn.why, x + 2, y, { width: w - 4 });
      y = doc.y + 4;
    }

    const codeLines = sn.code.split('\n');
    const codeH = Math.min(130, codeLines.length * 11 + 14);
    ensureSpace(doc, codeH + 8);
    y = doc.y;
    doc.save();
    doc.roundedRect(x, y, w, codeH, 6).fill(C.codeBg);
    doc.restore();
    doc.fillColor(C.codeFg).fontSize(8).text(sn.code, x + 10, y + 7, {
      width: w - 20,
      lineGap: 1.5,
    });
    doc.x = x;
    doc.y = y + codeH + 12;
  }
}

function writeStepRow(
  doc: PdfDoc,
  step: TestStep,
  opts?: { emphasize?: boolean; includeScreenshot?: boolean },
) {
  const wantShot =
    opts?.includeScreenshot === false
      ? false
      : Boolean(
          opts?.emphasize || step.status === 'failed' || opts?.includeScreenshot,
        );
  const hasShot =
    Boolean(step.screenshotPath) &&
    wantShot &&
    existsSync(path.join(DATA_DIR, step.screenshotPath!));
  ensureSpace(doc, hasShot ? 230 : 52);

  const x = left(doc);
  const w = innerW(doc);
  const top = doc.y;
  const isFail = step.status === 'failed' || opts?.emphasize;
  const statusColor =
    step.status === 'passed'
      ? C.pass
      : step.status === 'failed'
        ? C.fail
        : step.status === 'skipped'
          ? C.skip
          : C.muted;

  // Measure content height
  doc.fontSize(9.5);
  let contentH = 16; // status + label
  if (step.description) {
    contentH += doc.heightOfString(`Purpose: ${step.description}`, { width: w - 24 }) + 2;
  }
  if (step.message) {
    contentH += doc.heightOfString(step.message, { width: w - 24 }) + 2;
  }
  if (step.detail && isFail) {
    contentH += doc.heightOfString(step.detail, { width: w - 24 }) + 2;
  }
  contentH += 12; // duration line
  const rowH = Math.max(36, contentH + 12);

  doc.save();
  doc
    .roundedRect(x, top, w, rowH, 6)
    .fillAndStroke(isFail ? C.failBg : C.panel, isFail ? C.failBorder : C.line);
  doc.restore();

  // Status pill
  const pillW = pill(doc, step.status, {
    x: x + 8,
    y: top + 8,
    bg: isFail ? C.failBg : step.status === 'passed' ? C.passBg : C.skipBg,
    fg: statusColor,
    border: isFail ? C.failBorder : step.status === 'passed' ? C.passBorder : C.skipBorder,
  });

  doc
    .fillColor(C.text)
    .fontSize(10)
    .text(step.label, x + 8 + pillW + 8, top + 9, {
      width: w - pillW - 80,
      lineBreak: false,
    });
  doc
    .fillColor(C.muted)
    .fontSize(8)
    .text(stepDuration(step), x + w - 54, top + 10, { width: 44, align: 'right', lineBreak: false });

  let cy = top + 28;
  if (step.description) {
    doc.fillColor(C.muted).fontSize(8).text(`Purpose: ${step.description}`, x + 10, cy, {
      width: w - 20,
    });
    cy = doc.y + 2;
  }
  if (step.message) {
    doc
      .fillColor(isFail ? C.fail : C.text)
      .fontSize(8.5)
      .text(`Result: ${step.message}`, x + 10, cy, { width: w - 20 });
    cy = doc.y + 2;
  }
  if (step.detail && isFail) {
    doc.fillColor(C.muted).fontSize(8).text(step.detail, x + 10, cy, { width: w - 20 });
    cy = doc.y + 2;
  }

  doc.x = x;
  doc.y = top + rowH + 6;

  if (hasShot) {
    ensureSpace(doc, 200);
    doc
      .fillColor(C.muted)
      .fontSize(8)
      .text(
        step.status === 'failed'
          ? 'Failure screenshot (highlighted mismatch)'
          : 'Browser screenshot (MCP view)',
      );
    doc.moveDown(0.15);
    try {
      const abs = path.join(DATA_DIR, step.screenshotPath!);
      const imgTop = doc.y;
      doc.image(abs, {
        fit: [innerW(doc), 240],
      });
      // border around image area
      void imgTop;
      doc.moveDown(0.35);
    } catch {
      doc.fillColor(C.fail).fontSize(8).text('(Screenshot could not be embedded)');
    }
  }
}

function writeFooters(doc: PdfDoc, report: RunReport) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const pageNo = i + 1;
    const footerY = doc.page.height - 28;
    doc
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(
        `${report.testName || report.testId}  ·  ${report.runId.slice(0, 8)}  ·  Page ${pageNo} of ${range.count}`,
        left(doc),
        footerY,
        { width: innerW(doc), align: 'center', lineBreak: false },
      );
  }
}

function writeLoadGrade(doc: PdfDoc, report: RunReport) {
  const g = report.loadGradeSummary;
  if (!g) return;

  const limSource = {
    maxErrorRatePct: g.thresholds.maxErrorRatePct,
    p50Ms: g.thresholds.p50Ms,
    p75Ms: g.thresholds.p75Ms,
    p90Ms: g.thresholds.p90Ms,
    p95Ms: g.thresholds.p95Ms,
    p99Ms: g.thresholds.p99Ms,
    avgMs: g.thresholds.avgMs,
    maxAvgLatencyMs: g.thresholds.avgLatencyMs,
    maxAvgConnectMs: g.thresholds.avgConnectMs,
    virtualUsers: g.thresholds.virtualUsers,
    durationSec: g.thresholds.durationSec,
  };

  const x = left(doc);
  const w = innerW(doc);

  sectionHeading(doc, `Performance grade · ${g.label}`);
  ensureSpace(doc, 70);
  doc.fillColor(C.text).fontSize(11).text(`${g.label}  (score ${g.score}/100)`, x, doc.y, {
    width: w,
  });
  doc.moveDown(0.25);
  doc.fillColor(C.muted).fontSize(9).text(g.summary, { width: w });
  doc.moveDown(0.2);
  doc.fillColor(C.muted).fontSize(9).text(`Why it matters: ${g.importance}`, { width: w });
  doc.moveDown(0.4);

  sectionHeading(doc, 'Current thresholds');
  for (const row of listConfiguredThresholdRows(limSource)) {
    ensureSpace(doc, 22);
    doc
      .fillColor(C.text)
      .fontSize(9)
      .text(`${row.label}`, x, doc.y, { continued: true, width: w * 0.45 });
    doc
      .fillColor(C.muted)
      .fontSize(9)
      .text(`  ${row.limit}  ·  ${row.category}`, { width: w * 0.55 });
    doc.moveDown(0.12);
  }
  doc.moveDown(0.3);

  sectionHeading(doc, 'Thresholds · required vs this run');
  for (const row of g.metrics) {
    ensureSpace(doc, 28);
    const mark = row.passed ? 'PASS' : 'FAIL';
    doc
      .fillColor(row.passed ? C.pass : C.fail)
      .fontSize(8.5)
      .text(mark, x, doc.y, { continued: true, width: 36 });
    doc
      .fillColor(C.text)
      .fontSize(9)
      .text(
        `  ${row.label}  ·  required ${row.required}  ·  actual ${row.actual}  ·  ${row.importance}`,
        {
          width: w - 40,
        },
      );
    doc.moveDown(0.15);
  }
  doc.moveDown(0.25);
}

function writeLoadMetrics(doc: PdfDoc, report: RunReport) {
  const m = report.loadMetrics;
  if (!m) return;

  writeLoadGrade(doc, report);

  sectionHeading(doc, 'JMeter load metrics');
  const x = left(doc);
  const w = innerW(doc);
  const rows: [string, string][] = [
    ['Engine', m.engine || 'jmeter'],
    ['Requests', String(m.totalRequests)],
    ['RPS', String(m.rps)],
    ['Threads', `${m.jmeterThreads ?? m.activeUsers}/${m.virtualUsers}`],
    ['Elapsed', `${m.elapsedSec}s`],
    ['Success / Error %', `${m.successRatePct ?? 100 - m.errorRatePct}% / ${m.errorRatePct}%`],
    ['OK / Errors', `${m.successCount} / ${m.errorCount}`],
    [
      'Avg / Min / Max',
      `${m.avgMs} / ${m.minMs ?? '—'} / ${m.maxMs ?? '—'} ms`,
    ],
    ['Stddev', `${m.stddevMs ?? '—'} ms`],
    [
      'p50 / p75 / p90',
      `${m.p50Ms} / ${m.p75Ms ?? '—'} / ${m.p90Ms ?? '—'} ms`,
    ],
    ['p95 / p99', `${m.p95Ms} / ${m.p99Ms} ms`],
  ];
  if (m.avgLatencyMs != null) rows.push(['Avg TTFB (latency)', `${m.avgLatencyMs} ms`]);
  if (m.avgConnectMs != null) rows.push(['Avg Connect', `${m.avgConnectMs} ms`]);
  if (m.bytesPerSec != null) rows.push(['Bytes/s', String(m.bytesPerSec)]);
  if (m.kbPerSec != null) rows.push(['KB/s', String(m.kbPerSec)]);
  if (m.totalBytes != null) rows.push(['Total bytes', String(m.totalBytes)]);
  if (m.sentBytesPerSec != null) rows.push(['Sent B/s', String(m.sentBytesPerSec)]);
  if (m.sentBytesTotal != null) rows.push(['Sent total', String(m.sentBytesTotal)]);
  const statusLine = Object.keys(m.statusCounts || {}).length
    ? Object.entries(m.statusCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(' · ')
    : '—';
  rows.push(['Status codes', statusLine]);

  const rowH = 14;
  const boxH = rows.length * rowH + 16;
  ensureSpace(doc, boxH + 24);
  const top = doc.y;
  doc.save();
  doc.roundedRect(x, top, w, boxH, 8).fillAndStroke(C.panel, C.line);
  doc.restore();

  let y = top + 8;
  for (const [label, value] of rows) {
    doc.fillColor(C.muted).fontSize(8).text(label, x + 12, y, { width: 140, lineBreak: false });
    doc
      .fillColor(C.text)
      .fontSize(9)
      .text(value, x + 155, y, { width: w - 170, lineBreak: false });
    y += rowH;
  }
  doc.x = x;
  doc.y = top + boxH + 10;

  const arts = [m.jmxPath && `JMX: ${m.jmxPath}`, m.jtlPath && `JTL: ${m.jtlPath}`, m.reportDir && `HTML: ${m.reportDir}`]
    .filter(Boolean)
    .join('  ·  ');
  if (arts) {
    doc.fillColor(C.muted).fontSize(7.5).text(arts, { width: w });
    doc.moveDown(0.4);
  }

  if (m.recentErrors?.length) {
    sectionHeading(doc, 'Recent errors (request / response)');
    const errors = m.recentErrors.slice(-15);
    for (const e of errors) {
      ensureSpace(doc, 48);
      const title = [
        e.method,
        e.label,
        e.status ? `HTTP ${e.status}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      doc.fillColor(C.fail).fontSize(9).text(title, { width: w });
      if (e.url) {
        doc.fillColor(C.muted).fontSize(7.5).text(e.url, { width: w });
      }
      doc.fillColor(C.text).fontSize(8).text(e.message, { width: w });
      doc.moveDown(0.35);
    }
  }
}

function writeLoadAuth(doc: PdfDoc, report: RunReport) {
  const a = report.loadAuth;
  if (!a) return;

  sectionHeading(doc, 'Authorization & Swagger');
  const x = left(doc);
  const w = innerW(doc);
  const rows: [string, string][] = [
    ['Auth required', a.requiresAuth ? 'Yes' : 'No'],
    [
      'Tokens obtained',
      a.tokenObtained
        ? `Yes · ${a.tokenCount}`
        : a.requiresAuth
          ? 'No'
          : 'N/A',
    ],
  ];
  if (a.credentialLabels?.length) {
    rows.push(['Credentials used', a.credentialLabels.join(', ')]);
  }
  if (a.loginPath) rows.push(['Login path', a.loginPath]);
  if (a.authHeaderName) rows.push(['Auth header', a.authHeaderName]);
  if (a.swaggerUrl) rows.push(['Swagger URL', a.swaggerUrl]);
  if (a.apiOnly) {
    rows.push(['Engine', 'JMeter only (no MCP browser / screenshots)']);
  }
  if (a.selectedOperations?.length) {
    rows.push([
      'APIs tested',
      a.selectedOperations.map((o) => `${o.method} ${o.path}`).join(' · '),
    ]);
  }
  if (a.error) rows.push(['Auth error', a.error]);
  rows.push(['Note', 'Passwords and raw tokens are never stored in reports']);

  const rowH = 14;
  const boxH = rows.length * rowH + 16;
  ensureSpace(doc, boxH + 24);
  const top = doc.y;
  doc.save();
  doc.roundedRect(x, top, w, boxH, 8).fillAndStroke(C.panel, C.line);
  doc.restore();

  let y = top + 8;
  for (const [label, value] of rows) {
    doc.fillColor(C.muted).fontSize(8).text(label, x + 12, y, { width: 140, lineBreak: false });
    doc
      .fillColor(label === 'Auth error' ? C.fail : C.text)
      .fontSize(9)
      .text(value, x + 155, y, { width: w - 170, lineBreak: false });
    y += rowH;
  }
  doc.x = x;
  doc.y = top + boxH + 10;
}

function writeVaptFindings(doc: PdfDoc, report: RunReport) {
  const m = report.vaptFindings;
  if (!m) return;

  sectionHeading(doc, 'API VAPT findings');
  const x = left(doc);
  const w = innerW(doc);
  const sev = m.bySeverity || {};
  const summaryRows: [string, string][] = [
    ['Engine', m.engine || 'api-vapt'],
    ['Target', m.targetUrl || report.baseUrl || '—'],
    ['Checked / Passed / Failed', `${m.checked} / ${m.passed} / ${m.failed}`],
    ['Info / Errors', `${m.info} / ${m.errors}`],
    ['Network captures', String(m.networkCaptures?.length || 0)],
    [
      'By severity',
      ['critical', 'high', 'medium', 'low', 'info']
        .map((k) => {
          const n = sev[k as keyof typeof sev];
          return n ? `${k}:${n}` : null;
        })
        .filter(Boolean)
        .join(' · ') || '—',
    ],
  ];

  const rowH = 14;
  const boxH = summaryRows.length * rowH + 16;
  ensureSpace(doc, boxH + 24);
  const top = doc.y;
  doc.save();
  doc.roundedRect(x, top, w, boxH, 8).fillAndStroke(C.panel, C.line);
  doc.restore();

  let y = top + 8;
  for (const [label, value] of summaryRows) {
    doc.fillColor(C.muted).fontSize(8).text(label, x + 12, y, { width: 150, lineBreak: false });
    doc
      .fillColor(C.text)
      .fontSize(9)
      .text(value, x + 165, y, { width: w - 180, lineBreak: false });
    y += rowH;
  }
  doc.x = x;
  doc.y = top + boxH + 10;

  const findings = m.findings || [];
  if (!findings.length) {
    doc.fillColor(C.muted).fontSize(9).text('No findings recorded.');
    doc.moveDown(0.35);
  } else {
    sectionHeading(doc, 'Per-attack detail & remediation');
    for (const f of findings) {
      ensureSpace(doc, 88);
      const statusColor =
        f.status === 'fail' || f.status === 'error'
          ? C.fail
          : f.status === 'pass'
            ? C.pass
            : C.muted;
      doc.fillColor(C.text).fontSize(10).text(f.title, { continued: true });
      doc
        .fillColor(statusColor)
        .text(`  [${f.checkId || 'check'} · ${f.severity} · ${f.status}]`);
      doc
        .fillColor(C.muted)
        .fontSize(8)
        .text([f.category, f.owasp, f.cwe].filter(Boolean).join(' · ') || '—');
      if (f.requestUrl) {
        doc
          .fillColor(C.text)
          .fontSize(8)
          .text(
            `${f.requestMethod || 'REQ'} ${f.requestUrl} → ${f.responseStatus ?? '—'}`,
            { width: w },
          );
      }
      if (f.requestPayload) {
        doc
          .fillColor(C.muted)
          .fontSize(7.5)
          .text(`Payload: ${f.requestPayload.slice(0, 320)}`, { width: w });
      }
      if (f.responseSnippet) {
        doc
          .fillColor(C.muted)
          .fontSize(7.5)
          .text(`Response: ${f.responseSnippet.slice(0, 320)}`, { width: w });
      }
      if (f.evidence) {
        doc.fillColor(C.text).fontSize(8).text(`Evidence: ${f.evidence.slice(0, 400)}`, {
          width: w,
        });
      }
      if (f.recommendation) {
        doc
          .fillColor(C.text)
          .fontSize(8)
          .text(`Remediation: ${f.recommendation.slice(0, 400)}`, { width: w });
      }
      doc.moveDown(0.3);
    }
  }

  const nets = m.networkCaptures || [];
  if (nets.length) {
    sectionHeading(doc, 'Network tab (API URL + payload)');
    for (const n of nets.slice(0, 40)) {
      ensureSpace(doc, 42);
      doc
        .fillColor(C.text)
        .fontSize(8.5)
        .text(
          `[${n.source}] ${n.method} ${n.status ?? '—'}  ${n.url.slice(0, 90)}`,
          { width: w },
        );
      if (n.requestPayload) {
        doc
          .fillColor(C.muted)
          .fontSize(7)
          .text(`req: ${n.requestPayload.slice(0, 220)}`, { width: w });
      }
      if (n.responseSnippet) {
        doc
          .fillColor(C.muted)
          .fontSize(7)
          .text(`res: ${n.responseSnippet.slice(0, 220)}`, { width: w });
      }
      doc.moveDown(0.2);
    }
  }
}

function writeReportBody(doc: PdfDoc, report: RunReport) {
  const steps = report.steps || [];
  const apiErrors = report.apiErrors || [];
  const countries = report.countryResults || [];
  const counts = report.stepCounts || {
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    completed: 0,
    inProgress: 0,
    remaining: 0,
  };
  const failedSteps = steps.filter((s) => s.status === 'failed');
  const isFail = report.status === 'failed' || failedSteps.length > 0;
  const ai = report.aiSummary;
  const isLoad = Boolean(report.loadMetrics || report.loadAuth);
  const isVapt = Boolean(report.vaptFindings);
  /** Swagger/API load: no MCP browser screenshots in the PDF. */
  const isApiLoad =
    Boolean(report.loadAuth?.apiOnly) ||
    Boolean(report.loadAuth?.swaggerUrl) ||
    (isLoad && !steps.some((s) => s.id === 'load-mcp'));

  writeHeader(doc, report, isFail);
  writeStats(doc, counts);
  writeVaptFindings(doc, report);
  writeLoadAuth(doc, report);
  writeLoadMetrics(doc, report);
  writeFlowChart(doc, report);

  if (report.error) {
    ensureSpace(doc, 28);
    doc.fillColor(C.fail).fontSize(9.5).text(report.error);
    doc.moveDown(0.35);
  }

  writeSummaryCard(doc, report, isFail);

  if (isFail && failedSteps.length) {
    sectionHeading(
      doc,
      isApiLoad ? 'Failed steps' : 'Failed steps (with screenshots)',
    );
    for (const step of failedSteps) {
      writeStepRow(doc, step, {
        emphasize: true,
        includeScreenshot: !isApiLoad,
      });
    }
  }

  writeSnippets(doc, ai, isFail);

  if (!isLoad && !isVapt && countries.length) {
    sectionHeading(doc, 'Country results');
    for (const c of countries) {
      ensureSpace(doc, 40);
      const color =
        c.status === 'passed' ? C.pass : c.status === 'failed' ? C.fail : C.skip;
      doc.fillColor(C.text).fontSize(10).text(`${c.countryName} (${c.isoCode})  `, {
        continued: true,
      });
      doc.fillColor(color).text(c.status);
      if (c.message) doc.fillColor(C.muted).fontSize(8).text(c.message);
      doc
        .fillColor(C.muted)
        .fontSize(8)
        .text(
          `Steps: ${c.stepsSummary.passed}p / ${c.stepsSummary.failed}f / ${c.stepsSummary.skipped}s${c.retried ? ' · retried' : ''}`,
        );
      doc.moveDown(0.2);
    }
  }

  sectionHeading(
    doc,
    isVapt
      ? 'VAPT steps & screenshots'
      : isLoad
        ? isApiLoad
          ? 'Load steps'
          : 'Load steps & screenshots'
        : 'Full step log',
  );
  if (!steps.length) {
    doc.fillColor(C.muted).fontSize(9).text('No steps stored for this report.');
  } else {
    for (const step of steps) {
      writeStepRow(doc, step, {
        emphasize: step.status === 'failed',
        includeScreenshot:
          !isApiLoad &&
          (isVapt || isLoad || Boolean(step.screenshotPath)),
      });
    }
  }

  if (!isLoad && !isVapt) {
    sectionHeading(doc, 'API errors');
    if (!apiErrors.length) {
      doc.fillColor(C.muted).fontSize(9).text('No API errors recorded.');
    } else {
      for (const e of apiErrors) {
        ensureSpace(doc, 48);
        const x = left(doc);
        const w = innerW(doc);
        const top = doc.y;
        doc.save();
        doc.roundedRect(x, top, w, 44, 6).fillAndStroke(C.failBg, C.failBorder);
        doc.restore();
        doc
          .fillColor(C.text)
          .fontSize(9)
          .text(
            `${e.method || 'REQ'} ${e.status != null ? `HTTP ${e.status}` : 'Network'}`,
            x + 10,
            top + 8,
            { width: w - 20, lineBreak: false },
          );
        doc.fillColor(C.fail).fontSize(8).text(e.message, x + 10, top + 22, { width: w - 20 });
        doc.y = top + 50;
      }
    }
  }

  writeFooters(doc, report);
}

export async function generateReportPdf(report: RunReport): Promise<string> {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const abs = reportPdfAbsolutePath(report.runId);
  const rel = reportPdfRelativePath(report.runId);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      bufferPages: true,
      info: {
        Title: `${report.testName} — ${report.status}`,
        Author: 'LGD Playwright MCP',
        Subject: `Test report ${report.runId}`,
      },
    });
    const stream = createWriteStream(abs);
    doc.pipe(stream);
    doc.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', () => resolve());

    try {
      writeReportBody(doc, report);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });

  return rel;
}
