import type { Metadata } from "next";
import { after } from "next/server";
import { deskTurn } from "@/app/c/[symbol]/actions";
import { loadDeskFacts } from "@/lib/deskFacts";
import { scheduleRefreshOnVisit } from "@/lib/jobs";
import { Desk } from "@/ui/Desk";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "FINN" } };

export default async function BriefPage() {
  const now = Date.now();
  const facts = await loadDeskFacts(now);
  const refresh = await scheduleRefreshOnVisit(now);
  if (refresh) after(refresh);
  return (
    <Desk
      companies={facts.companies}
      act={facts.act}
      watch={facts.watch}
      filedAway={facts.filedAway}
      checked={facts.checked}
      onTurn={deskTurn}
    />
  );
}
