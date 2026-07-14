import { NextResponse } from 'next/server';
import { listAllWebTestMetas, listWebTestMetasByRole } from '@/server/web-test-store';
import { listWebLoadCases } from '@/server/web-load-store';
import { listVaptCases } from '@/server/vapt-store';
import { MOBILE_TEST_CASES } from '@/lib/mobile-test-registry';
import { isWebFlowId } from '@/lib/web-flows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'web';
  const role = searchParams.get('role') || '';

  if (mode === 'mobile') {
    return NextResponse.json({ cases: MOBILE_TEST_CASES });
  }

  if (mode === 'web-load') {
    return NextResponse.json({ cases: listWebLoadCases() });
  }

  if (mode === 'vapt') {
    return NextResponse.json({ cases: listVaptCases() });
  }

  if (role && isWebFlowId(role)) {
    return NextResponse.json({ cases: listWebTestMetasByRole(role), role });
  }

  const cases = listAllWebTestMetas();
  return NextResponse.json({ cases });
}
