/**
 * Company master: NSE EQUITY_L.csv (ISIN-keyed) ⋈ data/seed/portfolio.json →
 * `companies`. ISIN is the key everywhere; symbols churn (TATAMOTORS→TMPV/TMCV,
 * ZOMATO→ETERNAL) and old symbols are kept as aliases.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { companies } from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  fetchEquityMaster,
  indexMaster,
  type MasterIndex,
  resolveSymbol,
  SYMBOL_ALIASES,
} from "../sources/nse-master";
import type { Company } from "../types";
import type { IngestSummary } from "./index";

const log = logger.child({ mod: "engine/ingest/companies" });

export const PORTFOLIO_SEED_PATH = join(
  process.cwd(),
  "data",
  "seed",
  "portfolio.json",
);

/** Fallback when data/seed/portfolio.json is absent (docs/research/20 §4). */
export const DEFAULT_PORTFOLIO_SYMBOLS = [
  "RELIANCE",
  "HDFCBANK",
  "INDUSINDBK",
  "BAJFINANCE",
  "INFY",
  "KPITTECH",
  "SUNPHARMA",
  "LAURUSLABS",
  "TMPV",
  "HAL",
  "LT",
  "THERMAX",
  "HINDUNILVR",
  "MARICO",
  "BHARTIARTL",
  "IDEA",
  "FLUOROCHEM",
  "AMBER",
  "SUPREMEIND",
  "KALYANKJIL",
] as const;
export const DEFAULT_ADHOC_SYMBOLS = [
  "OLAELEC",
  "NUVAMA",
  "VEDL",
  "PIIND",
  "RAJESHEXPO",
] as const;

export const CompanyInput = z.object({
  isin: z.string().length(12),
  nseSymbol: z.string().min(1),
  bseCode: z.string().nullable().optional(),
  name: z.string().min(1),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  aliases: z.array(z.string()).default([]),
  screenerSlug: z.string().nullable().optional(),
  inPortfolio: z.boolean().default(true),
  isAdhoc: z.boolean().default(false),
});
export type CompanyInput = z.infer<typeof CompanyInput>;

const SeedFile = z.object({
  companies: z.array(CompanyInput).optional(),
  portfolio: z
    .array(
      z.object({
        isin: z.string(),
        mcap_cr: z.number().nullable().optional(),
        format: z.string().optional(),
        cap_bucket: z.string().optional(),
      }),
    )
    .optional(),
  adhoc: z
    .array(
      z.object({
        isin: z.string(),
        mcap_cr: z.number().nullable().optional(),
        format: z.string().optional(),
        cap_bucket: z.string().optional(),
      }),
    )
    .optional(),
  alternates: z
    .array(
      z.object({
        isin: z.string(),
        mcap_cr: z.number().nullable().optional(),
        format: z.string().optional(),
        cap_bucket: z.string().optional(),
      }),
    )
    .optional(),
});

export interface SeedMeta {
  /** market cap in rupees */
  mcapInr: number | null;
  format: string | null;
  capBucket: string | null;
}

let seedCache:
  | { companies: CompanyInput[]; meta: Map<string, SeedMeta> }
  | null
  | undefined;

/** Parse data/seed/portfolio.json (tolerates a bare array or {companies:[…]}); null when absent. */
export function loadPortfolioSeed(
  path = PORTFOLIO_SEED_PATH,
): { companies: CompanyInput[]; meta: Map<string, SeedMeta> } | null {
  if (seedCache !== undefined && path === PORTFOLIO_SEED_PATH) return seedCache;
  if (!existsSync(path)) {
    if (path === PORTFOLIO_SEED_PATH) seedCache = null;
    return null;
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const meta = new Map<string, SeedMeta>();
  let list: CompanyInput[];
  if (Array.isArray(raw)) list = z.array(CompanyInput).parse(raw);
  else {
    const f = SeedFile.parse(raw);
    list = f.companies ?? [];
    for (const section of [f.portfolio, f.adhoc, f.alternates]) {
      for (const e of section ?? []) {
        meta.set(e.isin, {
          mcapInr: e.mcap_cr ? e.mcap_cr * 1e7 : null,
          format: e.format ?? null,
          capBucket: e.cap_bucket ?? null,
        });
      }
    }
  }
  const res = { companies: list, meta };
  if (path === PORTFOLIO_SEED_PATH) seedCache = res;
  return res;
}

/** Market cap (rupees) for an ISIN from the seed verification data, if present. */
export function companyMcapInr(isin: string): number | null {
  return loadPortfolioSeed()?.meta.get(isin)?.mcapInr ?? null;
}

/** 'bank' | 'nbfc' | 'corporate' from the seed, else from the industry string. */
export function companyFormat(
  isin: string,
  industry?: string | null,
): "bank" | "nbfc" | "corporate" {
  const f = loadPortfolioSeed()?.meta.get(isin)?.format;
  if (f === "bank" || f === "nbfc") return f;
  const ind = (industry ?? "").toLowerCase();
  if (/\bbank\b/.test(ind)) return "bank";
  if (
    /nbfc|non banking|housing finance|financial services|stockbroking/.test(ind)
  )
    return "nbfc";
  return "corporate";
}

/** Apply master data (current symbol/name) and the alias table to an input. */
export function reconcileWithMaster(
  input: CompanyInput,
  idx: MasterIndex,
): CompanyInput {
  const m = idx.byIsin.get(input.isin);
  const aliases = new Set(input.aliases.map((a) => a.toUpperCase()));
  for (const old of SYMBOL_ALIASES[input.nseSymbol.toUpperCase()] ?? [])
    aliases.add(old);
  if (m) {
    if (m.symbol !== input.nseSymbol) {
      aliases.add(input.nseSymbol.toUpperCase());
      log.info(
        { isin: input.isin, old: input.nseSymbol, now: m.symbol },
        "symbol changed in master — aliasing",
      );
    }
    for (const old of SYMBOL_ALIASES[m.symbol] ?? []) aliases.add(old);
    aliases.delete(m.symbol);
    return {
      ...input,
      nseSymbol: m.symbol,
      name: input.name || m.name,
      aliases: [...aliases],
    };
  }
  aliases.delete(input.nseSymbol.toUpperCase());
  return { ...input, aliases: [...aliases] };
}

export async function upsertCompanies(
  inputs: CompanyInput[],
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    fetched: inputs.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  for (const c of inputs) {
    try {
      const existing = await db
        .select({ isin: companies.isin })
        .from(companies)
        .where(eq(companies.isin, c.isin))
        .limit(1);
      await db
        .insert(companies)
        .values({
          isin: c.isin,
          nseSymbol: c.nseSymbol,
          bseCode: c.bseCode ?? null,
          name: c.name,
          sector: c.sector ?? null,
          industry: c.industry ?? null,
          aliasesJson: JSON.stringify(c.aliases),
          screenerSlug: c.screenerSlug ?? c.nseSymbol,
          inPortfolio: c.inPortfolio,
          isAdhoc: c.isAdhoc,
        })
        .onConflictDoUpdate({
          target: companies.isin,
          set: {
            nseSymbol: c.nseSymbol,
            bseCode: c.bseCode ?? null,
            name: c.name,
            sector: c.sector ?? null,
            industry: c.industry ?? null,
            aliasesJson: JSON.stringify(c.aliases),
            screenerSlug: c.screenerSlug ?? c.nseSymbol,
            inPortfolio: c.inPortfolio,
            isAdhoc: c.isAdhoc,
          },
        });
      if (existing.length) summary.updated++;
      else summary.inserted++;
    } catch (e) {
      summary.errors.push(
        `${c.nseSymbol}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return summary;
}

export interface IngestCompaniesOptions {
  /** force re-download of EQUITY_L.csv */
  refreshMaster?: boolean;
  /** extra ad-hoc symbols/ISINs to add (isAdhoc = true) */
  adhocSymbols?: string[];
  seedPath?: string;
}

export interface IngestCompaniesResult {
  summary: IngestSummary;
  masterRows: number;
  resolved: string[];
  unresolved: string[];
}

/** Download the master, load the seed (or defaults), reconcile and upsert. */
export async function ingestCompanies(
  o: IngestCompaniesOptions = {},
): Promise<IngestCompaniesResult> {
  const master = await fetchEquityMaster({
    maxAgeMs: o.refreshMaster ? 0 : undefined,
  });
  const idx = indexMaster(master);
  const seed = loadPortfolioSeed(o.seedPath ?? PORTFOLIO_SEED_PATH);
  const inputs: CompanyInput[] = [];
  const unresolved: string[] = [];

  if (seed?.companies.length) {
    for (const c of seed.companies) inputs.push(reconcileWithMaster(c, idx));
    log.info({ n: seed.companies.length }, "portfolio seed loaded");
  } else {
    log.warn("data/seed/portfolio.json absent — using default 20+5 symbols");
    for (const sym of [
      ...DEFAULT_PORTFOLIO_SYMBOLS,
      ...DEFAULT_ADHOC_SYMBOLS,
    ]) {
      const m = resolveSymbol(idx, sym);
      if (!m) {
        unresolved.push(sym);
        continue;
      }
      const isAdhoc = (DEFAULT_ADHOC_SYMBOLS as readonly string[]).includes(
        sym,
      );
      inputs.push(
        reconcileWithMaster(
          {
            isin: m.isin,
            nseSymbol: m.symbol,
            name: m.name,
            aliases: [],
            inPortfolio: !isAdhoc,
            isAdhoc,
            screenerSlug: m.symbol,
          },
          idx,
        ),
      );
    }
  }
  for (const q of o.adhocSymbols ?? []) {
    const m = resolveSymbol(idx, q);
    if (!m) {
      unresolved.push(q);
      continue;
    }
    if (inputs.some((i) => i.isin === m.isin)) continue;
    inputs.push(
      reconcileWithMaster(
        {
          isin: m.isin,
          nseSymbol: m.symbol,
          name: m.name,
          aliases: [],
          inPortfolio: false,
          isAdhoc: true,
          screenerSlug: m.symbol,
        },
        idx,
      ),
    );
  }
  const summary = await upsertCompanies(inputs);
  log.info({ ...summary, unresolved }, "companies upserted");
  return {
    summary,
    masterRows: master.length,
    resolved: inputs.map((i) => i.nseSymbol),
    unresolved,
  };
}

export function rowToCompany(r: typeof companies.$inferSelect): Company {
  let aliases: string[] = [];
  try {
    const a = JSON.parse(r.aliasesJson) as unknown;
    if (Array.isArray(a))
      aliases = a.filter((x): x is string => typeof x === "string");
  } catch {
    aliases = [];
  }
  return {
    isin: r.isin,
    nseSymbol: r.nseSymbol,
    bseCode: r.bseCode,
    name: r.name,
    sector: r.sector,
    industry: r.industry,
    aliases,
    screenerSlug: r.screenerSlug,
    inPortfolio: r.inPortfolio,
    isAdhoc: r.isAdhoc,
  };
}

/** All companies (portfolio + ad-hoc) from the DB. */
export async function listCompanies(
  o: { portfolioOnly?: boolean } = {},
): Promise<Company[]> {
  const rows = await db.select().from(companies);
  return rows
    .map(rowToCompany)
    .filter((c) => (o.portfolioOnly ? c.inPortfolio : true));
}

/** Lookup map ISIN → Company (and symbol/alias → Company). */
export async function companyIndex(): Promise<{
  byIsin: Map<string, Company>;
  bySymbol: Map<string, Company>;
}> {
  const list = await listCompanies();
  const byIsin = new Map<string, Company>();
  const bySymbol = new Map<string, Company>();
  for (const c of list) {
    byIsin.set(c.isin, c);
    bySymbol.set(c.nseSymbol.toUpperCase(), c);
    for (const a of c.aliases) bySymbol.set(a.toUpperCase(), c);
  }
  return { byIsin, bySymbol };
}
