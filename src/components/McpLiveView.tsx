'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

export function McpLiveView({
  runId,
  active,
  title = 'MCP live browser view',
  idleHint = 'Start the test to open the target URL and watch Playwright fill forms live.',
  interactive = false,
  onViewClick,
  onViewKey,
  clickBusy = false,
}: {
  runId: string | null;
  active: boolean;
  title?: string;
  idleHint?: string;
  /** When true, clicks on the frame map to Playwright (MCP click-flow) */
  interactive?: boolean;
  /** Normalized coords 0–1 relative to the image content box */
  onViewClick?: (nx: number, ny: number) => void;
  /** Keyboard (type / press) while MCP view is focused */
  onViewKey?: (payload: { type: 'type' | 'press'; text?: string; key?: string }) => void;
  clickBusy?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!runId || !active) {
      setSrc(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/frame?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (cancelled || res.status === 204) return;
        if (!res.ok) return;
        const blob = await res.blob();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        // ignore transient errors
      }
    };

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [runId, active]);

  function handleImgClick(e: MouseEvent<HTMLImageElement>) {
    if (!interactive || !onViewClick || clickBusy) return;
    panelRef.current?.focus();
    setFocused(true);
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    onViewClick(Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny)));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!interactive || !onViewKey || clickBusy || !focused) return;
    // Don't steal keys when typing in sidebar inputs
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      onViewKey({ type: 'press', key: e.key === 'Escape' ? 'Escape' : e.key });
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onViewKey({ type: 'type', text: e.key });
    }
  }

  return (
    <section
      ref={panelRef}
      className={`mcp-panel${interactive ? ' mcp-panel-interactive' : ''}${focused ? ' mcp-panel-focused' : ''}`}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={handleKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="mcp-toolbar">
        <span>{title}</span>
        <span>
          {active && runId
            ? interactive
              ? focused
                ? `Typing enabled · click field then type · ${runId.slice(0, 8)}`
                : `Click view to focus & type · ${runId.slice(0, 8)}`
              : `Streaming · ${runId.slice(0, 8)} · highlights on`
            : 'Idle'}
        </span>
      </div>
      <div className="mcp-view">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={src}
            alt="Live Playwright browser screencast"
            className={interactive ? 'mcp-view-clickable' : undefined}
            onClick={handleImgClick}
            style={
              interactive ? { cursor: clickBusy ? 'wait' : 'crosshair' } : undefined
            }
          />
        ) : (
          <div className="mcp-placeholder">
            <strong>Waiting for automation</strong>
            {idleHint}
          </div>
        )}
      </div>
    </section>
  );
}
