"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AddState } from "@/app/add/actions";
import { JOB_STEPS } from "@/engine/types";
import { Receipt, type ReceiptStep } from "./Receipt";
import { Toast } from "./Toast";

type Row = [string, string, string] | [string, string, string, string];

interface SymbolsFile {
  generatedAt: string;
  rows: Row[];
}

/** Old symbols the master no longer lists. Searching the old name finds the current row. */
const OLD_SYMBOLS: Record<string, string> = {
  TATAMOTORS: "TMPV",
  ZOMATO: "ETERNAL",
};

const STEP_LABEL: Record<string, string> = {
  queued: "Queued",
  resolve_company: "Resolve company · ISIN, BSE code, aliases",
  fetch_announcements: "Fetch announcements · NSE, last 30 days",
  fetch_prices: "Fetch prices · bhavcopy, 60 sessions",
  fetch_results: "Fetch results · integrated-filing XBRL, 8 quarters",
  discover_documents: "Discover documents · transcripts, annual report",
  fetch_documents: "Fetch documents · text per page, quality probe",
  extract_guidance: "Extract guidance · verbatim gate on every quote",
  adjudicate_ledger: "Settle the ledger · promises vs exchange numbers",
  build_sections: "Build research sections · cited sentences only",
  done: "Done",
};

function previewSteps(symbol: string, isin: string): ReceiptStep[] {
  return JOB_STEPS.filter((s) => s !== "queued" && s !== "done").map(
    (s, i) => ({
      label: STEP_LABEL[s] ?? s,
      state: i === 0 ? "done" : "queued",
      detail: i === 0 ? `${symbol} → ${isin}` : undefined,
    }),
  );
}

/**
 * Autocomplete over the bundled NSE equity master (symbols.json, loaded on
 * first focus), confirm the legal name, then "Add to portfolio" via a server
 * action. Shows the research receipt the job runner will print.
 */
export function AddCompanyForm({
  action,
  undoAction,
  inPortfolio,
}: {
  action: (prev: AddState, fd: FormData) => Promise<AddState>;
  undoAction: (isin: string) => Promise<{ ok: boolean }>;
  /** ISINs already in the portfolio, to mark them in the list */
  inPortfolio: string[];
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Row | null>(null);
  const [state, formAction, pending] = useActionState(action, null);
  const [toast, setToast] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingList = useRef(false);
  const portfolio = useMemo(() => new Set(inPortfolio), [inPortfolio]);

  const load = useCallback(async () => {
    if (rows || loadError || loadingList.current) return;
    loadingList.current = true;
    try {
      const r = await fetch("/data/symbols.json", { cache: "force-cache" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as SymbolsFile;
      setRows(j.rows);
    } catch {
      loadingList.current = false;
      setLoadError(
        "Could not load the NSE symbol list; type an exact symbol and ISIN below.",
      );
    }
  }, [rows, loadError]);

  const matches = useMemo(() => {
    if (!rows) return [];
    const s = q.trim().toUpperCase();
    if (s.length < 1) return [];
    const starts: Row[] = [];
    const contains: Row[] = [];
    const alias = OLD_SYMBOLS[s];
    if (alias) {
      const row = rows.find((r) => r[0].toUpperCase() === alias);
      if (row) starts.push(row);
    }
    for (const r of rows) {
      const sym = r[0];
      const name = r[1].toUpperCase();
      if (sym.startsWith(s)) starts.push(r);
      else if (name.startsWith(s) || sym.includes(s)) contains.push(r);
      else if (s.length >= 3 && name.includes(s)) contains.push(r);
      if (starts.length >= 8) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [rows, q]);

  useEffect(() => {
    if (state?.ok) {
      setUndone(false);
      setToast(
        state.alreadyInPortfolio
          ? `${state.symbol} is already in the portfolio`
          : `Added ${state.symbol} to the portfolio`,
      );
    }
  }, [state]);

  const submit = () => {
    if (!picked) return;
    const fd = new FormData();
    fd.set("symbol", picked[0]);
    fd.set("name", picked[1]);
    fd.set("isin", picked[2]);
    if (picked[3]) fd.set("series", picked[3]);
    startTransition(() => formAction(fd));
  };

  const dismiss = useCallback(() => setToast(null), []);

  return (
    <div>
      <label className="block gutter">
        <span className="eyebrow">NSE symbol or company name</span>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="e.g. VOLTAS, Kalyan, INE…"
          value={q}
          onFocus={() => void load()}
          onChange={(e) => {
            setQ(e.target.value);
            setPicked(null);
            void load();
          }}
          className="mt-1 block w-full hit rounded-[var(--r-chip)] border border-rule bg-surface px-3 text-[16px] text-ink placeholder:text-ink-3"
          aria-autocomplete="list"
          aria-controls="symbol-suggestions"
        />
      </label>
      {loadError ? (
        <p className="gutter small text-ink-2 mt-2">{loadError}</p>
      ) : null}
      {!picked && q && rows ? (
        <ul
          id="symbol-suggestions"
          className="m-0 mt-2 p-0 list-none border-t border-rule"
          aria-label="Suggestions"
        >
          {matches.length ? (
            matches.map((r) => {
              const have = portfolio.has(r[2]);
              return (
                <li key={r[2]} className="border-b border-rule">
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(r);
                      setQ(r[0]);
                    }}
                    className="row-touch gutter flex w-full items-center gap-3 py-2 text-left"
                  >
                    <span className="symbol small w-[112px] shrink-0 truncate">
                      {r[0]}
                    </span>
                    <span className="small flex-1 min-w-0 text-ink-2 truncate">
                      {r[1]}
                    </span>
                    {r[3] ? (
                      <span
                        className="chip chip-warn"
                        title="trade-for-trade / surveillance series"
                      >
                        <span>{r[3]}</span>
                      </span>
                    ) : null}
                    {have ? (
                      <span className="receipt">in portfolio</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          ) : (
            <li className="gutter py-3 small text-ink-2">
              No NSE equity matches “{q}”.
            </li>
          )}
        </ul>
      ) : null}
      {!rows && !loadError && q ? (
        <p className="gutter receipt mt-2">loading 2,632 NSE symbols…</p>
      ) : null}

      {picked ? (
        <div className="gutter mt-4">
          <div className="card px-4 py-3">
            <p className="eyebrow">Confirm</p>
            <p className="title text-ink mt-1">{picked[1]}</p>
            <p className="receipt mt-1">
              {picked[0]} · {picked[2]}
              {picked[3] ? ` · series ${picked[3]}` : " · series EQ"}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={
                  pending || (state?.ok && !undone && state.isin === picked[2])
                }
                className="hit rounded-[var(--r-chip)] bg-ink px-5 text-bg font-medium disabled:opacity-40"
              >
                {pending
                  ? "Adding"
                  : portfolio.has(picked[2])
                    ? "Already in portfolio"
                    : "Add to portfolio"}
              </button>
              <Link
                href={`/c/${encodeURIComponent(picked[0])}`}
                prefetch={false}
                className="hit inline-flex items-center rounded-[var(--r-chip)] border border-rule bg-surface px-4 text-ink"
              >
                Open page
              </Link>
            </div>
            {state && !state.ok ? (
              <p className="small delta-down mt-2">{state.error}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {state?.ok && !undone ? (
        <div className="gutter mt-6">
          <p className="eyebrow mb-2">Research receipt · what runs next</p>
          <Receipt steps={previewSteps(state.symbol, state.isin)} />
          <p className="receipt mt-2">
            the job runner lands with the engine; this is the receipt it prints,
            step by step, as each source verifies
          </p>
        </div>
      ) : null}

      <Toast
        message={toast}
        onDismiss={dismiss}
        onUndo={
          state?.ok && !state.alreadyInPortfolio && !undone
            ? async () => {
                await undoAction(state.isin);
                setUndone(true);
                setToast(`Removed ${state.symbol}`);
              }
            : undefined
        }
      />
    </div>
  );
}
