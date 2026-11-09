"use client";

import { useState } from "react";
import { Sheet } from "./Sheet";

export interface Citation {
  /** chip text, e.g. "Q2 call p.8" or "AR FY26 p.118" */
  label: string;
  quote: string;
  speaker?: string | null;
  role?: string | null;
  docTitle?: string | null;
  page?: number | null;
  url?: string | null;
}

/**
 * Mono chip that opens the excerpt first (Perplexity order), then the link —
 * "Open PDF at page" uses `#page=N`, which desktop and Android honour and iOS
 * ignores, so the quote is always shown here regardless.
 */
export function CitationChip({
  citation,
  className = "",
}: {
  citation: Citation;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const href =
    citation.url && citation.page
      ? `${citation.url}#page=${citation.page}`
      : (citation.url ?? null);
  return (
    <>
      <button
        type="button"
        className={`chip-tap ${className}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Source: ${citation.label}`}
      >
        <span className="chip chip-accent">
          <span aria-hidden="true">❝</span>
          <span>{citation.label}</span>
        </span>
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={citation.label}
        ariaLabel="Source quote"
      >
        <blockquote className="mt-3 border-l-2 border-accent pl-3">
          <p className="quote text-ink">“{citation.quote}”</p>
        </blockquote>
        <p className="receipt mt-3">
          {[citation.speaker, citation.role].filter(Boolean).join(", ")}
          {citation.docTitle ? ` · ${citation.docTitle}` : ""}
          {citation.page ? ` · p.${citation.page}` : ""}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="hit inline-flex items-center rounded-[var(--r-chip)] bg-ink px-4 text-bg font-medium"
            >
              Open PDF{citation.page ? ` at p.${citation.page}` : ""}
            </a>
          ) : null}
          <button
            type="button"
            className="hit inline-flex items-center rounded-[var(--r-chip)] border border-rule bg-surface px-4 text-ink"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `“${citation.quote}” — ${[citation.speaker, citation.role].filter(Boolean).join(", ")}${citation.page ? `, p.${citation.page}` : ""}`,
                );
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard unavailable */
              }
            }}
          >
            {copied ? "Copied" : "Copy quote"}
          </button>
        </div>
      </Sheet>
    </>
  );
}
