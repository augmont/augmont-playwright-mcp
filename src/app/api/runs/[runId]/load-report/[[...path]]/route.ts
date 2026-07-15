import { existsSync, promises as fs, statSync } from 'fs';
import path from 'path';
import { getSession } from '@/server/session-manager';
import { getReport } from '@/server/run-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOAD_RUNS = path.join(process.cwd(), 'data', 'load-runs');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function safeUnderRun(runId: string, candidate: string): string | null {
  const allowed = path.normalize(path.join(LOAD_RUNS, runId));
  const normalized = path.normalize(candidate);
  if (!normalized.startsWith(allowed)) return null;
  return existsSync(normalized) ? normalized : null;
}

async function resolveReportRoot(runId: string): Promise<string | null> {
  const session = getSession(runId);
  const fromSession = session?.loadMetrics?.reportDir;
  const report = await getReport(runId);
  const fromReport = report?.loadMetrics?.reportDir;

  for (const rel of [fromSession, fromReport]) {
    if (!rel) continue;
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    const ok = safeUnderRun(runId, abs);
    if (ok) return ok;
  }

  const fallback = path.join(LOAD_RUNS, runId, 'html-report');
  return existsSync(fallback) ? fallback : null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; path?: string[] }> },
) {
  const { runId, path: parts } = await context.params;
  if (!runId || /[^a-zA-Z0-9_-]/.test(runId)) {
    return new Response('Invalid run id', { status: 400 });
  }

  const root = await resolveReportRoot(runId);
  if (!root || !existsSync(root)) {
    return new Response(
      'JMeter HTML report not ready yet. Finish a load run first.',
      { status: 404 },
    );
  }

  const relPath =
    parts && parts.length
      ? parts.map((p) => decodeURIComponent(p)).join('/')
      : 'index.html';
  if (relPath.includes('..')) {
    return new Response('Forbidden', { status: 403 });
  }

  let filePath = path.normalize(path.join(root, relPath));
  if (!filePath.startsWith(path.normalize(root))) {
    return new Response('Forbidden', { status: 403 });
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    return new Response('Not found', { status: 404 });
  }

  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  return new Response(buf, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}
