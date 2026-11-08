/**
 * Management-change bio from the filing itself. SEBI LODR Sch. III / Reg 30
 * Annexure item 7.3 mandates a "brief profile (in case of appointment)";
 * 10/11 real filings carried one (docs/research/14 §2). The 11th pointed to an
 * earlier filing, which the symbol's NSE announcement history supplies.
 *
 * Rules first (locate the profile paragraph → verbatim by construction), LLM
 * (batched management_change schema) for structure, `verifyQuote` on every
 * excerpt. Never invented: no profile in any filing → null.
 */
import { logger } from "@/lib/logger";
import { parseNseDateTime } from "@/lib/time";
import { verifyQuote } from "../llm/verify";
import { fetchAnnouncementHistory } from "../sources/nse-announcements";
import type { AnnouncementRaw } from "../types";
import { extractAttachmentText } from "./attachment-text";
import type { BioPerson, ExtractedBio } from "./index";
import {
  type ExtractBatchOptions,
  extractOneLinersBatch,
  type OneLinerInput,
} from "./oneliner";

const log = logger.child({ mod: "engine/extract/bio" });

export interface ProfileCandidate {
  excerpt: string;
  offset: number;
  page: number | null;
}

const PROFILE_HEAD =
  /brief profile|profile of (mr|ms|mrs|dr|shri|smt)\.?|brief background|background of (mr|ms|mrs|dr)\.?|about (mr|ms|mrs|dr)\.?|biograph/i;
const NOT_APPLICABLE = /^(not applicable|n\.?a\.?|nil|-)[.\s]*$/i;
/** "A brief profile … is enclosed as Annexure I" / relationship & debarment rows are not the profile. */
const POINTER_OR_OTHER_ROW =
  /\b(?:is|are|has been|was)\s+(?:enclosed|annexed|attached|given below|provided|disclosed vide)|\bnot related\b|\bnot debarred\b|disclosure of relationship/i;
/** Words a real profile paragraph carries; used to rank candidates. */
const PROFILE_WORDS =
  /\b(experience|years|served|serving|held|career|previously|joined|graduat|degree|chartered|mba|b\.?tech|phd|president|chief|head of|director of|managing|founder|alumn)\b/gi;

export function profileScore(excerpt: string): number {
  const words = (excerpt.match(PROFILE_WORDS) ?? []).length;
  return words * 10 + Math.min(excerpt.length, 1200) / 100;
}

/** Page number of a character offset given "[[page N]]" markers from attachment-text. */
export function pageAt(text: string, offset: number): number | null {
  let page: number | null = null;
  const re = /\[\[page (\d+)\]\]/g;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined || m.index > offset) break;
    page = Number(m[1]);
  }
  return page;
}

/** Locate the brief-profile paragraph(s) in filing text (≥ 120 chars, ≤ 1200 chars each). */
export function findBriefProfile(text: string): ProfileCandidate[] {
  const out: ProfileCandidate[] = [];
  const seen = new Set<number>();
  for (const m of text.matchAll(new RegExp(PROFILE_HEAD.source, "gi"))) {
    if (m.index === undefined) continue;
    // take text after the heading up to a blank line / next annexure row, max 1200 chars
    const after = text.slice(m.index, m.index + 1800);
    const body = after.replace(/^[^\n:]*[:\n]/, "").trim(); // drop the heading itself
    if (!body || NOT_APPLICABLE.test(body.slice(0, 20))) continue;
    // paragraph = up to the first double newline, else the first ~1200 chars ending at a sentence
    let para = body.split(/\n\s*\n/)[0] ?? body;
    if (para.length > 1200) {
      const cut = para.slice(0, 1200);
      const end = cut.lastIndexOf(". ");
      para = end > 300 ? cut.slice(0, end + 1) : cut;
    }
    para = para.replace(/\s+/g, " ").trim();
    if (para.length < 120) continue;
    if (POINTER_OR_OTHER_ROW.test(para.slice(0, 220))) continue;
    const off = text.indexOf(para.slice(0, 40), m.index);
    const key = Math.floor((off < 0 ? m.index : off) / 50);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      excerpt: para,
      offset: off < 0 ? m.index : off,
      page: pageAt(text, off < 0 ? m.index : off),
    });
  }
  // best-looking profile first
  return out.sort((a, b) => profileScore(b.excerpt) - profileScore(a.excerpt));
}

/** "brief profile … disclosed vide our letter dated 7 September 2026" → the referenced date text. */
export function detectProfilePointer(text: string): string | null {
  const m =
    /(brief profile|profile)[\s\S]{0,160}?(disclosed|intimated|submitted|provided|shared|given|enclosed)[\s\S]{0,80}?(letter|intimation|disclosure|announcement)[\s\S]{0,40}?dated\s+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}-[A-Za-z]{3}-\d{4})/i.exec(
      text,
    );
  return m?.[4] ?? null;
}

const MGMT_DESCS =
  /appoint|change in (management|director|directorate)|resignation|cessation|retire|demise|outcome of board meeting|updates?/i;

/**
 * Search the symbol's NSE history for an earlier filing about the same person
 * (surname in the subject or in the attachment text of management-change
 * items filed before `beforeMs`). Returns the text of the first hit.
 */
export async function backfillBioFromHistory(
  symbol: string,
  personName: string,
  beforeMs: number,
  o: { maxCandidates?: number; history?: AnnouncementRaw[] } = {},
): Promise<{
  raw: AnnouncementRaw;
  text: string;
  candidates: ProfileCandidate[];
} | null> {
  const tokens = personName
    .replace(/\b(mr|ms|mrs|dr|shri|smt|prof)\.?\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const surname = tokens.at(-1);
  if (!surname) return null;
  const history = o.history ?? (await fetchAnnouncementHistory(symbol));
  const older = history
    .filter((h) => {
      try {
        return parseNseDateTime(h.an_dt) < beforeMs;
      } catch {
        return false;
      }
    })
    .filter((h) => MGMT_DESCS.test(h.desc) || MGMT_DESCS.test(h.attchmntText))
    .sort((a, b) => parseNseDateTime(b.an_dt) - parseNseDateTime(a.an_dt));
  const re = new RegExp(
    `\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i",
  );
  const bySubject = older.filter((h) => re.test(h.attchmntText));
  const candidates = bySubject.length
    ? bySubject
    : older.filter((h) => /appoint/i.test(`${h.desc} ${h.attchmntText}`));
  let tried = 0;
  for (const raw of candidates) {
    if (tried >= (o.maxCandidates ?? 4)) break;
    tried++;
    const att = await extractAttachmentText(raw.attchmntFile);
    if (!att) continue;
    if (!re.test(att.text)) continue;
    const found = findBriefProfile(att.text).filter(
      (c) => re.test(c.excerpt) || tokens.some((t) => c.excerpt.includes(t)),
    );
    if (found.length) {
      log.info(
        { symbol, person: personName, from: raw.an_dt, seq: raw.seq_id },
        "bio backfilled from history",
      );
      return { raw, text: att.text, candidates: found };
    }
  }
  return null;
}

const EDU_RE =
  /[^.]*\b(holds? (a|an|the)|graduat|alumn|chartered accountant|cost accountant|company secretary by qualification|b\.? ?tech|b\.? ?e\.?\b|m\.? ?tech|mba|pgdm|pgdbm|\bcfa\b|\bcpa\b|ll\.? ?b|ph\.? ?d|m\.? ?sc|b\.? ?sc|b\.? ?com|m\.? ?com|\biit\b|\biim\b|harvard|stanford|wharton|oxford|cambridge|insead|kellogg|booth)\b[^.]*\./i;

export function educationFrom(excerpt: string): string | null {
  const m = EDU_RE.exec(excerpt);
  return m ? m[0].trim() : null;
}

// ---------------------------------------------------------------------------
// Multi-person brief-profile annexures
// ---------------------------------------------------------------------------

const HONORIFIC_NAME =
  /\b(Mr|Ms|Mrs|Dr)\.?\s+((?:[A-Z][A-Za-z.'’-]*\s+){0,5}[A-Z][A-Za-z.'’-]*)/g;

/** "Mr. Jayant Balan Mr. Jayant Balan is…" → "Mr. Jayant Balan is…". */
export function dedupeLeadingName(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const m =
    /^(Mr|Ms|Mrs|Dr)\.?\s+([A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,5})\s+\1\.?\s+\2(?=\s|[,.:;]|$)/.exec(
      t,
    );
  if (!m?.[1] || !m[2]) return t;
  return `${m[1]}. ${m[2]}${t.slice(m[0].length)}`.replace(/\s+/g, " ").trim();
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Keep at most `maxWords`, cutting back to the last sentence boundary inside the window. */
export function trimAtSentence(text: string, maxWords = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return clean;
  const slice = words.slice(0, maxWords).join(" ");
  if (/[.!?]$/.test(slice)) return slice;
  let end = -1;
  for (const mark of [". ", "! ", "? "]) {
    const i = slice.lastIndexOf(mark);
    if (i > end) end = i;
  }
  if (end >= 0) {
    const kept = slice.slice(0, end + 1).trim();
    if (wordCount(kept) >= 12) return kept;
  }
  return slice;
}

function significantTokens(name: string): string[] {
  const stripped = name
    .replace(/\b(mr|ms|mrs|dr|shri|smt|prof)\.?\s+/gi, " ")
    .replace(/[’]/g, "'")
    .replace(/\./g, " ");
  return stripped
    .split(/[^A-Za-z']+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}

function namesMatch(captured: string[], person: string[]): boolean {
  if (!captured.length || !person.length) return false;
  if (captured.join(" ") === person.join(" ")) return true;
  if (captured.length < 2) return false;
  if (captured[captured.length - 1] !== person[person.length - 1]) return false;
  const have = new Set(person);
  return captured.every((t) => have.has(t));
}

interface NamedChange {
  name: string;
  role: string | null;
  action: string | null;
  effectiveDate: string | null;
  priorRoles: string[];
  tokens: string[];
}

function strField(
  o: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function normalizeChanges(
  changes: ReadonlyArray<Record<string, unknown>>,
): NamedChange[] {
  const out: NamedChange[] = [];
  for (const c of changes) {
    const name = strField(c, "person", "name");
    if (!name) continue;
    const tokens = significantTokens(name);
    if (!tokens.length) continue;
    const prior = c.priorRoles ?? c.prior_roles;
    out.push({
      name,
      role: strField(c, "role"),
      action: strField(c, "action"),
      effectiveDate: strField(c, "effectiveDate", "effective_date"),
      priorRoles: Array.isArray(prior)
        ? prior.filter((x): x is string => typeof x === "string" && !!x.trim())
        : [],
      tokens,
    });
  }
  return out;
}

function bestChange(
  captured: string[],
  named: NamedChange[],
): NamedChange | null {
  let best: { row: NamedChange; extra: number } | null = null;
  for (const row of named) {
    if (!namesMatch(captured, row.tokens)) continue;
    const extra = Math.abs(row.tokens.length - captured.length);
    if (!best || extra < best.extra) best = { row, extra };
  }
  return best?.row ?? null;
}

/** Join profile paragraphs, dropping a later copy that is already contained. */
export function joinProfileText(
  parts: Array<string | null | undefined>,
): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const t = p.replace(/\s+/g, " ").trim();
    if (t.length < 80) continue;
    const head = t.slice(0, 60);
    if (out.some((o) => o.includes(head) || t.includes(o.slice(0, 60))))
      continue;
    out.push(t);
  }
  return out.join("\n\n");
}

/**
 * Split a brief-profile annexure into one record per change-table person.
 * Boundaries are `Mr./Ms./Mrs./Dr. <Name>` where the name matches the change
 * table. A second mention of the same person (the duplicated heading, or a
 * later "Mr. Surname") does not start a new section. Excerpts lose a repeated
 * leading name and are cut to ≤90 words on a sentence boundary.
 */
export function splitAnnexurePeople(
  text: string,
  changes: ReadonlyArray<Record<string, unknown>>,
): BioPerson[] {
  const named = normalizeChanges(changes);
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || !named.length) return [];
  const hits: Array<{ at: number; row: NamedChange }> = [];
  for (const m of clean.matchAll(HONORIFIC_NAME)) {
    if (m.index === undefined) continue;
    const row = bestChange(significantTokens(m[2] ?? ""), named);
    if (!row) continue;
    if (hits.some((h) => h.row === row)) continue;
    hits.push({ at: m.index, row });
  }
  const people: BioPerson[] = [];
  hits.forEach((h, i) => {
    const end = hits[i + 1]?.at ?? clean.length;
    const excerpt = trimAtSentence(dedupeLeadingName(clean.slice(h.at, end)));
    if (wordCount(excerpt) < 8) return;
    people.push({
      name: h.row.name,
      role: h.row.role,
      action: h.row.action,
      effectiveDate: h.row.effectiveDate,
      excerpt,
      priorRoles: h.row.priorRoles,
    });
  });
  return people;
}

/** Profile paragraphs + the filing's change table → `people[]`. */
export function peopleFromProfiles(
  parts: Array<string | null | undefined>,
  changes: ReadonlyArray<Record<string, unknown>>,
): BioPerson[] {
  return splitAnnexurePeople(joinProfileText(parts), changes);
}

export interface ExtractBioOptions extends ExtractBatchOptions {
  symbol?: string;
  companyName?: string;
  raw?: AnnouncementRaw;
  /** try the symbol history when the filing points to an earlier letter */
  allowBackfill?: boolean;
}

/**
 * Appointment / cessation filing text → ExtractedBio for the appointed person.
 * Returns null when no verifiable profile exists (no invention).
 */
export async function extractBio(
  filingText: string,
  ctx: { isin: string; announcementId: string } & ExtractBioOptions,
): Promise<ExtractedBio | null> {
  let text = filingText;
  let candidates = findBriefProfile(text);
  const pointer = detectProfilePointer(text);

  const raw = ctx.raw;
  const inp: OneLinerInput = {
    id: ctx.announcementId,
    category: "management_change",
    symbol: ctx.symbol ?? raw?.symbol ?? "",
    companyName: ctx.companyName ?? raw?.sm_name ?? "",
    desc: raw?.desc ?? "Change in Management",
    subject: raw?.attchmntText ?? "",
    voiceSummary: raw?.voiceSummary ?? null,
    text,
    filedAtIst: raw?.an_dt ?? "",
  };
  const results = await extractOneLinersBatch([inp], ctx);
  const res = results.get(ctx.announcementId);
  const changes =
    (res?.fields?.changes as Array<Record<string, unknown>> | undefined) ?? [];
  const appointed =
    changes.find((c) =>
      /appointed|reappointed|redesignated/.test(String(c.action ?? "")),
    ) ?? changes[0];
  if (!appointed && candidates.length === 0) return null;

  const name = String(appointed?.person ?? "").trim();
  const role = String(appointed?.role ?? "").trim();
  let excerpt =
    typeof appointed?.brief_profile_excerpt === "string"
      ? appointed.brief_profile_excerpt
      : null;
  if (excerpt && verifyQuote(excerpt, text) === null) excerpt = null;

  // rules-found paragraph wins when the model found nothing (it is verbatim by construction)
  if (!excerpt && candidates.length) {
    const pick = name
      ? (candidates.find((c) =>
          c.excerpt.includes(name.split(/\s+/).at(-1) ?? "\u0000"),
        ) ?? candidates[0])
      : candidates[0];
    excerpt = pick?.excerpt ?? null;
  }

  // pointer to an earlier filing → backfill from the symbol's history
  if (
    !excerpt &&
    pointer &&
    ctx.allowBackfill !== false &&
    inp.symbol &&
    name
  ) {
    const beforeMs = raw ? parseNseDateTime(raw.an_dt) : Date.now();
    const back = await backfillBioFromHistory(inp.symbol, name, beforeMs).catch(
      (e) => {
        log.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "bio backfill failed",
        );
        return null;
      },
    );
    if (back) {
      text = back.text;
      candidates = back.candidates;
      excerpt = candidates[0]?.excerpt ?? null;
    }
  }
  if (!excerpt) return null;

  const off = verifyQuote(excerpt, text);
  const priorRoles = Array.isArray(appointed?.prior_roles)
    ? (appointed.prior_roles as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const people = peopleFromProfiles(
    [excerpt, ...candidates.map((c) => c.excerpt)],
    changes,
  );
  return {
    name: name || "(name not extracted)",
    role: role || "(role not extracted)",
    effectiveDate:
      typeof appointed?.effective_date === "string"
        ? appointed.effective_date
        : null,
    profileExcerpt: excerpt,
    priorRoles,
    education: educationFrom(excerpt),
    page:
      off !== null ? pageAt(text, text.indexOf(excerpt.slice(0, 30))) : null,
    ...(people.length ? { people } : {}),
  };
}
