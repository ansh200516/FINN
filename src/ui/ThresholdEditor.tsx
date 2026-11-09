"use client";

import {
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  BacktestResponse,
  SaveTripwiresState,
} from "@/app/alerts/actions";
import { markAlertsSeen } from "@/app/alerts/actions";
import { CATEGORIES, type Category } from "@/engine/types";
import { categoryLabel, groupIndian } from "@/lib/format";
import { noteAlertsVisit } from "@/ui/navCount";
import { RuleFrequency } from "./alerts/BacktestLive";
import { CategoryGlyph } from "./CategoryGlyph";

export interface ThresholdValues {
  volumeRatio: number;
  lookbackDays: number;
  pricePct: number;
  volumeEnabled: boolean;
  priceEnabled: boolean;
  categories: Category[];
}

const VOL_MIN = 1.5;
const VOL_MAX = 5;
const PX_MIN = 2;
const PX_MAX = 10;
const CATEGORY_CHOICES = CATEGORIES.filter((c) => c !== "unclassified");

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function snap(v: ThresholdValues): string {
  return JSON.stringify({ ...v, categories: [...v.categories].sort() });
}

function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  format,
  label,
  muted,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  label: string;
  muted: boolean;
}) {
  const nudge = (dir: -1 | 1) =>
    onChange(clamp(Math.round((value + dir * step) * 100) / 100, min, max));
  return (
    <span
      className="stepper shrink-0"
      title={label}
      style={{ gridTemplateColumns: "var(--hit-min) 5.25rem var(--hit-min)" }}
    >
      <button
        type="button"
        aria-label={`decrease ${label}`}
        onClick={() => nudge(-1)}
        disabled={value <= min}
        className="disabled:opacity-30"
      >
        −
      </button>
      <output
        aria-live="polite"
        className={`num text-[17px] font-medium ${muted ? "text-ink-3" : "text-ink"}`}
      >
        {format(value)}
      </output>
      <button
        type="button"
        aria-label={`increase ${label}`}
        onClick={() => nudge(1)}
        disabled={value >= max}
        className="disabled:opacity-30"
      >
        +
      </button>
    </span>
  );
}

function RuleSwitch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="toggle shrink-0 min-w-[4.75rem] justify-center"
      aria-pressed={on}
      onClick={onToggle}
    >
      <span className="sr-only">{label} </span>
      {on ? "On" : "Off"}
    </button>
  );
}

/**
 * The answer sits on its own line with the words that finish it, so a wrap
 * cannot leave "its" on one line and "20-day average" on the next.
 */
function RuleSentence({
  lead,
  tail,
  muted,
  control,
}: {
  lead: string;
  tail: string;
  muted: boolean;
  control: ReactNode;
}) {
  return (
    <div className={`mt-4 ${muted ? "text-ink-3" : "text-ink"}`}>
      <span className="block">{lead}</span>
      <span className="mt-2 flex w-full flex-wrap items-center gap-x-2.5 gap-y-2">
        {control}
        <span className="shrink-0 whitespace-nowrap">{tail}</span>
      </span>
    </div>
  );
}

function Mark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-4 shrink-0 place-items-center rounded-[2px] border ${
        on ? "border-accent bg-accent" : "border-ink-3"
      }`}
    >
      {on ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1.6 5.2 3.9 7.4 8.4 2.6"
            stroke="var(--bg)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

function VisitMarker() {
  useEffect(() => {
    markAlertsSeen()
      .then((r) => {
        if (r.ok) noteAlertsVisit();
      })
      .catch(() => undefined);
  }, []);
  return null;
}

/**
 * Onboarding questions for the three tripwires. One save writes the same
 * price, volume, and category rules the evaluator already reads.
 */
export function AlertsSurvey({
  initial,
  action,
  backtest,
  initialBacktest,
}: {
  initial: ThresholdValues;
  action: (
    prev: SaveTripwiresState,
    formData: FormData,
  ) => Promise<SaveTripwiresState>;
  backtest: (values: ThresholdValues) => Promise<BacktestResponse>;
  initialBacktest: BacktestResponse | null;
}) {
  const [v, setV] = useState<ThresholdValues>(initial);
  const [state, formAction, pending] = useActionState(action, null);
  const [frequencyOpen, setFrequencyOpen] = useState(false);
  const submitted = useRef<string | null>(null);
  const current = snap(v);
  const matchesSubmit = submitted.current === current;
  const showSaved = Boolean(state?.ok && matchesSubmit);
  const showError = Boolean(!pending && state && !state.ok && matchesSubmit);

  const toggleCat = (c: Category) =>
    setV((s) => ({
      ...s,
      categories: s.categories.includes(c)
        ? s.categories.filter((x) => x !== c)
        : [...s.categories, c],
    }));

  const submit = () => {
    submitted.current = snap(v);
    const fd = new FormData();
    fd.set("payload", JSON.stringify(v));
    startTransition(() => formAction(fd));
  };

  const watching = v.categories.length;

  return (
    <div>
      <VisitMarker />

      <section
        className="gutter border-t border-rule py-8"
        aria-labelledby="q-price"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="q-price" className="eyebrow">
            01 · Price
          </h2>
          <RuleSwitch
            on={v.priceEnabled}
            label="Price rule"
            onToggle={() =>
              setV((s) => ({ ...s, priceEnabled: !s.priceEnabled }))
            }
          />
        </div>
        <RuleSentence
          lead="Tell me when a stock moves more than"
          tail="in a day."
          muted={!v.priceEnabled}
          control={
            <Stepper
              value={v.pricePct}
              onChange={(x) => setV((s) => ({ ...s, pricePct: x }))}
              min={PX_MIN}
              max={PX_MAX}
              step={0.5}
              format={(x) => `±${groupIndian(x, 1)}%`}
              label="price move threshold"
              muted={!v.priceEnabled}
            />
          }
        />
      </section>

      <section
        className="gutter border-t border-rule py-8"
        aria-labelledby="q-volume"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="q-volume" className="eyebrow">
            02 · Volume
          </h2>
          <RuleSwitch
            on={v.volumeEnabled}
            label="Volume rule"
            onToggle={() =>
              setV((s) => ({ ...s, volumeEnabled: !s.volumeEnabled }))
            }
          />
        </div>
        <RuleSentence
          lead="Tell me when volume is over"
          tail={`its ${v.lookbackDays}-day average.`}
          muted={!v.volumeEnabled}
          control={
            <Stepper
              value={v.volumeRatio}
              onChange={(x) => setV((s) => ({ ...s, volumeRatio: x }))}
              min={VOL_MIN}
              max={VOL_MAX}
              step={0.25}
              format={(x) => `${groupIndian(x, 2)}×`}
              label="volume ratio threshold"
              muted={!v.volumeEnabled}
            />
          }
        />
        <p className="receipt mt-3">
          Special sessions, including Muhurat, are left out of the average.
        </p>
      </section>

      <section
        className="gutter border-t border-rule py-8"
        aria-labelledby="q-filings"
      >
        <h2 id="q-filings" className="eyebrow">
          03 · Filings
        </h2>
        <p className="mt-4 text-ink">Which filings should always surface.</p>
        <p className="receipt mt-1">Everything else folds into routine.</p>
        <ul
          aria-label="Filing categories"
          className="m-0 mt-4 list-none border-t border-rule p-0"
        >
          {CATEGORY_CHOICES.map((c) => {
            const on = v.categories.includes(c);
            return (
              <li key={c} className="border-b border-rule">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleCat(c)}
                  className="flex min-h-11 w-full items-center gap-3 text-left no-callout"
                >
                  <Mark on={on} />
                  <CategoryGlyph
                    category={c}
                    size={14}
                    className="text-ink-3"
                  />
                  <span className={on ? "font-medium text-ink" : "text-ink-2"}>
                    {categoryLabel(c)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="receipt mt-3" aria-live="polite">
          {watching === 0
            ? "None selected."
            : `${watching} of ${CATEGORY_CHOICES.length} always surface.`}
        </p>
      </section>

      <div className="gutter rule-stitched pb-8 pt-6">
        <details onToggle={(e) => setFrequencyOpen(e.currentTarget.open)}>
          <summary className="flex min-h-11 items-center gap-2 no-callout">
            <span className="chev text-ink-3" aria-hidden="true">
              ▸
            </span>
            <span className="text-accent">
              See how often this would have fired
            </span>
          </summary>
          <RuleFrequency
            values={v}
            initial={initial}
            backtest={backtest}
            initialBacktest={initialBacktest}
            open={frequencyOpen}
          />
        </details>

        <button
          type="button"
          onClick={submit}
          disabled={pending}
          aria-busy={pending}
          className="mt-6 flex h-12 w-full items-center justify-center rounded-[var(--r-chip)] bg-ink font-medium text-bg disabled:opacity-40"
        >
          {pending ? "Saving" : "Save alerts"}
        </button>
        {showSaved || showError ? (
          <output
            className={`small mt-3 block ${showError ? "text-down" : "text-ink-2"}`}
          >
            {showSaved
              ? "Saved. Applies from the next close."
              : state && !state.ok
                ? state.error
                : null}
          </output>
        ) : null}
      </div>
    </div>
  );
}
