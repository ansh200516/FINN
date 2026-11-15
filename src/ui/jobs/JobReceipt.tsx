"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { JobStatus } from "@/lib/jobs";
import { Receipt, type ReceiptStep } from "@/ui/Receipt";

const POLL_MS = 2_000;
/** browser-triggered continue calls ask for a shorter slice than cron (progress persists per step) */
const CONTINUE_DEADLINE_MS = 40_000;

function toSteps(s: JobStatus): ReceiptStep[] {
  return s.steps.map((st) => ({
    label: st.label,
    state: st.state,
    detail: st.detail,
  }));
}

function elapsedLabel(ms: number): string {
  if (ms < 1000) return "<1 s";
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/**
 * The live working receipt for a research job. Polls the status endpoint
 * every 2 s; while the job is unfinished each poll also asks the server to
 * continue work (`POST /api/jobs/research?id=…`), so no background worker is
 * needed — the page itself is the scheduler. When the job finishes, the
 * receipt opens the company page (or refreshes into it, when already there).
 */
export function JobReceipt({
  jobId,
  initial,
  whenDone = "stay",
}: {
  jobId: string;
  initial: JobStatus;
  /**
   * stay — leave the receipt on screen.
   * refresh — re-render this route once the job is done (the company page).
   * open — go to the company page once the job is done.
   */
  whenDone?: "stay" | "refresh" | "open";
}) {
  const router = useRouter();
  const [status, setStatus] = useState<JobStatus>(initial);
  const [netError, setNetError] = useState<string | null>(null);
  const [continues, setContinues] = useState(0);
  const inflight = useRef(false);
  const settled = useRef(false);
  const finished = status.done || status.failed;
  const onThisPage = whenDone === "refresh";

  useEffect(() => {
    if (!status.done || whenDone === "stay" || settled.current) return;
    settled.current = true;
    if (whenDone === "refresh") router.refresh();
    else if (status.href) router.push(status.href);
  }, [status.done, status.href, whenDone, router]);

  useEffect(() => {
    if (finished) return;
    let stopped = false;
    const statusUrl = `/api/jobs/status/${encodeURIComponent(jobId)}`;
    const continueUrl = `/api/jobs/research?id=${encodeURIComponent(jobId)}&deadline=${CONTINUE_DEADLINE_MS}`;
    const poll = async () => {
      try {
        const r = await fetch(statusUrl, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as JobStatus & { ok: boolean };
          if (!stopped) {
            setStatus(j);
            setNetError(null);
          }
          if (j.done || j.failed) return;
        } else if (!stopped) setNetError(`status ${r.status}`);
      } catch (e) {
        if (!stopped)
          setNetError(e instanceof Error ? e.message : "network error");
      }
      if (!inflight.current) {
        inflight.current = true;
        setContinues((c) => c + 1);
        fetch(continueUrl, { method: "POST", cache: "no-store" })
          .catch(() => undefined)
          .finally(() => {
            inflight.current = false;
          });
      }
    };
    void poll();
    const iv = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [jobId, finished]);

  const steps = toSteps(status);
  const title = status.symbol
    ? `Research receipt · ${status.symbol}`
    : "Research receipt";
  const state = status.failed
    ? "failed"
    : status.done
      ? "done"
      : status.state === "running"
        ? "working"
        : "queued";

  return (
    <section aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="eyebrow">{title}</p>
        <p className="receipt">
          {state === "done"
            ? `done in ${elapsedLabel(status.elapsedMs)}`
            : state === "failed"
              ? "stopped"
              : `${elapsedLabel(status.elapsedMs)} · continue #${continues}`}
        </p>
      </div>
      <Receipt steps={steps} />

      {status.failed ? (
        <p className="small delta-down mt-2">
          {status.flags.unknownSymbol
            ? `Unknown NSE symbol — ${status.error ?? "not in EQUITY_L"}.`
            : `Stopped at “${status.steps.find((s) => s.name === status.step)?.label ?? status.step}”: ${status.error ?? "unknown error"}`}
        </p>
      ) : null}

      {status.flags.budgetExhausted ? (
        <p className="small text-ink-2 mt-2">
          Analysis queued for after the 13:30 IST quota reset — filings, results
          and documents are already on the company page; the promise ledger
          fills in when the model budget returns.
        </p>
      ) : null}
      {status.flags.arOnly && !status.failed ? (
        <p className="small text-ink-2 mt-2">
          No earnings-call transcripts on the exchanges or screener.in for this
          name — research is annual-report only, so the promise ledger stays
          empty by design.
        </p>
      ) : null}
      {netError && !finished ? (
        <p className="receipt mt-2">connection: {netError} · retrying</p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="receipt min-w-0 truncate">
          {status.summary ??
            (finished
              ? ""
              : onThisPage
                ? "this page becomes the company page when the job finishes"
                : "partial results appear on the company page as each step verifies")}
        </p>
        {status.href && !onThisPage ? (
          <Link
            href={status.href}
            className="hit inline-flex items-center rounded-[var(--r-chip)] bg-ink px-4 text-bg font-medium shrink-0"
          >
            {status.done ? "Open" : "Open so far"} {status.symbol} →
          </Link>
        ) : null}
      </div>
      {status.budget ? (
        <p className="receipt mt-2">
          model budget: {status.budget}
          {status.notes.length ? ` · ${status.notes.at(-1)}` : ""}
        </p>
      ) : null}
    </section>
  );
}
