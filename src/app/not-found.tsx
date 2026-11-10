import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 pb-8">
      <header className="gutter pt-5">
        <p className="eyebrow">Not on file</p>
        <h1 className="dateline text-ink mt-1">Nothing at this address.</h1>
        <p className="small text-ink-2 mt-2">
          The card or company you asked for is not in the database — either the
          symbol is new to FINN or the event has been re-keyed by a later
          filing.
        </p>
      </header>
      <div className="gutter mt-5 flex flex-wrap gap-2">
        <Link
          href="/brief"
          className="hit inline-flex items-center rounded-[var(--r-chip)] bg-ink px-4 text-bg small font-medium"
        >
          Back to the brief
        </Link>
        <Link
          href="/add"
          className="hit inline-flex items-center rounded-[var(--r-chip)] border border-rule bg-surface px-4 text-ink small"
        >
          Add a company
        </Link>
      </div>
    </main>
  );
}
