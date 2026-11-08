/**
 * Seed loader: data/seed/*.json → DB (idempotent). `pnpm db:seed`.
 *
 * Stub: currently loads portfolio.json into `companies` if present and
 * reports which other snapshot files exist. Builders extend `LOADERS`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { db } from "@/db/client";
import { companies } from "@/db/schema";

const SEED_DIR = join(process.cwd(), "data", "seed");

const PortfolioEntry = z.object({
  isin: z.string().min(12).max(12),
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
const Portfolio = z.array(PortfolioEntry);

function readJson(file: string): unknown | undefined {
  const p = join(SEED_DIR, file);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, "utf8"));
}

async function loadPortfolio(): Promise<number> {
  const raw = readJson("portfolio.json");
  if (raw === undefined) return 0;
  // tolerate either a bare array or { companies: [...] }
  const arr = Array.isArray(raw)
    ? raw
    : ((raw as { companies?: unknown }).companies ?? []);
  const rows = Portfolio.parse(arr);
  for (const r of rows) {
    await db
      .insert(companies)
      .values({
        isin: r.isin,
        nseSymbol: r.nseSymbol,
        bseCode: r.bseCode ?? null,
        name: r.name,
        sector: r.sector ?? null,
        industry: r.industry ?? null,
        aliasesJson: JSON.stringify(r.aliases),
        screenerSlug: r.screenerSlug ?? null,
        inPortfolio: r.inPortfolio,
        isAdhoc: r.isAdhoc,
      })
      .onConflictDoUpdate({
        target: companies.isin,
        set: {
          nseSymbol: r.nseSymbol,
          bseCode: r.bseCode ?? null,
          name: r.name,
          sector: r.sector ?? null,
          industry: r.industry ?? null,
          aliasesJson: JSON.stringify(r.aliases),
          screenerSlug: r.screenerSlug ?? null,
          inPortfolio: r.inPortfolio,
          isAdhoc: r.isAdhoc,
        },
      });
  }
  return rows.length;
}

const LOADERS: Array<{ file: string; load: () => Promise<number> }> = [
  { file: "portfolio.json", load: loadPortfolio },
  // builders add: prices.json, announcements.json, results.json, documents.json,
  // guidance.json, facts.json, research_sections.json, llm_cache.json
];

async function main(): Promise<void> {
  for (const l of LOADERS) {
    const n = await l.load();
    console.log(
      `${l.file}: ${existsSync(join(SEED_DIR, l.file)) ? `${n} rows` : "absent — skipped"}`,
    );
  }
  for (const f of [
    "prices.json",
    "announcements.json",
    "results.json",
    "documents.json",
    "guidance.json",
    "facts.json",
    "research_sections.json",
    "llm_cache.json",
  ]) {
    if (existsSync(join(SEED_DIR, f)))
      console.log(`${f}: present but no loader yet`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
