/**
 * Job kinds — the step lists the runner executes. Same engine code as the
 * ingest:* CLIs; every step is idempotent and most are resumable mid-way
 * (progress cursors) so an invocation can stop at the 50 s deadline and the
 * next call continues.
 *
 *   research      per symbol: resolve → announcements 30 d → results → prices 70 d →
 *                 documents → guidance (≤ maxCalls Flash-Lite) → ledger
 *   announcements portfolio, last N hours, rules only unless llm=1
 *   prices        latest sessions via bhavcopy (holidays skipped)
 *   results       XBRL refresh for the portfolio
 *   documents     discover + download new transcripts / annual reports
 *   eod           prices → anomalies → announcements (24 h) → tripwires → alerts → brief cache
 *   digest        refresh brief caches + edition line in the inbox
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  addDaysKey,
  formatIst,
  istDateKey,
  lastMarketClose,
  tradingDaysBetween,
} from "@/lib/time";
import { detectAnomalies } from "../analyse/anomalies";
import { settleGuidance } from "../analyse/ledger";
import { extractGuidanceDetailed, persistGuidance } from "../extract/guidance";
import { fetchAndIngestAnnouncements } from "../ingest/announcements";
import { listCompanies } from "../ingest/companies";
import {
  discoverDocuments,
  ingestOneDocument,
  listDocuments,
  loadDocumentText,
} from "../ingest/documents";
import { ingestPrices, loadBarsMany } from "../ingest/prices";
import { ingestResults } from "../ingest/results";
import { LlmBudgetExhausted, remainingBudget } from "../llm/gateway";
import type { DiscoveredDocument, JobKind } from "../types";
import { ensureCompany, resolveNseSymbol } from "./resolve";
import type { JobParams, JobStepDef, StepContext } from "./runner";

const log = logger.child({ mod: "engine/jobs/kinds" });

export type AnyJobKind = JobKind | "eod";

export const JOB_KINDS: readonly AnyJobKind[] = [
  "research",
  "announcements",
  "prices",
  "results",
  "documents",
  "eod",
  "digest",
] as const;

export function isJobKind(s: string): s is AnyJobKind {
  return (JOB_KINDS as readonly string[]).includes(s);
}

/** Per-symbol research parameters (persisted in the job log). */
export interface ResearchParams extends JobParams {
  symbol: string;
  isin: string;
  name?: string;
  portfolio?: boolean;
  /** Flash-Lite calls allowed for guidance extraction (default 10) */
  maxCalls?: number;
  transcripts?: number;
}

export interface AnnouncementsParams extends JobParams {
  hours?: number;
  llm?: boolean;
  symbols?: string[];
}

export interface PricesParams extends JobParams {
  days?: number;
}

const DAY = 86_400_000;

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

async function portfolioIsins(): Promise<{
  isins: string[];
  symbols: string[];
}> {
  const all = await listCompanies({ portfolioOnly: true });
  return {
    isins: all.map((c) => c.isin),
    symbols: all.map((c) => c.nseSymbol),
  };
}

/** Steps that refresh the Brief caches (Next data cache tag) — a soft dependency on src/lib/brief. */
async function invalidateBriefCache(): Promise<boolean> {
  try {
    const mod = await import("@/lib/brief");
    return await mod.invalidateBrief();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

/** Sessions in [fromKey, toKey] without a bar for `isin` (or for every portfolio company). */
async function missingSessions(
  isins: string[],
  fromKey: string,
  toKey: string,
): Promise<string[]> {
  const days = tradingDaysBetween(fromKey, toKey);
  if (!isins.length) return days;
  const rows = await db
    .select({ date: t.prices.date, isin: t.prices.isin })
    .from(t.prices)
    .where(
      and(
        inArray(t.prices.isin, isins),
        gte(t.prices.date, fromKey),
        lte(t.prices.date, toKey),
      ),
    );
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.date, (count.get(r.date) ?? 0) + 1);
  // a session counts as present when most companies have it (new ISINs may be missing for good reasons)
  const need = Math.max(1, Math.ceil(isins.length * 0.6));
  return days.filter((d) => (count.get(d) ?? 0) < need);
}

interface PricesCursor {
  done: string[];
  skipped: string[];
  inserted: number;
  updated: number;
}

/** Prices step: bhavcopy per missing session, resumable by session. */
function pricesStep(
  scope: (
    ctx: StepContext<JobParams>,
  ) => Promise<{ isins: string[]; days: number }>,
): JobStepDef<JobParams> {
  return {
    name: "fetch_prices",
    label: "Fetch prices · NSE bhavcopy",
    optional: true,
    async run(ctx) {
      const { isins, days } = await scope(ctx);
      const toKey = lastMarketClose(Date.now()).dateKey;
      const fromKey = addDaysKey(toKey, -days);
      const cur: PricesCursor = (ctx.cursor as PricesCursor | undefined) ?? {
        done: [],
        skipped: [],
        inserted: 0,
        updated: 0,
      };
      const missing = (await missingSessions(isins, fromKey, toKey)).filter(
        (d) => !cur.done.includes(d) && !cur.skipped.includes(d),
      );
      if (!missing.length) {
        const have = await db
          .select({ date: t.prices.date })
          .from(t.prices)
          .where(
            and(
              inArray(t.prices.isin, isins.length ? isins : ["-"]),
              gte(t.prices.date, fromKey),
            ),
          );
        const sessions = new Set(have.map((h) => h.date)).size;
        const last = [...new Set(have.map((h) => h.date))].sort().at(-1);
        return {
          done: true,
          msg: `${sessions} sessions on record${last ? ` · last close ${formatIst(last, "d MMM")}` : ""}${cur.inserted ? ` · +${cur.inserted} bars` : ""}${cur.skipped.length ? ` · ${cur.skipped.length} not published` : ""}`,
          data: {
            sessions,
            inserted: cur.inserted,
            skipped: cur.skipped.length,
          },
        };
      }
      // oldest first so baselines fill before the latest session
      let worked = 0;
      for (const d of missing) {
        if (ctx.timeLeft() < 6_000) break;
        const s = await ingestPrices(d);
        if (s.skipped && s.errors.length) cur.skipped.push(d);
        else cur.done.push(d);
        cur.inserted += s.inserted;
        cur.updated += s.updated;
        worked++;
        await ctx.heartbeat();
      }
      const left = missing.filter(
        (d) => !cur.done.includes(d) && !cur.skipped.includes(d),
      ).length;
      return {
        done: false,
        msg: `${cur.done.length} sessions fetched · ${left} to go`,
        cursor: cur,
        pause: worked === 0,
      };
    },
  };
}

interface DocsCursor {
  discovered: DiscoveredDocument[];
  reason: string | null;
  processed: string[];
  pages: number;
  transcripts: number;
  annualReports: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// research:<symbol>
// ---------------------------------------------------------------------------

export function researchSteps(): JobStepDef<ResearchParams>[] {
  return [
    {
      name: "resolve_company",
      label: "Resolve company · ISIN, aliases",
      async run(ctx) {
        const r = await resolveNseSymbol(ctx.params.symbol);
        if (!r) throw new Error(`unknown NSE symbol ${ctx.params.symbol}`);
        const { created } = await ensureCompany(r, {
          portfolio: ctx.params.portfolio,
        });
        return {
          done: true,
          msg: `${r.symbol} → ${r.isin}${r.series && r.series !== "EQ" ? ` (${r.series})` : ""} · ${r.name}${r.typed ? ` · was ${r.typed}` : ""}${created ? " · new" : ""}`,
          data: {
            symbol: r.symbol,
            isin: r.isin,
            name: r.name,
            created,
            via: r.via,
          },
        };
      },
    },
    {
      name: "fetch_announcements",
      label: "Fetch announcements · NSE, last 30 days",
      optional: true,
      async run(ctx) {
        const t0 = Date.now();
        const r = await fetchAndIngestAnnouncements({
          days: 30,
          symbols: [ctx.params.symbol],
          llm: false,
          attachments: true,
          maxAttachments: 12,
          bioBackfill: false,
        });
        const ing = r.ingest;
        if (r.fetchErrors.length && !r.raw.length)
          throw new Error(r.fetchErrors.join("; "));
        return {
          done: true,
          msg: `${r.raw.length} filings · ${ing?.events ?? 0} events (${ing?.eventsByTier[1] ?? 0} need you, ${ing?.eventsByTier[2] ?? 0} worth knowing) · ${secs(Date.now() - t0)}`,
          data: {
            filings: r.raw.length,
            events: ing?.events ?? 0,
            tier1: ing?.eventsByTier[1] ?? 0,
            attachments: ing?.attachmentsFetched ?? 0,
          },
        };
      },
    },
    {
      name: "fetch_results",
      label: "Fetch results · integrated-filing XBRL, 8 quarters",
      optional: true,
      async run(ctx) {
        const rep = await ingestResults(ctx.params.isin, ctx.params.symbol, {
          maxQuarters: 8,
          signal: ctx.signal,
        });
        if (rep.errors.length && rep.quarters.length === 0)
          throw new Error(rep.errors.join("; ").slice(0, 300));
        const bases = new Set(rep.quarters.map((q) => q.basis));
        return {
          done: true,
          msg: rep.quarters.length
            ? `${rep.quarters.length} quarters (${[...bases].join(" + ")}) · identities ${Math.round(rep.identityPassRate * 100)}% · ${secs(rep.timingMs.total)}`
            : "no XBRL results filed on NSE for this symbol",
          data: {
            quarters: rep.quarters.length,
            inserted: rep.inserted,
            identityPassRate: rep.identityPassRate,
            variant: rep.variant,
          },
        };
      },
    },
    pricesStep(async (ctx) => ({
      isins: [(ctx.params as ResearchParams).isin],
      days: 70,
    })) as JobStepDef<ResearchParams>,
    {
      name: "discover_documents",
      label: "Discover documents · transcripts, annual report",
      optional: true,
      async run(ctx) {
        const disc = await discoverDocuments(
          ctx.params.symbol,
          ctx.params.isin,
          {
            quarters: 6,
            annualReports: 1,
          },
        );
        const transcripts = disc.documents
          .filter((d) => d.kind === "transcript")
          .slice(0, ctx.params.transcripts ?? 4);
        const ars = disc.documents.filter((d) => d.kind === "annual_report");
        const picked = [...transcripts, ...ars];
        const cur: DocsCursor = {
          discovered: picked,
          reason: disc.reason,
          processed: [],
          pages: 0,
          transcripts: 0,
          annualReports: 0,
          failed: 0,
        };
        const msg = disc.reason
          ? `${transcripts.length} transcripts · ${ars.length} annual report${ars.length === 1 ? "" : "s"} · ${disc.reason}`
          : `${transcripts.length} transcripts · ${ars.length} annual report${ars.length === 1 ? "" : "s"} · sources ${Object.entries(
              disc.sources,
            )
              .map(
                ([k, v]) =>
                  `${k} ${v === "ok" ? "✓" : v === "failed" ? "✕" : "–"}`,
              )
              .join(" ")}`;
        if (disc.sources.nse === "failed" && disc.sources.screener === "failed")
          throw new Error(disc.errors.join("; ").slice(0, 300));
        return {
          done: true,
          msg,
          data: {
            transcripts: transcripts.length,
            annualReports: ars.length,
            reason: disc.reason,
            arOnly: transcripts.length === 0,
            handoff: cur,
          },
        };
      },
    },
    {
      name: "fetch_documents",
      label: "Fetch documents · text per page",
      optional: true,
      async run(ctx) {
        // the discovery step hands its list over through the log; our own cursor tracks progress
        let cur = ctx.cursor as DocsCursor | undefined;
        if (!cur) {
          const handoff = await handoffFromLog(ctx.jobId, "discover_documents");
          cur = (handoff as DocsCursor | null) ?? {
            discovered: [],
            reason: null,
            processed: [],
            pages: 0,
            transcripts: 0,
            annualReports: 0,
            failed: 0,
          };
        }
        const todo = cur.discovered.filter(
          (d) => !cur.processed.includes(d.url),
        );
        if (!todo.length) {
          const stored = await listDocuments(ctx.params.isin);
          const ok = stored.filter((d) => d.textStatus === "ok");
          const tr = ok.filter((d) => d.kind === "transcript").length;
          const ar = ok.filter((d) => d.kind === "annual_report").length;
          const pages = ok.reduce((s, d) => s + (d.pages ?? 0), 0);
          return {
            done: true,
            msg: `${tr} transcript${tr === 1 ? "" : "s"} · ${ar} annual report${ar === 1 ? "" : "s"} · ${pages.toLocaleString("en-IN")} pages${cur.failed ? ` · ${cur.failed} failed` : ""}`,
            data: {
              transcripts: tr,
              annualReports: ar,
              pages,
              failed: cur.failed,
            },
          };
        }
        let worked = 0;
        for (const d of todo) {
          // an annual report can take 20–30 s; only start one with time in hand
          if (ctx.timeLeft() < (d.kind === "annual_report" ? 30_000 : 12_000))
            break;
          const r = await ingestOneDocument(ctx.params.isin, d);
          cur.processed.push(d.url);
          worked++;
          if (r.status === "failed") cur.failed++;
          else {
            cur.pages += r.pages ?? 0;
            if (d.kind === "transcript") cur.transcripts++;
            else if (d.kind === "annual_report") cur.annualReports++;
          }
          await ctx.heartbeat();
        }
        const left = cur.discovered.length - cur.processed.length;
        return {
          done: false,
          msg: `${cur.processed.length} of ${cur.discovered.length} documents · ${left} to go`,
          cursor: cur,
          pause: worked === 0,
        };
      },
    },
    {
      name: "extract_guidance",
      label: "Extract guidance · verbatim gate on every quote",
      optional: true,
      async run(ctx) {
        const maxCalls = ctx.params.maxCalls ?? 10;
        const cur = (ctx.cursor as
          | {
              processed: string[];
              calls: number;
              statements: number;
              cached: number;
              /** the model's daily quota ran out (LlmBudgetExhausted) */
              exhausted?: boolean;
              /** this run's own call cap was reached */
              capped?: boolean;
              /** per-document retry counts after deadline / network interruptions */
              retries?: Record<string, number>;
            }
          | undefined) ?? { processed: [], calls: 0, statements: 0, cached: 0 };
        const transcripts = (
          await listDocuments(ctx.params.isin, ["transcript"])
        )
          .filter((d) => d.textStatus === "ok")
          .slice(0, ctx.params.transcripts ?? 4);
        if (!transcripts.length)
          return {
            skipped: true,
            msg: "no transcripts on record — annual-report only; no promise ledger",
            data: { arOnly: true },
          };
        const todo = transcripts.filter((d) => !cur.processed.includes(d.id));
        if (!todo.length || cur.exhausted || cur.capped) {
          const rows = await db
            .select({ id: t.guidance.id })
            .from(t.guidance)
            .where(eq(t.guidance.isin, ctx.params.isin));
          const calls = `${cur.calls} Flash-Lite call${cur.calls === 1 ? "" : "s"}${cur.cached ? ` (${cur.cached} cached)` : ""}`;
          const left = transcripts.length - cur.processed.length;
          return {
            done: true,
            msg: cur.exhausted
              ? `${rows.length} statements so far · ${calls} · model quota exhausted — ${left} transcript${left === 1 ? "" : "s"} queued for after the 13:30 IST reset`
              : cur.capped
                ? `${rows.length} statements from ${cur.processed.length} transcript${cur.processed.length === 1 ? "" : "s"} · ${calls} (this run's cap of ${maxCalls}) · ${left} transcript${left === 1 ? "" : "s"} left for the next run`
                : `${rows.length} statements from ${cur.processed.length} transcript${cur.processed.length === 1 ? "" : "s"} · ${calls}`,
            data: {
              statements: rows.length,
              calls: cur.calls,
              cached: cur.cached,
              transcriptsAnalysed: cur.processed.length,
              transcriptsLeft: left,
              budgetExhausted: Boolean(cur.exhausted),
              capped: Boolean(cur.capped),
            },
          };
        }
        let worked = 0;
        for (const d of todo) {
          // a transcript is 2–3 Flash-Lite calls of ~5–10 s each
          if (ctx.timeLeft() < 30_000) break;
          if (cur.calls >= maxCalls) {
            cur.capped = true;
            worked++;
            break;
          }
          const doc = await loadDocumentText(d.id);
          worked++;
          if (!doc) {
            cur.processed.push(d.id);
            continue;
          }
          try {
            const r = await extractGuidanceDetailed(
              doc,
              { isin: ctx.params.isin, period: d.period },
              { maxCalls: maxCalls - cur.calls, signal: ctx.signal },
            );
            cur.calls += r.calls - r.cached;
            cur.cached += r.cached;
            const structure =
              (d.meta?.structureJson
                ? (JSON.parse(d.meta.structureJson) as {
                    callDate?: string | null;
                  })
                : {}) ?? {};
            const p = await persistGuidance(
              ctx.params.isin,
              d.id,
              r.statements,
              {
                period: r.parsed.period ?? d.period,
                callDate: r.parsed.callDate ?? structure.callDate ?? null,
                publishedAt: d.meta?.publishedAt ?? null,
              },
            );
            cur.statements += p.inserted;
            if (r.errors.some((e) => /budget exhausted/i.test(e)))
              cur.exhausted = true;
            const chunkFailures = r.errors.filter((e) => !/^budget:/.test(e));
            if (ctx.signal.aborted || (chunkFailures.length && r.calls === 0)) {
              // the deadline (or the network) cut this transcript short: do not mark it
              // processed — the next invocation retries it (cache hits make that free)
              cur.retries = {
                ...(cur.retries ?? {}),
                [d.id]: (cur.retries?.[d.id] ?? 0) + 1,
              };
              const giveUp = (cur.retries[d.id] ?? 0) >= 3;
              await ctx.log(
                `${d.period ?? "transcript"}: ${ctx.signal.aborted ? "interrupted at the deadline" : `${chunkFailures.length} chunk${chunkFailures.length === 1 ? "" : "s"} failed`}${giveUp ? " · giving up after 3 attempts" : " · will retry"}`,
                {
                  phase: "note",
                  docId: d.id,
                  errors: chunkFailures.slice(0, 2),
                },
                "warn",
              );
              if (giveUp) cur.processed.push(d.id);
              break;
            }
            await ctx.log(
              `${d.period ?? "transcript"}: ${r.statements.length} statements (${r.stats.candidates} candidates, ${r.stats.quoteRejected} quotes rejected) · ${r.calls} call${r.calls === 1 ? "" : "s"}${r.cached ? `, ${r.cached} cached` : ""}${chunkFailures.length ? ` · ${chunkFailures.length} chunk${chunkFailures.length === 1 ? "" : "s"} failed` : ""}`,
              { phase: "note", docId: d.id },
            );
          } catch (e) {
            if (e instanceof LlmBudgetExhausted) {
              cur.exhausted = true;
              await ctx.log(
                `${d.period ?? "transcript"}: model budget exhausted — queued for after 13:30 IST`,
                { phase: "note", docId: d.id },
                "warn",
              );
              break;
            }
            throw e;
          }
          cur.processed.push(d.id);
          await ctx.heartbeat();
        }
        return {
          done: false,
          msg: `${cur.processed.length} of ${transcripts.length} transcripts · ${cur.statements} statements`,
          cursor: cur,
          pause: worked === 0,
        };
      },
    },
    {
      name: "adjudicate_ledger",
      label: "Settle the ledger · promises vs exchange numbers",
      optional: true,
      async run(ctx) {
        const l = await settleGuidance(ctx.params.isin);
        const settled = l.stats.kept + l.stats.beat + l.stats.missed;
        return {
          done: true,
          msg: l.rows.length
            ? `${l.rows.length} statements · ${settled} settled · ${l.summary}`
            : "no statements to settle",
          data: { rows: l.rows.length, settled, stats: l.stats },
        };
      },
    },
  ];
}

/** The `data.handoff` of a finished step (how discover → fetch pass the document list). */
async function handoffFromLog(jobId: string, step: string): Promise<unknown> {
  const rows = await db
    .select({ logJson: t.jobs.logJson })
    .from(t.jobs)
    .where(eq(t.jobs.id, jobId))
    .limit(1);
  try {
    const entries = JSON.parse(rows[0]?.logJson ?? "[]") as Array<{
      step: string;
      data?: Record<string, unknown>;
    }>;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e?.step === step && e.data?.phase === "end")
        return e.data.handoff ?? null;
    }
  } catch {
    // fall through
  }
  return null;
}

// ---------------------------------------------------------------------------
// Portfolio jobs
// ---------------------------------------------------------------------------

function announcementsStep(defaults: {
  hours: number;
  llm: boolean;
}): JobStepDef<AnnouncementsParams> {
  return {
    name: "fetch_announcements",
    label: "Fetch announcements · NSE",
    async run(ctx) {
      const hours = ctx.params.hours ?? defaults.hours;
      const days = Math.max(1, Math.ceil(hours / 24));
      const t0 = Date.now();
      const r = await fetchAndIngestAnnouncements({
        days,
        symbols: ctx.params.symbols,
        llm: ctx.params.llm ?? defaults.llm,
        llmBudget: { remaining: ctx.params.llm ? 20 : 0 },
        attachments: true,
        maxAttachments: 30,
        bioBackfill: false,
      });
      const ing = r.ingest;
      if (r.fetchErrors.length && !r.raw.length)
        throw new Error(r.fetchErrors.join("; "));
      return {
        done: true,
        msg: `${r.raw.length} filings in ${days * 24} h · ${ing?.inserted ?? 0} new · ${ing?.events ?? 0} events (${ing?.eventsByTier[1] ?? 0} need you) · ${ing?.llmCalls ?? 0} model calls · ${secs(Date.now() - t0)}`,
        data: {
          filings: r.raw.length,
          inserted: ing?.inserted ?? 0,
          events: ing?.events ?? 0,
          tier1: ing?.eventsByTier[1] ?? 0,
          llmCalls: ing?.llmCalls ?? 0,
          fetchErrors: r.fetchErrors.length,
        },
      };
    },
  };
}

const refreshBriefStep: JobStepDef<JobParams> = {
  name: "refresh_brief",
  label: "Refresh the brief cache",
  optional: true,
  async run() {
    const ok = await invalidateBriefCache();
    return {
      done: true,
      msg: ok
        ? "brief cache invalidated (tag: brief)"
        : "cache not available in this runtime — 60 s TTL applies",
      data: { invalidated: ok },
    };
  },
};

export function announcementsJobSteps(): JobStepDef<AnnouncementsParams>[] {
  return [
    announcementsStep({ hours: 24, llm: false }),
    refreshBriefStep as JobStepDef<AnnouncementsParams>,
  ];
}

export function pricesJobSteps(): JobStepDef<PricesParams>[] {
  return [
    pricesStep(async (ctx) => ({
      isins: (await portfolioIsins()).isins,
      days: (ctx.params as PricesParams).days ?? 10,
    })) as JobStepDef<PricesParams>,
    refreshBriefStep as JobStepDef<PricesParams>,
  ];
}

export function resultsJobSteps(): JobStepDef<JobParams>[] {
  return [
    {
      name: "fetch_results",
      label: "Refresh results · XBRL for the portfolio",
      async run(ctx) {
        const cos = await listCompanies({ portfolioOnly: true });
        const cur = (ctx.cursor as
          | { done: string[]; quarters: number; inserted: number }
          | undefined) ?? {
          done: [],
          quarters: 0,
          inserted: 0,
        };
        const todo = cos.filter((c) => !cur.done.includes(c.isin));
        if (!todo.length)
          return {
            done: true,
            msg: `${cos.length} companies · ${cur.quarters} quarters parsed · ${cur.inserted} new rows`,
            data: {
              companies: cos.length,
              quarters: cur.quarters,
              inserted: cur.inserted,
            },
          };
        let worked = 0;
        for (const c of todo) {
          if (ctx.timeLeft() < 8_000) break;
          try {
            const rep = await ingestResults(c.isin, c.nseSymbol, {
              maxQuarters: 8,
              includeLegacy: false,
              signal: ctx.signal,
            });
            cur.quarters += rep.quarters.length;
            cur.inserted += rep.inserted;
          } catch (e) {
            if (ctx.signal.aborted) throw e;
            await ctx.log(
              `${c.nseSymbol}: ${e instanceof Error ? e.message : String(e)}`.slice(
                0,
                200,
              ),
              { phase: "note" },
              "warn",
            );
          }
          cur.done.push(c.isin);
          worked++;
          await ctx.heartbeat();
        }
        return {
          done: false,
          msg: `${cur.done.length} of ${cos.length} companies`,
          cursor: cur,
          pause: worked === 0,
        };
      },
    },
    refreshBriefStep,
  ];
}

export function documentsJobSteps(): JobStepDef<JobParams>[] {
  return [
    {
      name: "fetch_documents",
      label: "Discover + fetch documents · transcripts, annual reports",
      async run(ctx) {
        const cos = await listCompanies({ portfolioOnly: true });
        const cur = (ctx.cursor as
          | { done: string[]; fetched: number; failed: number }
          | undefined) ?? {
          done: [],
          fetched: 0,
          failed: 0,
        };
        const todo = cos.filter((c) => !cur.done.includes(c.isin));
        if (!todo.length)
          return {
            done: true,
            msg: `${cos.length} companies · ${cur.fetched} documents fetched${cur.failed ? ` · ${cur.failed} failed` : ""}`,
            data: {
              companies: cos.length,
              fetched: cur.fetched,
              failed: cur.failed,
            },
          };
        let worked = 0;
        for (const c of todo) {
          if (ctx.timeLeft() < 35_000) break;
          worked++;
          try {
            const disc = await discoverDocuments(c.nseSymbol, c.isin, {
              quarters: 4,
              annualReports: 1,
            });
            for (const d of disc.documents) {
              if (
                ctx.timeLeft() < (d.kind === "annual_report" ? 30_000 : 12_000)
              )
                break;
              const r = await ingestOneDocument(c.isin, d);
              if (r.status === "inserted" || r.status === "updated")
                cur.fetched++;
              else if (r.status === "failed") cur.failed++;
              await ctx.heartbeat();
            }
          } catch (e) {
            if (ctx.signal.aborted) throw e;
            await ctx.log(
              `${c.nseSymbol}: ${e instanceof Error ? e.message : String(e)}`.slice(
                0,
                200,
              ),
              { phase: "note" },
              "warn",
            );
          }
          cur.done.push(c.isin);
          await ctx.heartbeat();
        }
        return {
          done: false,
          msg: `${cur.done.length} of ${cos.length} companies`,
          cursor: cur,
          pause: worked === 0,
        };
      },
    },
  ];
}

export function eodJobSteps(): JobStepDef<JobParams>[] {
  return [
    pricesStep(async () => ({
      isins: (await portfolioIsins()).isins,
      days: 10,
    })),
    {
      name: "scan_anomalies",
      label: "Scan anomalies · volume ≥ 2×, |move| ≥ 5 %",
      optional: true,
      async run() {
        const { isins } = await portfolioIsins();
        const session = lastMarketClose(Date.now()).dateKey;
        const barsBy = await loadBarsMany(
          isins,
          addDaysKey(session, -60),
          session,
        );
        const hits: string[] = [];
        for (const isin of isins) {
          for (const a of detectAnomalies(barsBy.get(isin) ?? []))
            if (a.date === session) hits.push(`${isin} ${a.kind} ${a.value}`);
        }
        return {
          done: true,
          msg: `${session}: ${hits.length} anomal${hits.length === 1 ? "y" : "ies"} across ${isins.length} companies`,
          data: { session, anomalies: hits.length },
        };
      },
    },
    {
      ...announcementsStep({ hours: 24, llm: false }),
      optional: true,
    } as JobStepDef<JobParams>,
    {
      name: "evaluate_tripwires",
      label: "Evaluate tripwires · alerts into the inbox",
      optional: true,
      async run(ctx) {
        const mod = await import("@/lib/alerts");
        const isins = await mod.demoPortfolioIsins();
        const sinceMs = await lastFinished("eod", ctx.jobId);
        const r = await mod.evaluateAlerts({
          isins,
          now: Date.now(),
          sinceMs: sinceMs ?? Date.now() - DAY,
        });
        return {
          done: true,
          msg: `${r.hits} hit${r.hits === 1 ? "" : "s"} · ${r.inserted} new alert${r.inserted === 1 ? "" : "s"}${r.existing ? ` · ${r.existing} already delivered` : ""}${r.session ? ` · session ${r.session}` : ""}`,
          data: {
            hits: r.hits,
            inserted: r.inserted,
            existing: r.existing,
            session: r.session,
          },
        };
      },
    },
    refreshBriefStep,
  ];
}

/** updated_at of the newest finished job of a kind other than `exceptId`. */
async function lastFinished(
  kind: string,
  exceptId: string,
): Promise<number | null> {
  const rows = await db
    .select({ id: t.jobs.id, updatedAt: t.jobs.updatedAt })
    .from(t.jobs)
    .where(and(eq(t.jobs.kind, kind), eq(t.jobs.state, "done")));
  const ts = rows.filter((r) => r.id !== exceptId).map((r) => r.updatedAt);
  return ts.length ? Math.max(...ts) : null;
}

export function digestJobSteps(): JobStepDef<JobParams>[] {
  return [
    {
      name: "refresh_brief",
      label: "Recompute the brief · 24 h, 7 d, 30 d",
      async run() {
        const invalidated = await invalidateBriefCache();
        const { isins } = await portfolioIsins();
        const { buildBrief } = await import("../analyse/brief");
        const now = Date.now();
        const t0 = Date.now();
        const out: Record<string, number> = {};
        for (const [label, hours] of [
          ["24h", 24],
          ["7d", 168],
          ["30d", 720],
        ] as const) {
          const b = await buildBrief({
            isins,
            fromMs: now - hours * 3_600_000,
            toMs: now,
            autoWiden: label === "24h",
          });
          out[label] = b.counts.events;
        }
        return {
          done: true,
          msg: `events: 24h ${out["24h"]} · 7d ${out["7d"]} · 30d ${out["30d"]} · ${secs(Date.now() - t0)}${invalidated ? "" : " · cache tag unavailable here"}`,
          data: { ...out, invalidated },
        };
      },
    },
    {
      name: "inbox_digest",
      label: "Edition line · inbox",
      optional: true,
      async run() {
        const { isins } = await portfolioIsins();
        const { buildBrief } = await import("../analyse/brief");
        const now = Date.now();
        const b = await buildBrief({
          isins,
          fromMs: now - DAY,
          toMs: now,
          autoWiden: true,
        });
        const h = Number(formatIst(now, "H"));
        const edition = h < 12 ? "Morning" : h < 16 ? "Midday" : "Evening";
        const id = `al_digest_${istDateKey(now)}_${edition.toLowerCase()}`;
        const existing = await db
          .select({ id: t.alerts.id })
          .from(t.alerts)
          .where(eq(t.alerts.id, id));
        if (existing.length)
          return {
            skipped: true,
            msg: `${edition} edition already in the inbox`,
          };
        const worth = b.tier2.length;
        await db
          .insert(t.alerts)
          .values({
            id,
            userId: "demo",
            isin: null,
            kind: "digest",
            payloadJson: JSON.stringify({
              title: `${edition} edition · ${formatIst(now, "EEE d MMM")}`,
              body: `${b.counts.needsYou} need${b.counts.needsYou === 1 ? "s" : ""} you, ${worth} worth knowing, ${b.counts.filedAway} filed away · ${b.window.label.toLowerCase()}${b.window.widened ? " (widened)" : ""}.`,
              because: "Daily edition after the close",
              href: "/",
            }),
            firedAt: now,
            deliveredViaJson: JSON.stringify({ inbox: "sent" }),
          })
          .onConflictDoNothing();
        return {
          done: true,
          msg: `${edition} edition: ${b.counts.needsYou} need you · ${worth} worth knowing · ${b.counts.filedAway} filed away`,
        };
      },
    },
  ];
}

/** Step list for a kind. */
export function stepsForKind(kind: AnyJobKind): JobStepDef<JobParams>[] {
  switch (kind) {
    case "research":
      return researchSteps() as unknown as JobStepDef<JobParams>[];
    case "announcements":
      return announcementsJobSteps() as unknown as JobStepDef<JobParams>[];
    case "prices":
      return pricesJobSteps() as unknown as JobStepDef<JobParams>[];
    case "results":
      return resultsJobSteps();
    case "documents":
      return documentsJobSteps();
    case "eod":
      return eodJobSteps();
    case "digest":
      return digestJobSteps();
  }
}

/** Current remaining model budget, for the receipt's budget line. */
export async function budgetLine(): Promise<string> {
  try {
    const b = await remainingBudget();
    const lite = b.filter((m) => m.tier === "bulk");
    const flash = b.filter((m) => m.tier === "reason");
    const sum = (xs: typeof b) => xs.reduce((s, m) => s + m.remaining, 0);
    return `Flash-Lite ${sum(lite)} · Flash ${sum(flash)} calls left today`;
  } catch (e) {
    log.debug(
      { err: e instanceof Error ? e.message : String(e) },
      "budget unavailable",
    );
    return "";
  }
}
