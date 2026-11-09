import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deskTurn } from "@/app/c/[symbol]/actions";
import { loadDeskFacts } from "@/lib/deskFacts";
import { getCompanyBySymbol } from "@/lib/queries";
import { Desk } from "@/ui/Desk";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  return { title: symbol.toUpperCase() };
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const company = await getCompanyBySymbol(symbol);
  if (!company) notFound();
  const facts = await loadDeskFacts();
  return (
    <Desk
      companies={facts.companies}
      act={facts.act}
      watch={facts.watch}
      filedAway={facts.filedAway}
      checked={facts.checked}
      initialSymbol={company.nseSymbol}
      initialName={company.name}
      onTurn={deskTurn}
    />
  );
}
