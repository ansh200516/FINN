import type { Metadata } from "next";
import { after } from "next/server";
import { getBriefView } from "@/lib/brief";
import { dayLabel, editionLabel } from "@/lib/format";
import { scheduleRefreshOnVisit } from "@/lib/jobs";
import {
  DEFAULT_THRESHOLDS,
  getDemoUser,
  getTripwires,
  guidanceVerdictGroups,
} from "@/lib/queries";
import {
  addDaysKey,
  formatIst,
  istDateKey,
  NSE_HOLIDAYS_2026,
  sessionType,
} from "@/lib/time";
import { excludedSpecialSessions } from "@/ui/AnomalyStrip";
import { CardBody } from "@/ui/CardBody";
import { ComingUp } from "@/ui/ComingUp";
import { Dateline } from "@/ui/Dateline";
import { DecisionCard } from "@/ui/DecisionCard";
import {
  decisionRank,
  editionHeadline,
  hasFigures,
  judgeEvent,
  judgeMove,
  showAsMoveCard,
  tallyByIsin,
} from "@/ui/decision";
import { EndOfEdition } from "@/ui/EndOfEdition";
import { filedStamp } from "@/ui/FilingCard";
import { Fold } from "@/ui/Fold";
import type { AnomalyWithSymbol, BriefWindow, EventCard } from "@/ui/model";
import { QuietState } from "@/ui/QuietState";
import { TierHeader } from "@/ui/TierHeader";
import { WatchLine } from "@/ui/WatchLine";
import { WindowScrubber } from "@/ui/WindowScrubber";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Brief" };

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

/** One calendar line: today's holiday or Muhurat, else a special session in the window. */
function calendarLine(
  now: number,
  anomalies: AnomalyWithSymbol[],
  win: Pick<BriefWindow, "fromMs" | "toMs">,
): string | null {
  const today = holidayLine(now);
  if (today) return today;
  const excluded = excludedSpecialSessions(anomalies, win, now);
  const hit =
    excluded.find((s) => /muhurat/i.test(s.name)) ?? excluded[0] ?? null;
  if (!hit) return null;
  const name = /muhurat/i.test(hit.name) ? "Muhurat" : "Special session";
  return `${name} ${dayLabel(hit.dateKey)} · not scored`;
}

interface Item {
  key: string;
  symbol: string;
  time: string;
  decision: ReturnType<typeof judgeEvent>["decision"];
  sentence: string;
  href: string;
  action: string;
  priority: number;
  at: number;
  event?: EventCard;
}

function decisionCards(list: Item[]) {
  return list.map((item, i) => (
    <DecisionCard
      key={item.key}
      symbol={item.symbol}
      time={item.time}
      decision={item.decision}
      sentence={item.sentence}
      href={item.href}
      action={item.action}
      index={i}
      figures={
        item.event && hasFigures(item.event) ? (
          <CardBody event={item.event} compact />
        ) : null
      }
    />
  ));
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

  const { view: brief, window: win } = await getBriefView({
    now,
    query: q,
    isins,
    thresholds,
  });

  const refresh = await scheduleRefreshOnVisit(now);
  if (refresh) after(refresh);

  const filingIsins = [
    ...new Set([...brief.tier1, ...brief.tier2].map((e) => e.isin)),
  ];
  const ledgers = tallyByIsin(await guidanceVerdictGroups(filingIsins));

  const items: Item[] = [];
  for (const ev of [...brief.tier1, ...brief.tier2]) {
    const j = judgeEvent(ev, ledgers.get(ev.isin) ?? null);
    items.push({
      key: ev.eventKey,
      symbol: ev.symbol,
      time: filedStamp(ev, now).short,
      decision: j.decision,
      sentence: j.sentence,
      href: `/e/${encodeURIComponent(ev.eventKey)}`,
      action: "Filing",
      priority: ev.priority,
      at: ev.filedAtMs,
      event: ev,
    });
  }
  let quietMoves = 0;
  for (const a of brief.anomalies) {
    const move = {
      pct: a.pctMove,
      volumeRatio: a.volumeRatio,
      ruleHit: true,
    };
    if (!showAsMoveCard(move, thresholds.pricePct)) {
      quietMoves += 1;
      continue;
    }
    const j = judgeMove(move);
    items.push({
      key: `${a.isin}-${a.date}`,
      symbol: a.symbol,
      time: dayLabel(a.date),
      decision: j.decision,
      sentence: j.sentence,
      href: `/c/${encodeURIComponent(a.symbol)}`,
      action: "The close",
      priority: Math.round(Math.abs(a.pctMove ?? a.volumeRatio ?? 0) * 5),
      at: Date.parse(`${a.date}T00:00:00Z`),
    });
  }
  items.sort(
    (a, b) =>
      decisionRank(a.decision) - decisionRank(b.decision) ||
      b.priority - a.priority ||
      b.at - a.at,
  );

  const act = items.filter((i) => i.decision === "act");
  const watch = items.filter((i) => i.decision === "watch");
  const quiet = brief.counts.events === 0 && items.length === 0;
  const calendar = calendarLine(now, brief.anomalies, win);
  const upcoming = brief.upcoming ?? [];

  return (
    <main className="flex-1 pb-6">
      <Dateline
        eyebrow={editionLabel(now)}
        note={
          win.widened ??
          (win.preset === "custom" ? `Showing ${win.label}.` : undefined)
        }
      >
        {editionHeadline(act.length)}
      </Dateline>

      <WindowScrubber window={win} now={now} />

      {calendar ? (
        <p className="gutter mt-3 receipt text-ink-2">{calendar}</p>
      ) : null}

      {act.length ? (
        <section className="mt-5 flex flex-col gap-3" aria-label="Decisions">
          {decisionCards(act)}
        </section>
      ) : null}

      {watch.length ? (
        <WatchLine
          count={watch.length}
          className={act.length ? "mt-4" : "mt-5"}
        >
          {decisionCards(watch)}
        </WatchLine>
      ) : null}

      {!act.length && !watch.length && quiet ? (
        <QuietState
          reason={
            brief.quiet?.reason === "Nothing needs you"
              ? "No filings in this window."
              : (brief.quiet?.reason ?? "No filings in this window.")
          }
          companiesChecked={brief.companiesChecked}
          checkedAtMs={brief.checkedAtMs}
          upcoming={upcoming}
        />
      ) : null}

      {quietMoves > 0 ? (
        <p className="gutter mt-3 receipt text-ink-3">
          {quietMoves} volume {quietMoves === 1 ? "hit" : "hits"} under{" "}
          {thresholds.pricePct}%. Not a decision.
        </p>
      ) : null}

      {brief.tier3.length ? (
        <section className="mt-6" aria-label="Filed away">
          <Fold groups={brief.tier3} now={now} />
        </section>
      ) : null}

      {!quiet && upcoming.length ? (
        <section className="mt-6" aria-labelledby="coming-up">
          <TierHeader id="coming-up">Coming up</TierHeader>
          <div className="mt-1">
            <ComingUp items={upcoming} />
          </div>
        </section>
      ) : null}

      <EndOfEdition
        shown={act.length}
        filedAway={brief.counts.filedAway}
        checkedAtMs={brief.checkedAtMs}
      />
    </main>
  );
}
