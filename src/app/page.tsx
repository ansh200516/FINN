import type { Metadata } from "next";
import { after } from "next/server";
import { deskTurn } from "@/app/c/[symbol]/actions";
import { getBriefView } from "@/lib/brief";
import { dayLabel, editionLabel } from "@/lib/format";
import { scheduleRefreshOnVisit } from "@/lib/jobs";
import {
  DEFAULT_THRESHOLDS,
  getDemoUser,
  getTripwires,
  guidanceVerdictGroups,
  listCompanyNames,
} from "@/lib/queries";
import {
  addDaysKey,
  formatIst,
  istDateKey,
  NSE_HOLIDAYS_2026,
  sessionType,
} from "@/lib/time";
import { excludedSpecialSessions } from "@/ui/AnomalyStrip";
import { Dateline } from "@/ui/Dateline";
import { Desk, type PushLine } from "@/ui/Desk";
import {
  decisionRank,
  editionHeadline,
  judgeEvent,
  judgeMove,
  showAsMoveCard,
  tallyByIsin,
} from "@/ui/decision";
import { filedStamp } from "@/ui/FilingCard";
import type { AnomalyWithSymbol, BriefWindow } from "@/ui/model";
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

interface Row {
  key: string;
  symbol: string;
  time: string;
  decision: "act" | "watch" | "nothing";
  sentence: string;
  href: string;
  action: string;
  priority: number;
  at: number;
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
  const namesPromise = listCompanyNames();
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
  const companies = await namesPromise;

  const rows: Row[] = [];
  for (const ev of [...brief.tier1, ...brief.tier2]) {
    const j = judgeEvent(ev, ledgers.get(ev.isin) ?? null);
    rows.push({
      key: ev.eventKey,
      symbol: ev.symbol,
      time: filedStamp(ev, now).short,
      decision: j.decision,
      sentence: j.sentence,
      href: `/e/${encodeURIComponent(ev.eventKey)}`,
      action: "Filing",
      priority: ev.priority,
      at: ev.filedAtMs,
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
    rows.push({
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
  rows.sort(
    (a, b) =>
      decisionRank(a.decision) - decisionRank(b.decision) ||
      b.priority - a.priority ||
      b.at - a.at,
  );

  const actRows = rows.filter((r) => r.decision === "act");
  const watchRows = rows.filter((r) => r.decision === "watch");
  const act: PushLine[] = actRows.map((r) => ({
    key: r.key,
    symbol: r.symbol,
    time: r.time,
    sentence: r.sentence,
    href: r.href,
    action: r.action,
  }));
  const watch = watchRows.map((r) => ({
    symbol: r.symbol,
    sentence: r.sentence,
  }));
  const quiet = !act.length && !watch.length;
  const calendar = calendarLine(now, brief.anomalies, win);
  const quietReason = quiet
    ? brief.quiet?.reason === "Nothing needs you"
      ? "No filings in this window."
      : (brief.quiet?.reason ?? "No filings in this window.")
    : null;

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

      {quietMoves > 0 ? (
        <p className="gutter mt-3 receipt text-ink-3">
          {quietMoves} volume {quietMoves === 1 ? "hit" : "hits"} under{" "}
          {thresholds.pricePct}%. Not a decision.
        </p>
      ) : null}

      <Desk
        act={act}
        watch={watch}
        filedAway={brief.counts.filedAway}
        quiet={quietReason}
        checked={
          brief.checkedAtMs
            ? `checked NSE ${formatIst(brief.checkedAtMs, "HH:mm")} IST`
            : null
        }
        companies={companies}
        onTurn={deskTurn}
      />
    </main>
  );
}
