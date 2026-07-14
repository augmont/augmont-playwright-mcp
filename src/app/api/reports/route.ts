import { NextResponse } from 'next/server';
import { listReports } from '@/server/run-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const reports = await listReports();
  return NextResponse.json({ reports });
}
