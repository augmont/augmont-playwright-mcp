import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getReport } from '@/server/run-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; file: string }> },
) {
  const { runId, file } = await context.params;
  // Prevent path traversal
  const safe = path.basename(file || '');
  if (!safe || !/\.(png|jpe?g|webp)$/i.test(safe)) {
    return NextResponse.json({ error: 'Invalid screenshot' }, { status: 400 });
  }

  const report = await getReport(runId);
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  const rel = path.join('reports', runId, safe);
  const owned = (report.steps || []).some((s) => s.screenshotPath === rel);
  if (!owned) {
    // Still allow if file exists under this run folder (legacy / partial)
    const abs = path.join(DATA_DIR, rel);
    try {
      const buf = await fs.readFile(abs);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 });
    }
  }

  try {
    const buf = await fs.readFile(path.join(DATA_DIR, rel));
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 });
  }
}
