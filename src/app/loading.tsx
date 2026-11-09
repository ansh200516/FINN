const LINES = [
  "Open the database",
  "Read filings in the window",
  "Collapse re-posts into events",
  "Score closes against your rules",
  "Check open promises",
] as const;

/** Route-level loading: a ruled line, then the read, never a checklist. */
export default function Loading() {
  return (
    <main className="flex-1 pb-8" aria-busy="true">
      <header className="gutter pt-5">
        <p className="eyebrow">FINN</p>
        <h1 className="dateline text-ink mt-1">Reading the ledger.</h1>
      </header>
      <div className="gutter mt-6">
        <div className="ledger-folio" aria-hidden="true">
          <span className="ledger-folio-tick" />
          <span className="ledger-folio-rule" />
        </div>
        <ol className="ledger-lines m-0 mt-4 p-0 list-none">
          {LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p className="receipt mt-4">
          no model is called to render a page — this is a database read
        </p>
      </div>
    </main>
  );
}
