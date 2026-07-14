import { NextResponse } from 'next/server';
import {
  normalizeWebLoadCases,
  upsertWebLoadCases,
} from '@/server/web-load-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    cases?: unknown;
    source?: string;
  };

  const source = body.source === 'upload' ? 'upload' : 'claude';
  const cases = normalizeWebLoadCases(body.cases, source);
  if (!cases.length) {
    return NextResponse.json({ error: 'No valid load cases to save' }, { status: 400 });
  }

  try {
    const upsert = upsertWebLoadCases(cases, source);
    return NextResponse.json({
      ok: true,
      added: upsert.added,
      replaced: upsert.replaced,
      cases: upsert.cases.filter((c) =>
        [...upsert.added, ...upsert.replaced].includes(c.id),
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Apply failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
