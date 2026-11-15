import type { CSSProperties } from "react";
import type { ResultsCard } from "@/engine/types";
import { groupIndian, humanise } from "@/lib/format";
import { repairPdfWords } from "@/lib/pdfWords";
import { formatIst } from "@/lib/time";
import type { EventCard, ManagementChangeCard } from "./model";
import { actionVerb, mergePeople, type PersonChange, peopleOf } from "./people";
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

/**
 * Brief profile, clamped to ~3 lines with a native "Read full profile"
 * expander (the summary is the text itself; no JS). `verbatim` marks a
 * filing-verbatim excerpt; otherwise it is labelled as a summary.
 */
function ProfileExcerpt({
  text,
  verbatim,
  lines = 3,
  expandable = true,
}: {
  text: string;
  verbatim: boolean;
  lines?: number;
  expandable?: boolean;
}) {
  const badge = verbatim
    ? "from the filing · SEBI LODR Sch. III A.7.3 · verbatim"
    : "from the filing · SEBI LODR Sch. III A.7.3 · summarised";
  const shown = repairPdfWords(text);
  // ~3 lines of 15 px serif in a 430 px column ≈ 180 characters
  const needsMore = shown.length > lines * 62;
  if (!expandable || !needsMore) {
    const clamp = expandable
      ? ""
      : lines <= 2
        ? "line-clamp-2"
        : "line-clamp-3";
    return (
      <blockquote className="mt-1.5 border-l-2 border-rule pl-3">
        <p className={`quote text-ink-2 ${clamp}`}>“{shown}”</p>
        <p className="receipt mt-1 text-[10px] leading-[14px]">{badge}</p>
      </blockquote>
    );
  }
  const vars = { "--xp-lines": String(lines) } as CSSProperties;
  return (
    <blockquote className="mt-1.5 border-l-2 border-rule pl-3">
      <details className="xp" style={vars}>
        <summary className="no-callout">
          <span className="xp-text quote text-ink-2">“{shown}”</span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0">
            <span className="xp-more receipt text-accent whitespace-nowrap shrink-0" />
            <span className="receipt text-[10px] leading-[14px]">{badge}</span>
          </span>
        </summary>
      </details>
    </blockquote>
  );
}

function PersonRow({
  p,
  compact,
  showExcerpt,
}: {
  p: PersonChange;
  compact: boolean;
  showExcerpt: boolean;
}) {
  const verb = actionVerb(p.action);
  const eff = p.effectiveDate;
  const shortEff = eff && eff.length <= 14;
  return (
    <li className="py-2 border-b border-rule last:border-b-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="rowtitle min-w-0 flex-1 text-ink">{p.person}</p>
        <span className="receipt whitespace-nowrap shrink-0">
          {verb}
          {shortEff ? ` · ${eff}` : ""}
        </span>
      </div>
      {p.role ? <p className="small text-ink-2">{p.role}</p> : null}
      {eff && !shortEff ? (
        <p className="receipt mt-0.5">effective {eff}</p>
      ) : null}
      {!compact && p.reason ? (
        <p className="small mt-1 text-ink-2">Reason stated: {p.reason}</p>
      ) : null}
      {!compact && p.successor ? (
        <p className="small mt-0.5 text-ink-2">
          Successor <span aria-hidden="true">→</span> {p.successor}
        </p>
      ) : null}
      {showExcerpt && p.excerpt ? (
        <ProfileExcerpt
          text={p.excerpt}
          verbatim={p.confidence !== "medium"}
          lines={compact ? 2 : 3}
          expandable={!compact}
        />
      ) : null}
      {!compact && p.priorRoles.length ? (
        <ul className="mt-1.5 m-0 p-0 list-none">
          {p.priorRoles.map((r) => (
            <li key={r} className="meta text-ink-2 py-0.5">
              · {r}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Management change as per-person rows — name · role · action · effective
 * date, each with the filing's brief profile (clamped, expandable). Reads
 * `people[]` when the engine supplies it, else carves the single excerpt at
 * the duplicated-name headings; `others[]` fill in roles for carved people.
 */
export function ManagementChangeBody({
  card,
  compact = false,
  extraPeople,
}: {
  card: ManagementChangeCard & { profile_summary?: string | null };
  compact?: boolean;
  /** people read from the event's filing subjects (detail page) — fills roles, dates and the rest of the annexure */
  extraPeople?: PersonChange[];
}) {
  const people = extraPeople?.length
    ? mergePeople(peopleOf(card), extraPeople)
    : peopleOf(card);
  const summary = card.profile_summary?.trim();
  const shown = compact ? people.slice(0, 3) : people;
  // the brief card shows one profile only — the first person who has one
  const firstWithExcerpt = people.findIndex((p) => p.excerpt);
  const anyExcerpt = firstWithExcerpt >= 0;
  return (
    <div className="mt-2">
      <ul className="m-0 p-0 list-none">
        {shown.map((p, i) => (
          <PersonRow
            key={`${p.person}-${p.role ?? ""}-${p.action ?? ""}`}
            p={p}
            compact={compact}
            showExcerpt={!compact || i === firstWithExcerpt}
          />
        ))}
      </ul>
      {compact && people.length > shown.length ? (
        <p className="receipt mt-1">
          +{people.length - shown.length} more named in the filing
        </p>
      ) : null}
      {!anyExcerpt ? (
        summary ? (
          <div className="mt-2 border-l-2 border-rule pl-3">
            <p className={`small text-ink-2 ${compact ? "line-clamp-3" : ""}`}>
              {repairPdfWords(summary)}
            </p>
            <p className="receipt mt-1 text-[10px] leading-[14px]">
              summary of the filing's brief profile · not verbatim
            </p>
          </div>
        ) : (
          <p className="receipt mt-1">
            no brief profile in the filing beyond name and role
          </p>
        )
      ) : null}
      {!compact && card.term ? (
        <p className="meta text-ink-3 mt-2">Term {card.term}</p>
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
  extraPeople,
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
  /** management change: people parsed from the filing subjects */
  extraPeople?: PersonChange[];
}) {
  const c = event.card;
  if (isResultsCard(c)) {
    return (
      <div className="mt-3">
        <ResultsGrid
          card={c}
          periodEnd={periodEnd}
          filingTitle={event.title}
          withSpark
          showMeta={!compact}
          compactMeta={compact}
          components={components}
        />
      </div>
    );
  }
  if (isMgmtCard(c))
    return (
      <ManagementChangeBody
        card={c}
        compact={compact}
        extraPeople={extraPeople}
      />
    );
  if (
    c &&
    typeof c === "object" &&
    !Array.isArray(c) &&
    Object.keys(c as object).length
  )
    return <FieldRows card={c as Record<string, unknown>} compact={compact} />;
  return null;
}
