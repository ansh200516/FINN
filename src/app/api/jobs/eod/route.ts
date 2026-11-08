import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily EOD job (Vercel cron, 15:00 UTC = 20:30 IST). Placeholder: builders
 * wire prices → anomalies → tripwires → digest here. Idempotent by design.
 * Auth: `Authorization: Bearer $JOBS_SECRET` (Vercel cron sends CRON_SECRET
 * as the bearer; set JOBS_SECRET to the same value).
 */
function authorised(req: Request): boolean {
  const secret = env().JOBS_SECRET;
  if (!secret) return env().NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorised(req))
    return NextResponse.json(
      { ok: false, error: "unauthorised" },
      { status: 401 },
    );
  return NextResponse.json(
    { ok: true, job: "eod", ran: [], note: "not implemented" },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = run;
export const POST = run;
