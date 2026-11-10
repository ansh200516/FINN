import type { Metadata } from "next";
import { deskTurn } from "@/app/c/[symbol]/actions";
import { loadDeskFacts } from "@/lib/deskFacts";
import { Desk } from "@/ui/Desk";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  const facts = await loadDeskFacts();
  return (
    <main className="flex-1">
      <header className="gutter pt-4">
        <div className="flex items-center gap-3">
          <span className="live-dot" aria-hidden="true" />
          <p className="eyebrow text-ink">Chat</p>
        </div>
      </header>
      <Desk
        companies={facts.companies}
        portfolio={facts.portfolio}
        act={facts.act}
        watch={facts.watch}
        filedAway={facts.filedAway}
        checked={facts.checked}
        onTurn={deskTurn}
      />
    </main>
  );
}
