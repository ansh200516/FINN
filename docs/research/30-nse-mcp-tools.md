# 30 — NSE MCP tools

Read of https://www.nseindia.com/nse-mcp on 10 Nov 2026, then `initialize` (protocol `2025-06-18`) and `tools/list` on every server the page publishes. The HTML and the page bundle contain two URLs and no others. There is no analysis, corporate, debt, or derivatives MCP server.

| Server | Name the page uses | URL | `serverInfo` | Tools |
| --- | --- | --- | --- | --- |
| End of day | nse-bhavcopy | `https://mcp.nseindia.in/bhavcopy/cm/mcp` | `nse-bhavcopy-redis-mcp` 1.0.0 | 21 |
| Delayed market | cm-market | `https://mcp.nseindia.in/cmmkt/mcp` | `cm-market-mcp` 1.0.0 | 15 |

**36 tools.** Each list came back in one response, with no `nextCursor`. Names below are the ones `tools/list` returned, not the marketing labels.

The page's "which stocks contributed to Nifty" line is not a tool. `get_index_movers` ranks indices. Nothing returns announcements, board meetings, results metadata, shareholding, index constituents, or delivery quantity. Those holes stay with the filings FINN already stores (announcements, including board-meeting intimations, and XBRL). Equity OHLCV is already in `prices` from the NSE bhavcopy. An MCP close does not replace it, and an MCP number does not replace an XBRL figure or a ledger verdict.

## Wired (5)

Rules in the composer. One card. Source line starts with NSE. A failed call is one sentence: "NSE's live feed did not answer." on the delayed server, "NSE did not answer." on the end-of-day server, "NSE did not list that index for that date." when the snapshot's filter also matched a neighbour and the exact name was absent.

| Tool | Question | What the card keeps |
| --- | --- | --- |
| `cm_get_stock_quote` | live price | last and percent change |
| `cm_get_index_quote` | live index | last and percent change. Week, month, and year comparisons on the payload are not printed |
| `cm_get_data_status` | is the market open | the feed has no open flag; the note is the crawl time |
| `get_corporate_actions` | corporate actions, or splits and bonuses | latest of each action type, at most three. A split-or-bonus question does not print a dividend. Adjustment factors are not printed |
| `get_index_snapshot` | one index on one date | that index's close and percent change. P/E, P/B, and dividend yield are not printed. `Nifty 50` is not allowed to become `Nifty 500` |

`get_index_history` is the series. A single date uses the snapshot, so the history tool is not wired.

### Samples from live calls on 10 Nov 2026

`cm_get_stock_quote` RELIANCE. `lastTradedPrice` 1324.4, `perChange` 0.03, `latestTimestamp` `2026-11-09 16:00:27`.

> RELIANCE ₹ 1,324.40, up 0.03%.
> NSE · 09 Nov 2026 16:00

`cm_get_index_quote` NIFTY 50. `last` 25044.65, `percChange` 0.23, `nseTimestamp` `09-Nov-2026 15:30:00`. The payload also had one week +6.84% against 02 Nov 2026. That comparison is not on the card.

> NIFTY 50 25,044.65, up 0.23%.
> NSE · 09 Nov 2026 15:30

`cm_get_data_status`. Gainers `lastCrawled` `2026-11-09T19:53:17.177551372Z`. No open or closed field.

> NSE does not publish whether the market is open.
> NSE · last crawl 10 Nov 2026 01:23 IST

`get_corporate_actions` RELIANCE, `fromDate` 2021-11-10, `toDate` 2026-11-10. `count` 7: dividends (Rs 8, 9, 10, 5.5, 6), Demerger ex-date 2023-07-20, Bonus 1:1 ex-date 2024-10-28 (`adjustmentFactor` 0.5). The card keeps the latest dividend, the bonus, and the demerger.

> RELIANCE dividend ₹ 6 a share, ex-date 05 Jun 2026. Bonus 1:1, ex-date 28 Oct 2024. Demerger, ex-date 20 Jul 2023.
> NSE · 7 actions

`get_index_snapshot` `date` 2026-11-09, `filter` `NIFTY 50`. The body also included Nifty 500 (close 23,567, P/E 22.11) because the filter is a substring. Nifty 50 close 25,044.65, `pctChange` 0.23, P/E 20.48. The card uses the exact name and drops the ratios.

> NIFTY 50 25,044.65, up 0.23%.
> NSE · 09 Nov 2026

## End of day — `https://mcp.nseindia.in/bhavcopy/cm/mcp`

| Tool | Purpose | Inputs | Verdict |
| --- | --- | --- | --- |
| `get_top_by_volume` | Most traded names on a date, by shares or turnover | `date`, `n`, `sortBy` | skip — whole-market ranking, not a company fact the desk is missing |
| `get_top_movers` | Top gainers or losers on a date | `date`, `n`, `direction` | skip — whole-market ranking; a bonus ex-date looks like a crash |
| `nse_lookup_symbol` | Tickers matching a partial name, no price | `query` | skip — the book already resolves a name to a symbol |
| `get_market_mood` | India VIX plus a fixed reading such as broad advance or mixed | `date` | skip — the reading is a label, not a filing |
| `get_index_valuation` | Index P/E, P/B, dividend yield, and where they sit in a window | `indexName`, `months`, `date` | skip — the percentile would stand in as a valuation beside filings |
| `get_market_breadth` | Advances, declines, unchanged, and the A/D ratio | `date` | skip — a market-wide count, not one of the missing company facts |
| `get_corporate_actions` | Splits, bonuses, dividends, and other events with ex-dates | `symbol`, `fromDate`, `toDate` | use — those ex-dates are not a table; the card quotes the event, not XBRL |
| `compare_indices` | Return, volatility, drawdown, and valuation for 2–10 indices | `indexNames`, `months`, `date` | skip — calculated comparison, not a single official close |
| `get_index_movers` | Indices that gained or lost the most over a period | `date`, `period`, `n`, `scope` | skip — this is not index constituents |
| `get_ltp_by_date` | Close for one symbol on one date | `symbol`, `date` | skip — equity closes are already stored from the NSE bhavcopy |
| `get_bulk_quote` | Latest end-of-day snapshot for up to 50 symbols | `symbols` | skip — duplicates the live quote and the stored bar |
| `get_volume_analysis` | Average volume, spike days, and a five-day trend | `symbol`, `days` | skip — spike maths; volume alerts already use the stored series |
| `get_stock_history` | Daily OHLCV, up to three months a call, unadjusted | `symbol`, `months`, `endDate` | skip — that series is already stored from the NSE bhavcopy |
| `get_index_snapshot` | End-of-day open, high, low, close, change, and ratios for indices | `date`, `filter` | use — index levels are not stored; the card prints close and change only |
| `search_symbols` | Name search with the latest close and percent change | `query` | skip — the book already maps names, and the price duplicates the quote |
| `get_stock_vs_index` | Return, outperformance, beta, and correlation versus an index | `symbol`, `indexName`, `months`, `date` | skip — beta and correlation would replace a filing number with a model number |
| `compare_stocks` | Ranked return and max drawdown for up to 10 symbols, unadjusted | `symbols`, `months` | skip — a bonus inside the window distorts the return |
| `get_index_history` | Daily index history, up to 12 months a call, including P/E | `indexName`, `months`, `endDate` | skip — a series is not one card; one date uses the snapshot |
| `moving_average` | Simple moving average of the close versus the latest close | `symbol`, `days` | skip — a calculated indicator, not an exchange fact |
| `get_52_week_high_low` | 52-week high and low from unadjusted prices, plus distance | `symbol` | skip — a bonus in the year invents a false low |
| `get_index_performance` | 1-week through 2-year returns and a 52-week range | `indexName`, `date` | skip — multi-horizon returns are calculated |

## Delayed market — `https://mcp.nseindia.in/cmmkt/mcp`

| Tool | Purpose | Inputs | Verdict |
| --- | --- | --- | --- |
| `cm_get_live_market_data` | Live gainers or losers (`loosers` is the server's spelling) | `index` | skip — intraday board, not a company fact |
| `cm_get_equity_stocks` | Live rows for equity series, optionally filtered by prefix | `limit`, `symbolFilter` | skip — a bulk dump, not one card |
| `nse_get_losers` | Top losers by percent, flattened across indices | `limit` | skip — intraday ranking |
| `cm_get_call_auction_stocks` | Live call-auction series CA and CB | `limit`, `symbolFilter` | skip — a market this desk does not cover |
| `cm_get_bond_stocks` | Live bond and debt series | `limit`, `symbolFilter` | skip — debt is a market this desk does not cover |
| `cm_get_live_gainers` | Raw gainers grouped by index segment, unsorted | none | skip — the server says this is the wrong tool for "top gainers" |
| `nse_get_gainers` | Top gainers by percent | `limit` | skip — intraday ranking |
| `cm_get_data_status` | When gainers and losers were last crawled | none | use — freshness only; the body still has no open flag |
| `cm_get_stock_quote` | Live quote for one symbol | `symbol` | use — the delayed cash price |
| `cm_get_index_quote` | Live quote for one index, plus older comparisons | `indexName` | use — last and percent change only |
| `cm_get_sme_stocks` | Live SME series SM and ST | `limit`, `symbolFilter` | skip — SME is a market this desk does not cover |
| `cm_get_live_losers` | Raw losers grouped by index segment, unsorted | none | skip — raw board, not a company fact |
| `cm_get_live_indices` | Live values for about 140 indices, including a derivatives group | `group`, `nameFilter` | skip — a bulk board, and one group is derivatives |
| `nse_get_market_movers` | Top gainers and losers, all securities or one index | `indexName`, `limit` | skip — intraday ranking |
| `cm_get_allstocks_status` | Freshness and segment counts for the all-stocks cache | none | skip — cache health, not a desk question |
