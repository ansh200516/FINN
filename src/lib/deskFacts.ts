/**
 * Push, prepared for one card. The desk does not paint these rows.
 * A sentence such as "what needs a decision" turns them into one line.
 */
import { getBriefView } from "@/lib/brief";
import type { DeskCompany, DeskLine } from "@/lib/deskTurn";
import {
  DEFAULT_THRESHOLDS,
  getDemoUser,
  getTripwires,
  guidanceVerdictGroups,
  listCompanyNames,
} from "@/lib/queries";
import { formatIst } from "@/lib/time";
import {
  attentionRank,
  isRoutineDirectorAppointment,
  judgeEvent,
  judgeMove,
  showAsMoveCard,
  tallyByIsin,
} from "@/ui/decision";

export interface DeskFacts {
  companies: DeskCompany[];
  portfolio: DeskCompany[];
  act: DeskLine[];
  watch: DeskLine[];
  filedAway: number;
  checked: string | null;
}

export async function loadDeskFacts(now = Date.now()): Promise<DeskFacts> {
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

  const { view: brief } = await getBriefView({
    now,
    query: {},
    isins,
    thresholds,
  });

  const filingIsins = [
    ...new Set([...brief.tier1, ...brief.tier2].map((e) => e.isin)),
  ];
  const ledgers = tallyByIsin(await guidanceVerdictGroups(filingIsins));
  const named = await namesPromise;
  const held = new Set(isins);
  const companies = named.map(({ symbol, name, aliases }) => ({
    symbol,
    name,
    aliases,
  }));
  const portfolio = named
    .filter((c) => held.has(c.isin))
    .map(({ symbol, name, aliases }) => ({ symbol, name, aliases }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const rows: Array<DeskLine & { decision: "act" | "watch"; rank: number }> =
    [];
  for (const ev of [...brief.tier1, ...brief.tier2]) {
    const ledger = ledgers.get(ev.isin) ?? null;
    const j = judgeEvent(ev, ledger);
    if (j.decision === "nothing") continue;
    const broken = (ledger?.missed ?? 0) > 0 || (ledger?.cut ?? 0) > 0;
    rows.push({
      symbol: ev.symbol,
      sentence: j.sentence,
      decision: j.decision,
      rank: attentionRank({
        decision: j.decision,
        category: ev.category,
        broken,
        routineDirector: isRoutineDirectorAppointment(ev),
        priority: ev.priority,
        at: ev.filedAtMs,
      }),
    });
  }
  for (const a of brief.anomalies) {
    const move = {
      pct: a.pctMove,
      volumeRatio: a.volumeRatio,
      ruleHit: true,
    };
    if (!showAsMoveCard(move, thresholds.pricePct)) continue;
    const j = judgeMove(move);
    if (j.decision === "nothing") continue;
    rows.push({
      symbol: a.symbol,
      sentence: j.sentence,
      decision: j.decision,
      rank: attentionRank({
        decision: j.decision,
        priceRule: true,
        priority: Math.round(Math.abs(a.pctMove ?? a.volumeRatio ?? 0) * 5),
        at: Date.parse(`${a.date}T00:00:00Z`),
      }),
    });
  }
  rows.sort((a, b) => a.rank - b.rank);

  return {
    companies,
    portfolio,
    act: rows
      .filter((r) => r.decision === "act")
      .map(({ symbol, sentence }) => ({ symbol, sentence })),
    watch: rows
      .filter((r) => r.decision === "watch")
      .map(({ symbol, sentence }) => ({ symbol, sentence })),
    filedAway: brief.counts.filedAway,
    checked: brief.checkedAtMs
      ? `checked NSE ${formatIst(brief.checkedAtMs, "HH:mm")} IST`
      : null,
  };
}
