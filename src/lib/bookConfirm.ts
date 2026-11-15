/**
 * A chat tool may propose a book or alert change. The write happens only
 * when the user submits a token this module sealed. The model cannot mint one.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Tripwire, TripwireKind } from "@/engine/types";

const TTL_MS = 30 * 60 * 1000;

export type BookConfirm =
  | { op: "add"; symbol: string; exp: number }
  | { op: "remove"; symbol: string; exp: number }
  | {
      op: "alert";
      scope: "symbol" | "book";
      symbol: string | null;
      isin: string | null;
      rule: Tripwire;
      exp: number;
    }
  | {
      op: "alert_off";
      scope: "symbol" | "book";
      symbol: string | null;
      isin: string;
      kind: TripwireKind;
      drop?: string;
      exp: number;
    };

function secret(): string {
  return (
    process.env.JOBS_SECRET ||
    process.env.ASK_COOKIE_SECRET ||
    "finn-book-confirm-v1"
  );
}

export function sealBookConfirm(body: BookConfirm): string {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function openBookConfirm(token: string): BookConfirm | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as BookConfirm;
    if (!body || typeof body.exp !== "number" || body.exp < Date.now())
      return null;
    if (
      body.op !== "add" &&
      body.op !== "remove" &&
      body.op !== "alert" &&
      body.op !== "alert_off"
    )
      return null;
    return body;
  } catch {
    return null;
  }
}

export function confirmExpiry(now = Date.now()): number {
  return now + TTL_MS;
}
