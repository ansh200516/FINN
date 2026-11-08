# Synthesis and decision — FINN

Coordinator's consolidation of reports 01–14 (Sunday 8 Nov 2026, 18:15 IST). Every load-bearing fact below was either measured by an agent from this machine or independently re-verified by the coordinator (marked ✓). Where agents disagreed, the resolution and reasoning are stated.

## 1. What we learned that changes the problem

1. **The results card needs no PDF parsing.** NSE publishes SEBI Integrated-Filing XBRL for every quarterly result since Q4 FY25 (`/api/integrated-filing-results`), tagged `RevenueFromOperations`, `FinanceCosts`, `DepreciationDepletionAndAmortisationExpense`, `ProfitBeforeTax`, `ProfitLossForPeriod`, etc., in absolute rupees with explicit Consolidated/Standalone and Audited flags. ✓ RIL Q2 FY27 parsed in 0.07 s; BSE JSON matches to the rupee (05, 12). Legacy quarters to Dec-2024 are on `/api/corporates-financial-results`. Lag: XBRL lands ~2 h after the PDF. → Revenue/EBITDA/PBT/PAT QoQ/YoY become deterministic code with checksums; zero LLM tokens; the Adversarial agent's #2 risk ("a wrong headline number on a company the grader knows") becomes a unit test.
2. **NSE's announcements API is open and deep; BSE's is TLS-fingerprinted.** ✓ Plain Safari UA, no cookies: 200 in 1.5 s, 1,696 records for a 3-day market-wide window; reachable from at least one datacenter (isolated fetch server). Full per-symbol history to 2004 in one call. NSE/BSE publish within a median 26 s of each other (298/306 matched). New since ~7 Nov: NSE attaches a `voiceSummary` to each item. BSE needs `curl_cffi` impersonation → cross-check only. Failure modes are deterministic (tarpitting of default UAs, Brotli without decoder), not flaky.
3. **The free tier is far tighter than the brief implies.** ✓ Flash (3.8/3.6/3.5): 5 RPM / **20 RPD** each; Flash-Lite (3.5/3.1): 10–15 RPM / **500 RPD**; Pro/Argon: 0; `gemini-2.5-*`: 404 for new users; explicit context caching: limit 0; Google Search grounding: 429. Quotas are per project, reset 13:30 IST. Gemma 4 via API returned 200 on a trivial prompt (✓) but 500s on real prompts (06) → opportunistic only. Binding constraint on research runs is 250k TPM and 10 RPM, not RPD.
4. **Bios are in the filings.** SEBI LODR Schedule III mandates a brief profile in appointment intimations; 10/11 real filings had one; `enrich_person()` was correct for 9/9 appointees from the filing text alone (14). Wikipedia/Wikidata cover only marquee names (✓ 1/12). → Primary-source bios, better than the brief's LinkedIn example.
5. **Everything the grader sees must be precomputed.** 3.8-Flash latency swung 19 s → 297 s across the day (06); Flash-Lite 503s in 2/14 calls (12). The UI must read a DB; the only live model call is an explicit user "Ask", with a visible budget.
6. **Classification is a rules problem with a small LLM residue.** NSE `desc` alone labels 69%, regex over `desc`+`attchmntText` 27%, BSE sub-category 2%, LLM residue ~1.6% (05). Local `qwen3:4b` 95.8%, Flash-Lite 97.9% on real subjects (06). Event dedupe: 10.7% exact re-posts; 20-stock portfolio in results week = 103 filings → 73 events → ~50 non-routine cards (~6/day) (14).
7. **Guidance extraction works with a verbatim gate; synthesis needs the Flash tier.** Transcript guidance: 9/9 (12) and 71/75 → 100% after exact-substring gate (06); single-pass recall is poor (2 of ~29 candidate lines, 10) → chunk by speaker turn. One fabricated quote (copied from prior quarter) and 4 fabricated AR numbers were caught only by code gates (10, 06). Flash-Lite lists facts; 3.5/3.8-Flash connected Infosys's guidance cuts to reported growth (06).
8. **Calendar.** ✓ Muhurat session today (14:20–15:30) → poisoned volume bar; Tue 10 Nov holiday; Q2 results deadline Sat 14 Nov with ~370–480 filers/day on 12–13 Nov; 42% of filings stamped after 18:30 IST (09). Transcripts must be filed within 5 working days (02) → results from 4–6 Nov produce transcripts during the build week.
9. **Prices.** yfinance 1.8.0 exact and fast from here (420 calls, 0 errors) but Yahoo blocks plain clients; ✓ NSE UDiFF bhavcopy (whole market, 0.4 s, no cookies) is the primary EOD source; Upstox unauthenticated candle API is the fallback. Symbol churn (TATAMOTORS→TMPV/TMCV, ZOMATO→ETERNAL) is the real failure mode → ISIN-keyed master.
10. **Competitors.** Fast one-liner feeds (MarketPing, ALFA, Tijori Alerts) and guidance trackers (Inve, Tijori Stack) exist; nobody renders a *collapsed, windowed, mobile* portfolio brief with computed QoQ/YoY and dual-cited guidance ledgers (03). Four independent agents (01, 03, 07, 10) converged on "brief + ledger" without coordination.

## 2. Product decision

**FINN is a brief that remembers what management promised.**

Point of view (the brief asks for one): an investor should not scroll a feed or chat with a bot. Twice a day the app hands over a finite brief — a few cards that need attention, the routine filed away with a visible count, and a hard end ("You're done"). Every loud item is worded against the company's own history and open promises. Research is a ledger of commitments settled against exchange-verified numbers, not a summary. Every number and quote is one tap from the page it came from. Thresholds are rules the investor wrote, not scores we invented.

Three objects, one pipeline: **Filing → Card** (Push), **Commitment → Ledger row** (Pull), **Condition → Tripwire** (configurable alerts).

### Surfaces (seven; auth, onboarding and portfolio CRUD beyond add/remove are cut)

1. **Brief** (home). Dateline + window scrubber (24h default; 48h/7d/30d; auto-widens on holidays/weekends and says so). Header: "31 filings · 3 need you · ~4 min". Tier 1 cards (results grid, management change + bio, M&A/fund-raise/rating change one-liners, tripwire hits), Tier 2 one-liners, Tier 3 "28 filed away" fold with per-category glyph counts, expandable. Ends with a stitched rule and "You're done".
2. **Card detail**. Results: 4×3 grid (Revenue, EBITDA, PBT, PAT × Q, QoQ%, YoY%) with basis chips (Consolidated · Unaudited · ₹ cr · EBITDA formula on tap), checksum badge ("exchange XBRL verified" / "preliminary from filing"), promise-settlement line ("2 of 3 promises settled: growth kept, margin missed"), link to PDF page. Management change: role, effective date, verbatim profile excerpt, prior roles, source filing, orphaned promises under a departing executive. Other categories: extracted fields (amount, record date, agency/rating change, stake %, pledge %…) + the filing.
3. **Company** (Pull). Header snapshot from XBRL (last quarter, TTM), then **Promise Ledger** (4–6 quarters: quote · speaker · date · page · promised · delivered · verdict ∈ {Kept, Beat, Missed, Cut, Raised, Withdrawn, Not addressed, Unverifiable}), then collapsible research sections — Business snapshot, Trajectory (exchange quarterly data back to 2021 via legacy + integrated XBRL), Balance sheet & cash quality (from AR statements + H1/FY XBRL), Narrative vs numbers, Bull vs bear (numbers only) — each sentence carrying a fact-id citation chip.
4. **Ask** (sheet, from any company page). Question → answer in the same grammar (headline → numbers → why it matters → receipts), grounded in that company's fact store and documents only; shows the model used and today's remaining budget. Refuses outside knowledge ("not in the filings").
5. **Tripwires** (alerts config). Default watchers: volume > 2× 20-day average (special sessions excluded), |move| > 5%, categories I care about. Plain-language rule editor with a live backtest sentence ("would have fired 4× in the last 60 days"). Calendar-aware flags (ex-date, special session).
6. **Inbox**. Every pushed item with delivery status; the guaranteed channel. Web Push (Android; iOS when installed) and Telegram as external channels.
7. **Add company**. Any NSE symbol (bundled `EQUITY_L.csv` autocomplete, ISIN-keyed). Triggers a research job with a visible "working receipt" of named steps; partial results stream in as they verify.

### Scope (thin-but-working)

| Must (v1 by Wed 11 Nov) | Should (Thu–Fri) | Skip |
|---|---|---|
| Ingestion: ISIN master, bhavcopy 60d, NSE announcements 30d, classification + priority + dedupe, XBRL results 5–8 quarters, mgmt-change bio from filing, transcripts (last 4–6) → guidance → ledger adjudication | Ask sheet; Telegram bot; Web Push; narrative-vs-numbers + bull/bear; AR-based balance-sheet/cash-quality section; audio brief | Auth, onboarding, WhatsApp, voice input, vector DB, Expo, portfolio analytics/PnL, news |
| UI: Brief, Card detail (results + mgmt change), Company (snapshot + ledger + trajectory), Tripwires, Inbox, Add company | Backtest sentence, swipe gestures, dark mode polish | Charts beyond sparklines |
| Deploy on Vercel + PWA manifest; committed seed snapshot; `/status` page with model ledger & cost | README, covering note, build-history export | — |

## 3. Architecture decision

Resolved: **all-TypeScript monolith** (08's recommendation) over a Python engine, because NSE-first data access needs no `curl_cffi`, Gemini accepts native PDF pages (no canvas/PNG rendering needed), one runtime means one deployment and one implementation of every extractor, and the Python prototypes in `/tmp/finn-*` serve as reference implementations to port. Decided against Vercel Python functions (cold-start and routing ambiguity with Next.js) and against a hosted Python worker (no free host stays awake).

```
apps/web (Next.js 16.4, App Router, React 19, Tailwind 4, TypeScript strict)
├─ src/app            routes: / (brief) /c/[symbol] /alerts /inbox /add /status, app/api/* (jobs, ask, push)
├─ src/ui             design system "Ledger" (tokens, components) — see 07
├─ src/db             Drizzle + libSQL (file: locally, libsql:// Turso in prod); schema below; seed loader
├─ src/engine
│   ├─ sources/       nse.ts (announcements, integrated-filing, legacy results, symbol history, EQUITY_L), bhavcopy.ts, upstox.ts, bse.ts (docs only), screener.ts (doc discovery, optional)
│   ├─ ingest/        announcements → classify → dedupe → prioritise; prices → anomalies; results → xbrl parser → quarters; documents → text → sections
│   ├─ extract/       guidance.ts (speaker turns, chunked, verbatim gate), bio.ts (brief profile), oneliner.ts (per-category schemas, list outputs, totals in code), sections.ts (AR page map + regex anchors)
│   ├─ analyse/       ledger.ts (adjudication rules: adjective→band, tolerances, verdicts), results.ts (EBITDA, QoQ/YoY, identities), priority.ts (SEBI materiality × weight × novelty), tripwires.ts
│   └─ llm/           gateway (model ladder, per-model daily ledger at 80% of RPD, token bucket 10 RPM/250k TPM, timeouts, schema-constrained calls, cache by (doc hash, extractor, prompt version, model)), verify (quote gate, number grounding, identities)
├─ scripts/           ingest:* CLIs (run on the Mac via launchd during build week; same code as API jobs)
├─ data/seed/         committed snapshot (SQLite + JSON) so `pnpm dev` and prod work with zero live calls
└─ tests/             vitest: xbrl parser, results math, classifier rules, verbatim gate, window/calendar logic
```

Scheduling: idempotent `POST /api/jobs/{announcements,prices,results,documents,digest}` behind a bearer secret; triggered by Vercel cron (daily EOD), Vercel Schedules if available (15-min announcements poll), on-visit staleness refresh via `waitUntil`, and the Mac's launchd during build week. Research for a new ticker runs as a resumable multi-step job (each step ≤ 60 s, state in DB, client polls and triggers the next step) to live inside both the 300 s function limit and the 10 RPM model limit.

Data model (Drizzle): `companies(isin pk, nse_symbol, bse_code, name, sector, aliases[])`, `prices(isin, date, o,h,l,c, volume, turnover, trades, session_type)`, `announcements(id, isin, exchange, desc, subject, text, attachment_url, filed_at_ist, category, subcategory, priority, event_key, voice_summary, has_xbrl)`, `events(event_key, isin, category, first_at, last_at, card_type, card_json)`, `results_quarters(isin, period_end, basis, source(xbrl|pdf|legacy), revenue, other_income, finance_costs, dna, pbeit, exceptional, pbt, tax, pat, pat_cont, eps, checks_json, source_url)`, `documents(id, isin, kind(transcript|annual_report|results_pdf|presentation), period, url, sha256, pages, text_ref, fetched_at)`, `guidance(id, isin, doc_id, speaker, role, page, quote, metric, direction, low, high, unit, horizon, status, settled_by_quarter, verdict, evidence_json)`, `facts(id, isin, doc_id, page, kind, text, value_json)` (fact store for Ask/citations), `research_sections(isin, section, model, prompt_version, json, fact_ids[], generated_at)`, `tripwires(id, user, rule_json, enabled)`, `alerts(id, user, isin, kind, payload_json, fired_at, delivered_via[])`, `users(id, portfolio_isins[], prefs_json, push_subscriptions[], telegram_chat_id)`, `llm_ledger(model, date_pt, requests, tokens_in, tokens_out)`, `jobs(id, kind, isin, step, state, log_json)`.

Model routing (binding): rules → local/Gemma/Flash-Lite for triage (expect ~0 tokens for 65%+); Flash-Lite with `responseSchema`, `thinkingLevel: MINIMAL` for one-liners, bios, guidance extraction, AR section labelling; native PDF pages at `MEDIA_RESOLUTION_HIGH` only as the results fallback when XBRL is absent and the deterministic text path fails identity checks; 3.5/3.6-Flash (LOW thinking) for narrative-vs-numbers, bull/bear, ledger adjudication prose and Ask; 3.8-Flash only in nightly batch. Every call logged to `llm_ledger`; `/status` shows requests, tokens, paid-equivalent cost, and cache hit rate.

## 4. Demo portfolio (20) and ad-hoc names (5)

Selection criteria: verifiable events in 9–14 Nov; sector and size mix; names that guide explicitly (for ledger depth); a few names from ENAM's disclosed book (01) because the grader will recognise their own holdings; at least one bank and one NBFC (format tests); one distressed name. Build-phase script must verify XBRL + ≥3 transcripts + announcements for each and swap failures.

Portfolio: RELIANCE, HDFCBANK, INDUSINDBK, BAJFINANCE, INFY, KPITTECH, SUNPHARMA, LAURUSLABS, TMPV, HAL, LT, THERMAX, HINDUNILVR, MARICO, BHARTIARTL, IDEA, FLUOROCHEM, AMBER, SUPREMEIND, KALYANKJIL.
Ad-hoc research: OLAELEC (auditor-qualified review), NUVAMA (52.5% promoter pledge), VEDL (post-demerger "debt-free in Q3" promise), PIIND (−70% PAT), RAJESHEXPO (no concalls → graceful degradation).

## 5. Evaluation instrument

Adopt 09's rubric (0–5 per dimension; weights: Correctness 1.5, Demo reliability 1.5, others 1.0) with gates: Correctness or Reliability < 4 → do not submit; any wrong headline number caps Correctness at 1; any spinner > 8 s caps Reliability at 2. Pre-submission: 09's 10-step phone script on iOS Safari + Android Chrome over cellular, in a private tab, re-run after the last deploy. Design gate from 07: if guidance-extraction precision < ~90% on the ad-hoc set by Thu 12 Nov, the ledger grid degrades to quoted prose with verdicts withheld.

## 6. Timeline

- Sun 8 (tonight): scaffold, schema, NSE sources, XBRL engine, announcements ingest + classifier, seed job.
- Mon 9: prices + anomalies, dedupe/priority/cards, documents discovery + transcript parsing + guidance + ledger; Brief UI against seed.
- Tue 10 (holiday): Company page, Tripwires, Inbox, Add-company job; first deploy (needs `vercel login`); phone test.
- Wed 11: v1 complete; critique round 1 (3 independent agents: product, correctness red-team, mobile UX); fixes.
- Thu 12: Ask sheet, Telegram, Web Push, narrative-vs-numbers; critique round 2; cost/perf pass.
- Fri 13: hardening, README, covering note draft, build-history export; critique round 3 on a phone.
- Sat 14: feature freeze; QA script; fixes; final re-deploy; submission package. Sun 15: buffer; submit.

## 7. Open risks carried forward

1. NSE posture from Vercel's `bom1` is unverified (one datacenter vantage passed). Mitigation: seed snapshot + Mac launchd + on-visit refresh; test on first deploy.
2. Shared free-tier quota during grading. Mitigation: everything precomputed; Ask budgeted and visible; fallback chain.
3. Guidance precision on adjectival Indian guidance. Mitigation: band mapper + "Unverifiable" verdict + design gate above.
4. Standalone/consolidated contamination and bank formats. Mitigation: basis chips everywhere; bank schema (NII/PPOP/PAT).
5. Human actions pending: `vercel login`, GitHub repo creation/push test, Turso DB creation (URL + token) — requested from the user at the end of this phase.
