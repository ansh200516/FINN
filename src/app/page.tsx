import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { getBriefView } from "@/lib/brief";
import { editionLabel, readTime } from "@/lib/format";
import { scheduleRefreshOnVisit } from "@/lib/jobs";
import { DEFAULT_THRESHOLDS, getDemoUser, getTripwires } from "@/lib/queries";
import {
  addDaysKey,
  formatIst,
  istDateKey,
  NSE_HOLIDAYS_2026,
  sessionType,
} from "@/lib/time";
import { AnomalyStrip } from "@/ui/AnomalyStrip";
import { Dateline } from "@/ui/Dateline";
import { EndOfEdition } from "@/ui/EndOfEdition";
import { FilingCard, OneLinerRow } from "@/ui/FilingCard";
import { Fold } from "@/ui/Fold";
import { QuietState } from "@/ui/QuietState";
import { TierHeader } from "@/ui/TierHeader";
import { WindowScrubber } from "@/ui/WindowScrubber";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Brief" };

const WORDS = [
  "Nothing",
  "One thing",
  "Two things",
  "Three things",
  "Four things",
  "Five things",
  "Six things",
];

function verdict(needsYou: number, worthKnowing: number): string {
  if (needsYou === 0)
    return worthKnowing ? "Nothing needs you." : "Nothing needs you.";
  const w = WORDS[needsYou] ?? `${needsYou} things`;
  return `${w} ${needsYou === 1 ? "needs" : "need"} you.`;
}

function holidayLine(now: number): string | null {
  const today = istDateKey(now);
  const kind = sessionType(today);
  if (kind === "holiday")
    return `market closed today · ${NSE_HOLIDAYS_2026[today]}`;
  const tomorrow = addDaysKey(today, 1);
  if (NSE_HOLIDAYS_2026[tomorrow])
    return `market closed ${formatIst(tomorrow, "EEE d MMM")} (${NSE_HOLIDAYS_2026[tomorrow]})`;
  if (kind === "weekend") return "weekend · market closed";
  if (kind === "special") return "Muhurat session only today";
  return null;
}

export default async function BriefPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = {
    w: typeof sp.w === "string" ? sp.w : undefined,
    from: typeof sp.from === "string" ? sp.from : undefined,
    to: typeof sp.to === "string" ? sp.to : undefined,
  };
  const now = Date.now();
  const user = await getDemoUser();
  const isins = user.portfolioIsins;
  const rules = await getTripwires(user.id);
  const vol = rules.find((r) => r.kind === "volume_ratio" && r.enabled);
  const px = rules.find((r) => r.kind === "price_move" && r.enabled);
  const thresholds = {
    volumeRatio:
      typeof vol?.params.ratio === "number"
        ? vol.params.ratio
        : DEFAULT_THRESHOLDS.volumeRatio,
    lookbackDays:
      typeof vol?.params.lookbackDays === "number"
        ? vol.params.lookbackDays
        : DEFAULT_THRESHOLDS.lookbackDays,
    pricePct:
      typeof px?.params.pct === "number"
        ? px.params.pct
        : DEFAULT_THRESHOLDS.pricePct,
  };

  // one source of truth: the engine's buildBrief (cached 60 s, tag "brief");
  // an empty auto window widens to 7 d / 30 d inside the engine and says why
  const { view: brief, window: win } = await getBriefView({
    now,
    query: q,
    isins,
    thresholds,
  });

  // FINN_REFRESH_ON_VISIT=true: a stale feed (> 6 h) schedules a rules-only
  // announcements job after the response is sent (Vercel `waitUntil`)
  const refresh = await scheduleRefreshOnVisit(now);
  if (refresh) after(refresh);

  const shown = brief.tier1.length + brief.tier2.length;
  const minutes = readTime(brief.tier1.length, brief.tier2.length);
  const quiet = brief.counts.events === 0;
  const holiday = holidayLine(now);

  return (
    <main className="flex-1 pb-6">
      <Dateline
        eyebrow={editionLabel(now)}
        deck={
          quiet
            ? `${brief.companiesChecked} companies · ${win.label.toLowerCase()} · 0 filings`
            : `${brief.counts.filings} filings · ${brief.counts.needsYou} need you · ${minutes}`
        }
        note={
          win.widened ??
          (win.preset === "custom" ? `Showing ${win.label}.` : undefined)
        }
      >
        {verdict(brief.counts.needsYou, brief.tier2.length)}
      </Dateline>

      <WindowScrubber window={win} now={now} />

      {quiet ? (
        <QuietState
          reason={brief.quiet?.reason ?? "Nothing needs you"}
          companiesChecked={brief.companiesChecked}
          checkedAtMs={brief.checkedAtMs}
          upcoming={brief.upcoming ?? []}
          holidayLine={holiday}
        />
      ) : (
        <>
          {brief.tier1.length ? (
            <section className="mt-6" aria-labelledby="needs-you">
              <TierHeader id="needs-you" count={brief.tier1.length}>
                Needs you
              </TierHeader>
              <div className="mt-3 flex flex-col gap-3">
                {brief.tier1.map((ev, i) => (
                  <FilingCard
                    key={ev.eventKey}
                    event={ev}
                    now={now}
                    index={i}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {brief.tier2.length ? (
            <section className="mt-6" aria-labelledby="worth-knowing">
              <TierHeader id="worth-knowing" count={brief.tier2.length}>
                Worth knowing
              </TierHeader>
              <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
                {brief.tier2.map((ev) => (
                  <OneLinerRow key={ev.eventKey} event={ev} now={now} />
                ))}
              </ul>
            </section>
          ) : null}

          {brief.anomalies.length ? (
            <section className="mt-6" aria-labelledby="eod">
              <TierHeader id="eod" count={brief.anomalies.length}>
                End of day · outside your rules
              </TierHeader>
              <div className="mt-2">
                <AnomalyStrip anomalies={brief.anomalies} />
              </div>
              <p className="gutter receipt mt-1">
                rules: |move| ≥ {thresholds.pricePct}% · volume ≥{" "}
                {thresholds.volumeRatio}× the {thresholds.lookbackDays}-day
                average ·{" "}
                <Link href="/alerts" className="text-accent">
                  edit
                </Link>
              </p>
            </section>
          ) : null}

          {brief.tier3.length ? (
            <section className="mt-6" aria-label="Filed away">
              <Fold groups={brief.tier3} now={now} />
            </section>
          ) : null}

          {brief.upcoming?.length ? (
            <section className="mt-6" aria-labelledby="coming-up">
              <TierHeader id="coming-up">Coming up</TierHeader>
              <ul className="m-0 mt-1 p-0 list-none">
                {brief.upcoming.slice(0, 5).map((u) => (
                  <li
                    key={`${u.isin}-${u.dateKey}`}
                    className="border-b border-rule last:border-b-0"
                  >
                    <Link
                      href={`/c/${encodeURIComponent(u.symbol)}`}
                      className="row flex items-center gap-3 gutter py-1.5 no-callout"
                    >
                      <span className="receipt w-[84px] shrink-0">
                        {u.dateIst}
                      </span>
                      <span className="symbol small w-[96px] shrink-0 text-ink truncate">
                        {u.symbol}
                      </span>
                      <span className="small text-ink-2 flex-1 min-w-0 truncate">
                        {u.what}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <EndOfEdition
            shown={shown}
            filedAway={brief.counts.filedAway}
            checkedAtMs={brief.checkedAtMs}
            readTime={minutes}
          />
        </>
      )}
    </main>
  );
}
