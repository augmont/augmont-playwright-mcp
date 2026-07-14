'use client';

/** Shared X close control for all modals / drawers. */
export function ModalCloseButton({
  onClick,
  disabled,
  className = '',
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`modal-close-btn ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label="Close"
      title="Close"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
