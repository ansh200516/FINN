export const dynamic = "force-dynamic";

export default function StatusPage() {
  return (
    <main className="flex-1 px-4 py-6">
      <p className="eyebrow">Status</p>
      <h1 className="mt-1 text-[length:var(--fs-headline)] font-semibold">
        FINN
      </h1>
      <p className="receipt mt-2">
        model ledger · cache hit rate · job runs — coming
      </p>
    </main>
  );
}
