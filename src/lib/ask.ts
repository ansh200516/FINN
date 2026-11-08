/**
 * Grounded Ask. The model sees one company's filings and nothing else:
 * the latest results card(s), guidance rows (quote + verdict), and at most
 * six `document_pages` chosen by keyword overlap with the question.
 * Every quote is checked with `verifyQuote` and dropped when it is not in
 * the retrieved source. A signed cookie caps a device at 8 asks per Pacific day.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  companies,
  documentPages,
  documents,
  events,
  guidance,
} from "@/db/schema";
import { withBusyRetry } from "@/engine/jobs/runner";
import {
  type CallStructuredOptions,
  type CallStructuredResult,
  callStructured,
  LlmBudgetExhausted,
  type ModelBudget,
  remainingBudget,
  todayPt,
} from "@/engine/llm/gateway";
import { verifyQuote } from "@/engine/llm/verify";

export const ASK_DAILY_LIMIT = 8;
export const ASK_COOKIE = "finn_ask";
/** Filing excerpts, not the short question header. */
export const ASK_TOKEN_CAP = 12_000;
export const ASK_PAGE_LIMIT = 6;

export const ASK_SYSTEM = [
  "You answer questions about one listed company using only the filing excerpts in the user message.",
  "Use no outside knowledge, no memory of the company, no news, and no estimates.",
  "If the excerpts do not contain the answer, say that it is not in the filings and set notInFilings to true. Otherwise set notInFilings to false.",
  "Write the answer as a headline, then the figures the filings state, then why it matters, then the receipts.",
  "Citations must copy a ref from the excerpts exactly (results:…, guidance:…, or page:…).",
  "A quote, when you include one, must be an exact contiguous span copied from that excerpt. Never invent a number or a sentence.",
].join(" ");

const CitationSchema = z.object({
  kind: z.enum(["results", "guidance", "page"]),
  ref: z.string().min(1).max(240),
  quote: z.string().max(800).nullable(),
});

export const AskSchema = z.object({
  answer: z.string().min(1).max(4000),
  citations: z.array(CitationSchema).max(12),
  notInFilings: z.boolean(),
});

export type AskCitation = {
  kind: "results" | "guidance" | "page";
  ref: string;
  quote?: string;
};

export interface AskCorpus {
  symbol: string;
  companyName: string;
  isin: string;
  results: Array<{ ref: string; text: string }>;
  guidance: Array<{ ref: string; text: string; quote: string }>;
  pages: Array<{ ref: string; text: string; label: string; score: number }>;
}

export interface GroundSources {
  results: Map<string, string>;
  /** ref → the guidance row's stored quote */
  guidance: Map<string, string>;
  pages: Map<string, string>;
}

export interface AskAnswer {
  answer: string;
  citations: AskCitation[];
  notInFilings: boolean;
  model: string;
  cached: boolean;
  quotesDropped: number;
}

type AskData = z.infer<typeof AskSchema>;

export type StructuredCaller = (
  o: CallStructuredOptions<AskData>,
) => Promise<CallStructuredResult<AskData>>;

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "did",
  "does",
  "was",
  "were",
  "are",
  "have",
  "has",
  "had",
  "not",
  "but",
  "its",
  "their",
  "about",
  "into",
  "over",
  "than",
  "then",
  "them",
  "they",
  "you",
  "your",
  "any",
  "can",
  "could",
  "would",
  "should",
  "company",
  "management",
]);

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function queryTokens(question: string): string[] {
  const raw = question.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  const out: string[] = [];
  for (const t of raw) {
    if (STOP.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pageHas(hay: string, token: string): boolean {
  const forms = token.endsWith("s")
    ? [token, token.slice(0, -1)]
    : [token, `${token}s`];
  return forms.some((f) =>
    f.length >= 3
      ? new RegExp(`(?:^|[^a-z0-9])${escapeReg(f)}(?:[^a-z0-9]|$)`, "i").test(
          hay,
        )
      : false,
  );
}

export function scorePage(text: string, tokens: string[]): number {
  if (!tokens.length || !text) return 0;
  let n = 0;
  for (const t of tokens) if (pageHas(text, t)) n++;
  return n;
}

const KIND_RANK: Record<string, number> = {
  transcript: 0,
  results_pdf: 1,
  presentation: 2,
  press_release: 3,
  annual_report: 4,
};

/** Top pages by keyword overlap with the question. Score 0 never qualifies. */
export function selectPages<T extends { text: string; kind?: string }>(
  pages: T[],
  question: string,
  limit = ASK_PAGE_LIMIT,
): Array<T & { score: number }> {
  const tokens = queryTokens(question);
  const ranked = pages
    .map((p, i) => ({ p, i, score: scorePage(p.text, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ra = KIND_RANK[a.p.kind ?? ""] ?? 9;
      const rb = KIND_RANK[b.p.kind ?? ""] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.i - b.i;
    });
  return ranked.slice(0, limit).map((x) => ({ ...x.p, score: x.score }));
}

export function renderAskPrompt(
  corpus: AskCorpus,
  question: string,
): { prompt: string; sources: GroundSources } {
  const sources: GroundSources = {
    results: new Map(corpus.results.map((r) => [r.ref, r.text])),
    guidance: new Map(corpus.guidance.map((g) => [g.ref, g.quote])),
    pages: new Map(corpus.pages.map((p) => [p.ref, p.text])),
  };
  const header = [
    `Company: ${corpus.companyName} (NSE: ${corpus.symbol}).`,
    "The excerpts below are this company's filings. They are the only source you may use.",
    "",
    `Question: ${question}`,
    "",
    "EXCERPTS",
  ].join("\n");
  const parts = [header];
  let used = estimateTokens(header);
  const pageReserve = corpus.pages.length ? 5_000 : 0;
  const beforePages = ASK_TOKEN_CAP - pageReserve;

  const push = (block: string, limit: number): boolean => {
    const cost = estimateTokens(block) + 1;
    if (used + cost <= limit) {
      parts.push(block);
      used += cost;
      return true;
    }
    const room = limit - used - 1;
    if (room < 80) return false;
    parts.push(block.slice(0, room * 4));
    used = limit;
    return false;
  };

  for (const r of corpus.results) {
    if (!push(`\n[${r.ref}]\n${r.text}`, beforePages)) break;
  }
  for (const g of corpus.guidance) {
    if (!push(`\n[${g.ref}]\n${g.text}`, beforePages)) break;
  }
  for (const p of corpus.pages) {
    if (!push(`\n[${p.ref}]\n${p.label}\n${p.text}`, ASK_TOKEN_CAP)) break;
  }
  return { prompt: parts.join("\n"), sources };
}

/** Drop a quote that is not an exact span of the source it cites. Unknown refs go entirely. */
export function groundCitations(
  citations: AskCitation[],
  sources: GroundSources,
): { citations: AskCitation[]; quotesDropped: number } {
  const out: AskCitation[] = [];
  let quotesDropped = 0;
  for (const c of citations) {
    const source =
      c.kind === "results"
        ? sources.results.get(c.ref)
        : c.kind === "guidance"
          ? sources.guidance.get(c.ref)
          : c.kind === "page"
            ? sources.pages.get(c.ref)
            : undefined;
    if (source === undefined) continue;
    const quote = c.quote?.trim();
    if (quote && verifyQuote(quote, source) === null) {
      quotesDropped++;
      out.push({ kind: c.kind, ref: c.ref });
      continue;
    }
    out.push(
      quote
        ? { kind: c.kind, ref: c.ref, quote }
        : { kind: c.kind, ref: c.ref },
    );
  }
  return { citations: out, quotesDropped };
}

export async function answerWithContext(
  corpus: AskCorpus,
  question: string,
  call?: StructuredCaller,
): Promise<AskAnswer> {
  if (
    corpus.results.length + corpus.guidance.length + corpus.pages.length ===
    0
  ) {
    return {
      answer: "That is not in the filings.",
      citations: [],
      notInFilings: true,
      model: "none",
      cached: true,
      quotesDropped: 0,
    };
  }
  const { prompt, sources } = renderAskPrompt(corpus, question);
  const invoke: StructuredCaller = call ?? ((o) => callStructured(o));
  const run = (tier: "reason" | "bulk") =>
    invoke({
      task: "ask",
      tier,
      schema: AskSchema,
      system: ASK_SYSTEM,
      prompt,
      promptVersion: "1",
      temperature: 0,
    });
  let res: CallStructuredResult<AskData>;
  try {
    res = await run("reason");
  } catch (e) {
    if (!(e instanceof LlmBudgetExhausted)) throw e;
    res = await run("bulk");
  }
  const grounded = groundCitations(
    res.data.citations.map((c) => ({
      kind: c.kind,
      ref: c.ref,
      ...(c.quote ? { quote: c.quote } : {}),
    })),
    sources,
  );
  return {
    answer: res.data.answer,
    citations: grounded.citations,
    notInFilings: res.data.notInFilings,
    model: res.model,
    cached: res.cached,
    quotesDropped: grounded.quotesDropped,
  };
}

function resultsText(cardJson: string): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(cardJson) as Record<string, unknown>;
  } catch {
    return cardJson.slice(0, 2000);
  }
  const bits: string[] = [];
  if (typeof parsed.title === "string") bits.push(`title: ${parsed.title}`);
  if (typeof parsed.oneLiner === "string") bits.push(parsed.oneLiner);
  if (typeof parsed.voiceSummary === "string" && parsed.voiceSummary)
    bits.push(parsed.voiceSummary);
  if (parsed.fields && typeof parsed.fields === "object")
    bits.push(JSON.stringify(parsed.fields).slice(0, 4000));
  return bits.join("\n").slice(0, 6000);
}

function guidanceText(row: {
  speaker: string | null;
  role: string | null;
  metric: string;
  horizon: string | null;
  verdict: string | null;
  page: number | null;
  quote: string;
}): string {
  return [
    row.speaker ? `speaker: ${row.speaker}` : "",
    row.role ? `role: ${row.role}` : "",
    `metric: ${row.metric}`,
    row.horizon ? `horizon: ${row.horizon}` : "",
    `verdict: ${row.verdict ?? "(unset)"}`,
    row.page ? `page: ${row.page}` : "",
    `quote: ${row.quote}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Latest results cards, guidance rows, and ≤6 keyword-matched pages. Null if the symbol is unknown. */
export async function loadAskCorpus(
  symbol: string,
  question: string,
): Promise<AskCorpus | null> {
  const sym = symbol.trim().toUpperCase();
  const found = await withBusyRetry(() =>
    db
      .select({ isin: companies.isin, name: companies.name })
      .from(companies)
      .where(eq(companies.nseSymbol, sym))
      .limit(1),
  );
  const company = found[0];
  if (!company) return null;
  const [resultRows, guidanceRows, pageRows] = await withBusyRetry(() =>
    Promise.all([
      db
        .select({
          eventKey: events.eventKey,
          cardJson: events.cardJson,
        })
        .from(events)
        .where(
          and(
            eq(events.isin, company.isin),
            or(eq(events.cardType, "results"), eq(events.category, "results")),
          ),
        )
        .orderBy(desc(events.lastAt))
        .limit(2),
      db
        .select({
          id: guidance.id,
          speaker: guidance.speaker,
          role: guidance.role,
          metric: guidance.metric,
          horizon: guidance.horizon,
          verdict: guidance.verdict,
          page: guidance.page,
          quote: guidance.quote,
        })
        .from(guidance)
        .where(eq(guidance.isin, company.isin))
        .orderBy(desc(guidance.createdAt))
        .limit(40),
      db
        .select({
          docId: documentPages.docId,
          page: documentPages.page,
          text: documentPages.text,
          kind: documents.kind,
          period: documents.period,
        })
        .from(documentPages)
        .innerJoin(documents, eq(documents.id, documentPages.docId))
        .where(eq(documents.isin, company.isin)),
    ]),
  );
  const pages = selectPages(
    pageRows
      .filter((p) => p.text.trim().length > 0)
      .map((p) => ({
        ref: `page:${p.docId}:${p.page}`,
        text: p.text,
        kind: p.kind,
        label: `${p.kind}${p.period ? ` ${p.period}` : ""} p.${p.page}`,
      })),
    question,
    ASK_PAGE_LIMIT,
  );
  return {
    symbol: sym,
    companyName: company.name,
    isin: company.isin,
    results: resultRows.map((r) => ({
      ref: `results:${r.eventKey}`,
      text: resultsText(r.cardJson),
    })),
    guidance: guidanceRows.map((g) => ({
      ref: `guidance:${g.id}`,
      quote: g.quote,
      text: guidanceText(g),
    })),
    pages,
  };
}

export async function answerQuestion(
  symbol: string,
  question: string,
  call?: StructuredCaller,
): Promise<(AskAnswer & { corpus: AskCorpus }) | null> {
  const corpus = await loadAskCorpus(symbol, question);
  if (!corpus) return null;
  const answer = await answerWithContext(corpus, question, call);
  return { corpus, ...answer };
}

// ---------------------------------------------------------------------------
// Per-device budget (signed cookie, Pacific day — same reset as the model ledger)
// ---------------------------------------------------------------------------

function askSecret(): string {
  return (
    process.env.ASK_COOKIE_SECRET ||
    process.env.JOBS_SECRET ||
    "finn-ask-device-v1"
  );
}

function signPayload(payload: string): string {
  return createHmac("sha256", askSecret()).update(payload).digest("base64url");
}

export function sealAskCookie(count: number, day: string): string {
  const payload = `${day}.${count}`;
  return `${payload}.${signPayload(payload)}`;
}

/** Invalid or tampered cookies count as a fresh device. A previous day resets to 0. */
export function readAskCount(
  value: string | undefined,
  day: string,
): { count: number; valid: boolean } {
  if (!value) return { count: 0, valid: false };
  const parts = value.split(".");
  if (parts.length !== 3) return { count: 0, valid: false };
  const [date, countStr, sig] = parts as [string, string, string];
  const expected = signPayload(`${date}.${countStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { count: 0, valid: false };
  if (date !== day) return { count: 0, valid: true };
  const count = Number(countStr);
  if (!Number.isInteger(count) || count < 0 || count > 1000)
    return { count: 0, valid: false };
  return { count, valid: true };
}

export function cookieFromHeader(
  header: string | null,
  name = ASK_COOKIE,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eqAt = part.indexOf("=");
    if (eqAt < 0) continue;
    const k = part.slice(0, eqAt).trim();
    if (k !== name) continue;
    const raw = part.slice(eqAt + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

export function asksRemaining(count: number): number {
  return Math.max(0, ASK_DAILY_LIMIT - count);
}

export { remainingBudget, todayPt, type ModelBudget };
