import type { Metadata } from "next";
import { Desk } from "@/ui/Desk";
import { finnieTurn } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <main className="flex-1">
      <header className="gutter pt-4">
        <div className="flex items-center gap-3">
          <span className="live-dot" aria-hidden="true" />
          <p className="eyebrow text-ink">Chat</p>
        </div>
      </header>
      <Desk onTurn={finnieTurn} />
    </main>
  );
}
