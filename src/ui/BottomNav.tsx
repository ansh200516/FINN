"use client";

import { usePathname } from "next/navigation";

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

/** 56 px bar + safe area, four destinations, active = ink weight + accent dot. */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="bar-fixed bar" aria-label="Primary">
      <ul className="m-0 grid h-[var(--bar-h)] grid-cols-4 p-0 list-none">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href} className="min-w-0">
              <a
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 no-callout ${
                  active ? "text-ink" : "text-ink-3"
                }`}
              >
                <Glyph name={t.label} />
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
