import type { Metadata } from "next";
import { Desk } from "@/ui/Desk";

export const dynamic = "force-dynamic";
// The turn itself streams from /api/chat, which keeps this same cap.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <main className="flex-1">
      <Desk />
    </main>
  );
}
