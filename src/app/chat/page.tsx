import type { Metadata } from "next";
import { Desk } from "@/ui/Desk";
import { finnieTurn } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <main className="flex-1">
      <Desk onTurn={finnieTurn} />
    </main>
  );
}
