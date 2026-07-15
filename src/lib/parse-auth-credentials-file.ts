import type { LoadAuthCredential } from '@/lib/types';
import { emptyLoadCredential } from '@/lib/load-auth-credentials';

export type AuthCredImportMode = 'replace' | 'append';

const USERNAME_KEYS = new Set([
  'username',
  'user',
  'email',
  'mobile',
  'mobilenumber',
  'mobile_number',
  'phone',
  'login',
  'userid',
  'user_id',
  'user name',
]);

const PASSWORD_KEYS = new Set([
  'password',
  'pass',
  'pwd',
  'passwd',
  'secret',
  'userpassword',
  'user_password',
]);

const LABEL_KEYS = new Set([
  'label',
  'name',
  'displayname',
  'display_name',
  'userlabel',
  'title',
]);

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '');
}

/** RFC-ish CSV line split (supports quoted fields). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseCsvText(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  return lines.map(splitCsvLine);
}

function mapRowsToCredentials(rows: string[][]): {
  credentials: LoadAuthCredential[];
  skipped: number;
} {
  if (!rows.length) return { credentials: [], skipped: 0 };

  const first = rows[0]!.map((c) => normHeader(c));
  const hasHeader =
    first.some((h) => USERNAME_KEYS.has(h) || PASSWORD_KEYS.has(h)) ||
    first.includes('username') ||
    first.includes('password') ||
    first.includes('email') ||
    first.includes('mobile');

  let userIdx = 0;
  let passIdx = 1;
  let labelIdx = -1;
  let dataStart = 0;

  if (hasHeader) {
    dataStart = 1;
    userIdx = first.findIndex((h) => USERNAME_KEYS.has(h));
    passIdx = first.findIndex((h) => PASSWORD_KEYS.has(h));
    labelIdx = first.findIndex((h) => LABEL_KEYS.has(h));
    if (userIdx < 0) userIdx = 0;
    if (passIdx < 0) passIdx = userIdx === 0 ? 1 : 0;
  } else if (rows[0]!.length >= 3) {
    // username, password, label (common without header)
    labelIdx = 2;
  }

  const credentials: LoadAuthCredential[] = [];
  let skipped = 0;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]!;
    const username = String(row[userIdx] ?? '').trim();
    const password = String(row[passIdx] ?? '');
    if (!username || !password) {
      skipped += 1;
      continue;
    }
    const labelRaw =
      labelIdx >= 0 ? String(row[labelIdx] ?? '').trim() : '';
    const cred = emptyLoadCredential(labelRaw || `User ${credentials.length + 1}`);
    cred.username = username;
    cred.password = password;
    credentials.push(cred);
  }

  return { credentials, skipped };
}

async function rowsFromExcel(file: File): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const data = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown as (string | number | boolean | null)[][];
  return data.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) =>
      cell == null ? '' : String(cell).trim(),
    ),
  );
}

export function mergeImportedCredentials(
  existing: LoadAuthCredential[],
  imported: LoadAuthCredential[],
  mode: AuthCredImportMode,
): LoadAuthCredential[] {
  if (mode === 'replace') {
    return imported.length ? imported : existing;
  }
  const kept = existing.filter((c) => c.username.trim() && c.password);
  const seen = new Set(
    kept.map((c) => `${c.username.trim().toLowerCase()}::${c.password}`),
  );
  const next = [...kept];
  for (const c of imported) {
    const key = `${c.username.trim().toLowerCase()}::${c.password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(c);
  }
  return next.length ? next : [emptyLoadCredential('User 1')];
}

export async function parseAuthCredentialsFile(file: File): Promise<{
  credentials: LoadAuthCredential[];
  skipped: number;
  sheetHint?: string;
}> {
  const name = file.name.toLowerCase();
  let rows: string[][];

  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) {
    rows = await rowsFromExcel(file);
  } else {
    // .csv / .txt / unknown → treat as CSV
    const text = await file.text();
    rows = parseCsvText(text);
  }

  const { credentials, skipped } = mapRowsToCredentials(rows);
  if (!credentials.length) {
    throw new Error(
      'No username/password rows found. Use columns: username,password (optional label).',
    );
  }
  return {
    credentials,
    skipped,
    sheetHint: name.endsWith('.xlsx') || name.endsWith('.xls') ? 'first sheet' : undefined,
  };
}

export function downloadAuthCredentialsSampleCsv() {
  const csv = [
    'label,username,password',
    'Buyer 1,lgdbuyer@gmail.com,YourPassword',
    'Buyer 2,another@example.com,YourPassword',
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'load-auth-users-sample.csv';
  a.click();
  URL.revokeObjectURL(url);
}
