"use client";

import { Bell, Feather, Inbox, LineChart } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  {
    href: "/",
    label: "Desk",
    icon: LineChart,
    match: (p: string) => p === "/",
  },
  {
    href: "/c",
    label: "Companies",
    icon: Feather,
    match: (p: string) => p === "/c" || p.startsWith("/c/"),
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: Bell,
    match: (p: string) => p.startsWith("/alerts"),
  },
  {
    href: "/inbox",
    label: "Inbox",
    icon: Inbox,
    match: (p: string) => p.startsWith("/inbox"),
  },
];

/** The dashboard bar, collapsed to icons so a 390px screen does not scroll sideways. */
export function TopBar() {
  const pathname = usePathname() ?? "/";
  const symbol = pathname.match(/^\/c\/([^/]+)/)?.[1]?.toUpperCase() ?? null;
  const section =
    NAV.find((item) => item.match(pathname))?.label ??
    (pathname.startsWith("/e/") ? "Filing" : "FINN");

  return (
    <nav className="flex h-14 shrink-0 items-center gap-2 border-b border-white/5 bg-black/40 px-3 backdrop-blur-md">
      <Link
        href="/"
        className="shrink-0 text-sm font-light tracking-widest text-zinc-100 uppercase"
      >
        FINN
      </Link>
      <div className="flex min-w-0 items-center gap-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const on = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? "page" : undefined}
              title={item.label}
              className={`flex h-8 w-8 items-center justify-center rounded-md ${
                on
                  ? "bg-white/5 text-white/90"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{item.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="ml-auto flex min-w-0 items-center rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
        {symbol ? (
          <span className="truncate font-mono text-sm font-medium text-cyan-300">
            {symbol}
          </span>
        ) : (
          <span className="truncate text-sm font-light text-zinc-400">
            {section}
          </span>
        )}
      </div>
    </nav>
  );
}
