export default async function CompanyPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return (
    <main className="flex-1 px-4 py-6">
      <p className="eyebrow">Company</p>
      <h1 className="mt-1 text-[length:var(--fs-headline)] font-semibold">
        FINN · {symbol.toUpperCase()}
      </h1>
    </main>
  );
}
