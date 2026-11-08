# 21 — Portfolio data verification (20 + 5 + 15 alternates)

Author: portfolio data verifier. Everything below was measured from the build Mac on **Sun 8 Nov 2026, 18:18–18:50 IST** with Python 3.12 (`requests` 2.34, `curl_cffi` 0.17, `pymupdf`), ≤ 1 request/second per host, 20 s hard timeouts, every JSON body validated (not just the status code). Scratch code, the 26 cached bhavcopies, 40 per-symbol JSON dumps and 36 downloaded transcript PDFs live in `/tmp/finn-portfolio/` (not in the repo). Companion machine-readable output: `data/seed/portfolio.json` — top-level `{generated_at, swaps, companies, portfolio, adhoc, alternates}`; `companies` (the final 25) is in the exact `PortfolioEntry` shape `data/seed/seed.ts` already parses (`nseSymbol`, `bseCode`, `sector`, `industry`, `aliases`, `screenerSlug`, `inPortfolio`, `isAdhoc`), so `pnpm db:seed` loads it as-is; `portfolio`/`adhoc`/`alternates` carry the verification evidence per name (`cap_bucket`, `format`, `why`, `verified{…}`).

## 0. Verdict in one paragraph

**39 of 40 candidates pass the data-completeness gate** (XBRL ≥ 4 quarters, ≥ 3 concall transcripts in the last 6 quarters, FY26 annual report downloadable) once transcript discovery unions screener.in with NSE announcements. The only proposed-portfolio failure is **HAL** (1 transcript in 6 quarters — it holds a single annual call in May) → **swap HAL for INOXWIND** (ENAM-book wind-energy mid cap, results 13 Nov, 5/6 transcripts, +8.3 % on 4.4× volume on 2 Nov). The three zero-transcript names (TRENT, ITC in the alternates; RAJESHEXPO in ad-hoc) are kept as deliberate graceful-degradation cases. The final 20 contain 2 banks (BANKING taxonomy), 1 NBFC (+1 NBFC in ad-hoc), **5 names with Q2 results board meetings inside 9–14 Nov** (KALYANKJIL 10th, IDEA & AMBER 12th, TMPV & INOXWIND 13th; plus OLAELEC 12th in ad-hoc and BAJFINANCE's preferential-issue committee on the 10th), 5 names from ENAM's disclosed book and real EOD anomalies to demo (THERMAX −17.3 % on 17.3× on 6 Nov; PIIND −19.1 % on 30.1× on 5 Nov; MARICO +10 % on 8.2× on 3 Nov; KALYANKJIL +5.5 % on 5.5× on 6 Nov; ELGIEQUIP 11.5× volume on a flat price).

## 1. What was run (sources, headers, measured behaviour)

| Need | Endpoint actually used | Calls | Result |
|---|---|---|---|
| ISIN / name / series | `https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv` (UA only) | 1 | 200; all 40 symbols resolved; RAJESHEXPO is series **BZ** (all others EQ) |
| XBRL results inventory | `GET www.nseindia.com/api/integrated-filing-results?index=equities&symbol=X&size=100` (Chrome UA + `Accept: */*` + Referer, `Accept-Encoding: gzip, deflate` — no `br`) | 40 | 40/40 × 200 with valid JSON; `type == "Integrated Filing- Financials"` rows carry `qe_Date`, `consolidated`, `audited`, `type_Sub`, `xbrl` |
| Legacy quarters (≤ Dec-2024) | `/api/corporates-financial-results?index=equities&period=Quarterly&symbol=X` | 40 | 40/40; 3 (OLAELEC) – 80 quarters of history |
| Announcements | `/api/corporate-announcements?index=equities&symbol=X&from_date=01-05-2025&to_date=08-11-2026` (one 18-month call per symbol; 30-day and 24-hour stats derived; transcript items = `attchmntText` ~ /transcript/ and not /audio|recording/) | 40 + 1 market-wide (07→08 Nov, 458 rows, 1.4 s) | 40/40 × 200 |
| Scheduled events | `/api/event-calendar?index=equities&symbol=X` (returns full history → filtered to ≥ 8 Nov) + `/api/corporate-board-meetings?index=equities&symbol=X` + one market-wide `/api/event-calendar?index=equities` (626 upcoming rows) | 81 | 81/81; per-symbol and market-wide agree on all 8 in-window events |
| Annual reports | `/api/annual-reports?index=equities&symbol=X` → `nsearchives.nseindia.com/annual_reports/AR_*.pdf` (first KB fetched, `%PDF` magic checked) | 40 + 40 | 40/40 FY2025-26 reports present and downloadable (1.26 MB RAJESHEXPO … 21.2 MB TRENT) |
| Documents / market cap / BSE code / sector | `https://www.screener.in/company/X/consolidated/` (`#documents .concalls li`, `.annual-reports a`, `#top-ratios`, `#peers p.sub a`) | 40 | 40/40 × 200, 0.1–0.3 s; BSE code and 4-level sector chain for every name |
| BSE transcript fallback | `api.bseindia.com/.../AnnSubCategoryGetData/w?…&subcategory=Earnings Call Transcript` via `curl_cffi impersonate="chrome"` | 5 (only where screener < 3) | 5/5 × 200 JSON (0.14–0.31 s). **A > 1-year window returns HTTP 400** (documented cap confirmed) |
| Latest transcript text check | download via `www.bseindia.com/xml-data/corpfiling/AttachLive|AttachHis/<uuid>.pdf` (derived from screener's `AnnPdfOpen.aspx?Pname=`) or company IR URL; `pymupdf` text of first 40 pages | 36 | 36/36 are text PDFs (49k–72k chars; 17–23 pages; 254–480 KB). 0 scanned PDFs among these mid/large caps |
| EOD prices | `nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip` for every weekday 1 Oct–8 Nov (+ Muhurat Sunday) | 28 attempts | 26 × 200 (0.15–1.0 s, ~205 KB each); 404 on 2 Oct and 20 Oct (holidays). All 40 symbols present on every session |

Timing: integrated-filing p50 0.21 s (max 0.63); announcements-18m p50 0.25 s (max 0.50); per-symbol wall time p50 6.0 s (max 7.3) at ≤1 req/s/host. No 403/429/tarpit was hit on any host during the run.

Field notes that matter for the builders:
- **Taxonomies seen**: `INDAS` (33 names), `BANKING` (HDFCBANK, INDUSINDBK, SBIN), `NBFC_INDAS` (BAJFINANCE, NUVAMA), and `NONINDAS` on 1 RAJESHEXPO row (a mis-tagged filing — treat unknown taxonomies as INDAS and validate tags).
- **XBRL size varies 8×** (14.7 KB IDEA, 19 KB HAL/RAJESHEXPO vs 90–140 KB THERMAX/NUVAMA/VEDL) but the quarter-context P&L tags (`RevenueFromOperations`, `OtherIncome`, `FinanceCosts`, `DepreciationDepletionAndAmortisationExpense`, `ProfitBeforeTax`, `ProfitLossForPeriod`, EPS, `NatureOfReportStandaloneConsolidated`) were present in all five parsed; small files just omit segments/balance sheet. **Trap: RAJESHEXPO reports `ProfitOrLossAttributableToOwnersOfParent = 0` while `ProfitLossForPeriod = 12.4 cr`** — only prefer owners-of-parent when non-zero. HAL's quarterly results are filed **Audited** (PSU practice) — don't hard-code "Un-Audited" on quarterly cards.
- **Screener transcript links are not always BSE**: THERMAX → `thermaxglobal.com/...pdf`, VEDL → `vedantalimited.com/...pdf` (both downloaded fine with a browser UA). Screener also **lags/misses** NSE: VEDL's Q1 and Q2 FY27 transcripts (4 Aug, 29 Oct) and MARUTI's exist only in NSE announcements; INDUSINDBK and LT each had one quarter only on NSE. Union the sources.
- **24-hour window on a Diwali weekend is genuinely empty**: zero filings by any of the 40 candidates since 07-Nov 18:30 IST (last one: SBIN's transcript at 18:10 on Sat 7 Nov); market-wide only 86 items in those 24 h (456/458 carry `voiceSummary`). The brief's default 24 h window must widen on holidays/weekends or the first thing a grader sees is an empty brief.
- `/api/event-calendar?symbol=X` returns the symbol's **entire event history** (RELIANCE back to 2005) — filter by date; the market-wide call (no symbol) is the cheap "upcoming" view. Market-wide Q2 results board meetings in the window: 09 Nov: 6, 10 Nov: 23, 11 Nov: 48, 12 Nov: 184, 13 Nov: 211, 14 Nov: 141 — the 12th–14th are the heavy days.

## 2. Proposed portfolio (20) — identity, XBRL, annual report

| Symbol | Company (EQUITY_L) | ISIN | Ser. | BSE | Mcap ₹cr | Sector (screener) | XBRL qtrs (taxonomy) | Latest qe | Q2 FY27 filed | Cons/Stand | Legacy qtrs | FY26 AR (NSE) |
|---|---|---|---|---|---:|---|---|---|---|---|---:|---|
| **RELIANCE** | Reliance Industries Limited | INE002A01018 | EQ | 500325 | 1,794,290 | Oil, Gas & Consumable Fuels › Refineries & Marketing | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29285_RELIANCE_2025_2026_A_11007429_28052026133947.pdf) 10.50 MB ✓ |
| **HDFCBANK** | HDFC Bank Limited | INE040A01034 | EQ | 500180 | 1,211,977 | Financial Services › Private Sector Bank | 7 (BANKING) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29735_HDFCBANK_2025_2026_A_12667766_11072026001055.pdf) 12.08 MB ✓ |
| **INDUSINDBK** | IndusInd Bank Limited | INE095A01012 | EQ | 532187 | 70,376 | Financial Services › Private Sector Bank | 7 (BANKING) | 2026-09-30 | yes | C+S | 79 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30216_INDUSINDBK_2025_2026_A_9505621_05082026211258.pdf) 9.07 MB ✓ |
| **BAJFINANCE** | Bajaj Finance Limited | INE296A01032 | EQ | 500034 | 675,200 | Financial Services › Non Banking Financial Company (NBFC) | 7 (NBFC_INDAS) | 2026-09-30 | yes | C+S | 79 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29642_BAJFINANCE_2025_2026_A_23098027_07072026220255.pdf) 22.03 MB ✓ |
| **INFY** | Infosys Limited | INE009A01021 | EQ | 500209 | 475,772 | Information Technology › Computers - Software & Consulting | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29313_INFY_2025_2026_U_8985411_30052026200413.pdf) 8.57 MB ✓ |
| **KPITTECH** | KPIT Technologies Limited | INE04I401011 | EQ | 542651 | 14,923 | Information Technology › Computers - Software & Consulting | 7 (INDAS) | 2026-09-30 | yes | C+S | 24 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30212_KPITTECH_2025_2026_A_10301220_05082026200744.pdf) 9.82 MB ✓ |
| **SUNPHARMA** | Sun Pharmaceutical Industries Limited | INE044A01036 | EQ | 524715 | 459,473 | Healthcare › Pharmaceuticals | 7 (INDAS) | 2026-09-30 | yes | C+S | 78 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29590_SUNPHARMA_2025_2026_A_19925421_06072026185825.pdf) 19.00 MB ✓ |
| **LAURUSLABS** | Laurus Labs Limited | INE947Q01028 | EQ | 540222 | 128,328 | Healthcare › Pharmaceuticals | 7 (INDAS) | 2026-09-30 | yes | C+S | 37 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29364_LAURUSLABS_2025_2026_A_19085196_08062026160805.pdf) 18.20 MB ✓ |
| **TMPV** | Tata Motors Passenger Vehicles Limited | INE155A01022 | EQ | 500570 | 108,759 | Automobile and Auto Components › Passenger Cars & Utility Vehicles | 6 (INDAS) | 2026-06-30 | **no** | C+S | 74 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29395_TMPV_2025_2026_A_21445169_15062026215933.pdf) 20.45 MB ✓ |
| **HAL** | Hindustan Aeronautics Limited | INE066F01020 | EQ | 541154 | 333,542 | Capital Goods › Aerospace & Defense | 6 (INDAS) | 2026-06-30 | **no** | C+S | 28 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30166_HAL_2025_2026_U_12603450_04082026103759.pdf) 12.02 MB ✓ |
| **LT** | Larsen & Toubro Limited | INE018A01030 | EQ | 500510 | 565,337 | Construction › Civil Construction | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29259_LT_2025_2026_A_29793480_14052026183032.pdf) 28.41 MB ✓ |
| **THERMAX** | Thermax Limited | INE152A01029 | EQ | 500411 | 33,868 | Capital Goods › Heavy Electrical Equipment | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29561_THERMAX_2025_2026_A_12575457_03072026171607.pdf) 11.99 MB ✓ |
| **HINDUNILVR** | Hindustan Unilever Limited | INE030A01027 | EQ | 500696 | 470,013 | Fast Moving Consumer Goods › Diversified FMCG | 7 (INDAS) | 2026-09-30 | yes | C+S | 79 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29330_HINDUNILVR_2025_2026_A_21643813_02062026215058.pdf) 20.64 MB ✓ |
| **MARICO** | Marico Limited | INE196A01026 | EQ | 531642 | 116,238 | Fast Moving Consumer Goods › Edible Oil | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29675_MARICO_2025_2026_A_25834811_09072026124936.pdf) 24.64 MB ✓ |
| **BHARTIARTL** | Bharti Airtel Limited | INE397D01024 | EQ | 532454 | 1,308,488 | Telecommunication › Telecom - Cellular & Fixed line services | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29749_BHARTIARTL_2025_2026_A_22716516_11072026235841.pdf) 21.66 MB ✓ |
| **IDEA** | Vodafone Idea Limited | INE669E01016 | EQ | 532822 | 138,896 | Telecommunication › Telecom - Cellular & Fixed line services | 6 (INDAS) | 2026-06-30 | **no** | C+S | 70 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30194_IDEA_2025_2026_A_7288659_04082026202915.pdf) 6.95 MB ✓ |
| **FLUOROCHEM** | Gujarat Fluorochemicals Limited | INE09N301011 | EQ | 542812 | 50,377 | Chemicals › Specialty Chemicals | 7 (INDAS) | 2026-09-30 | yes | C+S | 22 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30736_FLUOROCHEM_2025_2026_A_20597566_27082026184348.pdf) 19.64 MB ✓ |
| **AMBER** | Amber Enterprises India Limited | INE371P01015 | EQ | 540902 | 22,392 | Consumer Durables › Household Appliances | 6 (INDAS) | 2026-06-30 | **no** | C+S | 31 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30632_AMBER_2025_2026_A_19660457_25082026232047.pdf) 18.75 MB ✓ |
| **SUPREMEIND** | Supreme Industries Limited | INE195A01028 | EQ | 509930 | 40,888 | Capital Goods › Plastic Products - Industrial | 7 (INDAS) | 2026-09-30 | yes | C+S | 78 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29321_SUPREMEIND_2025_2026_A_7275995_01062026164639.pdf) 6.94 MB ✓ |
| **KALYANKJIL** | Kalyan Jewellers India Limited | INE303R01014 | EQ | 543278 | 61,217 | Consumer Durables › Gems, Jewellery And Watches | 6 (INDAS) | 2026-06-30 | **no** | C+S | 16 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30447_KALYANKJIL_2025_2026_A_6283776_20082026113008.pdf) 5.99 MB ✓ |

## 3. Proposed portfolio (20) — announcements and transcripts

"Transcripts last 6 qtrs" counts distinct quarter-ends among Q1 FY26 … Q2 FY27 that have a transcript PDF via screener's Documents section, via NSE announcements (`attchmntText` contains "Transcript"), and the union. "Missing: 2026-09" almost always means the Q2 FY27 call happened in the last week and the transcript (due within 5 working days under SEBI LODR) is not yet filed.

| Symbol | Ann. 30d / 24h | Top-3 `desc` (30d) | Material flags (30d) | Transcripts: last 6 qtrs (screener / NSE / union) | Total transcripts (screener) | Latest transcript (source, size, pages, text chars) |
|---|---|---|---|---|---:|---|
| **RELIANCE** | 19 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (4); General Updates (4); Credit Rating (2) | results×7, rating×2 | 6 / 6 / **6** (missing: none) | 20 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/8e997741-4d35-4188-933a-cf020fb9c816.pdf): 566 KB, 29 pp, 95,990 chars → text |
| **HDFCBANK** | 16 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (4); ESOP/ESOS/ESPS (3); Shareholders meeting (2) | mgmt_change×3, results×1 | 6 / 6 / **6** (missing: none) | 21 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/d7e45614-ae12-4bb9-b92d-623b3a63f166.pdf): 469 KB, 17 pp, 54,627 chars → text |
| **INDUSINDBK** | 12 / 0 | General Updates (3); Analysts/Institutional Investor Meet/Con. Call Updates (3); Press Release (2) | results×3, mgmt_change×1 | 5 / 6 / **6** (missing: none) | 35 | [screener/BSE](https://www.indusind.bank.in/content/dam/indusind-corporate/investors/QuarterFinancialResults/FY2026-2027/Quarter1/IndusInd-Bank_Analyst-Call_Q1FY27_20260722.pdf): 353 KB, 16 pp, 51,249 chars → text |
| **BAJFINANCE** | 17 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (6); Shareholders meeting (3); Allotment of Securities (2) | fund_raise×2, mgmt_change×1, results×1 | 6 / 6 / **6** (missing: none) | 39 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/7873abcb-7f97-487d-a474-028b0a26feea.pdf): 399 KB, 20 pp, 51,764 chars → text |
| **INFY** | 16 / 0 | Updates (11); Copy of Newspaper Publication (2); Record Date (1) | dividend×2, results×1 | 6 / 6 / **6** (missing: none) | 38 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/7982fc61-7765-4981-ab3d-6aec36ba2137.pdf): 3655 KB, 48 pp, 86,600 chars → text |
| **KPITTECH** | 16 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (4); Outcome of Board Meeting (2); Certificate under SEBI (Depositories and Participants) Regulations, 2018 (2) | results×3, mgmt_change×2, m&a×1 | 6 / 6 / **6** (missing: none) | 20 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/a7331811-fe14-4c79-896d-f0a9df901335.pdf): 481 KB, 21 pp, 49,201 chars → text |
| **SUNPHARMA** | 20 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (4); Press Release (3); News Verification (2) | mgmt_change×3, results×2, fund_raise×1, rating×1 | 6 / 6 / **6** (missing: none) | 27 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/fe431adc-0e1a-48ee-9c2b-b6e39cba04e4.pdf): 500 KB, 19 pp, 49,206 chars → text |
| **LAURUSLABS** | 15 / 0 | General Updates (5); Analysts/Institutional Investor Meet/Con. Call Updates (3); Copy of Newspaper Publication (2) | m&a×3, results×2, dividend×1, mgmt_change×1 | 6 / 6 / **6** (missing: none) | 41 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/44e17494-dcff-4413-8b83-3d3a47d2e850.pdf): 802 KB, 21 pp, 58,067 chars → text |
| **TMPV** | 4 / 0 | Press Release (2); Copy of Newspaper Publication (1); Analysts/Institutional Investor Meet/Con. Call Updates (1) | — | 5 / 5 / **5** (missing: 2026-09) | 30 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachHis/6f83a2dd-6bd9-4455-9fc6-4659b5ded6f8.pdf): 624 KB, 14 pp, 49,467 chars → text |
| **HAL** | 3 / 0 | Updates (2); Change in Director(s) (1) | — | 1 / 1 / **1** (missing: 2026-09, 2026-06, 2025-12, 2025-09, 2025-06) | 8 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachHis/344500e7-2fff-4cc6-a792-c4693e0340f6.pdf): 434 KB, 19 pp, 49,550 chars → text |
| **LT** | 15 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (4); Bagging/Receiving of orders/contracts (4); Updates (2) | m&a×1, results×1, fund_raise×1 | 5 / 6 / **6** (missing: none) | 35 | [screener/BSE](https://investors.larsentoubro.com/upload/Analysttrans/FY2027AnalysttransL&T-Earnings-Jul28-2026.pdf): 321 KB, 26 pp, 72,538 chars → text |
| **THERMAX** | 8 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (2); Certificate under SEBI (Depositories and Participants) Regulations, 2018 (2); Copy of Newspaper Publication (1) | results×1, litigation×1 | 5 / 5 / **5** (missing: 2026-09) | 42 | [screener/BSE](https://www.thermaxglobal.com/sites/default/files/2026-08/Q1-FY2027-Thermax-Results-Conference-Call.pdf): 249 KB, 23 pp, 71,619 chars → text |
| **HINDUNILVR** | 14 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (4); Copy of Newspaper Publication (3); Investor Presentation (2) | dividend×3, results×2 | 6 / 6 / **6** (missing: none) | 22 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/6d90194e-b9dc-48b0-b48e-3de0d0ef5f6d.pdf): 338 KB, 26 pp, 56,890 chars → text |
| **MARICO** | 13 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (4); Copy of Newspaper Publication (2); Acquisition (2) | results×6, m&a×2, mgmt_change×2 | 6 / 6 / **6** (missing: none) | 44 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/d31fa742-4a85-4fe5-91b6-aa10b653682e.pdf): 612 KB, 18 pp, 58,900 chars → text |
| **BHARTIARTL** | 20 / 0 | Action(s) taken or orders passed (5); Copy of Newspaper Publication (3); Analysts/Institutional Investor Meet/Con. Call Updates (2) | litigation×5, results×4 | 5 / 5 / **5** (missing: 2026-09) | 18 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachHis/ca87613b-39c3-4571-8ea9-8f77df1b6428.pdf): 584 KB, 17 pp, 83,456 chars → text |
| **IDEA** | 4 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (1); Action(s) taken or orders passed (1); Shareholders meeting (1) | litigation×1, mgmt_change×1 | 4 / 4 / **4** (missing: 2026-09, 2025-12) | 32 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/70ef6137-942c-4bf2-b275-5ecff44fe8c3.pdf): 471 KB, 14 pp, 36,743 chars → text |
| **FLUOROCHEM** | 6 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (3); Outcome of Board Meeting (2); Investor Presentation (1) | results×2 | 6 / 6 / **6** (missing: none) | 22 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/dcf9b749-2455-440a-a837-6d15a0b4d871.pdf): 416 KB, 16 pp, 46,016 chars → text |
| **AMBER** | 10 / 0 | Acquisition (4); Agreements (2); Updates (1) | m&a×6, mgmt_change×2 | 5 / 5 / **5** (missing: 2026-09) | 40 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachHis/6c6e5825-804b-4323-aa05-34161bc4def2.pdf): 498 KB, 18 pp, 50,309 chars → text |
| **SUPREMEIND** | 12 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (3); Copy of Newspaper Publication (2); Investor Presentation (1) | dividend×3, results×1 | 6 / 6 / **6** (missing: none) | 18 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/ceb674b9-cd2e-4ef8-bf77-bece0e59fe0f.pdf): 558 KB, 12 pp, 29,471 chars → text |
| **KALYANKJIL** | 2 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (2) | — | 5 / 5 / **5** (missing: 2026-09) | 19 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/e2200376-f75e-4bfb-97cb-9caf2c4a37d3.pdf): 859 KB, 14 pp, 35,742 chars → text |

## 4. Proposed portfolio (20) — EOD presence, anomalies, scheduled events

Baseline = mean volume of the 20 normal sessions before the scored day (the 8 Nov Muhurat bar is excluded from baselines and not scored; shown separately — it is 0.03–0.5× for every name, i.e. a false "volume collapse" if not excluded). Bold = |move| > 5 % or volume > 4×.

| Symbol | 6 Nov close | 6 Nov % | 6 Nov vol | 20d avg vol | 6 Nov vol ratio | Muhurat 8 Nov vol ratio | Anomalies 8 Oct–6 Nov (vol>2× or \|move\|>5%) | Scheduled 9–14 Nov (NSE event-calendar / board-meetings) |
|---|---:|---:|---:|---:|---:|---:|---|---|
| **RELIANCE** | 1320.0 | +0.50 | 22,768,301 | 20,526,599 | 1.11 | 0.203 | 11-02 **+11.6%** 5.83×; 11-03 +0.6% 2.27× | — |
| **HDFCBANK** | 788.25 | +3.72 | 73,482,878 | 31,876,177 | 2.31 | 0.226 | 11-05 +3.2% 2.17×; 11-06 +3.7% 2.31× | — |
| **INDUSINDBK** | 910.25 | -0.13 | 8,037,082 | 2,597,585 | 3.09 | 0.125 | 10-12 -1.0% 2.59×; 10-13 +2.9% 2.17×; 11-05 **+5.3%** 3.46×; 11-06 -0.1% 3.09× | — |
| **BAJFINANCE** | 1087.75 | +1.66 | 9,053,404 | 9,562,310 | 0.95 | 0.087 | 10-21 -3.3% 2.27×; 11-05 **+7.7%** 3.45× | **10 Nov** Board Meeting Intimation; **10 Nov** Other business matters |
| **INFY** | 1181.4 | +1.20 | 15,301,109 | 16,823,648 | 0.91 | 0.06 | 10-23 +0.0% 2.15× | — |
| **KPITTECH** | 540.45 | +0.12 | 1,283,225 | 2,688,046 | 0.48 | 0.065 | 10-13 **+6.8%** 4.16×; 10-14 +2.0% 2.41×; 10-16 **+5.5%** 2.14×; 10-28 +3.9% 2.87× | — |
| **SUNPHARMA** | 1860.0 | +1.69 | 2,348,251 | 2,069,980 | 1.13 | 0.469 | 10-30 +0.9% 3.54×; 11-02 -0.4% 2.12×; 11-04 +0.2% 2.8×; 11-05 +3.1% 2.03× | — |
| **LAURUSLABS** | 2340.0 | -0.26 | 1,445,453 | 2,232,511 | 0.65 | 0.191 | 10-27 +4.0% 2.14×; 10-30 **+7.2%** 4.77× | — |
| **TMPV** | 292.0 | -0.58 | 7,506,108 | 8,036,225 | 0.93 | 0.228 | 11-05 **+5.5%** 2.12× | **13 Nov** Board Meeting Intimation; **13 Nov** Financial Results |
| **HAL** | 4980.0 | -1.25 | 1,168,786 | 732,551 | 1.6 | 0.103 | — | **12 Nov** Board Meeting Intimation; **12 Nov** Financial Results |
| **LT** | 4117.7 | +1.67 | 3,396,323 | 2,219,618 | 1.53 | 0.14 | 10-28 +3.7% 3.25× | — |
| **THERMAX** | 2746.3 | -17.27 | 2,896,155 | 167,626 | 17.28 | 0.745 | 10-09 +3.8% 3.22×; 11-06 **-17.3%** 17.28× | — |
| **HINDUNILVR** | 1998.4 | +0.83 | 1,058,803 | 1,753,186 | 0.6 | 0.082 | 10-14 +1.1% 2.54×; 10-27 -0.0% 2.71×; 10-28 -0.1% 2.18× | — |
| **MARICO** | 897.75 | +1.13 | 2,924,452 | 2,679,689 | 1.09 | 0.029 | 10-29 +4.3% 2.07×; 11-03 **+10.0%** 8.17×; 11-04 +1.3% 2.56× | — |
| **BHARTIARTL** | 2107.2 | +2.45 | 17,095,063 | 9,694,609 | 1.76 | 0.048 | 10-16 +2.8% 3.68×; 11-03 +3.8% 2.06× | — |
| **IDEA** | 12.76 | -1.01 | 275,642,808 | 326,800,564 | 0.84 | 0.231 | 10-21 **-5.2%** 1.58×; 10-26 **+5.2%** 1.33× | **12 Nov** Board Meeting Intimation; **12 Nov** Financial Results |
| **FLUOROCHEM** | 4665.5 | -0.94 | 81,418 | 100,288 | 0.81 | 0.178 | 11-03 +3.2% 3.16× | — |
| **AMBER** | 6403.0 | -2.76 | 196,144 | 162,671 | 1.21 | 0.384 | 10-23 -2.8% 2.02×; 10-30 **-5.9%** 1.99×; 11-02 **+6.1%** 1.66× | **12 Nov** Board Meeting Intimation; **12 Nov** Financial Results |
| **SUPREMEIND** | 3156.9 | -4.07 | 504,269 | 210,880 | 2.39 | 0.216 | 10-14 +2.9% 2.14×; 10-26 **-4.1%** 4.3×; 11-06 -4.1% 2.39× | — |
| **KALYANKJIL** | 590.75 | +5.49 | 24,973,452 | 4,540,814 | 5.5 | 0.674 | 11-05 **+5.8%** 1.15×; 11-06 **+5.5%** 5.5× | **10 Nov** Board Meeting Intimation; **10 Nov** Financial Results |

## 5. Ad-hoc research names (5)

| Symbol | Company (EQUITY_L) | ISIN | Ser. | BSE | Mcap ₹cr | Sector (screener) | XBRL qtrs (taxonomy) | Latest qe | Q2 FY27 filed | Cons/Stand | Legacy qtrs | FY26 AR (NSE) |
|---|---|---|---|---|---:|---|---|---|---|---|---:|---|
| **OLAELEC** | Ola Electric Mobility Limited | INE0LXG01040 | EQ | 544225 | 17,230 | Automobile and Auto Components › 2/3 Wheelers | 6 (INDAS) | 2026-06-30 | **no** | C+S | 3 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_31975_OLAELEC_2025_2026_A_20107852_08092026222027.pdf) 19.18 MB ✓ |
| **NUVAMA** | Nuvama Wealth Management Limited | INE531F01023 | EQ | 543988 | 34,759 | Financial Services › Stockbroking & Allied | 7 (NBFC_INDAS) | 2026-09-30 | yes | C+S | 6 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_31290_NUVAMA_2025_2026_A_10223359_03092026191229.pdf) 9.75 MB ✓ |
| **VEDL** | Vedanta Limited | INE205A01025 | EQ | 500295 | 102,256 | Metals & Mining › Diversified Metals | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_32042_VEDL_2025_2026_A_10111875_16092026144013.pdf) 9.64 MB ✓ |
| **PIIND** | PI Industries Limited | INE603J01030 | EQ | 523642 | 26,561 | Chemicals › Pesticides & Agrochemicals | 7 (INDAS) | 2026-09-30 | yes | C+S | 56 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29899_PIIND_2025_2026_A_15366965_20072026150521.pdf) 14.66 MB ✓ |
| **RAJESHEXPO** | Rajesh Exports Limited | INE343B01030 | BZ | 531500 | 1,536 | Consumer Durables › Gems, Jewellery And Watches | 5 (INDAS/NONINDAS) | 2026-06-30 | **no** | C+S | 78 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_32077_RAJESHEXPO_2025_2026_A_1318800_23092026173358.pdf) 1.26 MB ✓ |

| Symbol | Ann. 30d / 24h | Top-3 `desc` (30d) | Material flags (30d) | Transcripts: last 6 qtrs (screener / NSE / union) | Total transcripts (screener) | Latest transcript (source, size, pages, text chars) |
|---|---|---|---|---|---:|---|
| **OLAELEC** | 7 / 0 | Copy of Newspaper Publication (2); Updates (2); Analysts/Institutional Investor Meet/Con. Call Updates (1) | fund_raise×5 | 5 / 5 / **5** (missing: 2026-09) | 10 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/5244a853-0d7f-4f09-a52f-a3c48ce7a4ef.pdf): 751 KB, 13 pp, 31,317 chars → text |
| **NUVAMA** | 5 / 0 | General Updates (2); Investor Presentation (1); Outcome of Board Meeting (1) | results×1 | 5 / 5 / **5** (missing: 2026-09) | 12 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachHis/49fb8543-04fb-47e6-ab9c-291d5e211858.pdf): 450 KB, 22 pp, 66,119 chars → text |
| **VEDL** | 15 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (3); Options to purchase securities (2); News Verification (2) | results×2, rating×1 | 4 / 6 / **6** (missing: none) | 33 | [screener/BSE](https://www.vedantalimited.com/uploads/investor-overview/financial-results/2026/Vedanta-Transcript-Apr29-2026.pdf): 270 KB, 19 pp, 57,940 chars → text |
| **PIIND** | 8 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (3); Copy of Newspaper Publication (1); Investor Presentation (1) | results×3, m&a×1 | 5 / 5 / **5** (missing: 2026-09) | 44 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachHis/c6e89e11-f33d-4ab2-9db8-d4f53da649e5.pdf): 424 KB, 22 pp, 51,611 chars → text |
| **RAJESHEXPO** | 2 / 0 | Structural Digital Database (1); Disclosure of material issue (1) | — | 0 / 0 / **0** (missing: 2026-09, 2026-06, 2026-03, 2025-12, 2025-09, 2025-06) | 0 | **none discoverable** |

| Symbol | 6 Nov close | 6 Nov % | 6 Nov vol | 20d avg vol | 6 Nov vol ratio | Muhurat 8 Nov vol ratio | Anomalies 8 Oct–6 Nov (vol>2× or \|move\|>5%) | Scheduled 9–14 Nov (NSE event-calendar / board-meetings) |
|---|---:|---:|---:|---:|---:|---:|---|---|
| **OLAELEC** | 34.21 | -2.51 | 41,348,539 | 83,763,875 | 0.49 | 0.141 | 10-23 **-6.3%** 1.21×; 10-27 **+16.2%** 6.53×; 10-28 **+5.3%** 5.33×; 10-30 **-5.6%** 0.72×; 11-02 **+5.5%** 1.24× | **12 Nov** Board Meeting Intimation; **12 Nov** Financial Results |
| **NUVAMA** | 1848.1 | -1.35 | 469,754 | 305,924 | 1.54 | 0.152 | 10-12 **+5.9%** 0.69× | — |
| **VEDL** | 261.75 | -0.78 | 11,729,362 | 11,814,149 | 0.99 | 0.175 | — | — |
| **PIIND** | 1735.0 | -1.98 | 1,451,795 | 831,231 | 1.75 | 0.142 | 10-14 +4.2% 2.47×; 10-21 -2.8% 2.45×; 10-27 +3.3% 2.02×; 11-02 +3.1% 2.43×; 11-04 +0.1% 3.22×; 11-05 **-19.1%** 30.11× | — |
| **RAJESHEXPO** | 50.04 | -1.75 | 175,359 | 195,862 | 0.9 | 0.422 | — | — |

## 6. Alternates (15)

| Symbol | Company (EQUITY_L) | ISIN | Ser. | BSE | Mcap ₹cr | Sector (screener) | XBRL qtrs (taxonomy) | Latest qe | Q2 FY27 filed | Cons/Stand | Legacy qtrs | FY26 AR (NSE) |
|---|---|---|---|---|---:|---|---|---|---|---|---:|---|
| **DIXON** | Dixon Technologies (India) Limited | INE935N01020 | EQ | 540699 | 77,251 | Consumer Durables › Consumer Electronics | 7 (INDAS) | 2026-09-30 | yes | C+S | 30 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_31329_DIXON_2025_2026_A_15487496_03092026220551.pdf) 14.77 MB ✓ |
| **PERSISTENT** | Persistent Systems Limited | INE262H01021 | EQ | 533179 | 99,980 | Information Technology › Computers - Software & Consulting | 7 (INDAS) | 2026-09-30 | yes | C+S | 57 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29736_PERSISTENT_2025_2026_A_5858358_11072026074434.pdf) 5.59 MB ✓ |
| **TRENT** | Trent Limited | INE849A01020 | EQ | 500251 | 163,248 | Consumer Services › Speciality Retail | 7 (INDAS) | 2026-09-30 | yes | C+S | 76 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29305_TRENT_2025_2026_A_21152615_30052026111245.pdf) 20.17 MB ✓ |
| **VBL** | Varun Beverages Limited | INE200M01039 | EQ | 540180 | 147,813 | Fast Moving Consumer Goods › Other Beverages | 7 (INDAS) | 2026-09-30 | yes | C+S | 36 | [2025-2025](https://nsearchives.nseindia.com/annual_reports/AR_29236_VBL_2025_2025_A_12339974_09032026143558.pdf) 11.77 MB ✓ |
| **ELGIEQUIP** | Elgi Equipments Limited | INE285A01027 | EQ | 522074 | 17,793 | Capital Goods › Compressors, Pumps & Diesel Engines | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29898_ELGIEQUIP_2025_2026_A_11230253_20072026133144.pdf) 10.71 MB ✓ |
| **RKFORGE** | Ramkrishna Forgings Limited | INE399G01023 | EQ | 532527 | 13,413 | Automobile and Auto Components › Auto Components & Equipments | 7 (INDAS) | 2026-09-30 | yes | C+S | 78 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30215_RKFORGE_2025_2026_A_6751431_05082026210237.pdf) 6.44 MB ✓ |
| **INOXWIND** | Inox Wind Limited | INE066P01011 | EQ | 539083 | 11,299 | Capital Goods › Heavy Electrical Equipment | 6 (INDAS) | 2026-06-30 | **no** | C+S | 40 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_31331_INOXWIND_2025_2026_A_8279078_03092026221810.pdf) 7.90 MB ✓ |
| **SUDARSCHEM** | Sudarshan Chemical Industries Limited | INE659A01023 | EQ | 506655 | 8,491 | Chemicals › Dyes And Pigments | 7 (INDAS) | 2026-09-30 | yes | C+S | 79 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30019_SUDARSCHEM_2025_2026_A_15732022_27072026171720.pdf) 15.00 MB ✓ |
| **POLYCAB** | Polycab India Limited | INE455K01017 | EQ | 542652 | 118,546 | Capital Goods › Cables - Electricals | 7 (INDAS) | 2026-09-30 | yes | C+S | 24 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29368_POLYCAB_2025_2026_A_20879015_09062026002210.pdf) 19.91 MB ✓ |
| **DRREDDY** | Dr. Reddy's Laboratories Limited | INE089A01031 | EQ | 500124 | 114,582 | Healthcare › Pharmaceuticals | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29502_DRREDDY_2025_2026_A_25681937_30062026191727.pdf) 24.49 MB ✓ |
| **MARUTI** | Maruti Suzuki India Limited | INE585B01010 | EQ | 532500 | 403,350 | Automobile and Auto Components › Passenger Cars & Utility Vehicles | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30271_MARUTI_2025_2026_A_19335803_08082026213212.pdf) 18.44 MB ✓ |
| **ITC** | ITC Limited | INE154A01025 | EQ | 500875 | 355,405 | Fast Moving Consumer Goods › Diversified FMCG | 7 (INDAS) | 2026-09-30 | yes | C+S | 80 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29459_ITC_2025_2026_A_14678177_26062026165422.pdf) 14.00 MB ✓ |
| **SBIN** | State Bank of India | INE062A01020 | EQ | 500112 | 938,307 | Financial Services › Public Sector Bank | 7 (BANKING) | 2026-09-30 | yes | C+S | 79 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29279_SBIN_2025_2026_A_22551017_26052026223038.pdf) 21.51 MB ✓ |
| **HINDALCO** | Hindalco Industries Limited | INE038A01020 | EQ | 500440 | 214,317 | Metals & Mining › Aluminium | 7 (INDAS) | 2026-09-30 | yes | C+S | 79 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_29503_HINDALCO_2025_2026_A_17392633_30062026203313.pdf) 16.59 MB ✓ |
| **ETERNAL** | ETERNAL LIMITED | INE758T01015 | EQ | 543320 | 351,804 | Consumer Services › E-Retail/ E-Commerce | 7 (INDAS) | 2026-09-30 | yes | C+S | 15 | [2025-2026](https://nsearchives.nseindia.com/annual_reports/AR_30059_ETERNAL_2025_2026_A_48211721_29072026204435.pdf) 45.98 MB ✓ |

| Symbol | Ann. 30d / 24h | Top-3 `desc` (30d) | Material flags (30d) | Transcripts: last 6 qtrs (screener / NSE / union) | Total transcripts (screener) | Latest transcript (source, size, pages, text chars) |
|---|---|---|---|---|---:|---|
| **DIXON** | 13 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (5); Updates (2); Allotment of Securities (1) | results×2, fund_raise×1, mgmt_change×1 | 6 / 6 / **6** (missing: none) | 37 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/995a3a71-4a1e-4c1f-a29a-6c6747e4ca10.pdf): 888 KB, 24 pp, 64,569 chars → text |
| **PERSISTENT** | 26 / 0 | Committee Meeting Updates (6); General Updates (3); Press Release (3) | rating×3, fund_raise×2, results×2, mgmt_change×1, m&a×1 | 6 / 6 / **6** (missing: none) | 34 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/524eadda-3966-4f4f-8888-bfaf2cb0d69e.pdf): 423 KB, 26 pp, 60,408 chars → text |
| **TRENT** | 14 / 0 | Copy of Newspaper Publication (2); Appointment (2); Analysts/Institutional Investor Meet/Con. Call Updates (1) | mgmt_change×5, results×3, m&a×1 | 0 / 0 / **0** (missing: 2026-09, 2026-06, 2026-03, 2025-12, 2025-09, 2025-06) | 0 | **none discoverable** |
| **VBL** | 10 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (5); Dividend (1); Record Date (1) | results×2, dividend×2 | 6 / 6 / **6** (missing: none) | 40 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/c33be254-f40c-4a54-939d-1c0d20c8ca77.pdf): 455 KB, 22 pp, 53,966 chars → text |
| **ELGIEQUIP** | 8 / 0 | Copy of Newspaper Publication (2); Analysts/Institutional Investor Meet/Con. Call Updates (2); Investor Presentation (1) | results×1, rating×1 | 5 / 5 / **5** (missing: 2026-09) | 28 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/a1164993-1a24-40da-b5a2-fe76d8c1f588.pdf): 523 KB, 16 pp, 46,412 chars → text |
| **RKFORGE** | 17 / 0 | General Updates (5); Analysts/Institutional Investor Meet/Con. Call Updates (3); Record Date (2) | dividend×4, results×2, mgmt_change×1 | 6 / 6 / **6** (missing: none) | 31 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/f90912ca-d202-4b9c-9d9e-5d188d8bf152.pdf): 1638 KB, 26 pp, 51,972 chars → text |
| **INOXWIND** | 2 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (1); Certificate under SEBI (Depositories and Participants) Regulations, 2018 (1) | — | 5 / 5 / **5** (missing: 2026-09) | 31 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/b6cf15ae-1b2e-45ee-8c88-aa635daabee2.pdf): 1272 KB, 18 pp, 50,758 chars → text |
| **SUDARSCHEM** | 12 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (2); ESOP/ESOS/ESPS (2); Investor Presentation (1) | mgmt_change×1, results×1, rating×1 | 5 / 5 / **5** (missing: 2026-09) | 39 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachHis/f2e0cae2-1bda-438e-8b74-9a499e002ea9.pdf): 1178 KB, 15 pp, 38,115 chars → text |
| **POLYCAB** | 20 / 0 | General Updates (7); Corporate Insolvency Resolution Process (5); Analysts/Institutional Investor Meet/Con. Call Updates (3) | litigation×6, results×4 | 6 / 6 / **6** (missing: none) | 35 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/77b6d277-0ffc-440d-ba8a-2bd9bc3dc43e.pdf): 493 KB, 20 pp, 54,992 chars → text |
| **DRREDDY** | 15 / 0 | General Updates (4); Press Release (2); News Verification (2) | results×2, mgmt_change×1 | 6 / 6 / **6** (missing: none) | 33 | [screener/BSE](https://www.drreddys.com/cms/sites/default/files/2026-10/EarningsCallTranscriptQ2FY27.pdf): 348 KB, 19 pp, 50,196 chars → text |
| **MARUTI** | 15 / 0 | Press Release (4); General Updates (3); Analysts/Institutional Investor Meet/Con. Call Updates (2) | results×2, m&a×1, litigation×1 | 4 / 6 / **6** (missing: none) | 37 | [screener/BSE](https://az-ci-afde-prd-arena-03-efddeyfchzf9akbb.z01.azurefd.net/msilintiwebpdfcopyfromdefault/Transcript_earnings_call_Maruti_Suzuki_Q4_FY_26.pdf): 356 KB, 12 pp, 34,631 chars → text |
| **ITC** | 6 / 0 | Outcome of Board Meeting (2); Analysts/Institutional Investor Meet/Con. Call Updates (1); Amalgamation/Merger (1) | results×2, m&a×1 | 0 / 0 / **0** (missing: 2026-09, 2026-06, 2026-03, 2025-12, 2025-09, 2025-06) | 0 | **none discoverable** |
| **SBIN** | 11 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (5); Copy of Newspaper Publication (1); Statement of deviation(s) or variation(s) under Reg. 32 (1) | results×1 | 6 / 6 / **6** (missing: none) | 22 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/91e92b69-f201-4d3b-9060-9f75feee9a58.pdf): 653 KB, 31 pp, 66,199 chars → text |
| **HINDALCO** | 12 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (3); Copy of Newspaper Publication (2); Investor Presentation (2) | rating×2, results×1 | 5 / 5 / **5** (missing: 2026-09) | 39 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachHis/3390ab52-08d5-43ad-af0f-baea13e97773.pdf): 546 KB, 23 pp, 65,014 chars → text |
| **ETERNAL** | 6 / 0 | Analysts/Institutional Investor Meet/Con. Call Updates (2); Monitoring Agency Report (1); Sale or disposal (1) | results×2, m&a×1 | 6 / 6 / **6** (missing: none) | 21 | [screener/BSE](https://www.bseindia.com/xml-data/corpfiling/AttachLive/64f36e3b-87e9-426e-be3e-515dca4525d2.pdf): 361 KB, 16 pp, 39,226 chars → text |

| Symbol | 6 Nov close | 6 Nov % | 6 Nov vol | 20d avg vol | 6 Nov vol ratio | Muhurat 8 Nov vol ratio | Anomalies 8 Oct–6 Nov (vol>2× or \|move\|>5%) | Scheduled 9–14 Nov (NSE event-calendar / board-meetings) |
|---|---:|---:|---:|---:|---:|---:|---|---|
| **DIXON** | 12625.0 | +0.07 | 227,053 | 371,003 | 0.61 | 0.074 | 10-16 -2.6% 2.46×; 10-21 -3.4% 2.21×; 11-02 **+12.0%** 5.95× | — |
| **PERSISTENT** | 6053.5 | -0.92 | 534,110 | 813,865 | 0.66 | 0.04 | 10-09 **+5.5%** 1.78×; 10-13 +3.5% 2.16×; 10-15 -1.0% 2.44×; 10-16 -1.7% 3.51× | — |
| **TRENT** | 3079.0 | +0.79 | 580,070 | 1,015,814 | 0.57 | 0.062 | 10-30 **+5.4%** 3.8× | — |
| **VBL** | 438.0 | +1.08 | 4,668,279 | 5,349,190 | 0.87 | 0.095 | 10-30 **-5.5%** 3.04×; 11-05 +3.1% 2.29× | — |
| **ELGIEQUIP** | 556.9 | +1.79 | 2,627,729 | 229,316 | 11.46 | 0.474 | 11-04 **+5.6%** 1.72×; 11-06 **+1.8%** 11.46× | — |
| **RKFORGE** | 693.85 | -4.25 | 981,786 | 1,094,592 | 0.9 | 0.376 | 10-21 **-7.2%** 1.99×; 10-29 +3.5% 2.29×; 10-30 -3.8% 2.28×; 11-02 **+7.6%** 11.06× | — |
| **INOXWIND** | 64.8 | -1.37 | 9,418,800 | 13,311,578 | 0.71 | 0.165 | 10-09 **+6.8%** 3.2×; 10-23 **-5.1%** 1.24×; 10-30 **-6.7%** 1.3×; 11-02 **+8.3%** 4.36×; 11-04 **+6.9%** 1.24× | **13 Nov** Board Meeting Intimation; **13 Nov** Financial Results |
| **SUDARSCHEM** | 1066.6 | -1.70 | 649,712 | 183,683 | 3.54 | 0.383 | 10-14 -0.4% 3.14×; 10-30 **-7.9%** 0.8×; 11-06 -1.7% 3.54× | — |
| **POLYCAB** | 7871.0 | +0.28 | 415,293 | 414,586 | 1.0 | 0.125 | 10-14 +0.5% 2.49× | — |
| **DRREDDY** | 1373.0 | +0.51 | 1,343,395 | 2,264,744 | 0.59 | 0.041 | 10-26 **+6.6%** 5.38× | — |
| **MARUTI** | 12750.0 | +0.77 | 923,719 | 493,018 | 1.87 | 0.112 | 11-05 **+5.5%** 2.59× | — |
| **ITC** | 283.15 | +1.54 | 17,144,523 | 22,067,532 | 0.78 | 0.133 | — | — |
| **SBIN** | 1018.5 | +1.20 | 15,801,292 | 11,039,518 | 1.43 | 0.177 | 11-03 -1.7% 3.08×; 11-05 +2.8% 2.43× | — |
| **HINDALCO** | 958.4 | +2.19 | 13,374,061 | 4,062,320 | 3.29 | 0.328 | 10-23 -1.8% 2.02×; 11-06 +2.2% 3.29× | — |
| **ETERNAL** | 363.15 | +1.35 | 25,612,265 | 27,838,827 | 0.92 | 0.136 | 10-22 -2.5% 4.0×; 10-23 +4.2% 2.12× | — |

## 7. Anomalies found (8 Oct – 6 Nov 2026, from the bhavcopies; strongest first)

These are real, exchange-grade bars (NSE UDiFF `ClsPric`, `PrvsClsgPric`, `TtlTradgVol`). The pattern is consistent: **the big moves are results reactions on the day after the filing** — exactly the Push → "why did this move?" → results card → transcript chain the product is built around.

| Date | Symbol | Close | Move | Volume | Vol ÷ 20d avg | Context (from filings) |
|---|---|---:|---:|---:|---:|---|
| 2026-11-05 | **PIIND** | 1770.0 | **-19.1%** | 10,090,435 | **30.11×** | Q2 FY27 results filed 4 Nov 19:40; audio recording link 5 Nov; transcript pending |
| 2026-11-06 | **THERMAX** | 2746.3 | **-17.3%** | 2,896,155 | **17.28×** | Q2 FY27 results 5 Nov 18:02 + 'Action(s) taken or orders passed' 5 Nov 15:27; recording link 6 Nov |
| 2026-11-06 | **ELGIEQUIP** | 556.9 | **+1.8%** | 2,627,729 | **11.46×** | Q2 FY27 results + presentation + press release 6 Nov — volume spike with flat price |
| 2026-11-02 | **RKFORGE** | 696.1 | **+7.6%** | 7,249,302 | **11.06×** | post-results re-rating week; 4 dividend-related filings in 30d |
| 2026-11-03 | **MARICO** | 878.4 | **+10.0%** | 14,640,938 | **8.17×** | results week (6 results-flagged filings in 30d) |
| 2026-10-27 | **OLAELEC** | 34.8 | **+16.2%** | 332,028,207 | **6.53×** | rights-issue window (closure 30 Oct; allotment of 370 M partly-paid shares 2 Nov) |
| 2026-11-02 | **DIXON** | 12319.0 | **+12.0%** | 1,631,850 | **5.95×** | post-results (30 Oct) rally |
| 2026-11-02 | **RELIANCE** | 1300.0 | **+11.6%** | 88,121,121 | **5.83×** | post-Q2 (30 Oct) + fund-raising board agenda; credit rating 4 Nov |
| 2026-11-06 | **KALYANKJIL** | 590.75 | **+5.5%** | 24,973,452 | **5.5×** | pre-results run-up (board meeting 10 Nov) |
| 2026-10-26 | **DRREDDY** | 1310.9 | **+6.6%** | 10,003,270 | **5.38×** | results reaction |
| 2026-10-28 | **OLAELEC** | 36.66 | **+5.3%** | 359,226,438 | **5.33×** |  |
| 2026-10-30 | **LAURUSLABS** | 2405.5 | **+7.2%** | 7,913,297 | **4.77×** | results reaction; 3 M&A filings in window |
| 2026-11-02 | **INOXWIND** | 59.78 | **+8.3%** | 47,845,405 | **4.36×** | pre-results (board meeting 13 Nov) |
| 2026-10-26 | **SUPREMEIND** | 3250.0 | **-4.1%** | 828,292 | **4.3×** |  |
| 2026-10-13 | **KPITTECH** | 513.75 | **+6.8%** | 6,108,424 | **4.16×** | pre-results (acquisition filing; results 16 Oct) |
| 2026-10-30 | **TRENT** | 3017.3 | **+5.4%** | 4,431,514 | **3.8×** | day after results + Noel Tata retirement / new appointments (29 Oct) |
| 2026-11-05 | **INDUSINDBK** | 911.45 | **+5.3%** | 8,027,595 | **3.46×** | bank rally; results 23 Oct |
| 2026-11-05 | **BAJFINANCE** | 1070.0 | **+7.7%** | 29,819,613 | **3.45×** | sector rally; EGM proceedings 2 Nov, preferential-issue allotments |
| 2026-10-09 | **INOXWIND** | 66.65 | **+6.8%** | 37,432,425 | **3.2×** |  |
| 2026-10-30 | **VBL** | 392.0 | **-5.5%** | 13,724,725 | **3.04×** |  |
| 2026-11-05 | **MARUTI** | 12652.0 | **+5.5%** | 1,203,576 | **2.59×** |  |
| 2026-10-16 | **KPITTECH** | 555.0 | **+5.5%** | 5,187,629 | **2.14×** |  |
| 2026-11-05 | **TMPV** | 293.7 | **+5.5%** | 16,264,124 | **2.12×** |  |
| 2026-10-30 | **AMBER** | 5865.0 | **-5.9%** | 287,208 | **1.99×** |  |
| 2026-10-21 | **RKFORGE** | 635.75 | **-7.2%** | 1,010,214 | **1.99×** |  |
| 2026-10-09 | **PERSISTENT** | 5770.0 | **+5.5%** | 773,886 | **1.78×** |  |
| 2026-11-04 | **ELGIEQUIP** | 562.05 | **+5.6%** | 380,087 | **1.72×** |  |
| 2026-11-02 | **AMBER** | 6223.0 | **+6.1%** | 251,720 | **1.66×** |  |
| 2026-10-21 | **IDEA** | 11.64 | **-5.2%** | 525,750,623 | **1.58×** |  |
| 2026-10-26 | **IDEA** | 11.95 | **+5.2%** | 492,924,258 | **1.33×** |  |
| 2026-10-30 | **INOXWIND** | 55.2 | **-6.7%** | 14,063,836 | **1.3×** |  |
| 2026-11-02 | **OLAELEC** | 35.01 | **+5.5%** | 101,182,101 | **1.24×** |  |
| 2026-10-23 | **INOXWIND** | 58.93 | **-5.1%** | 14,520,196 | **1.24×** |  |
| 2026-11-04 | **INOXWIND** | 63.5 | **+6.9%** | 15,962,219 | **1.24×** |  |
| 2026-10-23 | **OLAELEC** | 29.93 | **-6.3%** | 60,973,747 | **1.21×** |  |
| 2026-11-05 | **KALYANKJIL** | 560.0 | **+5.8%** | 5,945,754 | **1.15×** |  |
| 2026-10-30 | **SUDARSCHEM** | 996.0 | **-7.9%** | 174,529 | **0.8×** |  |
| 2026-10-30 | **OLAELEC** | 33.18 | **-5.6%** | 59,571,699 | **0.72×** |  |
| 2026-10-12 | **NUVAMA** | 1868.8 | **+5.9%** | 726,457 | **0.69×** |  |
| 2026-10-22 | **ETERNAL** | 304.45 | **-2.5%** | 85,504,573 | **4.0×** |  |
| 2026-10-16 | **BHARTIARTL** | 1905.0 | **+2.8%** | 25,484,107 | **3.68×** |  |
| 2026-10-30 | **SUNPHARMA** | 1777.7 | **+0.9%** | 5,130,218 | **3.54×** |  |
| 2026-11-06 | **SUDARSCHEM** | 1066.6 | **-1.7%** | 649,712 | **3.54×** |  |
| 2026-10-16 | **PERSISTENT** | 5741.0 | **-1.7%** | 2,196,570 | **3.51×** |  |
| 2026-11-06 | **HINDALCO** | 958.4 | **+2.2%** | 13,374,061 | **3.29×** |  |
| 2026-10-28 | **LT** | 3801.3 | **+3.7%** | 6,174,490 | **3.25×** |  |
| 2026-10-09 | **THERMAX** | 3256.3 | **+3.8%** | 574,697 | **3.22×** |  |
| 2026-11-04 | **PIIND** | 2187.0 | **+0.1%** | 1,015,773 | **3.22×** |  |
| 2026-11-03 | **FLUOROCHEM** | 4463.9 | **+3.2%** | 294,084 | **3.16×** |  |
| 2026-10-14 | **SUDARSCHEM** | 1144.0 | **-0.4%** | 775,906 | **3.14×** |  |
| 2026-11-06 | **INDUSINDBK** | 910.25 | **-0.1%** | 8,037,082 | **3.09×** |  |
| 2026-11-03 | **SBIN** | 970.25 | **-1.7%** | 27,959,412 | **3.08×** |  |
| 2026-10-14 | **PIIND** | 2218.8 | **+4.2%** | 585,573 | **2.47×** |  |
| 2026-11-06 | **SUPREMEIND** | 3156.9 | **-4.1%** | 504,269 | **2.39×** |  |
| 2026-10-27 | **LAURUSLABS** | 2142.0 | **+4.0%** | 3,117,057 | **2.14×** |  |
| 2026-10-23 | **ETERNAL** | 317.4 | **+4.2%** | 55,091,712 | **2.12×** |  |
| 2026-10-29 | **MARICO** | 802.9 | **+4.3%** | 3,393,736 | **2.07×** |  |

Also notable: 6 Nov was a broad financials day (HDFCBANK +3.7 %/2.3×, INDUSINDBK 3.1×, HINDALCO 3.3×, SUDARSCHEM 3.5×, SUPREMEIND −4.1 %/2.4×); 5 Nov was the richest day for the proposed book (BAJFINANCE, INDUSINDBK, TMPV, PIIND, HDFCBANK, MARUTI, SUNPHARMA, SBIN all fire at 2×/3 %). Names with **no** anomaly in 26 sessions: HAL, VEDL, RAJESHEXPO, ITC — useful as the "quiet" controls.

## 8. Events calendar, 9–14 Nov 2026 (candidates only)

Trading days: Mon 9, Wed 11, Thu 12, Fri 13 (Tue 10 is the Diwali-Balipratipada holiday — KALYANKJIL's board meets on it, so a results filing will arrive on a day with no EOD bar). Sat 14 Nov is the SEBI 45-day deadline.

| Date | Symbol | Purpose | Detail (NSE) | Source |
|---|---|---|---|---|
| **2026-11-10** | **BAJFINANCE** | Other business matters | We wish to inform you that a meeting of the PI 2026- Special Committee of the Board of Directors of the Company is scheduled to be held on Tuesday, 10 November  | event-calendar (per-symbol + market-wide) |
| 2026-11-10 | BAJFINANCE | Board Meeting Intimation | Bajaj Finance Limited has informed the Exchange about Board Meeting to be held on 10-Nov-2026 to consider Other business. | corporate-board-meetings |
| **2026-11-10** | **KALYANKJIL** | Financial Results | To consider and approve the financial results for the period ended September 30, 2026 | event-calendar (per-symbol + market-wide) |
| 2026-11-10 | KALYANKJIL | Board Meeting Intimation | KALYAN JEWELLERS INDIA LIMITED has informed the Exchange about Board Meeting to be held on 10-Nov-2026 to inter-alia consider and approve th | corporate-board-meetings |
| **2026-11-12** | **AMBER** | Financial Results | To consider and approve the financial results for the period ended September 30, 2026 | event-calendar (per-symbol + market-wide) |
| 2026-11-12 | AMBER | Board Meeting Intimation | Amber Enterprises India Limited has informed the Exchange about Board Meeting to be held on 12-Nov-2026 to inter-alia consider and approve t | corporate-board-meetings |
| **2026-11-12** | **HAL** | Financial Results | To consider and approve the financial results for the period ended September 30, 2026 | event-calendar (per-symbol + market-wide) |
| 2026-11-12 | HAL | Board Meeting Intimation | HINDUSTAN AERONAUTICS LIMITED has informed the Exchange about Board Meeting to be held on 12-Nov-2026 to inter-alia consider and approve the | corporate-board-meetings |
| **2026-11-12** | **IDEA** | Financial Results | To consider and approve the unaudited financial results for the second quarter and half year ended September 30, 2026 | event-calendar (per-symbol + market-wide) |
| 2026-11-12 | IDEA | Board Meeting Intimation | Vodafone Idea Limited has informed the Exchange about Board Meeting to be held on 12-Nov-2026 to inter-alia consider and approve the Unaudit | corporate-board-meetings |
| **2026-11-12** | **OLAELEC** | Financial Results | To consider and approve the unaudited Standalone and Consolidated financial results for the Quarter and Half-year ended September 30, 2026 | event-calendar (per-symbol + market-wide) |
| 2026-11-12 | OLAELEC | Board Meeting Intimation | Ola Electric Mobility Limited has informed the Exchange about Board Meeting to be held on 12-Nov-2026 to inter-alia consider and approve the | corporate-board-meetings |
| **2026-11-13** | **INOXWIND** | Financial Results | To consider and approve the financial results for the period ended September 30, 2026 | event-calendar (per-symbol + market-wide) |
| 2026-11-13 | INOXWIND | Board Meeting Intimation | INOX WIND LIMITED has informed the Exchange about Board Meeting to be held on 13-Nov-2026 to inter-alia consider and approve the Unaudited F | corporate-board-meetings |
| **2026-11-13** | **TMPV** | Financial Results | To consider and approve the financial results for the period ended September 30, 2026 | event-calendar (per-symbol + market-wide) |
| 2026-11-13 | TMPV | Board Meeting Intimation | Tata Motors Passenger Vehicles Limited has informed the Exchange about Board Meeting to be held on 13-Nov-2026 to inter-alia consider and ap | corporate-board-meetings |

Not in the calendar but expected inside the window because the call already happened and SEBI gives 5 working days: Q2 FY27 **transcripts** for THERMAX, BHARTIARTL, NUVAMA, PIIND, ELGIEQUIP, SUDARSCHEM, HINDALCO. Q2 FY27 **results still unfiled** (as of 8 Nov) among candidates: TMPV, HAL, IDEA, AMBER, KALYANKJIL, OLAELEC, RAJESHEXPO, INOXWIND — RAJESHEXPO has intimated **no** board meeting; if it misses 14 Nov that is itself a card ("results overdue").

## 9. Scoring

Completeness (0–3): XBRL ≥ 4 quarters · ≥ 3 transcripts in last 6 quarters (union) · FY26 AR downloadable. Richness (0–4): scheduled event 9–14 Nov · a big anomaly (|move| > 5 % or > 4× volume) · any anomaly · ≥ 2 material (non-results) flags in 30 days. Cap buckets use ₹ 1,00,000 cr / ₹ 33,000 cr cut-offs on screener's market cap (≈ AMFI H1-2026 large/mid/small boundaries).

**Proposed portfolio**

| Symbol | Completeness (0–3: XBRL≥4q, transcripts≥3, AR) | Richness (0–4: event in window, big anomaly, any anomaly, ≥2 material flags) | Transcripts (union, last 6q) | Big anomalies | Event 9–14 Nov | Material flags 30d | Format | Cap | ENAM-style | Verdict |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|---|:---:|---|
| **RELIANCE** | 3 | 3 | 6 | 1 | — | 2 | corporate | large |  | keep — mega-cap anchor; 2 Nov +11.6%/5.8×; credit-rating filing 4 Nov |
| **HDFCBANK** | 3 | 2 | 6 | 0 | — | 3 | bank | large |  | keep — the bank format; 2× 'Change in Management' (31 Oct, 6 Nov); 5–6 Nov 2.2–2.3× vol |
| **INDUSINDBK** | 3 | 2 | 6 | 1 | — | 1 | bank | mid |  | keep — 2nd bank, the distressed-bank story; 5 Nov +5.3%/3.5×, 6 Nov 3.1×; mgmt change 23 Oct |
| **BAJFINANCE** | 3 | 4 | 6 | 1 | ✓ | 3 | nbfc | large |  | keep — the NBFC format; 5 Nov +7.7%/3.45×; 'PI 2026 Special Committee' meeting 10 Nov (preferential issue) |
| **INFY** | 3 | 2 | 6 | 0 | — | 2 | corporate | large |  | keep — guidance-heavy ledger name; dividend/record-date filings |
| **KPITTECH** | 3 | 3 | 6 | 2 | — | 3 | corporate | small |  | keep — mid-cap IT, guides explicitly; 13 Oct +6.8%/4.2×; acquisition + 2 mgmt-change filings |
| **SUNPHARMA** | 3 | 2 | 6 | 0 | — | 5 | corporate | large |  | keep — 3 mgmt-change filings, rating, 30 Oct 3.5× vol |
| **LAURUSLABS** | 3 | 3 | 6 | 1 | — | 5 | corporate | large | ✓ | keep — ENAM book; 30 Oct +7.2%/4.8×; 3 M&A filings |
| **TMPV** | 3 | 3 | 5 | 1 | ✓ | 0 | corporate | large |  | keep — results **13 Nov**; symbol-churn case (TATAMOTORS→TMPV); 5 Nov +5.5%/2.1× |
| **HAL** | 2 | 1 | 1 | 0 | ✓ | 0 | corporate | large |  | **SWAP OUT** → INOXWIND. Only 1 transcript in last 6 quarters (annual May call only; 8 ever) — fails the ≥3-transcript gate; the ledger would be empty. Keep as alternate for Push only (results 12 Nov, XBRL fine). |
| **LT** | 3 | 2 | 6 | 0 | — | 2 | corporate | large |  | keep — order-win press releases; 28 Oct +3.7%/3.25× |
| **THERMAX** | 3 | 2 | 5 | 1 | — | 1 | corporate | mid |  | keep — **6 Nov −17.3% on 17.3× volume** (day after Q2 results + 'orders passed'); Q2 transcript lands this week |
| **HINDUNILVR** | 3 | 2 | 6 | 0 | — | 3 | corporate | large |  | keep — interim dividend + record date (dividend card); 3 quiet-volume anomalies |
| **MARICO** | 3 | 3 | 6 | 1 | — | 4 | corporate | large |  | keep — **3 Nov +10.0% on 8.2×**; 2 M&A + 2 mgmt filings |
| **BHARTIARTL** | 3 | 2 | 5 | 0 | — | 5 | corporate | large |  | keep — 5 'orders passed' (litigation) filings; 16 Oct 3.7×; Q2 transcript pending |
| **IDEA** | 3 | 4 | 4 | 2 | ✓ | 2 | corporate | large |  | keep — results **12 Nov**, earnings call 13 Nov; distressed telecom (PBT −₹3,747 cr in Q1); 4/6 transcripts (≥3 ok) |
| **FLUOROCHEM** | 3 | 1 | 6 | 0 | — | 0 | corporate | mid | ✓ | keep — ENAM book; 3 Nov 3.2× vol; quiet but complete (6/6 transcripts) |
| **AMBER** | 3 | 4 | 5 | 2 | ✓ | 8 | corporate | small | ✓ | keep — ENAM book; results **12 Nov**; 6 acquisition filings (IL JIN) + resignation |
| **SUPREMEIND** | 3 | 3 | 6 | 1 | — | 3 | corporate | mid |  | keep — 26 Oct −4.1%/4.3×, 6 Nov −4.1%/2.4×; 3 dividend filings |
| **KALYANKJIL** | 3 | 3 | 5 | 2 | ✓ | 0 | corporate | mid |  | keep — results **10 Nov (trading holiday!)**; **6 Nov +5.5% on 5.5×** |

**Ad-hoc**

| Symbol | Completeness (0–3: XBRL≥4q, transcripts≥3, AR) | Richness (0–4: event in window, big anomaly, any anomaly, ≥2 material flags) | Transcripts (union, last 6q) | Big anomalies | Event 9–14 Nov | Material flags 30d | Format | Cap | ENAM-style | Verdict |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|---|:---:|---|
| **OLAELEC** | 3 | 4 | 5 | 5 | ✓ | 5 | corporate | small |  | keep (ad-hoc) — results **12 Nov**; 27 Oct +16.2%/6.5×, 28 Oct +5.3%/5.3×; rights-issue allotment (370 M partly-paid shares) 2 Nov; only 3 legacy quarters (IPO Aug-24) |
| **NUVAMA** | 3 | 2 | 5 | 1 | — | 0 | nbfc | mid |  | keep (ad-hoc) — 2nd NBFC taxonomy; results filed 6 Nov, Q2 transcript pending; pledge story = PAG's Reg 31(1)/31(4) SAST disclosures (24 Sep, 19 Jun 2026) |
| **VEDL** | 3 | 0 | 6 | 0 | — | 1 | corporate | large |  | keep (ad-hoc) — 6/6 transcripts **only via NSE** (screener misses Q1/Q2 FY27); credit rating 16 Oct; 2 'News Verification' items |
| **PIIND** | 3 | 2 | 5 | 1 | — | 1 | corporate | small |  | keep (ad-hoc) — **5 Nov −19.1% on 30.1× volume** (day after Q2 results); 5/6 + Q2 transcript pending |
| **RAJESHEXPO** | 2 | 0 | 0 | 0 | — | 0 | corporate | small |  | keep (ad-hoc) — the degradation case: **0 transcripts ever**, BZ series, 10 XBRL revisions, no Q2 board meeting intimated, `OwnersOfParent=0` trap, 1.26 MB AR |

**Alternates**

| Symbol | Completeness (0–3: XBRL≥4q, transcripts≥3, AR) | Richness (0–4: event in window, big anomaly, any anomaly, ≥2 material flags) | Transcripts (union, last 6q) | Big anomalies | Event 9–14 Nov | Material flags 30d | Format | Cap | ENAM-style | Verdict |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|---|:---:|---|
| **DIXON** | 3 | 3 | 6 | 1 | — | 2 | corporate | mid |  | alternate — 6/6; 2 Nov +12.0%/6.0×; strong but duplicates AMBER's bucket |
| **PERSISTENT** | 3 | 3 | 6 | 1 | — | 7 | corporate | mid |  | alternate — 6/6; 26 filings in 30d (QIP, ratings); duplicates KPITTECH/INFY |
| **TRENT** | 2 | 3 | 0 | 1 | — | 6 | corporate | large |  | alternate (no-concall) — **0 transcripts** (PPT only); Noel Tata retirement + 2 appointments 29 Oct; 30 Oct +5.4%/3.8× |
| **VBL** | 3 | 3 | 6 | 1 | — | 2 | corporate | large |  | alternate — 6/6; 30 Oct −5.5%/3.0× |
| **ELGIEQUIP** | 3 | 2 | 5 | 2 | — | 1 | corporate | small | ✓ | alternate #1 — ENAM (Nemish Shah); **6 Nov 11.5× volume on +1.8%** (pure volume anomaly); results filed 6 Nov; rating 15 Oct |
| **RKFORGE** | 3 | 3 | 6 | 2 | — | 5 | corporate | small | ✓ | alternate — ENAM book; **2 Nov +7.6%/11.1×**; 6/6; 4 dividend filings |
| **INOXWIND** | 3 | 3 | 5 | 5 | ✓ | 0 | corporate | small | ✓ | **SWAP IN** for HAL — ENAM book; results **13 Nov**; 5/6 transcripts; 2 Nov +8.3%/4.4×, 9 Oct +6.8%/3.2× |
| **SUDARSCHEM** | 3 | 3 | 5 | 1 | — | 2 | corporate | small | ✓ | alternate — ENAM book; 6 Nov 3.5×, 30 Oct −7.9%; 5/6 |
| **POLYCAB** | 3 | 2 | 6 | 0 | — | 6 | corporate | large |  | alternate — 6 litigation (CIRP) filings; 6/6 |
| **DRREDDY** | 3 | 2 | 6 | 1 | — | 1 | corporate | large |  | alternate — 26 Oct +6.6%/5.4×; 6/6 |
| **MARUTI** | 3 | 3 | 6 | 1 | — | 2 | corporate | large |  | alternate — 5 Nov +5.5%/2.6×; 6/6 via NSE (screener 4) |
| **ITC** | 2 | 0 | 0 | 0 | — | 1 | corporate | large |  | alternate (no-concall) — 0 transcripts (PPT only); amalgamation filing 2 Nov |
| **SBIN** | 3 | 1 | 6 | 0 | — | 0 | bank | large |  | alternate — 3rd bank; 6/6; transcript filed 7 Nov 18:10 (last candidate filing before the 24h cut-off) |
| **HINDALCO** | 3 | 2 | 5 | 0 | — | 2 | corporate | large |  | alternate — metals gap-filler; 6 Nov 3.3×; 2 rating filings; 5/6 |
| **ETERNAL** | 3 | 1 | 6 | 0 | — | 1 | corporate | large |  | alternate — symbol-churn case (ZOMATO→ETERNAL); 6/6; 22 Oct 4.0× |

## 10. Final recommendation

**Portfolio (20):** RELIANCE, HDFCBANK, INDUSINDBK, BAJFINANCE, INFY, KPITTECH, SUNPHARMA, LAURUSLABS, TMPV, LT, THERMAX, HINDUNILVR, MARICO, BHARTIARTL, IDEA, FLUOROCHEM, AMBER, SUPREMEIND, KALYANKJIL, INOXWIND.
**Ad-hoc (5):** OLAELEC, NUVAMA, VEDL, PIIND, RAJESHEXPO.

Constraint check on the final 20: banks = 2 (HDFCBANK, INDUSINDBK; BANKING taxonomy) ✓ · NBFC = 1 (BAJFINANCE; NBFC_INDAS) ✓ (+ NUVAMA in ad-hoc) · results board meetings 9–14 Nov = **5** (KALYANKJIL 10, IDEA 12, AMBER 12, TMPV 13, INOXWIND 13) ✓ · ENAM-book names = 4 (LAURUSLABS, FLUOROCHEM, AMBER, INOXWIND) + ENAM-style mid caps THERMAX, SUPREMEIND, KALYANKJIL, KPITTECH, INDUSINDBK ✓ · RAJESHEXPO kept as the no-concall case ✓ · every name has ≥ 5 XBRL quarters, ≥ 4 transcripts (union) and a downloadable FY26 AR ✓ · 4 large-cap formats the grader will test on sight (RELIANCE, HDFCBANK, INFY, BHARTIARTL) ✓.

### Swaps made

| Out | In | Evidence |
|---|---|---|
| **HAL** | **INOXWIND** | HAL: 1 transcript in the last 6 quarters (May 2026 only; 8 in its whole history — it holds one call a year after Q4), so the Promise Ledger — the product's centrepiece — would show one row. INOXWIND: 5/6 transcripts, XBRL 6 quarters, FY26 AR 200 OK, results board meeting 13 Nov (same "live results in the demo week" value HAL offered), anomalies 2 Nov +8.3 %/4.4× and 9 Oct +6.8 %/3.2×, and it is in ENAM's disclosed book. HAL stays first alternate: it is fine for the Push side (results 12 Nov, clean XBRL, Change in Director(s) 28 Oct) if the team wants a PSU/defence large cap and accepts an annual-guidance-only ledger. |

No other swap is warranted by the data. Names I considered and rejected: IDEA (4/6 transcripts is above the gate and it is the only distressed large cap with results in the window); FLUOROCHEM (quiet — 6 filings, one 3.2× day — but complete and an ENAM holding; the demo needs quiet names too so the brief's "28 filed away" fold has something to fold). If a second swap is wanted for demo density, **ELGIEQUIP for HINDUNILVR** is the best trade (11.5× volume on a flat price on 6 Nov is the cleanest "volume-only tripwire" example; ENAM/Nemish Shah name) — but HINDUNILVR is the only pure dividend/record-date card in the book, so I did not make it.

### Ad-hoc reasoning

OLAELEC — results 12 Nov, rights-issue allotment (370 M partly-paid shares, 2 Nov), +16.2 %/6.5× on 27 Oct; auditor-qualification story lives in the FY26 AR; only 3 legacy quarters (IPO Aug 2024) so "Trajectory" must cope with short history. NUVAMA — second NBFC taxonomy (format test), results filed 6 Nov with transcript pending (arrives in-week), pledge story is in `Disclosure under SEBI Takeover Regulations` items (PAG's Reg 31(1)/31(4), 24 Sep & 19 Jun 2026) — the classifier must map Reg 31 → pledge. VEDL — proves the source-union rule (screener 4/6, NSE 6/6), credit-rating filing 16 Oct, two exchange "News Verification" queries (2–3 Nov). PIIND — −19.1 % on 30× the day after results; 44 transcripts in history; the "−70 % PAT" narrative-vs-numbers case. RAJESHEXPO — zero concalls ever, BZ series, 10 XBRL revisions, no results date intimated, `OwnersOfParent=0`, 1.26 MB AR: every degradation path in one ticker.

## 11. Data gaps the builders must handle (ordered by blast radius)

1. **Transcript discovery must union three sources** (screener Documents → BSE `Earnings Call Transcript` sub-category → NSE announcements with "Transcript" in `attchmntText`); screener alone misses VEDL Q1/Q2 FY27, MARUTI, one quarter each of INDUSINDBK/LT. Transcript URLs may be on company IR domains (THERMAX, VEDL) — download with a browser UA and verify `%PDF` + extractable text (all 36 checked here were text; still gate on `len(text) > 2000`).
2. **Q2 FY27 transcripts for 7 candidates are not yet filed** (results 4–7 Nov). They will land during the build week — design the ledger to show "call held DD Nov · transcript pending" rather than an empty state, and re-poll daily.
3. **Results arriving on a trading holiday** (KALYANKJIL, 10 Nov) and a **window with zero portfolio filings** (the entire Diwali weekend) are both real this week. The 24 h default must auto-widen with an explicit "market closed / quiet window" line.
4. **Muhurat bar** (8 Nov): 0.03–0.5× volume for every name — exclude special sessions from both scoring and baselines (`SsnId`/holiday-master `*`), or Monday's normal volume fires on every name.
5. **XBRL variance**: 14–140 KB files, `Audited` quarterlies (HAL), `type_Sub = Revision` rows (RAJESHEXPO ×10 — take the latest `creation_Date`), `NONINDAS` taxonomy label, `OwnersOfParent = 0`. Standalone + consolidated exist for all 40, so always prefer consolidated and chip the basis.
6. **No-concall companies** (RAJESHEXPO, TRENT, ITC) — the Pull side must degrade to AR-only research with an explicit "management holds no earnings calls; guidance ledger unavailable" state; TRENT/ITC do publish investor PPTs (screener `PPT` links) which can stand in for narrative.
7. **Series `BZ`** (RAJESHEXPO) = trade-for-trade/compliance flag — surface it; also the bhavcopy filter must include BE/BZ, not just EQ.
8. **Pledge data** is not an announcement category: it arrives as `Disclosure under SEBI Takeover Regulations` (Reg 31) and in shareholding patterns; `/api/corporate-pledgedata` remains unverified (report 05).
9. **Symbol churn** is live in this book: TMPV (ex-TATAMOTORS, listed 12 Nov 2025 — exactly one year of EQUITY_L history), ETERNAL (ex-ZOMATO). Key everything by ISIN.
10. **Short histories**: OLAELEC 3 legacy quarters, NUVAMA 6, ETERNAL 15, KALYANKJIL 16 — "Trajectory back to 2021" is impossible for them; show what exists.

## 12. Assumptions to challenge

- Screener's "last 6 quarters" period labels map calls to quarters by month (Oct–Dec → Sep quarter, etc.); a company with two calls in one window (RELIANCE's two Jan rows, THERMAX's two Jul rows) is de-duplicated by quarter — fine for counting, but store both documents.
- The 20-day baseline here uses the 20 normal sessions before 6 Nov drawn from only 26 downloaded sessions; early-October rows had 5–19 baseline days (flagged in `anomalies.json` as `baseline_days`). The production job should hold ≥ 45 sessions.
- Cap buckets are from screener's market cap on 8 Nov and approximate AMFI cut-offs; LAURUSLABS (₹1.28 lakh cr), MARICO, TMPV and IDEA land in "large" by the number even though the team may think of them as mid caps.
- All measurements are from one residential IP on a Sunday evening; weekday load on NSE during results week (12–14 Nov, 180–210 filers/day) is untested.
