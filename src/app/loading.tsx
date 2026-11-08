import { Receipt } from "@/ui/Receipt";

/** Route-level loading: the working receipt, never a skeleton. */
export default function Loading() {
  return (
    <main className="flex-1 pb-8">
      <header className="gutter pt-5">
        <p className="eyebrow">FINN</p>
        <h1 className="dateline text-ink mt-1">Reading the ledger.</h1>
      </header>
      <div className="gutter mt-4">
        <Receipt
          steps={[
            { label: "Open the database", state: "done" },
            { label: "Read filings in the window", state: "working" },
            { label: "Collapse re-posts into events", state: "queued" },
            { label: "Score closes against your rules", state: "queued" },
            { label: "Check open promises", state: "queued" },
          ]}
        />
        <p className="receipt mt-2">
          no model is called to render a page — this is a database read
        </p>
      </div>
    </main>
  );
}
