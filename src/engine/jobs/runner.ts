/**
 * Jobs runner — resumable, idempotent, deadline-bounded step execution.
 *
 *   createJob({ id, kind, isin, params })      → `jobs` row (state 'queued', params in the log)
 *   runSteps(jobId, steps, { deadlineMs })      → runs steps from the persisted cursor until the
 *                                                 deadline, then returns { done:false, next } so
 *                                                 the next call ("continue") resumes where it
 *                                                 stopped. Every step is retried once; optional
 *                                                 steps fail soft, required ones fail the job.
 *
 * State lives entirely in the `jobs` row: `step` is the cursor, `state` is
 * queued | running | done | failed, `log_json` is the receipt (JobLogEntry[])
 * and also carries the job params (`step: "params"`) and per-step progress
 * cursors (`data.phase = "progress"`). No background worker, no extra tables.
 *
 * Concurrency: a job in state 'running' whose row was touched less than
 * LEASE_MS ago is considered owned by another invocation and is left alone
 * (the HTTP caller sees `busy: true`). Steps call `ctx.heartbeat()` during
 * long loops to keep the lease.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { type JobRow, jobs } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { JobLogEntry } from "../types";

const log = logger.child({ mod: "engine/jobs/runner" });

export const DEFAULT_DEADLINE_MS = 50_000;
/** a 'running' row older than this is stale (crashed invocation) and may be taken over */
export const LEASE_MS = 90_000;
/** do not start a step with less than this left */
const MIN_STEP_BUDGET_MS = 2_500;
/** guard against a step that keeps reporting progress without finishing */
const MAX_ITERATIONS = 200;
/** in-flight calls may run this long past the deadline before being aborted (Vercel maxDuration is 60 s) */
const ABORT_GRACE_MS = 7_000;

export type JobParams = Record<string, unknown>;

export type StepOutcome =
  | { done: true; msg: string; data?: Record<string, unknown> }
  | {
      /** more work remains in this step — the runner re-invokes it (same call if time allows) */
      done: false;
      msg: string;
      cursor?: unknown;
      data?: Record<string, unknown>;
      /** nothing more can be done in THIS invocation (deferred for time) — resume on the next call */
      pause?: boolean;
    }
  | { skipped: true; msg: string; data?: Record<string, unknown> };

export interface StepContext<P extends JobParams = JobParams> {
  jobId: string;
  kind: string;
  isin: string | null;
  params: P;
  /** the last progress cursor this step persisted (undefined on first run) */
  cursor: unknown;
  /** ms until the deadline */
  timeLeft(): number;
  /** aborted at the deadline — pass to fetches that accept it */
  signal: AbortSignal;
  /** append a line to the receipt */
  log(
    msg: string,
    data?: Record<string, unknown>,
    level?: JobLogEntry["level"],
  ): Promise<void>;
  /** touch the row so the lease stays fresh during long loops */
  heartbeat(): Promise<void>;
}

export interface JobStepDef<P extends JobParams = JobParams> {
  /** JobStep or a kind-specific name; stored in jobs.step */
  name: string;
  /** receipt label */
  label: string;
  /** a failure here is logged and the job continues (default: required) */
  optional?: boolean;
  run: (ctx: StepContext<P>) => Promise<StepOutcome>;
}

export interface RunResult {
  jobId: string;
  state: JobRow["state"] | string;
  step: string;
  done: boolean;
  /** another invocation holds the lease */
  busy?: boolean;
  /** step to resume at when not done */
  next?: string;
  ranSteps: string[];
  elapsedMs: number;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// SQLite busy retry (another process is ingesting into the same file)
// ---------------------------------------------------------------------------

export async function withBusyRetry<T>(
  fn: () => Promise<T>,
  tries = 5,
  baseMs = 120,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(msg)) throw e;
      await new Promise((r) =>
        setTimeout(r, baseMs * 2 ** i + Math.random() * 100),
      );
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

export function parseLog(raw: string | null | undefined): JobLogEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as JobLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function paramsOf(entries: JobLogEntry[]): JobParams {
  const p = entries.find((e) => e.step === "params");
  return (p?.data as JobParams | undefined) ?? {};
}

export function cursorOf(entries: JobLogEntry[], step: string): unknown {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as JobLogEntry;
    if (e.step !== step) continue;
    const phase = e.data?.phase;
    if (phase === "progress") return e.data?.cursor;
    if (phase === "end" || phase === "skip") return undefined;
  }
  return undefined;
}

export async function loadJob(id: string): Promise<JobRow | null> {
  const rows = await withBusyRetry(() =>
    db.select().from(jobs).where(eq(jobs.id, id)).limit(1),
  );
  return rows[0] ?? null;
}

export interface CreateJobInput {
  id: string;
  kind: string;
  isin?: string | null;
  params?: JobParams;
  /** when the id exists and is done/failed, reset it to queued (default true) */
  reset?: boolean;
  now?: number;
}

/**
 * Insert-if-absent. An existing unfinished job is returned as-is (idempotent
 * "start"); a finished one is reset to queued with fresh params when `reset`.
 */
export async function createJob(
  input: CreateJobInput,
): Promise<{ job: JobRow; created: boolean; reset: boolean }> {
  const now = input.now ?? Date.now();
  const existing = await loadJob(input.id);
  const paramsEntry: JobLogEntry = {
    at: now,
    step: "params",
    msg: "job created",
    level: "info",
    data: { ...(input.params ?? {}), phase: "params" },
  };
  if (existing) {
    const finished = existing.state === "done" || existing.state === "failed";
    if (finished && input.reset !== false) {
      await withBusyRetry(() =>
        db
          .update(jobs)
          .set({
            isin: input.isin ?? existing.isin,
            step: "queued",
            state: "queued",
            logJson: JSON.stringify([paramsEntry]),
            error: null,
            createdAt: now,
            updatedAt: now,
          })
          .where(eq(jobs.id, input.id)),
      );
      const job = (await loadJob(input.id)) as JobRow;
      return { job, created: false, reset: true };
    }
    return { job: existing, created: false, reset: false };
  }
  await withBusyRetry(() =>
    db.insert(jobs).values({
      id: input.id,
      kind: input.kind,
      isin: input.isin ?? null,
      step: "queued",
      state: "queued",
      logJson: JSON.stringify([paramsEntry]),
      error: null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const job = (await loadJob(input.id)) as JobRow;
  return { job, created: true, reset: false };
}

async function patchJob(
  id: string,
  set: Partial<{
    step: string;
    state: string;
    error: string | null;
    logJson: string;
  }>,
  now: number,
): Promise<void> {
  await withBusyRetry(() =>
    db
      .update(jobs)
      .set({ ...set, updatedAt: now })
      .where(eq(jobs.id, id)),
  );
}

// ---------------------------------------------------------------------------
// runSteps
// ---------------------------------------------------------------------------

export interface RunStepsOptions {
  /** wall-clock budget for this invocation (default 50 s) */
  deadlineMs?: number;
  now?: number;
  /** take over a 'running' row regardless of its lease (CLI use) */
  force?: boolean;
}

export async function runSteps<P extends JobParams>(
  jobId: string,
  steps: JobStepDef<P>[],
  o: RunStepsOptions = {},
): Promise<RunResult> {
  const started = o.now ?? Date.now();
  const deadline = started + (o.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const ran: string[] = [];
  const result = (
    job: Pick<JobRow, "state" | "step">,
    extra: Partial<RunResult> = {},
  ): RunResult => ({
    jobId,
    state: job.state,
    step: job.step,
    done: job.state === "done",
    ranSteps: ran,
    elapsedMs: Date.now() - started,
    ...extra,
  });

  const job = await loadJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  if (job.state === "done") return result(job);
  if (job.state === "failed") return result(job, { error: job.error });
  if (
    job.state === "running" &&
    !o.force &&
    Date.now() - job.updatedAt < LEASE_MS
  )
    return result(job, { busy: true, next: job.step });

  // in-memory copy of the log; every write persists the whole array
  let entries = parseLog(job.logJson);
  const params = paramsOf(entries) as P;
  const persist = async (
    set: Partial<{ step: string; state: string; error: string | null }>,
  ) =>
    patchJob(jobId, { ...set, logJson: JSON.stringify(entries) }, Date.now());
  const append = async (
    step: string,
    msg: string,
    data?: Record<string, unknown>,
    level: JobLogEntry["level"] = "info",
  ) => {
    entries = [...entries, { at: Date.now(), step, msg, level, data }];
    await persist({});
  };

  // in-flight network / model calls get a short grace period past the deadline
  // (a wasted model call still counts against the daily quota)
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("job deadline reached")),
    Math.max(0, deadline + ABORT_GRACE_MS - Date.now()),
  );

  let idx =
    job.step === "queued" ? 0 : steps.findIndex((s) => s.name === job.step);
  if (idx < 0) idx = 0;
  await persist({ state: "running", step: steps[idx]?.name ?? "done" });

  try {
    let iterations = 0;
    while (idx < steps.length) {
      const def = steps[idx] as JobStepDef<P>;
      if (++iterations > MAX_ITERATIONS) {
        await persist({ state: "queued", step: def.name });
        return result({ state: "queued", step: def.name }, { next: def.name });
      }
      const timeLeft = deadline - Date.now();
      if (timeLeft < MIN_STEP_BUDGET_MS) {
        await persist({ state: "queued", step: def.name });
        return result({ state: "queued", step: def.name }, { next: def.name });
      }
      const ctx: StepContext<P> = {
        jobId,
        kind: job.kind,
        isin: job.isin,
        params,
        cursor: cursorOf(entries, def.name),
        timeLeft: () => deadline - Date.now(),
        signal: controller.signal,
        log: (msg, data, level) => append(def.name, msg, data, level),
        heartbeat: () => persist({}),
      };
      const attemptsBefore = entries.filter(
        (e) => e.step === def.name && e.data?.phase === "fail",
      ).length;
      const t0 = Date.now();
      await append(def.name, `${def.label} — started`, {
        phase: "start",
        attempt: attemptsBefore + 1,
      });
      let outcome: StepOutcome | null = null;
      let error: string | null = null;
      try {
        outcome = await def.run(ctx);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const ms = Date.now() - t0;
      if (outcome && "skipped" in outcome) {
        await append(def.name, outcome.msg, {
          ...(outcome.data ?? {}),
          phase: "skip",
          ms,
        });
        ran.push(def.name);
        idx++;
        if (idx < steps.length)
          await persist({ step: steps[idx]?.name ?? "done" });
        continue;
      }
      if (outcome && outcome.done === false) {
        const prevCursor = JSON.stringify(ctx.cursor ?? null);
        const nextCursor = JSON.stringify(outcome.cursor ?? null);
        await append(def.name, outcome.msg, {
          ...(outcome.data ?? {}),
          phase: "progress",
          cursor: outcome.cursor,
          ms,
        });
        ran.push(def.name);
        // deferred for time, or no observable progress: hand the step to the next invocation
        if (outcome.pause || prevCursor === nextCursor) {
          await persist({ state: "queued", step: def.name });
          return result(
            { state: "queued", step: def.name },
            { next: def.name },
          );
        }
        continue; // same step again (deadline check at the top of the loop)
      }
      if (outcome?.done) {
        await append(def.name, outcome.msg, {
          ...(outcome.data ?? {}),
          phase: "end",
          ms,
        });
        ran.push(def.name);
        idx++;
        if (idx < steps.length)
          await persist({ step: steps[idx]?.name ?? "done" });
        continue;
      }
      // failure
      const aborted = controller.signal.aborted;
      const attempt = attemptsBefore + 1;
      await append(
        def.name,
        `${def.label} — failed: ${(error ?? "unknown error").slice(0, 240)}`,
        { phase: "fail", attempt, ms, aborted },
        "error",
      );
      log.warn(
        { jobId, step: def.name, attempt, err: error?.slice(0, 200), aborted },
        "job step failed",
      );
      if (aborted) {
        // the deadline cut a step short — resume it on the next call, not a failure
        await persist({ state: "queued", step: def.name });
        return result({ state: "queued", step: def.name }, { next: def.name });
      }
      if (attempt < 2 && deadline - Date.now() > MIN_STEP_BUDGET_MS) continue; // retry once
      if (def.optional) {
        idx++;
        if (idx < steps.length)
          await persist({ step: steps[idx]?.name ?? "done" });
        continue;
      }
      await persist({
        state: "failed",
        step: def.name,
        error: (error ?? "unknown error").slice(0, 500),
      });
      return result(
        { state: "failed", step: def.name },
        { error: error ?? "unknown error" },
      );
    }
    await append("done", "done", { phase: "end" });
    await persist({ state: "done", step: "done" });
    return result({ state: "done", step: "done" });
  } finally {
    clearTimeout(timer);
  }
}
