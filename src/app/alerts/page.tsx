import type { Metadata } from "next";
import type { Category } from "@/engine/types";
import { CATEGORIES } from "@/engine/types";
import { DEFAULT_THRESHOLDS, getDemoUser, getTripwires } from "@/lib/queries";
import type { ThresholdValues } from "@/ui/ThresholdEditor";
import { AlertsSurvey } from "@/ui/ThresholdEditor";
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
  const rules = await getTripwires(user.id);
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
  const initialBacktest = await backtestForValues(initial).catch(() => null);

  return (
    <main className="flex-1">
      <header data-tour="alerts" className="gutter pb-8 pt-6">
        <p className="eyebrow reveal">Alerts</p>
        <h1
          className="dateline text-ink mt-2 reveal"
          style={{ animationDelay: "60ms" }}
        >
          What counts as unusual.
        </h1>
        <p
          className="mt-3 max-w-[28ch] text-ink-2 reveal"
          style={{ animationDelay: "120ms" }}
        >
          You decide. Answer three questions, then save.
        </p>
      </header>
      <AlertsSurvey
        initial={initial}
        action={saveTripwires}
        backtest={backtestForValues}
        initialBacktest={initialBacktest}
      />
    </main>
  );
}
