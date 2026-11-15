import { describe, expect, it } from "vitest";
import {
  configuredFallbackProviders,
  isFailoverStatus,
  ProviderHttpError,
  type ProviderTurn,
  rotateProviders,
} from "@/engine/llm/providers";
import { FINNIE_MODEL_DOWN } from "@/lib/finnieTypes";

const turn: ProviderTurn = {
  planner: false,
  system: "You are Finnie.",
  prompt: "What did Reliance file?",
  jsonSchema: {
    type: "object",
    properties: { say: { type: "string" } },
    required: ["say"],
    additionalProperties: false,
  },
  maxTokens: 256,
  temperature: 0,
};

describe("provider rotation", () => {
  it("returns the next provider's text when the first hits a quota error", async () => {
    const seen: string[] = [];
    const result = await rotateProviders(
      [
        {
          id: "groq",
          model: "openai/gpt-oss-20b",
          supportsSchema: true,
          complete: async () => {
            seen.push("groq");
            throw new ProviderHttpError(
              "groq:openai/gpt-oss-20b",
              429,
              "quota exceeded",
            );
          },
        },
        {
          id: "openrouter",
          model: "openrouter/free",
          supportsSchema: true,
          complete: async () => {
            seen.push("openrouter");
            return '{"say":"Reliance filed results."}';
          },
        },
      ],
      turn,
    );
    expect(seen).toEqual(["groq", "openrouter"]);
    expect(result.text).toBe('{"say":"Reliance filed results."}');
    expect(result.provider).toBe("openrouter");
    expect(isFailoverStatus(429, "quota exceeded")).toBe(true);
    expect(isFailoverStatus(403, "insufficient credits")).toBe(true);
    expect(isFailoverStatus(503, "high demand")).toBe(true);
    expect(isFailoverStatus(403, "forbidden")).toBe(false);
  });

  it("keeps the outage sentence when no provider is configured", async () => {
    const providers = configuredFallbackProviders({
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "   ",
    });
    expect(providers).toEqual([]);
    await expect(rotateProviders(providers, turn)).rejects.toThrow(
      FINNIE_MODEL_DOWN,
    );
  });

  it("skips an empty env var and keeps the remaining order", () => {
    const providers = configuredFallbackProviders({
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "openrouter-test",
      CEREBRAS_API_KEY: "cerebras-test",
    });
    expect(providers.map((provider) => provider.id)).toEqual([
      "openrouter",
      "cerebras",
    ]);
    expect(providers.map((provider) => provider.model)).toEqual([
      "openrouter/free",
      "qwen-3.8-27b",
    ]);
  });

  it("does not use a provider that cannot do the planner schema", async () => {
    const seen: string[] = [];
    const result = await rotateProviders(
      [
        {
          id: "loose",
          model: "text-only",
          supportsSchema: false,
          complete: async () => {
            seen.push("loose");
            return "not json";
          },
        },
        {
          id: "groq",
          model: "openai/gpt-oss-20b",
          supportsSchema: true,
          complete: async () => {
            seen.push("groq");
            return '{"calls":[]}';
          },
        },
      ],
      { ...turn, planner: true },
    );
    expect(seen).toEqual(["groq"]);
    expect(result.text).toBe('{"calls":[]}');
  });

  it("asks the next host for the same JSON schema after a 429", async () => {
    const urls: string[] = [];
    const schemas: unknown[] = [];
    const fetchImpl = (async (
      url: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      urls.push(String(url));
      const body = JSON.parse(String(init?.body)) as {
        response_format?: { type?: string; json_schema?: { schema?: unknown } };
      };
      schemas.push(body.response_format?.json_schema?.schema);
      if (urls.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: "quota exceeded" } }),
          { status: 429 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"say":"from the next provider"}' } },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 3 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const providers = configuredFallbackProviders(
      {
        GROQ_API_KEY: "groq-test",
        OPENROUTER_API_KEY: "",
        CEREBRAS_API_KEY: "cerebras-test",
      },
      fetchImpl,
    );
    const hit = await rotateProviders(providers, turn);
    expect(urls).toEqual([
      "https://api.groq.com/openai/v1/chat/completions",
      "https://api.cerebras.ai/v1/chat/completions",
    ]);
    expect(hit.text).toBe('{"say":"from the next provider"}');
    expect(hit.tokensIn).toBe(4);
    expect(schemas[0]).toEqual(turn.jsonSchema);
    expect(schemas[1]).toEqual(turn.jsonSchema);
  });
});
