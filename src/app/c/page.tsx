import type { Metadata } from "next";
import { groupIndian, relativeIst } from "@/lib/format";
import { getCompaniesIndex, getDemoUser } from "@/lib/queries";
import { DeltaChip } from "@/ui/DeltaChip";
import { Empty } from "@/ui/Empty";
import { Sparkline } from "@/ui/Sparkline";
import { TierHeader } from "@/ui/TierHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const user = await getDemoUser();
  const rows = await getCompaniesIndex(user.portfolioIsins);
  const now = Date.now();
  const portfolio = rows.filter((r) => r.inPortfolio);
  const adhoc = rows.filter((r) => !r.inPortfolio);

  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <li className="border-b border-rule last:border-b-0">
      <a
        href={`/c/${encodeURIComponent(r.symbol)}`}
        className="row-touch gutter flex items-center gap-3 py-2 no-callout"
      >
        <span className="w-[104px] shrink-0 min-w-0">
          <span className="symbol small block truncate">{r.symbol}</span>
          <span className="meta text-ink-3 block truncate">
            {r.industry ?? r.name}
          </span>
        </span>
        <span className="flex-1 min-w-0 flex items-center justify-end gap-3">
          <Sparkline
            values={r.spark}
            width={56}
            height={14}
            ariaLabel={`${r.symbol} 30-session close`}
          />
          <span className="text-right w-[84px] shrink-0">
            <span className="num small text-ink block">
              {r.lastClose != null
                ? groupIndian(r.lastClose, r.lastClose < 100 ? 2 : 1)
                : "—"}
            </span>
            <span className="meta block">
              <DeltaChip value={r.lastPct} />
            </span>
          </span>
        </span>
        <span className="receipt w-[56px] shrink-0 text-right">
          {r.lastFilingMs ? relativeIst(r.lastFilingMs, now) : "—"}
          {r.openPromises ? (
            <span className="block">{r.openPromises} open</span>
          ) : null}
        </span>
      </a>
    </li>
  );

  return (
    <main className="flex-1 pb-8">
      <header className="gutter pt-5 flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow reveal">Companies</p>
          <h1
            className="dateline text-ink mt-1 reveal"
            style={{ animationDelay: "60ms" }}
          >
            {rows.length ? `${rows.length} on the book.` : "An empty book."}
          </h1>
          <p
            className="receipt mt-2 reveal"
            style={{ animationDelay: "120ms" }}
          >
            close · 1 d · last filing · open promises
          </p>
        </div>
        <a
          href="/add"
          className="hit inline-flex items-center rounded-[var(--r-chip)] bg-ink px-4 text-bg small font-medium shrink-0"
        >
          + Add
        </a>
      </header>

      {!rows.length ? (
        <div className="gutter mt-6">
          <Empty
            title="No companies yet"
            reason="Add any NSE symbol — the research job starts the moment it resolves."
          >
            <a
              href="/add"
              className="hit inline-flex items-center text-accent small"
            >
              Add a company →
            </a>
          </Empty>
        </div>
      ) : null}

      {portfolio.length ? (
        <section className="mt-6">
          <TierHeader count={portfolio.length}>Portfolio</TierHeader>
          <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
            {portfolio.map((r) => (
              <Row key={r.isin} r={r} />
            ))}
          </ul>
        </section>
      ) : null}
      {adhoc.length ? (
        <section className="mt-6">
          <TierHeader count={adhoc.length}>Ad-hoc research</TierHeader>
          <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
            {adhoc.map((r) => (
              <Row key={r.isin} r={r} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
