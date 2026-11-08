# 24 — Critique round 2

Read-only, 8 Nov 2026. Database `file:data/finn.db?mode=ro`. The company page shows stored `guidance` verdicts and does not call `settleGuidance`. Not checked against the PDF.

## Scores

Gates: `docs/research/09-adversarial-evaluation.md` §5 and §5.1.

| Dimension | Score |
|---|---:|
| Correctness / grounding | **1** |
| Demo reliability | **3** |

**Gate: closed.** Both must be ≥ 4. One wrong Beat keeps the §5.1 cap.

## Fixes that hold

Rewritten at 21:35 IST, verdict unverifiable, delivered null. Dixon “INR1,500-odd crores”, “INR5,500 crores, INR6,000 crores”, and “INR5,200 crores”: segment, not the company total. Vedanta “surpassing $6 billion”: currency mismatch. Bajaj Finance “AUM growth will gravitate between 22% and 23%”: metric mismatch. Amber Power-One “INR265 crores to INR275 crores”, Kalyan Candere “INR500 crores”, and Nuvama “transactional income … about 20% growth”: segment, not the company total.

`resultsVerified` is false when `h1Check === false`. HDFC consolidated 2026-09-30 is XBRL: Q1+Q2 PBT ₹55,018.64 cr vs YTD ₹53,880.66 cr, PAT ₹41,082.72 cr vs ₹39,944.74 cr. The gap is Q1 minority interest, ₹1,137.98 cr, so `snapshotChip` says **H1 check failed**. Reliance consolidated 2026-09-30 matches YTD to the rupee (revenue 6,447,110,000,000; PBT 692,430,000,000; PAT 527,460,000,000), so the chip stays **XBRL verified**.

`documentRowStatus("cover_only")` is “cover letter only”. Duplicates return null and are omitted. 23 cover letters and 4 duplicates remain.

## The Beat that remains

Nine settled kept/beat/missed rows. Eight match the stored FY26 company quarters.

Amber is in the portfolio. Page 7 asks how to read the year “from an RAC point of view.” The stored line is “we are hopeful to deliver about 14% to 15% kind of a growth.” Verdict **beat**, delivered company revenue growth **22.194%**, rule “above 15% + ±1pp”. It never says consolidated. `quantityIssue` scans only the quote, so “RAC” is missed. The same call’s “this division … 13% to 15%” was marked segment.

Kalyan “we will end Candere with PAT neutral” is unverifiable but still stores 13,503,950,000 INR (FY26 PAT ₹1,350.39 cr), last written at 20:24 IST. `SLICE_RE` now includes “candere”, so a full re-settle clears that figure only.

## Reliability

Ask still has `maxDuration = 60` and the button stays “Asking…”. That wait was not timed, so the 8-second cap is not applied. Reliability stays 3.

## Next fix

Re-settle Amber’s FY26 14–15% row as unverifiable: the question is RAC, and the actual is company revenue. Clear the Candere PAT figure in the same pass.
