import { NextResponse } from "next/server";
import { getJobStatus } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/jobs/status/:id — the working receipt as JSON (steps with
 * states, timings and counts). Public read: job logs carry no secrets; the
 * Add-company page polls this every 2 s.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const status = await getJobStatus(decodeURIComponent(id));
  if (!status)
    return NextResponse.json(
      { ok: false, error: "job not found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  return NextResponse.json(
    { ok: true, ...status },
    { headers: { "cache-control": "no-store" } },
  );
}
