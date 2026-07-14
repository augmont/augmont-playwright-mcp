import { createWriteStream, promises as fs, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadDriveApk, extractDriveFileId } from '@/server/android-device';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export type AppLinkKind = 'drive' | 'diawi' | 'appstore' | 'direct';

export function extractDiawiId(url: string): string | null {
  // https://i.diawi.com/7i6cFE or https://www.diawi.com/...
  const m =
    /(?:i\.)?diawi\.com\/(?:p\/)?([A-Za-z0-9]+)/i.exec(url) ||
    /diawi\.com\/([A-Za-z0-9]{5,})/i.exec(url);
  return m?.[1] || null;
}

export function extractAppStoreId(url: string): string | null {
  const m = /\/id(\d+)/i.exec(url) || /[?&]id=(\d+)/i.exec(url);
  return m?.[1] || null;
}

export function isAppStoreUrl(url: string): boolean {
  return /apps\.apple\.com/i.test(url) || /itunes\.apple\.com/i.test(url);
}

export function detectAppLinkKind(url: string): AppLinkKind {
  if (isAppStoreUrl(url)) return 'appstore';
  if (/diawi\.com/i.test(url)) return 'diawi';
  if (extractDriveFileId(url)) return 'drive';
  return 'direct';
}

/** Stable cache filename stem for Drive / Diawi / other URLs. */
export function appCacheId(url: string): string {
  const storeId = extractAppStoreId(url);
  if (storeId) return `appstore-${storeId}`;
  const diawi = extractDiawiId(url);
  if (diawi) return `diawi-${diawi}`;
  const drive = extractDriveFileId(url);
  if (drive) return drive;
  return Buffer.from(url).toString('base64url').slice(0, 24);
}

async function downloadDiawi(appUrl: string, destPath: string): Promise<string> {
  const id = extractDiawiId(appUrl);
  if (!id) throw new Error('Could not parse Diawi id from the URL.');

  mkdirSync(join(destPath, '..'), { recursive: true });

  const pageUrl = `https://i.diawi.com/${id}`;
  const pageRes = await fetch(pageUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      Accept: 'text/html',
    },
  });
  const html = await pageRes.text();

  if (
    /application is gone|not available anymore|expired|deleted/i.test(html) ||
    (/Ooops/i.test(html) && /gone/i.test(html))
  ) {
    throw new Error(
      `Diawi link expired or deleted (${pageUrl}). Ask for a fresh Diawi / IPA upload URL.`,
    );
  }

  // Prefer manifest → software-package .ipa (works for Diawi install pages)
  const manifestUrl =
    /url=(https?:\/\/[^"'&\s]+\.plist)/i.exec(html)?.[1] ||
    /https?:\/\/api\.diawi\.com\/app-manifest\/[A-Za-z0-9]+\.plist/i.exec(html)?.[0] ||
    null;

  let ipaUrl: string | null = null;
  if (manifestUrl) {
    const decoded = decodeURIComponent(manifestUrl);
    const plistRes = await fetch(decoded, { headers: { 'User-Agent': UA } });
    const plist = await plistRes.text();
    ipaUrl =
      /<string>(https?:\/\/[^<]+\.ipa)<\/string>/i.exec(plist)?.[1] ||
      /https?:\/\/[^\s<"']+\.ipa/i.exec(plist)?.[0] ||
      null;
  }

  if (!ipaUrl) {
    ipaUrl =
      /href="(https?:\/\/[^"]+\.ipa[^"]*)"/i.exec(html)?.[1] ||
      /https?:\/\/[^\s"'<>]+\.ipa/i.exec(html)?.[0] ||
      null;
  }

  if (!ipaUrl) {
    throw new Error(
      `Could not find an IPA download on the Diawi page. Open ${pageUrl} on a phone to confirm the install page is live.`,
    );
  }

  const res = await fetch(ipaUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': UA },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Diawi IPA download failed (HTTP ${res.status}).`);
  }

  const type = res.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    const bodyText = await res.text();
    if (/gone|not available|expired/i.test(bodyText)) {
      throw new Error(`Diawi link expired or deleted (${pageUrl}).`);
    }
    throw new Error('Diawi returned HTML instead of an IPA — link may need a password or is expired.');
  }

  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  await pipeline(nodeStream, createWriteStream(destPath));

  const stat = await fs.stat(destPath);
  if (stat.size < 10_000) {
    await fs.unlink(destPath).catch(() => undefined);
    throw new Error('Diawi download was too small — link is likely invalid or expired.');
  }

  return destPath;
}

async function downloadDirect(url: string, destPath: string): Promise<string> {
  mkdirSync(join(destPath, '..'), { recursive: true });
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
  if (!res.ok || !res.body) {
    throw new Error(`Direct app download failed (HTTP ${res.status}).`);
  }
  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  await pipeline(nodeStream, createWriteStream(destPath));
  return destPath;
}

/**
 * Download a mobile build from Google Drive, Diawi, or a direct .apk/.ipa URL.
 */
export async function downloadMobileApp(
  appUrl: string,
  destPath: string,
): Promise<{ path: string; kind: AppLinkKind; cacheId: string }> {
  const kind = detectAppLinkKind(appUrl);
  const cacheId = appCacheId(appUrl);

  if (kind === 'appstore') {
    const id = extractAppStoreId(appUrl) || 'unknown';
    throw new Error(
      `App Store links (id ${id}) cannot be downloaded for automation. Apple does not allow pulling the IPA from the store. Use a Diawi / TestFlight / Drive IPA for a real device, or a simulator .app build from Xcode.`,
    );
  }

  if (kind === 'drive') {
    await downloadDriveApk(appUrl, destPath);
  } else if (kind === 'diawi') {
    await downloadDiawi(appUrl, destPath);
  } else {
    await downloadDirect(appUrl, destPath);
  }

  if (!existsSync(destPath)) {
    throw new Error('App download finished but file is missing.');
  }

  return { path: destPath, kind, cacheId };
}
