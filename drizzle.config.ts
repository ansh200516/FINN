import { defineConfig } from "drizzle-kit";

// drizzle-kit reads DATABASE_URL directly (no Next env loading here).
// Local default is the SQLite file; prod is a Turso libsql:// URL.
const url = process.env.DATABASE_URL ?? "file:./data/finn.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

export default defineConfig({
  dialect: url.startsWith("libsql://") ? "turso" : "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: authToken ? { url, authToken } : { url },
  strict: true,
  verbose: false,
});
