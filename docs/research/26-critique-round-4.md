# 26 — Critique round 4

Read-only, 8 Nov 2026, `file:data/finn.db?mode=ro`. Stored guidance and the snapshot code. Ask was not timed.

## Scores

Gates: `docs/research/09-adversarial-evaluation.md` §5 and §5.1.

| Dimension | Score |
|---|---:|
| Correctness / grounding | **1** |
| Demo reliability | **3** |

**Gate: closed.** Both must be ≥ 4.

## Beardo

`g_cffb12750cd5d82a2d34` is open. Verdict is null. Note: “due after 2027-03-31”. Delivered value is null. `interim` is absent. ₹7,854 cr is not in the row. Scope is `brand`.

## Other named quantities

No quote that names a product, brand, division, or a non-INR currency stores a consolidated INR revenue, EBITDA, or PAT figure as delivered or interim.

## Company interim kept

Inox Wind `g_89c7f27bb275208b3d22`, “upwards of INR600 crores”, interim ₹152.49 cr. Marico `g_6c3009f9d896810913fc`, “cross INR15,000 crore”, interim ₹7,854 cr. The other two ₹15,000 cr revenue rows carry the same interim.

## What keeps the cap

Open rows still print a company year-to-date figure beside a different promise. Bajaj Finance: “a 25 to 40 basis point improvement in FY27 on opex-to-NTI”, so far 70.8% (company EBITDA margin). Vedanta Copper “at least 5%” shows 36.4%. Amber railway 16–17% shows 8.0%. Fluoropolymers 17–20% shows 34.4%. Nuvama offshore 5–7% shows 21.5%.

§5.1 caps Correctness at 1.

## Snapshots

`snapshotChip` follows `resultsVerified`, which is false when `h1Check === false`.

HDFC Bank consolidated 2026-09-30: identities pass. Q1+Q2 PBT ₹55,018.64 cr vs YTD ₹53,880.66 cr; PAT ₹41,082.72 cr vs ₹39,944.74 cr. The ₹1,137.98 cr gap equals Q1 minority interest. The half-year check fails closed.

Reliance consolidated 2026-09-30 matches YTD to the rupee (revenue 6,447,110,000,000; PBT 692,430,000,000; PAT 527,460,000,000). Identities pass. The chip is “XBRL verified”.

## Reliability

`/api/ask` `maxDuration` is 60. The gateway timeout is 60 seconds, then one retry. The fetch has no abort. The request was not timed, so reliability stays 3.

## Next fix

Drop the company interim when the quote is another metric or a named business. Bajaj keeps the cap: “25 to 40 basis point improvement in FY27 on opex-to-NTI”, so far 70.8%.
