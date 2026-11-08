import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
  throw new Error(
    "drizzle.pg.config.ts requires DATABASE_URL to be a postgres:// or postgresql:// URL",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.pg.ts",
  out: "./drizzle-pg",
  dbCredentials: { url },
  strict: false,
  verbose: false,
});
