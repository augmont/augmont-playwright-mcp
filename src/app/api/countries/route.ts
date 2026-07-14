import { NextResponse } from 'next/server';
import { fetchCountries } from '@/server/location-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const apiUrl = (searchParams.get('apiUrl') || '').trim();
  if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
    return NextResponse.json(
      { error: 'Valid apiUrl query param (http/https) is required' },
      { status: 400 },
    );
  }

  try {
    const countries = await fetchCountries(apiUrl);
    return NextResponse.json({ countries });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load countries';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
