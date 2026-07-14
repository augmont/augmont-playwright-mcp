'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';

/** Wait for Zustand persist rehydration before running route guards. */
export function useStoreHydrated(): boolean {
  const hasHydrated = useAppStore((s) => s._hasHydrated);
  const [ready, setReady] = useState(hasHydrated);

  useEffect(() => {
    if (hasHydrated) {
      setReady(true);
      return;
    }
    // Fallback if onRehydrateStorage already fired before mount
    const unsub = useAppStore.persist.onFinishHydration(() => {
      useAppStore.getState().setHasHydrated(true);
      setReady(true);
    });
    if (useAppStore.persist.hasHydrated()) {
      useAppStore.getState().setHasHydrated(true);
      setReady(true);
    }
    return unsub;
  }, [hasHydrated]);

  return ready;
}
