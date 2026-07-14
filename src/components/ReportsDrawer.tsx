'use client';

import { useEffect } from 'react';
import { ReportHistoryPanel } from '@/components/ReportHistoryPanel';
import { ModalCloseButton } from '@/components/ModalCloseButton';

export function ReportsDrawer({
  open,
  onClose,
  refreshToken,
}: {
  open: boolean;
  onClose: () => void;
  refreshToken: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="report-modal-root reports-overlay-root"
      role="dialog"
      aria-modal="true"
      aria-label="Test reports"
    >
      <div className="report-modal-backdrop" onClick={onClose} />
      <div className="report-modal reports-overlay-modal">
        <header className="report-modal-header">
          <div className="modal-header-copy">
            <h2>Last 5 test reports</h2>
          </div>
          <ModalCloseButton onClick={onClose} />
        </header>
        <div className="report-modal-body">
          <ReportHistoryPanel refreshToken={refreshToken} compact />
        </div>
      </div>
    </div>
  );
}
