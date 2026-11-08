/**
 * engine/extract — LLM-assisted extraction with code gates (contracts).
 */
import type {
  AnnouncementRaw,
  Category,
  DocumentText,
  GuidanceStatement,
} from "../types";

export interface ExtractedBio {
  name: string;
  role: string;
  effectiveDate: string | null;
  /** verbatim excerpt from the filing (passes verifyQuote) */
  profileExcerpt: string;
  priorRoles: string[];
  education: string | null;
  page: number | null;
}

export interface OneLiner {
  category: Category;
  headline: string;
  fields: Record<string, string | number | null>;
  /** which fields were number-grounded against the source text */
  grounded: boolean;
}

export interface SectionMap {
  docId: string;
  sections: Array<{
    label: string;
    fromPage: number;
    toPage: number;
    confidence: number;
  }>;
}

/** Transcript → verified guidance statements (verbatim quotes only). */
export async function extractGuidance(
  _doc: DocumentText,
  _ctx: { isin: string; period: string | null },
): Promise<GuidanceStatement[]> {
  throw new Error("not implemented: extract.extractGuidance");
}

/** Pure-ish: split a transcript into speaker turns for chunked extraction. */
export function splitSpeakerTurns(
  _doc: DocumentText,
): Array<{ speaker: string | null; page: number; text: string }> {
  throw new Error("not implemented: extract.splitSpeakerTurns");
}

/** Appointment / cessation filing → brief profile of the person. */
export async function extractBio(
  _filingText: string,
  _ctx: { isin: string; announcementId: string },
): Promise<ExtractedBio | null> {
  throw new Error("not implemented: extract.extractBio");
}

/** Category-specific one-liner + fields, number-grounded against the filing text. */
export async function extractOneLiner(
  _raw: AnnouncementRaw,
  _category: Category,
  _filingText?: string,
): Promise<OneLiner> {
  throw new Error("not implemented: extract.extractOneLiner");
}

/** Annual report → section page map (regex anchors first, LLM for ambiguous pages). */
export async function mapSections(_doc: DocumentText): Promise<SectionMap> {
  throw new Error("not implemented: extract.mapSections");
}
