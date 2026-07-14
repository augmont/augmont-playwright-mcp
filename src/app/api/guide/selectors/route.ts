import { NextResponse } from 'next/server';
import {
  clearGuideSelectors,
  deleteGuideSelector,
  listGuideSelectors,
  upsertGuideSelectors,
  type GuideSelectorEntry,
} from '@/server/selector-guide-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ entries: listGuideSelectors() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      entries?: Array<Partial<GuideSelectorEntry> & { selector: string }>;
      clear?: boolean;
    };
    if (body.clear) {
      return NextResponse.json({ entries: clearGuideSelectors(), added: 0 });
    }
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (!entries.length) {
      return NextResponse.json(
        { error: 'Provide entries: [{ selector, dataId?, … }]' },
        { status: 400 },
      );
    }
    const result = upsertGuideSelectors(entries);
    return NextResponse.json({
      ok: true,
      added: result.added,
      entries: result.entries,
      message: `Saved ${result.added} new selector(s) to AI guide (${result.entries.length} total)`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save selectors' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    const entries = deleteGuideSelector(id);
    return NextResponse.json({ ok: true, entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete' },
      { status: 500 },
    );
  }
}
