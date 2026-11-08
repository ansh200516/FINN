/**
 * libSQL + Drizzle client.
 *
 *   DATABASE_URL=file:./data/finn.db          (local default)
 *   DATABASE_URL=libsql://<db>.turso.io       (prod) + DATABASE_AUTH_TOKEN
 *
 * One client per process (cached on globalThis so Next dev HMR doesn't leak
 * connections). Import `db` for Drizzle queries and `rawClient` for raw SQL.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

type Holder = { client?: Client; db?: Db };
const g = globalThis as unknown as { __finnDb?: Holder };
if (!g.__finnDb) g.__finnDb = {};
const holder: Holder = g.__finnDb;

function ensureLocalDir(url: string): void {
  if (!url.startsWith("file:")) return;
  const path = url.slice("file:".length);
  if (path === ":memory:" || path === "") return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

export function getRawClient(): Client {
  if (!holder.client) {
    const { DATABASE_URL, DATABASE_AUTH_TOKEN } = env();
    ensureLocalDir(DATABASE_URL);
    holder.client = createClient(
      DATABASE_AUTH_TOKEN
        ? { url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN }
        : { url: DATABASE_URL },
    );
  }
  return holder.client;
}

export function getDb(): Db {
  if (!holder.db) holder.db = drizzle(getRawClient(), { schema });
  return holder.db;
}

/** Lazy proxy so importing this module never opens a connection by itself. */
export const db: Db = new Proxy({} as Db, {
  get(_t, prop, recv) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const v = Reflect.get(real, prop, recv);
    return typeof v === "function"
      ? (v as (...a: unknown[]) => unknown).bind(real)
      : v;
  },
});

/** Cheap liveness check used by /api/health and /status. */
export async function pingDb(): Promise<boolean> {
  try {
    const r = await getRawClient().execute("select 1 as ok");
    return r.rows.length === 1;
  } catch {
    return false;
  }
}

export { schema };
