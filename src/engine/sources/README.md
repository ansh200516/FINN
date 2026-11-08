# engine/sources — owner: Builder A (data)

Raw fetchers. No parsing beyond JSON/CSV/XML → typed records; no DB writes.

| File | Source | Notes |
|---|---|---|
| `nse.ts` | `www.nseindia.com/api/corporate-announcements`, `/api/integrated-filing-results`, `/api/corporates-financial-results`, `EQUITY_L.csv`, symbol-change history | Safari UA + `Accept: application/json`, `Accept-Encoding: gzip` (never `br`), hard timeout, **validate body length** (a "browser-like" header set returns empty 200s) |
| `bhavcopy.ts` | `nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip` | UDiFF; filter `SctySrs in (EQ, BE, BZ, SM)`; whole market per day |
| `upstox.ts` | unauthenticated historical candles | fallback for EOD gaps |
| `bse.ts` | BSE PDF attachments / bhavcopy | BSE *API* is TLS-fingerprinted → do not depend on it |
| `screener.ts` | document discovery (AR / transcript links) | optional; IR sites + NSE attachments first |

Contracts are in `index.ts`. Return raw-shaped records (`AnnouncementRaw`, XBRL XML string, CSV rows); the `ingest/` layer normalises.
