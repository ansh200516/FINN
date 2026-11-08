import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { isPostgresUrl } from "./dialect";

function postgresOn(): boolean {
  return isPostgresUrl(env().DATABASE_URL);
}

/**
 * SQLite `json_extract(col, '$.key')`.
 * Postgres: `finn_json_text(col, key)`, which returns null on invalid JSON
 * the way SQLite does instead of aborting the query.
 */
export function jsonExtract(
  column: SQLWrapper,
  path: `$.${string}`,
): SQL<string | null> {
  if (postgresOn()) {
    return sql<
      string | null
    >`finn_json_text(${column}::text, ${path.slice(2)})`;
  }
  return sql<string | null>`json_extract(${column}, ${path})`;
}

/** Case-insensitive membership in a JSON text array (`aliases_json`). */
export function jsonTextArrayHasUpper(column: SQLWrapper, value: string): SQL {
  if (postgresOn()) {
    return sql`exists (select 1 from finn_json_array(${column}::text) as alias(value) where upper(alias.value) = ${value})`;
  }
  return sql`exists (select 1 from json_each(${column}) where upper(json_each.value) = ${value})`;
}
