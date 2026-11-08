"use client";

import { useEffect } from "react";

/** One toast, bottom, 5 s, optional Undo. Never stacks — the parent holds a single message. */
export function Toast({
  message,
  onDismiss,
  undoLabel = "Undo",
  onUndo,
  durationMs = 5000,
}: {
  message: string | null;
  onDismiss: () => void;
  undoLabel?: string;
  onUndo?: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [message, onDismiss, durationMs]);
  if (!message) return null;
  return (
    <output className="toast small" aria-live="polite">
      <span className="truncate">{message}</span>
      {onUndo ? (
        <button type="button" onClick={onUndo}>
          {undoLabel}
        </button>
      ) : null}
    </output>
  );
}
