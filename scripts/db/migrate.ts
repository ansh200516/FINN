/**
 * Apply drizzle migrations from ./drizzle to DATABASE_URL.
 * Usage: pnpm db:migrate   (creates data/finn.db locally if missing)
 */
import { migrate } from "drizzle-orm/libsql/migrator";
import { getDb, getRawClient } from "@/db/client";
import { env } from "@/lib/env";

async function main(): Promise<void> {
  const url = env().DATABASE_URL;
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  const tables = await getRawClient().execute(
    "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
  );
  console.log(
    `migrated ${url.startsWith("file:") ? url : "<remote libsql>"} — ${tables.rows.length} tables`,
  );
  console.log(tables.rows.map((r) => r.name).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
