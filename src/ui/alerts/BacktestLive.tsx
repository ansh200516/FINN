"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BacktestResponse,
  SaveTripwiresState,
} from "@/app/alerts/actions";
import type { BacktestGrid } from "@/ui/model";
import { ThresholdEditor, type ThresholdValues } from "@/ui/ThresholdEditor";

const DEBOUNCE_MS = 350;

/**
 * ThresholdEditor plus the engine-backed backtest sentence, recomputed
 * (debounced) whenever a threshold or category changes. The editor's own
 * grid-based estimate stays; this block is the exact rule evaluation
 * (`backtest(rule, isins, 60)`) with the last firing named.
 */
export function BacktestLive({
  initial,
  grid,
  action,
  backtest,
  initialBacktest,
}: {
  initial: ThresholdValues;
  grid: BacktestGrid | null;
  action: (
    prev: SaveTripwiresState,
    formData: FormData,
  ) => Promise<SaveTripwiresState>;
  backtest: (values: ThresholdValues) => Promise<BacktestResponse>;
  initialBacktest: BacktestResponse | null;
}) {
  const [result, setResult] = useState<BacktestResponse | null>(
    initialBacktest,
  );
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState<ThresholdValues>(initial);
  const first = useRef(true);
  const seq = useRef(0);

  const onChange = useCallback((v: ThresholdValues) => setValues(v), []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (initialBacktest) return;
    }
    const mine = ++seq.current;
    setPending(true);
    const t = setTimeout(() => {
      backtest(values)
        .then((r) => {
          if (seq.current === mine) setResult(r);
        })
        .catch(() => undefined)
        .finally(() => {
          if (seq.current === mine) setPending(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [values, backtest, initialBacktest]);

  const lines = result
    ? (
        [
          ["Price", result.price],
          ["Volume", result.volume],
          ["Announcements", result.category],
        ] as const
      ).filter((x) => x[1])
    : [];

  return (
    <div>
      <ThresholdEditor
        initial={initial}
        grid={grid}
        action={action}
        onChange={onChange}
      />
      <section className="gutter py-4 border-b border-rule" aria-live="polite">
        <p className="eyebrow">
          Exact backtest · last {result?.days ?? 60} days ·{" "}
          {result ? `${result.companies} companies` : "portfolio"}
          {pending ? " · recomputing" : ""}
        </p>
        {lines.length ? (
          <ul className="m-0 mt-2 p-0 list-none">
            {lines.map(([label, line]) => (
              <li
                key={label}
                className="py-1.5 border-b border-rule last:border-b-0 flex items-baseline gap-3"
              >
                <span className="meta text-ink-3 w-[104px] shrink-0">
                  {label}
                </span>
                <span className="small text-ink">
                  <span className="num font-medium">{line?.fires}×</span>{" "}
                  {line?.sentence.replace(/^Would have fired \d+× /, "")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small text-ink-2 mt-2">
            {result
              ? "No rule is switched on."
              : "Change a threshold to run the rules over the stored sessions and filings."}
          </p>
        )}
        <p className="receipt mt-2">
          one pass over stored bars and filings, no model involved · the strip
          above is the quick estimate from the precomputed grid
        </p>
      </section>
    </div>
  );
}
