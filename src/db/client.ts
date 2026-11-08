/**
 * Drizzle client.
 *
 *   DATABASE_URL=file:./data/finn.db            local libSQL
 *   DATABASE_URL=libsql://<db>.turso.io         Turso + DATABASE_AUTH_TOKEN
 *   DATABASE_URL=postgres:// or postgresql://   Postgres (Supabase pooler)
 *
 * One client per process (cached on globalThis so Next dev HMR doesn't leak
 * connections). Import `db` for Drizzle queries. `getRawClient()` is libSQL only.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Client, createClient } from "@libsql/client";
import {
  drizzle as drizzleLibsql,
  type LibSQLDatabase,
} from "drizzle-orm/libsql";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { env } from "@/lib/env";
import { isPostgresUrl } from "./dialect";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

type Holder = { client?: Client; db?: Db; pg?: Sql };
const g = globalThis as unknown as { __finnDb?: Holder };
if (!g.__finnDb) g.__finnDb = {};
const holder: Holder = g.__finnDb;

function ensureLocalDir(url: string): void {
  if (!url.startsWith("file:")) return;
  const path = url.slice("file:".length);
  if (path === ":memory:" || path === "") return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

export function getPg(): Sql {
  const url = env().DATABASE_URL;
  if (!isPostgresUrl(url)) {
    throw new Error(
      "getPg() requires a postgres:// or postgresql:// DATABASE_URL",
    );
  }
  if (!holder.pg) {
    // Supavisor transaction mode (port 6543): no prepared statements, and
    // pipelined queries on the one connection never get a ReadyForQuery, so
    // Promise.all page reads (Companies, Alerts) stay on the loading shell.
    holder.pg = postgres(url, {
      prepare: false,
      fetch_types: false,
      max: 1,
      // one query in flight — Supavisor drops pipelined batches
      max_pipeline: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: "require",
    } as Parameters<typeof postgres>[1]);
  }
  return holder.pg;
}

export function getRawClient(): Client {
  const { DATABASE_URL, DATABASE_AUTH_TOKEN } = env();
  if (isPostgresUrl(DATABASE_URL)) {
    throw new Error(
      "getRawClient() is the libSQL client. Postgres uses getDb() / getPg().",
    );
  }
  if (!holder.client) {
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
  if (!holder.db) {
    if (isPostgresUrl(env().DATABASE_URL)) {
      holder.db = drizzlePg(getPg(), { schema }) as unknown as Db;
    } else {
      holder.db = drizzleLibsql(getRawClient(), { schema });
    }
  }
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
    if (isPostgresUrl(env().DATABASE_URL)) {
      const rows = await getPg()`select 1 as ok`;
      return rows.length === 1;
    }
    const r = await getRawClient().execute("select 1 as ok");
    return r.rows.length === 1;
  } catch {
    return false;
  }
}

export { schema };
