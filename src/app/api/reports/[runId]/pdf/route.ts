import { NextResponse } from 'next/server';
import { getReportPdfBuffer } from '@/server/run-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const buf = await getReportPdfBuffer(runId);
  if (!buf) {
    return NextResponse.json({ error: 'PDF not found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="lgd-test-report-${runId.slice(0, 8)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
