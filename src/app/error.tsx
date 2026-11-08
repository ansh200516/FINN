"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex-1 pb-8">
      <header className="gutter pt-5">
        <p className="eyebrow">Could not render</p>
        <h1 className="dateline text-ink mt-1">
          This page failed to read its data.
        </h1>
        <p className="small text-ink-2 mt-2">
          Nothing was lost — the filings are on disk.{" "}
          {error.digest ? `Reference ${error.digest}.` : ""}
        </p>
      </header>
      <div className="gutter mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="hit inline-flex items-center rounded-[var(--r-chip)] bg-ink px-4 text-bg small font-medium"
        >
          Try again
        </button>
        <Link
          href="/"
          className="hit inline-flex items-center rounded-[var(--r-chip)] border border-rule bg-surface px-4 text-ink small"
        >
          Back to the brief
        </Link>
      </div>
    </main>
  );
}
