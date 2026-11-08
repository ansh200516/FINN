# 25 — Critique round 3

Read-only, 8 Nov 2026, `file:data/finn.db?mode=ro`. Stored guidance only. PDF and Ask timing not checked.

## Scores

Gates: `docs/research/09-adversarial-evaluation.md` §5 and §5.1.

| Dimension | Score |
|---|---:|
| Correctness / grounding | **1** |
| Demo reliability | **3** |

**Gate: closed.** Both must be ≥ 4.

## The two rows

Amber `g_3930d1b9bf3ff023426e`, 22:24 IST. Quote: “we are hopeful to deliver about 14% to 15% kind of a growth.” No “RAC” in the quote. Verdict **unverifiable**, note “segment, not the company total”, scope `rac`, delivered null.

Kalyan `g_5ca991c04f51f3ca863d`, “we will end Candere with PAT neutral…”, is the same: unverifiable, scope `candere`, delivered null. ₹1,350.39 cr is gone.

## Kept / beat / missed / cut

The eight kept/beat/missed rows are company totals. Cut rows for Sidwal, “this division”, and Dixon telecom store no delivered value. No scored row matches a product, brand, division, or non-INR quote to consolidated INR revenue, EBITDA, or PAT. “Double-digit”, with no numeral, stays unscored.

## The number that remains

Open rows still store `evidence.interim`. The not-due branch leaves it, and the save spreads the old JSON first:

- Marico: “Beardo … cross INR400 crores this year.” So far ₹7,854 cr, company FY27 YTD.
- Amber: “this division … 30% to 35%.” So far 12.7% company revenue growth.
- Vedanta: “annual EBITDA of over $6 billion.” So far ₹18,416 cr.

§5.1 caps Correctness at 1.

## Snapshots

`resultsVerified` is false when `h1Check === false`, so `snapshotChip` does not say “XBRL verified”.

HDFC consolidated 2026-09-30: identities pass; Q1+Q2 PBT ₹55,018.64 cr vs YTD ₹53,880.66 cr, PAT ₹41,082.72 cr vs ₹39,944.74 cr. Gap ₹1,137.98 cr is Q1 minority interest. Chip: **H1 check failed**.

Reliance consolidated 2026-09-30 matches YTD to the rupee (revenue 6,447,110,000,000; PBT 692,430,000,000; PAT 527,460,000,000). Chip: **XBRL verified**.

## Reliability

Ask can sit on “Asking…” for 60s (`maxDuration` and the gateway timeout). No client abort. Not timed, so the 8-second cap is not applied. Score stays 3.

## Next fix

Clear `evidence.interim` on a quantity mismatch, including on merge. The Beardo line keeps the cap.
