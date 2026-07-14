import { randomUUID } from 'crypto';

type InspectSession = {
  id: string;
  label: string;
  latestFrame?: Buffer;
  createdAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __lgdInspectSessions: Map<string, InspectSession> | undefined;
}

function store(): Map<string, InspectSession> {
  if (!globalThis.__lgdInspectSessions) {
    globalThis.__lgdInspectSessions = new Map();
  }
  return globalThis.__lgdInspectSessions;
}

export function createInspectSession(label = 'AI live page inspect'): string {
  const id = randomUUID();
  store().set(id, { id, label, createdAt: Date.now() });
  // Drop stale sessions (>15 min)
  const cutoff = Date.now() - 15 * 60_000;
  for (const [key, s] of store()) {
    if (s.createdAt < cutoff) store().delete(key);
  }
  return id;
}

export function setInspectFrame(id: string, frame: Buffer) {
  const s = store().get(id);
  if (!s) return;
  s.latestFrame = frame;
}

export function getInspectFrame(id: string): Buffer | undefined {
  return store().get(id)?.latestFrame;
}

export function getInspectSession(id: string): InspectSession | undefined {
  return store().get(id);
}

export function endInspectSession(id: string) {
  store().delete(id);
}
