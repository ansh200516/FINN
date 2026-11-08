# 02 — Investment domain playbook (buy-side analyst view)

Author: investment-domain agent. Written 8 Nov 2026 (Sunday; Diwali weekend). Every "verified" fact below was checked against a primary filing or a dated news item in the last few hours; confidence tags: **[V]** verified from a primary source, **[N]** verified from news/aggregator, **[K]** domain knowledge not re-verified today, **[?]** uncertain, must be checked by the engineer.

Scratch (downloaded filings, transcripts, SEBI texts): `/tmp/finn-domain/`.

How to read this document: §1–§3 are what the *engine* must compute; §4–§5 are the *judgement* the push side encodes; §6 is the demo set; §7 is what to challenge.

---

## 0. Ten things the engineers must internalise before writing a line of code

1. **The results filing is the primary source for the push-side "headline numbers" card, and its format is regulator-prescribed** (SEBI circular CIR/CFD/FAC/62/2016 for Ind AS companies; a separate format for banks). Line-item names are near-identical across 5,000 companies — parse by label, not by position. **[V]**
2. **Three different statement formats exist**: (a) Ind AS corporate (Schedule III Div II), (b) banks (RBI/Banking Regulation format: *Interest earned … Operating profit before provisions and contingencies*), (c) NBFCs (Schedule III Div III: *Interest income, Finance costs, Impairment on financial instruments*). Insurers are a fourth (IRDAI) and should be out of scope. EBITDA is meaningless for (b) and (c). **[V]**
3. **Many results PDFs on BSE/NSE are scanned, digitally-signed images with an OCR text layer.** The Bajaj Finance Q2 FY27 filing (18 MB) extracts as `17.369.35`, `4,2so.n`, `(889)`. You must normalise and **repair using arithmetic identities** (Total income = Revenue + Other income; PBT = PBEIT + Exceptional; PAT = PBT − Tax). The same results are also filed as **XBRL** (BSE mandatory since 1 Apr 2017, within 24h of the PDF; NSE too) — use XBRL as the numeric source of truth when reachable, PDF for notes. **[V]**
4. **Never use "Total income" as Revenue** (it includes Other income). Never use "Net profit" from a press release without checking whether it is *attributable to owners* or *before minority interest*, *reported* or *adjusted*. **[V]**
5. **Exceptional items and one-off tax lines distort PAT every quarter**: Sun Pharma (−₹1,269 cr one-time, Q2 FY27), Lupin (−₹316 cr US antitrust), Hindalco (+₹284 cr), Vodafone Idea (+₹55,622 cr AGR write-back in Q4 FY26), HUL (+₹273 cr one-off *tax* gain). Always show PBT *before* exceptional items and label the exceptional separately. **[V]**
6. **Prefer consolidated; fall back to standalone; for banks the market convention is standalone.** Detect by the statement heading, by the presence of "Share of profit of associates/JV", "Non-controlling interests", "attributable to owners". **[K/V]**
7. **The transcript lags the call by up to 5 working days** (Reg 46(2)(oa) / Sch III Para A item 15, effective 13 Dec 2024). Results reported 5–6 Nov 2026 will have transcripts landing 9–13 Nov — i.e., *during the demo week*. Audio must be up within 24h. **[V]**
8. **Guidance in India is mostly ranges and adjectives** ("teens revenue growth", "mid-twenties EBITDA growth", "margins in the 20–22% band", "high single digit"). You need a vocabulary → numeric-band mapper (see §2.4) before you can score promised vs delivered.
9. **SEBI's own materiality test is quantitative** (Reg 30(4), since 15 Jul 2023): material if value/impact exceeds the **lower of 2% of turnover, 2% of net worth, 5% of 3-yr average absolute PAT** (consolidated). Use it as the backbone of the priority score — it's the regulator's definition of "earns attention". **[V]**
10. **Exchange subject lines are already a classifier**: BSE/NSE subjects like "Announcement under Regulation 30 (LODR)-Change in Directorate", "Closure of Trading Window", "Compliances-Certificate under Reg. 74 (5)", "Copy of Newspaper Publication", "Allotment of ESOP / ESPS" are deterministic. Regex first, LLM only for the residue (§4.3). **[V]**

---

## 1. Indian quarterly results format

### 1.1 Regulatory frame
- Regulation 33, SEBI (LODR) 2015: quarterly results within **45 days** of quarter-end (so Q2 FY27 deadline = **14 Nov 2026**), annual audited within **60 days** of FY-end; quarterly results carry a **Limited Review Report** (SRE 2410), annual an audit report plus "Statement on Impact of Audit Qualifications" if any. **[V]** ([SEBI LODR FAQs, Apr 2025](https://www.sebi.gov.in/sebi_data/faqfiles/apr-2025/1745399101865.pdf)).
- Format: SEBI circular **CIR/CFD/FAC/62/2016 dated 5 Jul 2016** (Ind AS). Every auditor's review report cites it ("…pursuant to Regulation 33 … read with SEBI Circular No. CIR/CFD/FAC/62/2016") — a cheap textual anchor to confirm you are looking at the results statement. **[V]**
- Board meeting for results must be intimated ≥2 working days in advance (Reg 29, as amended 2024) — the "Board Meeting Intimation" filing is your **pre-alert** that results are coming, and it closes the trading window (PIT Regs) from quarter-end until 48h after results. **[V]**
- Results PDF within 30 min of board meeting close; XBRL within 24h (BSE circular DCS/COMP/28/2016-17). **[V]**
- Since quarter ended Dec 2024, results arrive inside an **"Integrated Filing (Financial)"** bundle that also carries the Reg 32 statement of deviation, the half-yearly **related-party transactions disclosure (Reg 23(9))**, and outstanding-default disclosure — so the RPT table lands with Q2 and Q4 results. **[K]** (BSE category literally named "Integrated Filing" **[V]**.)

### 1.2 Column layout (the "6-column grid")
Verified on HDFC Bank, SBI, KVB, Bajaj Finance, Reliance, BSE Ltd and Info Edge filings **[V]**:

| Col | Q2 filing (Sep quarter) | Q1 filing | Q3 filing | Q4 filing |
|---|---|---|---|---|
| 1 | 3 months ended 30.09.2026 (Unaudited) | 30.06 (Unaudited) | 31.12 (Unaudited) | 31.03 (Audited — *balancing figure*) |
| 2 | Preceding 3 months 30.06.2026 (Unaudited) | 31.03 prev (Audited/derived) | 30.09 | 31.12 |
| 3 | Same 3 months prev year 30.09.2025 (Unaudited) | 30.06 prev | 31.12 prev | 31.03 prev |
| 4 | 6 months ended 30.09.2026 | — (often absent) | 9 months ended 31.12 | 12 months ended 31.03 (Audited) |
| 5 | 6 months ended 30.09.2025 | — | 9 months prev | 12 months prev (Audited) |
| 6 | Year ended 31.03.2026 (Audited) | Year ended 31.03 (Audited) | Year ended 31.03 | — |

Rules:
- **QoQ** = col1 vs col2. **YoY** = col1 vs col3. YTD = col4 vs col5.
- Q4 quarterly figures are "balancing figures between audited full-year and unaudited 9M" — the filing says so in a footnote; treat Q4 with a tolerance.
- Header date forms seen: `30.09.2026`, `30-09-2026`, `September 30, 2026`, `30th Sep'26`, `Sep 30, 2026`. Expect a second header row with `Unaudited/Audited`. Some companies (Reliance) label `Quarter Ended 30th Sep'26 | 30th Jun'26 | 30th Sep'25 | Half Year Ended … | Year Ended (Audited) 31st Mar'26`.
- **Units**: `(₹ in crore)`, `(Rs. in Lakhs)`, `(₹ in lakh)`, `(₹ in million)` (Dr Reddy's, Infosys IFRS releases), `(Rs. in Lacs)`. Normalise to ₹ crore (1 crore = 100 lakh = 10 million). Mis-reading lakhs as crores is the single most embarrassing demo bug possible.
- Standalone and consolidated statements are typically both present, standalone first (Bajaj Finance, HDFC Bank) or consolidated first (Reliance). Some filings have segment tables and a balance sheet (H1/FY only — Reg 33(3)(b) requires a statement of assets & liabilities and cash flow **half-yearly**). **[V]**

### 1.3 Ind AS corporate statement — canonical line items
From the SEBI format, as they actually appear in filings **[V]**:

```
1  Income
   (a) Revenue from operations
   (b) Other income
   Total income (1a+1b)
2  Expenses
   (a) Cost of materials consumed
   (b) Purchases of stock-in-trade
   (c) Changes in inventories of finished goods, work-in-progress and stock-in-trade
   (d) Employee benefits expense
   (e) Finance costs
   (f) Depreciation and amortisation expense  [or "Depreciation, depletion and amortisation"]
   (g) Other expenses
   Total expenses
3  Profit/(loss) before exceptional items and tax (1−2)   [some add "and share of profit of associates/JV"]
4  Exceptional items
5  Profit/(loss) before tax (3±4)
6  Tax expense: (a) Current tax (b) Deferred tax
7  Profit/(loss) for the period (5−6)
   [Consolidated: Share of profit/(loss) of associates and joint ventures; Profit attributable to Owners / Non-controlling interests]
8  Other comprehensive income (OCI)
9  Total comprehensive income
10 Paid-up equity share capital (face value …)
11 Other equity / Reserves (annual only)
12 Earnings per share (basic/diluted, not annualised for quarters)
```
Variants to expect: "Excise duty" as a separate expense (oil, tobacco, alcohol); "Net gain on fair value changes"; "Impairment"; "Share of profit of JV" placed *above* PBT (Info Edge) or *below* PAT (Reliance). Service companies have no materials lines.

### 1.4 Formulas — the four headline numbers

Let `REV` = Revenue from operations; `OI` = Other income; `TI` = Total income; `TE` = Total expenses; `FC` = Finance costs; `DA` = Depreciation & amortisation; `PBEIT` = Profit before exceptional items and tax; `EXC` = Exceptional items (signed: gains +, losses −); `PBT` = Profit before tax; `TAX` = Tax expense; `PAT` = Profit for the period; `NCI` = non-controlling interest.

```
Revenue        = REV                                    # never TI
PBEIT          = TI − TE  (identity check; some add share of JV)
PBT            = PBEIT + EXC   (identity check: PBT − PBEIT − EXC ≈ 0)
PAT (reported) = PBT − TAX     (identity)
PAT (owners)   = PAT − NCI     # use for EPS-consistent "PAT"; label it

EBITDA_op  (recommended default) = PBEIT + FC + DA − OI
                                 = REV − (TE − FC − DA)
EBITDA_rep (inclusive of other income) = PBEIT + FC + DA
EBITDA_adj = EBITDA_op ± one-offs explicitly disclosed in notes (rare; manual)

EBITDA margin  = EBITDA_op / REV
PBT (pre-exceptional) margin = PBEIT / REV
PAT margin     = PAT / REV
Effective tax  = TAX / PBT   (flag if < 15% or > 40% for a profitable quarter)
QoQ %          = col1/col2 − 1 ; YoY % = col1/col3 − 1 (only if col3 same sign and |col3| > 0)
```

**Convention debate and recommendation.**
- *Including other income* (EBITDA_rep) is what many Indian press releases call "EBITDA" (Reliance Q2 FY27: EBITDA 62,409 = PBT 38,613 + D&A 15,315 + Finance costs 8,481 — i.e., other income is inside) **[V]**. It is also what screener.in shows as "Operating Profit" **only after removing other income** — screener's OPM excludes other income. **[K]**
- *Excluding other income* (EBITDA_op) is the buy-side default because other income is treasury income/dividends/one-offs that say nothing about the operating business, and because it keeps margin comparable across companies with very different cash piles (Infosys' other income is ~₹1,000 cr/quarter, ~2% of revenue, yet its guided "operating margin" 20–22% is an EBIT margin that excludes it **[V]**).
- **Recommendation**: compute both; display **EBITDA_op** as "EBITDA" with the margin, and show **Other income** as its own line in the card when it is > 10% of PBT (that is itself a quality flag). Show "PBT (before exceptional)" and "PAT (reported)" with an "excl. exceptional" chip when `|EXC| > 5% of PBEIT`. For IT services, additionally show EBIT (= PBEIT + FC − OI) because that is the guided metric.

**Worked example (Hindalco, consolidated, Q2 FY27 vs Q2 FY26, ₹ cr) [V]** — Revenue 91,708 vs 66,058 (+38.8%); EBITDA 13,757 vs 9,684 (+42.1%); PBT after exceptional 10,594 vs 6,540 (+62.0%); PAT 7,533 vs 4,741 (+58.9%); exceptional +284 vs −182 → PBT pre-exceptional 10,310 vs 6,722 (+53.4%). The card should say "+62% PBT, +53% ex-exceptional".

**Worked example of OCR repair (Bajaj Finance standalone, Q2 FY27) [V]**: PAT line OCR'd as `4,2so.n` for Q2 FY26. PBT 5,703.28 − Tax 1,452.51 = **4,250.77** → accept. Finance costs OCR'd `10.463.99` for H1 FY26 → regex `(\d)\.(\d{3})\.(\d{2})` → `10,463.99`.

### 1.5 Banks — different statement, different headline numbers
Verified on HDFC Bank (17 Oct 2026), SBI (Q2 FY27 via SEC 6-K), KVB, CSB Bank **[V]**:

```
1 Interest earned (a) on advances/bills (b) on investments (c) on balances with RBI/inter-bank (d) others
2 Other income
3 Total income (1+2)
4 Interest expended
5 Operating expenses (i) employees cost (ii) other operating expenses
6 Total expenditure (4+5) excluding provisions and contingencies
7 Operating profit before provisions and contingencies (3−6)
8 Provisions (other than tax) and contingencies
9 Exceptional items
10 Profit from ordinary activities before tax (7−8−9)
11 Tax expense
12 Net profit from ordinary activities after tax
13 Extraordinary items
14 Net profit for the period
[15 Minority interest; 16 Net profit attributable (consolidated)]
17 Paid-up capital; 18 Reserves; 19 Analytical ratios: % GoI holding, Capital adequacy (Basel III), EPS, NPA ratios (Gross NPA ₹, Net NPA ₹, % GNPA, % NNPA), Return on assets (annualised); Net worth; Debt-equity; Total debts to total assets
```
Formulas:
```
NII   = Interest earned − Interest expended                 (HDFC Bank Q2FY27: 83,426.60 − 48,807.42 = 34,619.18 ✓ reported NII)
PPOP  = line 7 = NII + Other income − Operating expenses    (29,483.42 ✓)
PAT   = line 14 (standalone)
Credit cost (annualised, approx) = Provisions ×4 / Advances  (advances from the H1 balance sheet or press release)
GNPA %, NNPA %, RoA, CAR from "analytical ratios" block — parse directly
NIM is NOT in the statement; it comes from the press release/investor presentation (HDFC Bank 3.16% on total assets / 3.32% on IEA — definitions differ across banks [V])
Cost-to-income = Opex / (NII + Other income)
```
Headline card for banks: **NII, PPOP, Provisions, PAT, GNPA%/NNPA%, (NIM if available)** — not Revenue/EBITDA. For the demo, flag the Q2 FY27 sector theme: NIM compression from FCNR(B) deposit inflows (HDFC −10 bps QoQ, ICICI −18 bps, Axis −10 bps) **[N]**.

### 1.6 NBFCs (Schedule III Division III)
Verified on Bajaj Finance Q2 FY27 **[V]**: Income = *Interest income, Fees and commission income, Net gain on fair value changes, Sale of services, Income on derecognised (assigned) loans, Other operating income* → Total revenue from operations; + Other income → Total income. Expenses = *Finance costs, Fees and commission expense, Impairment on financial instruments, Employee benefits, D&A, Other expenses*.
```
NII  = Interest income − Finance costs                     (18,549.14 − 6,398.84 = 12,150.30)
PPOP = Total income − Finance costs − (all opex excl. impairment)   (= 9,551.32; PPOP − Impairment 2,130.51 = 7,420.81 = PBT ✓)
Credit cost = Impairment / average AUM (AUM from press release)
```
Detect NBFC/bank by the presence of "Interest income"/"Interest earned" as the first income line and the absence of "Revenue from operations" as a top line.

### 1.7 Insurers, exchanges, holding companies — edge cases
- Life/general insurers file an IRDAI format (premium, claims, VNB in press releases) and are exempt from XBRL **[V]**. Recommend: treat as "unsupported format — show PAT only".
- Stock exchanges (BSE Ltd) insert "Investment income" as a separate income line **[V]**.
- Holding companies / conglomerates (M&M consolidates Tech Mahindra and MMFSL; Bajaj Finserv) — consolidated headline numbers blend unrelated businesses; show standalone alongside.

### 1.8 Consolidated vs standalone — detection
- Heading contains "Consolidated" vs "Standalone" (also "Statement of … Financial Results of the Group").
- Consolidated-only rows: "Share of profit/(loss) of associates and joint ventures", "Non-controlling interests", "Profit attributable to owners of the company".
- Many small caps have *only* standalone (no subsidiaries) — do not fail; label.
- Banks: use standalone for the card (consolidated adds insurance/AMC subsidiaries; SBI consolidated "Other income" includes ₹23,640 cr of insurance premium **[V]**).
- If the filing shows both and the consolidated is a separate PDF/attachment (common on NSE: two attachments), merge by period.

### 1.9 Where to get the numbers (ranked)
1. **XBRL** (BSE "Integrated Filing"/"Financial Results" XBRL, `in-capmkt` taxonomy since 2025; NSE "Financial Results-XBRL") — structured, ~900 facts per filing **[N]** ([india-xbrl-filings on PyPI](https://pypi.org/project/india-xbrl-filings/) documents the BSE `AnnSubCategoryGetData/w?strCat=Result` endpoint and notes BSE `AttachLive` PDFs survive only ~60 days — cache everything you download).
2. **Results PDF** via `pdftotext -layout` + label regex + identity repair (§1.4).
3. **Press release / investor presentation** (same board-meeting outcome bundle) — has NIM, AUM, EBITDA as management defines it; use for *their* definitions, not yours.
4. screener.in quarterly table — convenient but it is a secondary transformation (OPM excludes other income; "Net Profit" is consolidated where available). Fine for history, not for the "first cut from the filing".

---

## 2. Concall transcripts

### 2.1 Regulatory frame (why they exist, when they land)
Schedule III Part A Para A item 15 + Reg 46(2)(o)/(oa), as amended by the LODR (Third Amendment) 2024, effective 13 Dec 2024 **[V]** ([thefootnotes.in summary](https://thefootnotes.in/articles/earnings-call-transcript-deadline-sebi-lodr); [Reg 46 text](https://ca2013.com/lodr-regulation-46/)):
- Schedule of the call → exchange ≥2 working days before (announcement subject: "Analyst / Investor Meet - Intimation" / NSE "Analysts/Institutional Investor Meet/Con. Call Updates – Schedule of meet").
- Presentation → exchange *before* the call starts ("Investor Presentation").
- Audio recording on website → earlier of next trading day or 24h ("…Link of Audio Recording").
- Transcript → website **and** exchange within **5 working days** ("Earnings Call Transcript" / "…informed the Exchange about Transcript"). Kept on the website ≥5 years.
- One-on-one meetings are *not* disclosed (only the schedule); group meets are.
Implication: the **exchange feed itself tells you a transcript exists** (category `earnings_call`), with the PDF attached — you don't need screener for recent quarters. screener.in's "Concalls" tab links the same PDFs (plus older ones) — fine as the history source.

### 2.2 Anatomy (verified on Infosys Q2 FY27, Marico Q2 FY27, IndusInd Q2 FY27, Vodafone Idea Q4 FY26) **[V]**
1. **Cover**: company, "Q2 FY27 Earnings Conference Call", date, "CORPORATE PARTICIPANTS" (names + titles — CEO/MD, CFO, IR head), "ANALYSTS" (name + firm) — the participant list is a structured header worth extracting (firm names = who follows the stock).
2. **Moderator/Operator** boilerplate: "Ladies and gentlemen, good day and welcome to the … Q2 FY27 Earnings Conference Call … all participant lines will be in the listen-only mode … press star then zero … this conference is being recorded. I now hand the conference over to Mr …".
3. **Safe-harbour** statement by IR ("anything we say that refers to our future outlook is a forward-looking statement…").
4. **Management opening remarks** (CEO: environment, strategy, 3–6 KPIs, *guidance sentence*; CFO: P&L walk, margin bridge in bps, balance sheet, capex, tax rate, *guidance re-statement with basis*). Guidance almost always appears in the **last 2–4 paragraphs of the CEO's remarks and again at the end of the CFO's remarks**, and is often repeated verbatim in the Q&A "summing up".
5. **Q&A**: repeated block `Moderator: Thank you. [The] next question is from the line of <Analyst> from <Firm>. Please go ahead.` → analyst (usually 2 questions + follow-up) → named executive answer. Ends with "That was the last question… I now hand the conference over to … for closing comments." Closing comments frequently restate guidance ("to sum up … we raise our full-year profitability guidance to mid-20s growth" — Marico CFO **[V]**).
6. Indian transcripts are produced by the conference host (Chorus Call/Airtel/"Transcript provided by …") and contain disfluencies and mis-spelt names ("Guggenhiem"). Speaker turns are reliably `Name` on its own line (or `Name:` inline for Marico-style). Segment on that.

### 2.3 Where guidance appears and how it is phrased (India-specific)
Real examples from Oct–Nov 2026 transcripts/releases **[V]**:

| Type | Example | Parse to |
|---|---|---|
| Explicit numeric range, annual | "our revenue growth guidance is 1% to 2% YoY in constant currency terms. Our operating margin guidance remains the same at 20% to 22%." (Infosys, 23 Oct 2026) | metric=rev_growth_cc, period=FY27, low=1, high=2; metric=EBIT_margin, low=20, high=22, status=maintained |
| Adjective bands | "We expect to deliver **teens** revenue growth this year and **comfortably cross the INR15,000 crores** revenue mark … **mid-twenties** EBITDA growth up from **around 20%** that we had estimated earlier … India volume growth … **double digits**" (Marico, Nov 2026) | teens→13–19; mid-twenties→24–26 ("24%, 25% on the minimum side" clarified later); double digit→≥10; prior=~20 → status=raised |
| Absolute rupee target with timeline | "stated vision to reach INR20,000 crores by FY30 with mid-teens EBITDA CAGR … we aspire to wrap up … a year ahead" (Marico) | target=20,000 cr, period=FY30→FY29, confidence=aspiration |
| Operating/volume guidance | "10–12% FY27 revenue growth", "30–31% Operating EBITDA margin", "LCA Mk1A 15–20 units in FY26-27", "HTT-40 20+ units" (HAL, per Q4/Q1 calls) **[N]** | numeric; note "Operating EBITDA" is management-defined |
| Margin direction only | "EBITDA margins to keep degrowing at least for the next year" (FOCO expansion) but "PBT margin to be maintained at prior-year levels" (Kalyan Jewellers) **[N]** | direction=down, floor=none; PBT margin: flat ±0.3pp |
| Return target | "We had set an ambition of a 1% exit ROA for this year … Q2 ROA improved to 0.87%" (IndusInd Bank) **[V]** | metric=ROA, point=1.0, period=exit-FY27, track=0.87 |
| Cost/capex | "capex of ₹12,467 crore … in addition ₹2,826 crore invested in a strategic land parcel" (Airtel) ; "R&D to rise to 6–7% of sales in H2" (Sun Pharma) | absolute or % of sales |
| Unit/pipeline | "6 to 7 million generic semaglutide pens in FY27, followed by 12 to 15 million" (Dr Reddy's) | units |
| Tax rate | "effective tax rate for the year … 29% to 30%" (Infosys) | range |
| Explicit refusal to guide | "I'm not giving you guidance on margin percentage. I'm giving you guidance on EBITDA absolute growth" (Marico CFO) | scope limitation — record which metric is *not* guided |
| Sandbagging tell | Sun Pharma "kept its guidance of high single-digit revenue growth for FY27 even though first-half growth is running at about 11%" **[N]** | status=maintained_below_runrate → likely beat |

**Vocabulary → band mapper (default; make it a config table):** low single digit 1–3; mid single digit 4–6; high single digit 7–9; single digit 0–9; double digit ≥10; low double digit 10–12; low teens 10–13; mid teens 14–16; high teens 17–19; teens 13–19; early twenties 20–23; mid-twenties 24–26; "around/about X" → X±1; "X-ish" → X±1; "at least X" → ≥X; "upwards of X" → >X; "north of X" → >X; "closer to X" → X±0.5; "X–Y band/range" → [X,Y]; "flat/stable/maintain" → prev±(0.5pp margin / 2% growth); "modest/marginal improvement" → +0.5 to +2pp; "significant/sharp" → >5pp; "bps" stated literally. Fiscal mapping: "this year/full year/FY27" → FY ending Mar 2027; "H2" → Oct–Mar; "exit rate/exit quarter" → Q4; "medium term" → 3 yrs; "near term" → next 2 quarters; "FY30 vision" → multi-year.

### 2.4 Hedged vs explicit — detection cues
Score each guidance sentence 0–1 for *commitment*:
- **Explicit (0.8–1.0)**: "guidance is", "we guide", "we are guiding to", "we expect to deliver", "we will", "committed to", "target of", numeric range present, named period present, basis stated (CC, standalone, ex-items).
- **Soft (0.4–0.7)**: "we expect", "should", "likely", "endeavour", "aim", "aspiration", "confident of", "on track", "broadly", "ballpark", "directionally" — Marico explicitly separates "guidance" (FY27) from "aspiration" (FY29) **[V]**.
- **Hedged (0.1–0.3)**: "subject to", "depending on monsoon/crude/geopolitics", "too early to say", "we don't give guidance", "wait and watch" (Maruti on rural demand **[N]**), "multiple models … at the lower end we have baked in higher uncertainty" (Infosys CFO **[V]**), "no specific number", "not in a position to quantify".
- **Scope-limiters** that matter for matching: "in constant currency", "organic", "ex-gRevlimid", "excluding one-offs", "standalone", "like-for-like", "adjusted", "normalised" (IndusInd uses "normalized previous quarter" **[V]**).
- **Withdrawal cues**: "we are withdrawing/suspending guidance", "no longer providing", "we will revisit", "revised to", "narrowed", "cut/lowered to", "raised/upgraded to", "upper end of", "lower end of".

### 2.5 How analysts probe (templates to mine the Q&A)
From Infosys/Marico Q&A **[V]**: "what changed most in the growth guidance revision versus last quarter … can you unpack … the largest drivers?"; "any potential risk to the midpoint of the guidance … any push-pulls?"; "does it have any margin implications during the ramp-up?"; "is this level sustainable or near-term?"; "should one continue to expect mid-teens EBITDA growth in '28, or is there risk to that assumption?"; "the target you've preponed from FY30 to '29 … does the 33% mix number also get revised?"; "what is the business need to run subcontractors at this level … what is stopping us from bringing it down?"; "when do acquisition costs stabilise?". Pattern: analysts **(a)** ask for the bridge of what changed, **(b)** test the band edges, **(c)** test persistence into next year, **(d)** ask about one-offs/normalisation, **(e)** ask about capital allocation (debt reduction, buyback, pledge). The *narrative-vs-numbers* view should quote the sharpest analyst question and management's answer verbatim — that is where hedging shows.

### 2.6 "Promised vs delivered" methodology (last 4 quarters)
**Inputs**: transcripts for the last 5 calls (need the call *before* the first scored quarter), results statements for the last 4 quarters + the FY audited, press releases for management-defined metrics (NIM, AUM, EBITDA-as-defined).

**Step 1 — Extract guidance objects from each transcript** (cheap model, chunked by speaker turn; only opening remarks + closing + any answer containing a number and a period word):
```json
{"company":"MARICO","call_date":"2026-11-02","quarter_of_call":"Q2FY27",
 "metric":"consolidated_revenue_growth","unit":"% YoY","period":"FY27",
 "low":13,"high":19,"point":null,"phrase":"teens revenue growth","direction":null,
 "basis":"consolidated, reported INR","commitment":0.8,"status_vs_prior":"raised",
 "prior_ref":{"low":null,"high":null,"phrase":"~20% EBITDA growth (Q1 call)"},
 "speaker":"Saugata Gupta (MD&CEO)","quote":"We expect to deliver teens revenue growth this year and comfortably cross the INR15,000 crores revenue mark","section":"opening_remarks"}
```
Dedupe across calls by (metric, period); keep the chain of revisions (Infosys FY27 CC growth: 1.5–3.5% (Apr) → 1.5–3% (Jul) → 1–2% (Oct) **[N/V]**).

**Step 2 — Compute the comparable actual** from the results statements for the same metric/period/basis:
- Growth metrics: YoY on the right column (consolidated unless basis says standalone); for CC growth use the press release figure (filing is INR).
- Margin metrics: use management's defined EBITDA if the guidance named it ("Operating EBITDA margin"); else EBITDA_op.
- Annual guidance mid-year: compute **YTD actual** and a **run-rate test**: `required_H2_growth = (low_FY_target × FY_base − H1_actual)/H2_base − 1`; flag "needs X% in H2 vs Y% delivered in H1".
- Volume/unit/capex: from press release/presentation; mark `unverifiable` if the number is not disclosed anywhere primary (HAL "Operating EBITDA" definition not in filing **[N]**).

**Step 3 — Score each (metric, period) pair** with tolerance bands: growth ±1.0pp, margin ±0.5pp, absolute ₹ ±3%, units ±5%:
| Status | Rule |
|---|---|
| **Beat** | actual > high + tol |
| **Met** | low − tol ≤ actual ≤ high + tol (or within tol of point) |
| **Missed** | actual < low − tol |
| **Raised / Cut (revised)** | the next call changed the band before period end — record direction and magnitude; a cut followed by "met" on the lower band is still a **Cut** in the scorecard (Infosys FY27) |
| **Withdrawn** | explicit suspension or disappearance of a previously guided metric from two consecutive calls |
| **Not addressed** | metric was guided, period ended, no update in results/transcript — surface the silence |
| **Unverifiable** | actual not derivable from primary data |
| **On track / Off track** (interim) | run-rate test for annual guidance mid-year |

**Step 4 — Present** as a 4×N grid (quarters × metrics) with cells coloured by status and a one-line verdict: "Guided 20–22% margin; delivered 21.0% (met) — but revenue band cut twice (1.5–3.5% → 1–2%)". Add a "tone" row: count of hedge words per 1,000 words in management remarks, trending.

**Step 5 — Narrative vs numbers**: pair each adjective in the CEO's remarks ("strong", "robust", "resilient", "record") with the number it describes; flag mismatches ("'robust growth' with revenue −2% YoY"; Cipla's Q2 FY27 India +12% headline vs consolidated revenue −2% and PAT −37% **[N]**).

---

## 3. Annual report anatomy and the ratio playbook

### 3.1 Sections (Indian AR, typical order) and where the gold is
| Section | What to extract | Why |
|---|---|---|
| Chairman's letter / "Year at a glance" | KPIs management chooses to show; stated priorities | Narrative baseline for narrative-vs-numbers |
| **Management Discussion & Analysis (MD&A)** (mandated by Sch V Part B LODR) | Industry structure, opportunities/threats, segment-wise performance, outlook, risks, internal controls, **key financial ratios with explanation for >25% change** (LODR Sch V B(1)(i) — debtors turnover, inventory turnover, interest coverage, current ratio, D/E, operating margin, net margin, RoNW) | Management's own ratio set + mandated explanations |
| Board's report | Dividend, transfers to reserves, **material changes**, subsidiaries/JVs performance (Form AOC-1), **RPTs (Form AOC-2)**, CSR, ESOP, auditors & *explanations to qualifications*, **secretarial audit report (MR-3)** qualifications, risk management | AOC-2 lists non-arm's-length RPTs; MR-3 flags compliance lapses |
| Corporate governance report | Board composition, **ID resignations with reasons**, committee attendance, **pledge & encumbrance of promoter shares** (via shareholding pattern), auditor fees (incl. non-audit fees) | Governance red flags |
| **Independent Auditor's Report** | Opinion type (unmodified / **qualified** / adverse / disclaimer), **Emphasis of Matter**, **Material uncertainty related to going concern**, **Key Audit Matters (KAMs)**, **CARO 2020 annexure** (21 clauses), ICFR report | The single highest-signal 6 pages |
| Balance sheet | Borrowings (current/non-current), lease liabilities, trade receivables, inventories, cash & bank, investments, CWIP, intangibles/goodwill, contract assets, other current assets (advances) | Leverage, working capital |
| P&L | As §1 | — |
| **Cash flow statement** (indirect method) | CFO (after tax), **interest paid** (shown in financing under Ind AS 7 for most Indian corporates), capex ("purchase of PPE incl. CWIP and capital advances"), acquisitions, dividends, buyback, debt raised/repaid | Cash quality |
| Notes — **Borrowings** | Lender-wise/instrument-wise, security, interest rates, maturity ladder, covenants, **defaults** | Refinancing risk |
| Notes — **Trade receivables** (Sch III ageing: <6m, 6–12m, 1–2y, 2–3y, >3y; disputed/undisputed; considered good/doubtful) | Ageing buckets, ECL provision | Receivable quality (Rajesh Exports' SEBI case began with receivables >2 years **[N]**) |
| Notes — **Related party transactions (Ind AS 24)** | Parties, nature, amounts, balances, loans/guarantees to related parties | Value leakage |
| Notes — **Contingent liabilities & commitments (Ind AS 37)** | Disputed tax (income tax, GST/excise/customs), guarantees, legal claims, capital commitments | Off-balance-sheet risk |
| Notes — **Segment reporting (Ind AS 108)** | Segment revenue, result, assets, capex; geography | Business snapshot & mix |
| Notes — **Exceptional items** | Nature, recurrence | Quality of earnings |
| Notes — **Additional regulatory information (Sch III, since FY22)** | **11 ratios with >25% change explanations**, promoter shareholding, loans to promoters/KMP/related parties, bank-return reconciliation, wilful defaulter, struck-off companies, benami, undisclosed income, CWIP ageing, title deeds not in company's name, **utilisation of borrowings** | Pre-computed ratios + red-flag checklist handed to you by the MCA **[V]** |
| Notes — Income taxes | ETR reconciliation; deferred tax assets on losses | Tax one-offs (HUL Q2 FY27) |
| Notes — Share-based payments, EPS, Dividends | — | — |
| BRSR (top 1,000) | Employee counts, attrition, energy | Low priority |

### 3.2 Exact ratio formulas (annual; use consolidated)
Let CFO = net cash from operating activities (post-tax, post-working-capital, as reported); Capex = purchase of PPE + intangibles + CWIP movement (cash flow line); EBITDA = EBITDA_op (§1.4); EBIT = PBEIT + FC − OI; NetDebt = (non-current borrowings + current borrowings + current maturities + lease liabilities [state whether included]) − (cash & cash equivalents + bank balances + liquid current investments); Equity = total equity attributable to owners; CE (capital employed) = Equity + total borrowings (+ lease liabilities) − cash (or Total assets − current liabilities; pick one and state it); D = days in year (365).

```
Growth / trajectory
  Revenue CAGR(3y)   = (REV_t / REV_t-3)^(1/3) − 1
  EBITDA margin trend = EBITDA_op/REV per year (flag compression > 200 bps in a year, or 3 falling years)
  PAT CAGR vs Revenue CAGR (flag PAT growing while revenue flat for 2+ years → margin/other-income driven)
  Other income / PBT (flag > 25%)
  Exceptional items frequency = years with |EXC| > 5% PBEIT in last 5 (flag ≥ 3 → "recurring non-recurring")

Balance sheet
  Debt/Equity        = Total borrowings / Equity                       (flag > 1.0 non-financials; > 2.0 severe; irrelevant for banks/NBFCs)
  Net debt/EBITDA    = NetDebt / EBITDA_op                              (flag > 3.0x; watch direction — Hindalco 1.23x → 1.80x in a year while profits are at records [V])
  Interest coverage  = EBIT / FC                                        (flag < 3x; < 1.5x distress)
  Current ratio      = Current assets / Current liabilities             (flag < 1.0 for non-utilities)
  Short-term debt share = (Current borrowings + current maturities)/Total borrowings  (flag > 50% → refinancing dependence)
  Contingent liabilities / Equity                                       (flag > 20%; flag growth > 50% YoY)
  Promoter pledge % of promoter holding (from SHP)                      (flag > 20%; > 50% severe; any increase is an event)
  Goodwill+intangibles / Equity                                         (flag > 50% post-M&A)

Working capital (days on revenue unless noted)
  Receivable days    = Trade receivables × D / REV                      (flag increase > 15 days YoY or > 90 days abs for manufacturing; use avg of opening/closing if available)
  Inventory days     = Inventories × D / COGS  (COGS = materials + purchases + Δinventory; else / REV, say so)
  Payable days       = Trade payables × D / COGS (or purchases)
  Cash conversion cycle = Receivable + Inventory − Payable days          (flag lengthening > 20 days YoY)
  Unbilled/contract assets days (IT/EPC) = Contract assets × D / REV    (flag rising)
  Receivables > 6 months / total receivables (from ageing note)          (flag > 15%)

Cash quality
  CFO / EBITDA       (flag < 0.6 for 2 years; > 1.0 = good; structurally ~0.7–0.9 after tax and WC for most industrials)
  CFO / PAT          (flag < 0.8 for 3 consecutive years; "profits not turning into cash")
  FCF                = CFO − Capex (capex incl. CWIP/capital advances)   ; FCF margin = FCF/REV
  FCF / PAT          (negative for 3+ years while paying dividends → funded by debt/equity → flag)
  Capex / D&A        (> 2.0 = heavy investment phase; < 0.8 for 3 years = under-investment)
  Cash taxes paid / Tax expense  (persistent < 0.7 → deferred-tax driven PAT)
  Dividend + buyback / FCF       (> 1.0 funded by borrowing)

Returns
  ROE   = PAT (owners) / Average equity                                  (flag < cost of equity ~12–13%; > 20% high quality)
  ROCE  = EBIT / Average capital employed                                (flag < 10%; > 20% high quality; compare with pre-tax borrowing cost)
  ROA   = PAT / Average total assets (banks: the key; IndusInd's "1% exit ROA" [V])
  DuPont: ROE = PAT/REV × REV/Assets × Assets/Equity (flag ROE held up only by rising leverage)
  Incremental ROCE (3y) = ΔEBIT / ΔCE
```
Thresholds are *defaults for an industrial*; make them sector-aware: IT services (no debt; watch DSO incl. unbilled, margin, attrition), FMCG (negative working capital normal; watch volume vs price growth, A&P %), pharma (R&D %, US price erosion, FDA observations in notes), autos (inventory days, discounts), infra/EPC (order book/revenue, retention money, mobilisation advances, contract assets), metals (net debt/EBITDA through the cycle, capex), banks/NBFCs (GNPA, NNPA, PCR, credit cost, NIM, CASA, CAR, loan growth vs deposit growth, Stage-3 for NBFC).

### 3.3 Views → which sections/ratios feed them
- **Business snapshot**: MD&A industry para, segment note (revenue/result/assets by segment and geography), top-customer concentration (Ind AS 108 ">10% customer" disclosure), capacity table in MD&A/presentation.
- **Financial snapshot**: last 4 quarters from results + FY from AR; margins; ROE/ROCE; net debt.
- **Trajectory**: 5-year revenue/EBITDA/PAT CAGR, margin path, segment mix drift, capex/D&A, headcount if disclosed.
- **Balance sheet**: borrowings note (maturity ladder, rates, covenants), D/E, net debt/EBITDA, pledge, contingent liabilities, CWIP ageing (projects "temporarily suspended" is a Sch III disclosure → flag).
- **Cash quality**: CFO/EBITDA, CFO/PAT, FCF, working-capital days trend, receivables ageing, bank-return reconciliation disclosure (mismatch → flag), cash taxes.
- **Narrative vs numbers**: §2.6 step 5 + MD&A adjectives vs ratios.
- **Guidance**: §2.
- **Bull vs bear**: template — 3 bull points each tied to a number (growth, returns, balance sheet) and 3 bear points each tied to a red flag (§5) or a missed guidance; state the one metric that would settle the debate next quarter.

---

## 4. Materiality and the priority scheme for the push side

### 4.1 The regulator's own taxonomy (use it)
SEBI LODR Schedule III Part A (clean copy last amended 22 Jan 2026 **[V]**; [SEBI circular 13 Jul 2023 on Reg 30](https://www.sebi.gov.in/sebi_data/attachdocs/jul-2023/1689245602256.pdf) **[V]**):

**Para A — deemed material (always disclose; no threshold)**: 1 Acquisitions / schemes of arrangement (merger, demerger) / sale of units; 2 Issuance or forfeiture of securities, split/consolidation, buyback, dividend declaration, alteration of capital; 3 Revision in credit ratings; 4 Outcome of board meetings (dividend, buyback, fund raising, **financial results**, delisting…); 5 Agreements (shareholder/JV/family settlement…) and 5A agreements affecting control; 6 Fraud/defaults by promoter/KMP/entity, arrest; 7 Change in directors, KMP (MD/CEO/CFO/CS), senior management, auditor, compliance officer (7A auditor's detailed reasons; 7B independent-director resignation reasons; 7C KMP resignation letter with reasons); 8 Share transfer agent; 9 Resolution plan / restructuring; 10 One-time settlement with a bank; 11 Winding-up petition; 12 Notices/circulars to shareholders; 13 Proceedings of AGM/EGM; 14 MoA/AoA amendments; 15 Analyst/investor meets, presentations, audio, transcripts; 16 CIRP events; 17 **Initiation of forensic audit**; 18 Social/mainstream-media statements by promoters/KMP; 19 Regulatory/enforcement actions *initiated* (search/seizure, re-opening of accounts, investigation); 20 Regulatory *orders* (suspension, fine/penalty, settlement, debarment, disqualification, closure); 21 Voluntary revision of financial statements.

**Para B — disclose if material (threshold test)**: 1 Commencement/postponement of commercial production; 2 Strategic/technical/marketing tie-ups, new line of business, closure of operations; 3 Capacity addition or product launch; 4 Orders/contracts not in normal course (award, amendment, termination); 5 Loan/other binding agreements not in normal course; 6 Disruption of operations (calamity, strike); 7 Effects of regulatory change; 8 Litigation/dispute pendency or outcome; 9 Frauds by employees; 10 ESOP schemes; 11 Guarantees/indemnity for third parties; 12 Key licences granted/withdrawn; 13 Delay/default in payment of fines/dues to authorities.

**Materiality threshold (Reg 30(4)(i)(c))**: value or expected impact > **lower of** 2% of consolidated turnover, 2% of consolidated net worth (ignore if negative), 5% of 3-yr average of |PAT|. Compute `M = min(0.02·Turnover, 0.02·NetWorth, 0.05·avg|PAT|)` per company from the last AR and express every rupee-denominated event as `x = value / M`. **[V]**

**Timelines (Reg 30(6))**: 30 minutes from board-meeting close (results, dividends, M&A approved at board); 12 hours if the event emanates from within the company; 24 hours otherwise (and 24h for resignations). So an item's *lateness* vs its *event date* is itself a (minor) signal; and the push digest should expect results between ~market close and 23:59 IST on board-meeting days, with a spike at 17:00–20:00. **[V]**

### 4.2 Exchange subject strings → challenge categories (deterministic layer)
Verified subject patterns (BSE "Announcement under Regulation 30 (LODR)-<Sub>" and NSE "Subject" field) **[V]**:

| Challenge category | Subject/description cues (case-insensitive regex) | Default materiality |
|---|---|---|
| **results** | `Outcome of Board Meeting` + (`financial results`\|`unaudited`\|`audited`); NSE `Financial Result Updates`; BSE category `Result`; `Integrated Filing (Financial)`; `Investor Presentation` filed same day; `Newspaper Publication` of results (routine) | High (the outcome); the press ad is routine |
| **M&A** | `Acquisition`, `Updates on Acquisition`, `Scheme of Arrangement`, `Amalgamation/Merger`, `Demerger`, `Joint Venture`, `Divestment`, `Sale of stake`, `Slump sale`, `Share Purchase Agreement`, NSE `Acquisition`; BSE XBRL Reg-30 acquisition form (structured: target turnover/PAT/net worth, RPT flag, arm's-length flag, consideration) | High; scale by consideration/M |
| **fund_raise** | `Fund Raising`, `Issue of Securities`, `Preferential Issue`, `QIP`, `Qualified Institutions Placement`, `Rights Issue`, `Buyback`, `Allotment of Securities` (non-ESOP), `Commercial Paper`, `Non-Convertible Debentures`, `Allotment of NCD`, `Alteration Of Capital and Fund Raising-XBRL` | Medium–High (equity dilution high; routine CP/NCD rollovers low) |
| **management_change** | `Change in Directorate`, `Change in Management`, `Resignation`, `Resignation of Director/KMP/SMP`, `Appointment`, `Cessation`, `Change in Director(s)`, `Appointment of … Chief Financial Officer`, `Managing Director`, `CEO`, `Whole-time Director`, `Company Secretary`, `Independent Director`; **also** `Change in Auditor`, `Appointment of Statutory Auditor/s`, `Resignation of Statutory Auditor` (route to litigation/red-flag if resignation) | CEO/MD/CFO/Promoter-director: High; ID: Medium; CS, routine re-appointment, retirement by rotation: Low |
| **litigation** | `Litigation`, `Order`, `SEBI`, `Show Cause`, `Penalty`, `Fine`, `Adjudication`, `NCLT`, `Insolvency`, `CIRP`, `Arbitration`, `Court`, `Supreme Court`, `High Court`, `Tax demand`, `GST`, `Search`, `Seizure`, `Forensic audit`, `Settlement Order`, `Warning letter`, `Regulation 30 … Action(s) taken` | High if monetary > M or involves promoter/KMP/forensic audit; routine if "no impact" GST notice < M |
| **insider_trading** | `Disclosure under Regulation 7(2)` (PIT), `Reg. 29(2)`/`29(1)` SAST, `Insider Trading / SAST` category, `Trading Plan`; mode `market sale/purchase`, `off-market`, `gift`, `ESOP exercise` | Promoter buy/sell in market > 0.25% of capital: Medium–High; ESOP exercise/gift/inter-se transfer: Low |
| **earnings_call** | `Analyst / Investor Meet - Intimation` (schedule — low), `Earnings Call Transcript` / `Transcript` (medium: triggers pull update), `Link of Audio Recording`, `Analyst / Investor Meet - Outcome`, NSE `Analysts/Institutional Investor Meet/Con. Call Updates` | Transcript: Medium (feeds research); schedule/audio link: Low |
| **investor_meetings** | `Analyst / Investor Meet - Intimation` with `one-on-one`, `conference`, `roadshow`, `non-deal roadshow`, `investor conference`; `Analyst/Investor Meet Para A-XBRL` | Low (collapse) |
| **credit_rating** | `Credit Rating`, `Revision in Credit Rating`, `Rating Rationale`, `CRISIL`, `ICRA`, `CARE`, `India Ratings`, `Brickwork`, `Acuite`, `Infomerics`; words `upgraded`, `downgraded`, `reaffirmed`, `placed on watch`, `outlook revised to negative/positive`, `withdrawn` | Downgrade/negative outlook: High; upgrade: Medium; reaffirmed: Low |
| **dividend** | `Dividend`, `Interim Dividend`, `Record Date`, `Date of payment of Dividend`, `Fixes Record Date` | Declaration: Medium (high if first/special/cut/skip); payment-date intimation: Low |
| **bonus_split** | `Bonus`, `Bonus Issue`, `Stock Split`, `Sub-division`, `Face Value` | Medium |
| **capex** | `Capacity Expansion`, `Capex`, `Greenfield`, `Brownfield`, `New Plant`, `Commencement of Commercial Production`, `Commissioning`, `Expansion`, `Capacity addition` | Medium; High if capex > 20% of net block or > M |
| **press_release** | `Press Release / Media Release`, `Award_of_Order_Receipt_of_Order`, `Bagging/Receiving of orders/contracts`, `Order Win`, `Launch`, `Partnership`, `MoU`, `Clarification on … news item / market rumour` (Reg 30(11)), `Updates`, `General Updates`, `Business Update` (monthly sales/provisional quarterly update) | Order win: scale by value/M (BEL ₹1,011 cr order ≈ 4% of revenue → medium); rumour clarification *denial*: Medium; routine PR: Low |
| **postal_ballot** | `Postal Ballot`, `Notice of Postal Ballot`, `Scrutinizer's Report`, `Voting Results`, `Shareholder Meeting / Postal Ballot-Outcome of Postal_Ballot` | Low; Medium if a resolution *failed* or had > 20% against (parse the scrutiniser table) |
| **agm_egm** | `Annual General Meeting`, `AGM`, `EGM`, `Extraordinary General Meeting`, `Proceedings of AGM`, `Annual Report` (the AR filing itself → triggers pull refresh), `Shareholder Meeting / Postal Ballot-Outcome of AGM` | Low; AR filing: Medium (research refresh) |
| **pledging** | `Pledge`, `Encumbrance`, `Release of Pledge`, `Invocation of Pledge`, `Disclosure under Regulation 31(1)/31(2)` SAST, `Reg. 31(4)`, `Invoked`, `Revoked`, `Creation of pledge`, PIT `Pledge Creation/Revocation/Invocation` in insider filings | Creation/invocation: High (very high if invocation or promoter pledge > 50%); release: Medium |
| **unclassified / routine** | `Closure of Trading Window`, `Trading Window`, `Certificate under Reg. 74 (5)` of SEBI (DP) Regulations, `Compliances-Reg. 39 (3)`, `Loss of Share Certificates`, `Duplicate Share Certificate`, `Issue of Duplicate`, `Newspaper Publication`/`Copy of Newspaper Publication`, `Allotment of ESOP / ESPS`, `Grant of Stock Options`, `ESOP`, `Reg. 40(9)`/`40(10)` certificates, `Compliance Certificate`, `Secretarial Compliance Report`, `Statement of Deviation … NIL`, `Reconciliation of Share Capital Audit`, `Shareholding Pattern`, `Corporate Governance Report`, `Intimation of ESG Rating`, `BRSR`, `Sustainability Report`, `Change in Registered Office/Corporate Office Address`, `Details of Compliance Officer and RTA`, `Monitoring Agency Report`, `Disclosure under Regulation 30 – Investment in subsidiary (routine infusions)`, `Half-Yearly Report` submission, `Intimation of Book Closure`, `Appointment of Secretarial Auditor/Internal Auditor`, `Code of Conduct/Fair Disclosure amendments`, `Record date for interest payment on NCDs`, `Payment of interest on NCDs` | Collapse by default (score < 20) |

Notes: (i) BSE top-level categories are `AGM/EGM, Board Meeting, Company Update, Corp. Action, Insider Trading / SAST, New Listing, Result, Integrated Filing, Others` **[V]** — `Company Update` is the junk drawer; everything above with "Announcement under Regulation 30 (LODR)-…" sits there. (ii) NSE `desc` values seen on 6 Nov 2026 **[V]**: `Outcome of Board Meeting`, `Analysts/Institutional Investor Meet/Con. Call Updates`, `Change in Management`, `Resignation of Director/KMP/SMP`, `Allotment of Securities`, `Amalgamation/Merger`, `Press Release`, `Updates`, `General Updates`, `Shareholders meeting`, `Statement of deviation(s) or variation(s) under Reg. 32`. (iii) The NSE "description" sentence is machine-generated ("…has informed the Exchange about Transcript", "…submitted … the financial results for the period ended September 30, 2026") — it is structured enough to regex. (iv) The **attachment text**, not the subject, is where M&A sizes, resignation reasons and order values live; extract the first 2 pages only for scoring.

### 4.3 Priority score (0–100) — draft scheme
`score = clamp( base[category] + magnitude + surprise + market_reaction + governance_bonus − repetition_decay ) × user_weight[category]`, then buckets: **≥75 push notification**, **50–74 top of digest**, **25–49 listed**, **<25 collapsed under "routine (n)"**.

| Category | Base | Magnitude modifier | Surprise/governance modifiers | Routine variants (force ≤20) |
|---|---|---|---|---|
| results | 70 | — | YoY PAT or revenue beyond ±15%: +10; exceptional > 20% of PBEIT: +10; auditor qualification in LRR: +20; loss vs profit flip: +10 | newspaper ad; "intimation of board meeting" = 25 (pre-alert) |
| M&A | 60 | +10 if consideration > M; +20 if > 10% of mcap or transformational (demerger/listing of subsidiary); +10 if cross-border | +10 if RPT or target controlled by promoter group (Adani Enterprises/Vizag DC case **[V]**); −20 if intra-group reorganisation of WOS (Sundaram Finance/SAAL **[V]**) | step-down WOS incorporations |
| management_change | 50 | — | CEO/MD/CFO/Chair/promoter-director: +25; ID resignation citing disagreement/"unable to devote time" with <1y tenure: +20; auditor resignation: +30; interim appointment: +10; second CFO exit in 24 months: +15 | CS change, re-appointment, retirement by rotation, KMP redesignation |
| litigation | 55 | +15 if amount > M; +25 if SEBI interim/confirmatory order, forensic audit, NCLT admission | +10 if promoter/KMP named; −25 if "no material impact" GST/tax notice < 0.2·M | routine tax assessment orders |
| fund_raise | 45 | equity (QIP/pref/rights) > 5% dilution: +20; buyback: +10 | distressed (pref to promoter at discount, rights to fund debt): +15 | CP/NCD routine issuance/allotment, interest payment intimations |
| credit_rating | 40 | downgrade: +35; outlook negative/watch: +20; upgrade: +15 | first-time rating of large issuance: +5 | reaffirmation |
| pledging | 50 | promoter pledge creation: +15; invocation: +35; pledge > 50% of promoter holding: +15 | release: −10 (still medium) | non-promoter designated-person pledges (DMART employees in the insider feed **[V]**) |
| dividend | 35 | special/first-ever: +20; cut/skip vs prior year: +25; yield of payout > 3% of price: +10 | — | payment-date intimation, record-date reminder |
| bonus_split | 35 | — | — | — |
| capex | 40 | capex > 20% of net block or > M: +20; new line of business: +10 | "temporarily suspended" project: +20 | — |
| earnings_call | 30 (transcript) | — | transcript containing guidance change words (cut/raised/withdraw): +25 (hand off to pull) | schedule intimation 15; audio link 15 |
| press_release | 25 | order value / M: +10 (1–3×), +20 (>3×) | rumour *denial* +15; rumour *confirmation* → reclassify M&A | generic PR, awards, CSR |
| insider_trading | 25 | promoter market sale > 0.25% capital: +30; promoter buy > 0.25%: +20 | sale within 3 months of a QIP/results: +10 | ESOP exercise, gifts, inter-se promoter transfers, employee sales |
| investor_meetings | 10 | — | — | all |
| postal_ballot / agm_egm | 15 | resolution failed/withdrawn: +40; >20% votes against: +20 | AR filing: set 35 and trigger research refresh | notices, routine proceedings |
| unclassified | 5 | — | — | all |

Cross-cutting: `market_reaction` +10 if the same-day EOD move exceeds the user's price threshold or volume > 2× 20-day ADV; `repetition_decay` −15 for the 2nd+ identical subject from the same company in 7 days (serial ESOP allotments, daily buyback updates, monthly order wins); `user_weight` default 1.0, user-set 0–2 per category (the brief insists thresholds/alerts are user-configurable). Also compute `x = value/M` whenever a rupee amount is extractable; expose it in the UI as "≈ 3.2× the company's own materiality threshold" — a neat, defensible way to explain *why* something is on top.

### 4.4 One-line summary templates per category (what "earns attention")
- **results**: `{Company} Q{n} FY{yy}: Rev ₹{rev} cr ({yoy:+.0%} YoY, {qoq:+.0%} QoQ) · EBITDA margin {m:.1%} ({Δbps:+} bps YoY) · PAT ₹{pat} cr ({yoy_pat:+.0%}){ · excl. ₹{exc} cr exceptional: {adj_yoy:+.0%}}{ · auditor qualified}`. Banks: `NII ₹{nii} ({yoy}) · PPOP ₹{ppop} · PAT ₹{pat} ({yoy}) · GNPA {g}% ({Δ} bps QoQ) · NIM {nim}%`.
- **management_change**: `{Role} {Name} {resigns|appointed} w.e.f. {date}{; reason: "{reason_quote}"}{; successor: {Name}, ex-{prior company/role} (from filing's brief profile)}` — the Reg 30 annexure mandates "brief profile (in case of appointment)" and 7C requires the resignation letter with reasons **[V]**, so the bio and the reason are *in the filing*; LinkedIn is enrichment.
- **M&A**: `{Acquires|Sells} {stake}% of {Target} ({industry}) for ₹{amt} cr ({x:.1f}× materiality; {EV/Revenue} on target FY{yy} turnover ₹{t} cr){ · RPT: {yes/no}}{ · completion by {date}}` (fields map 1:1 to the BSE XBRL Reg-30 acquisition form **[V]**).
- **fund_raise**: `{QIP|Rights|Pref|Buyback} of ₹{amt} cr ({dilution}% of equity) at ₹{price} ({prem/disc}% to CMP){ · to {use of proceeds}}`.
- **litigation**: `{Authority} {order type} — {amount ₹ cr or "non-monetary"} · {subject} · company says: "{impact statement}"`.
- **credit_rating**: `{Agency} {upgrades|downgrades|reaffirms} to {rating}/{outlook} (from {prior}) on ₹{amt} cr {instrument} — reason: {one clause}`.
- **dividend**: `Interim dividend ₹{d}/share ({pct}% of FV) · record date {date} · yield {y}% · {vs ₹{prior} last year}`.
- **pledging**: `Promoter {creates|releases|invoked} pledge on {n} lakh shares ({pct}% of capital) → encumbered {total}% of promoter holding · for {lender/purpose}`.
- **capex**: `Approves ₹{amt} cr {greenfield|brownfield} {what} at {where}, {capacity} by {date} ({pct}% of net block)`.
- **press_release (order)**: `Order win ₹{amt} cr from {client} ({pct}% of FY{yy} revenue) · execution {months}`.
- **earnings_call (transcript)**: `Transcript out: guidance {maintained|raised|cut|withdrawn} — "{quote}" · {n} analysts · tone {hedge index}`.
- **insider_trading**: `Promoter {buys|sells} {n} shares ({pct}% of capital, ₹{amt} cr) in market on {date} · holding → {post}%`.
- **bonus_split**: `{Bonus 1:1 | Split FV ₹10→₹1} · record date {date}`.
- **agm_egm/postal_ballot**: `{Resolution} {passed|failed} with {against}% against{ · AR FY{yy} filed → research refreshed}`.

---

## 5. Red flags to surface from primary documents (detection rules)

| # | Flag | Where | Rule / cue | Severity |
|---|---|---|---|---|
| 1 | **Auditor qualification / EoM / going concern** | LRR with results; AR audit report | "qualified conclusion/opinion", "basis for qualified", "we were unable to obtain sufficient appropriate evidence", "material uncertainty related to going concern", "emphasis of matter"; Statement on Impact of Audit Qualifications. Ola Electric Q1 FY27: BSR qualified over a ₹57 cr PLI liquidated-damages provision reversal without MHI approval **[V]** | Very high |
| 2 | **Auditor resignation** before term (esp. mid-year, "pre-occupation", "fees not paid", "information not provided") | Reg 30 7A filing (format requires: date appointed, scheduled expiry, last report, detailed reasons, efforts made, whether information was withheld) **[V]** | Any resignation within 45 days of quarter-end that takes effect "after issuing the LRR" = SEBI's own suspicious-timing rule; "non-payment of fees" (Garbi Finvest **[V]**) and "information not provided" are the worst | Very high |
| 3 | **Frequent CFO/CS/ID churn** | Reg 30 7/7B/7C | ≥2 CFO changes in 24 months; ID resignation with < 1 year tenure or reasons beyond "personal"; resignation effective immediately | High |
| 4 | **Promoter pledge** | SHP (quarterly, Reg 31), SAST 31(1)/(2) filings, PIT pledge disclosures, BSE pledge page | > 20% of promoter holding, any *increase*, any *invocation*; pledge created post lock-in expiry (Nuvama/PAG: 52.5% of capital encumbered **[N]**); 100% pledged (Vedanta Aluminium promoters **[N]**) | High |
| 5 | **Related-party leakage** | AOC-2, Ind AS 24 note, half-yearly RPT disclosure (Reg 23(9)), Reg 30 acquisition form "RPT?/arm's length?" | RPT sales+purchases > 10% of revenue; loans/advances/guarantees to promoter entities; acquisitions of promoter-group assets (AdaniConneX buying Vizag DC park from Adani Infra for ₹1,085 cr **[V]**); royalty/brand fees > 2% of sales; "loans repayable on demand to promoters" (Sch III) | High |
| 6 | **Receivables ballooning / ageing** | Sch III receivables ageing; CFO vs PAT | Receivable days +15 YoY; > 6-month bucket > 15%; disputed receivables rising; receivables > 2 years (Rajesh Exports — SEBI complaint trigger **[N]**) | High |
| 7 | **Contingent liabilities growth** | Ind AS 37 note | > 20% of equity or +50% YoY; guarantees for group companies | Medium–High |
| 8 | **Recurring "exceptional" items** | P&L + notes | abs(EXC) > 5% of PBEIT in ≥3 of last 5 years; impairments every year; "one-time" labour-code charges, settlements | Medium |
| 9 | **Other income propping PBT** | P&L | Other income > 25% of PBT for 2+ years; fair-value gains on investments | Medium |
| 10 | **Cash conversion failure** | Cash flow | CFO/PAT < 0.8 for 3 years; negative FCF with rising debt and dividends | High |
| 11 | **Debt structure** | Borrowings note, CARO (ix) | Defaults listed in CARO (ix)(a); "term loans used for other purposes" (ix)(d); short-term funds used long-term (ix)(e); covenant breaches; ICDs | Very high |
| 12 | **Bank return mismatch** | Sch III + CARO (ii)(b) | "quarterly returns filed with banks not in agreement with books" | High |
| 13 | **Statutory dues arrears** | CARO (vii) | Undisputed dues > 6 months outstanding | Medium |
| 14 | **Fraud / whistle-blower / forensic audit** | CARO (xi), Reg 30 Para A 6 & 17, Board's report | Any; forensic audit initiation (Rajesh Exports; Kore Digital **[N]**) | Very high |
| 15 | **Wilful defaulter / struck-off companies / benami** | Sch III additional regulatory information | Any non-nil disclosure | High |
| 16 | **Capital WIP ageing / suspended projects** | Sch III CWIP table | Projects > 3 years in CWIP or "temporarily suspended" | Medium |
| 17 | **Ratio explanations** | Sch III 11 ratios with >25% change | The explanation text itself (e.g., "due to increase in borrowings") is a free summary of what moved | Info |
| 18 | **Tax anomalies** | Tax note | ETR < 15% or > 40%; deferred-tax asset on losses growing; one-off tax credits (HUL Q2 FY27 ₹273 cr **[N]**) | Medium |
| 19 | **Promoter selling / reclassification** | PIT 7(2), SAST 29(2), Reg 31A reclassification | Promoter sells > 1% in a quarter; application to reclassify promoter to public | Medium–High |
| 20 | **Guidance credibility** | §2.6 | ≥2 cuts in a year (Infosys FY27 **[V]**); "withdrawn"; persistent "not addressed" | Medium |
| 21 | **Regulatory orders / warnings** | Reg 30 Para A 19–20 | SEBI interim orders, administrative warnings (PC Jeweller SDD lapse **[N]**), RBI directions, NFRA referrals | High |
| 22 | **Price-sensitive silence** | Feed | Rumour clarification filed *after* a > 5% move; results delayed past 45 days (automatic exchange fine — a `litigation`-grade flag) | Medium |

---

## 6. Demo portfolio (verified against what happened Oct–Nov 2026)

Calendar facts for the demo week **[N/V]**: NSE/BSE **closed Tue 10 Nov 2026** (Diwali Balipratipada) — no EOD bar that day, don't flag zero volume. Q2 FY27 results deadline **Sat 14 Nov**; quarterlyresults.in tracks 55 notable companies (20 in F&O) reporting 9–14 Nov, Upstox counts ~370 filers on 12 Nov and ~480 on 13 Nov — the last two days are a firehose, which is exactly when a prioritised digest earns its keep. Transcripts for 4–6 Nov reporters land 9–13 Nov. Record dates: Dabur ₹3.50 (10 Nov), Aurobindo ₹7 / CONCOR ₹1.90 (11 Nov), **HUL ₹19 and ONGC ₹8 (12 Nov)**, Godfrey Phillips ₹10 (12 Nov), FDC buyback (13 Nov). Macro backdrop visible in filings: crude realisation $92/bbl (ONGC), rupee ~96/USD (HAL preview), FCNR(B)-driven NIM compression, El Niño rural-demand warnings (Maruti, PI, IndusInd).

Market-cap buckets are approximate (AMFI: large = top 100, mid = 101–250, small = rest); the engineer should refresh from yfinance `marketCap`. BSE codes marked (v) were read off a filing today; others are from memory **[K]** — verify once via the BSE scrip lookup.

### 6.1 Portfolio (20)
| # | NSE | BSE | Company | Sector | Cap | Why it makes the demo richer (verified event, date) |
|---|---|---|---|---|---|---|
| 1 | RELIANCE | 500325 | Reliance Industries | Conglomerate (O2C, telecom, retail) | Large | Record Q2 (30 Oct): rev ₹3.62 lakh cr, PAT ₹29,550 cr; **Jio Platforms listed 28 Oct at +21%** → M&A/subsidiary-listing category, net debt/EBITDA 0.47; capex ₹38k cr/qtr. Tests consolidated-first layout and "GST recovered" revenue line **[V]** |
| 2 | HDFCBANK | 500180 | HDFC Bank | Private bank | Large | Bank-format card (NII ₹34,619 cr, PPOP ₹29,483 cr, PAT ₹19,510 cr +4.7%, NIM 3.16% −10 bps) — the weakest growth among big privates; FCNR(B) theme **[V]** |
| 3 | SBIN | 500112 | State Bank of India | PSU bank | Large | Q2 (3 Nov): PAT ₹23,038 cr +14%, GNPA 1.39% "lowest in two decades"; consolidated includes insurance (tests standalone-vs-consolidated rule) **[N/V]** |
| 4 | INDUSINDBK | 532187 | IndusInd Bank | Private bank | Mid | Turnaround after the 2025 derivatives-accounting scandal and CEO exit: Q2 PAT ₹1,242 cr vs loss; new MD Rajiv Anand; explicit "1% exit ROA" target vs 0.87% → promised-vs-delivered + narrative-vs-numbers **[V]** |
| 5 | INFY | 500209 | Infosys | IT services | Large | FY27 CC growth guidance **cut twice** (1.5–3.5 → 1.5–3 → 1–2%) while margin 20–22% maintained (23 Oct); ₹26 interim dividend; $2bn+ mega deal; ADR −8% → the canonical guidance scorecard **[V]** |
| 6 | SUNPHARMA | 524715 | Sun Pharma | Pharma | Large | Q2 (2 Nov): reported PAT −32% on ₹1,269 cr one-time loss vs adjusted ₹3,162 cr; kept "high single digit" guidance with H1 at 11%; Organon acquisition closing Q4 → exceptional-item handling + sandbagging **[N]** |
| 7 | DRREDDY | 500124 | Dr. Reddy's | Pharma | Large | PAT −32%, US −31% (gRevlimid cliff); unit guidance (6–7 mn semaglutide pens FY27; relaunch Nov 2026); files in ₹ million → unit-normalisation test **[N]** |
| 8 | MARUTI | 532500 | Maruti Suzuki | Auto | Large | Q2: volumes +27% but PAT −26%, EBITDA margin 9.4% (−300 bps); "wait and watch" rural/El Niño hedge; record Oct sales → volume-vs-margin story **[N]** |
| 9 | TMPV | 500570 (?) | Tata Motors Passenger Vehicles | Auto | Large | Demerged entity (CV business = TMCV, BSE 544569 (v), listed 12 Nov 2025); **results 13 Nov** in demo week; renamed ticker = edge case for data plumbing **[V]** |
| 10 | HINDUNILVR | 500696 | Hindustan Unilever | FMCG | Large | **₹19 interim dividend, record date 12 Nov**; Q2 UVG 7%, USG 15%; one-off ₹273 cr *tax* gain in PAT; new CEO Priya Nair **[N]** |
| 11 | MARICO | 531642 | Marico | FMCG | Mid/Large | Guidance **raised** (EBITDA growth ~20% → mid-twenties; "teens" revenue; ₹20,000 cr FY30 vision pulled to FY29 as "aspiration") — the counter-example to Infosys; rich transcript **[V]** |
| 12 | ITC | 500875 | ITC | Conglomerate/FMCG | Large | Q2 (2 Nov): PAT −18.7% as cigarette GST moved to 40% of RSP (regulatory-change category); segment reporting demo **[N]** |
| 13 | LT | 500510 | Larsen & Toubro | Infra/EPC | Large | Q2 (27 Oct): PAT +33%, order inflow ₹1.48 lakh cr (+28%), 63% international; order-win press releases every week → press_release scoring by value/M **[N]** |
| 14 | HINDALCO | 500440 | Hindalco | Metals | Large | Record Q2 (6 Nov) yet net debt/EBITDA rose 1.23x → 1.80x (Novelis capex, Bay Minette) → "balance sheet vs P&L" view; transcript lands in demo week **[V]** |
| 15 | ONGC | 500312 | ONGC | PSU energy | Large | Q2 (5 Nov): standalone PAT ₹15,489 cr +57%; **highest-ever interim dividend ₹8 (160%), ex-date 12 Nov**; crude $92 → dividend category live **[V]** |
| 16 | BHARTIARTL | 532454 | Bharti Airtel | Telecom | Large | Q2 (5 Nov): rev ₹60,878 cr +16.7%, EBITDA margin 57.9%, capex ₹12,467 cr + ₹2,826 cr data-centre land; now #3 by mcap after Jio's listing **[V]** |
| 17 | HAL | 541154 | Hindustan Aeronautics | Defence PSU | Large | **Results 12 Nov**; crisp numeric guidance (10–12% growth, 30–31% op. EBITDA margin, 15–20 LCA Mk1A, 20+ HTT-40) vs Q1 margin 27.7% → live promised-vs-delivered **[N]** |
| 18 | KALYANKJIL | 543278 | Kalyan Jewellers | Retail (jewellery) | Mid | **Results 10 Nov (holiday), call 11 Nov 08:30**; promoter pledge ~25% of holding with a Feb-2026 promise to cut it in 6 months → check Sep-2026 SHP; EBITDA margin guided *down* (FOCO) but PBT margin flat **[N]** |
| 19 | THERMAX | 500411 | Thermax | Capital goods | Mid | **−20% on 6 Nov** (and −23% after Q1): PAT miss, ₹15 cr impairment, yet H2 revenue guidance *raised* to > ₹7,000 cr → price-anomaly alert + guidance paradox **[N]** |
| 20 | IDEA | 532822 (v) | Vodafone Idea | Telecom | Large by mcap, penny by price (₹12.76) | **Results 12 Nov, call 13 Nov 14:30**; AGR write-back ₹55,622 cr exceptional in Q4 FY26 (PAT distortion showcase); loss-making → YoY on negatives; trading-window intimation parsed from filing **[V]** |

Alternates if any of the above break: ICICIBANK 532174 / AXISBANK 532215 (NIM guidance 3.8%), CIPLA 500087, NESTLEIND 500790, TMCV 544569 (v), DABUR 500096, LUPIN 500257, ADANIENT 512599 (CARE upgrade to AA; promoter-group acquisition), VEDL 500295.

### 6.2 Ad-hoc research names (5) — chosen so the *pull* side has to work hard
| NSE | BSE | Company | Why |
|---|---|---|---|
| OLAELEC | 544225 (v) | Ola Electric Mobility | Small cap (~₹17k cr); **auditor qualified review (Q1 FY27)**; explicit guidance stack (gross margin 30–32%, opex ₹300–325 cr/qtr vs ₹333 cr delivered, 20–25k units/month breakeven vs ~13k) → "promised vs delivered" with misses; results + call 12 Nov **[V/N]** |
| NUVAMA | 543988 (v) | Nuvama Wealth Management | Mid cap; promoter PAG (54%) running a sale (EQT/Brookfield/ChrysCapital shortlisted) **and** pledged 52.5% of capital on 30 Oct 2026 post lock-in → pledging + control-change; Q2 PAT +26% (6 Nov) **[V/N]** |
| VEDL | 500295 | Vedanta | Post-demerger (4 new listings 15 Jun 2026); "debt-free in Q3 FY27" promise by CFO; interim dividend ₹5; parent VRL BB-rated — balance-sheet/cash-quality view with a dated promise to check **[N/V]** |
| PIIND | 523642 | PI Industries | Mid cap agrochem; Q2 PAT −70%, EBITDA margin −1,524 bps, stock −15% to 52-week low (5 Nov); El Niño/genericisation → bull-vs-bear is genuinely contested **[N]** |
| RAJESHEXPO | 531500 | Rajesh Exports | Stress test: SEBI confirmatory order (14 Oct 2026) with forensic audit, receivables > 2 years, RPT gaps; the company rarely hosts concalls → the engine must degrade gracefully ("no transcripts found; research grounded in AR only") **[N]** |

### 6.3 What each demo day can show (if the team wants a scripted demo)
- **Mon 9 Nov**: digest of Thu–Sun filings (Hindalco, ONGC, Airtel, M&M, PI, Cummins, Astral, Nuvama results; Carysil CFO exit; pledge creations); Thermax −20% anomaly; Dabur record date.
- **Wed 11 Nov**: Kalyan transcript/call; Tata Power/GRSE results; HUL/ONGC ex-dividend tomorrow reminders.
- **Thu 12 Nov**: HAL, Vodafone Idea, Ola Electric, Oil India, Alkem, NMDC, Page Industries, IRCTC, Manappuram results — the heaviest day; HUL/ONGC record dates.
- **Fri 13 Nov**: TMPV, Grasim, Eicher, ABB, RVNL, Natco results; Vodafone Idea call 14:30; Infosys/Marico/Hindalco transcripts in hand for guidance scorecards.

---

## 7. Recommendations (prioritised) and assumptions to challenge

### 7.1 Recommendations
1. **Build the results parser label-first with identity checks and XBRL fallback** (§1.3–1.4, 1.9). Ship the card with "PBT (pre-exceptional)" and an exceptional chip; never show Total income as revenue.
2. **Three statement templates (corporate / bank / NBFC), auto-detected**; insurers → PAT-only fallback.
3. **Guidance objects as first-class data** (§2.6 JSON) with the vocabulary mapper as a config table; score with explicit tolerances; show the revision chain.
4. **Priority score = category base + value/M + governance modifiers** (§4.3); expose `x = value/M` in the UI as the explanation.
5. **Regex the exchange subjects before any LLM** (§4.2); send only the first 2 pages of ambiguous attachments to a cheap model.
6. **Pull research reads the auditor's report and the Schedule III "additional regulatory information" first** — they are short and carry most red flags (§3, §5).
7. **Cache every PDF you touch** (BSE AttachLive rotates ~60 days); store transcripts by (symbol, quarter).
8. Treat **10 Nov** as a market holiday in the anomaly engine; compute volume baselines on trading days only; use σ-based price thresholds with user override (defaults: ±5% large, ±8% mid, ±10% small; volume > 2× 20-day ADV).

### 7.2 Assumptions others should challenge
- **EBITDA excluding other income as the default.** Many Indian press releases (Reliance, Hindalco) include it; screener excludes it. If the judges mentally benchmark against the company's own press release, our margin will look lower. Consider showing both with a toggle.
- **Consolidated-first.** For holding companies and banks this can mislead; the rule set in §1.8 is heuristic.
- **Tolerance bands** (±1pp growth, ±0.5pp margin) are my judgement; management-defined metrics (e.g., HAL "operating EBITDA") may be unverifiable from filings.
- **Vocabulary → band mapping** ("teens", "mid-twenties") is conventional, not regulated; Marico itself clarified "mid-20s" as "24–25% minimum" only when probed.
- **The materiality threshold M** uses the last audited consolidated numbers; for loss-makers/negative net worth it collapses to the turnover/PAT legs — fine, but it makes tiny items "material" for near-zero-PAT companies (Vodafone Idea, Ola). Cap `x` at 10.
- **Portfolio recency.** Everything in §6 was verified against filings or news dated 1–8 Nov 2026, but **BSE codes marked (?) and market-cap buckets are from memory**; TMPV may still carry Tata Motors' old BSE code 500570; yfinance tickers for TMPV/TMCV post-rename must be tested.
- **Transcript availability** on screener for small caps (Rajesh Exports, Ola Electric's early quarters) is assumed patchy; the exchange feed covers only the last ~2 years reliably.
- **OCR quality**: the Bajaj Finance sample suggests ~1 in 50 numbers is corrupted in scanned filings; identity repair fixes totals but not sub-lines — the card should only use lines that pass an identity or have an XBRL twin.

### 7.3 Primary sources consulted (selection)
- SEBI LODR clean copy (amended to 22 Jan 2026): https://www.sebi.gov.in/sebi_data/attachdocs/jun-2026/1780915347745.pdf
- SEBI circular on Reg 30 disclosures/timelines/materiality (13 Jul 2023): https://www.sebi.gov.in/sebi_data/attachdocs/jul-2023/1689245602256.pdf
- SEBI LODR FAQs (Apr 2025): https://www.sebi.gov.in/sebi_data/faqfiles/apr-2025/1745399101865.pdf
- HDFC Bank Q2 FY27 results filing (17 Oct 2026): https://nsearchives.nseindia.com/corporate/HDFCBANK_17102026135520_OutcomeofBMResults_17oct2026.pdf
- Bajaj Finance Q2 FY27 results (BSE attachment, scanned): https://www.bseindia.com/xml-data/corpfiling/AttachLive/229c460f-9cda-4732-972f-847519b40426.pdf
- Reliance Q2 FY27 media release (30 Oct 2026): https://www.ril.com/sites/default/files/2026-10/30102026_Media%20Release_RIL_Q2_FY2026-27_Financial_and_Operational_Performance.pdf
- Hindalco Q2 FY27 release (6 Nov 2026): https://www.hindalco.com/media/press-releases/hindalco-results-q2fy27
- ONGC Q2 FY27 press release (5 Nov 2026): https://nsearchives.nseindia.com/corporate/ONGC_05112026180527_PR05112026.pdf
- Infosys Q2 FY27 transcript (23 Oct 2026): https://www.infosys.com/investors/reports-filings/quarterly-results/2026-2027/q2/documents/transcripts/earningscall.pdf
- Marico Q2 FY27 transcript: https://marico.com/investorspdf/Marico%20Limited%20Q2FY27%20Earnings%20Call%20Transcript.pdf ; information update: https://nsearchives.nseindia.com/corporate/marico_02112026154319_SEInt.pdf
- Vodafone Idea board-meeting intimation (3 Nov 2026): https://nsearchives.nseindia.com/corporate/IDEA_03112026154340_SEPriorIntimationQFY27signed.pdf ; Q4 FY26 transcript (AGR accounting): https://www.myvi.in/content/dam/microsite/pdfs/Results/FY2025-26/Q4-2026/Q4FY26-and-FY26-Earnings-Call-Transcript.pdf
- Ola Electric Q1 FY27 outcome with qualified LRR (7 Aug 2026): https://nsearchives.nseindia.com/corporate/OLAELECTRIC_07082026162825_Outcome.pdf
- Nuvama Q2 FY27 earnings release (6 Nov 2026): https://www.bseindia.com/xml-data/corpfiling/AttachLive/c6e75219-7e22-47c2-8530-451045d4f0d9.pdf
- Nykaa/FSN BSE XBRL Reg-30 acquisition form (4 Nov 2026): https://www.bseindia.com/XBRLFILES/Reg30DuplicateUploadDocument/Reg30_543384_04112026053803_Reg30.html
- Adani Enterprises intimation on Vizag Mega Data Center Park SPA (6 Nov 2026): https://www.bseindia.com/xml-data/corpfiling/AttachLive/9954341c-4e68-4989-9da6-b07df9cad13c.pdf
- Affle 3i / Perion acquisition (1 Nov 2026): https://nsearchives.nseindia.com/corporate/AFFLE_01112026174902_Acquisition_announcement1.pdf
- BSE listing notice Tata Motors (CV) scrip 544569 (10 Nov 2025): https://www.bseindia.com/markets/MarketInfo/DispNewNoticesCirculars.aspx?page=20251110-13
- BSE listing notice Jio Platforms (27 Oct 2026): https://www.bseindia.com/downloads/UploadDocs/Notices/20261027-9/20261027-9.pdf
- CARO 2020 text: https://indiacode.ecourtsindia.com/rules/0f2412cc/ ; Schedule III amendment summary (MCA GSR 207(E), 24 Mar 2021): https://www.optivida.co.in/guides/schedule-iii-financial-statements-format
- Reg 46 / Sch III item 15 transcript timelines: https://ca2013.com/lodr-regulation-46/
- Results-week calendar: https://quarterlyresults.in/blog/q2-results-week-9-15-nov-2026/ ; corporate actions week of 9–13 Nov: https://economictimes.indiatimes.com/markets/stocks/news/bonus-stock-splits-dividends-dabur-india-hul-ongc-among-76-companies-turning-ex-record-date-this-week/articleshow/135652129.cms
- Auditor-resignation filings (Oct–Nov 2026): Hexa Tradex https://nsearchives.nseindia.com/corporate/HEXATRADEX_03112026170454_ResignationofstautoryauditorSE.pdf ; Neelkanth Rock-Minerals https://www.bseindia.com/xml-data/corpfiling/AttachLive/96c079ce-60e2-4cd4-a90d-738f62c4004e.pdf
- CFO-resignation filings (Nov 2026): Carysil (via oquilia.com), Upsurge, Msafe, Riba Textiles (BSE AttachLive), ADL (NSE archive).
- SEBI vs Rajesh Exports confirmatory order (14 Oct 2026): https://www.etnownews.com/markets/sebi-confirms-interim-directions-against-rajesh-exports-retains-restrictions-on-chairman-rajesh-mehta-article-156341049
