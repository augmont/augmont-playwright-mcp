import { NextResponse } from 'next/server';
import { deleteWebFlowCase, getWebFlowCase } from '@/server/web-test-store';
import { deleteWebLoadCase, getWebLoadCase } from '@/server/web-load-store';
import { deleteVaptCase, getVaptCase } from '@/server/vapt-store';
import { isSignupLoginTestId } from '@/lib/test-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ testId: string }> },
) {
  const { testId } = await context.params;
  const vapt = getVaptCase(testId);
  if (vapt) {
    return NextResponse.json({ case: vapt });
  }
  const load = getWebLoadCase(testId);
  if (load) {
    return NextResponse.json({ case: load });
  }
  const test = getWebFlowCase(testId);
  if (!test) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ case: test });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ testId: string }> },
) {
  const { testId } = await context.params;
  if (isSignupLoginTestId(testId)) {
    return NextResponse.json(
      { error: 'Cannot delete the built-in Signup & Login suite' },
      { status: 400 },
    );
  }
  if (deleteVaptCase(testId)) {
    return NextResponse.json({ ok: true });
  }
  if (deleteWebLoadCase(testId)) {
    return NextResponse.json({ ok: true });
  }
  const ok = deleteWebFlowCase(testId);
  if (!ok) {
    return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
