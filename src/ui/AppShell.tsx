import type { ReactNode } from "react";
import { TopBar } from "./TopBar";

/** Dashboard frame: a top bar, then one column. The desk fills the rest. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
      <TopBar />
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
