/**
 * BSE document helpers + the generic PDF downloader (owner: Builder C).
 *
 * The BSE *JSON API* is TLS-fingerprinted (403 to plain fetch). `fetchBseTranscriptPdfs`
 * tries once and returns [] when blocked. BSE PDF *files* download fine with a desktop UA:
 *   https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=<uuid>.pdf   (302 →)
 *   https://www.bseindia.com/xml-data/corpfiling/AttachLive|AttachHis/<uuid>.pdf
 * Both direct paths serve any uuid, so the aspx hop can be skipped.
 */
import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "engine/sources/bse-docs" });

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 60_000;

const BSE_ASPX_RE =
  /bseindia\.com\/stockinfo\/AnnPdfOpen\.aspx\?Pname=([0-9a-f-]+\.pdf)/i;

/** `AnnPdfOpen.aspx?Pname=<uuid>.pdf` → direct `AttachLive/<uuid>.pdf`; other URLs unchanged. */
export function normaliseBseUrl(url: string): string {
  const m = BSE_ASPX_RE.exec(url);
  if (!m?.[1]) return url;
  return `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${m[1]}`;
}

/** Alternate BSE path (AttachHis ↔ AttachLive) to try when the first 404s. */
export function alternateBseUrl(url: string): string | null {
  if (/\/AttachLive\//i.test(url))
    return url.replace(/\/AttachLive\//i, "/AttachHis/");
  if (/\/AttachHis\//i.test(url))
    return url.replace(/\/AttachHis\//i, "/AttachLive/");
  return null;
}

export function isBseUrl(url: string): boolean {
  return /bseindia\.com/i.test(url);
}

export class DownloadError extends Error {
  readonly url: string;
  readonly status: number | null;
  constructor(url: string, message: string, status: number | null = null) {
    super(message);
    this.name = "DownloadError";
    this.url = url;
    this.status = status;
  }
}

export interface DownloadedPdf {
  url: string;
  /** URL actually served (after BSE path fallback) */
  finalUrl: string;
  bytes: Uint8Array;
  sha256: string;
  contentType: string | null;
  elapsedMs: number;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPdfMagic(bytes: Uint8Array): boolean {
  // some servers prepend a BOM / whitespace; look in the first 1 KB
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF");
}

async function fetchOnce(
  url: string,
  timeoutMs: number,
): Promise<DownloadedPdf> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (res.status !== 200)
      throw new DownloadError(url, `HTTP ${res.status}`, res.status);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_PDF_BYTES)
      throw new DownloadError(
        url,
        `content-length ${len} exceeds ${MAX_PDF_BYTES}`,
      );
    const contentType = res.headers.get("content-type");

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new DownloadError(url, "no response body");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_PDF_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new DownloadError(url, `body exceeds ${MAX_PDF_BYTES} bytes`);
        }
        chunks.push(value);
      }
    }
    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    if (!isPdfMagic(bytes)) {
      const head = bytes.subarray(0, 200).toString("utf8").replace(/\s+/g, " ");
      throw new DownloadError(
        url,
        `not a PDF (content-type ${contentType ?? "?"}; starts "${head.slice(0, 80)}")`,
        200,
      );
    }
    return {
      url,
      finalUrl: res.url || url,
      bytes: new Uint8Array(bytes),
      sha256: sha256Hex(bytes),
      contentType,
      elapsedMs: Date.now() - t0,
    };
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new DownloadError(
      url,
      /abort/i.test(msg) ? `timeout after ${timeoutMs} ms` : msg,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download a PDF with a desktop UA, hard timeout and size cap; validates the
 * `%PDF` magic. For BSE URLs the aspx hop is skipped and the AttachLive /
 * AttachHis sibling path is tried on 404.
 */
export async function downloadPdf(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<DownloadedPdf> {
  const timeoutMs = opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const primary = normaliseBseUrl(url);
  try {
    const r = await fetchOnce(primary, timeoutMs);
    return { ...r, url };
  } catch (e) {
    const alt = isBseUrl(primary) ? alternateBseUrl(primary) : null;
    if (
      alt &&
      e instanceof DownloadError &&
      (e.status === 404 || e.status === 200)
    ) {
      log.info({ url: primary, alt }, "bse: trying sibling path");
      const r = await fetchOnce(alt, timeoutMs);
      return { ...r, url };
    }
    throw e;
  }
}

/**
 * Pull transcript PDF URLs out of an `AnnSubCategoryGetData` body.
 * Recent filings live on AttachLive; the downloader tries AttachHis on 404.
 */
export function bseTranscriptPdfUrls(body: unknown): string[] {
  const table = Array.isArray(body)
    ? body
    : body &&
        typeof body === "object" &&
        Array.isArray((body as { Table?: unknown }).Table)
      ? ((body as { Table: unknown[] }).Table ?? [])
      : [];
  const out: string[] = [];
  for (const row of table) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const att = String(r.ATTACHMENTNAME ?? "");
    if (!/\.pdf$/i.test(att)) continue;
    const blob = `${r.NEWSSUB ?? ""} ${r.HEADLINE ?? ""} ${r.SUBCATNAME ?? ""}`;
    if (!/transcript/i.test(blob)) continue;
    out.push(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${att}`);
  }
  return [...new Set(out)];
}

/**
 * Earnings-call transcript attachments for a BSE scrip, or [] when the API
 * is blocked (403) or returns something that is not the Table payload.
 * Dates are `YYYYMMDD`.
 */
export async function fetchBseTranscriptPdfs(
  scripCode: string,
  fromYmd: string,
  toYmd: string,
): Promise<string[]> {
  const qs = new URLSearchParams({
    pageno: "1",
    strCat: "Company Update",
    strPrevDate: fromYmd,
    strScrip: scripCode,
    strSearch: "P",
    strToDate: toYmd,
    strType: "C",
    subcategory: "Earnings Call Transcript",
  });
  const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?${qs}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.bseindia.com/",
        Origin: "https://www.bseindia.com",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const t = text.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return [];
    return bseTranscriptPdfUrls(JSON.parse(t) as unknown);
  } catch (e) {
    log.info(
      { scripCode, err: e instanceof Error ? e.message : String(e) },
      "bse transcript lookup unavailable",
    );
    return [];
  }
}
