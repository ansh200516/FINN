/**
 * "Any NSE ticker" → an ISIN-keyed company row.
 *
 * Resolution order: companies table (symbol or alias) → bundled
 * public/data/symbols.json (EQUITY_L snapshot, ISIN-keyed, read from disk or
 * fetched from the app's own origin on Vercel) → the alias table for symbol
 * churn (TATAMOTORS → TMPV) → NSE EQUITY_L.csv download (cached in /tmp when
 * the repo cache dir is read-only).
 */
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parseJsonColumn, StringArray } from "@/db/json";
import { companies, users } from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  fetchEquityMaster,
  indexMaster,
  resolveSymbol as resolveInMaster,
  SYMBOL_ALIASES,
} from "../sources/nse-master";
import { withBusyRetry } from "./runner";

const log = logger.child({ mod: "engine/jobs/resolve" });

export interface ResolvedSymbol {
  symbol: string;
  isin: string;
  name: string;
  series: string | null;
  /** where the answer came from */
  via: "db" | "symbols.json" | "alias" | "equity_l";
  /** the symbol the user typed, when it differs (old symbol / alias) */
  typed?: string;
}

type Row = [string, string, string] | [string, string, string, string];

let symbolsCache: { rows: Row[]; loadedAt: number } | null = null;

async function loadSymbolsJson(): Promise<Row[] | null> {
  if (symbolsCache && Date.now() - symbolsCache.loadedAt < 6 * 3_600_000)
    return symbolsCache.rows;
  const path = join(process.cwd(), "public", "data", "symbols.json");
  try {
    if (existsSync(path)) {
      const j = JSON.parse(readFileSync(path, "utf8")) as { rows?: Row[] };
      if (Array.isArray(j.rows)) {
        symbolsCache = { rows: j.rows, loadedAt: Date.now() };
        return j.rows;
      }
    }
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "symbols.json unreadable",
    );
  }
  // serverless: the static asset is served by the deployment itself
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (base) {
    try {
      const r = await fetch(`${base}/data/symbols.json`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (r.ok) {
        const j = (await r.json()) as { rows?: Row[] };
        if (Array.isArray(j.rows)) {
          symbolsCache = { rows: j.rows, loadedAt: Date.now() };
          return j.rows;
        }
      }
    } catch (e) {
      log.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "symbols.json fetch failed",
      );
    }
  }
  return null;
}

function pickEq(rows: Row[]): Row | undefined {
  return rows.find((r) => !r[3] || r[3] === "EQ") ?? rows[0];
}

/** Resolve a typed symbol / old symbol / ISIN to the current NSE listing. */
export async function resolveNseSymbol(
  query: string,
): Promise<ResolvedSymbol | null> {
  const q = query.trim().toUpperCase();
  if (!q) return null;

  // 1. companies table — current symbol, then alias
  const direct = await db
    .select()
    .from(companies)
    .where(eq(companies.nseSymbol, q))
    .limit(1);
  if (direct[0])
    return {
      symbol: direct[0].nseSymbol,
      isin: direct[0].isin,
      name: direct[0].name,
      series: null,
      via: "db",
    };
  const viaAlias = await db
    .select()
    .from(companies)
    .where(
      sql`exists (select 1 from json_each(${companies.aliasesJson}) where upper(json_each.value) = ${q})`,
    )
    .limit(1);
  if (viaAlias[0])
    return {
      symbol: viaAlias[0].nseSymbol,
      isin: viaAlias[0].isin,
      name: viaAlias[0].name,
      series: null,
      via: "alias",
      typed: q,
    };

  // 2. bundled master
  const rows = await loadSymbolsJson();
  if (rows) {
    const bySym = rows.filter((r) => r[0].toUpperCase() === q);
    const hit = pickEq(bySym) ?? pickEq(rows.filter((r) => r[2] === q));
    if (hit)
      return {
        symbol: hit[0],
        isin: hit[2],
        name: hit[1],
        series: hit[3] ?? "EQ",
        via: "symbols.json",
      };
    for (const [current, olds] of Object.entries(SYMBOL_ALIASES)) {
      if (!olds.includes(q)) continue;
      const cur = pickEq(rows.filter((r) => r[0].toUpperCase() === current));
      if (cur)
        return {
          symbol: cur[0],
          isin: cur[2],
          name: cur[1],
          series: cur[3] ?? "EQ",
          via: "alias",
          typed: q,
        };
    }
  }

  // 3. live EQUITY_L.csv (cache in the repo dir when writable, else /tmp)
  try {
    const cachePath = existsSync(join(process.cwd(), "data", "cache"))
      ? undefined
      : join(tmpdir(), "finn-equity-l.csv");
    const master = await fetchEquityMaster({ cachePath });
    const m = resolveInMaster(indexMaster(master), q);
    if (m)
      return {
        symbol: m.symbol,
        isin: m.isin,
        name: m.name,
        series: m.series || "EQ",
        via: "equity_l",
        typed: m.symbol === q ? undefined : q,
      };
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "EQUITY_L fallback failed",
    );
  }
  return null;
}

export interface EnsureCompanyOptions {
  /** also mark in_portfolio and append to the demo user's portfolio */
  portfolio?: boolean;
  userId?: string;
  now?: number;
}

/**
 * Insert the company if absent (role 'adhoc' unless `portfolio`), keeping an
 * old typed symbol as an alias. Returns the row and whether it was created.
 */
export async function ensureCompany(
  r: ResolvedSymbol,
  o: EnsureCompanyOptions = {},
): Promise<{ created: boolean; addedToPortfolio: boolean }> {
  const now = o.now ?? Date.now();
  const existing = await db
    .select()
    .from(companies)
    .where(eq(companies.isin, r.isin))
    .limit(1);
  let created = false;
  const aliases = new Set<string>();
  if (r.typed && r.typed !== r.symbol) aliases.add(r.typed);
  for (const old of SYMBOL_ALIASES[r.symbol] ?? []) aliases.add(old);
  if (!existing[0]) {
    await withBusyRetry(() =>
      db
        .insert(companies)
        .values({
          isin: r.isin,
          nseSymbol: r.symbol,
          name: r.name,
          aliasesJson: JSON.stringify([...aliases]),
          screenerSlug: r.symbol,
          inPortfolio: Boolean(o.portfolio),
          isAdhoc: !o.portfolio,
          addedAt: now,
        })
        .onConflictDoNothing(),
    );
    created = true;
  } else {
    const have = parseJsonColumn(StringArray, existing[0].aliasesJson, []);
    const merged = [...new Set([...have, ...aliases])];
    const patch: Partial<typeof companies.$inferInsert> = {};
    if (merged.length !== have.length)
      patch.aliasesJson = JSON.stringify(merged);
    if (o.portfolio && !existing[0].inPortfolio) patch.inPortfolio = true;
    if (Object.keys(patch).length)
      await withBusyRetry(() =>
        db.update(companies).set(patch).where(eq(companies.isin, r.isin)),
      );
  }
  let addedToPortfolio = false;
  if (o.portfolio) {
    const userId = o.userId ?? "demo";
    const u = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u[0]) {
      await withBusyRetry(() =>
        db
          .insert(users)
          .values({
            id: userId,
            portfolioIsinsJson: JSON.stringify([r.isin]),
            createdAt: now,
            lastSeenAt: now,
          })
          .onConflictDoNothing(),
      );
      addedToPortfolio = true;
    } else {
      const cur = parseJsonColumn(StringArray, u[0].portfolioIsinsJson, []);
      if (!cur.includes(r.isin)) {
        await withBusyRetry(() =>
          db
            .update(users)
            .set({
              portfolioIsinsJson: JSON.stringify([...cur, r.isin]),
              lastSeenAt: now,
            })
            .where(eq(users.id, userId)),
        );
        addedToPortfolio = true;
      }
    }
  }
  return { created, addedToPortfolio };
}
