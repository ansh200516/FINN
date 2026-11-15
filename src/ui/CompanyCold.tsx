"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

const SYMBOL = /^[A-Z0-9&.-]{1,20}$/;

/**
 * A symbol the NSE master does not list. The page offers another symbol
 * instead of stopping on a dead end.
 */
export function CompanyCold({
  symbol,
  error,
}: {
  symbol: string;
  error: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = q.trim().toUpperCase();
    if (!SYMBOL.test(next)) {
      setLocalError("Type an NSE symbol.");
      return;
    }
    setLocalError(null);
    router.push(`/c/${encodeURIComponent(next)}`);
  };

  return (
    <main className="flex-1 pb-8">
      <header className="gutter pt-5">
        <p className="eyebrow">Not listed</p>
        <h1 className="dateline text-ink mt-1">
          {symbol ? `${symbol} is not an NSE equity.` : "Type an NSE symbol."}
        </h1>
        <p className="small text-ink-2 mt-2">{error}</p>
      </header>
      <form className="gutter mt-5" onSubmit={submit}>
        <label className="block">
          <span className="eyebrow">Research a symbol</span>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="NSE symbol"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLocalError(null);
            }}
            className="mt-1 block w-full hit rounded-[var(--r-chip)] border border-rule bg-surface px-3 text-[16px] text-ink placeholder:text-ink-3"
          />
        </label>
        {localError ? (
          <p className="small delta-down mt-2">{localError}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            className="hit rounded-[var(--r-chip)] bg-ink px-4 text-bg small font-medium"
          >
            Research
          </button>
          <Link
            href="/add"
            className="hit inline-flex items-center rounded-[var(--r-chip)] border border-rule bg-surface px-4 text-ink small"
          >
            Search the NSE list
          </Link>
        </div>
      </form>
    </main>
  );
}
