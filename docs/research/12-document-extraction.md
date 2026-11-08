# 12 — Financial document extraction (results PDFs, concall transcripts, annual reports)

Author: document-extraction specialist. Date: Sun 8 Nov 2026 (all measurements made today on the build machine).
Scratch dir: `/tmp/finn-extract/` (venv `uv venv --python 3.12`, pymupdf 2.1 / MuPDF 1.28.6, pdfplumber 0.11.10, poppler pdftotext 26.08, google-genai, tiktoken, lxml). Large PDFs deleted after the study; scripts, JSON outputs, XBRL files, transcripts and one results PDF kept there.

## 0. TL;DR

1. **Every quarterly-results PDF on BSE that I sampled (5/5) is a scanned, signed copy with an OCR text layer** — one full-page JPEG/PNG per page (~1654×2339 px) plus hidden OCR text. OCR quality ranges from good (Reliance, Supreme) to poor (Federal Bank: `7,86i158`, `Lt74,tOO`, `2,64,542` for a printed `2,64,502`). Any text-based extraction (regex **or** LLM-on-PDF) inherits those errors; **Gemini reading the PDF trusted the bad OCR layer too**. Rendering the page to an image and sending the image fixed it (verified against the page image).
2. **NSE publishes the results as XBRL (SEBI "Integrated Filing – Financials") — structured, exact, free, 70–100 KB, 0.1–0.2 s to download.** `GET https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=RELIANCE&period=Quarterly` (after a cookie handshake on the NSE homepage) returns the filing list with `xbrl` links. All raw P&L line items matched the PDF exactly for all 5 companies, and H1 filings also carry the balance sheet and cash-flow statement. Limitation: each XBRL holds only the current quarter + YTD, so QoQ/YoY need the two earlier filings (also in the same list — tested, exact match to the PDF comparatives). Caveat: it arrives ~2 h after the PDF (Reliance: PDF on BSE 19:42, XBRL on NSE 21:32), and some filers' numbers are quirky (HDFC Bank entered PBT net of minority interest).
3. **Deterministic extraction (pymupdf words → regex rows → arithmetic checks) was exact on 4/5 results PDFs in ~0.1 s and $0**, and — importantly — **its self-checks flagged the one failure** (Federal Bank) instead of returning wrong numbers. All remaining "mismatches" versus screener.in are screener's own conventions (netting excise from Sales, folding associate profits into Other Income, treating a JV loss as an operating expense).
4. **Gemini 3.5 Flash-Lite with a strict JSON schema** got the current-quarter headline numbers (revenue/interest earned, PBT, PAT, PPOP) right in every run and every cell right on the four clean filings (full PDF: 7.7–16.8k input tokens, 7–9 s, ≈$0.005–0.008/filing at paid rates; single page: 845 input tokens, 5–6 s, ≈$0.004); its only errors were digits copied from Federal Bank's bad OCR layer, which disappear with image input. Output tokens (~1.2–1.5k) dominate cost; a slimmer schema would halve it. 2 of 14 calls hit a `503 UNAVAILABLE` — retries + model fallback are mandatory.
5. **Transcripts parse deterministically into speaker turns** (vendor layout `Name:   text` and Reliance's own layout; 34–111 turns per call, roles from the cover-page roster, opening remarks vs Q&A split). Guidance extraction by Flash-Lite over management turns only: **9/9 quotes verified verbatim** by substring match against the parsed turn (Supreme ₹13,500–14,000 cr FY27 revenue, 14–14.5% OPM, ~10% volume growth, ₹700–750 cr capex; KPIT "H2 better than H1"; HDFC Bank LCR 110–120). ≈$0.003 per transcript.
6. **Annual reports are 176k–499k tokens** (KPIT 303k, Supreme 176k, Reliance 314k, HDFC Bank 499k). Three of five are 2-page spreads (1191×842 pt) whose default text order interleaves the two printed pages — split the page at the midline before extraction. A code-built page map (headings + running headers, 10–25k tokens) labelled by Flash-Lite sectioned the KPIT AR perfectly (12 sections) but drifted on the 678-page HDFC AR; regex anchors (balance sheet / auditor's report) must validate the LLM ranges. Only targeted sections should go to a model; cache everything by document hash.

## 1. Documents obtained

Source of links: screener.in company page, `Documents` section (`div.annual-reports`, `div.concalls`) and the quarterly table's `Raw PDF` row (`/company/source/quarter/<screener_id>/<month>/<year>/` → 302 → `https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=<uuid>.pdf` → 200 `https://www.bseindia.com/xml-data/corpfiling/AttachHis/<uuid>.pdf`). Headers needed: a desktop `User-Agent` only (screener.in and bseindia.com both served a plain `requests` call; no cookies). Annual reports link to `https://www.bseindia.com/xml-data/corpfiling/AttachHis/<uuid>.pdf` (new filings) or `https://www.bseindia.com/bseplus/AnnualReport/<scrip>/<id>.pdf` (older ones).

| Company (cap) | Document | Final URL (BSE) | MB | Pages | chars/page | Text layer | Producer |
|---|---|---|---|---|---|---|---|
| RELIANCE (large) | Results Q2 FY27 (filed 30 Oct 2026) | …/AttachHis/880087f6-7ecc-40a9-8cac-de48d4616b25.pdf | 8.8 | 31 | 2,399 | **scan + OCR** (1 JPEG/page, 1654×2339) | Adobe PDF Library |
| RELIANCE | Transcript (analyst meet 30 Oct 2026, filed 1 Nov) | …/AttachHis/8e997741-4d35-4188-933a-cf020fb9c816.pdf | 0.6 | 29 | 3,310 | native text | Adobe PDF Library |
| RELIANCE | Annual Report FY26 | …/AttachHis/cc08294f-ec68-4f15-aaa4-c14a3c4bdfb2.pdf | 11.0 | 187 (2-up spreads = ~374 printed) | 6,088 | native | PDFium |
| KPITTECH (mid) | Results Q2 FY27 (28 Oct 2026) | …/AttachHis/c0d52f59-f997-494d-918e-7e0d4d3eda65.pdf | 4.8 | 26 | 2,289 | **scan + OCR** (`HiddenHorzOCR` font) | Acrobat Paper Capture |
| KPITTECH | Transcript (call 28 Oct, filed 3 Nov) | …/AttachHis/a7331811-fe14-4c79-896d-f0a9df901335.pdf | 0.5 | 21 | 2,342 | native | PDFsharp |
| KPITTECH | Annual Report FY26 | …/AttachHis/4d2467e3-e28a-472b-8492-7fd9e46e63c4.pdf | 10.3 | 210 (spreads) | 5,727 | native | Word |
| SUPREMEIND (mid) | Results Q2 FY27 (26 Oct 2026) | …/AttachHis/d0288072-8a02-4ddf-a06d-e3994909b6ef.pdf | 6.7 | 13 | 2,709 | **scan + OCR** (2480×3507) | Acrobat Paper Capture |
| SUPREMEIND | Transcript (26 Oct, filed 31 Oct) | …/AttachHis/ceb674b9-cd2e-4ef8-bf77-bece0e59fe0f.pdf | 0.6 | 12 | 2,455 | native | Acrobat |
| SUPREMEIND | Annual Report FY26 | …/AttachHis/2fff9f50-86c5-4045-b4d8-afc16b252bbc.pdf | 7.3 | 209 (portrait) | 3,463 | native (18 image-only pages) | Acrobat |
| HDFCBANK (bank) | Results Q2 FY27 (17 Oct 2026) | …/AttachHis/f5d5fb37-aa66-401c-85d6-58ccd3982828.pdf | 1.2 | 24 | 3,357 | **scan + OCR** (`O` for `0` throughout) | Word 2019 |
| HDFCBANK | Transcript (17 Oct, filed 23 Oct) | …/AttachHis/d7e45614-ae12-4bb9-b92d-623b3a63f166.pdf | 0.5 | 17 | 3,213 | native | Word 2019 |
| HDFCBANK | Annual Report FY26 | …/AttachHis/7d621500-082a-4342-b98d-ba677d3890c5.pdf | 12.7 | 678 (portrait) | 2,994 | native | Word 2019 |
| FEDERALBNK (bank, extra) | Results Q2 FY27 (16 Oct 2026) | …/AttachHis/3b85f447-8a28-4d54-803a-3a63a796dc26.pdf | 6.2 | 14 | 3,353 | **scan + poor OCR** | Word |
| FEDERALBNK | Transcript | `https://www.federal.bank.in/documents/...Earnings+Call+Transcript_Q2FY27.pdf` | — | — | — | **FAILED**: screener linked the company IR site, which redirected to a Radware bot-manager page (`validate.perfdrive.com`, HTTP 200, `text/html`) | — |
| FEDERALBNK | Annual Report FY26 | …/AttachHis/ad830431-1737-419d-84ec-a40aa969637e.pdf | 19.9 | 266 (spreads) | 5,899 | native | Word |

All 14 BSE downloads succeeded at 0.2–1.1 s each. Lesson: always validate `Content-Type: application/pdf` and the `%PDF` magic bytes; screener's transcript links sometimes point to company IR sites that block bots — fall back to the BSE "Earnings Call Transcript" announcement (category `Announcement under Regulation 30 (LODR)-Earnings Call Transcript`, visible in screener's announcements list and in the BSE API below).

"Scanned vs text" detection that worked: every page has exactly one image covering the page **and** fonts named `HiddenHorzOCR` / render-mode-invisible text, or `chars/page` is normal but the text contains OCR signatures (`Seo'26`, `{8,421)`, `3O.O9.2O26`). Per-page `len(page.get_text()) < 50` catches only true image-only pages (0 in the results PDFs; 18 in the Supreme AR, which are photo pages).

## 2. Results PDF → Revenue / EBITDA / PBT / PAT

### 2.1 Layout facts (SEBI LODR Reg. 33 format)

- Rows = line items; columns = `Quarter ended [current | previous | same quarter last year] | Half-year / Nine-months ended [current | last year] | Year ended [previous FY, Audited]`. All five filings used exactly this order; Q1 filings drop the YTD columns.
- Units seen: `(₹ in crore, except per share…)` (Reliance; OCR'd as `{t in crore`), `₹ in million` (KPIT; OCR `~ in million`), `Rs in Crores` (Supreme), `in crore` (HDFC), `(₹ in Lakhs)` (Federal; OCR `({ in Lakhs)`). Lakh grouping `8,38,284` appears in Federal.
- Negatives in parentheses `(17,539)`; OCR turns `(` into `{` or `[` (`{8,421)`, `{20)`).
- Footnote markers inside labels: `Other income (Refer note 5, 6 and 7)` — the trailing `7)` looks like a negative number to a naïve tokenizer (this produced a wrong `-7.0` in my first pass; fixed by rejecting `N)` without an opening bracket).
- Consolidated and standalone statements are both in one PDF (Reliance p10 vs p22, KPIT p9 vs p22, Supreme p5 vs p11, HDFC p9 vs p2, Federal p11 vs p4), each followed by segment tables, balance sheet (H1/FY) and cash flow (H1/FY), plus auditor's limited-review reports and (HDFC) a 6-page press release that repeats numbers in different groupings.
- Line-item naming varies: `Value of Sales & Services (Revenue)` then `Less: GST Recovered` then `Revenue from Operations` (Reliance); `Profit before share of profit/(loss) of joint venture and associate, exceptional items and tax` → `Share of profit/(loss)…` → `Profit before exceptional items and tax` → `Exceptional items` → `Profit before tax` (KPIT); `PROFIT BEFORE SHARE OF PROFIT OF AN ASSOCIATE [1-2]` (Supreme). Banks use the RBI format: `Interest earned`, `Other Income`, `Interest expended`, `Operating expenses`, `Operating profit before provisions and contingencies`, `Provisions (other than tax)`, `Profit from ordinary activities before tax`, `Net profit … before minority interest`, `Minority Interest`, `Consolidated Net Profit of the group`.

### 2.2 Approach (a): deterministic (pymupdf words → lines → regex rows → checks)

Core of `det_extract.py` (ran as shown; ~250 lines total):

```python
def page_lines(page, ytol=3.0):            # cluster positioned words into visual lines (works on OCR layers)
    words = page.get_text("words"); words.sort(key=lambda w: (round(w[1]/ytol), w[0]))
    lines, cur, cury = [], [], None
    for w in words:
        yc = (w[1]+w[3])/2
        if cury is None or abs(yc-cury) <= ytol: cur.append(w); cury = yc if cury is None else (cury+yc)/2
        else: lines.append(cur); cur=[w]; cury=yc
    if cur: lines.append(cur)
    return [sorted(l, key=lambda w: w[0]) for l in lines]

def norm_num(tok):                           # OCR-tolerant number parser
    t = tok.strip()
    if t in {"-", "–", "—", "Nil", "NIL", "nil", "--"}: return 0.0
    if t.endswith((")", "}", "]")) and not t.startswith(("(", "{", "[")): return None   # "7)" is a label marker
    neg = t.startswith(("(", "{", "[")) or t.startswith("-")
    t = re.sub(r"[\(\)\{\}\[\]\*#@'\s-]", "", t).replace("O","0").replace("o","0").replace("I","1").replace("l","1")
    if not re.fullmatch(r"[0-9][0-9,\.]*", t): return None
    if t.count(".") > 1: head,_,tail = t.rpartition("."); t = head.replace(".","")+"."+tail   # "11.102.55"
    v = float(t.replace(",", "")); return -v if neg else v

ROWS_CORP = {  # label regexes; optional "(a)"/"1."/"2" prefixes
  "revenue": r"^(?:\(?[a-z0-9]{1,3}\)?\.?\s*)?(revenue from operations?|sales\s*/\s*income from operations|income from operations|net sales)",
  "other_income": r"...other income", "total_income": r"...total income", "finance_costs": r"...finance costs?",
  "depreciation": r"...depreciation", "total_expenses": r"...total expenses",
  "pbt_pre_exceptional": r"...profit\s*/?\(?l?o?s?s?\)?\s*before (share of|exceptional)",
  "pbt": r"...profit\s*/?\(?l?o?s?s?\)?\s*before tax\b",
  "pat": r"...(profit\s*/?\(?l?o?s?s?\)?\s*(after tax|for the (period|quarter|year))|net profit ...)",
  "pat_total": r"...profit after tax and share of" }
ROWS_BANK = { "interest_earned": r"^(?:[0-9O]{1,2}\.?\s*)?interest earned", "interest_expended": ..., "operating_expenses": ...,
  "ppop": r"...operating profit", "provisions": r"...provisions \(other than tax\)",
  "pbt": r"...profit\s*/?\(?l?o?s?s?\)?\s*from ordinary activities before tax", "pat": r"...net profit ...(from ordinary activities after tax|for the period)",
  "pat_group": r"...(consolidated net profit|net profit.*attributable to)" }

# page selection: score pages (title "financial results" + "revenue from operations|interest earned" + "profit before tax",
# minus "segment|balance sheet|cash flow|review report" in the first 300 chars); classify consolidated/standalone/bank.
# EBITDA = Revenue − (Total expenses − Finance costs − Depreciation)   # operating EBITDA, excl. other income, associates, exceptionals
# checks: rev+oi == total_income; total_income − total_expenses == pbt_pre_exceptional (or pbt); Qcur+Qprev == H1 (Q2 filings)
```

Measured results versus screener.in's quarterly table (Sep 2026 / Jun 2026 / Sep 2025 columns, tolerance ±0.6 % or ±1 cr because screener rounds to crore):

| Company | Page picked | Unit | Time | Cells matching screener | Non-matching cells and why | Self-checks |
|---|---|---|---|---|---|---|
| RELIANCE | p10 consolidated | crore | 0.18 s | 18/21 | Revenue ×3: PDF `Revenue from Operations` 332,861 vs screener `Sales` 330,601 — screener nets **excise duty** (2,260). Everything else exact (PBT 38,613; PAT 29,550; EBITDA 56,616 = screener Operating Profit) | 4/4 pass |
| KPITTECH | p9 consolidated | million (→×0.1) | 0.14 s | 18/21 | EBITDA ×3: ours 282.84 vs screener 267 — screener treats the **JV loss** (−15.6 cr) as an operating expense; raw items (rev 1,690.97; PBT 168.04; PAT 120.66) exact | 4/4 pass |
| SUPREMEIND | p5 consolidated | crore | 0.07 s | 18/21 | Other income ×3: PDF 8.69 vs screener 38 — screener **folds share of associate profit** (29.60) into Other Income; EBITDA 431.01 = screener 431; PBT 343.91; PAT 262.44 exact | 4/4 pass |
| HDFCBANK | p9 consolidated (bank) | crore | 0.07 s | 9/9 | — (interest earned 95,131.63; PBT 28,662.54; PAT 21,537.09; PPOP 32,871.54; NII 44,464.20 computed) | 3/3 pass |
| FEDERALBNK | p11 consolidated (bank) | lakh (→×0.01) | 0.06 s | **0/9** | OCR garbage inside the text layer (`7,86i158`, `r,s2,o57`, `Lt74,tOO`, `+56t924`): rows missing/misaligned | **0 checks computable → extractor reports failure** |

So on filings with a usable OCR layer the deterministic path is exact on every raw line item (**every** "miss" is a definitional convention of screener), and the validation gate correctly rejected the one bad file rather than emitting wrong numbers. Standalone selection also works (`prefer="standalone"` → Reliance p22: revenue 174,668, PBT 20,339, PAT 15,354; HDFC p2: PBT 25,909.80, PAT 19,609.96).

pdfplumber's `extract_table()` is useless here: the pages are images, so there are no ruling lines; its text-based strategy produces the same OCR tokens with worse speed (see §5 for speed numbers). pymupdf `words` is the right primitive.

### 2.3 Approach (b): Gemini Flash-Lite on the PDF with a strict JSON schema

`llm_extract.py` sends the PDF bytes (`types.Part.from_bytes(mime_type="application/pdf")`) or a page subset, `response_mime_type="application/json"`, `response_schema` with `statement_type`, `is_bank`, `unit`, `page_number`, `columns[]{header_text, period_end, period_type, audited}`, `rows[]{item ∈ 17-value enum, label_in_document, values[]}`; temperature 0. Code then maps columns by `period_end`, converts units and computes EBITDA/NII/QoQ/YoY. Model `gemini-3.5-flash-lite` (paid price per ai.google.dev/gemini-api/docs/pricing fetched today: $0.30/M input, $2.50/M output incl. thinking; free tier: free; `gemini-3.8-flash` $0.75/$3.75 through Dec 2026).

| Run | Input sent | Latency | Tokens in/out | Cost @paid | Current-quarter headline vs PDF | Notes |
|---|---|---|---|---|---|---|
| FEDERALBNK full PDF (14 p) | PDF with OCR layer | 7.4 s | 7,749 / 1,242 | $0.0054 | Int. earned 8,382.84 cr, PBT 2,122.00, PPOP 2,475.00 all correct | ≥4 cells wrong, all copied from the OCR layer: interest earned Q_yoy `721,614` (printed 7,21,618), interest expended Q_prev `453,754` (4,53,758), opex `264,542` (2,64,502) and `231,729` (2,31,129) |
| KPITTECH full PDF (26 p) | PDF | 7.2 s | 14,085 / 1,553 | $0.0081 | All 11 rows × 6 columns exact | Correctly reported unit `million` and the pre-/post-JV PBT rows |
| RELIANCE full PDF (31 p) | PDF | 9.1 s | 16,805 / 1,218 | $0.0081 | All rows exact; picked p10 consolidated | 31 pages ≈ 260 tokens/page for the images + text |
| FEDERALBNK page 11 only | 1-page PDF | 4.8 s | 845 / 1,335 | $0.0036 | Current quarter: opex `264,542` wrong (printed 2,64,502); other current-quarter cells exact | Comparatives: `721,674` (printed 7,21,618), `231,729` (2,31,129), interest expended H1 `932,091` (9,32,097); `453,758` right this time |
| **FEDERALBNK page 11 as PNG (150 dpi)** | image, no text layer | 8.9 s | 1,405 / 1,452 | $0.0040 | **Every cell checked against the page image correct** (7,21,618; 2,64,502; 2,31,129; 9,32,097) | Proof: image-only beats PDF-with-bad-OCR |
| HDFCBANK page 9 | 1-page PDF | 6.2 s | 845 / 1,336 | $0.0036 | exact | returned `Net profit (14)-(15)` 20,700.03 = after minority interest (definition, see §2.5) |
| SUPREMEIND page 5 | 1-page PDF | 6.6 s | 845 / 1,495 | $0.0040 | exact (11 rows × 6 cols) | — |
| FEDERALBNK p11 PNG with `gemini-3.8-flash` | image | — | — | — | **failed: `503 UNAVAILABLE` "high demand"** | one of two 503s today (the other on flash-lite during transcript work) |

Observations: (i) Gemini's PDF ingestion evidently uses the embedded text layer — on Federal Bank it reproduced the OCR layer's wrong digits in 2 runs out of 2, while the image-only run was right; (ii) output tokens (~1.3k) cost more than input for single pages — a card-only schema (3 quarter columns, 8 rows, no header strings) would cut cost ~60 %; (iii) a 31-page PDF costs only ~17k input tokens, so "send the whole filing" is affordable but slower and exposes the model to press-release pages with regrouped numbers.

### 2.4 Approach (c): hybrid — code locates the page, model reads it; code validates

This is what the single-page rows above are: `det_extract.classify_page()` picked the consolidated P&L page in all 5 files in <0.2 s; the model saw only that page. Combined with the identity checks (`rev+oi==total_income`, `H1==Q1+Q2`), the hybrid gives the best accuracy/cost trade-off: 845–1,405 input tokens, and **send the page as an image whenever the OCR layer is suspicious**. Measured probe (share of digit-bearing tokens on the P&L page that still fail `norm_num` after `O→0`/`l→1` normalisation): Reliance 1.6 %, KPIT 1.9 %, Supreme 1.2 %, HDFC 1.1 % vs **Federal Bank 24.5 %** — a threshold of ~5 % cleanly separates "trust the text layer" from "render to PNG". (The raw share of non-clean numeric tokens before normalisation is not a usable signal: HDFC scores 42 % purely from `O`-for-`0` yet extracts perfectly.)

### 2.5 Definitions the card must pin down (these caused every "mismatch")

- **EBITDA** = Revenue from operations − (Total expenses − Finance costs − Depreciation & amortisation). Excludes other income, share of associates/JV, exceptional items. This reproduces screener's "Operating Profit" for Reliance (56,616) and Supreme (431); for KPIT screener's 267 vs our 283 differs only by its treatment of the JV loss. Show margin on revenue; label it "operating EBITDA".
- **PBT**: print the filing's own `Profit before tax` row (Supreme 343.91 after associate share; KPIT 168.04 after JV loss). The XBRL `ProfitBeforeTax` is *before* associates (Supreme 314.31, KPIT 183.60) — 9 % different. Pick one and footnote it; I recommend "as reported in the filing", with the XBRL value used only for cross-check (±share of associates).
- **PAT**: `Profit for the period` before allocation to non-controlling interest and including share of associates (Ind AS presentation; screener uses this: Reliance 29,550; Federal 1,564.06+4.15 = 1,568). Banks' RBI format shows `Net profit before minority interest` and `Consolidated net profit of the group` (after minority) — HDFC 21,537.09 vs 20,700.03. Show both as `PAT` and `PAT (owners)` when they differ by >1 %.
- **Revenue for Reliance-type filers**: use `Revenue from Operations` (net of GST), not `Value of Sales & Services`; note screener additionally nets excise.
- **Banks/NBFC fallback** (implemented in `headline()`): Revenue → `Interest earned` (plus `Total income`), EBITDA → **NII** = Interest earned − Interest expended, and **PPOP** (`Operating profit before provisions and contingencies`), PBT → `Profit from ordinary activities before tax`, PAT as above. Detector: `interest earned` and `interest expended` both present on the page. The NSE list also flags `bank: "B"` and the XBRL file name starts with `INTEGRATED_FILING_BANKING_`.

### 2.6 Failure cases collected

1. Poor OCR layer (Federal Bank): deterministic 0/9; LLM-on-PDF copies OCR digit errors into comparative columns; image input fixes it.
2. Label footnote markers parsed as negative numbers (`Refer note 7)` → −7) — fixed with bracket-matching rule; the `rev+oi==total_income` check caught it before the fix.
3. `O`/`0` and `l`/`1` substitutions (HDFC `1O Profit from ordinary activities…`, `2O7OO.O3`) — handled by character normalisation restricted to numeric tokens and row-number prefixes.
4. Header dates split across lines (KPIT: `30 September | 30 June 2026 | …` on one line, years on the next) — date parsing produced nonsense (2030/2031); fall back to the SEBI default column order when parsed years are implausible. The LLM got these columns right.
5. Two "revenue" rows (gross vs net of GST) — priority list, net wins.
6. Gemini `503 UNAVAILABLE` twice in 14 calls (flash-lite and 3.8-flash) — need exponential backoff and a model ladder (`gemini-3.5-flash-lite` → `gemini-2.5-flash-lite` → `gemini-3.5-flash`).

## 3. Alternative structured sources for the results card

### 3.1 screener.in quarterly table (HTML, `section#quarters table`)

- Shape: rows `Sales +, Expenses +, Operating Profit, OPM %, Other Income +, Interest, Depreciation, Profit before tax, Tax %, Net Profit +, EPS in Rs, Raw PDF`; banks: `Revenue +, Interest, Expenses +, Financing Profit, Financing Margin %, Other Income +, Depreciation, Profit before tax, Tax %, Net Profit +, EPS, Gross NPA %, Net NPA %`. 13 quarters. `/consolidated/` URL serves consolidated when it exists (the page says "View Standalone" otherwise).
- Conventions (verified above): Sales nets excise; Other Income includes positive associate share; a JV loss is an expense; Operating Profit excludes other income; bank "Expenses" = operating expenses + provisions (HDFC 45,820 + 4,209 = 50,029 ✓), so "Financing Profit" is after provisions, not PPOP; Net Profit is before minority interest.
- **Freshness, measured today 17:35 IST**: of 12 companies that filed Integrated Filing–Financials on NSE on 7 Nov (Saturday, 12:50–20:37) or 8 Nov, screener's table already had the Sep 2026 column for 7 (e.g. FINCABLES filed 20:29 on 7 Nov → present <21 h later), MAWANASUG (filed 12:50 on 7 Nov) still showed Jun 2026 as latest (>28 h), and 4 small caps showed no quarterly table in the parsed page. Reliance/KPIT/Supreme/HDFC/Federal (filed 16–30 Oct) all present. **Conclusion: screener is a good cross-check and a 1–2-day-late fallback, not the primary source for a same-evening results push.** It is also a third-party scrape with no API (ToS risk) — document that choice.
- The `Raw PDF` redirect is the simplest, reliable way to get the BSE results PDF for any past quarter (used for all downloads above).

### 3.2 NSE — Integrated Filing (Financials) JSON + XBRL  ← recommended primary

Session: `GET https://www.nseindia.com/` with browser-like headers (`User-Agent`, `Accept`, `Accept-Language`, `Referer: https://www.nseindia.com/companies-listing/corporate-filings-financial-results`) sets `_abck`, `ak_bmsc`, `bm_sz` cookies (0.12 s); then all `/api/...` calls below returned 200 in 0.15–0.3 s. (A bare curl gets 403, as noted in the shared context.)

- `GET /api/integrated-filing-results?index=equities&symbol=RELIANCE&period=Quarterly` → `{"data":[…],"size":20,"page":-1,"totalCount":22}`; `&page=2` paginates. Item shape:
  ```json
  {"symbol":"RELIANCE","cmName":"Reliance Industries Limited","type":"Integrated Filing- Financials","type_Sub":"Original",
   "consolidated":"Consolidated","audited":"Un-Audited","qe_Date":"30-SEP-2026","creation_Date":"30-Oct-2026 21:32:55",
   "broadcast_Date":"30-Oct-2026 21:32:55","seq_Id":"207709","revised_Date":null,
   "xbrl":"https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1750537_30102026093254_WEB.xml","xbrlFileSize":"100.82 KB",
   "ixbrl":"https://nsearchives.nseindia.com/corporate/ixbrl/INTEGRATED_FILING_INDAS_207709_30102026213255_iXBRL_WEB.html","pdf_attach":null}
  ```
  The same list also contains `Integrated Filing- Governance` items (filter on `type`), and Standalone + Consolidated rows per quarter. Reliance's list goes back to the Mar-2025 quarter (7 consolidated quarters) — enough for the "last four quarters" research.
- `GET /api/integrated-filing-results?index=equities&period=Quarterly&from_date=07-11-2026&to_date=08-11-2026` → all companies' filings in the window (`totalCount` 62 for that weekend; 771 for 5–8 Nov). This is a ready-made **results-season feed** for the Push side.
- The legacy endpoint `/api/corporates-financial-results?index=equities&symbol=…&period=Quarterly` still answers (130 Reliance rows with `xbrl` links) **but stops at the Dec-2024 quarter for every symbol** (SEBI moved to Integrated Filing from Q3 FY25). `/api/results-comparision?symbol=…` is standalone-only and equally stale. Do not use them.
- XBRL instance (lxml, `xbrl_parse.py`, ~40 lines): contexts `OneD` (current quarter, `startDate/endDate`), `FourD` (YTD), `OneI` (quarter-end instant), `PY_I` (previous FY end); facts are in **absolute rupees** regardless of the `LevelOfRounding` text fact (`Crores`, `Millions`, `Lakhs`). Elements (namespace `in-capmkt`, SEBI taxonomy 2026-01-31): `RevenueFromOperations, OtherIncome, Income, Expenses, FinanceCosts, DepreciationDepletionAndAmortisationExpense, ProfitBeforeExceptionalItemsAndTax, ExceptionalItemsBeforeTax, ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod, ProfitBeforeTax, TaxExpense, ProfitLossForPeriod, ProfitOrLossAttributableToOwnersOfParent, ProfitOrLossAttributableToNonControllingInterests, BasicEarningsLossPerShare…`; banks (`INTEGRATED_FILING_BANKING_…`): `InterestEarned, InterestExpended, OtherIncome, Income, OperatingExpenses, ExpenditureExcludingProvisionsAndContingencies, OperatingProfitBeforeProvisionAndContingencies, ProvisionsOtherThanTaxAndContingencies, ProfitLossFromOrdinaryActivitiesBeforeTax, TaxExpense, ProfitLossForThePeriod, ProfitLossOfMinorityInterest, ShareOfProfitLossOfAssociates, ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates`. H1/FY filings also carry the balance sheet (`Assets, Equity, BorrowingsNoncurrent/Current, CashAndCashEquivalents, Inventories, TradeReceivablesCurrent, TradePayablesCurrent…`) and cash flow (`CashFlowsFromUsedInOperatingActivities, …Investing…, …Financing…, PurchaseOfPropertyPlantAndEquipment…`), plus segment facts with dimensions and text blocks (`DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock`). Text facts: `NatureOfReportStandaloneConsolidated`, `WhetherResultsAreAuditedOrUnaudited`, `ReportingQuarter`, `DateOfBoardMeetingWhenFinancialResultsWereApproved`, `DeclarationOfUnmodifiedOpinionOrStatementOnImpactOfAuditQualification`.
- Verified values (₹ cr): Reliance Q2 FY27 revenue 332,861 / OI 5,793 / FC 8,481 / D&A 15,315 / PBT 38,613 / PAT 29,550 / owners 25,548 — identical to the PDF; H1 CFO 93,055, capex 52,813, cash 181,723, borrowings 289,744 + 95,208. KPIT (rounding `Millions`): 16,909.66 mn revenue etc. identical to PDF; Supreme identical; Federal `OperatingExpenses` 2,64,502 lakh = the printed figure (confirms the OCR layer, not the print, was wrong). **QoQ/YoY assembly test**: Reliance Q1 FY27 and Q2 FY26 XBRLs (46 KB and 91 KB) gave revenue 311,850 / 258,898, PBT 30,630 / 29,124, PAT 23,196 / 22,092 — exactly the comparatives printed in the Q2 FY27 PDF.
- Quirks: (1) HDFC Bank's XBRL `ProfitLossFromOrdinaryActivitiesBeforeTax` = 27,825.48 cr vs 28,662.54 printed (filer deducted minority interest 837.06 above PBT; `ProfitLossOfMinorityInterest` tagged 0) — PAT 20,700.03 is the after-minority figure. (2) `ProfitBeforeTax` is always pre-associates in the taxonomy (differs from printed PBT for KPIT/Supreme, see §2.5). (3) Ratio items look scaled ×0.01 (`DebtEquityRatio` 0.0041 for a published 0.41). (4) Comparatives are not in the file; restated comparatives in later filings may differ slightly from the earlier filing's own numbers. (5) Timing: XBRL came 110 min after the BSE PDF for Reliance.

### 3.3 BSE

`GET https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=Result&strPrevDate=20261025&strScrip=500325&strSearch=P&strToDate=20261108&strType=C&subcategory=-1` (headers: UA, `Referer: https://www.bseindia.com/`, `Origin`) → `{"Table":[{"NEWSSUB":"Unaudited Financial Results (Consolidated And Standalone) For The Quarter And Half Year Ended September 30, 2026.","DT_TM":"2026-10-30T19:42:49.917","ATTACHMENTNAME":"880087f6-7ecc-40a9-8cac-de48d4616b25.pdf","CATEGORYNAME":"Result","SCRIP_CD":500325,…}],"Table1":[…]}` in 0.12 s; PDF = `https://www.bseindia.com/xml-data/corpfiling/AttachHis/<ATTACHMENTNAME>`. (`AnnGetData` returned "No Record Found!"; I did not find a BSE JSON endpoint for results XBRL — BSE's results XBRL exists on the website (`Comp_Resultsnew.aspx`) but was not tested.)

### 3.4 Recommendation for the results card ("never wrong, never empty")

1. **Trigger** from the announcements feed (BSE `Result` category or NSE announcements) → fetch the PDF (BSE). Run the deterministic extractor (<0.2 s). If all required rows are present **and** all identity checks pass → publish the card immediately with badge `PDF ✓ (self-checked)`.
2. Else → render the selected page to PNG (150 dpi) → Flash-Lite with the strict schema → re-run the same checks in code → publish with badge `AI-read ✓ (checked)`; if checks fail → show the filing with "numbers pending" rather than numbers.
3. Within ~2–24 h, fetch the NSE XBRL (current + the two prior quarters) → recompute → if it agrees within 0.5 % per line item mark `XBRL ✓`; if it disagrees, prefer XBRL for non-banks, keep PDF for banks (HDFC quirk) and surface the discrepancy.
4. screener.in only as a cross-check after a day and for history beyond the Integrated Filing window (before Mar 2025).
5. For the 15–20 portfolio names, pre-cache the XBRL history now (3 filings × 20 names ≈ 6 MB) so the card never has to wait.

## 4. Concall transcript → structure → guidance

### 4.1 Layouts and parser

Two layouts in the sample: (A) vendor layout used by KPIT, Supreme, HDFC Bank (and most Indian calls): cover page with `MANAGEMENT: MR. X – ROLE – COMPANY` and `MODERATOR: MR. Y – HOST BROKER`, then `Speaker Name:   text` with a hanging indent, running headers (company, date) and `Page n of m`; (B) Reliance's in-house "Media & Analyst Meet Transcript": participant bullets, presentation sections headed `Sh V Srikanth 00:00:01 – 00:09:00 (Group Performance)`, Q&A as `Questioner (Name – Firm)` / `Company Speaker (Sh Name)` lines.

`transcript_parse.py` (pymupdf words → baseline-clustered visual lines; a turn starts when a line at the left margin matches `^([A-Z][A-Za-z\.'\-]*(?:\s+[A-Z][A-Za-z\.'\-]*){0,4}):\s+(\S.*)$` (A) or the RIL patterns (B); roster from the cover page gives roles; the host analyst named under `MODERATOR:` gets `host_analyst`; Q&A starts at the first moderator turn matching `first question|question-and-answer session|…`; everyone unlabelled who first speaks before that is management, otherwise analyst). Skips cover-letter pages (they start before the first `Moderator:` line).

| Transcript | Layout | Pages | Turns | moderator / mgmt / analyst / host | Opening vs Q&A turns | Words (mgmt) | Parse time |
|---|---|---|---|---|---|---|---|
| KPITTECH | A | 21 | 104 | 13 / 50 / 35 / 6 | 5 / 99 | 7,865 (5,348) | 0.15 s |
| SUPREMEIND | A | 12 | 111 | 16 / 46 / 48 / 1 | 3 / 108 | 4,352 (2,563) | 0.09 s |
| HDFCBANK | A | 17 | 75 | 14 / 39 / 22 / 0 | 6 / 69 | 8,794 (6,765) | 0.16 s |
| RELIANCE | B | 29 | 41 | 0 / 26 / 15 / 0 | 8 / 33 | 15,790 (14,784) | 0.26 s |

Residual issues: speaker-name variants (`M. P. Taparia` / `M.P. Taparia` / `M. P Taparia`) are separate keys until normalised (last-name match already assigns the right role); a generic `Management:` label occurs (KPIT); analysts are often first-name-only (`Ravi`, `Karan`) — the firm has to be pulled from the preceding moderator line ("next question is from the line of Ravi from Axis Capital"), not implemented yet. First pass of the parser (pymupdf's own block/line grouping) found 1–7 turns per file because the label column and text column are separate text blocks — baseline clustering fixed it.

### 4.2 Guidance extraction (Flash-Lite, management turns only, verbatim quotes verified in code)

Prompt: management turns tagged `[turn_id | speaker | section | page]`; schema `guidance[]{metric, statement, value, period, kind ∈ {explicit_numeric, qualitative_outlook, reiterated, withdrawn_or_cut, raised}, quote (15–60 words verbatim), turn_id, speaker, section}`; code normalises quotes/turn text (lower-case, curly quotes, dashes, punctuation) and checks `quote in turn_text`.

| Transcript | Tokens in/out | Latency | Items | Quotes verified in the claimed turn | Examples |
|---|---|---|---|---|---|
| SUPREMEIND | 4,198 / 805 | 4.2 s | 5 | **5/5** | "we expect company-wide volume growth of about 10% for FY27" (t2 p3); "margin guidance for the full year at 14% to 14.5%" (t34 p7); "Outflow should not be more than INR700 crores to INR750 crores" (capex, t45 p7); "FY27, we expect our business to grow between INR13,500 crores to INR14,000 crores, operating margin between 14% to 14.5%" (t60 p8) |
| KPITTECH | 7,555 / 436 | 11.6 s (after one 503 retry) | 3 | **3/3** | "we have mentioned last time that H2 will be better than H1. I think we will maintain that" (reiterated, t31 p9); "we expect growth, and we will not be in a position to put any numbers now" (t33 p9) |
| HDFCBANK | 9,418 / 191 | 2.5 s | 1 | **1/1** | LCR "we would like to operate between 110 and 120" (t66 p16) |

Precision on quotes: 9/9 (100 %). Recall check (heuristic, Supreme only): every management sentence containing a guidance cue word and a number (4 sentences) was covered by the extracted items; the capex item had no cue word and was still found. HDFC yielded 1 item — banks rarely give numeric guidance and the prompt asks for few, high-confidence items; for the "promised vs delivered" feature the prompt should also capture qualitative outlook on loan growth / NIM / credit cost, and the extraction should run on **all four quarters' transcripts** so promises can be matched to later numbers (XBRL/PDF). Cost ≈ $0.003 per transcript at paid rates; free tier $0.

## 5. Annual report → sections

| AR | PDF pages | Geometry | Tokens (cl100k) | pymupdf full text | pdftotext full | Image-only pages |
|---|---|---|---|---|---|---|
| RELIANCE FY26 | 187 | 1191×842 pt **spreads** | 314k | 0.83 s | 1.11 s | 0 |
| KPITTECH FY26 | 210 | 1188×738 **spreads** | 303k | 1.31 s | 0.85 s | 1 |
| SUPREMEIND FY26 | 209 | portrait | 176k | 0.67 s | 0.74 s | 18 |
| HDFCBANK FY26 | 678 | portrait (594×738) | 499k | 1.64 s | 1.43 s | 7 |
| FEDERALBNK FY26 | 266 | spreads | not tokenised | 1.42 s | 1.47 s | 2 |

Library speed on 10 mid-document pages (text only): pymupdf 0.03–0.07 s, pdftotext `-layout` 0.06–0.12 s (output 2–4× more characters because of layout padding), pdfplumber 0.9–1.25 s (15–40× slower; same text). Use pymupdf; keep pdftotext `-layout` for tables you want to eyeball.

Spreads: `page.get_text()` on a spread interleaves the two printed pages (the right page's opening sentence was not even contiguous in the default output); extracting `clip=Rect(0,0,W/2,H)` and `Rect(W/2,0,W,H)` separately yields clean page 106 / page 107 text. Detect with `width > 1.4*height`.

Section location:
- Bookmarks: 0 in Reliance/KPIT/HDFC, 2 in Supreme, 51 useless numeric ones in Federal → cannot rely on them. BSE-filed ARs also start with a 1–2 page covering letter, and HDFC's begins with the 28-page AGM notice.
- Plain regex on the first 400 chars of a page found MD&A for Supreme (p18) and Reliance (p44–56) only; balance sheet anchors for Supreme (p126), Reliance (p168), HDFC (p369–388, 496–508) but missed KPIT.
- Largest-font headings + running headers work much better: KPIT MD&A p47–57, auditor's reports p100–105 (standalone) / p143–147 (consolidated), balance sheets p106 / p148, notes p110–142; running headers split the book into `Corporate Overview | Statutory Reports | Financial Statements` (KPIT), `Statutory Reports and Financial Statements` (HDFC).
- **Hybrid**: code emits one line per page (`pN: H=<largest-font headings> R=<running header>`; 10k tokens for KPIT, 24k for HDFC) and Flash-Lite returns labelled ranges. KPIT (12.0 s, 10,872/486 tokens, ≈$0.0045): all 12 ranges verified against page text (corporate_overview 1–25 → 13.9k tokens; directors_report 26–49 → 43.4k; CG report 50–59 → 17.6k; BRSR 60–90 → 38.7k; auditors_standalone 100–105 → 9.2k; standalone FS 106–109 → 4.9k; notes_standalone 110–142 → 49.6k; auditors_consolidated 143–147 → 8.1k; consolidated FS 148–152 → 7.5k; notes_consolidated 153–193 → 64.5k; AGM notice 194–210 → 31.6k). HDFC (2.8 s, 27,112/493): standalone FS 378–381 and schedules 382+ right, but `auditors_report_consolidated` (462) and `consolidated_financial_statements` (476) still pointed into standalone schedules, and `brsr_esg` (560) pointed at consolidated schedules — the model drifted on a 678-line map with weak bank headings. Fix: validate each LLM range's first page against the anchor regex for that section type (`consolidated balance sheet`, `independent auditor's report … consolidated`), and override with regex anchors when they disagree.
- In-body anchors inside the notes (regex on full page text, restricted to the financial-statements range): Related Party Transactions (KPIT p135, p187; Supreme p172–175), Contingent Liabilities (KPIT p110, 114, 153–154; Reliance p101, 127, 144, 163), Borrowings notes (KPIT p124–128, 169–175), Segment (KPIT p141, 176–177). Each is 1–7 pages ≈ 1–10k tokens.

Cost-aware strategy: never send a whole AR. Per Pull menu item send only: business snapshot → corporate overview + MD&A first ~10 pages (15–30k tokens); balance sheet / cash quality → the XBRL facts (free) + consolidated BS/CF pages and the Borrowings / Contingent Liabilities / RPT notes (10–25k); narrative-vs-numbers / guidance → management turns of the last 4 transcripts (3–15k each) + XBRL quarterly series; bull/bear → the compact `FinancialSnapshot` JSON + guidance scorecard, not raw text. With Flash-Lite at $0.30/M input, even the whole KPIT AR would be $0.09, but the free tier's per-minute token limits (not scrapable today; see risks) make 300k-token prompts impractical — chunk to ≤50k. Cache per `doc_hash`: page texts (`pages/<hash>.json`), page map, section index, and every LLM response keyed by `(doc_hash, prompt_version, model)`; Gemini context caching ($0.03/M·h) is not worth it at these sizes.

## 6. Recommended pipeline and schemas

```
Announcement feed (BSE Result / NSE) ─► fetch PDF ─► SourceDocument (hash, quality probe)
      │                                        ├─► det_extract (0.1 s) ─► checks ✓ ─► ResultsExtraction(source=pdf_deterministic)
      │                                        └─► checks ✗ ─► page→PNG ─► Flash-Lite schema ─► checks ─► ResultsExtraction(source=pdf_llm_vision) | "pending"
      └─ (T+2h..24h) NSE integrated-filing-results ─► XBRL (cur, prev Q, YoY Q) ─► ResultsExtraction(source=xbrl) ─► reconcile ─► ResultsCard(verified_by)
Transcript PDF ─► transcript_parse ─► TranscriptTurn[] ─► Flash-Lite (mgmt turns) ─► GuidanceStatement[] (quote-verified) ─► GuidanceScorecard vs later ResultsExtraction
Annual report ─► page texts (spread-split) ─► page map ─► Flash-Lite ranges + regex anchors ─► ARSectionIndex ─► targeted sections ─► FinancialSnapshot / research sections with Citation[]
```

```jsonc
// SourceDocument
{ "doc_id": "sha256:…", "symbol": "RELIANCE", "scrip_code": "500325", "isin": "INE002A01018",
  "doc_type": "results_pdf | results_xbrl | transcript | annual_report | investor_ppt",
  "url": "https://www.bseindia.com/xml-data/corpfiling/AttachHis/880087f6-….pdf", "fetched_at": "2026-11-08T17:20:40+05:30",
  "filed_at": "2026-10-30T19:42:49+05:30", "period_end": "2026-09-30", "pages": 31, "bytes": 8818015,
  "text_quality": { "chars_per_page": 2399, "ocr_layer": true, "bad_numeric_token_ratio": 0.02, "spreads": false } }

// ResultsExtraction (one per source; the card reconciles several)
{ "doc_id": "sha256:…", "symbol": "RELIANCE", "source": "xbrl | pdf_deterministic | pdf_llm_vision | screener",
  "statement": "consolidated | standalone", "is_bank": false, "unit_in_source": "crore", "values_in": "INR_crore",
  "periods": [ { "key": "Q_current", "start": "2026-07-01", "end": "2026-09-30", "type": "quarter", "audited": false },
               { "key": "Q_prev", "start": "2026-04-01", "end": "2026-06-30", "type": "quarter" },
               { "key": "Q_yoy", "start": "2025-07-01", "end": "2025-09-30", "type": "quarter" } ],
  "line_items": { "revenue_from_operations": { "Q_current": 332861, "Q_prev": 311850, "Q_yoy": 258898 },
                  "other_income": {…}, "finance_costs": {…}, "depreciation_amortisation": {…}, "total_expenses": {…},
                  "profit_before_exceptional_items_and_tax": {…}, "exceptional_items": {…}, "share_of_associates_jv": {…},
                  "profit_before_tax": {…}, "tax_expense": {…}, "profit_for_period": {…}, "profit_owners": {…},
                  // bank variant: interest_earned, interest_expended, operating_expenses, ppop, provisions, profit_before_tax, profit_for_period, profit_owners
                },
  "derived": { "ebitda": { "Q_current": 56616, "Q_prev": 47517, "Q_yoy": 45885 }, "ebitda_margin_pct": 17.0,
               "qoq_pct": { "revenue": 6.7, "ebitda": 19.1, "pbt": 26.1, "pat": 27.4 }, "yoy_pct": { "revenue": 28.6, "ebitda": 23.4, "pbt": 32.6, "pat": 33.8 } },
  "definitions": { "ebitda": "revenue − (total expenses − finance costs − D&A); excludes other income, associates, exceptionals",
                   "pbt": "as printed in filing (after share of associates)", "pat": "profit for the period before non-controlling interest" },
  "checks": { "rev_plus_oi_eq_total_income": true, "ti_minus_te_eq_pbt_pre": true, "q1_plus_q2_eq_h1": true },
  "provenance": { "page": 10, "row_labels": { "revenue_from_operations": "Revenue from Operations" }, "model": null, "prompt_version": null },
  "extracted_at": "2026-11-08T17:24:00+05:30", "latency_ms": 184 }

// ResultsCard (what Push renders)
{ "symbol": "RELIANCE", "quarter": "Q2 FY27", "statement": "consolidated", "is_bank": false,
  "metrics": [ { "name": "Revenue", "value_cr": 332861, "qoq_pct": 6.7, "yoy_pct": 28.6 },
               { "name": "EBITDA", "value_cr": 56616, "qoq_pct": 19.1, "yoy_pct": 23.4, "margin_pct": 17.0 },
               { "name": "PBT", "value_cr": 38613, "qoq_pct": 26.1, "yoy_pct": 32.6 },
               { "name": "PAT", "value_cr": 29550, "qoq_pct": 27.4, "yoy_pct": 33.8 } ],
  "verified_by": ["pdf_deterministic", "xbrl"], "confidence": "high | medium | pending",
  "footnotes": ["EBITDA excludes other income ₹5,793 cr", "PAT before non-controlling interest; owners ₹25,548 cr"],
  "links": { "pdf": "…", "xbrl": "…", "page": 10 } }

// TranscriptTurn
{ "doc_id": "sha256:…", "turn_id": 60, "page": 8, "speaker": "M. P. Taparia", "role": "management | analyst | host_analyst | moderator",
  "section": "opening_remarks | qa", "text": "…", "analyst_firm": null }

// GuidanceStatement
{ "id": "g_…", "symbol": "SUPREMEIND", "doc_id": "sha256:…", "call_date": "2026-10-26", "quarter": "Q2 FY27",
  "metric": "revenue", "value": "INR13,500 crores to INR14,000 crores", "period": "FY27",
  "kind": "explicit_numeric | qualitative_outlook | reiterated | withdrawn_or_cut | raised",
  "statement": "FY27 revenue expected at ₹13,500–14,000 cr with 14–14.5% operating margin",
  "quote": "FY27, we expect our business to grow between INR13,500 crores to INR14,000 crores, operating margin between 14% to 14.5%.",
  "speaker": "M. P. Taparia", "turn_id": 60, "page": 8, "quote_verified": true, "model": "gemini-3.5-flash-lite", "prompt_version": "g1" }

// GuidanceScorecard (promised vs delivered)
{ "guidance_id": "g_…", "promised": { "metric": "operating_margin_pct", "low": 14.0, "high": 14.5, "period": "FY27" },
  "delivered": [ { "period": "Q2 FY27", "value": 12.8, "source": "ResultsExtraction xbrl sha256:…" } ],
  "status": "on_track | met | missed | not_yet_measurable", "note": "illustrative: H1 FY27 operating EBITDA margin 13.6% (828.96/6,078.93) vs 14–14.5% full-year guide" }

// FinancialSnapshot (annual or TTM; every number carries provenance)
{ "symbol": "RELIANCE", "fy": "FY26", "basis": "consolidated",
  "fields": { "revenue": { "value_cr": 1075675, "src": { "doc_id": "…xbrl…", "ref": "RevenueFromOperations FY" } },
              "ebitda": {…}, "pat": {…}, "cfo": { "value_cr": 93055, "src": { "doc_id": "…", "ref": "CashFlowsFromUsedInOperatingActivities H1" } },
              "capex": {…}, "gross_debt": {…}, "cash_and_investments": {…}, "net_debt_to_ebitda": {…},
              "receivable_days": {…}, "inventory_days": {…}, "contingent_liabilities": { "value_cr": null, "src": { "doc_id": "…AR…", "page": 127, "quote": "…" } } } }

// ARSectionIndex
{ "doc_id": "sha256:…", "pages": 210, "spreads": true,
  "sections": [ { "name": "mdna", "page_start": 47, "page_end": 57, "tokens": 12400, "method": "llm_validated | regex | llm" }, … ],
  "anchors": { "related_party": [135, 187], "contingent_liabilities": [110, 114, 153], "borrowings": [124, 169] } }

// Citation (attached to every generated sentence on the Pull side)
{ "doc_id": "sha256:…", "page": 8, "quote": "…verbatim…", "turn_id": 60 }
```

## 7. Risks, recommendations, assumptions to challenge

Risks: (1) NSE's bot protection (Akamai) may start rejecting the cookie handshake or rotate requirements; keep the BSE-PDF path as the independent fallback and cache aggressively. (2) Free-tier Gemini: two `503`s in 14 calls today; per-model RPM/TPM limits live on `aistudio.google.com/rate-limit` (JS page — not verifiable from curl), so budget assuming ~10–15 RPM and chunk prompts ≤50k tokens. (3) XBRL filer errors (HDFC PBT) — never trust a single source for banks. (4) PBT/PAT definition drift across filings, XBRL and screener (up to 9 %) — pin definitions in `ResultsExtraction.definitions` and show footnotes. (5) Scanned PDFs: a text layer that *looks* fine can still carry single-digit errors; identity checks catch most but not an error that cancels (rare). (6) Company IR links behind bot managers (Federal Bank) — prefer BSE copies. (7) Spreads and multi-column AR layouts can scramble reading order — split spreads, and quote-verify every citation by substring match against the page text before showing it.

Prioritised recommendations: 1) Build the results card on **BSE PDF + deterministic extractor + identity checks**, with **page-image Flash-Lite** as the fallback and **NSE XBRL** reconciliation — all three pieces exist in `/tmp/finn-extract/` and ran today. 2) Pre-fetch XBRL for the portfolio's last 5 quarters (gives QoQ/YoY, BS, CF for free). 3) Ship the transcript parser + quote-verified guidance extraction over the last 4 calls per research company; the promised-vs-delivered table falls out of `GuidanceScorecard`. 4) For ARs, build the page map once per document, let Flash-Lite label it, validate with regex anchors, and only ever send sections. 5) Cache everything by document hash; log model/prompt versions.

Assumptions for others to challenge: that the 5 companies' layouts cover the portfolio (small caps may file text-only PDFs or odd formats — the extractor's checks will route them to the LLM path, but test 5 small caps); that NSE's integrated-filing API remains reachable from the deployment host (test from the server, not just this laptop); that "PAT before NCI" is the figure investors want on the card (an alternative is owners' PAT, which drives EPS); that free-tier limits allow ~20 results extractions in a results-evening burst (if not, the deterministic path alone handles clean filings at $0).

## Appendix — Gemini calls made today (14 total, 12 successful)

| # | Purpose | Model | In/out tokens | Latency | Result |
|---|---|---|---|---|---|
| 1–3 | Results, full PDF (FEDERALBNK, KPITTECH, RELIANCE) | 3.5-flash-lite | 7,749/1,242; 14,085/1,553; 16,805/1,218 | 7.4 / 7.2 / 9.1 s | OK (Federal: OCR-layer digit errors in comparatives) |
| 4–6 | Results, single page (FEDERALBNK p11, HDFCBANK p9, SUPREMEIND p5) | 3.5-flash-lite | 845/1,335; 845/1,336; 845/1,495 | 4.8 / 6.2 / 6.6 s | OK |
| 7 | Results, single page as PNG (FEDERALBNK p11) | 3.5-flash-lite | 1,405/1,452 | 8.9 s | OK — all digits correct |
| 8 | same, stronger model | 3.8-flash | — | — | **503 UNAVAILABLE** |
| 9 | Guidance (SUPREMEIND) | 3.5-flash-lite | 4,198/805 | 4.2 s | 5 items, 5/5 verified |
| 10–11 | Guidance (KPITTECH) | 3.5-flash-lite | — ; 7,555/436 | 503 then 11.6 s | 3 items, 3/3 verified |
| 12 | Guidance (HDFCBANK) | 3.5-flash-lite | 9,418/191 | 2.5 s | 1 item verified |
| 13 | AR page-map sectioning (KPITTECH) | 3.5-flash-lite | 10,872/486 | 12.0 s | 12/12 ranges correct |
| 14 | AR page-map sectioning (HDFCBANK) | 3.5-flash-lite | 27,112/493 | 2.8 s | partially wrong (consolidated ranges) |

Files kept in `/tmp/finn-extract/`: `det_extract.py`, `llm_extract.py`, `compare_screener.py`, `compare_llm.py`, `xbrl_parse.py`, `transcript_parse.py`, `guidance_extract.py`, `ar_sections.py`, `ar_pagemap_llm.py`, `fetch_screener.py`, `download_docs.py`, `profile_docs.py`; outputs `llm_out_*.json`, `guidance_*.json`, `*_transcript_turns.json`, `*_AR_pages.json`, `*_AR_sections_llm.json`, `xbrl_*.xml`, `nse_*.json`, `screener_*.json`, `profile.json`, `fed_p11_crop.png`; small PDFs `docs/*_transcript.pdf`, `docs/HDFCBANK_results.pdf`. Large PDFs (annual reports, 4 results filings; ~95 MB) were deleted.
