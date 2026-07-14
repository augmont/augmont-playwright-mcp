import { getSession } from '@/server/session-manager';
import { getInspectFrame } from '@/server/inspect-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const session = getSession(runId);
  const frame = session?.latestFrame || getInspectFrame(runId);
  if (!frame) {
    return new Response(null, { status: 204 });
  }

  return new Response(new Uint8Array(frame), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
