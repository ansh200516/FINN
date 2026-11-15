import { redirect } from "next/navigation";

/**
 * Chat is the front door. A window query still opens the edition, so an
 * older link such as `/?w=7d` keeps that window.
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
