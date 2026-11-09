"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  formatNavCount,
  hasNotedAlertsVisit,
  subscribeAlertsVisit,
} from "./navCount";

function Glyph({ name }: { name: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "Brief":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3.5 3.5h13v13h-13zM6 7h8M6 10h8M6 13h5" />
        </svg>
      );
    case "Companies":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 17V8l4-2.5V17M7 17V5l5 2.5V17M12 17V9l5-2v10M2.5 17h15" />
        </svg>
      );
    case "Alerts":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 13.5h14l-2-3v-3a5 5 0 0 0-10 0v3zM8 16a2 2 0 0 0 4 0" />
        </svg>
      );
    default:
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 10.5l3-6h8l3 6v5H3zM3 10.5h4.5l1 2h3l1-2H17" />
        </svg>
      );
  }
}

const TABS = [
  {
    href: "/",
    label: "Brief",
    match: (p: string) => p === "/" || p.startsWith("/e/"),
  },
  {
    href: "/c",
    label: "Companies",
    match: (p: string) => p === "/c" || p.startsWith("/c/") || p === "/add",
  },
  {
    href: "/alerts",
    label: "Alerts",
    match: (p: string) => p.startsWith("/alerts"),
  },
  {
    href: "/inbox",
    label: "Inbox",
    match: (p: string) => p.startsWith("/inbox"),
  },
];

function tabCount(
  label: string,
  counts: { inbox: number; alerts: number },
  path: string,
  noted: boolean,
): number {
  if (label === "Inbox") return counts.inbox;
  if (label === "Alerts") {
    if (noted || path.startsWith("/alerts")) return 0;
    return counts.alerts;
  }
  return 0;
}

function badgeLabel(label: string, n: number): string | undefined {
  if (n <= 0) return undefined;
  if (label === "Inbox") return `Inbox, ${n} unread`;
  if (label === "Alerts") return `Alerts, ${n} new`;
  return undefined;
}

/** 56 px bar + safe area. Alerts and Inbox carry a count on the icon. */
export function BottomNav({
  counts,
}: {
  counts: { inbox: number; alerts: number };
}) {
  const pathname = usePathname() ?? "/";
  const [noted, setNoted] = useState(false);
  useEffect(() => {
    if (hasNotedAlertsVisit()) setNoted(true);
    return subscribeAlertsVisit(() => setNoted(true));
  }, []);

  return (
    <nav className="bar-fixed bar" aria-label="Primary">
      <ul className="m-0 grid h-[var(--bar-h)] list-none grid-cols-4 p-0">
        {TABS.map((t) => {
          const active = t.match(pathname);
          const n = tabCount(t.label, counts, pathname, noted);
          const badge = formatNavCount(n);
          const aria = badgeLabel(t.label, n);
          return (
            <li key={t.href} className="min-w-0">
              <a
                href={t.href}
                aria-current={active ? "page" : undefined}
                aria-label={aria}
                className={`no-callout flex h-full flex-col items-center justify-center gap-0.5 ${
                  active ? "text-ink" : "text-ink-3"
                }`}
              >
                <span className="relative inline-flex">
                  <Glyph name={t.label} />
                  {badge ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 -right-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 font-mono text-[11px] font-medium leading-none text-bg"
                    >
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span className={`meta ${active ? "font-semibold" : ""}`}>
                  {t.label}
                </span>
                <span
                  className={`block h-[3px] w-[3px] rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
                  aria-hidden="true"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
