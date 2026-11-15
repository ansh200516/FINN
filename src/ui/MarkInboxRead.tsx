"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the nav badge after the server has marked the inbox read. */
export function MarkInboxRead() {
  const router = useRouter();
  useEffect(() => {
    const id = window.setTimeout(() => router.refresh(), 0);
    return () => window.clearTimeout(id);
  }, [router]);
  return null;
}
