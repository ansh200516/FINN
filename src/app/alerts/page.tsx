import type { Metadata } from "next";
import type { Category } from "@/engine/types";
import { CATEGORIES } from "@/engine/types";
import {
  DEFAULT_THRESHOLDS,
  getBacktestGrid,
  getDemoUser,
  getTripwires,
} from "@/lib/queries";
import { BacktestLive } from "@/ui/alerts/BacktestLive";
import type { ThresholdValues } from "@/ui/ThresholdEditor";
import { backtestForValues, saveTripwires } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alerts" };

const DEFAULT_CATEGORIES: Category[] = [
  "results",
  "m_and_a",
  "management_change",
  "pledging",
  "credit_rating",
  "litigation",
];

export default async function AlertsPage() {
  const user = await getDemoUser();
  const [rules, grid] = await Promise.all([
    getTripwires(user.id),
    getBacktestGrid(user.portfolioIsins),
  ]);
  const vol = rules.find((r) => r.kind === "volume_ratio");
  const px = rules.find((r) => r.kind === "price_move");
  const cat = rules.find((r) => r.kind === "category");
  const initial: ThresholdValues = {
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
    volumeEnabled: vol ? vol.enabled : true,
    priceEnabled: px ? px.enabled : true,
    categories: Array.isArray(cat?.params.categories)
      ? (cat.params.categories as string[]).filter((c): c is Category =>
          (CATEGORIES as readonly string[]).includes(c),
        )
      : DEFAULT_CATEGORIES,
  };
  // the exact engine backtest for the saved rules, server-rendered; the client recomputes on change
  const initialBacktest = await backtestForValues(initial).catch(() => null);

  return (
    <main className="flex-1 pb-8">
      <header className="gutter pt-5">
        <p className="eyebrow reveal">Tripwires</p>
        <h1
          className="dateline text-ink mt-1 reveal"
          style={{ animationDelay: "60ms" }}
        >
          What counts as unusual. You decide.
        </h1>
        <p className="receipt mt-2 reveal" style={{ animationDelay: "120ms" }}>
          {rules.length
            ? `${rules.filter((r) => r.enabled).length} rules on`
            : "defaults shown · not saved yet"}{" "}
          · evaluated after each close · nothing here calls a model
        </p>
      </header>
      <div className="mt-4 border-t border-rule">
        <BacktestLive
          initial={initial}
          grid={grid}
          action={saveTripwires}
          backtest={backtestForValues}
          initialBacktest={initialBacktest}
        />
      </div>
      <p className="gutter receipt mt-4">
        Calendar flags: ex-dates and special sessions (Muhurat 8 Nov) are
        excluded from averages; a results-day move is labelled as such in the
        alert.
      </p>
    </main>
  );
}
