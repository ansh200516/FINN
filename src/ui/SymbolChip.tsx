import Link from "next/link";

/** Ticker in Plex Sans 500 tracked +0.02em; links to the company page unless `plain`. */
export function SymbolChip({
  symbol,
  plain = false,
  className = "",
}: {
  symbol: string;
  plain?: boolean;
  className?: string;
}) {
  const inner = <span className={`symbol ${className}`}>{symbol}</span>;
  if (plain) return inner;
  return (
    <Link
      href={`/c/${encodeURIComponent(symbol)}`}
      className="hover:text-accent"
    >
      {inner}
    </Link>
  );
}
