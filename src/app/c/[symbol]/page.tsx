import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  categoryLabel,
  dayLabel,
  formatCompactInr,
  formatCrore,
  groupIndian,
  humanise,
  pctChange,
  quarterLabel,
  quarterMonths,
} from "@/lib/format";
import { loadPullMenu } from "@/lib/pullRead";
import { getAskBudget, getCompanyPage } from "@/lib/queries";
import { formatIst } from "@/lib/time";
import { loadTranscriptPendingBy } from "@/lib/transcriptPending";
import { AskSheet } from "@/ui/AskSheet";
import { CategoryGlyph } from "@/ui/CategoryGlyph";
import { DeltaChip } from "@/ui/DeltaChip";
import { Empty } from "@/ui/Empty";
import { filedStamp } from "@/ui/FilingCard";
import { FilingIndex } from "@/ui/FilingIndex";
import { LedgerList, VerdictLegend } from "@/ui/LedgerList";
import type { QuarterRow } from "@/ui/model";
import { PullMenu } from "@/ui/PullMenu";
import { priceHeadline, volumeWord } from "@/ui/prices";
import { snapshotChip } from "@/ui/ResultsGrid";
import { readingId } from "@/ui/readingId";
import { SectionAccordion } from "@/ui/SectionAccordion";
import { Sparkline } from "@/ui/Sparkline";
import { TierHeader } from "@/ui/TierHeader";
import { documentRowStatus, TranscriptPending } from "@/ui/TranscriptPending";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  return { title: symbol.toUpperCase() };
}

const DOC_KIND: Record<string, string> = {
  transcript: "Transcript",
  annual_report: "Annual report",
  results_pdf: "Results PDF",
  presentation: "Presentation",
  press_release: "Press release",
  other: "Filing",
};

function documentDetail(d: {
  textStatus: string;
  fetchedAt: number | null;
}): string {
  const base = documentRowStatus(d.textStatus) ?? "fetch pending";
  if (d.textStatus === "ok" && d.fetchedAt)
    return `${base} · ${formatIst(d.fetchedAt, "d MMM HH:mm")}`;
  return base;
}

function Metric({
  label,
  value,
  yoy,
}: {
  label: string;
  value: number | null;
  yoy: number | null;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="num text-ink font-medium mt-0.5 truncate">
        {formatCompactInr(value)}
      </p>
      <p className="small">
        <DeltaChip value={yoy} /> <span className="text-ink-3 meta">YoY</span>
      </p>
    </div>
  );
}

/** YoY % for a picked metric: the same quarter a year earlier on the same basis. */
function yoyOf(
  quarters: QuarterRow[],
  latest: QuarterRow | undefined,
  pick: (q: QuarterRow) => number | null,
): number | null {
  if (!latest) return null;
  const key = `${Number(latest.periodEnd.slice(0, 4)) - 1}${latest.periodEnd.slice(4)}`;
  const base = quarters.find(
    (r) => r.periodEnd === key && r.basis === latest.basis,
  );
  return base ? pctChange(pick(latest), pick(base)) : null;
}

function QuarterItem({ q, isBank }: { q: QuarterRow; isBank: boolean }) {
  return (
    <li className="py-2 border-b border-rule last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="rowtitle text-ink">{quarterLabel(q.periodEnd)}</span>
        <span className="flex items-center gap-1">
          <span className="chip">
            <span>
              {q.basis === "standalone" ? "Standalone" : "Consolidated"}
            </span>
          </span>
          <span
            className={`chip ${q.source === "xbrl" ? "chip-up" : "chip-warn"}`}
          >
            <span>
              {q.source === "xbrl"
                ? "XBRL"
                : q.source === "pdf"
                  ? "PDF"
                  : "legacy"}
            </span>
          </span>
          {q.audited ? (
            <span className="chip">
              <span>Audited</span>
            </span>
          ) : null}
        </span>
      </div>
      <dl className="m-0 mt-1 grid grid-cols-4 gap-2 small">
        {(
          (isBank
            ? [
                ["NII", q.nii],
                ["PPOP", q.ppop],
                ["PBT", q.pbt],
                ["PAT", q.pat],
              ]
            : [
                ["Revenue", q.revenue],
                ["EBITDA", q.ebitda],
                ["PBT", q.pbt],
                ["PAT", q.pat],
              ]) as Array<[string, number | null]>
        ).map(([l, v]) => (
          <div key={l} className="min-w-0">
            <dt className="meta text-ink-3">{l}</dt>
            <dd className="num m-0 text-ink truncate">{formatCrore(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="receipt mt-1">
        ₹ cr
        {q.eps != null ? ` · EPS ₹ ${groupIndian(q.eps, 2)}` : ""}
        {q.exceptional ? ` · exceptional ${formatCrore(q.exceptional)} cr` : ""}
        {q.sourceUrl ? (
          <>
            {" · "}
            <a
              href={q.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent"
            >
              source
            </a>
          </>
        ) : null}
      </p>
    </li>
  );
}

function SmallMultiple({
  label,
  quarters,
  pick,
  unit = "cr",
}: {
  label: string;
  quarters: QuarterRow[];
  pick: (q: QuarterRow) => number | null;
  unit?: "cr" | "eps";
}) {
  const vals = quarters.map(pick);
  const present = vals.filter((v): v is number => v != null);
  if (present.length < 2) {
    return (
      <div className="py-2 border-b border-rule last:border-b-0 flex items-center justify-between gap-3">
        <span className="small text-ink-2">{label}</span>
        <span className="receipt">fewer than two quarters on record</span>
      </div>
    );
  }
  const first = present[0] as number;
  const last = present.at(-1) as number;
  const fmt = (v: number) =>
    unit === "eps" ? `₹ ${groupIndian(v, 2)}` : `${formatCrore(v)} cr`;
  return (
    <div className="py-2 border-b border-rule last:border-b-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center">
      <div>
        <p className="small text-ink">{label}</p>
        <p className="receipt">
          {fmt(first)} → {fmt(last)} · {present.length} q ·{" "}
          <DeltaChip value={pctChange(last, first)} arrow={false} />
        </p>
      </div>
      <Sparkline
        values={vals}
        width={112}
        height={28}
        ariaLabel={`${label}, ${present.length} quarters`}
      />
    </div>
  );
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const [model, budget] = await Promise.all([
    getCompanyPage(symbol),
    getAskBudget(),
  ]);
  if (!model) notFound();
  const {
    company,
    snapshot,
    prices,
    ledger,
    quarters,
    events,
    documents: storedDocuments,
  } = model;
  const documents = storedDocuments.filter(
    (d) => documentRowStatus(d.textStatus) !== null,
  );
  const chip = snapshotChip(snapshot);
  const [transcriptPendingBy, pull] = await Promise.all([
    loadTranscriptPendingBy(company.isin),
    loadPullMenu({ isin: company.isin, isBank: snapshot.isBank }),
  ]);
  const now = Date.now();
  const consolidated = quarters.filter((q) => q.basis === "consolidated");
  const standalone = quarters.filter((q) => q.basis === "standalone");
  const pool = consolidated.length ? consolidated : quarters;
  const trajectory = pool.slice(-12);
  const latestQ = pool.at(-1);
  const transcripts = documents.filter((d) => d.kind === "transcript");
  const openPromises = ledger.filter((r) => r.status === "open").length;
  const settled = ledger.filter((r) => r.status === "settled").length;
  const px = priceHeadline(prices);
  // the highlighted volume bar is the headline (last normal) session
  const volumeHighlight = px.index >= 0 ? px.index : prices.volumes.length - 1;
  const isNbfc = /nbfc|non[- ]banking/i.test(company.industry ?? "");
  const formatWord = snapshot.isBank ? (isNbfc ? "NBFC" : "bank") : null;

  return (
    <main className="flex-1 pb-24">
      <nav className="gutter pt-3 flex items-center justify-between">
        <Link
          href="/c"
          className="hit inline-flex items-center gap-1 receipt text-accent -ml-1 pl-1"
        >
          ← Companies
        </Link>
        <span className="receipt">
          {company.inPortfolio
            ? "portfolio"
            : company.isAdhoc
              ? "ad-hoc research"
              : "not tracked"}
        </span>
      </nav>

      <header className="gutter mt-1">
        <p className="eyebrow reveal">
          {company.symbol}
          {company.aliases.length ? ` · was ${company.aliases.join(", ")}` : ""}
          {company.industry ? ` · ${company.industry}` : ""}
        </p>
        <h1
          className="headline text-ink mt-1 reveal"
          style={{ animationDelay: "60ms" }}
        >
          {company.name}
        </h1>
        <div
          className="mt-3 flex items-end justify-between gap-4 reveal"
          style={{ animationDelay: "120ms" }}
        >
          <div className="min-w-0">
            {px.close != null ? (
              <>
                <p className="num-lg num text-ink">
                  ₹ {groupIndian(px.close, 2)}
                </p>
                <p className="small">
                  <DeltaChip value={px.pct} />{" "}
                  <span className="text-ink-3 meta">
                    {px.dateKey ? `close ${dayLabel(px.dateKey)}` : ""}
                  </span>
                </p>
              </>
            ) : (
              <p className="small text-ink-3">No price history yet</p>
            )}
          </div>
          <Sparkline
            className="shrink-0"
            values={prices.closes}
            volumes={prices.volumes}
            sessionTypes={prices.sessionTypes}
            highlightIndex={volumeHighlight}
            width={140}
            height={44}
            ariaLabel={`${company.symbol} close, last ${prices.closes.length} sessions${px.specialCount ? `, ${px.specialCount} special session${px.specialCount === 1 ? "" : "s"} shown hollow` : ""}`}
          />
        </div>
        {prices.closes.length ? (
          <p
            className="receipt mt-1 reveal"
            style={{ animationDelay: "150ms" }}
          >
            {prices.closes.length} sessions · volume below
            {px.specialCount
              ? ` · ◌ ${px.special?.short ?? "special"} off the line`
              : ""}
          </p>
        ) : null}
        {px.special ? (
          <p
            className="receipt mt-1 reveal"
            style={{ animationDelay: "160ms" }}
            title={`${px.special.name} — a special session, not the headline close`}
          >
            <span className="text-ink-2">
              {px.special.short === "Muhurat"
                ? "Muhurat session"
                : px.special.name}
            </span>
            {" · "}
            {dayLabel(px.special.dateKey)}
            {px.special.close != null ? (
              <>
                {" · ₹ "}
                <span className="num">{groupIndian(px.special.close, 2)}</span>{" "}
                <DeltaChip value={px.special.pct} className="text-[11px]" />
              </>
            ) : null}
            {" · "}
            {volumeWord(px.special.volumeRatio)}
          </p>
        ) : null}
      </header>

      <FilingIndex
        items={[
          { id: "ledger", label: "Promises" },
          ...pull.map((block) => ({
            id: readingId(block.title),
            label: block.title,
          })),
        ]}
      />

      {/* Snapshot */}
      <section
        id="results"
        className="gutter mt-5 reveal scroll-mt-3"
        style={{ animationDelay: "180ms" }}
        aria-label="Last quarter snapshot"
      >
        <div className="card px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">
              {snapshot.periodEnd
                ? `${quarterLabel(snapshot.periodEnd)} · ${quarterMonths(snapshot.periodEnd)}`
                : "Last quarter"}
            </p>
            {snapshot.periodEnd ? (
              <span
                className={`chip min-w-0 shrink ${chip.tone === "up" ? "chip-up" : "chip-warn"}`}
                title={chip.title ?? undefined}
              >
                <span>{chip.label}</span>
              </span>
            ) : null}
          </div>
          {snapshot.periodEnd ? (
            <div className="mt-2 grid grid-cols-3 gap-3">
              {snapshot.isBank ? (
                <>
                  <Metric
                    label="NII"
                    value={snapshot.nii}
                    yoy={yoyOf(quarters, latestQ, (q) => q.nii)}
                  />
                  <Metric
                    label="PPOP"
                    value={snapshot.ppop}
                    yoy={yoyOf(quarters, latestQ, (q) => q.ppop)}
                  />
                  <Metric
                    label="PAT"
                    value={snapshot.pat}
                    yoy={snapshot.patYoy}
                  />
                </>
              ) : (
                <>
                  <Metric
                    label="Revenue"
                    value={snapshot.revenue}
                    yoy={snapshot.revenueYoy}
                  />
                  <Metric
                    label="EBITDA"
                    value={snapshot.ebitda}
                    yoy={snapshot.ebitdaYoy}
                  />
                  <Metric
                    label="PAT"
                    value={snapshot.pat}
                    yoy={snapshot.patYoy}
                  />
                </>
              )}
            </div>
          ) : (
            <p className="small text-ink-2 mt-1">
              No exchange-filed quarter on record yet — the XBRL ingest fills
              this.
            </p>
          )}
          <p className="receipt mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {snapshot.basis ? `${humanise(snapshot.basis)} · ` : ""}
              {quarters.length} {quarters.length === 1 ? "quarter" : "quarters"}{" "}
              on record
            </span>
            {formatWord ? (
              <span
                className="chip"
                title={`${formatWord} format: NII, PPOP, PBT, PAT — no revenue or EBITDA line`}
              >
                <span>{formatWord} format</span>
              </span>
            ) : null}
          </p>
        </div>
      </section>

      {/* Promise ledger */}
      <section
        className="mt-6 scroll-mt-3"
        aria-labelledby="ledger"
        id="ledger"
      >
        <TierHeader
          id="ledger-h"
          count={
            ledger.length
              ? `${openPromises} open · ${settled} settled`
              : undefined
          }
        >
          Promise ledger
        </TierHeader>
        <div className="gutter mt-2">
          {transcriptPendingBy != null ? (
            <TranscriptPending
              expectedBy={transcriptPendingBy}
              className="mb-2"
            />
          ) : null}
          {ledger.length ? (
            <>
              <LedgerList rows={ledger} symbol={company.symbol} />
              <div className="mt-3">
                <VerdictLegend />
              </div>
            </>
          ) : transcripts.length ? (
            <Empty
              title="No guidance extracted yet"
              reason={`${transcripts.length} ${transcripts.length === 1 ? "transcript" : "transcripts"} on record; the extractor runs each call through a verbatim gate before a line appears here.`}
            />
          ) : (
            <Empty
              title="No earnings calls on record"
              reason="Management holds no transcribed calls that we can find on the exchanges or screener.in, so the ledger cannot be built. Research for this name is annual-report only."
            />
          )}
        </div>
      </section>

      <PullMenu blocks={pull} />

      {/* Research accordions */}
      <section className="mt-6 border-t border-rule" aria-label="Research">
        <SectionAccordion
          title="Results"
          count={quarters.length}
          verdict={
            quarters.length
              ? `${quarterLabel((quarters.at(-1) as QuarterRow).periodEnd)} latest · ${consolidated.length} consolidated`
              : "nothing filed yet"
          }
        >
          {quarters.length ? (
            <>
              <ul className="m-0 p-0 list-none">
                {[...(consolidated.length ? consolidated : quarters)]
                  .reverse()
                  .map((q) => (
                    <QuarterItem
                      key={`${q.periodEnd}-${q.basis}`}
                      q={q}
                      isBank={snapshot.isBank}
                    />
                  ))}
              </ul>
              {consolidated.length && standalone.length ? (
                <details className="mt-2 border-t border-rule">
                  <summary className="row-touch flex items-center gap-2 receipt no-callout">
                    <span className="chev" aria-hidden="true">
                      ▸
                    </span>
                    Standalone · {standalone.length} quarters
                  </summary>
                  <ul className="m-0 p-0 list-none">
                    {[...standalone].reverse().map((q) => (
                      <QuarterItem
                        key={`${q.periodEnd}-${q.basis}`}
                        q={q}
                        isBank={snapshot.isBank}
                      />
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <Empty
              title="No quarters on record"
              reason="The results ingest (integrated-filing XBRL, legacy quarters) fills this list."
            />
          )}
        </SectionAccordion>

        <SectionAccordion
          title="Trajectory"
          verdict={
            trajectory.length >= 2
              ? `${trajectory.length} quarters · ${quarterLabel((trajectory[0] as QuarterRow).periodEnd)} → ${quarterLabel((trajectory.at(-1) as QuarterRow).periodEnd)}`
              : "needs two or more quarters"
          }
        >
          {snapshot.isBank ? (
            <>
              <SmallMultiple
                label="NII"
                quarters={trajectory}
                pick={(q) => q.nii}
              />
              <SmallMultiple
                label="PPOP"
                quarters={trajectory}
                pick={(q) => q.ppop}
              />
              <SmallMultiple
                label="PBT"
                quarters={trajectory}
                pick={(q) => q.pbt}
              />
              <SmallMultiple
                label="PAT"
                quarters={trajectory}
                pick={(q) => q.pat}
              />
            </>
          ) : (
            <>
              <SmallMultiple
                label="Revenue"
                quarters={trajectory}
                pick={(q) => q.revenue}
              />
              <SmallMultiple
                label="EBITDA"
                quarters={trajectory}
                pick={(q) => q.ebitda}
              />
              <SmallMultiple
                label="PBT"
                quarters={trajectory}
                pick={(q) => q.pbt}
              />
              <SmallMultiple
                label="PAT"
                quarters={trajectory}
                pick={(q) => q.pat}
              />
            </>
          )}
          <SmallMultiple
            label="EPS"
            quarters={trajectory}
            pick={(q) => q.eps}
            unit="eps"
          />
          <p className="receipt mt-2">
            exchange-filed quarters only · what exists is shown, nothing is
            interpolated
          </p>
        </SectionAccordion>

        <SectionAccordion
          title="Filings"
          count={events.length}
          verdict={
            events.length
              ? `latest ${filedStamp(events[0] as (typeof events)[number], now).line}`
              : "no filings on record"
          }
        >
          {events.length ? (
            <ul className="m-0 p-0 list-none">
              {events.map((ev) => (
                <li
                  key={ev.eventKey}
                  className="border-b border-rule last:border-b-0"
                >
                  <Link
                    href={`/e/${encodeURIComponent(ev.eventKey)}`}
                    className="row-touch flex items-center gap-3 py-2 no-callout"
                  >
                    <span className="text-ink-3 shrink-0">
                      <CategoryGlyph
                        category={ev.category}
                        title={categoryLabel(ev.category)}
                      />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="small text-ink block truncate">
                        {ev.title}
                      </span>
                      <span className="meta text-ink-3">
                        {categoryLabel(ev.category)}
                        {ev.followUps ? ` · +${ev.followUps}` : ""}
                        {ev.tier === 3 ? " · filed away" : ""}
                      </span>
                    </span>
                    <span className="receipt shrink-0">
                      {filedStamp(ev, now).short.split(" · ")[0]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title="Nothing filed in the window"
              reason="Announcements for this company appear here as they are ingested."
            />
          )}
        </SectionAccordion>

        <SectionAccordion
          title="Documents"
          count={documents.length}
          verdict={
            documents.length
              ? `${transcripts.length} ${transcripts.length === 1 ? "transcript" : "transcripts"} · ${documents.filter((d) => d.kind === "annual_report").length} annual report${documents.filter((d) => d.kind === "annual_report").length === 1 ? "" : "s"}`
              : "none fetched"
          }
        >
          {documents.length ? (
            <ul className="m-0 p-0 list-none">
              {documents.map((d) => (
                <li key={d.id} className="border-b border-rule last:border-b-0">
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="row-touch flex items-center gap-3 py-2 no-callout"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="small text-ink block truncate">
                        {DOC_KIND[d.kind] ?? humanise(d.kind)}
                        {d.period ? ` · ${d.period}` : ""}
                      </span>
                      <span className="meta text-ink-3 block truncate">
                        {d.pages ? `${d.pages} pp · ` : ""}
                        {documentDetail(d)}
                      </span>
                    </span>
                    <span className="chip chip-accent">
                      <span>Open ↗</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title="No documents fetched"
              reason="Transcripts and the annual report are discovered from NSE, BSE and screener.in, then fetched with a text-quality probe."
            />
          )}
        </SectionAccordion>
      </section>

      <p className="gutter receipt mt-6">
        {company.sector ? `${company.sector} · ` : ""}
        ISIN {company.isin}
      </p>

      <AskSheet
        symbol={company.symbol}
        budget={budget}
        docCount={documents.length}
      />
    </main>
  );
}
