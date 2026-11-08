/**
 * Annual-report page map (owner: Builder C).
 *
 * Deterministic regex anchors over per-page text find where the statutory
 * sections and financial statements start (MD&A, Board's report, CG report,
 * BRSR, auditor's reports, balance sheet, P&L, cash flow, notes — each as a
 * standalone / consolidated variant where applicable) and which pages carry the
 * high-signal notes (related party, contingent liabilities, borrowings, segment).
 * Optionally ONE Flash-Lite call reads the contents pages to cross-check the
 * map (`useLlm`); disagreements are recorded, never silently applied.
 *
 * The map is stored in `research_sections` (section = 'page_map', one row per
 * company, keyed by docId inside the JSON). `getSectionText(docId, section)`
 * returns the page texts for a section so later waves can send *only* those
 * pages to a model.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { documents, researchSections } from "@/db/schema";
import { callStructured } from "@/engine/llm/gateway";
import { logger } from "@/lib/logger";
import { loadDocumentText } from "../ingest/documents";
import type { DocumentText } from "../types";
import type { SectionMap } from "./index";

const log = logger.child({ mod: "engine/extract/sections" });

export const SECTIONS_PROMPT_VERSION = "s1";

export type SectionLabel =
  | "corporate_overview"
  | "mdna"
  | "directors_report"
  | "corporate_governance"
  | "brsr"
  | "auditors_report_standalone"
  | "balance_sheet_standalone"
  | "pnl_standalone"
  | "cash_flow_standalone"
  | "notes_standalone"
  | "auditors_report_consolidated"
  | "balance_sheet_consolidated"
  | "pnl_consolidated"
  | "cash_flow_consolidated"
  | "notes_consolidated"
  | "agm_notice";

export type AnchorLabel =
  | "related_party"
  | "contingent_liabilities"
  | "borrowings"
  | "segment"
  | "key_audit_matters"
  | "ratios";

interface Anchor {
  label:
    | SectionLabel
    | "auditors_report"
    | "balance_sheet"
    | "pnl"
    | "cash_flow"
    | "notes";
  re: RegExp;
  /** financial statements come in standalone + consolidated variants */
  variants?: boolean;
}

const SECTION_ANCHORS: Anchor[] = [
  {
    label: "mdna",
    re: /^management(?:'|’)?s?\s+discussion\s+(?:and|&)\s+analysis\b.*$/i,
  },
  {
    label: "directors_report",
    re: /^(?:board(?:'|’)?s?|directors(?:'|’)?)\s+report\b(?!\s+on\s+corporate\s+governance).*$/i,
  },
  {
    label: "corporate_governance",
    re: /^(?:report on corporate governance|corporate governance report)\b.*$/i,
  },
  {
    label: "brsr",
    re: /^business responsibility\s+(?:and|&)\s+sustainability\s+report(?:ing)?\b.*$/i,
  },
  {
    label: "auditors_report",
    re: /^independent auditor(?:'|’)?s(?:'|’)?\s+report\b.*$/i,
    variants: true,
  },
  {
    label: "balance_sheet",
    re: /^(?:consolidated\s+|standalone\s+)?balance sheet\b.*$/i,
    variants: true,
  },
  {
    label: "pnl",
    re: /^(?:consolidated\s+|standalone\s+)?statement of profit (?:and|&) loss\b.*$/i,
    variants: true,
  },
  {
    label: "cash_flow",
    re: /^(?:consolidated\s+|standalone\s+)?(?:statement of )?cash flows?(?:\s+statement)?\b.*$/i,
    variants: true,
  },
  {
    label: "notes",
    re: /^notes?\s+(?:forming part of|to)\s+(?:the\s+)?(?:consolidated\s+|standalone\s+)?financial statements\b.*$/i,
    variants: true,
  },
  {
    label: "agm_notice",
    re: /^notice(?:\s+of\s+(?:the\s+)?(?:\d+(?:st|nd|rd|th)\s+)?annual general meeting)?$/i,
  },
];

const NOTE_ANCHORS: Array<{ label: AnchorLabel; re: RegExp }> = [
  {
    label: "related_party",
    re: /related part(?:y|ies)\s+(?:transactions?|disclosures?)/i,
  },
  { label: "contingent_liabilities", re: /contingent liabilit(?:y|ies)/i },
  {
    label: "borrowings",
    re: /^\s*(?:note\s+)?(?:\d+[a-z.)]*\s+)?(?:non-?current\s+|current\s+|long[- ]term\s+|short[- ]term\s+)?borrowings\b/im,
  },
  {
    label: "segment",
    re: /segment\s+(?:information|reporting|revenue|results)/i,
  },
  { label: "key_audit_matters", re: /key audit matters?/i },
  {
    label: "ratios",
    re: /(?:financial|key)\s+ratios?|ratio analysis|additional regulatory information/i,
  },
];

export interface PageMapSection {
  label: string;
  fromPage: number;
  toPage: number;
  confidence: number;
  method: "heading" | "body" | "llm" | "inferred";
}

export interface PageMap {
  docId: string;
  pages: number;
  /** printed folio − PDF page (null when no running folios were found) */
  folioOffset: number | null;
  sections: PageMapSection[];
  anchors: Record<string, number[]>;
  tocPages: number[];
  usedLlm: boolean;
  llmDisagreements: Array<{
    label: string;
    regexPage: number | null;
    llmPage: number | null;
  }>;
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function headingLines(text: string, max = 25): string[] {
  return text
    .split(/\r?\n/)
    .slice(0, max)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(
      (l) =>
        l.length >= 3 &&
        l.length <= 90 &&
        !/[.;:]$/.test(l) &&
        l.split(/\s+/).length <= 14,
    );
}

/** A contents page: many short lines ending in a page number. */
export function isTocPage(text: string, pageCount: number): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 8) return false;
  let hits = 0;
  for (const l of lines) {
    const m = /(\d{1,3})\s*$/.exec(l);
    if (m && Number(m[1]) <= pageCount + 20 && l.length <= 90) hits++;
  }
  return (
    hits >= 10 &&
    hits / lines.length >= 0.3 &&
    /contents|index|inside/i.test(text.slice(0, 600))
  );
}

/** Printed folio numbers → offset to PDF pages (mode of folio − page). */
export function detectFolioOffset(doc: DocumentText): number | null {
  const counts = new Map<number, number>();
  for (const p of doc.pages) {
    const lines = p.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const edge = [...lines.slice(0, 2), ...lines.slice(-3)];
    for (const l of edge) {
      const m =
        /^(\d{1,3})$/.exec(l) ??
        /(?:^|\s)(\d{1,3})$/.exec(l.length <= 60 ? l : "");
      if (!m) continue;
      const folio = Number(m[1]);
      if (folio < 1 || folio > doc.pages.length + 40) continue;
      const off = folio - p.page;
      if (Math.abs(off) > 60) continue;
      counts.set(off, (counts.get(off) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < Math.max(5, doc.pages.length * 0.15)) return null;
  return top[0];
}

interface Candidate {
  label: string;
  page: number;
  method: "heading" | "body";
  variant: "consolidated" | "standalone" | null;
}

/** Pure: build the page map from page texts. */
export function buildPageMap(
  doc: DocumentText,
): Omit<PageMap, "usedLlm" | "llmDisagreements" | "generatedAt"> {
  const pageCount = doc.pages.length;
  const tocPages = doc.pages
    .filter((p) => isTocPage(p.text, pageCount))
    .map((p) => p.page);
  const candidates: Candidate[] = [];
  const anchors: Record<string, number[]> = {};

  for (const p of doc.pages) {
    if (tocPages.includes(p.page)) continue;
    const head = headingLines(p.text);
    const first600 = p.text.slice(0, 600);
    const variant: Candidate["variant"] = /consolidated/i.test(first600)
      ? "consolidated"
      : /standalone/i.test(first600)
        ? "standalone"
        : null;
    const pageCandidates: Candidate[] = [];
    for (const a of SECTION_ANCHORS) {
      const idx = head.findIndex((l) => a.re.test(l));
      if (idx >= 0) {
        // the heading itself may say which variant
        const line = head[idx] as string;
        const v: Candidate["variant"] = /consolidated/i.test(line)
          ? "consolidated"
          : /standalone/i.test(line)
            ? "standalone"
            : variant;
        pageCandidates.push({
          label: a.label,
          page: p.page,
          method: idx < 6 ? "heading" : "body",
          variant: a.variants ? v : null,
        });
      }
    }
    // three or more different section headings on one page = a contents / divider page, not a start
    if (new Set(pageCandidates.map((c) => c.label)).size >= 3) {
      tocPages.push(p.page);
      continue;
    }
    candidates.push(...pageCandidates);
    for (const n of NOTE_ANCHORS) {
      if (n.re.test(p.text)) {
        const list = anchors[n.label] ?? [];
        list.push(p.page);
        anchors[n.label] = list;
      }
    }
  }

  // choose a start page per (label, variant): earliest heading-level hit past the front matter
  const chosen = new Map<string, Candidate>();
  const minPage = Math.max(2, Math.floor(pageCount * 0.02));
  const key = (c: Candidate) => {
    if (
      c.label === "auditors_report" ||
      c.label === "balance_sheet" ||
      c.label === "pnl" ||
      c.label === "cash_flow" ||
      c.label === "notes"
    )
      return `${c.label}_${c.variant ?? "standalone"}`;
    return c.label;
  };
  for (const c of candidates) {
    if (c.page < minPage) continue;
    const k = key(c);
    const cur = chosen.get(k);
    if (!cur) chosen.set(k, c);
    else if (cur.method === "body" && c.method === "heading") chosen.set(k, c);
  }
  // financial statements: the consolidated set comes after the standalone set in Indian ARs;
  // when a variant was not labelled, infer it from order (first = standalone, second = consolidated)
  for (const fam of [
    "auditors_report",
    "balance_sheet",
    "pnl",
    "cash_flow",
    "notes",
  ] as const) {
    const s = chosen.get(`${fam}_standalone`);
    const c = chosen.get(`${fam}_consolidated`);
    if (s && !c) {
      const later = candidates.filter(
        (x) => x.label === fam && x.page > s.page + 3 && x.method === "heading",
      );
      const second = later.find((x) => x.variant !== "standalone");
      if (second)
        chosen.set(`${fam}_consolidated`, {
          ...second,
          variant: "consolidated",
        });
    }
  }

  const starts = [...chosen.entries()]
    .map(([label, c]) => ({ label, page: c.page, method: c.method }))
    .sort((a, b) => a.page - b.page);
  const sections: PageMapSection[] = starts.map((s, i) => {
    const next = starts[i + 1];
    const toPage = next ? Math.max(s.page, next.page - 1) : pageCount;
    return {
      label: s.label,
      fromPage: s.page,
      toPage,
      confidence: s.method === "heading" ? 0.85 : 0.6,
      method: s.method,
    };
  });
  if (starts.length && (starts[0] as { page: number }).page > 2) {
    sections.unshift({
      label: "corporate_overview",
      fromPage: 1,
      toPage: (starts[0] as { page: number }).page - 1,
      confidence: 0.5,
      method: "inferred",
    });
  }
  return {
    docId: doc.docId,
    pages: pageCount,
    folioOffset: detectFolioOffset(doc),
    sections,
    anchors,
    tocPages,
  };
}

// ---------------------------------------------------------------------------
// Optional LLM cross-check over the contents pages
// ---------------------------------------------------------------------------

const TocOut = z.object({
  sections: z.array(
    z.object({
      label: z.enum([
        "mdna",
        "directors_report",
        "corporate_governance",
        "brsr",
        "auditors_report_standalone",
        "balance_sheet_standalone",
        "pnl_standalone",
        "cash_flow_standalone",
        "notes_standalone",
        "auditors_report_consolidated",
        "balance_sheet_consolidated",
        "pnl_consolidated",
        "cash_flow_consolidated",
        "notes_consolidated",
        "agm_notice",
      ]),
      printedPage: z.number().int(),
    }),
  ),
});

async function crossCheckWithToc(
  doc: DocumentText,
  map: ReturnType<typeof buildPageMap>,
): Promise<{
  disagreements: PageMap["llmDisagreements"];
  used: boolean;
  model?: string;
}> {
  const tocText = map.tocPages
    .slice(0, 4)
    .map((pg) => `[[page ${pg}]]\n${doc.pages[pg - 1]?.text ?? ""}`)
    .join("\n\n");
  if (!tocText.trim() || map.folioOffset === null)
    return { disagreements: [], used: false };
  const r = await callStructured({
    task: "ar_section_label",
    tier: "bulk",
    schema: TocOut,
    system:
      "You read the table of contents of an Indian annual report. For each listed section return the PRINTED page number where it starts, using the labels given. Only sections present in the contents; JSON only.",
    prompt: `Labels: mdna (Management Discussion & Analysis), directors_report (Board's/Directors' Report), corporate_governance, brsr, auditors_report_standalone / auditors_report_consolidated (Independent Auditor's Report), balance_sheet_*, pnl_* (Statement of Profit and Loss), cash_flow_*, notes_* (Notes to financial statements), agm_notice.\n\nContents pages:\n${tocText.slice(0, 20_000)}`,
    promptVersion: SECTIONS_PROMPT_VERSION,
    maxTokens: 1024,
  });
  const disagreements: PageMap["llmDisagreements"] = [];
  for (const s of r.data.sections) {
    const llmPage = s.printedPage - (map.folioOffset ?? 0);
    const regex = map.sections.find((x) => x.label === s.label);
    if (!regex || Math.abs(regex.fromPage - llmPage) > 2)
      disagreements.push({
        label: s.label,
        regexPage: regex?.fromPage ?? null,
        llmPage,
      });
  }
  return { disagreements, used: true, model: r.model };
}

// ---------------------------------------------------------------------------
// Orchestration + storage
// ---------------------------------------------------------------------------

const PAGE_MAP_SECTION = "page_map";

interface PageMapStore {
  docs: Record<string, PageMap>;
}

async function readStore(isin: string): Promise<PageMapStore> {
  const rows = await db
    .select()
    .from(researchSections)
    .where(
      and(
        eq(researchSections.isin, isin),
        eq(researchSections.section, PAGE_MAP_SECTION),
      ),
    )
    .limit(1);
  try {
    const v = rows[0] ? (JSON.parse(rows[0].json) as PageMapStore) : null;
    return v && typeof v === "object" && v.docs ? v : { docs: {} };
  } catch {
    return { docs: {} };
  }
}

async function writeStore(
  isin: string,
  store: PageMapStore,
  model: string | null,
): Promise<void> {
  const row = {
    isin,
    section: PAGE_MAP_SECTION,
    model,
    promptVersion: SECTIONS_PROMPT_VERSION,
    json: JSON.stringify(store),
    factIdsJson: "[]",
    generatedAt: Date.now(),
  };
  await db
    .insert(researchSections)
    .values(row)
    .onConflictDoUpdate({
      target: [researchSections.isin, researchSections.section],
      set: row,
    });
}

/** Build (and store) the page map for a stored annual report. Null when the document is unknown. */
export async function mapSectionsForDocument(
  docId: string,
  opts: { useLlm?: boolean; force?: boolean } = {},
): Promise<PageMap | null> {
  const d = (
    await db.select().from(documents).where(eq(documents.id, docId)).limit(1)
  )[0];
  if (!d) return null;
  const store = await readStore(d.isin);
  const existing = store.docs[docId];
  if (existing && !opts.force && (!opts.useLlm || existing.usedLlm))
    return existing;
  const doc = await loadDocumentText(docId);
  if (!doc) return null;
  const t0 = Date.now();
  const base = buildPageMap(doc);
  let usedLlm = false;
  let disagreements: PageMap["llmDisagreements"] = [];
  let model: string | null = null;
  if (opts.useLlm) {
    try {
      const x = await crossCheckWithToc(doc, base);
      usedLlm = x.used;
      disagreements = x.disagreements;
      model = x.model ?? null;
    } catch (e) {
      log.warn(
        { docId, err: e instanceof Error ? e.message : String(e) },
        "toc cross-check failed",
      );
    }
  }
  const map: PageMap = {
    ...base,
    usedLlm,
    llmDisagreements: disagreements,
    generatedAt: Date.now(),
  };
  store.docs[docId] = map;
  await writeStore(d.isin, store, model);
  log.info(
    {
      docId,
      pages: map.pages,
      sections: map.sections.length,
      folioOffset: map.folioOffset,
      usedLlm,
      disagreements: disagreements.length,
      ms: Date.now() - t0,
    },
    "page map built",
  );
  return map;
}

/** Contract from extract/index.ts: annual report → section page map. */
export async function mapSections(doc: DocumentText): Promise<SectionMap> {
  const m = buildPageMap(doc);
  return {
    docId: doc.docId,
    sections: m.sections.map(({ label, fromPage, toPage, confidence }) => ({
      label,
      fromPage,
      toPage,
      confidence,
    })),
  };
}

/**
 * Page texts for a section (`mdna`, `balance_sheet_consolidated`, …) or a note
 * anchor (`related_party`, `contingent_liabilities`, `borrowings`, `segment`).
 * Empty pages array when the section is unknown. `maxPages` caps long sections.
 */
export async function getSectionText(
  docId: string,
  section: string,
  opts: { maxPages?: number } = {},
): Promise<{
  pages: Array<{ page: number; text: string }>;
  fromPage: number | null;
  toPage: number | null;
}> {
  const d = (
    await db.select().from(documents).where(eq(documents.id, docId)).limit(1)
  )[0];
  if (!d) return { pages: [], fromPage: null, toPage: null };
  const store = await readStore(d.isin);
  const map = store.docs[docId] ?? (await mapSectionsForDocument(docId));
  if (!map) return { pages: [], fromPage: null, toPage: null };
  const doc = await loadDocumentText(docId);
  if (!doc) return { pages: [], fromPage: null, toPage: null };
  const byPage = new Map(doc.pages.map((p) => [p.page, p.text]));
  const sec = map.sections.find((s) => s.label === section);
  const max = opts.maxPages ?? 40;
  if (sec) {
    const pages: Array<{ page: number; text: string }> = [];
    for (let pg = sec.fromPage; pg <= sec.toPage && pages.length < max; pg++)
      pages.push({ page: pg, text: byPage.get(pg) ?? "" });
    return { pages, fromPage: sec.fromPage, toPage: sec.toPage };
  }
  const anchorPages = map.anchors[section];
  if (anchorPages?.length) {
    // prefer anchors inside the consolidated notes when that range is known
    const cons = map.sections.find((s) => s.label === "notes_consolidated");
    const inCons = cons
      ? anchorPages.filter((p) => p >= cons.fromPage && p <= cons.toPage)
      : [];
    const pick = (inCons.length ? inCons : anchorPages).slice(0, max);
    return {
      pages: pick.map((pg) => ({ page: pg, text: byPage.get(pg) ?? "" })),
      fromPage: pick[0] ?? null,
      toPage: pick[pick.length - 1] ?? null,
    };
  }
  return { pages: [], fromPage: null, toPage: null };
}
