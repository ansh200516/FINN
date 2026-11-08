"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * Bottom sheet on a native <dialog>: focus trap, Escape and backdrop close
 * for free; slides up in 320 ms and respects reduced motion via globals.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape is handled natively by <dialog>
    <dialog
      ref={ref}
      className="sheet"
      aria-label={ariaLabel}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-handle" aria-hidden="true" />
      <div className="px-4 pt-3">
        {title ? (
          <div className="flex items-start justify-between gap-3">
            <div className="title text-ink">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="hit -mr-3 -mt-2 inline-flex items-center justify-center text-ink-3"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </dialog>
  );
}
