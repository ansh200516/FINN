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
        <h1 className="mt-3 text-[20px] font-light tracking-wide text-ink">
          Ask when you want to.
        </h1>
        <p className="mt-2 max-w-[28ch] text-sm font-light leading-relaxed text-ink-2">
          The brief and the company page stay put.
        </p>
      </header>
      <Desk
        companies={facts.companies}
        act={facts.act}
        watch={facts.watch}
        filedAway={facts.filedAway}
        checked={facts.checked}
        onTurn={deskTurn}
      />
    </main>
  );
}
