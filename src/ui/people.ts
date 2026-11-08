/**
 * Management-change payload → per-person rows. Pure; no I/O.
 *
 * Three shapes arrive from the engine:
 *   1. `people[]` (preferred, Engineer E) or the ingest's `changes[]` — one
 *      record per person with role · action · effective date · profile;
 *   2. a single-person card whose `brief_profile_excerpt` is really the
 *      filing's whole annexure ("Mr. A Mr. A is… Mr. B Mr. B is…") — split it
 *      at the duplicated-name headings and dedupe the leading repeat;
 *   3. a plain single-person card.
 */
import type { ManagementChangeCard } from "./model";

export interface PersonChange {
  person: string;
  role: string | null;
  /** 'appointed' | 'resigned' | 'retired' | 'ceased' | 're-appointed' | 'redesignated' | null */
  action: string | null;
  /** display-ready, e.g. "25 May 2027"; the raw string when it cannot be parsed */
  effectiveDate: string | null;
  reason: string | null;
  successor: string | null;
  /** brief profile, leading duplicate name removed */
  excerpt: string | null;
  priorRoles: string[];
  confidence: "high" | "medium" | "low" | null;
  /** 'payload' = from people[]/changes[]/others[]; 'split' = carved out of one excerpt */
  from: "payload" | "split";
}

const HON = "(?:Mr|Ms|Mrs|Miss|Dr|Shri|Smt|Prof|CA)\\.?";
const TOKEN = `(?!${HON}\\s)[A-Z][\\w.'’-]*`;
const NAME = `${HON}\\s+(?:${TOKEN}\\s+){0,4}${TOKEN}`;
/** "Mr. Jayant Balan Mr. Jayant Balan is…" — a heading immediately repeated by the first sentence. */
const DUP_HEADING = new RegExp(`(${NAME})\\s+\\1(?=[\\s,.:;]|$)`, "g");

export const DEPARTING_ACTIONS = new Set([
  "resigned",
  "retired",
  "ceased",
  "withdrawn",
  "demise",
]);

export const ACTION_VERB: Record<string, string> = {
  appointed: "appointed",
  resigned: "resigns",
  retired: "retires",
  ceased: "ceases",
  "re-appointed": "re-appointed",
  redesignated: "redesignated",
};

export function actionVerb(action: string | null): string {
  if (!action) return "";
  return ACTION_VERB[action] ?? action.replace(/_/g, " ");
}

/** "Mr. Jayant Balan Mr. Jayant Balan is a…" → "Mr. Jayant Balan is a…". */
export function dedupeLeadingName(text: string): string {
  const t = text.trim();
  const m = new RegExp(`^(${NAME})\\s+\\1(?=[\\s,.:;]|$)`).exec(t);
  return m ? t.slice(m[1]?.length ?? 0).trim() : t;
}

/** Surname key for loose matching: "Mr. Mukundan Menon C.P." → "menon"; "Mr. Sunil Alaric D’Souza" → "d'souza". */
export function surnameKey(name: string): string | null {
  const tokens = name
    .replace(new RegExp(`^${HON}\\s+`), "")
    .replace(/[’]/g, "'")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^[A-Z]\.?([A-Z]\.?)*$/.test(w)); // drop initials
  const last = tokens.at(-1);
  if (!last) return null;
  const key = last.toLowerCase().replace(/[^a-z']/g, "");
  return key.length >= 3 ? key : null;
}

/**
 * Split an annexure-style excerpt into per-person profiles. Boundaries are
 * duplicated headings ("Mr. X Mr. X is…") and, when `knownNames` is given,
 * sentence-initial mentions of those names. Text before the first boundary
 * belongs to the first (unnamed) segment.
 */
export function splitProfiles(
  text: string,
  knownNames: string[] = [],
): Array<{ name: string | null; excerpt: string }> {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const cuts: Array<{ at: number; name: string; bodyAt: number }> = [];
  for (const m of t.matchAll(DUP_HEADING)) {
    const name = m[1] ?? "";
    cuts.push({ at: m.index, name, bodyAt: m.index + name.length + 1 });
  }
  for (const n of knownNames) {
    const key = surnameKey(n);
    if (!key) continue;
    // a sentence that starts with this person's name, after the first 40 chars
    const re = new RegExp(`(?:^|[.!?]\\s+)(${NAME})`, "g");
    for (const m of t.matchAll(re)) {
      const name = m[1] ?? "";
      if (surnameKey(name) !== key) continue;
      const at = m.index + m[0].length - name.length;
      if (at < 40 || cuts.some((c) => Math.abs(c.at - at) < 8)) continue;
      cuts.push({ at, name, bodyAt: at });
    }
  }
  cuts.sort((a, b) => a.at - b.at);
  if (!cuts.length) return [{ name: null, excerpt: dedupeLeadingName(t) }];
  const out: Array<{ name: string | null; excerpt: string }> = [];
  const first = cuts[0] as (typeof cuts)[number];
  if (first.at > 0) {
    const lead = t.slice(0, first.at).trim();
    if (lead.length > 20) out.push({ name: null, excerpt: lead });
  }
  cuts.forEach((c, i) => {
    const end = cuts[i + 1]?.at ?? t.length;
    const body = t.slice(c.bodyAt, end).trim();
    out.push({ name: c.name, excerpt: dedupeLeadingName(body) });
  });
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH_NAME = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "25th May, 2027" | "May 25, 2027" | "25-May-2027" | "25.05.2027" | "2027-05-25" → "25 May 2027"; else the input. */
export function displayDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  const monthNum = (w: string) =>
    MONTHS[w.toLowerCase().slice(0, 4)] ?? MONTHS[w.toLowerCase().slice(0, 3)];
  const parsed = ((): [number, number, number] | null => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (iso) return [Number(iso[3]), Number(iso[2]), Number(iso[1])];
    const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
    if (dmy) return [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    const dMonY =
      /^(\d{1,2})(?:st|nd|rd|th)?[-\s]+([A-Za-z]+),?[-\s]+(\d{4})$/.exec(t);
    if (dMonY)
      return [
        Number(dMonY[1]),
        monthNum(dMonY[2] ?? "") ?? 0,
        Number(dMonY[3]),
      ];
    const monDY = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(
      t,
    );
    if (monDY)
      return [
        Number(monDY[2]),
        monthNum(monDY[1] ?? "") ?? 0,
        Number(monDY[3]),
      ];
    return null;
  })();
  if (!parsed) return t;
  const [d, mo, y] = parsed;
  if (!d || !mo || !y || mo < 1 || mo > 12 || d < 1 || d > 31) return t;
  return `${d} ${MONTH_NAME[mo]} ${y}`;
}

type Loose = Record<string, unknown>;

function str(o: Loose, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function strList(o: Loose, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v))
      return v.filter((x): x is string => typeof x === "string" && !!x.trim());
  }
  return [];
}

function fromRecord(o: Loose): PersonChange | null {
  const person = str(o, "person", "name");
  if (!person) return null;
  const excerpt = str(o, "brief_profile_excerpt", "profileExcerpt", "excerpt");
  const conf = str(o, "confidence");
  return {
    person,
    role: str(o, "role"),
    action: str(o, "action")?.toLowerCase() ?? null,
    effectiveDate: displayDate(str(o, "effective_date", "effectiveDate")),
    reason: str(o, "reason"),
    successor: str(o, "successor"),
    excerpt: excerpt ? dedupeLeadingName(excerpt) : null,
    priorRoles: strList(o, "prior_roles", "priorRoles"),
    confidence:
      conf === "high" || conf === "medium" || conf === "low" ? conf : null,
    from: "payload",
  };
}

/** Everyone named in a management-change card, in filing order. */
export function peopleOf(
  card: ManagementChangeCard & {
    people?: unknown;
    changes?: unknown;
    profile_summary?: string | null;
  },
): PersonChange[] {
  const list = Array.isArray(card.people)
    ? card.people
    : Array.isArray(card.changes)
      ? card.changes
      : null;
  if (list?.length) {
    const rows = list
      .filter((x): x is Loose => Boolean(x) && typeof x === "object")
      .map(fromRecord)
      .filter((x): x is PersonChange => x !== null);
    if (rows.length) {
      const key = surnameKey(card.person);
      if (key && !rows.some((r) => surnameKey(r.person) === key))
        rows.unshift(selfRow(card));
      return rows;
    }
  }
  const others = card.others ?? [];
  const segments = card.brief_profile_excerpt
    ? splitProfiles(
        card.brief_profile_excerpt,
        others.map((o) => o.person),
      )
    : [];
  const selfKey = surnameKey(card.person);
  const self = selfRow(card);
  const out: PersonChange[] = [];
  const used = new Set<number>();
  // the card's own person takes the first unnamed segment or the one bearing their name
  const own =
    segments.findIndex((s) => s.name && surnameKey(s.name) === selfKey) >= 0
      ? segments.findIndex((s) => s.name && surnameKey(s.name) === selfKey)
      : segments.findIndex((s) => s.name === null);
  if (own >= 0) {
    self.excerpt = segments[own]?.excerpt ?? self.excerpt;
    used.add(own);
  } else if (segments.length === 1 && segments[0]) {
    self.excerpt = segments[0].excerpt;
    used.add(0);
  }
  out.push(self);
  segments.forEach((s, i) => {
    if (used.has(i) || !s.name) return;
    const k = surnameKey(s.name);
    const known = others.find((o) => surnameKey(o.person) === k);
    out.push({
      person: known?.person ?? s.name,
      role: known?.role ?? null,
      // SEBI requires a brief profile only on appointment, so a profile marks an appointee
      action: known?.action ?? "appointed",
      effectiveDate: null,
      reason: null,
      successor: null,
      excerpt: s.excerpt,
      priorRoles: [],
      confidence: null,
      from: "split",
    });
  });
  for (const o of others) {
    const k = surnameKey(o.person);
    if (k && out.some((p) => surnameKey(p.person) === k)) continue;
    out.push({
      person: o.person,
      role: o.role || null,
      action: o.action || null,
      effectiveDate: null,
      reason: null,
      successor: null,
      excerpt: null,
      priorRoles: [],
      confidence: null,
      from: "payload",
    });
  }
  return out;
}

function selfRow(card: ManagementChangeCard): PersonChange {
  return {
    person: card.person,
    role: card.role || null,
    action: card.action || null,
    effectiveDate: displayDate(card.effective_date),
    reason: card.reason,
    successor: card.successor ?? null,
    excerpt: card.brief_profile_excerpt
      ? dedupeLeadingName(card.brief_profile_excerpt)
      : null,
    priorRoles: card.prior_roles ?? [],
    confidence: card.confidence ?? null,
    from: "payload",
  };
}

/** People leaving (resigned / retired / ceased) — the ones whose promises may be orphaned. */
export function departing(people: PersonChange[]): PersonChange[] {
  return people.filter((p) => p.action && DEPARTING_ACTIONS.has(p.action));
}

const SUBJECT_ACTION: Record<string, string> = {
  appointment: "appointed",
  "re-appointment": "re-appointed",
  reappointment: "re-appointed",
  resignation: "resigned",
  retirement: "retired",
  cessation: "ceased",
  demise: "ceased",
};
const ROLE_START =
  /^(?:Managing|Whole|Executive|Non|Independent|Additional|Chairman|Chairperson|Chief|Company|Director|President|Vice|Group|Joint|Deputy|CEO|CFO|MD|Head|Senior|Nominee)\b/;
const DATE_IN_SUBJECT =
  /(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}-[A-Za-z]{3}-\d{4}|\d{4}-\d{2}-\d{2})/;

/**
 * People named in NSE subject lines — "… Appointment of Mr Jayant Balan as
 * Managing Director of the company w.e.f. 25th May, 2027." One record per
 * subject; roles and dates when the line carries them.
 */
export function peopleFromSubjects(subjects: string[]): PersonChange[] {
  const out: PersonChange[] = [];
  const re = new RegExp(
    `\\b(Appointment|Re-?appointment|Resignation|Retirement|Cessation|Demise)\\s+of\\s+(${HON})\\s*([A-Z][\\w.'’-]*(?:\\s+[A-Z][\\w.'’-]*){0,4})`,
    "g",
  );
  for (const subject of subjects) {
    const s = subject.replace(/\s+/g, " ").trim();
    for (const m of s.matchAll(re)) {
      const action = SUBJECT_ACTION[(m[1] ?? "").toLowerCase()] ?? null;
      // trim role words that the greedy name capture swallowed
      const tokens = (m[3] ?? "").split(" ");
      const nameTokens: string[] = [];
      for (const tkn of tokens) {
        if (ROLE_START.test(tkn) || tkn === "as") break;
        nameTokens.push(tkn);
      }
      if (!nameTokens.length) continue;
      const name = `${(m[2] ?? "").replace(/\.$/, "")}. ${nameTokens.join(" ")}`;
      // the match ends at the end of the greedy capture; step back over the dropped role words
      const dropped = (m[3] ?? "").length - nameTokens.join(" ").length;
      const rest = s.slice(m.index + m[0].length - dropped);
      const roleM =
        /^\s*(?:as\s+|,\s*)?([A-Z][^,]*?)(?=\s+of the [Cc]ompany|\s+w\.?\s?e\.?\s?f|\s+with effect|\s+effective|\s+and\s+(?:his|her)|,|\.|$)/.exec(
          rest,
        );
      const role = roleM?.[1]?.replace(/-\s+/g, "-").trim() || null;
      const dateM = DATE_IN_SUBJECT.exec(
        rest.split(/\s+and\s+(?:his|her)\s+/)[0] ?? rest,
      );
      out.push({
        person: name,
        role: role && role.length <= 60 ? role : null,
        action,
        effectiveDate: dateM ? displayDate(dateM[1]) : null,
        reason: null,
        successor: null,
        excerpt: null,
        priorRoles: [],
        confidence: null,
        from: "payload",
      });
    }
  }
  return out;
}

/** Merge subject-derived people into the card's people: fill gaps by surname, append the rest. */
export function mergePeople(
  base: PersonChange[],
  extra: PersonChange[],
): PersonChange[] {
  const out = base.map((p) => ({ ...p }));
  for (const e of extra) {
    const k = surnameKey(e.person);
    const hit = k ? out.find((p) => surnameKey(p.person) === k) : undefined;
    if (hit) {
      hit.role ??= e.role;
      hit.action ??= e.action;
      hit.effectiveDate ??= e.effectiveDate;
      continue;
    }
    if (out.some((p) => p.person === e.person)) continue;
    out.push(e);
  }
  return out;
}
