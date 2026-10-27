import { NextResponse } from 'next/server';
import {
  normalizeVaptCases,
  upsertVaptCases,
} from '@/server/vapt-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    cases?: unknown;
    source?: string;
  };

  const source =
    body.source === 'upload'
      ? 'upload'
      : body.source === 'manual'
        ? 'manual'
        : body.source === 'seed'
          ? 'seed'
          : 'claude';
  const cases = normalizeVaptCases(body.cases, source);
  if (!cases.length) {
    return NextResponse.json({ error: 'No valid VAPT cases to save' }, { status: 400 });
  }

  try {
    const upsert = upsertVaptCases(cases, source);
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
