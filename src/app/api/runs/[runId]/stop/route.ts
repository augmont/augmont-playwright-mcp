import { NextResponse } from 'next/server';
import { getSession, stopSession, toSnapshot } from '@/server/session-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const session = getSession(runId);
  if (!session) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  stopSession(runId);
  return NextResponse.json({ ok: true, snapshot: toSnapshot(session) });
}
