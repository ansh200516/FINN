"use client";

import { useEffect, useRef, useState } from "react";
import type { BacktestResponse } from "@/app/alerts/actions";
import type { ThresholdValues } from "@/ui/ThresholdEditor";

const DEBOUNCE_MS = 350;

function valueKey(v: ThresholdValues): string {
  return JSON.stringify({ ...v, categories: [...v.categories].sort() });
}

function firedPhrase(sentence: string): string {
  return sentence.replace(/^Would have fired\s+/i, "");
}

/**
 * The optional count under the survey. Hidden until the disclosure opens;
 * the saved thresholds render from the server so the first open is instant.
 */
export function RuleFrequency({
  values,
  initial,
  backtest,
  initialBacktest,
  open,
}: {
  values: ThresholdValues;
  initial: ThresholdValues;
  backtest: (values: ThresholdValues) => Promise<BacktestResponse>;
  initialBacktest: BacktestResponse | null;
  open: boolean;
}) {
  const initialKey = valueKey(initial);
  const currentKey = valueKey(values);
  const [result, setResult] = useState<{
    key: string;
    data: BacktestResponse | null;
  }>({ key: initialKey, data: initialBacktest });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (currentKey === initialKey) {
      setResult({ key: initialKey, data: initialBacktest });
      setPending(false);
      setFailed(false);
      return;
    }
    const mine = ++seq.current;
    setPending(true);
    setFailed(false);
    const t = setTimeout(() => {
      backtest(values)
        .then((r) => {
          if (seq.current === mine) setResult({ key: currentKey, data: r });
        })
        .catch(() => {
          if (seq.current === mine) setFailed(true);
        })
        .finally(() => {
          if (seq.current === mine) setPending(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [open, currentKey, initialKey, initialBacktest, backtest, values]);

  const ready = result.key === currentKey ? result.data : null;
  const lines = ready
    ? (
        [
          ["Price", ready.price],
          ["Volume", ready.volume],
          ["Filings", ready.category],
        ] as const
      ).flatMap(([label, line]) => (line ? [{ label, line }] : []))
    : [];

  return (
    <div className="pb-1" aria-live="polite">
      {lines.length ? (
        <ul className="m-0 p-0 list-none">
          {lines.map(({ label, line }) => (
            <li
              key={label}
              className="flex items-baseline gap-3 border-b border-rule py-2 last:border-b-0"
            >
              <span className="meta w-[4.5rem] shrink-0 text-ink-3">
                {label}
              </span>
              <span className="small text-ink">
                {firedPhrase(line.sentence)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small text-ink-2 py-2">
          {failed
            ? "The count is unavailable right now."
            : ready
              ? "Nothing is switched on."
              : "Checking the last 60 days."}
        </p>
      )}
      {pending && lines.length ? (
        <p className="receipt pt-2">Updating.</p>
      ) : null}
    </div>
  );
}
