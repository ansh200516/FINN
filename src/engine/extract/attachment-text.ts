/**
 * Lazy attachment text: download the filing (PDF or the NSE XBRL zip for
 * KMP changes) and extract text with `unpdf`. Only Tier 1/2 categories are
 * worth the bytes (newspaper copies, trading-window notices, certificates and
 * ESOP allotments are skipped by `shouldFetchAttachment`).
 *
 * Caps: 15 MB download, 30 s timeout, text truncated to ~60k chars. Scanned
 * PDFs (< MIN_TEXT_CHARS of text) return null so callers fall back to the
 * subject line / voiceSummary. Results are cached on disk by URL hash.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/lib/logger";
import { readZipEntries } from "../sources/bhavcopy";
import {
  ATTACHMENT_MAX_BYTES,
  BodyTooLargeError,
  fetchAttachment,
  HttpError,
} from "../sources/nse-announcements";
import type { Category, Classification } from "../types";

const log = logger.child({ mod: "engine/extract/attachment-text" });

export const MAX_TEXT_CHARS = 60_000;
export const MIN_TEXT_CHARS = 300;
export const DEFAULT_TEXT_CACHE_DIR = join(
  process.cwd(),
  "data",
  "cache",
  "attachments",
);

export interface AttachmentText {
  text: string;
  pages: number;
  bytes: number;
  truncated: boolean;
  kind: "pdf" | "xbrl" | "other";
  /** cache hit */
  cached: boolean;
}

/** Categories whose Tier 1/2 items get their attachment downloaded. */
const FETCH_CATEGORIES: ReadonlySet<Category> = new Set([
  "results",
  "m_and_a",
  "fund_raise",
  "management_change",
  "litigation",
  "insider_trading",
  "credit_rating",
  "dividend",
  "bonus_split",
  "capex",
  "press_release",
  "pledging",
]);

const SKIP_SUBCATEGORIES: ReadonlySet<string> = new Set([
  "newspaper",
  "esop",
  "certificate",
  "trading_window",
  "admin",
  "bm_intimation",
  "presentation", // decks are large and the results card comes from XBRL
  "cp",
  "debt",
  "call_money",
  "csr",
  "spurt",
  "schedule",
  "record_date",
  "payment",
]);

export function shouldFetchAttachment(
  cls: Pick<Classification, "category" | "subcategory" | "tier">,
  attachmentUrl: string | null | undefined,
  attachmentSizeBytes: number | null | undefined,
): boolean {
  if (!attachmentUrl) return false;
  if (cls.tier === 3) return false;
  if (!FETCH_CATEGORIES.has(cls.category)) return false;
  if (cls.subcategory && SKIP_SUBCATEGORIES.has(cls.subcategory)) return false;
  if (attachmentSizeBytes && attachmentSizeBytes > ATTACHMENT_MAX_BYTES)
    return false;
  // results outcome PDFs are 5–25 MB newspaper-like dumps; the headline numbers come from XBRL
  if (
    cls.category === "results" &&
    attachmentSizeBytes &&
    attachmentSizeBytes > 6 * 1024 * 1024
  )
    return false;
  return true;
}

function cacheKey(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

/** True when the text (or the "empty/scanned" marker) for this URL is already on disk. */
export function hasCachedAttachmentText(
  url: string,
  cacheDir = DEFAULT_TEXT_CACHE_DIR,
): boolean {
  const u = url.trim();
  return u.length > 0 && existsSync(join(cacheDir, `${cacheKey(u)}.json`));
}

/** Collapse whitespace runs but keep paragraph breaks. */
export function tidyText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** XBRL/XML → "LocalName: value" lines (for KMP-change zips: NameOfDesignatedPerson, BriefProfile …). */
export function xmlToLines(xml: string): string {
  const out: string[] = [];
  const re =
    /<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b[^>]*>([^<]{1,4000})<\/(?:[A-Za-z_][\w.-]*:)?\2>/g;
  for (const m of xml.matchAll(re)) {
    const name = m[2] ?? "";
    const val = (m[3] ?? "").replace(/\s+/g, " ").trim();
    if (
      !val ||
      /^(context|unit|schemaRef|identifier|startDate|endDate|instant|measure)$/i.test(
        name,
      )
    )
      continue;
    out.push(`${name}: ${val}`);
  }
  return out.join("\n");
}

export async function pdfBytesToText(
  bytes: Uint8Array,
): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const r = await extractText(doc, { mergePages: false });
  const pages = r.text.map((p, i) => `\n[[page ${i + 1}]]\n${p}`);
  return { text: tidyText(pages.join("\n")), pages: r.totalPages };
}

export interface ExtractAttachmentOptions {
  cacheDir?: string;
  maxChars?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Download + extract. Returns null when the attachment is missing, too large,
 * not text (scanned) or the download failed — the caller falls back to the
 * subject / voiceSummary. Never throws for network/parse problems.
 */
export async function extractAttachmentText(
  url: string,
  o: ExtractAttachmentOptions = {},
): Promise<AttachmentText | null> {
  const u = url.trim();
  if (!u) return null;
  const cacheDir = o.cacheDir ?? DEFAULT_TEXT_CACHE_DIR;
  const maxChars = o.maxChars ?? MAX_TEXT_CHARS;
  const cachePath = join(cacheDir, `${cacheKey(u)}.json`);
  if (existsSync(cachePath)) {
    try {
      const c = JSON.parse(readFileSync(cachePath, "utf8")) as
        | AttachmentText
        | { empty: true };
      if ("empty" in c) return null;
      return { ...c, cached: true };
    } catch {
      // fall through and refetch
    }
  }
  let bytes: Uint8Array;
  try {
    bytes = await fetchAttachment(u, {
      maxBytes: o.maxBytes,
      timeoutMs: o.timeoutMs,
    });
  } catch (e) {
    if (e instanceof BodyTooLargeError)
      log.warn({ url: u, bytes: e.bytes }, "attachment too large — skipped");
    else if (e instanceof HttpError)
      log.warn({ url: u, status: e.status }, "attachment download failed");
    else
      log.warn(
        { url: u, err: e instanceof Error ? e.message : String(e) },
        "attachment download error",
      );
    return null;
  }
  let text = "";
  let pages = 0;
  let kind: AttachmentText["kind"] = "other";
  try {
    const isPdf =
      bytes.length > 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46; // %PDF
    const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; // PK
    if (isPdf) {
      const r = await pdfBytesToText(bytes);
      text = r.text;
      pages = r.pages;
      kind = "pdf";
    } else if (isZip) {
      const parts: string[] = [];
      for (const e of readZipEntries(bytes)) {
        if (/\.xml$/i.test(e.name)) {
          parts.push(xmlToLines(new TextDecoder("utf-8").decode(e.data)));
          kind = "xbrl";
        } else if (/\.pdf$/i.test(e.name)) {
          const r = await pdfBytesToText(e.data);
          parts.push(r.text);
          pages += r.pages;
          if (kind !== "xbrl") kind = "pdf";
        }
      }
      text = tidyText(parts.join("\n\n"));
    } else {
      text = tidyText(new TextDecoder("utf-8").decode(bytes));
    }
  } catch (e) {
    log.warn(
      { url: u, err: e instanceof Error ? e.message : String(e) },
      "attachment text extraction failed",
    );
    return null;
  }
  if (text.length < MIN_TEXT_CHARS) {
    log.info(
      { url: u, chars: text.length, pages },
      "attachment has too little text (scanned?) — skipped",
    );
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ empty: true }));
    return null;
  }
  const truncated = text.length > maxChars;
  const result: AttachmentText = {
    text: truncated ? text.slice(0, maxChars) : text,
    pages,
    bytes: bytes.byteLength,
    truncated,
    kind,
    cached: false,
  };
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(result));
  } catch (e) {
    log.warn(
      { url: u, err: e instanceof Error ? e.message : String(e) },
      "attachment cache write failed",
    );
  }
  log.info(
    { url: u, chars: result.text.length, pages, bytes: bytes.byteLength, kind },
    "attachment text extracted",
  );
  return result;
}
