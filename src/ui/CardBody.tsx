import type { ResultsCard } from "@/engine/types";
import { groupIndian, humanise } from "@/lib/format";
import { formatIst } from "@/lib/time";
import type { EventCard, ManagementChangeCard } from "./model";
import { ResultsGrid } from "./ResultsGrid";

function isResultsCard(x: unknown): x is ResultsCard {
  return Boolean(
    x &&
      typeof x === "object" &&
      Array.isArray((x as ResultsCard).rows) &&
      "basis" in (x as object),
  );
}

function isMgmtCard(
  x: unknown,
): x is ManagementChangeCard & { profile_summary?: string | null } {
  return Boolean(
    x &&
      typeof x === "object" &&
      typeof (x as ManagementChangeCard).person === "string",
  );
}

function fmtDate(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatIst(s, "d MMM yyyy");
  return s;
}

const ACTION_VERB: Record<string, string> = {
  appointed: "appointed",
  resigned: "resigns",
  retired: "retires",
  ceased: "ceases",
  "re-appointed": "re-appointed",
  redesignated: "redesignated",
};

/** Management change: role · effective date · verbatim profile · prior roles · others in the filing. */
export function ManagementChangeBody({
  card,
  compact = false,
}: {
  card: ManagementChangeCard & { profile_summary?: string | null };
  compact?: boolean;
}) {
  const eff = fmtDate(card.effective_date);
  const excerpt = card.brief_profile_excerpt?.trim();
  const summary = card.profile_summary?.trim();
  const shortEff = eff && eff.length <= 14;
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="rowtitle min-w-0 flex-1">
          {card.person}
          <span className="ml-2 font-normal text-ink-2">{card.role}</span>
        </p>
        <span className="receipt whitespace-nowrap shrink-0">
          {ACTION_VERB[card.action] ?? card.action}
          {shortEff ? ` · ${eff}` : ""}
        </span>
      </div>
      {eff && !shortEff ? (
        <p className="receipt mt-0.5">effective {eff}</p>
      ) : null}
      {card.term ? (
        <p className="meta text-ink-3 mt-0.5">Term {card.term}</p>
      ) : null}
      {card.reason ? (
        <p className="small mt-1 text-ink-2">Reason stated: {card.reason}</p>
      ) : null}
      {excerpt ? (
        <blockquote className="mt-2 border-l-2 border-rule pl-3">
          <p className={`quote text-ink-2 ${compact ? "line-clamp-4" : ""}`}>
            “{excerpt}”
          </p>
          <p className="receipt mt-1">
            from the filing · brief profile (SEBI LODR Sch. III A.7.3)
            {card.confidence === "high" ? " · verbatim" : ""}
          </p>
        </blockquote>
      ) : summary ? (
        <div className="mt-2 border-l-2 border-rule pl-3">
          <p className={`small text-ink-2 ${compact ? "line-clamp-3" : ""}`}>
            {summary}
          </p>
          <p className="receipt mt-1">
            summary of the filing's brief profile · not verbatim
          </p>
        </div>
      ) : (
        <p className="small mt-2 text-ink-3">
          No profile in the filing beyond name and role.
        </p>
      )}
      {!compact && card.prior_roles?.length ? (
        <ul className="mt-2 m-0 p-0 list-none">
          {card.prior_roles.map((r) => (
            <li
              key={r}
              className="small text-ink-2 py-1 border-b border-rule last:border-b-0"
            >
              {r}
            </li>
          ))}
        </ul>
      ) : null}
      {!compact && card.others?.length ? (
        <div className="mt-3">
          <p className="eyebrow">Also in this filing</p>
          <ul className="mt-1 m-0 p-0 list-none">
            {card.others.map((o) => (
              <li
                key={`${o.person}-${o.role}`}
                className="small flex items-baseline justify-between gap-3 py-1.5 border-b border-rule last:border-b-0"
              >
                <span>
                  {o.person}
                  <span className="text-ink-2"> · {o.role}</span>
                </span>
                <span className="receipt">
                  {ACTION_VERB[o.action] ?? o.action}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!compact && card.successor ? (
        <p className="small mt-2 text-ink-2">Successor: {card.successor}</p>
      ) : null}
    </div>
  );
}

const MONEY_KEYS =
  /^(amount|consideration|value|size|premium|demand|penalty|target_turnover|turnover|revenue|price|issue_size|order_value)$/;

function formatMoney(v: number, currency: unknown, unit: unknown): string {
  const u = typeof unit === "string" ? unit.toLowerCase() : "";
  const cur = typeof currency === "string" ? currency.trim() : "";
  const isInr = !cur || /^(rs\.?|inr|₹)$/i.test(cur);
  if (/crore|cr/.test(u))
    return `${isInr ? "₹ " : `${cur} `}${groupIndian(v, Number.isInteger(v) ? 0 : 2)} cr`;
  if (/lakh/.test(u))
    return `${isInr ? "₹ " : `${cur} `}${groupIndian(v, Number.isInteger(v) ? 0 : 2)} L`;
  if (/million|mn/.test(u))
    return `${isInr ? "₹ " : `${cur} `}${groupIndian(v, Number.isInteger(v) ? 0 : 2)} mn`;
  if (isInr) return `₹ ${groupIndian(v, Number.isInteger(v) ? 0 : 2)}`;
  return `${cur} ${groupIndian(v, Number.isInteger(v) ? 0 : 2)}`;
}

function formatFieldValue(
  key: string,
  v: unknown,
  ctx: Record<string, unknown> = {},
): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (/_cr$/.test(key))
      return `₹ ${groupIndian(v, Number.isInteger(v) ? 0 : 2)} cr`;
    if (/_pct$|^pct$|percent/.test(key))
      return `${groupIndian(v, Number.isInteger(v) ? 0 : 1)}%`;
    if (/_inr$/.test(key))
      return `₹ ${groupIndian(v, Number.isInteger(v) ? 0 : 2)}`;
    if (/_bp$/.test(key)) return `${groupIndian(v, 0)} bp`;
    if (MONEY_KEYS.test(key)) return formatMoney(v, ctx.currency, ctx.unit);
    return groupIndian(v, Number.isInteger(v) ? 0 : 2);
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatIst(v, "EEE d MMM yyyy");
    return v;
  }
  if (Array.isArray(v))
    return v
      .map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)))
      .join(" · ");
  return JSON.stringify(v);
}

function fieldLabel(key: string): string {
  return humanise(
    key
      .replace(/_cr$/, " (₹ cr)")
      .replace(/_pct$/, " (%)")
      .replace(/_inr$/, " (₹)")
      .replace(/_bp$/, " (bp)")
      .replace(/_/g, " "),
  );
}

function singular(key: string): string {
  const s = humanise(key);
  return s.endsWith("ies")
    ? `${s.slice(0, -3)}y`
    : s.endsWith("s")
      ? s.slice(0, -1)
      : s;
}

/** Skip internal / derived keys: `_totals` carries model-summed amounts, which we never display. */
const HIDDEN_KEY = /^_|^(currency|unit)$/;

function PrimitiveRows({
  entries,
  ctx,
  verbatim,
}: {
  entries: Array<[string, unknown]>;
  ctx: Record<string, unknown>;
  verbatim: Set<string>;
}) {
  return (
    <dl className="m-0">
      {entries.map(([k, v]) => {
        const text = formatFieldValue(k, v, ctx);
        const long = typeof v === "string" && v.length > 28;
        return (
          <div
            key={k}
            className={`py-1.5 border-b border-rule last:border-b-0 ${long ? "" : "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4"}`}
          >
            <dt className="small text-ink-2">{fieldLabel(k)}</dt>
            <dd
              className={`small m-0 ${long ? "text-ink mt-0.5" : "num text-right text-ink max-w-[62%] justify-self-end"}`}
            >
              {text}
              {verbatim.has(k) ? (
                <span
                  className="chip ml-2 align-middle"
                  title="copied verbatim from the filing"
                >
                  <span>verbatim</span>
                </span>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Generic category payload → label/value rows. Handles the ingest's
 * list-valued fields (`deals: [{…}]`, `matters: [{…}]`), nested objects and
 * plain primitives; fields named in `verbatim` get a badge; `_totals` and
 * other derived keys are never shown.
 */
export function FieldRows({
  card,
  compact = false,
}: {
  card: Record<string, unknown>;
  compact?: boolean;
}) {
  const verbatim = new Set(
    Array.isArray(card.verbatim) ? (card.verbatim as string[]) : [],
  );
  const entries = Object.entries(card).filter(
    ([k, v]) =>
      k !== "verbatim" &&
      !HIDDEN_KEY.test(k) &&
      v !== undefined &&
      v !== null &&
      v !== "",
  );
  if (!entries.length) return null;
  const primitives = entries.filter(
    ([, v]) => typeof v !== "object" || v === null,
  );
  const lists = entries.filter(
    ([, v]) => Array.isArray(v) && v.some((x) => x && typeof x === "object"),
  );
  const objects = entries.filter(
    ([, v]) => v && typeof v === "object" && !Array.isArray(v),
  );
  const scalarArrays = entries.filter(
    ([, v]) => Array.isArray(v) && !v.some((x) => x && typeof x === "object"),
  );
  const flat: Array<[string, unknown]> = [...primitives, ...scalarArrays];
  return (
    <div className="mt-2">
      {flat.length ? (
        <PrimitiveRows
          entries={compact ? flat.slice(0, 4) : flat}
          ctx={card}
          verbatim={verbatim}
        />
      ) : null}
      {lists.map(([k, v]) => {
        const items = (v as Array<Record<string, unknown>>).filter(
          (x) =>
            x &&
            typeof x === "object" &&
            Object.entries(x).some(
              ([ik, iv]) => !HIDDEN_KEY.test(ik) && iv != null && iv !== "",
            ),
        );
        if (!items.length) return null;
        const shown = compact ? items.slice(0, 1) : items;
        return (
          <div key={k} className={flat.length ? "mt-2" : ""}>
            {shown.map((item, i) => {
              const rows = Object.entries(item).filter(
                ([ik, iv]) =>
                  !HIDDEN_KEY.test(ik) &&
                  iv !== null &&
                  iv !== undefined &&
                  iv !== "",
              );
              // items have no ids; the first two row values make a stable enough key
              const itemKey = `${k}-${rows
                .slice(0, 2)
                .map(([ik, iv]) => `${ik}=${String(iv)}`)
                .join("|")}`;
              return (
                <section key={itemKey} className="mt-1">
                  <p className="eyebrow">
                    {singular(k)}
                    {items.length > 1 ? ` ${i + 1} of ${items.length}` : ""}
                  </p>
                  <PrimitiveRows
                    entries={compact ? rows.slice(0, 4) : rows}
                    ctx={item}
                    verbatim={verbatim}
                  />
                </section>
              );
            })}
            {items.length > shown.length ? (
              <p className="receipt mt-1">
                +{items.length - shown.length} more{" "}
                {items.length - shown.length === 1
                  ? singular(k).toLowerCase()
                  : humanise(k).toLowerCase()}
              </p>
            ) : null}
          </div>
        );
      })}
      {!compact
        ? objects.map(([k, v]) => {
            const rows = Object.entries(v as Record<string, unknown>).filter(
              ([ik, iv]) => !HIDDEN_KEY.test(ik) && iv != null && iv !== "",
            );
            if (!rows.length) return null;
            return (
              <section key={k} className="mt-2">
                <p className="eyebrow">{humanise(k)}</p>
                <PrimitiveRows
                  entries={rows}
                  ctx={v as Record<string, unknown>}
                  verbatim={verbatim}
                />
              </section>
            );
          })
        : null}
    </div>
  );
}

/** Picks the body renderer for a card by its payload shape. */
export function CardBody({
  event,
  compact = false,
  periodEnd,
  components,
}: {
  event: EventCard;
  compact?: boolean;
  periodEnd?: string | null;
  components?: {
    pbt?: number | null;
    fin?: number | null;
    dna?: number | null;
    oi?: number | null;
  };
}) {
  const c = event.card;
  if (isResultsCard(c)) {
    return (
      <div className="mt-3">
        <ResultsGrid
          card={c}
          periodEnd={periodEnd}
          withSpark
          showMeta={!compact}
          components={components}
        />
      </div>
    );
  }
  if (isMgmtCard(c)) return <ManagementChangeBody card={c} compact={compact} />;
  if (
    c &&
    typeof c === "object" &&
    !Array.isArray(c) &&
    Object.keys(c as object).length
  )
    return <FieldRows card={c as Record<string, unknown>} compact={compact} />;
  return null;
}
