"use client";

import { useEffect } from "react";
import { TierHeader } from "./TierHeader";

/**
 * The pull menu, in the open: promise ledger first, then the eight
 * readings. A tap scrolls to that block and opens it when it is closed.
 */
export function FilingIndex({
  items,
}: {
  items: { id: string; label: string }[];
}) {
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    openReading(id);
  }, []);

  return (
    <nav
      className="mt-4 reveal"
      style={{ animationDelay: "170ms" }}
      aria-label="From the filings"
      data-tour="readings"
    >
      <TierHeader>From the filings</TierHeader>
      <ul className="gutter mt-2 grid grid-cols-2 gap-x-4">
        {items.map((item) => (
          <li key={item.id} className="min-w-0">
            <a
              href={`#${item.id}`}
              className="row-touch no-callout flex w-full items-center border-b border-rule small text-ink"
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  event.button !== 0
                ) {
                  return;
                }
                event.preventDefault();
                openReading(item.id);
                window.history.pushState(null, "", `#${item.id}`);
              }}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function openReading(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ block: "start" });
}
