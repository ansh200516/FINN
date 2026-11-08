# 05 — NSE/BSE corporate announcements feed: verified playbook

Author: announcements-feed specialist. Everything below was executed from the build machine (macOS, residential Indian IP) on Sun 8 Nov 2026, 17:15–17:50 IST, with Python 3.12 + `requests` 2.x (and `curl_cffi` 0.17 for the TLS-impersonation checks). Scratch code and raw dumps live in `/tmp/finn-ann/` (not in the repo). Items I could not verify are marked **UNVERIFIED**.

## 0. Executive summary

1. **NSE's announcements API works, is fast and deep.** `GET https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=X&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY` returned 200 on **40/40** measured calls (p50 0.20 s, p90 0.24 s). A per-symbol call *without dates* returns the symbol's **entire history back to 2004** (RELIANCE: 3,382 rows, 0.66 s). Market-wide windows up to 365 days work (186k rows, 40 s). Attachments (`nsearchives.nseindia.com`) need only a `User-Agent`.
2. **BSE's API also works** (`api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w`), **51/51** pages OK on a full-day pull (p50 0.73 s), but it is pickier: hard-requires `User-Agent` + `Accept-Language` + `Origin: https://www.bseindia.com` *plus* a plausible set of other browser headers (Akamai scores cumulatively), market-wide queries are **single-day only**, per-scrip ranges are capped at **1 year** (400 beyond), and attachments split across `AttachLive/` (recent) and `AttachHis/` (older). BSE gives you an exchange-assigned **category/sub-category** and a `CRITICALNEWS` flag, which NSE does not.
3. **Structured quarterly results exist — we do not need to parse results PDFs.** Two independent, cross-validated sources:
   - NSE `/api/integrated-filing-results?index=equities&symbol=X&size=100` lists every SEBI "Integrated Filing – Financials" since Q4 FY25 with a ~100 KB **XBRL** (`INTEGRATED_FILING_INDAS_*.xml`) containing tagged `RevenueFromOperations`, `FinanceCosts`, `DepreciationDepletionAndAmortisationExpense`, `ProfitBeforeTax`, `ProfitLossForPeriod`, EPS, segments. Pre-FY25 quarters are on the legacy `/api/corporates-financial-results` endpoint (same XBRL style). My extractor produced **5 quarters + QoQ/YoY in ~2 s per symbol** for RELIANCE, TCS, HDFCBANK (bank taxonomy), BAJFINANCE (NBFC taxonomy), POLYCAB, ICICIBANK.
   - BSE `Corp_BSEDnBResults_SEBI_Consolidated_Res_ng/w` and `Corp_detailedResult_Transpose_ng/w` return the same P&L as **JSON rows** (₹ million). RELIANCE Q2 FY27 consolidated: Net Sales 33,28,610 / PBT 3,86,130 / Net Profit 2,95,500 (₹ mn) == NSE XBRL 3,328,610,000,000 / 386,130,000,000 / 295,500,000,000 — **exact match**.
4. **New since ~7 Nov 2026: NSE ships an AI summary per announcement** (`voiceSummary`, ~100–150 words, plus `voiceUrl` mp3). Present on 453/455 items of the last 24 h, **absent on everything older** (0/169 for RELIANCE's last year). For the live 24 h digest this removes most PDF parsing; for backfill it does not exist.
5. **Classification:** the exchange-assigned NSE `desc` (≈40 distinct values in the sample) plus the one-line `attchmntText` lets a rules/regex classifier label **~98%** of 306 real items across 20 companies; the residue is "Updates" with content-free text. Precision of the regex stage is the risk, not coverage (see §6).
6. **Deployment:** Akamai gates both exchanges, but the gate is primarily **TLS/browser fingerprint + header plausibility, and per-endpoint**, not a blanket datacenter-IP block. Independent Aug-2026 evidence shows `/api/corporate-announcements` returning 200 from Cloudflare Workers egress (22/22) while `quote-equity` 403s everywhere; NSEPython moved to `curl_cffi` Chrome impersonation in Oct 2026 because plain `requests` TLS started getting blocked. Plain `requests` still works from this residential IP today. **Recommendation: fetch with `curl_cffi` (`impersonate="chrome"`), run the scheduler from the laptop (launchd/cron) or a Cloudflare Worker, write into a hosted DB, and ship the app with a seeded snapshot so a block can never kill the demo.**

---

## 1. NSE — corporate announcements

### 1.1 Session handshake (what is actually required)

| Variant tested | Result |
|---|---|
| `GET https://www.nseindia.com/` with Chrome UA (plain `requests`) | **403** (Akamai `AKA_A2` cookie only). The homepage is *not* a usable warm-up URL for plain requests. With `curl_cffi` Chrome impersonation → 200. |
| `GET https://www.nseindia.com/companies-listing/corporate-filings-announcements` with full browser headers | **200**, sets `_abck`, `ak_bmsc`, `bm_sz`, `nsit`. Use this as the warm-up URL. |
| API call with full browser headers, **no warm-up, no cookies** | **200** (2.6 MB TCS history). Warm-up is belt-and-braces from this IP today. |
| API call with `User-Agent` only (warm-up also UA only) | **200** |
| API call with default `python-requests/2.x` UA | **ReadTimeout** — NSE *tarpits* (never answers) rather than 403. Always set `timeout=`. |
| Advertising `Accept-Encoding: br` without the `brotli` package | 200 but garbage body — install `brotli` or omit `br`. |

Headers that worked everywhere (use these):

```python
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
HDR_HTML = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br", "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none"}
HDR_API  = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
            "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin"}
```

Cookie lifetime: a session warmed at 17:38 IST returned 200 at 3, 6 and 9 min with no re-warm (Akamai kept adding `ak_bmsc`, then `bm_sv` on the way); the observation was still running at report time. Since the API also answered 200 with **no cookies at all** (row 3 above), cookie expiry is not a practical failure mode from this IP. Operationally: re-warm on any 401/403/timeout and every ~10 min anyway; it costs 0.1 s.

### 1.2 Endpoint and parameters

`GET /api/corporate-announcements` with:

| param | values seen to work | notes |
|---|---|---|
| `index` | `equities`, `sme`, `debt`, `mf`, `invitsreits` | we only need `equities` |
| `symbol` | NSE symbol, e.g. `RELIANCE` | optional |
| `from_date`, `to_date` | `DD-MM-YYYY` | optional; **no dates + symbol → full history**; no dates and no symbol → last ~20 items |

Measured window behaviour (market-wide, all equities):

| window | rows | latency |
|---|---|---|
| 1 day (07→08 Nov, Sat→Sun) | 455 | 0.09 s (cached) / 1.6 s cold |
| 7 d | 6,796 | 2.0 s |
| 30 d | 17,304 | 3.0 s |
| 90 d | 52,686 | 8.0 s |
| 180 d | 106,476 | 42 s |
| 365 d | 186,472 | 41 s |

Per symbol: RELIANCE 30 d → 19 rows (0.18 s), 365 d → 169, 730 d → 362; no dates → 3,382 rows back to 2004-12-13. **No pagination exists; the server returns everything.** No rate limiting observed: 30 sequential + 10 burst calls, all 200 (p50 0.20 s). Market-wide volume: NSE ≈ 600–1,000 announcements/day averaged over 7–30 days (6,796 rows / 7 d; 17,304 / 30 d; 455 on the Sat→Sun window); BSE counted 2,530 on Fri 6 Nov (results season; BSE has 5,146 active scrips vs NSE's 2,632 and lists more compliance paperwork).

### 1.3 Response shape (real row, 8 Nov 2026)

```json
{
 "symbol": "AUTOIND", "sm_name": "Autoline Industries Limited", "sm_isin": "INE718H01014", "smIndustry": "Auto Ancillaries",
 "desc": "Copy of Newspaper Publication",
 "attchmntText": "Autoline Industries Limited has informed the Exchange about Copy of Newspaper Publication",
 "attchmntFile": "https://nsearchives.nseindia.com/corporate/AUTOIND_08112026171259_AIL_-_FS_Q2_Newspaper_sd.pdf",
 "attFileSize": "6.08 MB", "fileSize": "6.08 MB",
 "an_dt": "08-Nov-2026 17:13:13", "exchdisstime": "08-Nov-2026 17:13:13", "sort_date": "2026-11-08 17:13:13", "dt": "08112026171313",
 "difference": "00:00:00", "seq_id": "106852907", "hasXbrl": true, "csvName": null, "bflag": null, "old_new": null, "orgid": null,
 "voiceSummary": "Autoline Industries Limited filed a notice with BSE and NSE regarding the publication of financial results for the quarter and half year ended September 30, 2026. The company published advertisements in Financial Express and Loksatta on November 07, 2026. ...",
 "voiceUrl": "https://nsearchives.nseindia.in/ann_voice/AUTOIND_08112026171259_AIL_-_FS_Q2_Newspaper_sd.mp3"
}
```

Field notes:
- `desc` is the **exchange-assigned subject category** (≈40 distinct values in 306 sampled items; full list in §6). `attchmntText` is the company's one-line subject. Both are always present.
- `attchmntFile` present on 455/455; 453 `.pdf`, 2 `.zip` (KMP disclosures). `hasXbrl` was `true` on 100% of rows, so it is not a useful signal.
- `an_dt` is the filing time; `exchdisstime` the dissemination time; `difference` the gap (almost always 0). Use `sort_date` (ISO-ish) as the canonical timestamp; **treat as IST**.
- `seq_id` is a stable unique id — use it as the primary key / dedupe key.
- `voiceSummary` / `voiceUrl`: present on items filed from 7 Nov 2026 onwards only (453/455 of the 24 h pull; 10/306 of the 30-day sample, all dated 7 Nov; 0/169 of RELIANCE's trailing year). Whether NSE will backfill is **UNVERIFIED**; design for "present for live items, absent for history".

### 1.4 Attachments

- Only `User-Agent` is required: `requests.get(url, headers={"User-Agent": UA})` → 200 for both `nsearchives.nseindia.com/corporate/*.pdf` and `/corporate/xbrl/*.xml`. **No UA → the connection hangs** (ReadTimeout at 12 s), so always set a timeout.
- Sizes over 305 sampled attachments: median 510 KB, p90 5.6 MB, max 26 MB. Results-related attachments (n=37): median 3.1 MB. Download speed was fine (5.4 MB in 0.3 s).
- Text-based, not scanned: `pdftotext -layout -l 6` on three RELIANCE filings returned 2k–19k chars per 6 pages in ≤0.1 s, and the press release text contained `Profit Before Tax 38,613 30,630 29,124 32.6 69,243 57,346` — i.e. the same PBT as the XBRL (386,130 ₹ mn = 38,613 ₹ cr), with QoQ and YoY columns. A BSE 3.7 MB AGM-notice PDF and a 5.4 MB "Outcome of Board Meeting" PDF were also text-extractable. (Scanned PDFs do exist in the small-cap tail; treat `len(text) < 300` as "needs OCR or skip".)

### 1.5 Other NSE corporate endpoints (all tested 200 unless noted)

| endpoint | params that worked | shape / notes |
|---|---|---|
| `/api/integrated-filing-results` | `index=equities&symbol=X&size=100` (also `from_date/to_date`; default page size 20, `size` up to ≥100, `page` 0-based) | `{"data":[...],"size","page","totalCount"}`; rows have `type` ∈ {"Integrated Filing- Financials", "Integrated Filing- Governance"}, `qe_Date` ("30-SEP-2026"), `consolidated`, `audited`, `type_Sub` ("Original"/"Revision"), `xbrl` (XML), `ixbrl` (HTML), `creation_Date`. **This is the structured-results source since Q4 FY25.** |
| `/api/corporates-financial-results` | `index=equities&period=Quarterly[&symbol=X]` (`Annual`, `Half-Yearly` too; `from_date/to_date` returned 0 rows) | list; rows have `toDate`, `consolidated`, `audited`, `filingDate`, `xbrl` (`INDAS_*.xml`), `resultDetailedDataLink` (old HTML). **Frozen at Q3 FY25 (31-Dec-2024)** — every row's `toDate` is ≤ Dec-2024. Use only for history before Mar-2025. |
| `/api/corporate-board-meetings` | `index=equities[&symbol=X]` | rows: `bm_date`, `bm_purpose` ("Financial Results"/"Board Meeting Intimation"), `bm_desc`, `attachment`, `ixbrl`. Only ~20 rows returned by default. |
| `/api/event-calendar` | `index=equities[&symbol=X]` | 626 upcoming events market-wide; `{symbol, company, purpose, bm_desc, date}` — the cheap way to know **when results are due**. |
| `/api/corporates-corporateActions` | `index=equities[&symbol=X]` | 20 rows; `subject` ("Interim Dividend - Rs 20 Per Share"), `exDate`, `recDate`, `faceVal`. |
| `/api/corporates-pit` (insider trading) | `index=equities&symbol=X&from_date&to_date` | `{"acqNameList":[...],"data":[...]}`; rows: `acqName`, `personCategory`, `secAcq`, `secVal`, `tdpTransactionType` (Buy/Sell), `acqMode`, `date`, `xbrl`. Market-wide default returned 0 rows — always pass dates. |
| `/api/corporate-pledgedata` | `index=equities&symbol=X` | `{"comNameList":[],"data":[]}` — returned **0 rows for RELIANCE and ADANIENT**; pledge data via this route is **UNVERIFIED**. Pledges also arrive as announcements (`desc` contains "Pledge"/"Encumbrance") and in BSE's SAST sub-categories. |
| `/api/corporate-credit-rating` | `index=equities` | 162 rows; `CreditRating`, `CreditRatingEarlier`, `RatingAction`, `Outlook`, `NameOfCRAgency`, `XbrlFileName`. |
| `/api/annual-reports` | `index=equities&symbol=X` | `{"data":[{fromYr,toYr,fileName(pdf),attFileSize}]}` — RELIANCE 2025-26 AR = 10.5 MB PDF. Useful for the Pull side. |
| `/api/corporate-share-holdings-master` | `index=equities&symbol=X` | 23 quarterly rows with `xbrl` links. |
| `/api/search/autocomplete?q=` | — | **404** now. For symbol resolution use `https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv` (2,632 rows, 186 KB, UA only, 0.25 s; columns SYMBOL, NAME OF COMPANY, SERIES, ISIN NUMBER…). |
| `/api/quote-equity` | — | timed out / known 403 for non-browser clients. Do not depend on it (prices come from yfinance anyway). |

**Symbol churn is real:** EQUITY_L.csv shows `TATAMOTORS` no longer exists (demerged into `TMPV` and `TMCV`, listed 12-Nov-2025) and `ZOMATO` is `ETERNAL`. Resolve by **ISIN**, and keep a small alias table.

### 1.6 Measured reliability

| test | result |
|---|---|
| 30 sequential per-symbol 30-day calls (0.5 s apart) | 30/30 × 200; p50 0.20 s, p90 0.24 s, max 0.30 s |
| 10 burst calls, no sleep | 10/10 × 200; 0.17–0.52 s |
| Market-wide 1–365 day windows (5 calls) | 5/5 × 200 |
| ~25 ad-hoc calls across 12 other endpoints | all 200 except `/api/corporate-sast-regulations` (404 — wrong path) and `quote-equity` |
| Cookie lifetime (one session, call every 3 min, no re-warm) | 200 at 3, 6, 9 min (0.24–0.31 s); test still running at write-up; API also works with zero cookies — the practical rule is re-warm on failure |
| Failure modes seen | (a) tarpit/hang with non-browser UA or no UA on nsearchives; (b) brotli garbage if `br` advertised without decoder; (c) homepage 403 to plain requests; none of these are intermittent |

---

## 2. BSE — corporate announcements

### 2.1 Headers (the actual gate)

Ablation on `api.bseindia.com` (plain `requests`): dropping **`User-Agent`, `Accept-Language` or `Origin` → 403 (Akamai "Access Denied")**; dropping any *one* of `Accept`, `Accept-Encoding`, `Referer`, `Sec-Fetch-*`, `sec-ch-ua*` → still 200; but `UA + Accept-Language + Origin` alone → 403. Akamai scores the header set cumulatively, so send the full set:

```python
BSE_HDR = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
           "Accept-Encoding": "gzip, deflate, br", "Origin": "https://www.bseindia.com", "Referer": "https://www.bseindia.com/",
           "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-site",
           "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"macOS"'}
```

No cookies/warm-up needed. With `curl_cffi` (`impersonate="chrome"`) just `Origin` + `Referer` suffice. A request with **no** `Origin` under curl_cffi silently returns the bseindia.com homepage HTML (a redirect to `/members/showinterest`) with status 200 — check `Content-Type` is JSON.

### 2.2 Endpoint and parameters

`GET https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate=YYYYMMDD&strScrip=&strSearch=P&strToDate=YYYYMMDD&strType=C&subcategory=-1`

| behaviour | measured |
|---|---|
| Market-wide (`strScrip=` empty) | **only works when `strPrevDate == strToDate`** (single day). Any multi-day range → `{}`. Iterate day by day. |
| Per scrip (`strScrip=500325`) | ranges work; 30 d → 20 rows, 364 d → 175 rows; **>1 year → 400 Bad Request**. |
| Pagination | 50 rows per `pageno`; `Table1[0].ROWCNT` = total. Pages are disjoint and newest-first. Full day 6 Nov 2026 = 2,530 rows = 51 pages, 51/51 × 200, p50 0.73 s, max 10.9 s. |
| `strCat` / `subcategory` | `-1` = all. Sub-category list: `DDLSubCategoryData/w?categoryid=-1` (48 rows). |
| `strType` | `C` = equity companies (2,530 rows/day); `D` gave 3,414 (debt+?). `strSearch`: `P` (default, 2,530) vs `S` (3,562, includes more segments). Semantics **UNVERIFIED** beyond these counts; use `C`/`P`. |
| XBRL-structured announcements | `XbrlAnnouncementCategory/w` (same params) returns the XBRL-submitted subset with `XML_NAME` pointing to an `/XBRLFILES/...html` rendering. |

### 2.3 Response shape (real row)

```json
{"NEWSID": "2fbab300-f5f6-4422-a266-3d6545f8918e", "SCRIP_CD": 500325, "SLONGNAME": "Reliance Industries Ltd",
 "XML_NAME": "ANN_500325_2FBAB300-F5F6-4422-A266-3D6545F8918E",
 "NEWSSUB": "Announcement under Regulation 30 (LODR)-Analyst / Investor Meet - Intimation",
 "HEADLINE": "Please note that the Company executives will be participating in the Institutional Investors meeting - CLSA India Forum, scheduled to be held on November 16, 2026 at Mumbai. It is expected ....",
 "MORE": "Please note that the Company executives will be participating in the Institutional Investors meeting - CLSA India Forum ... one-on-one basis.",
 "CATEGORYNAME": "Company Update", "SUBCATNAME": "Analyst / Investor Meet", "CRITICALNEWS": "0", "ANNOUNCEMENT_TYPE": "A",
 "ATTACHMENTNAME": "bab324f6-6fab-42fc-8b79-a3881f4fb7c7.pdf", "Fld_Attachsize": 259214, "PDFFLAG": 0,
 "NEWS_DT": "2026-11-06T19:17:12.89", "DT_TM": "2026-11-06T19:17:12.89", "DissemDT": "2026-11-06T19:17:12.89", "News_submission_dt": "2026-11-06T19:17:12", "TimeDiff": "00:00:00",
 "AUDIO_VIDEO_FILE": null, "Investor_Presentation": null, "QUARTER_ID": null, "AGENDA_ID": 80, "OLD": 1, "RN": 1,
 "NSURL": "https://www.bseindia.com/stock-share-price/reliance-industries-ltd/reliance/500325/"}
```

Fill rates over 2,530 rows (6 Nov): `ATTACHMENTNAME` 99.8%, `HEADLINE`/`NEWSSUB` 100%, `SUBCATNAME` 98.5%, `MORE` (full text) 26%, `CRITICALNEWS=1` 17.9%, `AUDIO_VIDEO_FILE`/`Investor_Presentation` 4.7%, `PDFFLAG` always 0, `QUARTER_ID` never set. `HEADLINE` is the first ~200 chars of the body (truncated with "...."), which is more informative than NSE's `attchmntText`.

### 2.4 Attachments

`https://www.bseindia.com/xml-data/corpfiling/AttachLive/<ATTACHMENTNAME>` for recent filings, `.../AttachHis/<ATTACHMENTNAME>` for older ones (an Aug-2025 file was 404 on Live and 200 on His; a 6-Nov-2026 file the reverse). Only `User-Agent` needed; no UA → 403. **BSE's attachment server is slow**: a 3.7 MB PDF took 9–24 s (~150–400 KB/s) vs 0.3 s for 5.4 MB on NSE. Prefer NSE's copy of the same PDF.

### 2.5 BSE taxonomy (observed on 2,530 rows, 6 Nov 2026) → reference categories

`CATEGORYNAME` counts: Company Update 1,387 · Board Meeting 652 · Result 256 · AGM/EGM 71 · Others 65 · Insider Trading / SAST 63 · Corp. Action 25 · " Corp Action" 8 (sic, leading space) · New Listing 3.

| BSE `SUBCATNAME` (count) | → reference category |
|---|---|
| Result / Financial Results (256), Company Update / Investor Presentation (82) | results |
| Board Meeting / Outcome of Board Meeting (278), Board Meeting / Board Meeting (374, intimations) | results **if** text mentions results; else needs text (dividend / fund-raise / M&A also come here) |
| Company Update / Earnings Call Transcript (101) | earnings_call |
| Company Update / Analyst / Investor Meet (219) | investor_meetings (or earnings_call if "conference call/transcript/recording" in text) |
| Company Update / Press Release / Media Release (82+3), Award of Order / Receipt of Order (4), Clarification (2), Monthly Business Updates (2) | press_release |
| Company Update / Change in Management (39), Change in Directorate (18), Resignation of Director (9), Appointment/Resignation of Company Secretary (10+11), Resignation of CFO (4), Retirement (2), Demise (1) | management_change |
| Company Update / Credit Rating (10) | credit_rating |
| Company Update / Acquisition (13), Scheme of Arrangement (7), MoU/Agreements (4), Open Offer (2), Delisting (1) | M&A |
| Corp. Action / Dividend (9), Record Date (12), Date of payment of Dividend (2), Book Closure (1) | dividend (Record Date/Book Closure: confirm purpose from text) |
| Company Update / Raising of Funds (2), Preferential Issue (1), Issue of Securities (2), Allotment of Equity Shares (6), Allotment of Warrants (2), Corp Action / Daily Buy Back (4), Others / Repayment of Commercial Paper | fund_raise |
| Insider Trading / SAST / Reg. 29(1), 29(2), 31(1)&(2) disclosures (16+32+3) | insider_trading (31(1)/(2) are pledge/encumbrance → pledging) |
| AGM/EGM / AGM (8), EGM (22) | agm_egm |
| AGM/EGM / Postal Ballot (41) | postal_ballot |
| Others / Reg. 50(1) prior intimation, Updates – CIRP (6) | litigation (CIRP) |
| Company Update / Newspaper Publication (412), Allotment of ESOP/ESPS (14), Monitoring Agency Report (26), Reg. 32 Deviation (25), Reg. 74(5) certificate (4), Code of Conduct PIT (4), Closure of Trading Window (11), Appointment/Resignation of Statutory Auditors (7+2), Reg. 34(1) Annual Report (4), Board Meeting Rescheduled (12), Meeting Updates (8), MoA/AoA amendments | unclassified |
| Company Update / General (223 = 9% of the day; **80/330 = 24%** in the 20-large-cap sample) | needs text → rules on HEADLINE, else LLM |

`CRITICALNEWS=1` concentrated in Board Meeting, Credit Rating, Acquisition, EGM, Dividend, Award of Order — a free materiality hint.

### 2.6 BSE structured results & metadata endpoints (discovered from the Angular bundle, tested)

| endpoint | params | returns |
|---|---|---|
| `Corp_detailedResult_Transpose_ng/w` | `Scrip_cd=500325&Qtr=131.00` | `{"table1":[{fld_desc, Value, fld_type, Header}]}` — **standalone** P&L for one quarter in ₹ million: Revenue, Other Income, each expense line incl. **Finance Costs and D&A**, PBT, Tax, Net Profit, EPS. Bank format differs (Interest Earned, Operating Profit before provisions, Provisions, NPAs, CET1). |
| `Corp_BSEDnBResults_SEBI_Consolidated_Res_ng/w` | `type1=c&strtype=131.00&strscripcd=500325&strscripname=&strresultType=&action=show` | list of `{Description, Amount, RowType}` — **consolidated** P&L (no finance-cost/D&A lines, so EBITDA needs NSE XBRL or the standalone table). 0.06–6.6 s. |
| Quarter ids | `Qtr` 131 = Sep-2026 (SQ2026-2027), 130 = Jun-2026, 129 = Mar-2026, 128 = Dec-2025, 127 = Sep-2025 … (+1 per quarter; `.2` suffix = half-year row) | `NSTodayResults_ng/w` (no params) lists today's result filers with `Qtr` and `quarter_code`. |
| `CorprateResult/w?scripcode=` | | HTML grid of all available quarters per FY back to 2000-01 (good for "which quarters exist"). |
| `ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active` | | **5,146 active scrips** with `SCRIP_CD`, `scrip_id` (≈ NSE symbol), `ISIN_NUMBER`, `Mktcap` (₹ cr), `GROUP`, `NSURL`. Symbol↔ISIN↔BSE-code resolver in one 1.8 MB call. |
| `ComHeader/w?quotetype=EQ&scripcode=500325&seriesid=` | | ISIN, industry, index membership. |
| `CorporateAction/w?scripcode=`, `BoardMeeting/w?scripcode=`, `AnnualReport_New/w?scripcode=` | | dividends/record dates; board-meeting dates+purpose; 30 years of annual-report PDFs (`AttachHis/...pdf`). |
| `Corp_GetFINANCE_DRDOWN_ng/w?flag=1|3` | | dropdown masters (FlagDur, HFQ). `Corp_FinanceResult_ng/w`, `Corp_Archive_Wthxml_ng/w`, `Result_Arch_ng/w` returned an ASP.NET error page for the parameter sets I tried — **UNVERIFIED**. |
| NBFC via `Corp_detailedResult_Transpose_ng` (BAJFINANCE 500034, Qtr 130) | | empty table — NBFC results are **not** in BSE's standalone table; use NSE XBRL (works). |

---

## 3. NSE vs BSE for the same companies (20 large/mid caps, 30 days)

| | NSE | BSE |
|---|---|---|
| items, 20 companies, 9 Oct–8 Nov 2026 | 306 | 330 |
| matched to the other exchange within ±30 min | 298/306 (97%) | — |
| publication lag | NSE later than BSE by **median 26 s** (p10 −251 s, p90 +388 s); NSE later in 190 cases, BSE later in 107 | effectively simultaneous |
| exchange category | `desc` (~40 free-ish values), no sub-category | `CATEGORYNAME` (9) / `SUBCATNAME` (~60) + `CRITICALNEWS` |
| text | `attchmntText` one line (often content-free: "…has informed the Exchange about General Updates") | `HEADLINE` ≈ first 200 chars of body; `MORE` full text 26% |
| AI summary | `voiceSummary` on live items (since 7 Nov 2026) | none |
| attachments | 100%, fast CDN | 99.8%, slow server, Live/His split |
| windows | any window, no pagination, full history per symbol | single day market-wide, ≤1 y per scrip, 50/page |
| extra | integrated-filing XBRL, event calendar, PIT, credit ratings | structured results JSON, scrip master with market cap |

**Decision: NSE is primary** (one call per symbol or per window, deep history, fast attachments, `voiceSummary`). **BSE is the enrichment/fallback**: join by company + timestamp (±30 min) to attach `SUBCATNAME`/`HEADLINE`/`CRITICALNEWS`, and take over the feed if NSE 403s. The 8 NSE items without a BSE match and the ~24 BSE-only items are mostly exchange-specific compliance filings (trading-window closure, SAST) — not material.

---

## 4. Deployment reality

**Evidence gathered (not just folklore):**
- NSEPython 2.98 release notes, 7 Oct 2026 ([forum.unofficed.com](https://forum.unofficed.com/t/nsepython-nsepythonserver-2-98-akamai-fix-oct-2026/1466)): "NSE tightened their Akamai Bot Manager protection … plain `requests`/`curl` got blocked outright (403/404 Akamai challenge pages) … Akamai was blocking the old TLS fingerprint outright regardless of User-Agent"; fix = `curl_cffi` Chrome impersonation + cookie warm-up. (From this residential IP, plain `requests` still works today — the policy is evidently IP-reputation-dependent.)
- `nse-mcp` DATA_SOURCES.md, 6 Aug 2026 ([github.com/pritam-patil/nse-mcp](https://github.com/pritam-patil/nse-mcp/blob/main/DATA_SOURCES.md)): from a **Cloudflare Worker (Marseille egress)** with browser-like headers, `/api/corporate-announcements?index=equities` → **200 in 22/22 runs (180–200 ms)**, `/api/marketStatus` 200 12/12, while `/api/quote-equity` → 403 22/22 *and also 403 from a residential IP* — "the gating is per-endpoint, not per-client". Cookie warm-up changed nothing there.
- A BSE client library ([NikhilSuthar/indian-market-data](https://github.com/NikhilSuthar/indian-market-data/blob/main/packages/bse-data/src/bsedata/session.py)) documents that `BseIndiaAPI` "requires curl_cffi for reliable access" and that a 302 to `error_Bse.html`/homepage means the session is invalid.
- General: GitHub Actions runner IP ranges are published and commonly blocked by Akamai-fronted sites (several 2025–26 reports of TCP resets / 403 from Actions that work locally; SEC EDGAR blocks Actions IPs). I found **no NSE-specific GitHub Actions evidence either way — UNVERIFIED**.
- My own crude datacenter test: fetching through the Jina reader proxy (datacenter IPs, headless Chrome) returned the **real NSE announcements JSON** (200, 4.9 s), the nsearchives XBRL (200) and a BSE AttachHis PDF (200). BSE's API via the proxy was redirected to the homepage because the proxy does not send `Origin` — inconclusive for BSE.

**Assessment:** medium risk, mitigable. The announcements endpoints are on NSE's *loose* Akamai tier; the real blockers are (a) non-browser TLS fingerprints and (b) missing headers, both fixable in code. Residual risk: an Akamai policy change during the demo week, or BSE geo/IP rules we cannot see from India.

**Where to run the scheduler (free):**
1. **Laptop launchd/cron every 15 min → hosted Postgres/Supabase/Turso** — zero block risk (residential IP), already proven here. Acceptable for a 7-day prototype; say so in the write-up.
2. **Cloudflare Workers Cron Trigger** — independent evidence of 200s on exactly our endpoint; free tier is generous; Workers' `fetch` uses Chrome-like TLS. Needs `Origin`/headers for BSE. Good "always-on" option; test on day 1.
3. **GitHub Actions cron** — likely to work for `nsearchives`/XBRL downloads, uncertain for the API; only use with a fallback.
4. **Vercel/Render/Fly functions** — treat as untrusted egress; keep them read-only against *our* DB.
5. Oracle free VM / any VPS — same uncertainty as (3)–(4); not worth the setup time this week.

**Resilient design (recommended):**
- `fetch_feed(window)` → tries NSE (curl_cffi, warm-up, 2 retries with re-warm) → on failure tries BSE day-by-day → on failure serves the **last good snapshot from the DB** with a visible "as of HH:MM" stamp.
- Store every row (NSE `seq_id` / BSE `NEWSID` as keys), the classifier output, the downloaded attachment text (first N pages), and the XBRL-derived results table. The app **only reads the DB**; the scrapers are the only writers.
- Ship a **seeded snapshot** (the 30-day dump for the portfolio + 5 quarters of results per company) in the repo so the demo runs with the network unplugged. Mark seeded rows `source='seed'`.
- Hard timeouts (10 s API, 30 s attachment), bounded concurrency (≤4 for attachments), and a circuit breaker that stops hitting an exchange for 10 min after two consecutive 403s — Akamai escalates on hammering.

---

## 5. Historical depth (tested)

| need | source | depth |
|---|---|---|
| 7–30-day digest window, per company | NSE per-symbol with dates | any; 30 d ≈ 6–27 rows per large cap (0.2 s) |
| backfill all portfolio history | NSE per-symbol, no dates | full history to 2004 in one call (RELIANCE 3,382 rows) |
| market-wide day | NSE 1-day window (455 rows on a weekend day; ~2,500 weekdays) or BSE single-day (51 pages) | — |
| last 4–8 quarters of results | NSE integrated-filing (Q4 FY25→) + legacy financial-results (→Q3 FY25) XBRL; BSE `Corp_detailedResult_Transpose_ng` back to 2000 by quarter id | ≥ 20 years |
| BSE announcements per scrip | ≤ 1 year per call (400 beyond) | chain yearly calls |

---

## 6. Classification signal and hybrid classifier

### 6.1 What the exchanges hand us

NSE `desc` distribution in the 306-item / 20-company / 30-day sample: Analysts/Institutional Investor Meet/Con. Call Updates 56 · General Updates 40 · Copy of Newspaper Publication 30 · Updates 27 · Outcome of Board Meeting 25 · Press Release 17 · ESOP/ESOS/ESPS 13 · Investor Presentation 10 · Certificate under SEBI (DP) Regulations 9 · Credit Rating 7(+1 "- New") · Allotment of Securities 7 · Shareholders meeting 6 · Action(s) taken or orders passed 6(+1 "initiated") · Committee Meeting Updates 6 · Corporate Insolvency Resolution Process 5 · Bagging/Receiving of orders/contracts 4 · Acquisition 4 · Change in Management 3 · Amalgamation/Merger 3 · Issue of Securities 3 · Record Date 2 · Statement of deviation under Reg. 32 2 · Monitoring Agency Report 2 · Retirement 2 · News Verification 2 · Resignation of Director/KMP/SMP 2 · Sale or disposal 2 · and singletons (Other Restructuring, Dividend, Scheme of Arrangement, Rumour Verification – Reg 30(11), Resignation, Change in Auditors, Cessation, Appointment, Giving guarantees/indemnity). Market-wide (455 items, 24 h) adds: Trading Window, Disruption of Operations, Initiation of Forensic Audit, Spurt in Volume, Demise, Credit Rating- Revision, Integrated Filing- Financial, Closure of operations, Product launch, Pendency of Litigation(s), Arrangements for strategic/technical/manufacturing/marketing tie up.

**64% of NSE items carry a generic `desc`** (Updates / General Updates / Outcome of Board Meeting / Press Release / Newspaper Publication / Analyst-meet) and need the text; the other 36% are already a category.

### 6.2 Real sample (50 of 306 rows; full dump in `/tmp/finn-ann/sample_table.json`)

| sym | NSE `desc` | NSE `attchmntText` (snippet) | BSE cat / subcat | rule → |
|---|---|---|---|---|
| KPITTECH | Acquisition | …Board of Directors of the Company approved the pr… | Company Update / General | M&A |
| MARUTI | Acquisition | …Incorporation of Wholly Owned Subsidiary | Company Update / Acquisition | M&A |
| TCS | General Updates | …completion of acquisition of BBY Services In… | Company Update / Acquisition | M&A |
| BAJFINANCE | Shareholders meeting | …Srutinizers report of Extraordinary General Meeting… | AGM/EGM / EGM | agm_egm |
| HDFCBANK | Shareholders meeting | …Notice of Postal Ballot | AGM/EGM / Postal Ballot | agm_egm (→ postal_ballot via BSE) |
| INFY | Updates | …'Infosys Announces Expansion of Pocharam Development Cente… | Company Update / General | capex |
| DMART | Credit Rating | …Credit Rating | Company Update / Credit Rating | credit_rating |
| PERSISTENT | Credit Rating- New | …Credit Rating- New | Company Update / Credit Rating | credit_rating |
| HINDUNILVR | Dividend | Board approves Interim Dividend of Rs. 19 per equity share for FY 2026-27 | Company Update / General | dividend |
| HINDUNILVR | Record Date | …Record date for the purpose of Interim Dividend… | Company Update / General | dividend |
| INFY | Record Date | …Record date for the purpose of Dividend is 03-Nov-2026. | Corp. Action / Dividend | dividend |
| BAJFINANCE | Analysts/Institutional Investor Meet/Con. Call Updates | …Schedule of meet | Company Update / Analyst / Investor Meet | investor_meetings |
| HDFCBANK | Analysts/Institutional Investor Meet/Con. Call Updates | …Presentation | Company Update / Analyst / Investor Meet | investor_meetings |
| PERSISTENT | Allotment of Securities | …allotment of 7683981 securities pursuant to Qua[lified Institutions Placement] | Company Update / Allotment of Equity Shares | fund_raise |
| PERSISTENT | Issue of Securities | …issue of Securities | Company Update / Issue of Securities | fund_raise |
| INFY | Updates | …'Investor Conference'. | Company Update / General | investor_meetings |
| BHARTIARTL | Action(s) taken or orders passed | …Action(s) taken or orders passed | Company Update / General | litigation |
| POLYCAB | Corporate Insolvency Resolution Process | …Hon'ble NCLAT has granted the request for early listing… | Company Update / Updates - CIRP | litigation |
| SUNPHARMA | Resignation | Resignation of Director of the Company | Company Update / Resignation of Director | management_change |
| TATASTEEL | Outcome of Board Meeting | …retirement of Mr. Noel Naval Tata as the Non-Executive… | Company Update / General | management_change |
| TITAN | Retirement | …Retirement of Mr. Noel N. Tata as Director and Vice-Chai… | Company Update / Retirement | management_change |
| HINDUNILVR | Updates | Schedule of Events - Postal Ballot | Company Update / General | postal_ballot |
| SUNPHARMA | General Updates | Completion and Results of Postal Ballot dated 01 October 2026 | Company Update / General | postal_ballot |
| LT | Bagging/Receiving of orders/contracts | …Bagging/Receiving of orders/contracts | Others / — | press_release |
| MARUTI | Press Release | …press release dated November 01, 2026, title… | Company Update / Press Release / Media Release | press_release |
| TCS | Updates | …'Press Release -MyState Limited selects… | Company Update / General | press_release |
| INFY | Copy of Newspaper Publication | …Copy of Newspaper Publication | Company Update / Newspaper Publication | unclassified (results only if text says so) |
| MARUTI | Investor Presentation | …Investor Presentation | Company Update / Investor Presentation | results |
| BAJFINANCE | General Updates | …General Updates | Company Update / General | unclassified |
| KPITTECH | Certificate under SEBI (DP) Regulations, 2018 | …Reconciliation of Share Capital Audit for the quarte… | Company Update / Certificate under Reg. 74 (5) | unclassified |
| HINDUNILVR | Outcome of Board Meeting | Outcome of the Board Meeting held on 28th October, 2026. | Corp. Action / Record Date | dividend (via BSE subcat) |
| INFY | Updates | …'Report of auditors on financial statements for the quarte… | Company Update / General | results (text) |
| INFY | Updates | …'Infosys Successfully Delivers Syngenta's Global SAP S/4HA… | Company Update / General | press_release (text "delivers") |
| KPITTECH | Updates | …'change in the address of the Corporate Office o[f RTA]… | Company Update / General | unclassified (text "address") |
| KPITTECH | Giving guarantees/indemnity/ becoming a surety for third party | …Issue of Letter of Comfort in favor of KPIT Technologies (UK)… | Company Update / General | unclassified |
| PERSISTENT | Outcome of Board Meeting | Outcome of the Board Meeting | Company Update / Press Release / Media Release | press_release (via BSE) — really results+dividend → **LLM** |
| RELIANCE | Updates | Please find attached a media statement issued by the Company. | Company Update / General | press_release (text "media statement") |
| RELIANCE | Updates | The newspaper clippings of the advertisement on the captioned subject published today are enclosed. | Company Update / General | unclassified |
| TCS | Updates | …'Statement of the Company regarding the announceme… | Company Update / General | **∅ → LLM** |
| INFY | Updates | …'Infosys to Announce Second Quarter Results on October 23, 2026'. | Company Update / General | **∅ → LLM** (results-date intimation) |
| BHARTIARTL | Updates | …regarding 'Updates'. | Company Update / General | **∅ → LLM** (needs PDF) |
| LT | Updates | …'Analyst Presentation.- Q2 / H1 FY 2026-27' | Company Update / General | **∅ → LLM** (should be results) |
| INFY | Updates | …'Infosys Foundation Enables Over 2.5 Lakh Job Offers… | Company Update / General | **∅ → LLM** (CSR → unclassified) |

Observed `voiceSummary` examples (live items, 8 Nov): *Change in Management* → "Mr. Manish Rastogi, DIN 10056027, ceased his offices as Whole-time Director and CEO on November 8, 2026 … upon attaining the age of superannuation"; *Credit Rating* → "India Ratings assigned IND BBB+ with a Negative outlook to proposed NCDs of INR 1,500 million … revising their outlook from Stable to Negative"; *Acquisition* → "Tata Steel acquired 38,222 equity shares in Creative Port Development … stake increased from 51% to 57.5%"; *Bagging orders* → "SEAMEC … Letter of Award from L&T … USD 26.14 million … completion by May 2027". These are already digest-grade one-liners.

### 6.3 Measured coverage of the hybrid rules (306 items)

| stage | what | share |
|---|---|---|
| A | exact map on NSE `desc` (36 unambiguous values) + two special cases (Analyst-meet → earnings_call if text says call/transcript/recording else investor_meetings; Newspaper Publication → results if text says result/financial else unclassified) | **69%** |
| B | ordered regex over `desc + attchmntText` (cue list below) | **27%** |
| C | BSE `SUBCATNAME` of the time-matched BSE row (unambiguous sub-categories only) | 2% |
| LLM | residue: "Updates" with content-free text | **1.6% (5/306)** |

Coverage ≠ accuracy. Stage A is exchange-labelled and trustworthy. Stage B was spot-checked on the 50-row sample above: 3 debatable hits out of 50 (the broad `press_release` cue "announces/delivers" catches CSR puff; "Outcome of Board Meeting" + BSE "Press Release" hid a results+dividend outcome). Estimated stage-B precision ≈ 90%; budget an LLM pass for **all stage-B hits in material categories** (M&A, management_change, fund_raise, litigation, results) — that is ~25% of items, i.e. ~5–8 cheap LLM calls per company per month, trivially cacheable by `seq_id`.

Cue strings that actually fired (lowercased regex, in priority order):

```
earnings_call     transcript|audio recording|recording of|earnings call|conference call|con\.? ?call|concall
results           financial results?|results? for the quarter|unaudited|audited|limited review|integrated filing|investor presentation|earnings presentation
dividend          dividend|record date
bonus_split       bonus (issue|share)|stock split|sub-?division
fund_raise        \bqip\b|qualified institution|rights issue|preferential|buy-?back|commercial paper|debenture|\bncds?\b|fund[- ]?rais|allotment of (securities|equity|warrant)|borrowing|term loan
M&A               acqui(sition|re|red)|merger|amalgamation|demerger|scheme of arrangement|joint venture|\bjv\b|stake|divest|slump sale|subsidiary|takeover|open offer
management_change appoint|resign|cessation|retire|demise|chief (executive|financial|operating)|\bceo\b|\bcfo\b|managing director|director|company secretary|compliance officer|key managerial
credit_rating     credit rating|rating (action|upgrade|downgrade|reaffirm|assign|revision)|\bcrisil\b|\bicra\b|care ratings|india ratings|brickwork|acuite
litigation        litigation|arbitration|court|tribunal|nclt|nclat|sebi order|penalty|show cause|insolvency|cirp|forensic|orders? passed|disput
insider_trading   insider trading|\bpit\b|reg(ulation)?\.? ?7\(2\)|\bsast\b|reg(ulation)?\.? ?29\(|reg(ulation)?\.? ?31\(
pledging          pledg|encumbr|invocation
postal_ballot     postal ballot
agm_egm           annual general meeting|\bagm\b|extra-?ordinary general meeting|\begm\b|shareholders'? meeting|scrutini[sz]er|voting results
capex             capex|capacity expansion|new (plant|facility|unit|campus|development cent)|greenfield|brownfield|commissioning|expansion of|capital expenditure
investor_meetings investor (meet|conference|day)|analyst (meet|day)|schedule of (analyst|investor|meet)|roadshow|one-on-one|group meeting|institutional investor
press_release     press release|media (release|statement)|order (win|book|received)|bagging|contract|award|launch|partnership|collaborat|clarification|rumou?r|business update|store opening|sales (volume|update)|production|wins|selects|delivers|announces
unclassified      esop|esos|employee stock|certificate|reg(ulation)?\.? ?74|reg(ulation)?\.? ?40|reconciliation of share capital|monitoring agency|deviation|trading window|loss of share|duplicate|auditor|secretarial|\besg\b|brsr|newspaper|address|registrar|letter of comfort|guarantee|committee meeting|closure of operations|disruption|general updates|^updates?$
```

### 6.4 Proposed hybrid classifier (what to build)

1. **Stage A/B/C rules** as above, deterministic, run at ingest. Output `(category, confidence ∈ {exchange, text, bse}, cue)`. Store the cue so the UI can show *why*.
2. **Materiality & one-liner (LLM, cheap model)** only for: residue (1.6%), stage-B hits in material categories (~25%), and every `results`/`management_change`/`M&A`/`fund_raise`/`litigation` item regardless of stage (they get a card anyway). Input = `voiceSummary` if present (live items), else `attchmntText` + BSE `HEADLINE`/`MORE`, else first 2 pages of `pdftotext`. Output JSON `{category, is_material, one_liner, entities}`; cache by `seq_id`. Expected volume for a 20-stock portfolio: ~300 items/month → ~90 LLM calls/month → well inside Gemini's free tier.
3. **Results override**: when `event-calendar`/board-meeting says results are due and an `integrated-filing-results` row appears for that `qe_Date`, create the *results card from XBRL*, not from the PDF (§7). The PDF/press release is a link, not an input.
4. **Routine collapse**: `unclassified`, `investor_meetings` (schedules), newspaper publications, trading-window, ESOP allotments → collapsed group by default.

---

## 7. The structured-results opportunity (XBRL / JSON) — verified

### 7.1 Sources

- **NSE integrated filing (Q4 FY25 → today):** `/api/integrated-filing-results?index=equities&symbol=RELIANCE&size=100` → 22 rows for RELIANCE (11 financial × standalone/consolidated + governance). Financial rows carry `xbrl` = `https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1750537_30102026093254_WEB.xml` (103 KB, 65 contexts, 403 facts, 256 concepts) and `ixbrl` HTML. Taxonomy namespace `http://www.sebi.gov.in/xbrl/2026-01-31/in-capmkt`. Variants seen: `INTEGRATED_FILING_INDAS_*` (companies), `INTEGRATED_FILING_NBFC_INDAS_*` (BAJFINANCE), `INTEGRATED_FILING_BANKING_*` (HDFCBANK/ICICIBANK).
- **NSE legacy (≤ Q3 FY25):** `/api/corporates-financial-results?index=equities&period=Quarterly&symbol=X` → `xbrl` = `.../corporate/xbrl/INDAS_117297_1348248_16012025081520.xml` (58 KB). Same concept names (`RevenueFromOperations`, `ProfitBeforeTax`, `ProfitLossForPeriod`, `FinanceCosts`, `DepreciationDepletionAndAmortisationExpense`), contexts `OneD` (quarter) / `FourD` (YTD).
- **BSE JSON** (§2.6) — same numbers in ₹ million; useful as a cross-check or when NSE is down.

### 7.2 What one XBRL contains (RELIANCE Q2 FY27 consolidated, real values, ₹)

Contexts: `OneD` 2026-07-01..2026-09-30 (the quarter), `FourD` 2026-04-01..2026-09-30 (H1), `OneI` instant 2026-09-30, `PY_I` instant 2026-03-31, plus dimensional contexts for segments/expenses. **No prior-quarter or prior-year comparatives** — QoQ/YoY need the previous filings' XBRLs (all listed, ~0.1 s each).

| concept (`OneD`) | value |
|---|---|
| RevenueFromOperations | 3,328,610,000,000 |
| OtherIncome | 57,930,000,000 |
| Income | 3,386,540,000,000 |
| FinanceCosts | 84,810,000,000 |
| DepreciationDepletionAndAmortisationExpense | 153,150,000,000 |
| Expenses | 3,000,410,000,000 |
| ProfitBeforeExceptionalItemsAndTax / ProfitBeforeTax | 386,130,000,000 |
| TaxExpense | 93,630,000,000 |
| ProfitLossForPeriodFromContinuingOperations | 292,500,000,000 |
| ProfitLossForPeriod | 295,500,000,000 |
| BasicEarningsLossPerShareFromContinuingOperations | 18.88 |
| meta: Symbol RELIANCE, ScripCode 500325, ISIN, NatureOfReportStandaloneConsolidated=Consolidated, WhetherResultsAreAuditedOrUnaudited=Unaudited, ReportingQuarter="Second quarter", DescriptionOfPresentationCurrency=INR | |

Also present: `SegmentRevenue`/`SegmentProfitLossBeforeTaxAndFinanceCosts` per segment (12 facts), full balance sheet instants, cash-flow lines, `DateOfBoardMeetingWhenFinancialResultsWereApproved`, auditor name. EBITDA (proxy) = PBT + FinanceCosts + D&A − OtherIncome = 38,613 + 8,481 + 15,315 − 5,793 = **56,616 ₹ cr**.

### 7.3 Extractor output (ran end-to-end; ₹ crore; consolidated preferred)

```
RELIANCE  [INDAS]    quarter    Revenue   EBITDA*    PBT     PAT    EPS      TCS [INDAS]   Revenue  EBITDA   PBT    PAT   EPS
  2026-09-30         332,861    56,616  38,613  29,550  18.88                   73,188  18,815  18,638 13,934 38.37
  2026-06-30         311,850    47,517  30,630  23,196  15.48                   72,275  17,888  17,944 13,420 36.90
  2026-03-31         298,621    44,141  27,195  20,589  12.54                   70,698  19,276  18,362 13,784 37.92
  2025-12-31         269,496    46,018  29,697  22,290  13.78                   67,087  14,878  14,078 10,720 29.45
  2025-09-30         258,898    45,885  29,124  22,092  13.42                   65,799  16,843  16,068 12,131 33.37
  QoQ Rev +6.7% PAT +27.4% | YoY Rev +28.6% PAT +33.8%        QoQ Rev +1.3% PAT +3.8% | YoY Rev +11.2% PAT +14.9%

HDFCBANK [BANKING]  Rev(=Income) 95,132  OpProfit 32,872  PBT 27,825  PAT 20,700  EPS 13.43   (QoQ Rev +5.0% | YoY Rev +9.4% PAT +5.6%)
BAJFINANCE [NBFC]   Rev 24,546  EBITDA* 17,427  PBT 8,533  PAT 6,367  EPS 10.07              (QoQ Rev +6.0% | YoY Rev +21.6% PAT +28.7%)
POLYCAB [INDAS]     Rev 9,899   EBITDA 1,422    PBT 1,306  PAT 990    EPS 64.87              (QoQ Rev +20.6% | YoY Rev +52.8% PAT +42.9%)
ICICIBANK [BANKING] Rev 55,992  OpProfit 24,010 PBT 23,115 PAT 17,312 EPS 22.76              (QoQ Rev +7.2% | YoY Rev +16.2% PAT +21.4%)
```
\* EBITDA is meaningless for banks/NBFCs (interest is the business); show NII / operating profit before provisions instead. Timing: 1.5–2.1 s per symbol for 5 quarters (1 list call + 1 legacy call + 5 XML downloads).

Concept-name mapping that made all three taxonomies work:

```python
CONCEPTS = {
  "revenue":  ["RevenueFromOperations", "InterestEarned"],                     # banks: InterestEarned (+ OtherIncome = Income)
  "other_income": ["OtherIncome"],
  "fin_cost": ["FinanceCosts", "InterestExpended"],
  "dep":      ["DepreciationDepletionAndAmortisationExpense"],
  "pbt":      ["ProfitBeforeTax", "ProfitLossFromOrdinaryActivitiesBeforeTax"],  # second = banking taxonomy
  "pat":      ["ProfitLossForPeriod", "ProfitLossForThePeriod",                 # banking uses ...ForThePeriod
               "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates"],
  "pat_owners": ["ProfitOrLossAttributableToOwnersOfParent"],                   # prefer for consolidated headline PAT
  "eps":      ["BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsPerShareAfterExtraordinaryItems"],
  "op_profit_bank": ["OperatingProfitBeforeProvisionAndContingencies"],
}
```

Gotchas: values are **absolute rupees** (BSE JSON is ₹ million); pick the duration context of 80–100 days with no dimensions and the most facts (the quarter), not `FourD`; a quarter can have `type_Sub="Revision"` rows — take the latest `creation_Date`; standalone and consolidated are separate filings — prefer consolidated, fall back to standalone (DMART-type companies file both; some small caps only standalone).

### 7.4 Working code (ran as shown)

```python
# nse.py — session + GET (requests; swap requests.Session for curl_cffi.requests.Session(impersonate="chrome") in prod)
import requests, time
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
HDR_HTML = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none"}
HDR_API  = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
            "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin"}
WARM = "https://www.nseindia.com/companies-listing/corporate-filings-announcements"

class NSE:
    def __init__(self):
        self.s = requests.Session(); self.warm()
    def warm(self):
        self.s.get(WARM, headers=HDR_HTML, timeout=20)
    def get(self, path, params=None, retries=2):
        for _ in range(retries + 1):
            try:
                r = self.s.get("https://www.nseindia.com" + path, params=params, headers=HDR_API, timeout=25)
                if r.status_code == 200: return r.json()
                if r.status_code in (401, 403, 503): self.warm(); continue
                return None
            except requests.RequestException:
                self.warm(); time.sleep(1)
        return None

n = NSE()
rows = n.get("/api/corporate-announcements", {"index": "equities", "symbol": "RELIANCE", "from_date": "09-10-2026", "to_date": "08-11-2026"})  # 19 rows
```

```python
# parse_xbrl.py — pull the quarter's P&L facts out of an NSE XBRL
import requests
from datetime import datetime
from lxml import etree
XBRLI = "{http://www.xbrl.org/2003/instance}"

def quarter_facts(xbrl_url):
    root = etree.fromstring(requests.get(xbrl_url, headers={"User-Agent": UA}, timeout=20).content)
    ctx = {}
    for c in root.iter(XBRLI + "context"):
        per = c.find(XBRLI + "period")
        has_dims = c.find(".//" + XBRLI + "segment") is not None
        ctx[c.get("id")] = (per.findtext(XBRLI + "startDate"), per.findtext(XBRLI + "endDate"), has_dims)
    facts = {}
    for el in root.iter():
        cid = el.get("contextRef") if isinstance(el.tag, str) else None
        if cid in ctx and not ctx[cid][2] and ctx[cid][0] and ctx[cid][1]:
            s, e, _ = ctx[cid]
            if 80 <= (datetime.fromisoformat(e) - datetime.fromisoformat(s)).days <= 100:   # the 3-month context
                facts.setdefault(cid, {})[etree.QName(el).localname] = (el.text or "").strip()
    q = max(facts.values(), key=len)                      # richest 3-month context = the quarter
    pick = lambda *names: next((float(q[k]) for k in names if q.get(k) not in (None, "")), None)
    out = dict(revenue=pick("RevenueFromOperations", "InterestEarned"), other_income=pick("OtherIncome"),
               fin_cost=pick("FinanceCosts", "InterestExpended"), dep=pick("DepreciationDepletionAndAmortisationExpense"),
               pbt=pick("ProfitBeforeTax", "ProfitLossFromOrdinaryActivitiesBeforeTax"),
               pat=pick("ProfitOrLossAttributableToOwnersOfParent", "ProfitLossForPeriod", "ProfitLossForThePeriod"),
               eps=pick("BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsPerShareAfterExtraordinaryItems"),
               nature=q.get("NatureOfReportStandaloneConsolidated"), audited=q.get("WhetherResultsAreAuditedOrUnaudited"))
    if out["pbt"] is not None and "InterestEarned" not in q:
        out["ebitda"] = out["pbt"] + (out["fin_cost"] or 0) + (out["dep"] or 0) - (out["other_income"] or 0)
    return out

# list filings → newest 5 quarter-ends, consolidated preferred
data = n.get("/api/integrated-filing-results", {"index": "equities", "symbol": "RELIANCE", "size": 100})
fin = [x for x in data["data"] if x["type"] == "Integrated Filing- Financials" and x["xbrl"]]
legacy = n.get("/api/corporates-financial-results", {"index": "equities", "period": "Quarterly", "symbol": "RELIANCE"}) or []
```

```python
# bse.py — announcements for one day / one scrip, plus attachment URL with Live→His fallback
import requests
BSE_HDR = {...}  # §2.1
def bse_announcements(day_yyyymmdd, scrip="", pageno=1, to_yyyymmdd=None):
    p = {"pageno": pageno, "strCat": -1, "strPrevDate": day_yyyymmdd, "strScrip": scrip, "strSearch": "P",
         "strToDate": to_yyyymmdd or day_yyyymmdd, "strType": "C", "subcategory": -1}
    r = requests.get("https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w", params=p, headers=BSE_HDR, timeout=25)
    d = r.json() if r.headers.get("Content-Type", "").startswith("application/json") else {}
    return d.get("Table", []), (d.get("Table1") or [{}])[0].get("ROWCNT")

def bse_attachment(name):
    for folder in ("AttachLive", "AttachHis"):
        r = requests.get(f"https://www.bseindia.com/xml-data/corpfiling/{folder}/{name}", headers={"User-Agent": UA}, timeout=60)
        if r.status_code == 200 and r.headers.get("Content-Type", "").startswith("application/pdf"): return r.content
    return None
```

---

## 8. Recommended architecture (resilient, demo-safe)

```
[laptop launchd / CF Worker cron, every 15 min]
   ├─ NSE /api/corporate-announcements?index=equities&from=today-2d&to=today  (1 call, market-wide, ~1–2k rows)
   │     └─ filter to portfolio ISINs; upsert by seq_id; keep voiceSummary
   ├─ BSE AnnSubCategoryGetData day=today (and yesterday) pages 1..N  → join ±30 min → add SUBCATNAME/HEADLINE/CRITICALNEWS
   ├─ NSE /api/event-calendar → upcoming results dates per portfolio symbol
   ├─ for new `results`-type items: /api/integrated-filing-results → XBRL → results table (5 quarters)  [BSE JSON as cross-check]
   ├─ classifier stages A/B/C at ingest; LLM one-liner for material + residue (Gemini flash-class), cached by seq_id
   └─ attachments: download lazily on first open; pdftotext first 2 pages for LLM input
[DB: Postgres/SQLite-on-Turso] ← the only thing the mobile app reads; every row tagged source ∈ {nse,bse,seed} + fetched_at
[repo seed]: 30-day dump for the portfolio + 5 quarters × 20 companies + 24 h market-wide sample → the demo never needs the network
```

Why market-wide instead of per-symbol: one 2-day market-wide call (~1–2k rows, 1–2 s) replaces 20 per-symbol calls and also powers "any NSE ticker" without re-fetching; per-symbol full history is for on-demand backfill when the user adds a company.

---

## 9. Prioritised recommendations

1. **Use NSE XBRL (integrated filing) as the results engine.** Build the 5-quarter table + QoQ/YoY from it; never parse a results PDF for headline numbers. Cross-check against BSE JSON on one company in tests.
2. **Transport = `curl_cffi` Chrome impersonation + the header sets above + hard timeouts.** Costs nothing now, removes the single most likely production failure (TLS fingerprint 403/tarpit).
3. **Ingest market-wide NSE windows, enrich with BSE sub-categories, dedupe by `seq_id`.** Store everything; the app reads only the DB; ship a seeded snapshot.
4. **Classifier = exchange `desc` map → text regex → BSE subcat → LLM residue**, with LLM one-liners for material categories using `voiceSummary` when present. Show the cue in the UI.
5. **Resolve companies by ISIN** (EQUITY_L.csv + BSE ListofScripData), keep an alias table (TATAMOTORS→TMPV/TMCV, ZOMATO→ETERNAL).
6. Use `/api/event-calendar` for "results due" badges; `/api/corporates-pit` for insider trades; treat `/api/corporate-pledgedata` as unverified.
7. Decide the scheduler host on day 1 by a 10-minute test: Cloudflare Worker cron hitting both exchanges; if BSE fails from there, run BSE enrichment from the laptop only.

## 10. Assumptions for other agents to challenge

- That Akamai's current leniency toward plain `requests` from this IP persists for the week (it did not in Oct 2026 for other users) — hence rec. 2.
- That `voiceSummary` keeps appearing on new filings (feature appears to be days old) — the design works without it.
- That BSE's single-day market-wide limit and 1-year per-scrip cap are server rules, not UI conventions (both reproduced 8+ times).
- That NSE's `desc` vocabulary is stable enough to hard-map (it has been since the 2019 site redesign, but "Integrated Filing- Financial" shows new values do appear — unknown `desc` must fall through to regex/LLM, never be dropped).
- That consolidated `ProfitLossForPeriod` vs `ProfitOrLossAttributableToOwnersOfParent` is the right headline PAT choice for every company (banks: `ProfitLossForThePeriod`); confirm on one bank and one conglomerate against the press release.
- Unverified: pledge endpoint; BSE `Corp_FinanceResult_ng`/archive endpoints; GitHub Actions egress to NSE; cookie lifetime beyond the observation window; scanned-PDF frequency in small caps.
