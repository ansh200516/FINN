/** `postgres://` and `postgresql://` are Postgres. `file:` and `libsql:` stay libSQL. */
export function isPostgresUrl(url: string | undefined): boolean {
  return typeof url === "string" && /^postgres(ql)?:\/\//i.test(url);
}
