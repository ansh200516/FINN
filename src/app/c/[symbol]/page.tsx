import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCompanyBySymbol } from "@/lib/queries";
import { CompanyThread } from "@/ui/CompanyThread";

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
  return <CompanyThread symbol={company.nseSymbol} name={company.name} />;
}
