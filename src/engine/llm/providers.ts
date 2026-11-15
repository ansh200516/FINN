/**
 * Finnie fallbacks after the Gemini ladder.
 *
 * Order: Groq, then OpenRouter's free router, then Cerebras. A provider whose
 * env var is empty is skipped. Each call asks for the same JSON schema the
 * planner and the answer already use. A provider that cannot take that schema
 * is left out of the planner. These calls do not read or write llm_cache.
 *
 * Thought summaries are forwarded only when a provider actually returns one.
 * None of these three do. The chat keeps the step titles it already showed.
 * This module does not invent a chain of thought.
 */
import { FINNIE_MODEL_DOWN } from "@/lib/finnieTypes";

const TIMEOUT_MS = 60_000;

interface ProviderEnv {
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  NEXT_PUBLIC_APP_URL?: string;
}

function providerEnv(source?: ProviderEnv): ProviderEnv {
  if (source) return source;
  return {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

export interface ProviderTurn {
  /** True for the tool plan. Schema-incapable providers are skipped. */
  planner: boolean;
  system?: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ProviderOutput {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export type ProviderResult = string | ProviderOutput;

export interface RotatingProvider {
  id: string;
  model: string;
  /** False means the planner must not call this provider. */
  supportsSchema: boolean;
  complete: (call: ProviderTurn) => Promise<ProviderResult>;
}

export interface RotationHit {
  provider: string;
  model: string;
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export class ProviderHttpError extends Error {
  readonly status?: number;
  readonly model: string;
  constructor(model: string, status: number | undefined, message: string) {
    super(message);
    this.name = "ProviderHttpError";
    this.model = model;
    this.status = status;
  }
}

interface ProviderSpec {
  id: string;
  model: string;
  envVar: "GROQ_API_KEY" | "OPENROUTER_API_KEY" | "CEREBRAS_API_KEY";
  url: string;
  supportsSchema: boolean;
  extra: Record<string, unknown>;
}

/**
 * Official free tiers, checked Nov 2026.
 * Groq free plan: openai/gpt-oss-20b (the small fast model; about 30 RPM / 1,000 RPD).
 * OpenRouter: openrouter/free stays on $0 models and will not fall through to a paid one.
 * Cerebras: Shared Inference free-trial credits for qwen-3.8-27b. Access stops when they run out.
 */
const SPECS: ProviderSpec[] = [
  {
    id: "groq",
    model: "openai/gpt-oss-20b",
    envVar: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    supportsSchema: true,
    // "none" is rejected on this model. Low keeps the JSON in content.
    // hidden means the reasoning trace is not a thought summary we can show.
    extra: { reasoning_effort: "low", reasoning_format: "hidden" },
  },
  {
    id: "openrouter",
    model: "openrouter/free",
    envVar: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    supportsSchema: true,
    // Only endpoints that accept the JSON schema. The router stays on free models.
    extra: { provider: { require_parameters: true } },
  },
  {
    id: "cerebras",
    model: "qwen-3.8-27b",
    envVar: "CEREBRAS_API_KEY",
    url: "https://api.cerebras.ai/v1/chat/completions",
    supportsSchema: true,
    // The default effort is high and does not return a displayable summary.
    extra: { reasoning_effort: "none" },
  },
];

const LIMIT_MESSAGE =
  /quota|rate[\s_-]?limit|too many requests|\b429\b|\b402\b|\b503\b|resource[\s_-]?exhausted|high[\s_-]?demand|insufficient[\s_-]?(?:credit|quota)|credit balance|out of (?:credit|credits)|free credits|exceeded your|daily (?:limit|cap)|billing|tokens per day/i;

const CREDIT_403 =
  /credit|quota|billing|insufficient|exhausted|balance|limit|payment/i;

export function isFailoverStatus(
  status: number | undefined,
  message: string,
): boolean {
  if (
    status === 400 ||
    status === 401 ||
    status === 402 ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }
  if (status === 403 && CREDIT_403.test(message)) return true;
  if (LIMIT_MESSAGE.test(message)) return true;
  if (
    status == null &&
    /fetch failed|network|econnreset|etimedout|timed out|timeout|socket/i.test(
      message,
    )
  ) {
    return true;
  }
  return false;
}

export function isFailoverError(error: unknown): boolean {
  if (error instanceof Error && error.name === "TimeoutError") return true;
  // No HTTP status means the provider never answered (network or timeout).
  if (error instanceof ProviderHttpError && error.status == null) return true;
  const status = error instanceof ProviderHttpError ? error.status : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return isFailoverStatus(status, message);
}

/** The model answered, and the body was rejected. Not a quota failure. */
export function isModelReplyFailure(message: string, status?: number): boolean {
  if (status != null) return false;
  return (
    message.startsWith("schema validation failed") ||
    message.includes("not JSON") ||
    message.startsWith("empty response")
  );
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:gsk|sk-or|sk)-[A-Za-z0-9_-]+\b/g, "[redacted]");
}

function asOutput(value: ProviderResult): ProviderOutput {
  return typeof value === "string" ? { text: value } : value;
}

/**
 * Call providers in order. The first quota / 429 / credit / 503-style failure
 * tries the next one. The returned text is whatever that provider sent.
 * An empty list throws the same outage sentence the chat already shows.
 */
export async function rotateProviders(
  providers: RotatingProvider[],
  call: ProviderTurn,
): Promise<RotationHit> {
  const usable = providers.filter(
    (provider) => !call.planner || provider.supportsSchema,
  );
  if (!usable.length) throw new Error(FINNIE_MODEL_DOWN);
  let last: unknown;
  for (const provider of usable) {
    try {
      const output = asOutput(await provider.complete(call));
      const text = output.text ?? "";
      if (!text.trim()) throw new Error("empty response");
      return {
        provider: provider.id,
        model: provider.model,
        text,
        tokensIn: output.tokensIn ?? 0,
        tokensOut: output.tokensOut ?? 0,
      };
    } catch (error) {
      const message = messageOf(error);
      const status =
        error instanceof ProviderHttpError ? error.status : undefined;
      last =
        error instanceof ProviderHttpError
          ? error
          : new ProviderHttpError(
              `${provider.id}:${provider.model}`,
              status,
              message,
            );
      if (call.signal?.aborted) throw error;
      if (isFailoverError(error) || isModelReplyFailure(message, status)) {
        continue;
      }
      if (error instanceof Error && error.name === "AbortError") continue;
      throw error;
    }
  }
  if (last instanceof Error) throw last;
  throw new Error(FINNIE_MODEL_DOWN);
}

export function fallbackProviderConfigured(source?: ProviderEnv): boolean {
  const envSource = providerEnv(source);
  return SPECS.some((spec) => Boolean(envSource[spec.envVar]?.trim()));
}

type FetchImpl = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;

export function configuredFallbackProviders(
  source?: ProviderEnv,
  fetchImpl: FetchImpl = fetch,
): RotatingProvider[] {
  const envSource = providerEnv(source);
  const providers: RotatingProvider[] = [];
  for (const spec of SPECS) {
    const key = envSource[spec.envVar]?.trim() ?? "";
    if (!key) continue;
    const headers = headersFor(spec, envSource);
    providers.push({
      id: spec.id,
      model: spec.model,
      supportsSchema: spec.supportsSchema,
      complete: (call) => completeChat(spec, key, headers, call, fetchImpl),
    });
  }
  return providers;
}

function headersFor(
  spec: ProviderSpec,
  source: ProviderEnv,
): Record<string, string> {
  if (spec.id !== "openrouter") return {};
  const headers: Record<string, string> = { "X-Title": "FINN" };
  const referer = source.NEXT_PUBLIC_APP_URL?.trim();
  if (referer) headers["HTTP-Referer"] = referer;
  return headers;
}

function schemaFor(call: ProviderTurn): Record<string, unknown> {
  const schema = { ...call.jsonSchema };
  delete schema.$schema;
  return schema;
}

function requestBody(
  spec: ProviderSpec,
  call: ProviderTurn,
): Record<string, unknown> {
  const schema = schemaFor(call);
  const guide =
    "Return one JSON object that matches the response schema. Do not add a second answer.";
  const system = [call.system, guide].filter(Boolean).join("\n\n");
  return {
    model: spec.model,
    temperature: call.temperature ?? 0,
    max_tokens: call.maxTokens,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: call.prompt },
    ],
    response_format: spec.supportsSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: call.planner ? "finnie_plan" : "finnie_say",
            strict: false,
            schema,
          },
        }
      : { type: "json_object" },
    ...spec.extra,
  };
}

async function completeChat(
  spec: ProviderSpec,
  apiKey: string,
  extraHeaders: Record<string, string>,
  call: ProviderTurn,
  fetchImpl: FetchImpl,
): Promise<ProviderOutput> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = call.signal
    ? AbortSignal.any([call.signal, timeout])
    : timeout;
  const model = `${spec.id}:${spec.model}`;
  let response: Response;
  try {
    response = await fetchImpl(spec.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(requestBody(spec, call)),
      signal,
    });
  } catch (error) {
    if (call.signal?.aborted) throw error;
    throw new ProviderHttpError(model, undefined, messageOf(error));
  }
  if (!response.ok) {
    throw new ProviderHttpError(
      model,
      response.status,
      await errorMessage(response),
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("response is not JSON");
  }
  const text = messageText(body);
  if (!text.trim()) throw new Error("empty response");
  const usage = usageOf(body);
  return { text, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut };
}

async function errorMessage(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const body = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error.trim().slice(0, 300);
    }
    if (
      body.error &&
      typeof body.error === "object" &&
      typeof body.error.message === "string" &&
      body.error.message.trim()
    ) {
      return body.error.message.trim().slice(0, 300);
    }
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message.trim().slice(0, 300);
    }
  } catch {
    // The body was not JSON.
  }
  const fallback = raw.trim() || response.statusText || "request failed";
  return fallback.slice(0, 300);
}

function messageText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (
    !Array.isArray(choices) ||
    !choices[0] ||
    typeof choices[0] !== "object"
  ) {
    return "";
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  return contentText((message as { content?: unknown }).content);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

function usageOf(body: unknown): { tokensIn: number; tokensOut: number } {
  const usage =
    body && typeof body === "object"
      ? (body as { usage?: unknown }).usage
      : undefined;
  if (!usage || typeof usage !== "object") return { tokensIn: 0, tokensOut: 0 };
  const prompt = (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const completion = (usage as { completion_tokens?: unknown })
    .completion_tokens;
  return {
    tokensIn: typeof prompt === "number" ? prompt : 0,
    tokensOut: typeof completion === "number" ? completion : 0,
  };
}
