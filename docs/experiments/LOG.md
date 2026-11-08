# Experiment & decision log

Running history of what was improved, why, how it was tested, and what was kept or rejected. Newest entries at the bottom. Every material change to product concept, UX, data, algorithms, implementation, performance or reliability gets an entry.

Entry template:

```
## EXP-NNN — <short title>            (date)
Improving:     <what capability / quality>
Limitation:    <the concrete weakness observed before>
Hypothesis:    <proposed approach and why it should help>
Experiment:    <what was actually run / built / measured>
Result:        <objective evidence: numbers, pass/fail, screenshots, timings>
Decision:      KEEP | REJECT | PARTIAL — <reason>
Rejected alts: <alternatives considered and why not>
```

---

## EXP-000 — Research phase kickoff            (2026-11-08)
Improving:     Problem understanding before any implementation.
Limitation:    Empty repository; no verified knowledge of data-source reliability, model availability, or what graders value.
Hypothesis:    A broad, independent, parallel investigation (14 specialised agents) will surface non-obvious opportunities and de-risk the plumbing (NSE/BSE access, PDF extraction) before architecture is chosen.
Experiment:    Launched agents 01–14 (see `docs/research/README.md`). Each must test empirically and report evidence, limits and assumptions to challenge.
Result:        14 reports delivered (docs/research/01–14). Coordinator independently re-verified: Gemini model availability and free-tier quotas (Flash 20 RPD, Flash-Lite 500 RPD, Pro 0); NSE announcements API open to plain clients and to a datacenter vantage; BSE API TLS-fingerprinted; NSE UDiFF bhavcopy; NSE Integrated-Filing XBRL parses to exact headline numbers (RIL Q2 FY27); NSE 2026 holiday calendar (10 Nov holiday, Muhurat session 8 Nov).
Decision:      KEEP — synthesis in `docs/research/20-synthesis-and-decision.md`.

## EXP-001 — Product concept and architecture decision            (2026-11-08)
Improving:     Direction of the whole build.
Limitation:    Conventional interpretation (chat app + summariser + yfinance) is what most submissions will be (09); competes on latency in a crowded Indian filings-alert market (03).
Hypothesis:    "A brief that remembers what management promised": finite twice-daily brief (collapsed routine, computed QoQ/YoY, filing-sourced bios) + promise ledger settled against exchange XBRL + user-written tripwires. All-TypeScript Next.js monolith, precomputed and cached, XBRL-first results engine, Flash-Lite bulk / Flash synthesis routing under measured quotas.
Experiment:    Cross-agent convergence check (01, 03, 07, 10 independently proposed brief + ledger); feasibility evidence from live prototypes (XBRL exact 5/5 companies; guidance quotes 9/9 and 71/75→100% after gate; bios 9/9; classification 96–98%).
Result:        Feasible within free tier: ~40 Flash-Lite calls per first-time company research, <25 calls/day for 20-stock Push (06).
Decision:      KEEP — proceed to build. Gate: guidance precision ≥ ~90% on ad-hoc set by Thu 12 Nov, else ledger degrades to quoted prose.
Rejected alts: Python engine on Vercel/hosted worker (no free always-on host; dual runtime); Expo/TestFlight ($99 + review; friction for graders); chat as home screen (template the brief warns against); vector DB (structured extraction + fact store suffice); PDF-first results parsing (scanned OCR layers; XBRL is exact and free); Gemma 4 API as load-bearing (500s on real prompts).

## EXP-002 — Vertical slice build (4 parallel builders + scaffold)            (2026-11-08 evening)
Improving:     From empty repo to a working, data-filled product.
Limitation:    Nothing existed.
Hypothesis:    Folder-ownership parallelism over one scaffold with shared contracts (types, schema, LLM gateway) lets four builders ship independently without merge conflicts.
Experiment:    Scaffold (40 min) → Builders A (market data/push), B (XBRL results), C (documents/guidance/ledger), D (UI) in parallel (~75 min); then full-book data ops.
Result:        Clean tree, 265 tests green. DB: 26 companies, 305 announcements → 189 events (42 Tier 1), 1,323 price bars, 614 results quarters (99.67% identity pass, 19/19 YTD), 47 documents, 141 verified guidance statements (95.8% verbatim pass, 90% manual precision), ledgers for 5 companies. Classifier ≥95% on 178 hand-labelled real filings. Anomalies reproduce research findings; Muhurat bar never fires; 24h window auto-widens with reason. UI renders all surfaces on live data; first-load JS 137–140 KB gz/route. Coordinator screenshot review: editorial, dense, distinctive; results grids inline in the brief.
Decision:      KEEP. Issues found in review → EXP-003.
Rejected alts: None at this stage.

## EXP-003 — Integration wave (E) + UI refinement (F)            (2026-11-08 night)
Improving:     End-to-end product behaviour and visual correctness.
Limitation:    Brief page used a parallel query path (not `buildBrief`); no job runner / add-any-ticker flow / alerts into inbox / Ask backend; fixture seeder clobbered `llm_ledger` (quota cap defeated) and overwrote real rows; multi-person management-change annexures rendered as a wall of text with duplicated names; company header labelled the Muhurat bar as a normal close; backtest sentence a placeholder; 30-day brief ~670 ms server render.
Hypothesis:    Single source of truth for the Brief + resumable 'continue-pattern' jobs within Vercel limits + grounded Ask with verified citations + targeted UI fixes close the gap to a deployable v1.
Experiment:    Agents E (backend wiring) and F (UI) in parallel with disjoint ownership; data-ops agent extends documents/ledgers to all 25 names under a 220-call ceiling.
Result:        Interrupted. Cursor billing stopped E, F, C and data-ops mid-run (unpaid invoice). What was on disk typechecks and 275 tests pass: job runner + `/api/jobs/{kind}` (GET for Vercel cron), brief page on `buildBrief`, add-ticker receipt, tripwire→alerts, document period relabel/dedupe/`cover_only` (code, not yet re-run on the DB), UI refinements (people rows, bank grid, ledger collapse, status page). Not done: Ask endpoint, engine-side bio split (UI splits excerpts itself), screenshot pass, PIIND/RAJESHEXPO/VOLTAS/TRENT/ITC documents, relabel backfill. Fixture seeder no longer writes `llm_ledger` or `llm_cache`.
Decision:      KEEP the on-disk work (committed after the interruption). Resume Ask, relabel, and the missing document names once agents can run again.

## EXP-004 — Data-quality audit of the first full-book document ingestion            (2026-11-08 20:00)
Improving:     Correctness of the Pull side (ledger inputs) before any LLM-derived verdict is shown.
Method:        Coordinator queried `documents` ⋈ `document_meta` for all transcripts (62 rows, 9 companies) and compared stored period vs publish date vs source URL.
Findings:      (1) RELIANCE transcripts published 2026-07-19 and 2026-11-01 stored as Q1FY26/Q2FY26 (should be Q1FY27/Q2FY27); discovery logged the right period, text-derived period overrode it → ledger would settle FY27 promises against FY26 quarters. Only RIL's header style affected so far (8 other companies consistent). (2) Cross-source duplicates: HDFCBANK, INFY, RELIANCE, SUPREMEIND each hold the Q2FY27 transcript twice (BSE AttachLive + NSE), identical page counts; URL-keyed uniqueness let both in → duplicate ledger statements, `--transcripts 4` drops one real quarter, quota wasted. (3) All six INDUSINDBK "transcripts" are 1-page cover letters → silent zero recall.
Decision:      Fix at the source (Builder C): date-vs-text period rule + `--relabel`, sha256/(isin,kind,period) dedupe with `duplicate_of`, `cover_only`/`not_transcript` statuses with BSE/IR fallback; re-settle affected ledgers from cache. Data-ops run continues (documents are fine; guidance for RIL to be re-reconciled after relabel). Lesson: every derived label needs a second, independent derivation and a disagreement rule — the same principle as the XBRL identity checks.
