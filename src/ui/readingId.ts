/** Anchor for one pull reading on the company page. */
export function readingId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `reading-${slug}`;
}
