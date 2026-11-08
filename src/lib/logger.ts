import pino, { type Logger } from "pino";
import { env } from "@/lib/env";

/**
 * Process-wide pino logger. Plain JSON to stdout (no transports, so it works
 * inside Next route handlers and Vercel functions). Child loggers per module:
 *   const log = logger.child({ mod: "engine/ingest" });
 */
export const logger: Logger = pino({
  level: env().LOG_LEVEL ?? (env().NODE_ENV === "test" ? "silent" : "info"),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: [
    "apiKey",
    "authToken",
    "*.apiKey",
    "*.authToken",
    "headers.authorization",
  ],
});

export type { Logger };
