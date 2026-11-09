import type { PullBlock } from "@/lib/pull";
import { NOT_IN_FILINGS } from "@/lib/pull";
import { readingId } from "./readingId";
import { SectionAccordion } from "./SectionAccordion";
import { TierHeader } from "./TierHeader";

/**
 * The eight readings, under the promise ledger. The index that jumps here
 * sits under the price. One accordion per output: the collapsed verdict is
 * the reading; the body is the page or the XBRL row.
 */
export function PullMenu({ blocks }: { blocks: PullBlock[] }) {
  return (
    <section
      className="mt-6 border-t border-rule"
      aria-labelledby="pull-h"
      id="pull"
    >
      <div className="pt-4">
        <TierHeader id="pull-h">From the filings</TierHeader>
        <p className="gutter receipt mt-1 mb-2">
          Annual report and exchange results. Open a line. If the source is
          silent, it says so.
        </p>
      </div>
      {blocks.map((block) => (
        <SectionAccordion
          key={block.title}
          id={readingId(block.title)}
          title={block.title}
          verdict={block.verdict}
        >
          <PullBody block={block} />
        </SectionAccordion>
      ))}
    </section>
  );
}

/** A management sentence, not a statement line or an XBRL label. */
function proseQuote(q: string): boolean {
  const words = q.split(/\s+/).filter((w) => /[A-Za-z]{4}/.test(w));
  return words.length >= 8;
}

/** One reading, open: the same body the filings menu shows after a tap. */
export function PullReading({ block }: { block: PullBlock }) {
  return (
    <div>
      <p className="eyebrow">{block.title}</p>
      {block.verdict ? (
        <p className="small text-ink mt-1">{block.verdict}</p>
      ) : null}
      <div className="mt-2">
        <PullBody block={block} />
      </div>
    </div>
  );
}

function PullBody({ block }: { block: PullBlock }) {
  const silent = block.lines.length === 1 && block.lines[0] === NOT_IN_FILINGS;
  return (
    <div>
      {block.lines.map((line) => (
        <p key={line} className="small text-ink mt-2">
          {line}
        </p>
      ))}
      {block.table ? (
        <table className="w-full text-left mt-2">
          <thead>
            <tr>
              {block.table.headers.map((h) => (
                <th key={h || "item"} className="receipt font-normal py-1 pr-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row) => (
              <tr key={row.join("|")} className="border-t border-rule">
                {row.map((cell, i) => (
                  <td
                    key={`${row[0]}-${i}`}
                    className={`small py-1 pr-2 align-top ${i === 0 ? "text-ink-2" : "num text-ink"}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {silent ? null : (
        <ul className="m-0 mt-3 p-0 list-none">
          {block.cites.map((c) => (
            <li key={`${c.label}-${c.quote ?? ""}`} className="mt-3">
              {c.quote && proseQuote(c.quote) ? (
                <blockquote className="quote text-ink border-l-2 border-ink pl-3">
                  {c.quote}
                </blockquote>
              ) : null}
              <p className="receipt mt-1">
                {c.href ? (
                  <a
                    href={c.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent"
                  >
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
