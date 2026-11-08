/**
 * engine/extract — LLM-assisted extraction with code gates (contracts).
 */
import type { AnnouncementRaw, Category } from "../types";

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

// Builder C implementations: pdf-text.ts, transcript.ts, guidance.ts
export {
  classifyTextQuality,
  type ExtractedPage,
  type ExtractedPdf,
  extractPdfPages,
  LOW_TEXT_CHARS,
  type TextQuality,
} from "./pdf-text";
export {
  adjectiveBand,
  applyCueWords,
  type Band,
  callFiscalYear,
  chunkTurns,
  dedupeStatements,
  type ExtractGuidanceResult,
  extractGuidance,
  extractGuidanceDetailed,
  type GateStats,
  gateStatement,
  GUIDANCE_PROMPT_VERSION,
  guidanceId,
  METRICS,
  type ParsedHorizon,
  parseHorizon,
  persistGuidance,
  reconcileHorizon,
  type VerifiedStatement,
} from "./guidance";
export {
  type FiscalPeriod,
  inferPeriodFromText,
  makePeriod,
  managementTurns,
  matchRoster,
  type ParsedTranscript,
  type Participant,
  parseLongDate,
  parsePeriodLabel,
  parseTranscript,
  periodForQuarterEnd,
  periodForTranscriptDate,
  periodSortKey,
  previousQuarter,
  previousYearPeriod,
  quarterEndsOf,
  splitSpeakerTurns,
} from "./transcript";

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

// Builder C: annual-report page map (regex anchors; optional one-call TOC cross-check)
export {
  type AnchorLabel,
  buildPageMap,
  detectFolioOffset,
  getSectionText,
  isTocPage,
  mapSections,
  mapSectionsForDocument,
  type PageMap,
  type PageMapSection,
  type SectionLabel,
  SECTIONS_PROMPT_VERSION,
} from "./sections";
