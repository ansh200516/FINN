# 28 — Critique round 6

Read-only, 8 Nov 2026, `file:data/finn.db?mode=ro`. Gates: `docs/research/09-adversarial-evaluation.md` §5 and §5.1.

| Dimension | Score |
|---|---:|
| Correctness / grounding | **1** |
| Demo reliability | **4** |

**Gate: closed.** Both must be ≥ 4.

## Cleared

L&T `g_a844f149c049e92643ad`, unverifiable. “full year EBITDA margin target of 8.5%.” The sentence before names the P&M business. Delivered null, interim absent. 10.2% is gone.

L&T `g_2febed08013a0efb02d2`, open. “guiding a stable margin profile for FY'27.” Scope is projects, products and manufacturing. Delivered null, interim absent. The 7.8% sentence `g_35f9a3a3e6b48eff854c` is unverifiable, no number. 8.8% is gone.

Reliance `g_7705fa93ee3e104a7e9b`, open. “we hope that this will continue.” Scope sports business. Delivered null, interim absent. 27.0% is gone.

Inox Wind `g_89c7f27bb275208b3d22`, open. “folding into Inox Green's balance sheet… upwards of INR600 crores.” Delivered null, interim absent. ₹152.49 cr is gone. Consol margin stays kept: `g_b4c0c099208b92e09bfe`, “20-22%”, delivered 20.3%.

Bajaj `g_a0b5a160315469876a63`, open. “between 26%, 27% growth we should deliver now on a full year basis.” Delivered null, interim absent. 20.2% is gone.

## Still printed

Dixon `g_b3ad15d04cb3a7428c1d`, open. “INR56,000 crores without the Vivo numbers.” Delivered null. Interim ₹37,341 cr, FY27 year-to-date.

Dixon `g_079a7f335142955ea51d`, open. “without the Vivo also, the company will keep growing at almost 15% to 17%.” Delivered null. Interim 34.9%, company revenue growth.

KPIT `g_a40e9966e00413a6a8ad`, open. “EBITDA 20.5 to 21.2 post increasing investment in AI solutions and products…” Delivered null. Interim 16.5%. Q2 says 17.8%. Same company margin.

Only the Dixon lines are a different quantity. No beat remains. §5.1 caps Correctness at 1.

## Reliability

“Asking…” is gone. The wait is “Reading SYMBOL’s filings”, then after 8 seconds “Still reading the filings. This can take a minute.” The fetch is not aborted. Failure is “The ask failed.” Timeout is “The ask timed out.” A receipt is not a spinner, so the 8-second cap does not apply. Score 4. A live model call keeps it off 5.

## Next fix

Drop the company interim on the ex-Vivo growth line. “without the Vivo also, the company will keep growing at almost 15% to 17%.” So far 34.9%.
