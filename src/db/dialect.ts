/** `postgres://` and `postgresql://` are Postgres. `file:` and `libsql:` stay libSQL. */
export function isPostgresUrl(url: string | undefined): boolean {
  return typeof url === "string" && /^postgres(ql)?:\/\//i.test(url);
}

/**
 * Supavisor transaction mode (port 6543) drops the reply when postgres.js
 * pipelines a second query, and the caller waits forever while the backend
 * sits idle. Session mode on the same pooler host keeps one backend for the
 * life of the connection, so that reply comes back. Same user, same password.
 * Anything that is not a Supavisor transaction URL is returned unchanged.
 */
export function sessionPoolerUrl(url: string): string {
  const m = /^(postgres(?:ql)?:\/\/[^@/]+@([^:/?#]+)):6543(?=[/?]|$)/i.exec(
    url,
  );
  if (!m) return url;
  const host = (m[2] ?? "").toLowerCase();
  if (!host.endsWith(".pooler.supabase.com")) return url;
  return `${m[1]}:5432${url.slice(m[0].length)}`;
}
