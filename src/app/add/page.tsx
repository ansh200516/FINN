import type { Metadata } from "next";
import Link from "next/link";
import { getDemoUser } from "@/lib/queries";
import { AddCompanyForm } from "@/ui/AddCompanyForm";
import { addToPortfolio, removeFromPortfolio } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add company" };

export default async function AddCompanyPage() {
  const user = await getDemoUser();
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
      <div className="mt-5">
        <AddCompanyForm
          action={addToPortfolio}
          undoAction={removeFromPortfolio}
          inPortfolio={user.portfolioIsins}
        />
      </div>
    </main>
  );
}
