import type { Metadata } from "next";
import Link from "next/link";
import { markInboxRead } from "@/app/inbox/actions";
import { getInbox } from "@/lib/queries";
import { formatIst } from "@/lib/time";
import { Empty } from "@/ui/Empty";
import { MarkInboxRead } from "@/ui/MarkInboxRead";
import { TierHeader } from "@/ui/TierHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

const KIND_LABEL: Record<string, string> = {
  tripwire: "Tripwire",
  announcement: "Filing",
  anomaly: "End of day",
  digest: "Edition",
};

function Channel({ name, status }: { name: string; status: string }) {
  const ok = status === "sent";
  const label = name === "webpush" ? "push" : name;
  return (
    <span
      className={`chip ${ok ? "chip-up" : status.startsWith("failed") ? "chip-down" : ""}`}
      title={`${label}: ${status}`}
    >
      <span aria-hidden="true">{ok ? "✓" : "✕"}</span>
      <span>{label}</span>
    </span>
  );
}

export default async function InboxPage() {
  await markInboxRead();
  const items = await getInbox();
  const unread = items.filter((i) => !i.readAt).length;
  const byDay = new Map<string, typeof items>();
  for (const it of items) {
    const key = formatIst(it.firedAtMs, "EEEE d MMMM");
    const l = byDay.get(key) ?? [];
    l.push(it);
    byDay.set(key, l);
  }

  return (
    <main className="flex-1 pb-8">
      <MarkInboxRead />
      <header data-tour="inbox" className="gutter pt-5">
        <p className="eyebrow reveal">Inbox</p>
        <h1
          className="dateline text-ink mt-1 reveal"
          style={{ animationDelay: "60ms" }}
        >
          {items.length
            ? unread
              ? `${unread} unread.`
              : "All read."
            : "Nothing delivered yet."}
        </h1>
        <p className="receipt mt-2 reveal" style={{ animationDelay: "120ms" }}>
          every alert lands here first · push and Telegram are delivery hints,
          the inbox is the record
        </p>
      </header>

      {!items.length ? (
        <div className="gutter mt-6">
          <Empty
            title="Quiet so far"
            reason="Alerts fire when a filing matches a category you watch, or when a close trips your volume or price rule. Each one will carry the rule that fired."
          >
            <Link
              href="/alerts"
              className="hit inline-flex items-center text-accent small"
            >
              Review the rules →
            </Link>
          </Empty>
        </div>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day} className="mt-6">
            <TierHeader>{day}</TierHeader>
            <ul className="m-0 mt-2 p-0 list-none border-t border-rule">
              {list.map((it) => {
                const body = (
                  <>
                    <div className="flex items-center justify-between gap-3 meta">
                      <span className="text-ink-3">
                        {KIND_LABEL[it.kind] ?? it.kind}
                        {it.symbol ? (
                          <span className="symbol ml-2">{it.symbol}</span>
                        ) : null}
                      </span>
                      <span className="receipt">
                        {formatIst(it.firedAtMs, "HH:mm")} IST
                      </span>
                    </div>
                    <p
                      className={`mt-1 ${it.readAt ? "small text-ink-2" : "rowtitle text-ink"}`}
                    >
                      {it.title}
                    </p>
                    {it.body ? (
                      <p className="small text-ink-2 mt-0.5">{it.body}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {Object.entries(it.deliveredVia).map(([k, v]) => (
                        <Channel key={k} name={k} status={v} />
                      ))}
                      {it.because ? (
                        <span className="receipt">· because {it.because}</span>
                      ) : null}
                    </div>
                  </>
                );
                return (
                  <li
                    key={it.id}
                    className={`border-b border-rule ${it.readAt ? "" : "border-l-2 border-l-ink"}`}
                  >
                    {it.href ? (
                      <Link
                        href={it.href}
                        className="block gutter py-3 no-callout"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="gutter py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
