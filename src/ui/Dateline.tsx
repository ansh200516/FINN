import type { ReactNode } from "react";

/**
 * Eyebrow (mono caps) · sans dateline sentence · deck line.
 * The dateline is the editor's verdict, ≤ 8 words; the deck is mono meta.
 */
export function Dateline({
  eyebrow,
  children,
  deck,
  note,
  className = "",
}: {
  eyebrow: string;
  children: ReactNode;
  deck?: ReactNode;
  /** optional one-line explanation (auto-widened window, holiday) */
  note?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`gutter pt-5 ${className}`}>
      <p className="eyebrow reveal">{eyebrow}</p>
      <h1
        className="dateline mt-1 text-ink reveal"
        style={{ animationDelay: "60ms" }}
      >
        {children}
      </h1>
      {deck ? (
        <p
          className="receipt mt-2 text-ink-2 reveal"
          style={{ animationDelay: "120ms" }}
          aria-live="polite"
        >
          {deck}
        </p>
      ) : null}
      {note ? (
        <p
          className="small mt-2 text-ink-2 reveal"
          style={{ animationDelay: "160ms" }}
        >
          {note}
        </p>
      ) : null}
    </header>
  );
}
