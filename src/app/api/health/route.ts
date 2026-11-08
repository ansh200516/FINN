import { NextResponse } from "next/server";
import { pingDb } from "@/db/client";
import { formatIst } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const now = Date.now();
  const dbOk = await pingDb();
  return NextResponse.json(
    {
      ok: true,
      dbOk,
      time: {
        utc: new Date(now).toISOString(),
        ist: formatIst(now, "dd MMM yyyy HH:mm:ss"),
        ms: now,
      },
      region: process.env.VERCEL_REGION ?? "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { status: dbOk ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
