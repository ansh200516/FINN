/**
 * Promise-ledger presentation helpers. Pure; no I/O.
 *
 * Rows with `status: 'superseded'` are earlier versions of a promise that
 * management restated. They fold under the latest row of their chain:
 * the adjudicator writes `evidence.chain[].id` on every member, and when a
 * chain is missing the (metric, horizon) pair is the fallback key.
 */
import type { LedgerRowView } from "./model";

export interface LedgerGroup {
  head: LedgerRowView;
  /** earlier versions, oldest first */
  revisions: LedgerRowView[];
  /** true when the head itself is superseded and no successor is on record */
  orphanChain: boolean;
}

function chainIds(r: LedgerRowView): string[] {
  const chain = r.evidence?.chain;
  if (!Array.isArray(chain)) return [];
  return chain
    .map((c) =>
      c && typeof c === "object" ? (c as { id?: unknown }).id : undefined,
    )
    .filter((id): id is string => typeof id === "string" && id !== r.id);
}

export function groupLedger(rows: LedgerRowView[]): LedgerGroup[] {
  const heads = rows.filter((r) => r.status !== "superseded");
  const superseded = rows.filter((r) => r.status === "superseded");
  const claimed = new Set<string>();
  const groups: LedgerGroup[] = heads.map((head) => ({
    head,
    revisions: [] as LedgerRowView[],
    orphanChain: false,
  }));
  // pass 1: chain members with the same metric; pass 2: the rest of the chain
  for (const sameMetric of [true, false]) {
    for (const g of groups) {
      const ids = new Set(chainIds(g.head));
      for (const s of superseded) {
        if (claimed.has(s.id) || !ids.has(s.id)) continue;
        if (sameMetric !== (s.metric === g.head.metric)) continue;
        g.revisions.push(s);
        claimed.add(s.id);
      }
    }
  }
  // fallback: same metric + horizon → the newest head of that pair
  for (const s of superseded) {
    if (claimed.has(s.id)) continue;
    const candidates = groups.filter(
      (g) =>
        g.head.metric === s.metric &&
        (g.head.horizon ?? null) === (s.horizon ?? null),
    );
    const target = candidates.sort(
      (a, b) => b.head.statedAt - a.head.statedAt,
    )[0];
    if (target) {
      target.revisions.push(s);
      claimed.add(s.id);
    }
  }
  // superseded rows nobody claims stand alone, muted
  for (const s of superseded) {
    if (claimed.has(s.id)) continue;
    groups.push({ head: s, revisions: [], orphanChain: true });
  }
  for (const g of groups) g.revisions.sort((a, b) => a.statedAt - b.statedAt);
  return groups;
}

/** "revised 2×" / "revised once". */
export function revisedLabel(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "revised once" : `revised ${n}×`;
}

/** Interim reading the adjudicator stored for an open promise, if any. */
export function interimOf(
  r: LedgerRowView,
): { value: number; unit: string | null; note: string | null } | null {
  const it = r.evidence?.interim;
  if (!it || typeof it !== "object") return null;
  const o = it as { value?: unknown; unit?: unknown; note?: unknown };
  if (typeof o.value !== "number" || !Number.isFinite(o.value)) return null;
  return {
    value: o.value,
    unit: typeof o.unit === "string" ? o.unit : null,
    note: typeof o.note === "string" ? o.note : null,
  };
}

/** The adjudicator's one-line reason, if any ("constant-currency growth is not derivable…"). */
export function noteOf(r: LedgerRowView): string | null {
  const n = r.evidence?.note;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/** 'YYYY-MM-DD' the horizon closes, if the adjudicator recorded it. */
export function horizonEndOf(r: LedgerRowView): string | null {
  const h = r.horizonEnd ?? r.evidence?.horizonEnd;
  return typeof h === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h) ? h : null;
}

/** "Q2FY27" the statement was made in, when recorded. */
export function statedPeriodOf(r: LedgerRowView): string | null {
  const p = r.evidence?.statedPeriod;
  return typeof p === "string" && p ? p : null;
}
