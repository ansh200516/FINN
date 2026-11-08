import Link from "next/link";
import { categoryLabel } from "@/lib/format";
import { CategoryGlyph } from "./CategoryGlyph";
import { filedStamp } from "./FilingCard";
import type { Tier3Group } from "./model";

/**
 * The fold line: "▸ 26 filed away" with one glyph + count per category,
 * expanding (native <details>, no JS) into 40 px rows grouped by category.
 */
export function Fold({ groups, now }: { groups: Tier3Group[]; now: number }) {
  const total = groups.reduce((s, g) => s + g.count, 0);
  if (!total) return null;
  return (
    <details className="mx-4 border-t border-rule">
      <summary className="row-touch flex items-center gap-3 py-2 no-callout">
        <span className="chev text-ink-3" aria-hidden="true">
          ▸
        </span>
        <span className="rowtitle text-ink">{total} filed away</span>
        <span
          className="ml-auto flex items-center gap-2 text-ink-3 meta"
          role="img"
          aria-label={`by category: ${groups
            .map((g) => `${g.count} ${categoryLabel(g.category).toLowerCase()}`)
            .join(", ")}`}
        >
          {groups.slice(0, 5).map((g) => (
            <span
              key={g.category}
              className="inline-flex items-center gap-0.5"
              aria-hidden="true"
            >
              <CategoryGlyph category={g.category} />
              <span className="num">{g.count}</span>
            </span>
          ))}
          {groups.length > 5 ? (
            <span
              aria-hidden="true"
              title={groups
                .slice(5)
                .map((g) => `${categoryLabel(g.category)} ${g.count}`)
                .join(" · ")}
            >
              +{groups.length - 5}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="pb-2">
        {groups.map((g) => (
          <section key={g.category} className="mt-2">
            <p className="eyebrow inline-flex items-center gap-1.5">
              <CategoryGlyph category={g.category} />
              {categoryLabel(g.category)}
              <span className="text-ink-2 normal-case tracking-normal">
                · {g.count}
              </span>
            </p>
            <ul className="m-0 p-0 list-none">
              {g.items.map((it) => {
                const stamp = filedStamp(it, now);
                return (
                  <li
                    key={it.eventKey}
                    className="border-b border-rule last:border-b-0"
                  >
                    <Link
                      href={`/e/${encodeURIComponent(it.eventKey)}`}
                      className="row flex items-center gap-3 py-1.5 no-callout"
                    >
                      <span className="w-[88px] shrink-0 symbol meta text-ink-2 truncate">
                        {it.symbol}
                      </span>
                      <span className="flex-1 min-w-0 small text-ink-2 truncate">
                        {it.title}
                      </span>
                      <span className="receipt shrink-0">
                        {stamp.short.split(" · ")[0]}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
