/**
 * ingest:digest — print the portfolio brief as text (sanity tool).
 *
 *   pnpm ingest:digest                      # last 24h ending now (auto-widens when quiet)
 *   pnpm ingest:digest --hours 168          # last 7 days
 *   pnpm ingest:digest --symbol RELIANCE,INFY --json
 *   pnpm ingest:digest --volume 2 --move 5  # thresholds
 *   pnpm ingest:digest --to 2026-11-07T18:30
 *
 * Owner: Builder A. Uses engine/analyse/brief.buildBrief — the same model the UI renders.
 */
import { parseArgs } from "node:util";
import { buildBrief, renderBriefText } from "@/engine/analyse/brief";
import { listCompanies } from "@/engine/ingest/companies";
import { parseNseDateTime } from "@/lib/time";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      hours: { type: "string", default: "24" },
      symbol: { type: "string" },
      to: { type: "string" },
      volume: { type: "string", default: "2" },
      move: { type: "string", default: "5" },
      json: { type: "boolean", default: false },
      "no-widen": { type: "boolean", default: false },
    },
  });
  const toMs = values.to
    ? parseNseDateTime(values.to.replace("T", " "))
    : Date.now();
  const fromMs = toMs - Number(values.hours) * 3_600_000;
  const companies = await listCompanies();
  const wanted = (values.symbol ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const isins = companies
    .filter(
      (c) => wanted.length === 0 || wanted.includes(c.nseSymbol.toUpperCase()),
    )
    .map((c) => c.isin);
  const t0 = Date.now();
  const brief = await buildBrief({
    isins,
    fromMs,
    toMs,
    thresholds: {
      volumeRatio: Number(values.volume),
      pricePct: Number(values.move),
    },
    autoWiden: !values["no-widen"],
  });
  if (values.json) console.log(JSON.stringify(brief, null, 2));
  else console.log(renderBriefText(brief));
  console.log(`\n(${isins.length} companies · built in ${Date.now() - t0} ms)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
