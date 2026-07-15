import { NextResponse } from 'next/server';
import { deleteWebFlowCase, getWebFlowCase } from '@/server/web-test-store';
import {
  deleteWebLoadCase,
  getWebLoadCase,
  upsertWebLoadCase,
} from '@/server/web-load-store';
import { deleteVaptCase, getVaptCase } from '@/server/vapt-store';
import { isSignupLoginTestId } from '@/lib/test-registry';
import type { WebLoadHttpMethod, WebLoadRequestStep } from '@/lib/types';

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ testId: string }> },
) {
  const { testId } = await context.params;
  const existing = getWebLoadCase(testId);
  if (!existing) {
    return NextResponse.json(
      { error: 'Only web-load cases can be edited here' },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    load?: Partial<typeof existing.load> & {
      requests?: WebLoadRequestStep[];
    };
  };

  const METHODS: WebLoadHttpMethod[] = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
  ];

  const nextLoad = { ...existing.load, ...(body.load || {}) };
  if (body.load?.method && !METHODS.includes(body.load.method as WebLoadHttpMethod)) {
    nextLoad.method = existing.load.method;
  }
  if (body.load?.apiBaseUrl !== undefined) {
    nextLoad.apiBaseUrl =
      String(body.load.apiBaseUrl || '')
        .trim()
        .replace(/\/+$/, '') || undefined;
  }
  if (body.load?.swaggerUrl !== undefined) {
    nextLoad.swaggerUrl = String(body.load.swaggerUrl || '').trim() || undefined;
  }
  if (Array.isArray(body.load?.requests)) {
    // Pass full request objects through — normalizeCase cleans extracts, mappings, body modes, etc.
    nextLoad.requests = body.load.requests as WebLoadRequestStep[];
    if (!nextLoad.requests.length) nextLoad.requests = undefined;
    nextLoad.profile =
      (nextLoad.requests?.length || 0) > 1 ? 'advanced' : nextLoad.profile || 'basic';
  }

  const updated = upsertWebLoadCase({
    ...existing,
    id: existing.id,
    name: body.name != null ? String(body.name).trim() || existing.name : existing.name,
    description:
      body.description != null
        ? String(body.description).trim() || existing.description
        : existing.description,
    load: nextLoad,
    source: existing.source === 'seed' ? 'upload' : existing.source,
  });

  if (!updated) {
    return NextResponse.json({ error: 'Failed to update case' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, case: updated });
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
