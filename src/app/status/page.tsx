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

export default async function StatusPage() {
  const s = await getStatus();
  const now = s.nowMs;
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
          <p className="eyebrow">Today</p>
          <p className="text-ink mt-1">
            <span className="num font-semibold">
              {formatCount(s.totals.requests)}
            </span>{" "}
            model calls ·{" "}
            <span className="num">{formatCount(s.totals.tokensIn)}</span> tokens
            in · <span className="num">{formatCount(s.totals.tokensOut)}</span>{" "}
            out
          </p>
          <p className="small text-ink-2 mt-1">
            Paid-equivalent{" "}
            <span className="num text-ink">{usd(s.totals.costUsd)}</span> at
            list prices · billed <span className="num text-ink">₹ 0</span> (free
            tier) · {s.cache.entries} cached responses never re-spent
          </p>
        </div>
      </section>

      {/* Model ledger */}
      <section className="mt-6" aria-labelledby="models">
        <TierHeader id="models" count={s.models.length}>
          Model ledger
        </TierHeader>
        <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
          {s.models.map((m) => (
            <li key={m.model} className="gutter py-2 border-b border-rule">
              <div className="flex items-center justify-between gap-3">
                <span className="mono small text-ink truncate">{m.model}</span>
                <span className="chip">
                  <span>{m.tier}</span>
                </span>
              </div>
              <div className="mt-1 grid grid-cols-4 gap-2 meta">
                <div>
                  <p className="text-ink-3">calls</p>
                  <p className="num text-ink">
                    {formatCount(m.requests)}
                    <span className="text-ink-3"> / {m.cap}</span>
                  </p>
                </div>
                <div>
                  <p className="text-ink-3">in</p>
                  <p className="num text-ink">{formatCount(m.tokensIn)}</p>
                </div>
                <div>
                  <p className="text-ink-3">
                    out{m.tokensThought ? " + think" : ""}
                  </p>
                  <p className="num text-ink">
                    {formatCount(m.tokensOut)}
                    {m.tokensThought ? (
                      <span className="text-ink-3">
                        {" "}
                        +{formatCount(m.tokensThought)}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-ink-3">cost · errors</p>
                  <p className="num text-ink">
                    {usd(m.costUsd)}
                    <span className={m.errors ? " delta-warn" : " text-ink-3"}>
                      {" "}
                      · {m.errors}
                    </span>
                  </p>
                </div>
              </div>
              <div
                className="mt-1.5 h-[3px] w-full bg-rule rounded-[1px]"
                aria-hidden="true"
              >
                <div
                  className="h-full bg-ink rounded-[1px]"
                  style={{
                    width: `${m.cap ? Math.min(100, (m.requests / m.cap) * 100) : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="gutter receipt mt-2">
          caps are 80% of the free-tier RPD (Flash 20 → 16, Flash-Lite 500 →
          400) · every attempt counts, including failures
        </p>
      </section>

      {/* Cache */}
      {s.cache.byTask.length ? (
        <section className="mt-6" aria-labelledby="cache">
          <TierHeader id="cache" count={s.cache.entries}>
            Cache by task
          </TierHeader>
          <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
            {s.cache.byTask.map((c) => (
              <li
                key={c.task}
                className="gutter row flex items-center justify-between border-b border-rule"
              >
                <span className="mono small text-ink-2">{c.task}</span>
                <span className="num small text-ink">{c.n}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Freshness */}
      <section className="mt-6" aria-labelledby="fresh">
        <TierHeader id="fresh">Data freshness</TierHeader>
        <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
          {s.freshness.map((f) => (
            <li
              key={f.table}
              className="gutter row flex items-center gap-3 border-b border-rule"
            >
              <span className="mono small text-ink w-[150px] shrink-0 truncate">
                {f.table}
              </span>
              <span className="num small text-ink-2 w-[64px] shrink-0 text-right">
                {formatCount(f.rows)}
              </span>
              <span className="receipt flex-1 text-right truncate">
                {f.newestMs
                  ? `${f.stamp} ${relativeIst(f.newestMs, now)} · ${formatIst(f.newestMs, "d MMM HH:mm")}`
                  : "empty"}
              </span>
            </li>
          ))}
        </ul>
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
