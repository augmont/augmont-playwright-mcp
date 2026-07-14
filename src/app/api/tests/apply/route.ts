import { NextResponse } from 'next/server';
import { normalizeWebTestCases, upsertWebTestCases } from '@/server/web-test-store';
import { ensureCombinedSuites } from '@/lib/test-expectation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    cases?: unknown;
    source?: string;
  };

  const source = body.source === 'upload' ? 'upload' : 'claude';
  const cases = ensureCombinedSuites(normalizeWebTestCases(body.cases, source));
  if (!cases.length) {
    return NextResponse.json({ error: 'No valid test cases to save' }, { status: 400 });
  }

  try {
    const upsert = upsertWebTestCases(cases, source);
    return NextResponse.json({
      ok: true,
      added: upsert.added,
      replaced: upsert.replaced,
      cases: upsert.cases.filter((c) => [...upsert.added, ...upsert.replaced].includes(c.id)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Apply failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
