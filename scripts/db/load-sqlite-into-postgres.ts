/**
 * Copy data/finn.db into a Postgres DATABASE_URL.
 *
 * SQLite integer booleans (0/1) become Postgres booleans.
 * Every other INTEGER is loaded into bigint (epoch milliseconds do not fit int4).
 * Rows are not dropped. A SQLite column with no Postgres column aborts the load.
 *
 * Usage: DATABASE_URL=postgresql://... pnpm db:load:pg
 */
import { createClient } from "@libsql/client";
import postgres from "postgres";
import { isPostgresUrl } from "../../src/db/dialect";

const BOOLEANS = new Set([
  "companies.in_portfolio",
  "companies.is_adhoc",
  "announcements.has_xbrl",
  "results_quarters.audited",
  "tripwires.enabled",
  "document_meta.spreads",
]);

const TABLES = [
  "companies",
  "prices",
  "announcements",
  "events",
  "results_quarters",
  "documents",
  "document_pages",
  "document_meta",
  "guidance",
  "facts",
  "research_sections",
  "users",
  "tripwires",
  "alerts",
  "llm_ledger",
  "llm_cache",
  "jobs",
] as const;

const JSON_FNS = `
create or replace function finn_json_text(raw text, key text)
returns text
language plpgsql
stable
as $fn$
begin
  if raw is null or btrim(raw) = '' or left(btrim(raw), 1) not in ('{', '[') then
    return null;
  end if;
  return raw::json ->> key;
exception
  when others then
    return null;
end;
$fn$;

create or replace function finn_json_array(raw text)
returns setof text
language plpgsql
stable
as $fn$
begin
  if raw is null or left(btrim(raw), 1) <> '[' then
    return;
  end if;
  return query select jsonb_array_elements_text(raw::jsonb);
exception
  when others then
    return;
end;
$fn$;
`;

function scrub(message: string): string {
  return message.replace(
    /postgres(?:ql)?:\/\/\S+/gi,
    "postgresql://[redacted]",
  );
}

function cell(
  table: string,
  column: string,
  value: unknown,
  nulls: { n: number },
): unknown {
  if (value == null) return null;
  if (typeof value === "bigint") {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`${table}.${column} exceeds Number.MAX_SAFE_INTEGER`);
    }
    value = n;
  }
  if (BOOLEANS.has(`${table}.${column}`)) return Number(value) === 1;
  if (typeof value === "string" && value.includes("\u0000")) {
    nulls.n += 1;
    return value.replaceAll("\u0000", "");
  }
  return value;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!isPostgresUrl(url)) {
    throw new Error(
      "db:load:pg requires DATABASE_URL to be a postgres:// or postgresql:// URL",
    );
  }
  const sqlitePath = process.env.SQLITE_PATH ?? "data/finn.db";
  const sqlite = createClient({ url: `file:${sqlitePath}` });
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    ssl: "require",
    connect_timeout: 30,
    idle_timeout: 20,
    onnotice: () => {},
  });
  const nulls = { n: 0 };

  try {
    await sql.unsafe(JSON_FNS);
    const pgCols = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
    `;
    const pgByTable = new Map<string, Set<string>>();
    for (const row of pgCols) {
      const set = pgByTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      pgByTable.set(row.table_name, set);
    }

    const plans: { table: string; columns: string[] }[] = [];
    for (const table of TABLES) {
      const info = await sqlite.execute(`pragma table_info(${table})`);
      const columns = info.rows.map((r) => String(r.name));
      if (!columns.length) throw new Error(`sqlite table missing: ${table}`);
      const have = pgByTable.get(table);
      if (!have) throw new Error(`postgres table missing: ${table}`);
      const missing = columns.filter((c) => !have.has(c));
      if (missing.length) {
        throw new Error(
          `postgres ${table} is missing columns: ${missing.join(", ")}`,
        );
      }
      plans.push({ table, columns });
    }

    await sql.unsafe(
      `truncate table ${TABLES.map((t) => `"${t}"`).join(", ")} restart identity cascade`,
    );

    for (const { table, columns } of plans) {
      const result = await sqlite.execute(
        `select ${columns.map((c) => `"${c}"`).join(", ")} from ${table}`,
      );
      const rows = result.rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const column of columns)
          out[column] = cell(table, column, row[column], nulls);
        return out;
      });
      const size = table === "document_pages" ? 40 : 200;
      for (let i = 0; i < rows.length; i += size) {
        const chunk = rows.slice(i, i + size);
        await sql`insert into ${sql(table)} ${sql(chunk, ...columns)}`;
      }
      console.log(`loaded ${table} ${rows.length}`);
    }

    let failed = false;
    for (const table of TABLES) {
      const sqliteCount = await sqlite.execute(
        `select count(*) as n from ${table}`,
      );
      const pgCount = await sql.unsafe(
        `select count(*)::int as n from ${table}`,
      );
      const a = Number(sqliteCount.rows[0]?.n);
      const b = Number(pgCount[0]?.n);
      const ok = a === b;
      if (!ok) failed = true;
      console.log(`count ${table} sqlite=${a} pg=${b} ok=${ok}`);
    }

    const spot = await sqlite.execute(`
      select c.nse_symbol as symbol, r.period_end as period_end, r.basis as basis,
             r.revenue as revenue, json_extract(r.checks_json, '$.nii') as nii
      from results_quarters r
      join companies c on c.isin = r.isin
      where c.nse_symbol in ('RELIANCE', 'HDFCBANK') and r.basis = 'consolidated'
      order by c.nse_symbol, r.period_end desc
    `);
    for (const symbol of ["RELIANCE", "HDFCBANK"]) {
      const row = spot.rows.find((r) => r.symbol === symbol);
      if (!row) {
        console.log(`spot ${symbol} missing_in_sqlite`);
        failed = true;
        continue;
      }
      const pg = await sql<{ revenue: number | null; nii: string | null }[]>`
        select r.revenue, finn_json_text(r.checks_json, 'nii') as nii
        from results_quarters r
        join companies c on c.isin = r.isin
        where c.nse_symbol = ${symbol}
          and r.basis = 'consolidated'
          and r.period_end = ${String(row.period_end)}
      `;
      const revenueOk = Number(pg[0]?.revenue) === Number(row.revenue);
      const niiOk = String(pg[0]?.nii ?? "") === String(row.nii ?? "");
      if (!revenueOk || !niiOk) failed = true;
      console.log(
        `spot ${symbol} period=${row.period_end} revenue_ok=${revenueOk} nii_ok=${niiOk} revenue=${row.revenue} nii=${row.nii}`,
      );
    }
    console.log(`null_bytes_stripped ${nulls.n}`);
    if (failed) throw new Error("postgres load did not match sqlite");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(scrub(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
