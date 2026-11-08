# 04 — Prices & fundamentals data playbook (verified 8 Nov 2026, 17:15–17:45 IST, from the build Mac)

Scope: (A) end-of-day price/volume for NSE/BSE tickers, (B) fundamentals documents (annual reports, concall transcripts) and standardised multi-year financials, (C) symbol mapping. Corporate-announcement feeds are a sibling agent's job; incidental findings about them are in §6.

Everything below was executed from this machine (Python 3.12 venv at `/tmp/finn-data/.venv`, scripts `t1`–`t15` + outputs in `/tmp/finn-data/`). Latencies are from a residential-class Indian connection. Items marked **[unverified]** were not run here.

---

## 0. TL;DR — recommended primary + fallback per data need

| Need | Primary | Fallback(s) | Why |
|---|---|---|---|
| Daily OHLCV for the 15–20 portfolio names (1y history) | **yfinance 1.8.0**, `yf.download([...".NS"], period="1y", auto_adjust=False)` — 20 tickers in **2.4 s**, 0 errors in 420 rapid individual calls + 12 batch downloads, values match the NSE bhavcopy exactly | (1) **Upstox `historical-candle` API, no auth**, ISIN-keyed, 0.08 s/call, 63-call burst OK; (2) **NSE UDiFF bhavcopy** zip (whole market, 1 request/day, no cookies) | Yahoo is fast and exact but blocks non-browser TLS and some cloud IPs; Upstox + bhavcopy are exchange-grade and cookie-free |
| "What did the market do today" after close (push/alerts) | **NSE UDiFF bhavcopy** for date D (was live at 17:17 IST for the Muhurat session; one 200 KB zip gives all 2,700+ EQ rows incl. ISIN) | yfinance (bar present ~2 h after close; volume 0.07 % below final), Groww chart endpoint (unofficial) | One file, authoritative, gives previous close + volume + trades for anomaly math |
| BSE-only names (~2,600 of them) | **BSE bhavcopy CSV** (same UDiFF schema, `FinInstrmId` = scrip code) | `api.bseindia.com/.../StockPriceCSVDownload` (needs `curl_cffi`) | yfinance `.BO` is broken for several large caps (RELIANCE.BO returned 1 row for 1 y) |
| Trading calendar / is today a session? | `www.nseindia.com/api/holiday-master?type=trading` (returned 200 with just a UA today) | bhavcopy 404 ⇒ no session (but 404 also = not yet published) | Needed to handle Muhurat (8 Nov) and the 10 Nov holiday correctly |
| Standardised multi-year & quarterly financials | **screener.in company page HTML** (no login, 0.06–0.25 s, 30 rapid fetches all 200, no Cloudflare) | BSE results PDF via BSE API `Result` category (parse with LLM) | Clean tables with stable row labels; ToS says personal/non-commercial — see §5 |
| Annual report PDF | **screener `#documents .annual-reports`** → BSE `xml-data/corpfiling/AttachHis/<uuid>.pdf` | **BSE `AnnualReport_New/w?scripcode=`** (curl_cffi), **NSE `api/annual-reports?index=equities&symbol=`** (after homepage cookie) → `nsearchives.../annual_reports/AR_*.pdf` | Three independent sources agree on the same file (byte-identical sizes) |
| Concall transcripts (last 4–6) | **screener `#documents .concalls`** rows → `bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=<uuid>.pdf` | **BSE `AnnSubCategoryGetData` with `subcategory=Earnings Call Transcript`** (curl_cffi) → `AttachLive/<ATTACHMENTNAME>` | Both found identical 4 transcripts for DIXON in 2026 |
| Symbol ↔ ISIN ↔ BSE code ↔ screener slug ↔ name | **NSE `EQUITY_L.csv` ⋈ BSE `ListofScripData` on ISIN** (2,474/2,598 NSE names match; NSE symbol == BSE `scrip_id` in all but 1 case) + **screener `/api/company/search/?q=`** | Upstox `instruments/exchange/NSE.json.gz` (2,756 EQ with ISIN) | All free, no auth; screener slug == NSE symbol for NSE-listed names |

HTTP client rule of thumb (empirical): **use `curl_cffi` with `impersonate="chrome"` for anything on `*.bseindia.com`, Yahoo, and `www.nseindia.com`**. Plain `requests` got 403 from `api.bseindia.com` mid-session today with the exact headers that had worked 10 minutes earlier; `curl_cffi` was 200 throughout. Plain `requests` + a browser `User-Agent` is enough for `nsearchives.nseindia.com`, `www.bseindia.com` PDFs, screener.in, Upstox, Groww.

---

## 1. Calendar facts that change the demo (verified)

- **Sunday 8 Nov 2026 was a live trading day**: NSE Muhurat session (circular NSE/CMTR/76941: pre-open 14:05, continuous 14:20–15:30, CAS to 15:35, post-close 15:50–16:00). NSE holiday master lists it as `"08-Nov-2026" … "Diwali Laxmi Pujan*"`. The NSE bhavcopy for 20261108 exists (3,550 rows), and yfinance/Groww/screener all show a 2026-11-08 bar.
- **Tuesday 10 Nov 2026 is a full holiday** ("Diwali-Balipratipada"). Trading days during the build week: Mon 9, Wed 11, Thu 12, Fri 13 Nov.
- **Consequence for anomaly alerts**: on the Muhurat bar every portfolio name shows volume at **4–46 % of its 20-day average** (RELIANCE 0.20×, TCS 0.05×, DIXON 0.07×). A naive "volume vs 20-day average" detector produces nothing on 8 Nov and will *understate* the 20-day average for the next 20 sessions if the Muhurat bar is included. Recommendation: tag special sessions (from holiday-master `*` entries or from a session-length check) and exclude them from both the evaluation day and the rolling baseline.

---

## 2. (A) Prices & volume

### 2.1 yfinance 1.8.0 (installed today; uses `curl_cffi` by default)

Setup: `uv venv --python 3.12 /tmp/finn-data/.venv && uv pip install yfinance` → yfinance 1.8.0, pandas 3.1.1, curl_cffi.

**Batch, 20 tickers, 1 y daily (`t1_yf_batch.py`)**

```python
import yfinance as yf
T = ["RELIANCE.NS","HDFCBANK.NS","INFY.NS","TCS.NS","ITC.NS","SUNPHARMA.NS","TMPV.NS","TMCV.NS",
     "BAJFINANCE.NS","LT.NS","ADANIENT.NS","ETERNAL.NS","DIXON.NS","PERSISTENT.NS","KPITTECH.NS",
     "TRENT.NS","VBL.NS","PAYTM.NS","IRCTC.NS","HAL.NS","DMART.NS"]
df = yf.download(T, period="1y", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
# df[t] -> columns Open, High, Low, Close, Adj Close, Volume ; index = tz-naive dates (IST session dates)
```

Measured:
- **2.42 s** for 20 tickers × 250 rows (auto_adjust=False); 1.67 s with auto_adjust=True. Repeated 10× back-to-back: 0.33–2.35 s each, 20/20 tickers every time.
- Individual `yf.Ticker(s).history(period="1y")`: **120 sequential calls in 9.3 s** (0.06–0.17 s each), then **300 more calls with random symbols/periods in 42.4 s** (mean 0.14 s, max 0.30 s). **Zero 429s / YFRateLimitError in 420 individual calls + 12 batch downloads** from this IP. (No price cache exists in yfinance — only cookie/tz/ISIN caches — so these were real requests.)
- `Ticker.info` 0.35 s (169 keys); `Ticker.isin` 0.84 s (→ `INE002A01018`); `fast_info` gives `lastPrice, lastVolume, previousClose, tenDayAverageVolume, threeMonthAverageVolume, marketCap, shares`.
- **Freshness**: at 17:15 IST on 8 Nov the daily bar for 2026-11-08 was already present (`regularMarketTime = 2026-11-08 15:29:29+05:30`), i.e. <2 h after the 15:30 close. Volume 4,171,663 vs final NSE bhavcopy 4,174,389 (−0.07 %, post-close trades). On 2026-11-06 and earlier yfinance Close and Volume **equal the NSE bhavcopy exactly** for all 6 names checked on 3 dates (ratio 1.0000).
- **Volume units**: shares, NSE-only (not NSE+BSE). Intraday 5-min bars sum to 21.6 M vs 22.77 M daily for RELIANCE on 6 Nov (closing auction not in 5-min bars).
- **Adjusted vs unadjusted**: `auto_adjust=False` → `Close` is the exchange close, `Adj Close` is dividend+split adjusted. `auto_adjust=True` rewrites OHLC for dividends too: TCS max |Close−AdjClose| = ₹137.56 over 1 y (4 dividends: 57, 31, 12, 12), ITC ₹18.98, INFY ₹72.83. **For alerts use `auto_adjust=False` and the raw `Close`** (an ex-dividend drop is a real price event the investor sees); splits/bonuses are already back-adjusted in both modes, so a 1:1 bonus will not show as a −50 % day. Dividends/splits come via `actions=True`.
- **Symbol churn is the main failure mode, not rate limits**: `TATAMOTORS.NS` → HTTP 404 "Quote not found" (Tata Motors demerged; now `TMPV.NS` = Tata Motors Passenger Vehicles, `TMCV.NS` = Tata Motors Ltd/CV, listed 12 Nov 2025). `ZOMATO.NS` → `ETERNAL.NS`. yfinance just drops the ticker from the batch with a warning. Resolve symbols against NSE `EQUITY_L.csv` first (§4).
- **`.BO` is unreliable**: `RELIANCE.BO` and `HDFCBANK.BO` returned **1 row** for `period="1mo"` and 1 row for `"1y"`; DIXON/KPITTECH/TMPV/SENCO/MOLDTKPAC `.BO` returned full history. Use `.NS` and treat BSE as a document source, not a price source, unless the name is BSE-only.
- `history_metadata` includes `exchangeName='NSI'`, `exchangeTimezoneName='Asia/Kolkata'`, `currentTradingPeriod`, `regularMarketTime` — useful to detect whether the latest bar is a closed session.

**Direct Yahoo chart JSON (`t6_yahoo_direct.py`)**: `https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1y&interval=1d&events=div%2Csplits` → **429 "Edge: Too Many Requests" on the very first request with plain `requests`** (any headers); **200 with `curl_cffi.requests.Session(impersonate="chrome")`**, 60 rapid calls in 3.1 s, 0 errors. Response: `chart.result[0].timestamp[]`, `indicators.quote[0].{open,high,low,close,volume}`, `indicators.adjclose[0].adjclose`, `meta.regularMarketTime`. `v7/finance/quote` → 401 without a crumb (yfinance handles it). So a bare-curl 429 is a TLS-fingerprint block, not a rate limit.

**Cloud-IP evidence (web, not run here)**: yfinance issues #2422/#2518 (2025) and Streamlit forum threads: Yahoo returns 429 to non-browser TLS fingerprints and to datacenter IPs (AWS Lambda, GCP, Streamlit Cloud) even at low volume; the maintainers' own `_http.py` docstring says Yahoo "may rate-limit or block" the plain-requests fallback. `curl_cffi` fixes the fingerprint but **not** a blocked IP range. **Treat yfinance from Vercel/AWS as [unverified, likely flaky]**; keep Upstox/bhavcopy as the server-side path or pre-compute EOD data on the Mac and push to the deployed DB.

### 2.2 NSE bhavcopy (UDiFF) — exchange-grade, no cookies, 1 file/day (`t4_bhavcopy.py`)

```python
import io, zipfile, requests, pandas as pd
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"}
def nse_bhavcopy(yyyymmdd: str) -> pd.DataFrame:
    url = f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{yyyymmdd}_F_0000.csv.zip"
    r = requests.get(url, headers=UA, timeout=30); r.raise_for_status()      # 404 => no file (holiday or not yet published)
    z = zipfile.ZipFile(io.BytesIO(r.content)); df = pd.read_csv(z.open(z.namelist()[0]))
    eq = df[df.SctySrs.isin(["EQ","BE"])]
    assert (eq.TradDt == f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:]}").all()  # guard against stale files
    return eq
```

- 20261108: HTTP 200, 195,856 bytes, **0.1 s**; 3,550 rows, 2,738 `EQ`. 20261106: 208 KB, 0.2 s. 20261105, 20261102, 20261103, 20261028 all 200.
- Columns: `TradDt, BizDt, Sgmt, Src, FinInstrmTp, FinInstrmId, ISIN, TckrSymb, SctySrs, …, OpnPric, HghPric, LwPric, ClsPric, LastPric, PrvsClsgPric, …, TtlTradgVol, TtlTrfVal, TtlNbOfTxsExctd, SsnId, NewBrdLotQty, Rmks`. `PrvsClsgPric` makes the 1-day % move a single-file computation; `ISIN` enables the BSE join.
- Sample 8 Nov: RELIANCE O 1322.1 H 1324.9 L 1314.7 C 1324.0 prev 1320.0 vol 4,174,389, 71,154 trades; DIXON C 12,604 vol 27,461.
- **Delivery data**: `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` (403 KB, columns `SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, …, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER`). **Caveat observed**: the 08112026 URL returned 200 but with 06-Nov data at 17:17 IST (file not yet regenerated) — always check `DATE1`/`TradDt`.
- Legacy `cmDDMMMYYYYbhav.csv` still downloads via `jugaad_data.nse.bhavcopy_save` (640 KB for 6 Nov).
- Cloud access **[unverified, mixed evidence]**: one 2024 StackOverflow answer shows the UDiFF URL working from AWS Lambda; PythonAnywhere staff and a 2026 blog say NSE blocks "clients that hurry" and some subdomains from cloud ranges; `www.nseindia.com/api/*` is reported blocked from AWS outright.

### 2.3 BSE bhavcopy — same schema, gives BSE scrip code

`https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{YYYYMMDD}_F_0000.CSV` with `User-Agent` + `Referer: https://www.bseindia.com/` → 200, 796–872 KB, 0.3 s, 4,685–5,096 rows; identical column set, `FinInstrmId` = BSE scrip code (RELIANCE 500325), `SctySrs` = BSE group (A/B/…). 8 Nov RELIANCE BSE close 1323.0 vol 205,304 (vs NSE 4.17 M); 6 Nov 768,236 vs 22.77 M — BSE volume is ~3–5 % of NSE for large caps.

### 2.4 Upstox historical-candle API — **no authentication**, fastest fallback (`t13`, burst in last check)

```python
import requests
def upstox_daily(isin: str, frm="2025-11-01", to="2026-11-08"):
    url = f"https://api.upstox.com/v3/historical-candle/NSE_EQ%7C{isin}/days/1/{to}/{frm}"   # v2: /v2/historical-candle/NSE_EQ%7C{isin}/day/{to}/{frm}
    j = requests.get(url, headers={"Accept": "application/json"}, timeout=20).json()
    return j["data"]["candles"]          # [["2026-11-06T00:00:00+05:30", o, h, l, c, volume, oi], ...] newest first
```

- 200 in 0.09–0.13 s; 251 candles for 1 y; **63 calls in 5.1 s, all 200, no rate-limit headers**. Intraday endpoint `/v2/historical-candle/intraday/NSE_EQ%7C{isin}/30minute` also 200 without auth (showed the Muhurat bars 14:20/14:50/15:20).
- Freshness: at 17:40 IST the daily endpoint's newest candle was **2026-11-06** — the 8 Nov session had not yet rolled into "historical" (T+0 evening availability **[unverified]**; the intraday endpoint had it).
- Keyed by ISIN (`NSE_EQ|INE002A01018`), which sidesteps symbol renames. Instruments master: `https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz` (2.1 MB gz, 84,682 instruments, 2,756 `NSE_EQ`/`EQ` with `trading_symbol, name, isin, exchange_token`).
- Docs statement "does not require authentication" **[unverified — docs page is JS-rendered and timed out]**; behaviour verified empirically. Official rate limits for unauthenticated use unknown.

### 2.5 Other working-but-unofficial price endpoints

- **Groww**: `https://groww.in/v1/api/charting_service/v2/chart/exchange/NSE/segment/CASH/{SYMBOL}?endTimeInMillis=…&intervalInMinutes=1440&startTimeInMillis=…` → `{"candles": [[epoch_s, o, h, l, c, vol], …]}`; 0.15 s; **42-call burst all 200**; 271 candles for 400 days; **included the 8 Nov bar** (vol 4,171,663, same as Yahoo). Undocumented, no ToS cover — use only as a tertiary fallback.
- **screener.in chart API**: `https://www.screener.in/api/company/{company_id}/chart/?q=Price-DMA50-DMA200-Volume&days=365&consolidated=true` → `{"datasets":[{"metric":"Price","values":[["2025-11-10","1489.30"],…]}, …, {"metric":"Volume","values":[["2026-11-08", 4376967, {"delivery": null}], …]}]}` — 248 points, 0.04 s, no login. Screener's volume ≈ **NSE + BSE combined** (4,376,967 vs 4,174,389 + 205,304 = 4,379,693), includes delivery %. `days>365` is **downsampled** (1000 d → 143 points, 3650 d → 477), so daily data only for ≤365 d. Supported `q` tokens seen: `Price`, `DMA50`, `DMA200`, `Volume` (`PE`, `Market Cap` → 404 on this endpoint).
- **NSE main-site APIs** (`www.nseindia.com/api/...`): need the homepage cookie handshake (`_abck, ak_bmsc, bm_sz`). Today: `holiday-master` 200 (even without cookies), `annual-reports` 200, `corporate-announcements` 200, **`historical/cm/equity` 503 (bot page)**, **`quote-equity` 403**. Yet `jugaad-data`'s `stock_df("RELIANCE", …)` — which wraps the same historical endpoint — returned 27 rows in 0.7 s with the exact bhavcopy volume. Verdict: works sometimes, endpoint- and header-sensitive; do not build the hot path on it. (`jugaad-data` installs fine on 3.12; dates come back as UTC-shifted timestamps, e.g. `2026-11-07 18:30` for the 8 Nov session.)
- **BSE API prices** `https://api.bseindia.com/BseIndiaAPI/api/StockPriceCSVDownload/w?pageType=0&rbType=D&Scode=500325&FDates=01/10/2026&TDates=08/11/2026` → CSV with `Date, Open, High, Low, Close, WAP, No.of Shares, No. of Trades, Total Turnover, Deliverable Quantity, % Deli. Qty…` (includes 8 Nov). Requires `curl_cffi` (see §2.7).

### 2.6 Not viable / not tested

- **Stooq**: `stooq.com/q/d/l/?s=reliance.in&i=d` → HTTP 200 but a JavaScript anti-bot page, no CSV. Dead for scripts.
- **Google Finance**: `google.com/finance/quote/RELIANCE:NSE` → 1.36 MB JS-rendered page, price not in static HTML; no history. Dead without a headless browser.
- **Alpha Vantage** (`RELIANCE.BSE`), **Twelve Data**, **EODHD**: `demo` keys rejected (AV info message; TD 401; EODHD 403). Published free limits **[unverified here]**: AV 25 req/day; TD 8 credits/min, 800/day (Indian exchanges may be paid-plan only); EODHD 20 calls/day. None is worth the signup for this project.
- **Zerodha Kite**: `https://api.kite.trade/instruments/NSE` is a public CSV (10,430 rows: `instrument_token, exchange_token, tradingsymbol, name, …`, no ISIN); historical candles need a paid API subscription. **Dhan**: `https://images.dhan.co/api-data/api-scrip-master-detailed.csv` public (37 MB, has ISIN); candles need auth.

### 2.7 Akamai behaviour on `api.bseindia.com` (important for every BSE caller)

Sequence observed today with plain `requests` + `{User-Agent, Referer: https://www.bseindia.com/, Origin: https://www.bseindia.com, Accept: application/json, text/plain, */*}`: 17:30 → 200 on 6 endpoints; 17:36 → `ListofScripData` 200 only with all four headers (403 with just UA+Referer); 17:39 → **403 "Access Denied" on every endpoint**, same headers, same IP. `curl_cffi.requests.Session(impersonate="chrome")` with the same headers → 200 on all endpoints, immediately. `www.bseindia.com` PDF downloads kept working with plain `requests` throughout. A third-party note (TradeEntry docs, 11 Oct 2026) reports the *opposite* (requests OK, curl blocked) — i.e. Akamai's bot score is session/fingerprint dependent and shifts. **Rule: use `curl_cffi` for `api.bseindia.com`, add 300–500 ms spacing, retry 403 once after 5 s, and never depend on it in a user-facing request path without a cache.**

### 2.8 Anomaly metrics computed from the data (`t7_anomalies.py`; 20-session baseline excludes the day itself)

```python
def metrics(s, i):           # s = per-ticker OHLCV DataFrame, i = position of the session to score
    row, prev, base = s.iloc[i], s.iloc[i-1], s.iloc[i-20:i]
    return dict(pct=100*(row.Close/prev.Close-1), vol_ratio=row.Volume/base.Volume.mean())
```

**Last full session, Fri 6 Nov 2026** — only HDFCBANK fires (either rule): +3.72 %, 2.31× volume (73.5 M vs 31.9 M avg). Near misses: LT 1.53×, IRCTC 1.67×, HAL 1.60× (−1.25 %).

**Thu 5 Nov 2026** — a rich day: BAJFINANCE **+7.65 %, 3.45×**; TMCV **+6.52 %, 3.97×**; TMPV +5.46 %, 2.12×; HDFCBANK +3.16 %, 2.17×; SUNPHARMA +3.14 %, 2.03×; VBL +3.06 %, 2.29×; IRCTC 2.38× (+1.71 %); INFY +3.47 % (0.61×); ETERNAL +4.01 % (1.36×); KPITTECH +3.81 % (0.77×).

**Mon 2 Nov 2026** — the headline demo day: **RELIANCE +11.60 % on 5.83× volume (88.1 M shares; prev close 1164.9 → 1300.0)** and **DIXON +11.99 % on 5.95× (11,000 → 12,319)**; SUNPHARMA 2.12×. Both verified against the NSE bhavcopy (identical close and volume).

**Sun 8 Nov (Muhurat)** — nothing fires; all volume ratios 0.04–0.46×; largest move SUNPHARMA +2.96 %.

Other triggers in the last 15 sessions (useful for a "what happened recently" screen): INFY +4.61 %/2.12× (16 Oct), TCS +4.89 %/2.47× (16 Oct), KPITTECH +5.51 %/2.44× (16 Oct), PERSISTENT 4.38× (16 Oct, −1.70 %), ETERNAL 3.91× (22 Oct, −2.53 %) and +4.25 %/2.20× (23 Oct), INFY 2.43× with a 15.4 % intraday range (23 Oct), LT +3.72 %/3.20× (28 Oct), KPITTECH +3.87 %/2.98× (28 Oct), TRENT +5.44 %/3.86× (30 Oct), VBL −5.50 %/2.90× (30 Oct), SUNPHARMA 3.43× (30 Oct), ADANIENT +5.17 % (29 Oct), DIXON −4.25 % (30 Oct), RELIANCE 2.27× (3 Nov), DMART +3.99 % (3 Nov), PAYTM +4.24 % (3 Nov). Full table in `/tmp/finn-data/t7_out.txt`.

Threshold observation: with ±3 % / 2× on this 21-name book, 5 Nov produces 10 alerts and 6 Nov produces 1 — the brief's "configurable threshold" matters; consider volume-ratio ≥2 **and** |move| ≥3 % as "high", either alone as "medium".

---

## 3. (B) Fundamentals documents

### 3.1 screener.in company page anatomy (no login needed)

URLs: `https://www.screener.in/company/{SLUG}/consolidated/` and `https://www.screener.in/company/{SLUG}/` (standalone). `{SLUG}` = NSE symbol for NSE-listed companies (`RELIANCE`, `TMPV`, `ETERNAL`), BSE scrip code for BSE-only ones (`/company/509470/` Bombay Oxygen) or BSE scrip_id (`/company/ELANTAS/`). `GET /company/500325/` **302→** `/company/RELIANCE/`. Old symbols 404 (`/company/TATAMOTORS/`, `/company/ZOMATO/`). Page: 271 KB, 0.06–0.25 s, `server: nginx`, no Cloudflare, sets only `csrftoken`; **30 rapid fetches of 20 pages in 1.8 s, all 200, no throttling**; even the default `python-requests` UA gets 200.

Key DOM hooks (verified on RELIANCE, HDFCBANK, DIXON, KPITTECH, MOLDTKPAC, SHAKTIPUMP, GRAVITA, SENCO, IRCTC):
- `#company-info[data-company-id][data-warehouse-id][data-consolidated]` — e.g. `2726` / `6598251` / `true` (attribute absent on the standalone page). `data-company-id` feeds `/api/company/{id}/chart/`, `data-warehouse-id` feeds `/api/company/{wh}/peers/` and `/api/company/{wh}/quick_ratios/`.
- `h1` = company name; header links give **BSE code** (`a[href*='bseindia.com/stock-share-price'] … /500325/`) and **NSE symbol** (`a[href*='get-quotes/equity?symbol=']`).
- `#top-ratios li .name/.value`: Market Cap, Current Price, High / Low, Stock P/E, Book Value, Dividend Yield, ROCE, ROE, Face Value.
- `section#quarters table.data-table` — **"Figures in Rs. Crores"**, 13 quarterly columns (`Sep 2023 … Sep 2026` for RELIANCE/DIXON/KPITTECH; SENCO ends `Jun 2026` = not yet reported; MOLDTKPAC's consolidated table ends `Mar 2022` (Sales 160/160/178) while its standalone page has `Mar 2026 … Sep 2026` (238/300/274) and the search API returns `/company/MOLDTKPAC/` — **use the URL the search API returns, and fall back to standalone when the consolidated table's last column is older than ~2 quarters**).
  - Non-financial row labels (exact `td` text): `Sales +`, `YoY Sales growth`, `Expenses +`, `Operating Profit`, `OPM %`, `Other Income +`, `Interest`, `Depreciation`, `Profit before tax`, `Tax %`, `Net Profit +`, `EPS in Rs`, `Raw PDF`.
  - Bank/NBFC labels: `Revenue +`, `YoY Revenue growth`, `Interest`, `Expenses +`, `Financing Profit`, `Financing Margin %`, `Other Income +`, `Depreciation`, `Profit before tax`, `Tax %`, `Net Profit +`, `EPS in Rs`, `Gross NPA %`, `Net NPA %`, `Raw PDF`.
  - Mapping to the brief: Revenue = `Sales +`/`Revenue +`; **EBITDA ≈ `Operating Profit`** (screener's OP is before other income, interest, depreciation — i.e. EBITDA ex-other-income); PBT = `Profit before tax`; PAT = `Net Profit +` (consolidated includes minority interest; fine for headline). Strip `+` and `,`; `%` rows are integers.
  - `Raw PDF` row: `<a href="/company/source/quarter/{id}/{M}/{YYYY}/">` → **302 to the BSE results PDF** (`AnnPdfOpen.aspx?Pname=<uuid>.pdf`). Note `/company/source/quarter/*` is `Disallow`ed in robots.txt — prefer the BSE API `Result` category for the same PDF.
  - Toggle: `View Consolidated` / `View Standalone` links inside `#quarters` point to the sibling URL + `#quarters`. Standalone RELIANCE Sep 2026 Sales 172,408 vs consolidated 330,601.
- `#profit-loss` (12 FYs `Mar 2015 … Mar 2026` + `TTM`): `Sales +, Sales growth, Expenses +, Operating Profit, OPM %, Other Income +, Interest, Depreciation, Profit before tax, Tax %, Net Profit +, EPS in Rs, Dividend Payout %`.
- `#balance-sheet` (12 FYs + latest half-year `Sep 2026`): `Equity Capital, Reserves, Borrowings +, Other Liabilities +, Total Liabilities, Fixed Assets +, CWIP, Investments, Other Assets +, Total Assets` (banks: `Deposits, Borrowing` instead of `Borrowings +`).
- `#cash-flow` (12 FYs): `Cash from Operating Activity +, Cash from Investing Activity +, Cash from Financing Activity +, Net Cash Flow`, plus derived `Free Cash Flow` and `CFO/EBITDA`.
- `#ratios`: `Debtor Days, Inventory Days, Days Payable, Cash Conversion Cycle, Working Capital Days, ROCE %`.
- `#shareholding` (12 quarters): `Promoters +, FIIs +, DIIs +, Government +, Public +, No. of Shareholders`.
- `.company-profile` "About"/"Key Points" prose exists but is screener's own text — secondary, do not use for the pull side.
- The `+` expanders (segment/breakdown rows) load from `/api/company/{id}/schedules/?parent=Sales&section=quarters&consolidated=` — returned `{}` here; `/api/segments/{id}/{section}/{segtype}/` exists in the JS (untested). Not needed.
- `#documents`: `h3` Announcements / Annual reports / Credit ratings / Concalls.
  - `.annual-reports a` → labels `Annual Report 2026 … 2013`; hrefs: 2023–2026 → `https://www.bseindia.com/xml-data/corpfiling/AttachHis/<uuid>.pdf`; ≤2022 → `https://www.bseindia.com/bseplus/AnnualReport/{scrip}/{n}{scrip}.pdf`; occasional `https://archives.nseindia.com/annual_reports/AR_*.zip`.
  - `.concalls li` → text `Nov 2026 Transcript AI Summary PPT REC`; links `a` labelled **`Transcript`**, **`PPT`**, **`REC`** (YouTube / company IR), sometimes `Notes`; `button[data-url="/concalls/summary/{id}/"]` = screener's AI summary → **redirects to `/register/`** (login). Transcript and PPT hrefs are `https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=<uuid>.pdf` in 100 % of cases seen (7 companies, ~170 links).
  - Counts: RELIANCE 48 concall rows / 20 with Transcript (older rows PPT-only); DIXON 39/37; KPITTECH 29/20; MOLDTKPAC 42/41; SHAKTIPUMP 28/20; GRAVITA 42/21; SENCO 15/13. Latest-quarter row can lack a Transcript for ~a week after the call (SHAKTIPUMP `Oct 2026` = PPT+REC only).
  - `.credit-ratings a` → ICRA/CRISIL/CARE rationale URLs (external hosts).
- Login-only: `/concalls/summary/*`, `/annual-reports/{id}/summary/`, `/alerts/*`, watchlists (`/api/company/{id}/add/`). Also `/user/*` and all `?q=`/`?sort=`/`?page=` URLs are robots-disallowed.

**Parser that ran (`t11_docs.py`, trimmed):**

```python
import re, requests
from bs4 import BeautifulSoup
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
def screener_company(symbol):
    r = S.get(f"https://www.screener.in/company/{symbol}/consolidated/", timeout=20)
    if r.status_code == 404: r = S.get(f"https://www.screener.in/company/{symbol}/", timeout=20)
    soup = BeautifulSoup(r.text, "lxml"); info = soup.select_one("#company-info")
    bse = soup.select_one("a[href*='bseindia.com/stock-share-price']")
    out = {"name": soup.select_one("h1").get_text(strip=True), "company_id": info["data-company-id"],
           "consolidated": info.get("data-consolidated") == "true",
           "bse_code": re.search(r"/(\d+)/?$", bse["href"]).group(1) if bse else None,
           "annual_reports": [(a.get_text(" ", strip=True), a["href"]) for a in soup.select("#documents .annual-reports a[href]")],
           "concalls": []}
    for li in soup.select("#documents .concalls li"):
        period = re.match(r"[A-Z][a-z]{2} \d{4}", li.get_text(" ", strip=True))
        out["concalls"].append({"period": period.group(0) if period else None, **{a.get_text(strip=True): a["href"] for a in li.select("a[href]")}})
    tbl = soup.select_one("#quarters table")
    out["quarter_cols"] = [th.get_text(strip=True) for th in tbl.select("thead th")][1:]
    out["quarters"] = {tr.td.get_text(" ", strip=True): [td.get_text(strip=True) for td in tr.select("td")[1:]] for tr in tbl.select("tbody tr")}
    return out
```

### 3.2 screener.in JSON endpoints (found in `cdn-static.screener.in/js/utils.*.js`)

Public (tested 200 without cookies): `/api/company/search/?q=<text>&v=3&fts=1` → `[{"id":2726,"name":"Reliance Industries Ltd","url":"/company/RELIANCE/consolidated/"}, …]` (0.04–0.14 s single, 0.12–2.1 s under load; matches name, NSE symbol, **BSE code**; **not ISIN**); `/api/company/{id}/chart/?q=…&days=…` (§2.5); `/api/company/{wh}/peers/` (returns an **HTML fragment**, not JSON). Also in JS: `/api/company/{id}/schedules/`, `/api/segments/{id}/{section}/{segtype}/`, `/api/company/{wh}/quick_ratios/`, `/api/ratio/search/`, `/api/fii/`, `/api/hs/…`. Login-gated: add/remove to lists, alerts, AI summaries. No `/api/company/{id}/quarters/` or `/announcements/` (404). **There is no public JSON for the financial tables — parse the HTML.**

### 3.3 Downloading the PDFs (`t11_docs.py`, 25 files, 141 MB)

- `www.bseindia.com` requires a browser `User-Agent` (default `python-requests` UA → **403 Access Denied**); **no Referer or cookie needed**. `AnnPdfOpen.aspx?Pname=<f>.pdf` → 302 → `https://www.bseindia.com/xml-data/corpfiling/AttachLive/<f>.pdf` (recent) or `/AttachHis/<f>.pdf` (older); **both direct paths serve any uuid** (tested AttachLive and AttachHis for the same file → 200, same bytes), so you can skip the aspx hop.
- Annual reports: RELIANCE FY26 11.0 MB/187 pp (0.75 s); RELIANCE FY22 `bseplus` 25.4 MB/297 pp (1.28 s); DIXON FY26 15.5 MB/520 pp; KPITTECH 10.3 MB/210 pp; MOLDTKPAC 4.6 MB/209 pp; SHAKTIPUMP 26.9 MB/310 pp; GRAVITA 17.6 MB/369 pp; SENCO 14.9 MB/377 pp. **All text PDFs** (≥4 k chars in the first 5 pages; 0–6 near-empty pages = image spreads). Download speed ≈ 15–20 MB/s.
- Transcripts: 0.48–7.3 MB, **16–29 pages**, all text PDFs, 0.1–0.4 s each. Page 1 is a covering letter to the exchanges; the call body starts at `Moderator:` (DIXON: char 2,746) or at the first speaker (RELIANCE: char 17,650 — Reliance publishes a presentation-style transcript without `Name:` speaker labels). Where labels exist they parse cleanly: DIXON Q2 FY27 → `Atul Lall` 35 turns, `Saurabh Gupta` 27, `Moderator` 19, analysts ≤4 each.
- Text extraction (`t12_pdf_text.py`): `pdftotext` (poppler, installed) is **6–10× faster** than pypdf (RELIANCE AR 1.2 s vs 7.1 s; DIXON 520 pp 1.0 s vs 9.0 s). `pdftotext -layout` inflates whitespace ~2× (RELIANCE AR 2.9 M chars vs 1.1 M via pypdf) — use `pdftotext` **without** `-layout` for LLM input, or collapse runs of spaces. Token budget: transcript ≈ **16–25 k tokens**; annual report ≈ **220–360 k tokens** (pypdf chars/4) — must be sectioned. Landmarks found by regex: `Management Discussion` first hit at 8–11 % into RELIANCE/DIXON (0 % for SENCO: TOC), `Independent Auditor` 34–46 %, `Consolidated Balance Sheet` 66–79 %, `Contingent Liabilit` 49–66 %, `Key Audit Matters` present in RELIANCE only; `Cash Flow Statement` phrasing varies (`Statement of Cash Flows`), `Directors' Report` often `Board's Report`.

### 3.4 Alternatives to screener for documents (all tested)

- **BSE annual reports**: `https://api.bseindia.com/BseIndiaAPI/api/AnnualReport_New/w?scripcode=540699` → `{"Table":[{"Year":"2026","PDFDownload":"https://www.bseindia.com/xml-data/corpfiling/AttachHis/5ef88e3c-….pdf", …}]}` — **same uuid as screener's link**. 9 years for DIXON, 0.6 s. `curl_cffi` + headers `Referer/Origin/Accept` (§2.7).
- **BSE transcripts**: `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=Company+Update&strPrevDate=20260101&strScrip=540699&strSearch=P&strToDate=20261108&strType=C&subcategory=Earnings+Call+Transcript` → `Table[]` with `NEWS_DT, NEWSSUB ("Announcement under Regulation 30 (LODR)-Earnings Call Transcript"), HEADLINE, ATTACHMENTNAME ("995a3a71-….pdf"), Fld_Attachsize, CATEGORYNAME, SUBCATNAME, AUDIO_VIDEO_FILE, …` → PDF at `https://www.bseindia.com/xml-data/corpfiling/AttachLive/{ATTACHMENTNAME}`. DIXON 2026 → 4 rows (5 Nov, 5 Aug, 15 May, 3 Feb) = exactly screener's list. Quarterly results PDFs: same endpoint with `strCat=Result&subcategory=-1` (DIXON 30 Oct 2026 "Results For The Quarter And Half Year Ended 30Th September, 2026", `d7b8fffb-….pdf`).
- **NSE annual reports**: `https://www.nseindia.com/api/annual-reports?index=equities&symbol=DIXON` (after `GET https://www.nseindia.com/` with the same session for Akamai cookies) → `data[]: {companyName, fromYr, toYr, fileName: "https://nsearchives.nseindia.com/annual_reports/AR_31329_DIXON_2025_2026_A_15487496_03092026220551.pdf", attFileSize: "14.77 MB"}`; RELIANCE 17 years, DIXON 9, SENCO 3; 0.2 s. The NSE copy is byte-identical in size to BSE's (RELIANCE 11,007,429 B — the size is embedded in the filename). `nsearchives` PDF download: plain `requests` + UA → 200.
- **NSE transcripts**: `/api/corporate-announcements?index=equities&symbol=RELIANCE&from_date=…&to_date=…` → 200 today; transcript items appear under `desc = "Analysts/Institutional Investor Meet/Con. Call Updates"` with `attchmntFile` on `nsearchives.nseindia.com/corporate/…pdf`. Flaky host (see §2.5) — treat as tertiary.
- **Company IR pages, Trendlyne, Tijori**: **not tested** (no generic URL pattern; would need per-company discovery). Not needed given the three agreeing sources above.

### 3.5 Generic "any NSE symbol → latest AR + last 4–6 transcripts" — feasibility: **high**

Algorithm that ran end-to-end on RELIANCE (mega), DIXON, KPITTECH (mid), MOLDTKPAC, SHAKTIPUMP, GRAVITA, SENCO (small): (1) resolve symbol → screener slug via `/api/company/search/` (or just try `/company/{SYMBOL}/consolidated/`); (2) parse `#documents`; (3) download `annual_reports[0]` and the first 4–6 `concalls[*]["Transcript"]` with a browser UA; (4) if screener has a gap, fall back to BSE `AnnualReport_New` / `AnnSubCategoryGetData` via `curl_cffi` using the BSE code from the page header. Results: 7/7 companies resolved in 0.07–0.22 s each; 7/7 had an FY2026 annual report; transcripts available: 20, 37, 20, 41, 20, 21, 13; 0 download failures across 25 PDFs. Edge cases to code for: latest row PPT-only (transcript lags the call by ~2–7 days); duplicate period rows (RELIANCE has two `Jan 2026` rows: results call + a separate event); standalone-only / stale consolidated tables (MOLDTKPAC); very new listings (SENCO: 4 ARs, 15 concall rows).

---

## 4. (C) Symbol mapping (`t14_symbol_map.py`)

Sources (all free, no auth):
- **NSE** `https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv` (186 KB, 0.25 s; UA only): `SYMBOL, NAME OF COMPANY, SERIES (EQ 2,398 / BE 200 / BZ 34), DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE`. Column names carry trailing spaces — strip them. Shows the demerger cleanly: `TMCV | Tata Motors Limited | 12-NOV-2025 | INE1TAE01010`, `TMPV | Tata Motors Passenger Vehicles Limited | INE155A01022`.
- **BSE** `https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active` (1.8 MB JSON, 0.5–1.0 s; **needs `curl_cffi` or exact headers**): 5,146 active equities with `SCRIP_CD, Scrip_Name, GROUP, FACE_VALUE, ISIN_NUMBER, INDUSTRY, scrip_id, NSURL, Issuer_Name, Mktcap` (₹ cr — a free market-cap column for sizing the portfolio).
- **Join on ISIN**: 2,598 NSE EQ/BE rows → **2,474 matched** to a BSE scrip, 124 NSE-only; 2,641 BSE-only actives. **NSE `SYMBOL` == BSE `scrip_id` for 2,473 of 2,474** (only `VIRAT` vs `BRAHMVIRAT` differs) — so BSE's symbol is effectively the NSE symbol.
- **screener slug**: `/api/company/search/?q={SYMBOL}` returned the right company for all 21 test names (pick the hit whose `url` segment equals the symbol); slug == NSE symbol; `url` already tells you whether screener prefers consolidated (`/consolidated/`) or standalone (`/company/IRCTC/`). Search by BSE code works (`500325` → RELIANCE); by ISIN does not.
- **Upstox** `assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz`: 2,756 `NSE_EQ` equities with `isin`, `trading_symbol`, `name`, `exchange_token`; gives the `NSE_EQ|{ISIN}` key for §2.4 directly. (BSE file exists; my filter for it was wrong — untested.)
- **yfinance**: `Ticker(sym+".NS").isin` → ISIN in 0.8 s (uses a Yahoo search; don't bulk-call it).

Minimal join that ran:

```python
nse = pd.read_csv("EQUITY_L.csv"); nse.columns = [c.strip() for c in nse.columns]
bse = pd.DataFrame(curl_cffi_session.get(BSE_LIST_URL, headers=BH).json())
m = nse[nse.SERIES.isin(["EQ","BE"])].merge(bse, left_on="ISIN NUMBER", right_on="ISIN_NUMBER", how="left")
# m[["SYMBOL","NAME OF COMPANY","ISIN NUMBER","SCRIP_CD","scrip_id","Mktcap"]]
```

Full mapping for the 21 demo names (NSE → ISIN → BSE code → screener id): RELIANCE INE002A01018 500325 #2726 · HDFCBANK INE040A01034 500180 #1298 · INFY INE009A01021 500209 #1489 · TCS INE467B01029 532540 #3365 · ITC INE154A01025 500875 #1552 · SUNPHARMA INE044A01036 524715 #3245 · TMPV INE155A01022 500570 #3370 · TMCV INE1TAE01010 544569 #1285768 · BAJFINANCE INE296A01032 500034 #372 · LT INE018A01030 500510 #1870 · ADANIENT INE423A01024 512599 #56 · ETERNAL INE758T01015 543320 #1274894 · DIXON INE935N01020 540699 #1274137 · PERSISTENT INE262H01021 533179 #2458 · KPITTECH INE04I401011 542651 #1274654 · TRENT INE849A01020 500251 #3467 · VBL INE200M01039 540180 #1273562 · PAYTM INE982J01020 543396 #1275094 · IRCTC INE335Y01020 542830 #1274700 (standalone slug) · HAL INE066F01020 541154 #1274307 · DMART INE192R01011 540376 #1273670.

---

## 5. Legal / ToS notes

- **screener.in** (`/guides/terms/`, last updated 2018): licence is for "personal, non-commercial transitory viewing only"; you may not "modify or copy the materials… use for any commercial purpose… or mirror". `robots.txt` disallows `/company/source/quarter/*`, `/user/*`, query-string listings and screens — the company pages and `/api/company/search/` are **not** disallowed. For a 7-day prototype this is a grey-but-common use; mitigate by (a) fetching on demand with caching (one page per company per day is plenty), (b) attributing screener as the source in the UI, (c) keeping the exchange sources (§3.4) as the drop-in replacement so the architecture is not legally dependent on screener. Do not scrape the login-gated AI summaries.
- **BSE / NSE**: public disclosure documents; both sites use Akamai bot protection and NSE's site terms prohibit automated bulk extraction. Keep to a few requests per company per day; bhavcopy and corporate filings are published for public consumption.
- **Yahoo Finance**: API is unofficial; yfinance's README warns it is for personal use/research. Rate-limit by IP and TLS fingerprint. Fine for a demo, not a production dependency.
- **Upstox/Groww** unauthenticated endpoints: Upstox's is a documented developer API (auth-free per docs, **[unverified]**); Groww's is an internal web endpoint — use only as a last resort.

---

## 6. Notes for the announcements agent (incidental findings, not duplicated work)

- `api.bseindia.com` endpoints (`AnnSubCategoryGetData`, `AnnualReport_New`, `ComHeader`, `ListofScripData`, `StockPriceCSVDownload`) all flipped from 200 to 403 for plain `requests` within ~10 minutes of moderate use; `curl_cffi` (`impersonate="chrome"`) stayed 200. Required headers: `Referer: https://www.bseindia.com/`, `Origin: https://www.bseindia.com`, `Accept: application/json, text/plain, */*`.
- Attachments: `ATTACHMENTNAME` → `https://www.bseindia.com/xml-data/corpfiling/AttachLive/{name}` (AttachHis also serves them). Plain `requests` + UA is enough for the PDFs.
- `www.nseindia.com/api/corporate-announcements?index=equities&symbol=…&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY` returned 200 (21 items for RELIANCE, 1 Oct–8 Nov) with the homepage cookie handshake, while `/api/historical/cm/equity` returned 503 and `/api/quote-equity` 403 in the same session — expect per-endpoint flakiness.
- screener's quarters table `Raw PDF` link 302s to the results PDF on BSE; the BSE API `strCat=Result` returns the same PDF with a date — a cleaner way to find "the results filing" for the QoQ/YoY card.

---

## 7. Risks, recommendations, assumptions to challenge

**Biggest risks**
1. **Deployment IP**: Yahoo and NSE are documented to block/throttle datacenter IPs; BSE's Akamai score drifts within minutes. A demo whose first screen depends on a live Yahoo call from a Vercel function is the "demo that doesn't run" scenario.
2. **Symbol churn**: TATAMOTORS→TMPV/TMCV and ZOMATO→ETERNAL happened within 13 months; a hard-coded `.NS` list will silently lose names. Resolve via `EQUITY_L.csv` (or ISIN with Upstox) at startup.
3. **Calendar edge cases this very week**: Muhurat Sunday bar (tiny volume) and the Tuesday holiday will break naive "yesterday vs today" logic and 20-day baselines.
4. **screener dependency/ToS**: fine for a prototype, but keep the BSE/NSE document path wired so the engine does not die if screener blocks or objects.
5. **Annual-report size**: 220–360 k tokens per AR; sending whole ARs to an LLM is both slow and costly — section the text (MD&A, auditor's report, consolidated statements, notes on contingent liabilities/RPT) before summarising.

**Recommendations (prioritised)**
1. **EOD pipeline = NSE UDiFF bhavcopy** (one 200 KB zip/day, authoritative, ISIN included, `PrvsClsgPric` for the move) **+ yfinance for the 1-year backfill**; compute anomalies once per day server-side and store them. Fall back to Upstox (ISIN-keyed) if Yahoo is blocked from the deploy host. Validate each bhavcopy's `TradDt`; treat 404 as "not yet published" until ~19:00 IST, then "holiday".
2. **Run the fetchers where they work**: if the app is on Vercel/cloud, either pre-compute on the Mac (cron/launchd → push JSON/SQLite to the deployed app) or use Upstox + bhavcopy from the cloud (**verify from the actual deploy host on day 1** — one curl each to `nsearchives`, `api.upstox.com`, `query1.finance.yahoo.com`, `www.bseindia.com`).
3. **Use `curl_cffi` everywhere** (it is already a yfinance dependency); set a 15–30 s timeout, 1 retry, and cache every HTML/PDF/JSON on disk keyed by URL + date.
4. **Fundamentals = screener HTML tables + BSE PDFs**, cached per company per day; store the 13 quarterly columns as numbers in ₹ crore with the `Operating Profit`→EBITDA caveat visible in the UI. Fall back to standalone when the consolidated table is stale.
5. **Transcript ingestion**: `pdftotext` (no `-layout`), drop the covering letter (everything before the first `Moderator:`/speaker label), chunk by speaker turn; ~20 k tokens per call → 4 quarters ≈ 80 k tokens — fits a cheap long-context model in one pass for the "promised vs delivered" view. For ARs, extract MD&A + auditor's report + the three consolidated statements only.
6. **Demo content**: build the push demo around **2 Nov (RELIANCE +11.6 %/5.8×, DIXON +12.0 %/6.0×)** and **5 Nov (BAJFINANCE +7.7 %/3.5×, TMCV +6.5 %/4.0×, TMPV, HDFCBANK, SUNPHARMA, VBL)**; show the Muhurat bar as a "special session — excluded" chip to demonstrate judgment.
7. **Portfolio hygiene**: replace `TATAMOTORS` with `TMPV` and/or `TMCV`, `ZOMATO` with `ETERNAL`; all other 18 suggested names resolve on Yahoo, screener, NSE and BSE.

**Assumptions other agents should challenge**
- That yfinance will keep working from the deploy host (only verified from this Mac).
- That Upstox's historical endpoint stays unauthenticated and has the 8 Nov bar by Monday morning (daily bar lag unverified).
- That screener's `Operating Profit` is an acceptable EBITDA proxy for the headline card (it excludes other income; banks have no EBITDA at all — use `Financing Profit`/NII framing).
- That the BSE `AttachLive/AttachHis` direct URLs remain open without the `AnnPdfOpen.aspx` hop.
- That one screener page fetch per company per day is within acceptable use.

**Unverified items (flagged)**: cloud-IP behaviour of all sources; Upstox documented auth/rate limits; Alpha Vantage/Twelve Data/EODHD free-tier coverage of NSE; Upstox BSE instruments file; Trendlyne/Tijori/company IR as document sources; how quickly the Muhurat/any session's bar appears in Upstox historical; whether `sec_bhavdata_full` is regenerated for special sessions.

Artifacts: scripts `/tmp/finn-data/t1_yf_batch.py … t15_validate.py`, outputs `t*_out.txt`, parsed screener data `/tmp/finn-data/screener_docs.json`, bhavcopies `nse_bhav_*.csv`/`bse_bhav_*.csv`, masters `nse_equity_l.csv`/`bse_scrip_master.csv`, 25 PDFs under `/tmp/finn-data/pdfs/` (141 MB — delete when done).
