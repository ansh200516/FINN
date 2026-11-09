/**
 * Nav badges. Inbox and Alerts share the `alerts` table, so the two figures
 * must be computed apart: unread rows, and unseen rule firings.
 * Display hides 0 and caps at 9+.
 */

let alertsVisitNoted = false;
const visitListeners = new Set<() => void>();

export function formatNavCount(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const whole = Math.trunc(n);
  if (whole <= 0) return null;
  return whole > 9 ? "9+" : String(whole);
}

export function hasNotedAlertsVisit(): boolean {
  return alertsVisitNoted;
}

/** Call after the alerts page has recorded the visit. Layout state listens. */
export function noteAlertsVisit(): void {
  alertsVisitNoted = true;
  for (const listen of visitListeners) listen();
}

export function subscribeAlertsVisit(listen: () => void): () => void {
  visitListeners.add(listen);
  return () => visitListeners.delete(listen);
}
