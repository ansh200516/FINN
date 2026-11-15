import Link from "next/link";
import type { JobStatus } from "@/lib/jobs";
import { JobReceipt } from "@/ui/jobs/JobReceipt";

/**
 * Working receipt for a company that is not on file yet. The receipt keeps
 * calling the research job; when the job finishes it refreshes this route
 * into the company page.
 */
export function CompanyResearch({ status }: { status: JobStatus }) {
  const title = status.companyName ?? status.symbol ?? "This symbol";
  return (
    <main className="flex-1 pb-8">
      <nav className="gutter pt-3">
        <Link
          href="/c"
          className="hit inline-flex items-center gap-1 receipt text-accent -ml-1 pl-1"
        >
          ← Companies
        </Link>
      </nav>
      <header className="gutter mt-1">
        <p className="eyebrow reveal">
          Research
          {status.symbol ? ` · ${status.symbol}` : ""}
        </p>
        <h1
          className="dateline text-ink mt-1 reveal"
          style={{ animationDelay: "60ms" }}
        >
          {title}
        </h1>
        <p className="receipt mt-2 reveal" style={{ animationDelay: "120ms" }}>
          Not in the book yet. Filings, prices, and documents run here; the
          company page replaces this receipt when the job finishes.
        </p>
      </header>
      <section className="gutter mt-5" aria-label="Research receipt">
        <JobReceipt jobId={status.id} initial={status} whenDone="refresh" />
      </section>
    </main>
  );
}
