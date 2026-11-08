/**
 * PDF → per-page text with `unpdf` (owner: Builder C). Pure over bytes.
 *
 * - 1-indexed pages, text with the line structure pdf.js reports (hasEOL → "\n").
 * - 2-up spreads (page width > 1.4 × height, common in Indian annual reports)
 *   interleave the two printed pages in content order; those pages are
 *   rebuilt from positioned text items, left column first, so the reading
 *   order is sane. Page numbers stay PDF pages (what `#page=N` needs).
 * - Text quality: chars/page < 200 ⇒ "low-text" page; invisible OCR layers
 *   (text render mode 3 over a full-page image) are counted separately.
 */
import {
  extractText,
  extractTextItems,
  getDocumentProxy,
  inspectPages,
  type StructuredTextItem,
} from "unpdf";

export type TextQuality = "ok" | "mixed" | "low" | "scanned";

export interface ExtractedPage {
  page: number;
  text: string;
  /** non-whitespace characters */
  chars: number;
  /** true when rebuilt from a 2-up spread */
  spread: boolean;
  /** true when most text on the page is an invisible OCR layer */
  ocr: boolean;
}

export interface ExtractedPdf {
  pages: ExtractedPage[];
  pageCount: number;
  chars: number;
  lowTextPages: number;
  ocrPages: number;
  spreads: boolean;
  textQuality: TextQuality;
  elapsedMs: number;
}

export const LOW_TEXT_CHARS = 200;

export function countChars(s: string): number {
  return s.replace(/\s+/g, "").length;
}

/** Classify a whole document from its per-page character counts. */
export function classifyTextQuality(charsPerPage: number[]): TextQuality {
  if (!charsPerPage.length) return "scanned";
  const low = charsPerPage.filter((c) => c < LOW_TEXT_CHARS).length;
  const ratio = low / charsPerPage.length;
  if (ratio >= 0.8) return "scanned";
  if (ratio >= 0.3) return "low";
  if (low > 0) return "mixed";
  return "ok";
}

/**
 * Rebuild page text from positioned items, column by column (left, then
 * right of `midX`). Items sharing a baseline (|Δy| < 0.6 × font size) form a line.
 */
export function itemsToColumnText(
  items: StructuredTextItem[],
  midX: number,
): string {
  const cols: StructuredTextItem[][] = [[], []];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const cx = it.x + it.width / 2;
    (cols[cx < midX ? 0 : 1] as StructuredTextItem[]).push(it);
  }
  const out: string[] = [];
  for (const col of cols) {
    col.sort((a, b) => b.y - a.y || a.x - b.x);
    let line: StructuredTextItem[] = [];
    let lineY: number | null = null;
    const flush = () => {
      if (!line.length) return;
      line.sort((a, b) => a.x - b.x);
      out.push(
        line
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      line = [];
    };
    for (const it of col) {
      const tol = Math.max(2, (it.fontSize || it.height || 10) * 0.6);
      if (lineY === null || Math.abs(it.y - lineY) <= tol) {
        line.push(it);
        lineY = lineY === null ? it.y : (lineY + it.y) / 2;
      } else {
        flush();
        line.push(it);
        lineY = it.y;
      }
    }
    flush();
  }
  return out.join("\n");
}

export interface ExtractOptions {
  /** also run inspectPages for OCR-layer detection (default true; ~10 ms/page) */
  inspect?: boolean;
  /** treat pages with width > ratio × height as 2-up spreads (default 1.4) */
  spreadRatio?: number;
}

/** Extract every page's text from PDF bytes. Throws on unparseable input. */
export async function extractPdfPages(
  bytes: Uint8Array,
  opts: ExtractOptions = {},
): Promise<ExtractedPdf> {
  const t0 = Date.now();
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 } as never);
  const pageCount = pdf.numPages;
  const { text } = await extractText(pdf, { mergePages: false });

  // spread detection on a sample of pages (first 12 + a few in the middle)
  const spreadRatio = opts.spreadRatio ?? 1.4;
  const sampleIdx = new Set<number>();
  for (let i = 1; i <= Math.min(pageCount, 12); i++) sampleIdx.add(i);
  for (const f of [0.25, 0.5, 0.75])
    sampleIdx.add(Math.max(1, Math.min(pageCount, Math.round(pageCount * f))));
  let wide = 0;
  const widths = new Map<number, number>();
  for (const i of sampleIdx) {
    const p = await pdf.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    widths.set(i, vp.width);
    if (vp.width > spreadRatio * vp.height) wide++;
  }
  const spreads = wide >= Math.ceil(sampleIdx.size * 0.5);

  let items: StructuredTextItem[][] | null = null;
  if (spreads) {
    items = (await extractTextItems(pdf)).items;
  }

  let ocrFlags: boolean[] = [];
  if (opts.inspect !== false) {
    try {
      const insp = await inspectPages(pdf);
      ocrFlags = insp.pages.map(
        (p) => p.textLength > 0 && p.invisibleTextLength >= p.textLength * 0.5,
      );
    } catch {
      ocrFlags = [];
    }
  }

  const pages: ExtractedPage[] = [];
  for (let i = 0; i < pageCount; i++) {
    let pageText = text[i] ?? "";
    let spread = false;
    if (spreads && items?.[i]) {
      const p = await pdf.getPage(i + 1);
      const vp = p.getViewport({ scale: 1 });
      if (vp.width > spreadRatio * vp.height) {
        const rebuilt = itemsToColumnText(
          items[i] as StructuredTextItem[],
          vp.width / 2,
        );
        if (rebuilt.length >= pageText.length * 0.7) {
          pageText = rebuilt;
          spread = true;
        }
      }
    }
    pageText = pageText
      .split("\u0000")
      .join("")
      .replace(/[ \t]+\n/g, "\n");
    pages.push({
      page: i + 1,
      text: pageText,
      chars: countChars(pageText),
      spread,
      ocr: ocrFlags[i] ?? false,
    });
  }
  // release pdf.js resources (API differs across builds; best effort)
  const d = pdf as unknown as {
    destroy?: () => Promise<void>;
    cleanup?: () => Promise<void>;
  };
  await (d.destroy ?? d.cleanup)?.call(pdf)?.catch(() => undefined);

  const charsPerPage = pages.map((p) => p.chars);
  return {
    pages,
    pageCount,
    chars: charsPerPage.reduce((s, c) => s + c, 0),
    lowTextPages: charsPerPage.filter((c) => c < LOW_TEXT_CHARS).length,
    ocrPages: pages.filter((p) => p.ocr).length,
    spreads,
    textQuality: classifyTextQuality(charsPerPage),
    elapsedMs: Date.now() - t0,
  };
}
