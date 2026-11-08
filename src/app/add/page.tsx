import type { Metadata } from "next";
import Link from "next/link";
import { getJobStatus, researchJobId } from "@/lib/jobs";
import { getDemoUser } from "@/lib/queries";
import { AddCompanyForm } from "@/ui/AddCompanyForm";
import { JobReceipt } from "@/ui/jobs/JobReceipt";
import { addToPortfolio, removeFromPortfolio, startResearch } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add company" };

/**
 * /add                      search + confirm (AddCompanyForm) → addToPortfolio → /add?job=research:SYM
 * /add?job=research:SYM     the live working receipt for that job (polls + continues it)
 * /add?research=SYM         start (or re-queue) ad-hoc research for SYM and show its receipt
 */
export default async function AddCompanyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getDemoUser();
  let jobId = typeof sp.job === "string" ? sp.job : null;
  let startError: string | null = null;
  const research = typeof sp.research === "string" ? sp.research : null;
  if (!jobId && research) {
    const r = await startResearch(research, { portfolio: false });
    if (r.ok) jobId = r.jobId;
    else startError = r.error;
  }
  const status = jobId
    ? await getJobStatus(
        jobId.startsWith("research:") ? jobId : researchJobId(jobId),
      )
    : null;

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
        <p className="eyebrow reveal">Add company</p>
        <h1
          className="dateline text-ink mt-1 reveal"
          style={{ animationDelay: "60ms" }}
        >
          Any NSE symbol.
        </h1>
        <p className="receipt mt-2 reveal" style={{ animationDelay: "120ms" }}>
          2,632 listed equities · ISIN-keyed · symbol changes resolved
          (TATAMOTORS → TMPV)
        </p>
      </header>

      {status ? (
        <section className="gutter mt-5" aria-label="Research receipt">
          <JobReceipt jobId={status.id} initial={status} />
        </section>
      ) : jobId ? (
        <section className="gutter mt-5">
          <p className="small text-ink-2">
            No research job named <span className="mono">{jobId}</span>.
          </p>
        </section>
      ) : null}
      {startError ? (
        <section className="gutter mt-5">
          <p className="small delta-down">{startError}</p>
        </section>
      ) : null}

      <div className={status ? "mt-6 border-t border-rule pt-4" : "mt-5"}>
        {status ? <p className="gutter eyebrow mb-2">Add another</p> : null}
        <AddCompanyForm
          action={addToPortfolio}
          undoAction={removeFromPortfolio}
          inPortfolio={user.portfolioIsins}
        />
      </div>
    </main>
  );
}
