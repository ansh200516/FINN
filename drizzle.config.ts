import { defineConfig } from "drizzle-kit";

// drizzle-kit reads DATABASE_URL directly (no Next env loading here).
// Local default is the SQLite file. postgres:// uses src/db/schema.pg.ts.
// libsql:// remains Turso.
const url = process.env.DATABASE_URL ?? "file:./data/finn.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;
const isPg = url.startsWith("postgres://") || url.startsWith("postgresql://");
const isTurso = url.startsWith("libsql://");

export default defineConfig({
  dialect: isPg ? "postgresql" : isTurso ? "turso" : "sqlite",
  schema: isPg ? "./src/db/schema.pg.ts" : "./src/db/schema.sqlite.ts",
  out: isPg ? "./drizzle-pg" : "./drizzle",
  dbCredentials: isPg ? { url } : authToken ? { url, authToken } : { url },
  strict: true,
  verbose: false,
});
