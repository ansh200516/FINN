import type { Metadata } from "next";
import { formatCount, relativeIst } from "@/lib/format";
import { getStatus } from "@/lib/queries";
import { formatIst } from "@/lib/time";
import { TierHeader } from "@/ui/TierHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Status" };

function usd(x: number): string {
  if (x === 0) return "$0";
  if (x < 0.01) return "<$0.01";
  return `$${x.toFixed(2)}`;
}

/** Token counts for a 52 px column: 1,33,831 → "1.34 L", 20,419 → "20.4 K", 931 → "931". */
function tokens(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(n < 1e8 ? 2 : 1)} cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(n < 1e6 ? 2 : 1)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)} K`;
  return formatCount(n);
}

function shortModel(m: string): { name: string; version: string } {
  // "gemini-3.5-flash-lite" → "flash-lite" / "gemini 3.5"; "gemma-4-26b-a4b-it" → "gemma 4" / "26b-a4b-it"
  const parts = m.split("-");
  const family = parts[0] ?? m;
  const version = parts[1] ?? "";
  if (family === "gemma")
    return {
      name: `gemma ${version}`.trim(),
      version: parts.slice(2).join("-"),
    };
  return {
    name: parts.slice(2).join("-") || m,
    version: `${family} ${version}`.trim(),
  };
}

export default async function StatusPage() {
  const s = await getStatus();
  const now = s.nowMs;
  const used = s.models.filter((m) => m.requests > 0);
  const idle = s.models.filter((m) => m.requests === 0);
  return (
    <main className="flex-1 pb-8">
      <header className="gutter pt-5">
        <p className="eyebrow reveal">Status</p>
        <h1
          className="dateline text-ink mt-1 reveal"
          style={{ animationDelay: "60ms" }}
        >
          {s.dbOk ? "Running on cached filings." : "Database unreachable."}
        </h1>
        <p className="receipt mt-2 reveal" style={{ animationDelay: "120ms" }}>
          {formatIst(now, "EEE d MMM HH:mm")} IST · quota day {s.datePt} (resets
          13:30 IST) · db {s.dbOk ? "ok" : "down"}
          {s.fixtureRows
            ? ` · fixture rows present (${formatCount(s.fixtureRows)} prices)`
            : ""}
        </p>
      </header>

      {/* Cost line */}
      <section className="gutter mt-5">
        <div className="card px-4 py-3">
          <p className="eyebrow">Today · model spend</p>
          <div className="mt-1 grid grid-cols-3 gap-3">
            <div>
              <p className="num-lg num text-ink">
                {formatCount(s.totals.requests)}
              </p>
              <p className="meta text-ink-3">model calls</p>
            </div>
            <div>
              <p className="num-lg num text-ink">₹ 0</p>
              <p className="meta text-ink-3">billed · free tier</p>
            </div>
            <div>
              <p className="num-lg num text-ink">{usd(s.totals.costUsd)}</p>
              <p className="meta text-ink-3">paid-equivalent</p>
            </div>
          </div>
          <p className="receipt mt-2">
            {tokens(s.totals.tokensIn)} tokens in · {tokens(s.totals.tokensOut)}{" "}
            out · {formatCount(s.cache.entries)} cached responses, free on
            re-use
          </p>
        </div>
      </section>

      {/* Model ledger */}
      <section className="mt-6" aria-labelledby="models">
        <TierHeader id="models" count={s.models.length}>
          Model ledger
        </TierHeader>
        <div className="gutter mt-2">
          <table
            className="ltable"
            aria-label="Model calls today against the daily cap"
          >
            <colgroup>
              <col />
              <col style={{ width: 66 }} />
              <col style={{ width: 54 }} />
              <col style={{ width: 54 }} />
              <col style={{ width: 48 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th
                  scope="col"
                  title="requests today / 80 % of the free-tier daily cap"
                >
                  Calls
                </th>
                <th scope="col">In</th>
                <th scope="col">Out</th>
                <th scope="col" title="paid-equivalent at list price">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {[...used, ...idle].map((m) => {
                const sm = shortModel(m.model);
                const share = m.cap ? Math.min(1, m.requests / m.cap) : 0;
                return (
                  <tr key={m.model} className={m.requests ? "" : "text-ink-3"}>
                    <td className="!whitespace-normal pr-2">
                      <span
                        className="mono small text-ink block truncate"
                        title={m.model}
                      >
                        {sm.name}
                      </span>
                      <span className="meta text-ink-3 block">
                        {sm.version} · {m.tier}
                        {m.errors ? (
                          <span className="delta-warn">
                            {" "}
                            · {m.errors} {m.errors === 1 ? "error" : "errors"}
                          </span>
                        ) : null}
                      </span>
                      <span className="meter mt-1 block" aria-hidden="true">
                        <i
                          className={share >= 0.8 ? "hot" : ""}
                          style={{ width: `${Math.round(share * 100)}%` }}
                        />
                      </span>
                    </td>
                    <td className="small">
                      <span className="text-ink">
                        {formatCount(m.requests)}
                      </span>
                      <span className="text-ink-3">/{m.cap}</span>
                    </td>
                    <td className="small text-ink">{tokens(m.tokensIn)}</td>
                    <td className="small text-ink">
                      {tokens(m.tokensOut)}
                      {m.tokensThought ? (
                        <span
                          className="block meta text-ink-3"
                          title="thinking tokens, billed as output"
                        >
                          +{tokens(m.tokensThought)}
                        </span>
                      ) : null}
                    </td>
                    <td className="small text-ink">{usd(m.costUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="small text-ink-2">Today</td>
                <td className="small text-ink">
                  {formatCount(s.totals.requests)}
                </td>
                <td className="small text-ink">{tokens(s.totals.tokensIn)}</td>
                <td className="small text-ink">{tokens(s.totals.tokensOut)}</td>
                <td className="small text-ink">{usd(s.totals.costUsd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="gutter receipt mt-2">
          caps are 80% of the free-tier RPD (Flash 20 → 16, Flash-Lite 500 →
          400) · every attempt counts, including failures · thinking tokens
          shown as +n under out
        </p>
      </section>

      {/* Cache */}
      <section className="mt-6" aria-labelledby="cache">
        <TierHeader id="cache" count={s.cache.entries}>
          Response cache
        </TierHeader>
        <div className="gutter mt-2">
          {s.cache.byTask.length ? (
            <ul className="m-0 p-0 list-none flex flex-wrap gap-x-2 gap-y-1.5">
              {s.cache.byTask.map((c) => (
                <li key={c.task} className="chip">
                  <span>{c.task.replace(/_/g, " ")}</span>
                  <span className="num text-ink">{formatCount(c.n)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small text-ink-2">
              Nothing cached yet — the first model call for each prompt fills
              it.
            </p>
          )}
          <p className="receipt mt-2">
            keyed by prompt version + input · a hit costs nothing and counts
            against no cap
          </p>
        </div>
      </section>

      {/* Freshness */}
      <section className="mt-6" aria-labelledby="fresh">
        <TierHeader id="fresh" count={s.freshness.length}>
          Data freshness
        </TierHeader>
        <div className="gutter mt-2">
          <table
            className="ltable"
            aria-label="Rows and newest timestamp per table"
          >
            <colgroup>
              <col />
              <col style={{ width: 64 }} />
              <col style={{ width: 150 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Rows</th>
                <th scope="col">Newest</th>
              </tr>
            </thead>
            <tbody>
              {s.freshness.map((f) => (
                <tr key={f.table} className={f.rows ? "" : "text-ink-3"}>
                  <td className="mono small text-ink truncate">
                    {f.table.replace(/_/g, " ")}
                  </td>
                  <td className="small text-ink">{formatCount(f.rows)}</td>
                  <td className="small">
                    {f.newestMs ? (
                      <>
                        <span className="text-ink block">
                          {f.stamp} {relativeIst(f.newestMs, now)}
                        </span>
                        <span className="meta text-ink-3 block">
                          {formatIst(f.newestMs, "EEE d MMM HH:mm")} IST
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-3">empty</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Jobs */}
      <section className="mt-6" aria-labelledby="jobs">
        <TierHeader id="jobs" count={s.jobs.length}>
          Recent jobs
        </TierHeader>
        {s.jobs.length ? (
          <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
            {s.jobs.map((j) => (
              <li
                key={j.id}
                className="gutter row flex items-center gap-3 border-b border-rule"
              >
                <span className="mono small text-ink w-[120px] shrink-0 truncate">
                  {j.kind}
                  {j.isin ? (
                    <span className="text-ink-3"> · {j.isin.slice(0, 6)}…</span>
                  ) : null}
                </span>
                <span
                  className={`small ${j.state === "failed" ? "delta-down" : j.state === "done" ? "text-ink-2" : "text-accent"}`}
                >
                  {j.state}
                  <span className="text-ink-3">
                    {" "}
                    · {j.step.replace(/_/g, " ")}
                  </span>
                </span>
                <span className="receipt flex-1 text-right">
                  {relativeIst(j.updatedAt, now)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gutter small text-ink-2 mt-2">No jobs have run yet.</p>
        )}
      </section>

      <p className="gutter receipt mt-6">
        routing: rules → Gemma / Flash-Lite for bulk extraction → Flash
        (thinking) only for adjudication prose and Ask · price basis: Flash-Lite
        $0.30 / $2.50 per 1M tokens, Flash $0.75 / $3.75, Gemma free
      </p>
    </main>
  );
}
