"use client";

import { ChevronRight } from "lucide-react";
import type { TraceItem } from "@/lib/finnieTrace";

/**
 * One line for the thought that is current, in the same cyan as the chat
 * status. Open it to read the thoughts so far. No second chrome.
 */
export function ThoughtRow({
  title,
  items,
  open,
  running,
  onToggle,
}: {
  title: string;
  items: TraceItem[];
  open: boolean;
  running: boolean;
  onToggle: () => void;
}) {
  if (!title) return null;
  return (
    <div
      className="thought-block"
      data-thought=""
      data-running={running ? "" : undefined}
    >
      <button
        type="button"
        className="thought-row"
        aria-expanded={open}
        onClick={onToggle}
      >
        {running ? (
          <span className="live-dot" aria-hidden="true" />
        ) : (
          <ChevronRight
            size={12}
            strokeWidth={1.75}
            aria-hidden="true"
            className={open ? "thought-chev open" : "thought-chev"}
          />
        )}
        <span className="thought-title">{title}</span>
      </button>
      {open ? (
        <ol className="thought-panel">
          {items.map((item) => (
            <li key={item.id}>
              <p className="thought-k">{item.title}</p>
              <p className="thought-body">{item.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
