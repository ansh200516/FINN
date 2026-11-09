import { LoadSpinner } from "@/ui/LoadSpinner";

const LINES = [
  "Open the database",
  "Read filings in the window",
  "Collapse re-posts into events",
  "Score closes against your rules",
  "Check open promises",
] as const;

/** Route-level loading: the rings are the hero, then the read as plain lines. */
export default function Loading() {
  return (
    <main className="flex-1 pb-8" aria-busy="true">
      <header className="gutter pt-5">
        <p className="eyebrow">FINN</p>
      </header>
      <div className="gutter">
        <div className="load-spin-hero">
          <LoadSpinner />
        </div>
        <ol className="ledger-lines m-0 mt-4 p-0 list-none">
          {LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p className="receipt mt-4">
          no model is called to render a page — this is a database read
        </p>
        <p className="receipt mt-2">Animation by Bilal Naseer</p>
      </div>
    </main>
  );
}
