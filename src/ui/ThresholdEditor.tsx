"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import type { SaveTripwiresState } from "@/app/alerts/actions";
import { CATEGORIES, type Category } from "@/engine/types";
import { categoryLabel, groupIndian } from "@/lib/format";
import { CategoryGlyph } from "./CategoryGlyph";
import type { BacktestGrid } from "./model";

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function nearestKey(keys: string[], v: number): string | null {
  if (!keys.length) return null;
  let best = keys[0] as string;
  let bestD = Number.POSITIVE_INFINITY;
  for (const k of keys) {
    const d = Math.abs(Number.parseFloat(k) - v);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}

function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  format,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  label: string;
}) {
  return (
    <span className="stepper" title={label}>
      <button
        type="button"
        aria-label={`decrease ${label}`}
        onClick={() =>
          onChange(clamp(Math.round((value - step) * 100) / 100, min, max))
        }
        disabled={value <= min}
        className="disabled:opacity-30"
      >
        −
      </button>
      <output aria-live="polite" className="num text-ink">
        {format(value)}
      </output>
      <button
        type="button"
        aria-label={`increase ${label}`}
        onClick={() =>
          onChange(clamp(Math.round((value + step) * 100) / 100, min, max))
        }
        disabled={value >= max}
        className="disabled:opacity-30"
      >
        +
      </button>
    </span>
  );
}

const CATEGORY_CHOICES = CATEGORIES.filter((c) => c !== "unclassified");

/**
 * Rules as sentences with embedded steppers, category toggle chips, and a
 * backtest sentence that updates instantly from a precomputed grid.
 */
export function ThresholdEditor({
  initial,
  grid,
  action,
}: {
  initial: ThresholdValues;
  grid: BacktestGrid | null;
  action: (
    prev: SaveTripwiresState,
    formData: FormData,
  ) => Promise<SaveTripwiresState>;
}) {
  const [v, setV] = useState<ThresholdValues>(initial);
  const [state, formAction, pending] = useActionState(action, null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  const backtest = useMemo(() => {
    if (!grid) return null;
    const vk = nearestKey(Object.keys(grid.volume), v.volumeRatio);
    const pk = nearestKey(Object.keys(grid.price), v.pricePct);
    const volFires = v.volumeEnabled && vk ? (grid.volume[vk] ?? 0) : 0;
    const pxFires = v.priceEnabled && pk ? (grid.price[pk] ?? 0) : 0;
    let fires: number;
    if (v.volumeEnabled && v.priceEnabled && vk && pk)
      fires = grid.either[`${vk}|${pk}`] ?? volFires + pxFires;
    else fires = volFires + pxFires;
    const weeks = Math.max(1, grid.sessions / 5);
    return { fires, volFires, pxFires, perWeek: fires / weeks };
  }, [grid, v]);

  const toggleCat = (c: Category) =>
    setV((s) => ({
      ...s,
      categories: s.categories.includes(c)
        ? s.categories.filter((x) => x !== c)
        : [...s.categories, c],
    }));

  const submit = () => {
    const fd = new FormData();
    fd.set("payload", JSON.stringify(v));
    startTransition(() => formAction(fd));
  };

  return (
    <div>
      {/* PRICE */}
      <section className="gutter py-4 border-b border-rule">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Price</p>
          <button
            type="button"
            className="toggle"
            aria-pressed={v.priceEnabled}
            onClick={() =>
              setV((s) => ({ ...s, priceEnabled: !s.priceEnabled }))
            }
          >
            {v.priceEnabled ? "on" : "off"}
          </button>
        </div>
        <p
          className={`mt-2 text-ink leading-[2.4] ${v.priceEnabled ? "" : "opacity-50"}`}
        >
          Tell me when a stock moves more than{" "}
          <Stepper
            value={v.pricePct}
            onChange={(x) => setV((s) => ({ ...s, pricePct: x }))}
            min={PX_MIN}
            max={PX_MAX}
            step={0.5}
            format={(x) => `±${groupIndian(x, 1)}%`}
            label="price move threshold"
          />{" "}
          in a day.
        </p>
      </section>

      {/* VOLUME */}
      <section className="gutter py-4 border-b border-rule">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Volume</p>
          <button
            type="button"
            className="toggle"
            aria-pressed={v.volumeEnabled}
            onClick={() =>
              setV((s) => ({ ...s, volumeEnabled: !s.volumeEnabled }))
            }
          >
            {v.volumeEnabled ? "on" : "off"}
          </button>
        </div>
        <p
          className={`mt-2 text-ink leading-[2.4] ${v.volumeEnabled ? "" : "opacity-50"}`}
        >
          Tell me when volume is over{" "}
          <Stepper
            value={v.volumeRatio}
            onChange={(x) => setV((s) => ({ ...s, volumeRatio: x }))}
            min={VOL_MIN}
            max={VOL_MAX}
            step={0.25}
            format={(x) => `${groupIndian(x, 2)}×`}
            label="volume ratio threshold"
          />{" "}
          its {v.lookbackDays}-day average.
        </p>
        <p className="receipt">
          special sessions (Muhurat) are excluded from the average
        </p>
      </section>

      {/* CATEGORIES */}
      <section className="gutter py-4 border-b border-rule">
        <p className="eyebrow">Announcements — always surface</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORY_CHOICES.map((c) => {
            const on = v.categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                className="toggle gap-1.5"
                aria-pressed={on}
                onClick={() => toggleCat(c)}
              >
                <CategoryGlyph category={c} />
                {categoryLabel(c)}
              </button>
            );
          })}
        </div>
        <p className="receipt mt-2">everything else folds into routine</p>
      </section>

      {/* BACKTEST */}
      <section className="gutter py-4 border-b border-rule">
        <p className="eyebrow">
          If these rules had run for{" "}
          {grid ? `${grid.sessions} sessions` : "60 days"}
        </p>
        {backtest && grid ? (
          <>
            <p className="mt-2 text-ink" aria-live="polite">
              <span className="num font-semibold">{backtest.fires}</span>{" "}
              {backtest.fires === 1 ? "alert" : "alerts"} · about{" "}
              <span className="num">{groupIndian(backtest.perWeek, 1)}</span> a
              week
              <span className="text-ink-2">
                {" "}
                ({backtest.volFires} volume · {backtest.pxFires} price)
              </span>
            </p>
            <div
              className="mt-3 flex items-end gap-[2px] h-[28px]"
              aria-hidden="true"
            >
              {grid.strip.map((d) => {
                const h = Math.max(2, Math.min(28, d.fires * 9));
                return (
                  <span
                    key={d.date}
                    className="flex-1 rounded-[1px]"
                    style={{
                      height: h,
                      background: d.fires ? "var(--warn)" : "var(--rule)",
                    }}
                    title={`${d.date}: ${d.fires}`}
                  />
                );
              })}
            </div>
            <p className="receipt mt-1">
              last {grid.strip.length} sessions at the saved thresholds
              {grid.topOffenders.length
                ? ` · ${grid.topOffenders.map((o) => `${o.symbol} ×${o.fires}`).join(" · ")}`
                : ""}
            </p>
          </>
        ) : (
          <p className="small text-ink-2 mt-2">
            The backtest sentence appears once 20+ sessions of prices are in the
            database — it is one pass over the cached bars, no model involved.
          </p>
        )}
      </section>

      {/* SAVE */}
      <div className="gutter py-4 flex items-center justify-between gap-3">
        <p className="receipt">
          {state?.ok
            ? "saved · applies from the next EOD run"
            : state && !state.ok
              ? state.error
              : dirty
                ? "unsaved changes"
                : "rules are stored on the server for the demo user"}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !dirty}
          className="hit rounded-[var(--r-chip)] bg-ink px-5 text-bg font-medium disabled:opacity-40"
        >
          {pending ? "Saving" : "Save rules"}
        </button>
      </div>
    </div>
  );
}
