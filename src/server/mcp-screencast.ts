import type { CDPSession, Page } from 'playwright';
import { setFrame } from '@/server/session-manager';

const DEFAULTS = {
  quality: 52,
  maxWidth: 960,
  maxHeight: 600,
  everyNthFrame: 4,
  /** Drop frames faster than this to avoid JPEG buffer churn */
  minIntervalMs: 320,
};

/**
 * Low-memory CDP screencast for MCP live view.
 * Throttles frame rate/quality so Next.js dev does not hit the memory restart threshold.
 */
export async function attachThrottledScreencast(
  runId: string,
  page: Page,
  opts?: Partial<typeof DEFAULTS>,
): Promise<CDPSession> {
  const cfg = { ...DEFAULTS, ...opts };
  const client = await page.context().newCDPSession(page);
  let lastSet = 0;
  let pendingAck: string | number | undefined;

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: cfg.quality,
    maxWidth: cfg.maxWidth,
    maxHeight: cfg.maxHeight,
    everyNthFrame: cfg.everyNthFrame,
  });

  client.on('Page.screencastFrame', async (event) => {
    try {
      pendingAck = event.sessionId;
      const now = Date.now();
      if (now - lastSet >= cfg.minIntervalMs) {
        lastSet = now;
        setFrame(runId, Buffer.from(event.data, 'base64'));
      }
      await client.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    } catch {
      // closed
    }
  });

  void pendingAck;
  return client;
}

export async function stopScreencast(cdp?: CDPSession) {
  if (!cdp) return;
  await cdp.send('Page.stopScreencast').catch(() => undefined);
  await cdp.detach().catch(() => undefined);
}
