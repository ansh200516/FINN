import Link from "next/link";

/** Ticker in IBM Plex Sans, tracked; links to the company page unless `plain`. */
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
