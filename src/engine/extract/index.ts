/**
 * engine/extract — LLM-assisted extraction with code gates (contracts).
 */
import type { Category } from "../types";

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

// Builder A implementations: attachment-text.ts, bio.ts, oneliner.ts
export {
  type AttachmentText,
  type ExtractAttachmentOptions,
  extractAttachmentText,
  MAX_TEXT_CHARS,
  pdfBytesToText,
  shouldFetchAttachment,
  tidyText,
  xmlToLines,
} from "./attachment-text";
export {
  backfillBioFromHistory,
  detectProfilePointer,
  type ExtractBioOptions,
  educationFrom,
  extractBio,
  findBriefProfile,
  type ProfileCandidate,
  pageAt,
} from "./bio";
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
  GUIDANCE_PROMPT_VERSION,
  gateStatement,
  guidanceId,
  METRICS,
  type ParsedHorizon,
  parseHorizon,
  persistGuidance,
  reconcileHorizon,
  type VerifiedStatement,
} from "./guidance";
export {
  cleanSubject,
  computeTotals,
  type ExtractBatchOptions,
  extractOneLiner,
  extractOneLinersBatch,
  fallbackOneLiner,
  fallbackTitle,
  focusText,
  gateFields,
  gateItem,
  LLM_CATEGORIES,
  type OneLinerInput,
  type OneLinerResult,
  rulesOnlyResult,
  sourceTextFor,
} from "./oneliner";
// Builder C implementations: pdf-text.ts, transcript.ts, guidance.ts, sections.ts
export {
  classifyTextQuality,
  type ExtractedPage,
  type ExtractedPdf,
  extractPdfPages,
  LOW_TEXT_CHARS,
  type TextQuality,
} from "./pdf-text";
// Builder B implementation (preliminary results from the filing PDF): results-pdf.ts
export {
  detectUnit,
  extractDates,
  extractResultsFromPdf,
  extractResultsWithLlm,
  linesFromItems,
  numericTokens,
  type PdfExtractContext,
  type PdfResultsExtraction,
  type PdfStatement,
  parseIndianNumber,
  parseStatements,
  pdfPagesText,
  pdfTolerance,
  UNIT_MULTIPLIER,
  type UnitName,
  verifyStatements,
} from "./results-pdf";
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
  SECTIONS_PROMPT_VERSION,
  type SectionLabel,
} from "./sections";
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
