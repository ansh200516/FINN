/**
 * Gemini gateway — the only module that talks to the model.
 *
 * callStructured<T>() = cache → ledger cap check → token bucket → Gemini
 * (schema-constrained JSON) → zod validate → ledger + cache write.
 * Task "finnie" skips the cache in both directions. Extraction jobs still use it.
 * A finnie call with onThought streams displayable thought summaries. The
 * 60s timeout is per call. The chat route stays open across calls.
 *
 * Model ladder, thinking level, per-model daily caps (80 % of RPD, Pacific
 * day), process-local RPM/TPM buckets, 60 s timeout, one jittered retry on
 * 429/500/503 then fall to the next model. See README.md in this folder.
 * Bulk stays MINIMAL and reason stays LOW. A Finnie call that asks for a
 * displayable thought uses MEDIUM, the next level up. LOW returns no thought
 * tokens on Gemini 3 Flash, so the summary never arrives.
 */
import { createHash } from "node:crypto";
import {
  ApiError,
  GoogleGenAI,
  MediaResolution,
  type Part,
  ThinkingLevel,
} from "@google/genai";
import { formatInTimeZone } from "date-fns-tz";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { llmCache, llmLedger } from "@/db/schema";
import { env, isCacheOnly } from "@/lib/env";
import { consumeThoughtParts, type ThoughtScan } from "@/lib/finnieTrace";
import { logger } from "@/lib/logger";
import type { LlmTask, LlmTier } from "../types";

const log = logger.child({ mod: "engine/llm/gateway" });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LlmPart =
  | { kind: "text"; text: string }
  | {
      /** A whole PDF (or a pre-split page range) as bytes. Gemini reads native PDF pages. */
      kind: "pdf";
      bytes: Uint8Array;
      /** for the cache key / logs, e.g. "RIL-Q2FY27-results p2-4" */
      label?: string;
      resolution?: "low" | "medium" | "high";
    };

export interface CallStructuredOptions<T> {
  task: LlmTask;
  schema: z.ZodType<T>;
  /** user prompt text */
  prompt: string;
  /** optional system instruction */
  system?: string;
  /** extra parts appended after the prompt (text chunks, PDF pages) */
  parts?: LlmPart[];
  tier: LlmTier;
  /** maxOutputTokens (default 2048 bulk / 4096 reason) */
  maxTokens?: number;
  /** bump when the prompt wording changes to invalidate the cache (default "1") */
  promptVersion?: string;
  temperature?: number;
  /** default true */
  cache?: boolean;
  signal?: AbortSignal;
  /**
   * Displayable thought summaries as they stream. Set only for a live chat
   * turn. Hidden and redacted parts are not passed through.
   */
  onThought?: (thought: { text: string; fresh: boolean }) => void;
}

export interface CallStructuredResult<T> {
  data: T;
  model: string;
  cached: boolean;
  tokensIn: number;
  tokensOut: number;
  tokensThought: number;
  latencyMs: number;
  cacheKey: string;
}

export class LlmBudgetExhausted extends Error {
  readonly tier: LlmTier;
  readonly models: string[];
  constructor(tier: LlmTier, models: string[], detail?: string) {
    super(
      `LLM budget exhausted for tier "${tier}" (${models.join(", ")})${detail ? `: ${detail}` : ""}`,
    );
    this.name = "LlmBudgetExhausted";
    this.tier = tier;
    this.models = models;
  }
}

export class LlmCallFailed extends Error {
  readonly causes: Array<{ model: string; error: string; status?: number }>;
  constructor(
    task: string,
    causes: Array<{ model: string; error: string; status?: number }>,
  ) {
    super(
      `LLM call failed for task "${task}" on all models: ${causes.map((c) => `${c.model}: ${c.error}`).join(" | ")}`,
    );
    this.name = "LlmCallFailed";
    this.causes = causes;
  }
}

// ---------------------------------------------------------------------------
// Model configuration (free-tier numbers verified 8 Nov 2026 — see docs/research/00)
// ---------------------------------------------------------------------------

export interface ModelLimits {
  /** requests per day (free tier) */
  rpd: number;
  rpm: number;
  tpm: number;
  /** cap fraction applied to rpd */
  capFraction: number;
}

const FLASH_LITE: ModelLimits = {
  rpd: 500,
  rpm: 10,
  tpm: 250_000,
  capFraction: 0.8,
};
const FLASH: ModelLimits = { rpd: 20, rpm: 5, tpm: 250_000, capFraction: 0.8 };

export const MODEL_LIMITS: Record<string, ModelLimits> = {
  "gemini-3.5-flash-lite": FLASH_LITE,
  "gemini-3.1-flash-lite": FLASH_LITE,
  "gemini-3.6-flash": FLASH,
  "gemini-3.5-flash": FLASH,
  "gemini-3.8-flash": FLASH,
};

function limitsFor(model: string): ModelLimits {
  return MODEL_LIMITS[model] ?? (model.includes("lite") ? FLASH_LITE : FLASH);
}

export function dailyCap(model: string): number {
  const l = limitsFor(model);
  const raw = Number(process.env.FINN_LLM_CAP_FRACTION ?? "");
  const fraction =
    Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : l.capFraction;
  return Math.floor(l.rpd * fraction);
}

const DEFAULT_BULK = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const DEFAULT_REASON = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  // Last rung when Flash is capped or has failed every call today.
  // Chat still calls a live model. Finnie does not read llm_cache.
  "gemini-3.5-flash-lite",
];

export const MODEL_LADDERS: Record<LlmTier, () => string[]> = {
  bulk: () => parseList(env().FINN_MODELS_BULK) ?? DEFAULT_BULK,
  // Flash only. Flash-Lite stays on the bulk ladder.
  reason: () => parseList(env().FINN_MODELS_REASON) ?? DEFAULT_REASON,
};

function parseList(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const items = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

const TIER_BUCKET: Record<LlmTier, { rpm: number; tpm: number }> = {
  bulk: { rpm: 10, tpm: 250_000 },
  reason: { rpm: 5, tpm: 250_000 },
};

const TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Pacific-day ledger
// ---------------------------------------------------------------------------

/** Calendar day in America/Los_Angeles — Gemini free-tier quotas reset at midnight Pacific. */
export function todayPt(now: Date = new Date()): string {
  return formatInTimeZone(now, "America/Los_Angeles", "yyyy-MM-dd");
}

async function ledgerState(
  model: string,
  datePt: string,
): Promise<{ requests: number; errors: number }> {
  const rows = await db
    .select({ requests: llmLedger.requests, errors: llmLedger.errors })
    .from(llmLedger)
    .where(and(eq(llmLedger.model, model), eq(llmLedger.datePt, datePt)))
    .limit(1);
  return {
    requests: rows[0]?.requests ?? 0,
    errors: rows[0]?.errors ?? 0,
  };
}

async function ledgerBump(
  model: string,
  datePt: string,
  d: {
    requests?: number;
    tokensIn?: number;
    tokensOut?: number;
    tokensThought?: number;
    errors?: number;
  },
): Promise<void> {
  const req = d.requests ?? 0;
  const tin = d.tokensIn ?? 0;
  const tout = d.tokensOut ?? 0;
  const tth = d.tokensThought ?? 0;
  const err = d.errors ?? 0;
  await db
    .insert(llmLedger)
    .values({
      model,
      datePt,
      requests: req,
      tokensIn: tin,
      tokensOut: tout,
      tokensThought: tth,
      errors: err,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [llmLedger.model, llmLedger.datePt],
      set: {
        requests: sql`${llmLedger.requests} + ${req}`,
        tokensIn: sql`${llmLedger.tokensIn} + ${tin}`,
        tokensOut: sql`${llmLedger.tokensOut} + ${tout}`,
        tokensThought: sql`${llmLedger.tokensThought} + ${tth}`,
        errors: sql`${llmLedger.errors} + ${err}`,
        updatedAt: Date.now(),
      },
    });
}

export interface ModelBudget {
  model: string;
  tier: LlmTier;
  datePt: string;
  requests: number;
  cap: number;
  remaining: number;
  tokensIn: number;
  tokensOut: number;
}

/** For /status: today's usage vs cap for every model in both ladders. */
export async function remainingBudget(
  now: Date = new Date(),
): Promise<ModelBudget[]> {
  const datePt = todayPt(now);
  const rows = await db
    .select()
    .from(llmLedger)
    .where(eq(llmLedger.datePt, datePt));
  const byModel = new Map(rows.map((r) => [r.model, r]));
  const out: ModelBudget[] = [];
  const seen = new Set<string>();
  // bulk first so a model that appears on both ladders is labelled "bulk"
  for (const tier of ["bulk", "reason"] as const) {
    for (const model of MODEL_LADDERS[tier]()) {
      if (seen.has(model)) continue;
      seen.add(model);
      const r = byModel.get(model);
      const cap = dailyCap(model);
      const requests = r?.requests ?? 0;
      out.push({
        model,
        tier,
        datePt,
        requests,
        cap,
        remaining: Math.max(0, cap - requests),
        tokensIn: r?.tokensIn ?? 0,
        tokensOut: r?.tokensOut ?? 0,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Process-local token bucket (sliding 60 s window per tier)
// ---------------------------------------------------------------------------

interface Bucket {
  events: Array<{ at: number; tokens: number }>;
}
const buckets: Record<LlmTier, Bucket> = {
  bulk: { events: [] },
  reason: { events: [] },
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function acquire(
  tier: LlmTier,
  estTokens: number,
  signal?: AbortSignal,
): Promise<void> {
  const { rpm, tpm } = TIER_BUCKET[tier];
  const b = buckets[tier];
  for (;;) {
    const now = Date.now();
    b.events = b.events.filter((e) => now - e.at < 60_000);
    const used = b.events.reduce((s, e) => s + e.tokens, 0);
    if (b.events.length < rpm && used + estTokens <= tpm) {
      b.events.push({ at: now, tokens: estTokens });
      return;
    }
    const oldest = b.events[0]?.at ?? now;
    const wait = Math.max(250, 60_000 - (now - oldest) + 50);
    log.debug(
      { tier, wait, inWindow: b.events.length, used },
      "rate limit: waiting",
    );
    await sleep(wait, signal);
  }
}

/** Replace the estimate with the real prompt token count once known. */
function settle(tier: LlmTier, estTokens: number, actual: number): void {
  const b = buckets[tier];
  const i = b.events.findIndex((e) => e.tokens === estTokens);
  const ev = i >= 0 ? b.events[i] : undefined;
  if (ev) ev.tokens = actual;
}

function estimateTokens(
  prompt: string,
  system: string | undefined,
  parts: LlmPart[],
): number {
  let chars = prompt.length + (system?.length ?? 0);
  let pdfBytes = 0;
  for (const p of parts) {
    if (p.kind === "text") chars += p.text.length;
    else pdfBytes += p.bytes.byteLength;
  }
  // ~4 chars/token for text; a PDF page is ~258 tokens and ~60 KB on average
  return Math.ceil(chars / 4) + Math.ceil(pdfBytes / 60_000) * 258;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function sha256(s: string | Uint8Array): string {
  return createHash("sha256").update(s).digest("hex");
}

/** The object Gemini must emit. A preprocess pipe stays on our side of the parse. */
function responseSchema(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let i = 0; i < 5; i++) {
    const def = (current as { def?: { type?: string; out?: z.ZodType } }).def;
    if (def?.type === "pipe" && def.out) {
      current = def.out;
      continue;
    }
    break;
  }
  return current;
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(responseSchema(schema), {
    target: "draft-7",
    io: "output",
  }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function cacheKeyFor(
  o: CallStructuredOptions<unknown>,
  jsonSchema: Record<string, unknown>,
): string {
  const h = createHash("sha256");
  h.update(o.task)
    .update("|")
    .update(o.promptVersion ?? "1")
    .update("|");
  h.update(o.system ?? "")
    .update("|")
    .update(o.prompt)
    .update("|");
  for (const p of o.parts ?? []) {
    if (p.kind === "text") h.update("t:").update(p.text);
    else h.update("p:").update(sha256(p.bytes));
    h.update("|");
  }
  h.update(JSON.stringify(jsonSchema));
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------------------

let client: GoogleGenAI | undefined;
function genai(): GoogleGenAI {
  if (!client) {
    const key = env().GEMINI_API_KEY;
    if (!key)
      throw new LlmCallFailed("init", [
        { model: "-", error: "GEMINI_API_KEY is not set" },
      ]);
    client = new GoogleGenAI({
      apiKey: key,
      httpOptions: { timeout: TIMEOUT_MS },
    });
  }
  return client;
}

const RES_MAP = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
} as const;

function toParts(prompt: string, parts: LlmPart[]): Part[] {
  const out: Part[] = [{ text: prompt }];
  for (const p of parts) {
    if (p.kind === "text") out.push({ text: p.text });
    else
      out.push({
        inlineData: {
          mimeType: "application/pdf",
          data: Buffer.from(p.bytes).toString("base64"),
        },
      });
  }
  return out;
}

function isRetryable(status: number | undefined): boolean {
  return status === 429 || status === 503 || status === 500;
}

interface UsageCounts {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface ModelCall {
  prompt: string;
  system?: string;
  parts?: LlmPart[];
  tier: LlmTier;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onThought?: (thought: { text: string; fresh: boolean }) => void;
}

/**
 * Lowest thinking level that returns a displayable summary.
 * MINIMAL and LOW produce zero thought tokens on gemini-3.6-flash.
 * MEDIUM is the next supported level. HIGH is a longer pass and stays off.
 */
export function thinkingLevelFor(
  tier: LlmTier,
  thoughts: boolean,
): ThinkingLevel {
  if (tier === "bulk") return ThinkingLevel.MINIMAL;
  if (thoughts) return ThinkingLevel.MEDIUM;
  return ThinkingLevel.LOW;
}

function modelConfig(
  o: ModelCall,
  jsonSchema: Record<string, unknown>,
  mediaRes: "low" | "medium" | "high" | undefined,
  thoughts: boolean,
) {
  return {
    systemInstruction: o.system,
    responseMimeType: "application/json" as const,
    responseJsonSchema: jsonSchema,
    maxOutputTokens: o.maxTokens ?? (o.tier === "bulk" ? 2048 : 4096),
    temperature: o.temperature ?? 0,
    thinkingConfig: {
      thinkingLevel: thinkingLevelFor(o.tier, thoughts),
      ...(thoughts ? { includeThoughts: true as const } : {}),
    },
    ...(mediaRes ? { mediaResolution: RES_MAP[mediaRes] } : {}),
    httpOptions: { timeout: TIMEOUT_MS },
    abortSignal: o.signal,
  };
}

function thoughtConfigRejected(error: unknown): boolean {
  const status = errStatus(error);
  if (status != null && status !== 400) return false;
  const msg = errMessage(error).toLowerCase();
  return msg.includes("thought") || msg.includes("thinking");
}

/**
 * One model call. Thoughts stream only when a listener is attached, and only
 * the summary text the API marks as a thought part. The JSON answer excludes
 * those parts. A rejected thought config falls back to the unary call.
 */
async function completeCall(
  o: ModelCall,
  model: string,
  jsonSchema: Record<string, unknown>,
  mediaRes: "low" | "medium" | "high" | undefined,
): Promise<{ text: string; usage?: UsageCounts }> {
  const contents = [
    { role: "user" as const, parts: toParts(o.prompt, o.parts ?? []) },
  ];
  const unary = async () => {
    const res = await genai().models.generateContent({
      model,
      contents,
      config: modelConfig(o, jsonSchema, mediaRes, false),
    });
    return { text: res.text ?? "", usage: res.usageMetadata };
  };
  if (!o.onThought) return unary();
  try {
    const streamed = await streamCall(o, model, jsonSchema, mediaRes);
    if (streamed.text.trim()) return streamed;
  } catch (error) {
    if (!thoughtConfigRejected(error)) throw error;
  }
  // Thoughts were refused, or the JSON never arrived beside them.
  return unary();
}

async function streamCall(
  o: ModelCall,
  model: string,
  jsonSchema: Record<string, unknown>,
  mediaRes: "low" | "medium" | "high" | undefined,
): Promise<{ text: string; usage?: UsageCounts }> {
  const stream = await genai().models.generateContentStream({
    model,
    contents: [{ role: "user", parts: toParts(o.prompt, o.parts ?? []) }],
    config: modelConfig(o, jsonSchema, mediaRes, true),
  });
  const state: ThoughtScan = { answer: "", thought: "", thoughtOpen: false };
  let usage: UsageCounts | undefined;
  for await (const chunk of stream) {
    if (o.signal?.aborted) throw o.signal.reason ?? new Error("aborted");
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    const emitted = consumeThoughtParts(parts, state);
    for (const thought of emitted) {
      try {
        o.onThought?.(thought);
      } catch {
        // The listener must not fail the call.
      }
    }
    if (chunk.usageMetadata) usage = chunk.usageMetadata;
  }
  return { text: state.answer, usage };
}

function errStatus(e: unknown): number | undefined {
  if (e instanceof ApiError) return e.status;
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pull JSON out of a model response even if it wrapped it in a code fence. */
function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m?.[1]) return JSON.parse(m[1]);
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error("response is not JSON");
  }
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export async function callStructured<T>(
  o: CallStructuredOptions<T>,
): Promise<CallStructuredResult<T>> {
  const parts = o.parts ?? [];
  const jsonSchema = toJsonSchema(o.schema);
  const cacheKey = cacheKeyFor(o as CallStructuredOptions<unknown>, jsonSchema);
  // Chat turns always call the model. Do not read or write llm_cache for them.
  // Historical rows stay. Guidance extraction and one-liners still cache.
  const useCache = o.cache !== false && o.task !== "finnie";
  const started = Date.now();

  if (useCache) {
    const hit = await db
      .select()
      .from(llmCache)
      .where(eq(llmCache.key, cacheKey))
      .limit(1);
    const row = hit[0];
    if (row) {
      const parsed = o.schema.safeParse(JSON.parse(row.responseJson));
      if (parsed.success) {
        log.debug(
          { task: o.task, model: row.model, cacheKey: cacheKey.slice(0, 12) },
          "llm cache hit",
        );
        return {
          data: parsed.data,
          model: row.model,
          cached: true,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          tokensThought: 0,
          latencyMs: Date.now() - started,
          cacheKey,
        };
      }
    }
  }

  const ladder = MODEL_LADDERS[o.tier]();
  if (isCacheOnly())
    throw new LlmBudgetExhausted(
      o.tier,
      ladder,
      "FINN_LLM_CACHE_ONLY=true and no cache entry",
    );

  const datePt = todayPt();
  const causes: Array<{ model: string; error: string; status?: number }> = [];
  let anyAttempted = false;
  const est = estimateTokens(o.prompt, o.system, parts);
  const mediaRes = parts.find(
    (p): p is Extract<LlmPart, { kind: "pdf" }> => p.kind === "pdf",
  )?.resolution;

  for (const model of ladder) {
    const state = await ledgerState(model, datePt);
    const cap = dailyCap(model);
    if (state.requests >= cap) {
      log.warn(
        { model, used: state.requests, cap, datePt },
        "model at daily cap — skipping",
      );
      continue;
    }
    if (state.requests >= 3 && state.errors >= state.requests) {
      log.warn(
        { model, requests: state.requests, datePt },
        "model failed every call today — skipping",
      );
      continue;
    }
    anyAttempted = true;

    for (let attempt = 0; attempt < 2; attempt++) {
      await acquire(o.tier, est, o.signal);
      const t0 = Date.now();
      try {
        const completed = await completeCall(o, model, jsonSchema, mediaRes);
        const usage = completed.usage;
        const tokensIn = usage?.promptTokenCount ?? est;
        const tokensOut = usage?.candidatesTokenCount ?? 0;
        const tokensThought = usage?.thoughtsTokenCount ?? 0;
        settle(o.tier, est, tokensIn);
        await ledgerBump(model, datePt, {
          requests: 1,
          tokensIn,
          tokensOut,
          tokensThought,
        });

        const text = completed.text;
        if (!text) throw new Error("empty response");
        const parsed = o.schema.safeParse(parseJsonLoose(text));
        if (!parsed.success)
          throw new Error(
            `schema validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          );

        if (useCache) {
          await db
            .insert(llmCache)
            .values({
              key: cacheKey,
              task: o.task,
              model,
              promptVersion: o.promptVersion ?? "1",
              responseJson: JSON.stringify(parsed.data),
              tokensIn,
              tokensOut,
              createdAt: Date.now(),
            })
            .onConflictDoNothing();
        }
        const latencyMs = Date.now() - t0;
        log.info(
          {
            task: o.task,
            model,
            tokensIn,
            tokensOut,
            tokensThought,
            latencyMs,
            attempt,
          },
          "llm ok",
        );
        return {
          data: parsed.data,
          model,
          cached: false,
          tokensIn,
          tokensOut,
          tokensThought,
          latencyMs,
          cacheKey,
        };
      } catch (e) {
        const status = errStatus(e);
        const msg = errMessage(e);
        causes.push({ model, error: msg.slice(0, 300), status });
        // every attempt counts against RPD, including failed ones
        await ledgerBump(model, datePt, { requests: 1, errors: 1 }).catch(
          () => undefined,
        );
        log.warn(
          { task: o.task, model, status, attempt, err: msg.slice(0, 200) },
          "llm call failed",
        );
        if (o.signal?.aborted) throw e;
        const schemaFail =
          msg.startsWith("schema validation failed") ||
          msg.includes("not JSON") ||
          msg.startsWith("empty response");
        const quota = status === 429 && /quota/i.test(msg);
        if ((isRetryable(status) || schemaFail) && attempt === 0 && !quota) {
          await sleep(1000 + Math.random() * 2000, o.signal);
          continue;
        }
        break; // next model
      }
    }
  }

  if (!anyAttempted)
    throw new LlmBudgetExhausted(
      o.tier,
      ladder,
      `all models at 80% RPD cap for ${datePt}`,
    );
  throw new LlmCallFailed(o.task, causes);
}
