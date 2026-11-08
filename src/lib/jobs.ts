/**
 * Jobs façade for the app: start / continue / status, plus the on-visit
 * staleness refresh. Route handlers, server actions and the receipt UI talk
 * to this module; the engine runner (src/engine/jobs) knows nothing about HTTP.
 */
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import {
  type AnyJobKind,
  budgetLine,
  isJobKind,
  stepsForKind,
} from "@/engine/jobs/kinds";
import { ensureCompany, resolveNseSymbol } from "@/engine/jobs/resolve";
import {
  createJob,
  DEFAULT_DEADLINE_MS,
  type JobParams,
  loadJob,
  paramsOf,
  parseLog,
  type RunResult,
  runSteps,
  withBusyRetry,
} from "@/engine/jobs/runner";
import type { JobLogEntry } from "@/engine/types";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { formatIst, istDateKey } from "@/lib/time";
import type { ReceiptState, ReceiptStep } from "@/ui/Receipt";

const log = logger.child({ mod: "lib/jobs" });

export { isJobKind };
export type { AnyJobKind };

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export function researchJobId(symbol: string): string {
  return `research:${symbol.trim().toUpperCase()}`;
}

/** Scheduled kinds get one row per IST day; ad-hoc runs of the same kind reuse an unfinished row. */
export function scheduledJobId(kind: AnyJobKind, now = Date.now()): string {
  if (kind === "eod" || kind === "digest") return `${kind}:${istDateKey(now)}`;
  return `${kind}:${istDateKey(now)}T${formatIst(now, "HHmm")}`;
}

// ---------------------------------------------------------------------------
// Start / continue
// ---------------------------------------------------------------------------

export interface StartJobInput {
  kind: AnyJobKind;
  id?: string;
  isin?: string | null;
  params?: JobParams;
  now?: number;
}

/**
 * Create (or reuse an unfinished) job row. For a kind without an explicit id
 * an unfinished row of the same kind touched in the last 10 minutes is reused
 * so a cron retry does not fork a second run.
 */
export async function startJob(input: StartJobInput) {
  const now = input.now ?? Date.now();
  let id = input.id;
  if (!id) {
    const recent = await db
      .select()
      .from(t.jobs)
      .where(
        and(
          eq(t.jobs.kind, input.kind),
          inArray(t.jobs.state, ["queued", "running"]),
        ),
      )
      .orderBy(desc(t.jobs.updatedAt))
      .limit(1);
    const r = recent[0];
    if (
      r &&
      now - r.updatedAt < 10 * 60_000 &&
      (r.isin ?? null) === (input.isin ?? null)
    )
      id = r.id;
    else id = scheduledJobId(input.kind, now);
  }
  return createJob({
    id,
    kind: input.kind,
    isin: input.isin ?? null,
    params: input.params,
    now,
  });
}

export type StartResearchResult =
  | {
      ok: true;
      jobId: string;
      symbol: string;
      isin: string;
      name: string;
      created: boolean;
      /** an unfinished run for this symbol was reused */
      reused: boolean;
    }
  | { ok: false; error: string; code: "unknown_symbol" | "invalid" };

/**
 * "Add any NSE ticker": resolve the symbol (master, aliases), upsert the
 * company (role 'adhoc', or into the portfolio when asked) and create / reuse
 * the `research:<SYMBOL>` job. Idempotent: an unfinished job is returned as-is;
 * a finished one is re-queued (every step is idempotent, cache hits are free).
 */
export async function startResearch(
  symbolInput: string,
  o: { portfolio?: boolean; maxCalls?: number; now?: number } = {},
): Promise<StartResearchResult> {
  const typed = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9&.-]{1,20}$/.test(typed))
    return {
      ok: false,
      error: "That does not look like an NSE symbol.",
      code: "invalid",
    };
  const r = await resolveNseSymbol(typed);
  if (!r)
    return {
      ok: false,
      error: `${typed} is not an NSE-listed equity symbol (checked the current EQUITY_L master and known old symbols).`,
      code: "unknown_symbol",
    };
  const { created } = await ensureCompany(r, {
    portfolio: o.portfolio,
    now: o.now,
  });
  const {
    job,
    created: jobCreated,
    reset,
  } = await createJob({
    id: researchJobId(r.symbol),
    kind: "research",
    isin: r.isin,
    params: {
      symbol: r.symbol,
      isin: r.isin,
      name: r.name,
      portfolio: Boolean(o.portfolio),
      maxCalls: o.maxCalls ?? 10,
      transcripts: 4,
    },
    now: o.now,
  });
  return {
    ok: true,
    jobId: job.id,
    symbol: r.symbol,
    isin: r.isin,
    name: r.name,
    created,
    reused: !jobCreated && !reset,
  };
}

export interface ContinueOptions {
  deadlineMs?: number;
  force?: boolean;
}

/** Run the job's steps until done or the deadline; returns the runner result. */
export async function continueJob(
  id: string,
  o: ContinueOptions = {},
): Promise<RunResult> {
  const job = await loadJob(id);
  if (!job) throw new Error(`job ${id} not found`);
  if (!isJobKind(job.kind)) throw new Error(`unknown job kind ${job.kind}`);
  const steps = stepsForKind(job.kind);
  const r = await runSteps(id, steps, {
    deadlineMs: o.deadlineMs ?? DEFAULT_DEADLINE_MS,
    force: o.force,
  });
  log.info(
    {
      id,
      state: r.state,
      step: r.step,
      ran: r.ranSteps,
      ms: r.elapsedMs,
      busy: r.busy,
    },
    "job continued",
  );
  return r;
}

/** CLI helper: keep continuing until the job is done or failed (each call bounded by the deadline). */
export async function runJobToCompletion(
  id: string,
  o: ContinueOptions & { maxCalls?: number } = {},
): Promise<RunResult> {
  let r = await continueJob(id, { ...o, force: o.force ?? true });
  let calls = 1;
  while (!r.done && r.state !== "failed" && calls < (o.maxCalls ?? 40)) {
    r = await continueJob(id, { ...o, force: true });
    calls++;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Status (the receipt)
// ---------------------------------------------------------------------------

export interface JobStatusStep extends ReceiptStep {
  name: string;
  /** the full step sentence (the receipt row shows the short `detail`) */
  message?: string;
  ms: number | null;
  data: Record<string, unknown> | null;
}

export interface JobStatus {
  id: string;
  kind: string;
  isin: string | null;
  symbol: string | null;
  companyName: string | null;
  state: string;
  step: string;
  done: boolean;
  failed: boolean;
  error: string | null;
  steps: JobStatusStep[];
  /** receipt footer: counts worth repeating ("6 transcripts · 23 statements · 4 settled") */
  summary: string | null;
  flags: {
    arOnly: boolean;
    budgetExhausted: boolean;
    unknownSymbol: boolean;
  };
  budget: string;
  href: string | null;
  createdAt: number;
  updatedAt: number;
  elapsedMs: number;
  /** last few human lines (notes, warnings) */
  notes: string[];
}

function stepState(
  entries: JobLogEntry[],
  name: string,
  jobState: string,
  current: string,
): { state: ReceiptState; last: JobLogEntry | null } {
  const mine = entries.filter((e) => e.step === name);
  const last = mine.at(-1) ?? null;
  if (!mine.length)
    return {
      state: jobState === "failed" && current !== name ? "queued" : "queued",
      last: null,
    };
  const phases = mine.map((e) => e.data?.phase);
  if (phases.includes("end")) return { state: "done", last };
  if (phases.includes("skip")) return { state: "skipped", last };
  const lastPhase = phases.at(-1);
  if (lastPhase === "fail")
    return {
      state:
        jobState === "running" || jobState === "queued" ? "working" : "failed",
      last,
    };
  if (jobState === "running") return { state: "working", last };
  if (jobState === "queued") return { state: "working", last }; // mid-step, waiting for the next continue
  return { state: "failed", last };
}

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const plural = (k: number, one: string, many = `${one}s`) =>
  `${k} ${k === 1 ? one : many}`;

/** Short right-hand detail for the receipt row (the full sentence stays in `message`). */
export function shortDetail(
  name: string,
  data: Record<string, unknown>,
  fallback: string,
): string {
  switch (name) {
    case "resolve_company":
      return typeof data.isin === "string"
        ? `${data.symbol ?? ""} → ${data.isin}`.trim()
        : fallback;
    case "fetch_announcements": {
      const f = n(data.filings);
      const e = n(data.events);
      return f === null
        ? fallback
        : `${plural(f, "filing")} · ${plural(e ?? 0, "event")}`;
    }
    case "fetch_results": {
      const q = n(data.quarters);
      return q === null ? fallback : q ? plural(q, "quarter") : "no XBRL";
    }
    case "fetch_prices": {
      const s = n(data.sessions);
      return s === null ? fallback : plural(s, "session");
    }
    case "discover_documents": {
      const tr = n(data.transcripts);
      const ar = n(data.annualReports);
      return tr === null
        ? fallback
        : `${plural(tr, "transcript")} · ${ar ?? 0} AR`;
    }
    case "fetch_documents": {
      const p = n(data.pages);
      return p === null ? fallback : `${p.toLocaleString("en-IN")} pages`;
    }
    case "extract_guidance": {
      const s = n(data.statements);
      if (data.arOnly) return "AR only";
      return s === null
        ? fallback
        : `${plural(s, "statement")}${data.budgetExhausted ? " · queued" : ""}`;
    }
    case "adjudicate_ledger": {
      const s = n(data.settled);
      return s === null ? fallback : `${s} settled`;
    }
    case "scan_anomalies": {
      const a = n(data.anomalies);
      return a === null ? fallback : plural(a, "anomaly", "anomalies");
    }
    case "evaluate_tripwires": {
      const a = n(data.inserted);
      return a === null ? fallback : `${plural(a, "new alert")}`;
    }
    default:
      return fallback;
  }
}

function detailFor(
  entries: JobLogEntry[],
  name: string,
  state: ReceiptState,
): {
  detail: string | undefined;
  message: string | undefined;
  ms: number | null;
} {
  const mine = entries.filter((e) => e.step === name);
  const end = [...mine]
    .reverse()
    .find((e) => e.data?.phase === "end" || e.data?.phase === "skip");
  if (end) {
    const ms = typeof end.data?.ms === "number" ? end.data.ms : null;
    const short = shortDetail(name, end.data ?? {}, end.msg);
    return {
      detail:
        ms !== null && ms >= 1000
          ? `${short} · ${(ms / 1000).toFixed(1)} s`
          : short,
      message: end.msg,
      ms,
    };
  }
  const prog = [...mine].reverse().find((e) => e.data?.phase === "progress");
  if (prog && state === "working")
    return { detail: prog.msg, message: prog.msg, ms: null };
  const fail = [...mine].reverse().find((e) => e.data?.phase === "fail");
  if (fail && state === "failed") {
    const reason = fail.msg.replace(/^.*? — failed: /, "");
    return { detail: reason.slice(0, 60), message: reason, ms: null };
  }
  return { detail: undefined, message: undefined, ms: null };
}

export async function getJobStatus(id: string): Promise<JobStatus | null> {
  const job = await loadJob(id);
  if (!job) return null;
  const entries = parseLog(job.logJson);
  const params = paramsOf(entries);
  const kind = isJobKind(job.kind) ? job.kind : null;
  const defs = kind ? stepsForKind(kind) : [];
  const steps: JobStatusStep[] = defs.map((d) => {
    const { state, last } = stepState(entries, d.name, job.state, job.step);
    const { detail, message, ms } = detailFor(entries, d.name, state);
    return {
      name: d.name,
      label: d.label,
      state,
      detail,
      message,
      ms,
      data: (last?.data as Record<string, unknown> | undefined) ?? null,
    };
  });
  let symbol = typeof params.symbol === "string" ? params.symbol : null;
  let companyName: string | null = null;
  if (job.isin) {
    const c = await db
      .select({ symbol: t.companies.nseSymbol, name: t.companies.name })
      .from(t.companies)
      .where(eq(t.companies.isin, job.isin))
      .limit(1);
    if (c[0]) {
      symbol = c[0].symbol;
      companyName = c[0].name;
    }
  }
  const data = (name: string) =>
    [...entries]
      .reverse()
      .find(
        (e) =>
          e.step === name &&
          (e.data?.phase === "end" || e.data?.phase === "skip"),
      )?.data ?? {};
  const docs = data("fetch_documents");
  const guid = data("extract_guidance");
  const ledger = data("adjudicate_ledger");
  const disc = data("discover_documents");
  const summaryParts: string[] = [];
  if (typeof docs.transcripts === "number")
    summaryParts.push(
      `${docs.transcripts} transcript${docs.transcripts === 1 ? "" : "s"}`,
    );
  if (typeof guid.statements === "number")
    summaryParts.push(
      `${guid.statements} statement${guid.statements === 1 ? "" : "s"}`,
    );
  if (typeof ledger.settled === "number")
    summaryParts.push(`${ledger.settled} settled`);
  const flags = {
    arOnly: Boolean(disc.arOnly || guid.arOnly),
    budgetExhausted: Boolean(guid.budgetExhausted),
    unknownSymbol:
      job.state === "failed" && /unknown NSE symbol/i.test(job.error ?? ""),
  };
  const notes = entries
    .filter(
      (e) =>
        e.data?.phase === "note" || e.level === "warn" || e.level === "error",
    )
    .slice(-6)
    .map((e) => e.msg);
  return {
    id: job.id,
    kind: job.kind,
    isin: job.isin,
    symbol,
    companyName,
    state: job.state,
    step: job.step,
    done: job.state === "done",
    failed: job.state === "failed",
    error: job.error,
    steps,
    summary: summaryParts.length ? summaryParts.join(" · ") : null,
    flags,
    budget: await budgetLine(),
    href: symbol ? `/c/${encodeURIComponent(symbol)}` : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    elapsedMs:
      (job.state === "done" || job.state === "failed"
        ? job.updatedAt
        : Date.now()) - job.createdAt,
    notes,
  };
}

/** The raw row (kind/state) for route guards. */
export const loadJobPublic = loadJob;

/** Jobs touched recently (status page / debugging). */
export async function listRecentJobs(limit = 12) {
  return db.select().from(t.jobs).orderBy(desc(t.jobs.updatedAt)).limit(limit);
}

// ---------------------------------------------------------------------------
// On-visit staleness refresh (FINN_REFRESH_ON_VISIT=true)
// ---------------------------------------------------------------------------

export const STALE_AFTER_MS = 6 * 3_600_000;

/**
 * When enabled, returns a thunk for `after()` that runs a rules-only
 * announcements job if the newest stored announcement is older than 6 h and
 * no job is currently running. At most one such job per IST hour (stable id).
 */
export async function scheduleRefreshOnVisit(
  now = Date.now(),
): Promise<(() => Promise<void>) | null> {
  if ((process.env.FINN_REFRESH_ON_VISIT ?? "").toLowerCase() !== "true")
    return null;
  try {
    const newest = await db
      .select({ m: max(t.announcements.filedAt) })
      .from(t.announcements);
    const newestMs = newest[0]?.m ?? 0;
    if (now - newestMs < STALE_AFTER_MS) return null;
    const running = await db
      .select({ id: t.jobs.id, updatedAt: t.jobs.updatedAt })
      .from(t.jobs)
      .where(eq(t.jobs.state, "running"));
    if (running.some((r) => now - r.updatedAt < 90_000)) return null;
    const id = `announcements:visit:${istDateKey(now)}T${formatIst(now, "HH")}`;
    const existing = await loadJob(id);
    if (existing) return null; // already tried this hour
    return async () => {
      try {
        await createJob({
          id,
          kind: "announcements",
          params: { hours: 24, llm: false, trigger: "visit" },
          now,
        });
        const r = await continueJob(id, { deadlineMs: 45_000 });
        log.info(
          { id, state: r.state, ms: r.elapsedMs },
          "on-visit refresh ran",
        );
      } catch (e) {
        log.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "on-visit refresh failed",
        );
      }
    };
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "on-visit refresh check failed",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auth for /api/jobs/*
// ---------------------------------------------------------------------------

/** Bearer check: JOBS_SECRET (or Vercel's CRON_SECRET). With no secret configured, allowed outside production. */
export function jobsAuthorised(req: Request): boolean {
  const secret = env().JOBS_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return env().NODE_ENV !== "production";
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

/** Browser-initiated "continue" calls: same-origin only (no secret in the client). */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

export { withBusyRetry };
