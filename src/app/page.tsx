import Link from "next/link";

export default function BriefPage() {
  return (
    <main className="flex-1 px-4 py-6">
      <p className="eyebrow">Brief</p>
      <h1 className="mt-1 text-[length:var(--fs-dateline)] leading-[var(--lh-dateline)] font-medium">
        FINN
      </h1>
      <p className="mt-2 text-ink-2">
        A brief that remembers what management promised.
      </p>
      <nav className="mt-6 flex flex-col gap-2 text-accent">
        <Link href="/c/RELIANCE">/c/RELIANCE</Link>
        <Link href="/alerts">/alerts</Link>
        <Link href="/inbox">/inbox</Link>
        <Link href="/add">/add</Link>
        <Link href="/status">/status</Link>
      </nav>
    </main>
  );
}
