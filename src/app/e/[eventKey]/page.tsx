import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ResultsCard } from "@/engine/types";
import {
  categoryLabel,
  filedLabel,
  formatCompactCount,
  quarterLabel,
} from "@/lib/format";
import { getEventDetail, getQuarters } from "@/lib/queries";
import { formatIst } from "@/lib/time";
import { CardBody } from "@/ui/CardBody";
import { CategoryGlyph } from "@/ui/CategoryGlyph";
import { SourceChips } from "@/ui/SourceChips";
import { SymbolChip } from "@/ui/SymbolChip";
import { TierHeader } from "@/ui/TierHeader";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventKey: string }>;
}): Promise<Metadata> {
  const { eventKey } = await params;
  const d = await getEventDetail(decodeURIComponent(eventKey));
  return { title: d ? `${d.card.symbol} · ${d.card.title}` : "Card" };
}

function isResults(c: unknown): c is ResultsCard {
  return Boolean(
    c && typeof c === "object" && Array.isArray((c as ResultsCard).rows),
  );
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ eventKey: string }>;
}) {
  const { eventKey } = await params;
  const detail = await getEventDetail(decodeURIComponent(eventKey));
  if (!detail) notFound();
  const { card, filings, settlement } = detail;
  const now = Date.now();
  const dateOnly = !/\d{1,2}:\d{2}/.test(card.filedAtIst);
  const f = filedLabel(card.filedAtMs, now);

  // results: pull the quarter row for the EBITDA popover components and the period
  let periodEnd: string | null = null;
  let components:
    | {
        pbt?: number | null;
        fin?: number | null;
        dna?: number | null;
        oi?: number | null;
      }
    | undefined;
  if (isResults(card.card)) {
    const quarters = await getQuarters(card.isin);
    const basis = card.card.basis;
    const pe =
      card.card.periodEnd ??
      quarters.filter((q) => q.basis === basis).at(-1)?.periodEnd ??
      null;
    periodEnd = pe;
    const row = quarters.find((q) => q.periodEnd === pe && q.basis === basis);
    if (row) {
      components = {
        pbt: row.pbt,
        fin: row.financeCosts,
        dna: row.dna,
        oi: row.otherIncome,
      };
    }
  }

  return (
    <main className="flex-1 pb-8">
      <nav className="gutter pt-3">
        <Link
          href="/"
          className="hit inline-flex items-center gap-1 receipt text-accent -ml-1 pl-1"
        >
          ← Brief
        </Link>
      </nav>
      <header className="gutter mt-1">
        <div className="flex items-center justify-between gap-3 meta">
          <div className="flex items-center gap-2 min-w-0">
            <SymbolChip symbol={card.symbol} className="text-ink" />
            <span className="text-ink-3 inline-flex items-center gap-1 truncate">
              <CategoryGlyph category={card.category} />
              {categoryLabel(card.category)}
            </span>
          </div>
          <span className="receipt whitespace-nowrap">
            {card.tier === 1
              ? "needs you"
              : card.tier === 2
                ? "worth knowing"
                : "filed away"}
          </span>
        </div>
        <h1 className="headline text-ink mt-2 reveal">{card.title}</h1>
        {card.oneLiner ? (
          <p
            className="text-ink-2 mt-2 reveal"
            style={{ animationDelay: "60ms" }}
          >
            {card.oneLiner}
          </p>
        ) : null}
        <p className="receipt mt-2">
          {card.companyName} · {dateOnly ? f.day : f.long}
          {periodEnd ? ` · ${quarterLabel(periodEnd)}` : ""}
        </p>
      </header>

      <section
        className="gutter mt-4 reveal"
        style={{ animationDelay: "120ms" }}
      >
        <CardBody event={card} periodEnd={periodEnd} components={components} />
      </section>

      {isResults(card.card) ? (
        <section className="gutter mt-4">
          <div className="card px-4 py-3">
            <p className="eyebrow">Promises</p>
            <p className="small text-ink mt-1">
              {settlement?.text ??
                "No promises on record for this company yet — the ledger fills from its call transcripts."}
            </p>
            <Link
              href={`/c/${encodeURIComponent(card.symbol)}#ledger`}
              className="hit inline-flex items-center receipt text-accent"
            >
              Open the promise ledger →
            </Link>
          </div>
        </section>
      ) : null}

      {card.voiceSummary ? (
        <section className="gutter mt-5">
          <p className="eyebrow">Exchange summary</p>
          <p className="small text-ink-2 mt-1">{card.voiceSummary}</p>
          <p className="receipt mt-1">
            NSE-generated text attached to the filing · secondary
          </p>
        </section>
      ) : null}

      <section className="mt-6" aria-labelledby="sources">
        <TierHeader id="sources" count={card.sources.length}>
          Sources
        </TierHeader>
        <div className="gutter mt-2">
          {card.sources.length ? (
            <SourceChips sources={card.sources} />
          ) : (
            <p className="small text-ink-2">
              The exchange record carries no attachment for this item.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6" aria-labelledby="filings">
        <TierHeader id="filings" count={filings.length}>
          Filings in this event
        </TierHeader>
        <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
          {filings.map((x) => {
            const only = !/\d{1,2}:\d{2}/.test(x.filedAtIst);
            return (
              <li key={x.id} className="border-b border-rule">
                <div className="gutter py-2 row-touch flex items-center gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="small text-ink block truncate">
                      {x.desc}
                    </span>
                    <span className="meta text-ink-3 block truncate">
                      {x.subject}
                    </span>
                  </span>
                  <span className="receipt shrink-0 text-right">
                    {only
                      ? formatIst(x.filedAtMs, "d MMM")
                      : formatIst(x.filedAtMs, "d MMM HH:mm")}
                    {x.attachmentSize ? (
                      <span className="block">
                        {formatCompactCount(
                          Math.round(x.attachmentSize / 1024),
                        )}{" "}
                        KB
                      </span>
                    ) : null}
                  </span>
                  {x.attachmentUrl ? (
                    <a
                      href={x.attachmentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="chip-tap shrink-0"
                      aria-label={`Open ${x.desc}`}
                    >
                      <span className="chip chip-accent">
                        <span>{x.hasXbrl ? "XBRL" : "PDF"}</span>
                      </span>
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="gutter mt-6">
        <Link
          href={`/c/${encodeURIComponent(card.symbol)}`}
          className="hit inline-flex items-center text-accent small"
        >
          {card.companyName} — company page →
        </Link>
      </p>
    </main>
  );
}
