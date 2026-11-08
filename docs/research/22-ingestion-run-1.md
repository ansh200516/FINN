# 22 — Ingestion run 1

8 Nov 2026, about 20:48–20:55 IST. CLIs only. No source edits, no commit. `GEMINI_API_KEY` was set. No command failed, so nothing was retried. No `SQLITE_BUSY`. Flash (`gemini-3.6-flash`) stayed at 3 requests. Cap not hit (`gemini-3.5-flash-lite` 167 → 214, cap 400).

Ledger before any LLM call (`2026-11-08` PT): flash-lite 167, `gemini-3.1-flash-lite` 13, gemma 12, flash 3.

## What SQL showed before fetching

| Symbol | Before | Action |
|---|---|---|
| PIIND | 6 docs, 5 ok transcripts (through Q1FY27), 0 guidance | No document fetch. Guidance only. |
| RAJESHEXPO | FY26 annual report already stored, 0 transcripts, 1 guidance row | Document ingest confirmed no concall. Ledger only (no new LLM). |
| VOLTAS | 1 empty `other` row, 0 transcripts, `in_portfolio=1`, 0 guidance | Documents, then guidance. Not in the current `portfolio.json` list. |
| TRENT, ITC | Not in `companies`, 0 documents | `pnpm ingest:companies --adhoc TRENT,ITC` (2 inserted, 25 seed rows updated, 0 unresolved), then documents and annual-report guidance. They stay alternates in the seed file; the DB flag is `is_adhoc=1`. |
| Other portfolio names | Every portfolio symbol already had ≥1 transcript row | Not fetched. |

No portfolio or adhoc symbol other than RAJESHEXPO and VOLTAS had zero transcript rows. INDUSINDBK Q2FY27 was left as `cover_only` (not special-cased). `--force` was not used. INFY FY26 annual report is still `text_status=pending` with no page count; transcripts and a ledger were already there.

## Documents

`pnpm ingest:documents --symbols … --quarters 6 --ar 1`

| Symbol | Inserted | Transcripts | text_status | Result |
|---|---|---|---|---|
| RAJESHEXPO | 0 (AR skipped, 143 pages) | none | ok:1 | NSE: no earnings-call transcript in the last 6 quarters. |
| VOLTAS | 6 (Q1FY27, Q4FY26, Q3FY26, Q2FY26, Q1FY26, FY26 AR) | those five, all ok | ok:7 (includes the old `other` row) | 18.9s, 0 errors. |
| ITC | 1 (FY26 AR, 416 pages) | none | ok:1 | Same no-concall reason. |
| TRENT | 1 (FY26 AR, 262 pages) | none | ok:1 | Same no-concall reason. |
| PIIND | not run | Q1FY26, Q1FY27, Q2FY26, Q3FY26, Q4FY26 already ok | ok:6 | Q2FY27 still absent. |

## Guidance and ledger

`pnpm ingest:research --symbols … --guidance --ledger --transcripts 4 --max-calls 12`. One symbol at a time, except TRENT+ITC (annual-report fallback, 3 calls each). No `--sections`.

| Symbol | Flash-lite before → after | Calls | Docs used | Guidance rows | Ledger |
|---|---|---|---|---|---|
| BHARTIARTL | 167 → 177 | +10 on 3.5 | Q1FY27, Q4FY26, Q3FY26, Q2FY26 | 12 (2+6+2+2) | open 9, superseded 3. Q2FY27 pending (results 5 Nov, expected by 15 Nov). |
| NUVAMA | 177 → 186, and 3.1-flash-lite 13 → 14 | +9 on 3.5, +1 on 3.1 | Q1FY27, Q4FY26, Q3FY26, Q2FY26 | 32 (11+5+7+9) | missed 1, cut 1, raised 2, unverifiable 4, open 20, superseded 4. Q2FY27 pending (results 6 Nov, expected by 16 Nov). |
| VEDL | 186 → 194 | +8 on 3.5 | Q4FY26, Q3FY26, Q2FY26, Q1FY26 (Q1/Q2 FY27 are cover_only) | 31 (6+9+7+9) | beat 1, cut 1, raised 1, unverifiable 4, open 19, superseded 5. |
| PIIND | 194 → 200 | +6 on 3.5 | Q1FY27, Q4FY26, Q3FY26, Q2FY26 | 17 (4+9+2+2) | kept 1, raised 1, open 11, superseded 4. Q2FY27 pending (results 4 Nov, expected by 14 Nov). |
| VOLTAS | 200 → 208 | +8 on 3.5 | Q1FY27, Q4FY26, Q3FY26, Q2FY26 | 10 (3+4+2+1) | open 10. Q2FY27 pending (results 6 Nov, expected by 16 Nov). |
| ITC | 208 → 211 | +3 on 3.5 | FY26 AR, 3 chunks | 0 | No commitments kept. |
| TRENT | 211 → 214 | +3 on 3.5 | FY26 AR, 3 chunks | 0 | 2 candidates, both quote-rejected. |
| RAJESHEXPO | 214 → 214 | 0 | existing AR row | 1 | open 1 (medium-term revenue growth). Note: annual-report source, no transcript. |

Newest four ok transcripts only. The older fifth transcript (Q1FY26) was not sent.

Requests this run: **+47** `gemini-3.5-flash-lite` (167 → 214), **+1** `gemini-3.1-flash-lite` (13 → 14). Flash unchanged at 3. Headroom to the 400 stop: 186.

## Still thin, and why

Not a cap stop. Nothing left in the zero-guidance portfolio/adhoc set.

- **No concall on file:** RAJESHEXPO, TRENT, ITC. Annual reports are stored. TRENT and ITC’s report scan kept no guidance rows.
- **Q2FY27 not a full transcript yet:** BHARTIARTL, NUVAMA, PIIND, VOLTAS (inside the post-results window). VEDL Q1FY27 and Q2FY27, and INDUSINDBK Q2FY27, are `cover_only`.
- **Results still ahead (9–14 Nov):** AMBER, IDEA, INOXWIND, KALYANKJIL, OLAELEC, TMPV. Older transcripts are already stored.
- **Pre-existing failed rows, not `pending` with 0 pages, so not forced:** LT Q2FY27; THERMAX Q1FY26, Q1FY27, Q2FY26, Q3FY26 (THERMAX’s only ok transcript is Q4FY26). INFY FY26 annual report is still `pending` with no pages.

## Coverage after this run

Ok-transcript periods are the readable calls. Guidance verdicts use `verdict`, or `status` when verdict is null (`open`).

| Symbol | Role | Ok transcripts | text_status | Guidance | Verdicts |
|---|---|---|---|---|---|
| RELIANCE | portfolio | 6, through Q2FY27 | duplicate 1, ok 8 | 9 | open 9 |
| HDFCBANK | portfolio | 6, through Q2FY27 | duplicate 1, ok 8 | 9 | open 8, unverifiable 1 |
| INDUSINDBK | portfolio | 5, no ok Q2FY27 | cover_only 6, ok 6 | 12 | open 6, superseded 4, unverifiable 2 |
| BAJFINANCE | portfolio | 6, through Q2FY27 | ok 7 | 31 | missed 1, open 21, raised 3, superseded 4, unverifiable 2 |
| INFY | portfolio | 6, through Q2FY27 | duplicate 1, ok 7, pending 1 | 22 | kept 1, open 10, superseded 9, unverifiable 2 |
| KPITTECH | portfolio | 6, through Q2FY27 | ok 7 | 20 | open 13, superseded 6, unverifiable 1 |
| SUNPHARMA | portfolio | 6, through Q2FY27 | ok 7 | 11 | open 11 |
| LAURUSLABS | portfolio | 6, through Q2FY27 | ok 7 | 23 | open 18, superseded 4, withdrawn 1 |
| TMPV | portfolio | 5, through Q1FY27 | ok 6 | 9 | open 7, superseded 2 |
| LT | portfolio | 5, through Q1FY27 | cover_only 6, failed 1, ok 6 | 33 | beat 1, cut 2, not_addressed 1, open 18, superseded 7, unverifiable 4 |
| THERMAX | portfolio | 1 (Q4FY26) | cover_only 5, failed 4, ok 2 | 2 | open 2 |
| HINDUNILVR | portfolio | 6, through Q2FY27 | ok 7 | 21 | open 7, superseded 14 |
| MARICO | portfolio | 6, through Q2FY27 | ok 7 | 57 | cut 2, open 38, raised 3, superseded 13, unverifiable 1 |
| BHARTIARTL | portfolio | 5, through Q1FY27 | ok 6 | 12 | open 9, superseded 3 |
| IDEA | portfolio | 4 (no Q2FY27, no Q3FY26) | ok 5 | 15 | cut 1, open 9, superseded 4, unverifiable 1 |
| FLUOROCHEM | portfolio | 6, through Q2FY27 | ok 7 | 15 | open 13, superseded 2 |
| AMBER | portfolio | 5, through Q1FY27 | ok 6 | 42 | beat 3, cut 2, open 21, raised 3, superseded 6, unverifiable 7 |
| SUPREMEIND | portfolio | 6, through Q2FY27 | duplicate 1, ok 8 | 17 | cut 2, kept 2, open 9, superseded 2, unverifiable 2 |
| KALYANKJIL | portfolio | 5, through Q1FY27 | ok 6 | 19 | beat 1, open 9, unverifiable 9 |
| INOXWIND | portfolio | 5, through Q1FY27 | ok 6 | 13 | kept 1, missed 2, open 6, superseded 2, unverifiable 2 |
| OLAELEC | adhoc | 5, through Q1FY27 | ok 6 | 5 | open 5 |
| NUVAMA | adhoc | 5, through Q1FY27 | ok 6 | 32 | missed 1, cut 1, raised 2, unverifiable 4, open 20, superseded 4 |
| VEDL | adhoc | 4 (FY26 only) | cover_only 6, ok 5 | 31 | beat 1, cut 1, raised 1, unverifiable 4, open 19, superseded 5 |
| PIIND | adhoc | 5, through Q1FY27 | ok 6 | 17 | kept 1, raised 1, open 11, superseded 4 |
| RAJESHEXPO | adhoc | 0 | ok 1 (AR) | 1 | open 1 |
| VOLTAS | in DB as portfolio | 5, through Q1FY27 | ok 7 | 10 | open 10 |
| TRENT | alternate, DB adhoc | 0 | ok 1 (AR) | 0 | — |
| ITC | alternate, DB adhoc | 0 | ok 1 (AR) | 0 | — |
