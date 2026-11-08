# 29 — Critique round 7

Read-only, 9 Nov 2026, `file:data/finn.db?mode=ro`. Gates: `docs/research/09-adversarial-evaluation.md` §5 and §5.1. After `099ff76`.

| Dimension | Score |
|---|---:|
| Correctness / grounding | **4** |
| Demo reliability | **4** |

**Gate: open.** Both are 4. The checked headlines match the quoted line, so the §5.1 cap stays off. The level-5 list (checksum on screen, red-team note, every Pull sentence) waits for a later pass.

## Dixon

`g_079a7f335142955ea51d`, open. “without the Vivo also, the company will keep growing at almost 15% to 17%.” Verdict empty. No interim key. Delivered value null. 34.9% is gone.

`g_b3ad15d04cb3a7428c1d`, open. “INR56,000 crores without the Vivo numbers.” Verdict empty. Interim ₹37,341.3 cr, 2 of 4 quarters of FY27.

₹37,341.3 cr is the same quantity as that promise. The sentence before is “Without the Vivo numbers, this year, we closed at almost INR48,800-odd crores.” Stored FY26 consolidated revenue is ₹48,872.8 cr. The Q2 FY27 call says “Consolidation of Vivo operations is expected to commence from Q4.” Year-to-date is Q1 ₹15,547.66 cr plus Q2 ₹21,793.64 cr, before that start. The question asked for turnover on the ₹47,000–48,000 cr close. Ex-Vivo and the reported line are one perimeter until Q4.

## Other rows

Kept, missed, cut, and open rows that print a company revenue, EBITDA, PAT, margin, or growth figure were read with the quote, the question, and the previous sentence. Only the Dixon rupee quote names an excluded business, and ₹37,341.3 cr is that ex-Vivo line. Cut rows for Sidwal, “this division”, Dixon telecom, and Supreme piping store no delivered value. KPIT `g_a40e9966e00413a6a8ad`, “EBITDA 20.5 to 21.2 post increasing investment in AI solutions and products…”, still shows 16.5%. The stored quote names the company margin. Recomputed settled headlines match the consolidated line: Inox Wind FY26 revenue ₹4,397.12 cr and 23.6% growth, both missed on “consolidated revenue of over INR 5,000 crore” and “over 35%”; Supreme FY26 revenue ₹11,217.68 cr, kept inside ₹11,000–11,500 cr.

## Reliability

No new spinner. Ask still says “Reading SYMBOL’s filings”, then after 8 seconds “Still reading the filings. This can take a minute.” Score 4.
