import { NextResponse } from 'next/server';
import type { RoleCredentialsMap } from '@/lib/role-credentials';
import {
  startRecordSession,
  closeRecordSession,
  recordSessionPublicState,
} from '@/server/record-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type StartBody = {
  baseUrl?: string;
  role?: string;
  startPath?: string;
  hint?: string;
  name?: string;
  roleCredentials?: {
    buyer?: { email?: string; password?: string };
    admin?: { email?: string; password?: string };
    seller?: { email?: string; password?: string };
  };
};

function roleHintFrom(role?: string) {
  return role === 'public' || role === 'buyer' || role === 'seller' || role === 'admin'
    ? role
    : undefined;
}

function sanitizeRoleCredentials(
  raw?: StartBody['roleCredentials'],
): RoleCredentialsMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: RoleCredentialsMap = {};
  for (const key of ['buyer', 'admin', 'seller'] as const) {
    const c = raw[key];
    const email = (c?.email || '').trim();
    const password = c?.password || '';
    if (email && password) out[key] = { email, password };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Start an interactive MCP click-flow recording session. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as StartBody;
  const baseUrl = (body.baseUrl || '').trim();
  if (!baseUrl) {
    return NextResponse.json({ error: 'baseUrl is required' }, { status: 400 });
  }

  try {
    const result = await startRecordSession({
      baseUrl,
      role: roleHintFrom(body.role),
      credentials: sanitizeRoleCredentials(body.roleCredentials),
      startPath: body.startPath,
      hint: body.hint || body.name || body.role || '',
    });
    return NextResponse.json({
      ok: true,
      ...result,
      session: recordSessionPublicState(result.sessionId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start MCP record session' },
      { status: 500 },
    );
  }
}

/** Stop / discard a recording session via ?sessionId= */
export async function DELETE(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId') || '';
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  await closeRecordSession(sessionId);
  return NextResponse.json({ ok: true });
}
