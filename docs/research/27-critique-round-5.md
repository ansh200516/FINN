# 27 — Critique round 5

Read-only, 8 Nov 2026, `file:data/finn.db?mode=ro`.

## Scores

Gates: `docs/research/09-adversarial-evaluation.md` §5 and §5.1.

| Dimension | Score |
|---|---:|
| Correctness / grounding | **1** |
| Demo reliability | **3** |

**Gate: closed.** Both must be ≥ 4.

## Leftovers

The question lives in the analyst turn on `document_pages`.

Bajaj `g_a0b5a160315469876a63`, open. Quote: “between 26%, 27% growth we should deliver now on a full year basis.” Question: “what would be the growth guidance here onwards for near and medium term?” It does not say AUM. Delivered is null. Interim is 20.2% revenue growth. Later on the page: “26%, 27% loan growth guidance”, and Rajeev Jain agrees. The chain revises “20% to 24% AUM growth”, a different quantity.

Dixon `g_b3ad15d04cb3a7428c1d`, open. Quote: “INR56,000 crores without the Vivo numbers”. Delivered is null. Interim is ₹37,341 cr, FY27 year-to-date. The sentence before: “Without the Vivo numbers, this year, we closed at almost INR48,800-odd crores.” Consolidated FY26 revenue is ₹48,872.8 cr, the same line. The 15–17% line shows 34.9%.

## Cleared

Gone: Amber electronics 8.0% and consumer-durables 12.7%, Nuvama “20-25% here” 21.5%, Marico digital-brand 16.5%, Laurus generics 31.3%, KPIT “solution and products” 7.7%, and 8.8% on the sentence that says “PPM portfolio”.

## Still a different quantity

L&T `g_a844f149c049e92643ad`, beat. “Coming to the EBITDA margin for the P&M business… target of 8.5%.” Delivered 10.2%, company EBITDA margin.

L&T `g_2febed08013a0efb02d2`, open. Question: “Projects, Products and Manufacturing margin… The guidance again is 7.8%.” So far 8.8%.

Reliance `g_7705fa93ee3e104a7e9b`. Sports monetization: “we hope that this will continue.” So far 27.0% company revenue growth.

Inox Green `g_89c7f27bb275208b3d22`. “folding into Inox Green's balance sheet… upwards of INR600 crores.” So far ₹152.49 cr, Inox Wind EBITDA.

§5.1 caps Correctness at 1.

## Reliability

`/api/ask` `maxDuration` is 60. The gateway timeout is 60 seconds, then one retry. The fetch has no abort. No Ask timeout is under 8 seconds, and the request was not timed, so reliability stays 3.

## Next fix

Drop the company margin on the P&M line. “Coming to the EBITDA margin for the P&M business… target of 8.5%.” Delivered 10.2%.
