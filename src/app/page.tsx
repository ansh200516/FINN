import { redirect } from "next/navigation";

/**
 * Chat is the front door. A brief window query still opens the brief,
 * so older links such as `/?w=7d` keep working.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const w = typeof sp.w === "string" ? sp.w : "";
  const from = typeof sp.from === "string" ? sp.from : "";
  const to = typeof sp.to === "string" ? sp.to : "";
  if (w || from || to) {
    const q = new URLSearchParams();
    if (w) q.set("w", w);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    redirect(`/brief?${q.toString()}`);
  }
  redirect("/chat");
}
