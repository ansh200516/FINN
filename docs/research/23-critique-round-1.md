# 23 — Critique round 1

Independent read of the product that is built, 8 Nov 2026. No product code was changed. The database was opened read-only (`file:data/finn.db?mode=ro`). Figures below are from that file or from the arithmetic in `src/engine/analyse/results.ts` and `src/engine/analyse/ledger.ts` applied to those rows. Nothing here was checked against the exchange PDF, so a rupee figure that only matches the stored row is **internally consistent, not verified against the filing**. No phone pass was run, so first-paint time and any spinner are **unverified**. Deploy access (Vercel, Turso, GitHub) is ignored.

The screen under test is the brief (`src/app/page.tsx` → `getBriefView`), the results grid (`attachResultsCards` → `computeResultsCard`), and the company page (`getCompanyPage` in `src/lib/queries.ts`). The company page reads stored `guidance` rows. It does not call `settleGuidance`, so that function’s `sourceNote` never reaches the UI. An uncommitted edit on the company page does call `transcriptCoverage` and can show “Transcript pending · expected by …”. The documents list still labels `cover_only` and `duplicate` as “fetch pending”.

## Scores

Weights from `docs/research/09-adversarial-evaluation.md` §5. Weighted average **3.25** (26 / 8).

| Dimension | Weight | Score |
|---|---:|---:|
| Creativity / point of view | 1.0 | 4 |
| Product sense | 1.0 | 4 |
| Judgment / prioritisation | 1.0 | 3 |
| Architecture & efficiency | 1.0 | 4 |
| Correctness / grounding | 1.5 | **1** |
| Mobile UX & density | 1.0 | 3 |
| Demo reliability | 1.5 | **3** |
| Communication | 1.0 | 2 |

**Gate: do not submit.** Correctness is 1 and reliability is 3. Both are below 4.

Correctness is capped at 1 because settled ledger rows display a delivered figure that is not the quantity in the quote, then label it Beat or Miss. The cap in §5.1 is a wrong headline number. These rows are the headline of the pull workflow. The Reliance results grid, separately, matches its stored quarter (see below) and is not the thing that trips the cap.

The 8-second spinner cap on reliability is **not applied**. It was not observed. Ask can still sit on “Asking…” for up to `maxDuration = 60` (`src/app/api/ask/route.ts`).

## What the database holds

`guidance` has no `is_explicit` column. The flag is `evidence_json.isExplicit`.

| Query | Result |
|---|---|
| Companies with zero guidance | **ITC, TRENT** (both ad-hoc; also 0 quarters and 0 prices) |
| `isExplicit` false / true / missing | **149 / 389 / 1** (539 rows) |
| Verdict × status | open, verdict null **334**; superseded, verdict null **91**; unverifiable settled **66**; raised superseded **15**; cut superseded **13**; beat settled **9**; kept settled **5**; missed settled **4**; not_addressed **1**; withdrawn **1** |
| `text_status` in the asked set | cover_only transcripts **23**; failed transcripts **5**; pending annual report **1** (INFY FY26, pages null); duplicate transcripts **4** (HDFCBANK, INFY, RELIANCE, SUPREMEIND, each Q2FY27) |

`isExplicit: false` is not given kept / beat / missed, except one Bajaj Finance `raised` on “double-digit growth” (`low` 10, unit `%`). Adjectival rows are mostly left open (90) or unverifiable (29). That part of the rule is holding.

Portfolio flag `in_portfolio=1` is 21 names (the decision list’s HAL is absent; VOLTAS and INOXWIND are in). `getDemoUser` unions the demo user’s 11 ISINs with that flag, so the brief is 21 names. Research sections are six `page_map` rows. `facts` is empty.

## Spot-check: eight settled rows

Delivered rupees are the stored `evidence_json.delivered.value`. Crore is rupees / 1e7. “Recomputed” means `computeDelivered` on `results_quarters` for that horizon. Quotes were searched in `document_pages`.

| # | Row | Quote (abridged) | Promised | Delivered | Verdict | Check |
|---|---|---|---|---|---|---|
| 1 | SUPREMEIND revenue FY26, page 13 | “maintaining 11,000 crores to 11,500 crores” | 1.10e11–1.15e11 INR | 112,176,800,000 INR (₹11,217.68 cr), consolidated | kept | Quote is on the cited page. Band and ±3% rule agree. **Consistent.** |
| 2 | LT ebitda_margin FY26 | “full year EBITDA margin target of 8.5%” | 8.5% | 10.197% | beat | Quote is on the cited page. Recompute matches. **Consistent with the stored quarters. Not checked against the PDF.** |
| 3 | PIIND ebitda_margin FY26 | “hold ourselves … 25% to 26” | 25–26% | 25.315% | kept | Quote is on the cited page. **Consistent with the stored quarters.** |
| 4 | INFY ebitda_margin FY26, cited page 3 | “operating margin guidance … remains the same at 20% to 22%” | 20–22% | 20.922% | kept | 20.922% is EBIT / revenue on the four FY26 consolidated quarters. EBITDA / revenue on the same rows is 23.666%, which would be a beat. The IT-services EBIT reading is what was stored. The quote is on pages **4 and 21**, not page 3. |
| 5 | AMBER revenue FY26, page 12 | “Power-One is expected to deliver … INR265 crores to INR275 crores” | 2.65e9–2.75e9 INR (₹265–275 cr) | 121,864,766,000 INR (₹12,186.48 cr), company consolidated | beat | Crore→rupee conversion is ×1e7. The actual is the company, not Power-One. **Wrong Beat.** |
| 6 | DIXON revenue FY26, page 17 | “revenue should be in the range of INR1,500-odd crores” — the question was about IT and hardware | 1.50e10 INR (₹1,500 cr) | 488,728,000,000 INR (₹48,872.8 cr) | beat | Same company-revenue actual. A second Dixon beat is exports (“closing at almost INR5,500 crores, INR6,000 crores”) against that same ₹48,872.8 cr. **Wrong Beat.** |
| 7 | VEDL ebitda FY26, page 8 | “delivering record EBITDA in FY26, surpassing $6 billion” | 6e9 **USD** | 357,400,000,000 **INR** (₹35,740 cr) | beat | `compareBand` treats 3.574e11 and 6e9 as the same scale. **Wrong Beat.** No FX conversion is in the row. |
| 8 | BAJFINANCE revenue_growth FY26, cited page 3 | “AUM growth will gravitate between 22% and 23%” | 22–23% | revenue growth 18.429% | missed | The quote is on page **4**. The metric stored is revenue growth. **Wrong Miss.** |

KALYANKJIL is the same pattern outside this eight: “Candere … revenue target … INR500 crores” stored as ₹500 cr, delivered company revenue 357,428,600,000 INR (₹35,742.86 cr), verdict beat.

Of the 18 kept/beat/missed rows, company-level ones can be right (Supreme revenue, L&T margin, PI margin, and Inox Wind’s “over INR 5,000 crore” / “over 35%” against delivered ₹4,397.12 cr and 23.61% growth, both missed). The failures are scope and unit, not a broken crore conversion.

## Spot-check: two results cards

Both results events store a filing card with no `rows` array. `attachResultsCards` (`src/lib/queries.ts`) therefore calls `computeResultsCard(quarters, "consolidated")` first. The company snapshot uses the same preference: if any consolidated quarter exists, that series is the headline (`getCompanyPage`).

### RELIANCE — consolidated, period end 2026-09-30, source `xbrl`

Identities on that row: 6 checked, none failed, warnings empty. Exceptional items are 0, so PBEIT equals PBT and the company-page EBITDA (PBEIT + finance + D&A − other income) equals the card.

| | Rupees | ₹ cr | QoQ | YoY |
|---|---:|---:|---:|---:|
| Revenue | 3,328,610,000,000 | 3,32,861 | 6.74% | 28.57% |
| EBITDA (ex other income) | 566,160,000,000 | 56,616 | 19.15% | 23.39% |
| PBT | 386,130,000,000 | 38,613 | 26.06% | 32.58% |
| PAT | 295,500,000,000 | 29,550 | 27.39% | 33.76% |

EBITDA = 386,130 + 84,810 + 153,150 − 57,930 million rupees = 566,160 million. QoQ/YoY are `pctChange` against 2026-06-30 and 2025-09-30 on the same basis. The filing’s own H1 (`checks_json.ytd`, 183 days) matches Q1+Q2 to the rupee: revenue 6,447,110,000,000, PBT 692,430,000,000, PAT 527,460,000,000. **Not verified against the PDF.** The grid then prints integer crores once the figure is ≥ 100 (`fmtCr`), so 3,32,861 stays 3,32,861.

### HDFCBANK — the card shows consolidated 2026-09-30, not standalone

`variant` is `bank`, so EBITDA is null and the grid is NII / PPOP / PBT / PAT. `dna` is null. Identities on the consolidated row: 5 checked, none failed. The row’s warning says minority interest of ₹837.06 cr is booked as a negative exceptional above PBT, and `pbtBeforeMinority` is 286,625,400,000 (₹28,662.54 cr). The shown PBT is the after-that-line figure.

| | Consolidated (shown) | Standalone (stored, not the headline) |
|---|---:|---:|
| NII | ₹44,464.20 cr | ₹34,619.18 cr |
| PPOP | ₹32,871.54 cr | ₹29,483.42 cr |
| PBT | ₹27,825.48 cr | ₹25,909.80 cr |
| PAT | ₹20,700.03 cr | ₹19,509.96 cr |

Consolidated percentages the card would emit: NII QoQ 3.53% / YoY 10.46%; PPOP 6.05% / 6.24%; PBT 2.33% / 7.41%; PAT 1.56% / 5.55%. QoQ PAT uses Q1 consolidated PAT of ₹20,382.69 cr. That Q1 figure is ₹1,137.98 cr above `patOwners` (₹19,244.71 cr). Q1 `nci` is the same ₹1,137.98 cr.

H1 check on the consolidated row fails, and the screen hides it:

- Sum of Q1+Q2 PBT ₹55,018.64 cr vs filing YTD ₹53,880.66 cr.
- Sum of Q1+Q2 PAT ₹41,082.72 cr vs filing YTD ₹39,944.74 cr.
- NII and the revenue line match YTD exactly (NII 874,139,000,000).
- Q1 `patOwners` + Q2 PAT = the YTD PAT exactly (399,447,400,000).

`ytdCheck` would return `h1Check: false`. `ResultsGrid` renders the “Q1 + Q2 = H1” chip only when that flag is true, and it never renders `verification.notes`. The “Exchange XBRL verified” chip is `source !== "pdf"` (`checksum` in `buildResultsCard`, and again in `getCompanyPage`). A failed half-year still wears the verified chip. `selectBasis` in `results.ts` would have chosen standalone for a bank. The page never calls it.

The consolidated rupees match the stored row. They were **not** checked against the PDF. The standalone rupees are also only the stored row.

## Five defects

### 1. Settled rows compare a different quantity, then say Beat or Miss

`scopeOf` in `ledger.ts` returns `"company"` unless a keyword list hits. Power-One, Candere, “transactional income”, exports, and “IT and hardware” are not in that list. `compareBand` then scores the company consolidated actual. USD is compared with INR as if the units matched (Vedanta, row 7). Bajaj’s AUM sentence is stored as `revenue_growth` (row 8).

These are on screen. Amber, Kalyan, and Bajaj are in the portfolio. Dixon and Vedanta are ad-hoc and open from the company route. This is the cap on Correctness.

### 2. The HDFC headline is the consolidated print, and a failed H1 check is shown as verified

`attachResultsCards` forces consolidated. The company snapshot does too. The engine’s own bank rule (`selectBasis`) is unused on that path. The numbers a reader meets are NII ₹44,464.20 cr and PAT ₹20,700.03 cr, while the same table holds standalone NII ₹34,619.18 cr and PAT ₹19,509.96 cr. The half-year PBT/PAT gap of ₹1,137.98 cr is the Q1 minority interest, and the UI drops the failure on the floor (`src/ui/ResultsGrid.tsx` shows the H1 chip only on success).

### 3. Cover letters still look like a fetch that has not happened

`settleGuidance` returns `coverage` and `sourceNote` (cover letter only, or annual-report-only). The company page never renders `sourceNote`. The working tree adds `loadTranscriptPendingBy`, which reads `transcriptCoverage` and prints a single expected-by line, and it hides that line when the pending period is cover-letter-only and a recovered document id is set. The documents accordion is unchanged: anything other than `ok` or `failed` is “fetch pending” (`src/app/c/[symbol]/page.tsx`). That string covers 23 `cover_only` transcripts and 4 duplicates. INDUSINDBK, LT, and VEDL each have a one-page cover letter beside a real transcript for the same period. THERMAX’s only `ok` transcript is Q4FY26; the other five quarters are `failed` plus `cover_only`. RELIANCE has 9 guidance rows: 8 open, 1 unverifiable. The name a grader knows has no settled promise.

### 4. Ask checks quotes and lets the answer’s numbers through

`groundCitations` in `src/lib/ask.ts` drops a quote that is not an exact span, and drops an unknown ref. The answer string is returned as the model wrote it. There is no number check. `facts` has 0 rows, so there is no fact store under the answer. The corpus is two results cards, up to 40 guidance rows, and six keyword-matched pages. An empty corpus does return “That is not in the filings.” A non-empty one can still state a figure that is not in the excerpts. The button stays on “Asking…” until the model returns, with a 60s server budget.

### 5. The cited page is often the previous page, and the HDFC CEO card has no profile

INFY’s 20–22% quote is cited on page 3 and found on pages 4 and 21. Bajaj’s AUM quote is cited on page 3 and found on page 4. Dixon’s “INR5,200 crores” line is cited on page 13 and found on page 14. Inox Wind’s kept-margin sentence (“20-22%”) is cited on page 3 and is not a contiguous span of that page.

Separately, the tier-1 HDFC card for Mr. Anup Bagchi (MD & CEO) has `bio.profileExcerpt` length 0 and `confidence: low`. Eight other tier-1 management cards do carry an excerpt (IDEA’s Manoj Murali is 833 characters, from the filing URL stored on the card). The Bagchi card is the one a grader who follows this bank will open, and the body falls through to “no brief profile in the filing beyond name and role.”

## What is actually strong

The brief is a point of view, not a chat home. `src/app/page.tsx` is a windowed edition: needs-you, worth-knowing, a filed-away fold, an end-of-edition line, a holiday line, and Muhurat called out. Every priced name has 2026-11-08 stored as `session_type=special` (27 names; ITC and TRENT have no bars). The results path is deterministic XBRL, and for Reliance the quarter identities and the H1 checksum pass to the rupee. Banks and NBFCs are a different grid (NII/PPOP, EBITDA null) when the variant flag is set. Guidance extraction is mostly Flash-Lite (214 requests on 8 Nov PT) with Flash at 5. The verbatim gate is real: the bad verdicts above are real sentences from the transcripts, paired with the wrong actual. Company-level bands can come out right (Supreme, L&T, PI).

## Fixes, in grade order

1. **Correctness off the cap (1 → about 3).** Before a kept/beat/missed write, require company scope, the same unit on both sides, and a metric the quote actually names (AUM is not revenue, a brand is not the company, USD is not INR). Otherwise store unverifiable and show the quote. Re-settle the 18 judged rows. Supreme, L&T, PI, and the Inox “over ₹5,000 cr / over 35%” rows can stay.
2. **Correctness toward 4.** Call `selectBasis` for the card and the company snapshot, so a bank headline is standalone when that row exists. Render `h1Check === false` and the note. Do not show “Exchange XBRL verified” when the half-year fails. For HDFC that puts NII ₹34,619.18 cr, PPOP ₹29,483.42 cr, PBT ₹25,909.80 cr, PAT ₹19,509.96 cr on the card, and it stops adding Q1’s ₹1,137.98 cr of minority interest into the half-year.
3. **Reliability and trust.** The expected-by line does not replace `sourceNote`, and it does not relabel the document row. Say `cover_only` and `duplicate` in the documents list. Put a settled, company-level row on a name the grader knows; Reliance currently has none.
4. **Reliability toward 4.** Bound Ask so a wait cannot run to 60s unlabeled, or serve a cached answer. The 8s cap is unverified until someone times a phone. Do not put NSE or a model on the brief request path (that part is already true unless `FINN_REFRESH_ON_VISIT=true`).
5. **Communication 2 → 3.** The README states the point of view and how to run. It still needs the routing table with the measured ledger (Flash-Lite 214, Flash 5, on 8 Nov PT), what is cached versus live, and the failure modes in this note: segment guidance, bank basis, cover letters, page-index off by one.
