import { NextResponse } from "next/server";
import {
  type AnyJobKind,
  continueJob,
  isJobKind,
  jobsAuthorised,
  loadJobPublic,
  sameOrigin,
  startJob,
  startResearch,
} from "@/lib/jobs";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Vercel function budget; the runner stops at 50 s and asks to be continued. */
export const maxDuration = 60;

const log = logger.child({ mod: "api/jobs" });

/**
 * POST /api/jobs/{announcements|prices|results|documents|research|eod|digest}
 *   Authorization: Bearer $JOBS_SECRET   (Vercel cron sends CRON_SECRET; GET is accepted for cron)
 *   ?id=<job id>         continue an existing job (the "continue" pattern)
 *   ?deadline=<ms>       wall-clock budget for this invocation (default 50 000)
 *   body (optional JSON) kind params: { hours, llm, symbol, portfolio, days }
 *
 * Every invocation runs steps until the deadline and persists progress, so a
 * job that needs more time returns { done:false, next } and the caller (cron
 * retry, the Add-company page, a shell loop) calls again.
 *
 * Browser callers may continue an existing `research:*` job without the
 * secret (same-origin only): the job was created by a server action, and
 * continuing it only advances work the server already agreed to do.
 */
async function handle(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!isJobKind(kind))
    return NextResponse.json(
      { ok: false, error: `unknown job kind "${kind}"` },
      { status: 404 },
    );
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const deadlineMs = Math.min(
    55_000,
    Math.max(
      3_000,
      Number(url.searchParams.get("deadline") ?? 50_000) || 50_000,
    ),
  );

  const continueOnly =
    Boolean(id) &&
    kind === "research" &&
    req.method === "POST" &&
    sameOrigin(req);
  if (!continueOnly && !jobsAuthorised(req))
    return NextResponse.json(
      { ok: false, error: "unauthorised" },
      { status: 401 },
    );

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { ok: false, error: "body must be JSON" },
        { status: 400 },
      );
    }
  }
  for (const k of ["hours", "llm", "symbol", "portfolio", "days", "maxCalls"]) {
    const v = url.searchParams.get(k);
    if (v !== null && body[k] === undefined)
      body[k] =
        v === "1" || v === "true"
          ? true
          : v === "0" || v === "false"
            ? false
            : Number.isFinite(Number(v)) && v !== ""
              ? Number(v)
              : v;
  }

  const t0 = Date.now();
  try {
    let jobId = id;
    let started: unknown = null;
    if (!jobId) {
      if (kind === "research") {
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        const r = await startResearch(symbol, {
          portfolio: body.portfolio === true,
          maxCalls:
            typeof body.maxCalls === "number" ? body.maxCalls : undefined,
        });
        if (!r.ok)
          return NextResponse.json(
            { ok: false, error: r.error, code: r.code },
            { status: 404 },
          );
        jobId = r.jobId;
        started = r;
      } else {
        const { job, created } = await startJob({
          kind: kind as AnyJobKind,
          params: body,
        });
        jobId = job.id;
        started = { created, id: job.id };
      }
    } else {
      const job = await loadJobPublic(jobId);
      if (!job)
        return NextResponse.json(
          { ok: false, error: `job ${jobId} not found` },
          { status: 404 },
        );
      if (job.kind !== kind)
        return NextResponse.json(
          { ok: false, error: `job ${jobId} is a ${job.kind} job` },
          { status: 400 },
        );
    }
    const r = await continueJob(jobId, { deadlineMs });
    return NextResponse.json(
      {
        ok: r.state !== "failed",
        job: jobId,
        kind,
        state: r.state,
        step: r.step,
        done: r.done,
        busy: r.busy ?? false,
        next: r.next ?? null,
        ran: r.ranSteps,
        error: r.error ?? null,
        started,
        ms: Date.now() - t0,
        statusUrl: `/api/jobs/status/${encodeURIComponent(jobId)}`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ kind, id, err: msg }, "job route failed");
    return NextResponse.json(
      { ok: false, kind, error: msg.slice(0, 500), ms: Date.now() - t0 },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;
