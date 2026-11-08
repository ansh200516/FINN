import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

/** 430 px column + bottom bar. The column is the phone; desktop gets hairline edges. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="shell">{children}</div>
      <BottomNav />
    </>
  );
}
