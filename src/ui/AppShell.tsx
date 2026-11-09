import type { ReactNode } from "react";
import { getNavCounts } from "@/lib/queries";
import { BottomNav } from "./BottomNav";

/** 430 px column + bottom bar. The column is the phone; desktop gets hairline edges. */
export async function AppShell({ children }: { children: ReactNode }) {
  let counts = { inbox: 0, alerts: 0 };
  try {
    counts = await getNavCounts();
  } catch {
    // the shell still renders; badges are a hint, not the page
  }
  return (
    <>
      <div className="shell">{children}</div>
      <BottomNav counts={counts} />
    </>
  );
}
