# Shared context for all research agents

Read this first. Then read the primary sources in full:

- `docs/challenge/brief.txt` — the full challenge brief (FINN: Financial Investment Agent, ENAM AI Engineer Build Challenge).
- `docs/challenge/reference.txt` — companion reference: announcement categories + financial glossary.

## Hard facts about the challenge

- Released 8 Nov 2026, deadline **15 Nov 2026** (7 days). Today is Sunday 8 Nov 2026.
- Deliverable: a **mobile-first working prototype** (deployed link / Expo / responsive web — must be easy to try on a phone), a GitHub repo, the AI build history (coding-agent conversation exports), and a short covering-note writeup (what was built, key decisions and trade-offs, what was deliberately left out, where to take it next).
- Graded on: creativity, product sense, judgment, architecture — explicitly **not** completeness or polish. "Thin-but-working beats broad-but-broken." "A demo that doesn't run is the worst outcome."
- Two interaction modes:
  - **Push**: (1) a windowed digest over a user-chosen window (default last 24h) of all filings/announcements across the portfolio, prioritised, routine collapsed; (2) triggered alerts — material announcement types the user cares about, and EOD anomalies (volume > ~2x recent average, price move beyond ±X%) with **configurable thresholds**.
  - **Pull**: on-demand research on a company grounded ONLY in primary sources (annual reports + concall transcripts). Menu: business snapshot, financial snapshot, trajectory, balance sheet, cash quality, narrative-vs-numbers, guidance, bull-vs-bear. Worked example they value most: last four quarters, management guidance promised vs. actually delivered. No news, no broker notes, no model world-knowledge about the company.
- Presentation examples they "love": management change → short bio of the incoming person; quarterly results → Revenue, EBITDA, PBT, PAT this quarter vs last quarter (QoQ) and vs same quarter last year (YoY).
- Portfolio: 15–20 NSE/BSE-listed companies (mixed sectors/sizes), plus 3–5 ad-hoc research companies. Engine must **generalise to any NSE ticker** — they may point it at a company we didn't pick.
- Data sources (guided; "plumbing, not the point"): (1) EOD price/volume — yfinance `.NS`/`.BO` or equivalent; (2) NSE/BSE corporate announcements; (3) fundamentals — annual reports + concall transcripts via screener.in links or company IR sites.
- Interaction model is deliberately open: chat, voice, copilot, dashboard, or something new. They want a **point of view** on how an investor should interact. Everything mobile-first.
- "No AI slop": core, concise, beautifully presented, interactive, dense. Must feel like a product someone thought hard about, not a model filling a template.
- Models: no restriction. Free tiers are enough. **Efficiency earns bonus points**: smart model routing (cheap for bulk extraction, strong only where reasoning demands), caching, chunking.

## Environment facts (verified 8 Nov 2026 on the build machine)

- macOS, 18 GB RAM, ~22 GB free disk (be frugal with venvs/node_modules).
- Node v24.9.0, pnpm, bun, Python 3.14.4 (system), `uv` 0.6.3 available (use `uv venv --python 3.12` for compatibility if 3.14 wheels are missing), Docker CLI present, git present, **no `gh` CLI**.
- LLM access: `GEMINI_API_KEY` is set in the environment (the only hosted LLM key available). Ollama is installed with `gemma3:4b` and `llama3.2` (old, small).
- CLIs: `vercel` installed; `ngrok` installed. Not installed: fly, railway, wrangler, netlify, supabase, expo/eas.
- Network from this machine: `www.nseindia.com` → 403 to a plain curl (expected; needs cookie/session handshake), `www.bseindia.com` → 200, `www.screener.in` → 200, Yahoo chart endpoint → 429 on a bare curl (yfinance handles crumbs/cookies).
- `pdftotext` (poppler) is installed. yfinance is NOT yet installed.
- The repo at `/Users/anshsingh200516/enam` is a fresh, empty git repo (only `docs/` and the problem-statement PDFs). There is no existing code.

## Live findings (appended by the coordinator as verified facts arrive)

**Gemini free tier on our key — probed 8 Nov 2026 17:18 IST (one tiny JSON call per model):**

| Model | Result | Notes |
|---|---|---|
| `gemini-3.5-flash-lite` | 200, 1.2 s | No thinking tokens; cheapest workhorse for bulk extraction/classification |
| `gemini-3.1-flash-lite` | 200, 1.7 s | No thinking tokens |
| `gemini-flash-lite-latest` | 200, 1.4 s | Alias; no thinking tokens |
| `gemini-3.5-flash` | 200, 1.5 s | Thinking ON by default (~58 thought tokens even on a trivial prompt) |
| `gemini-3.6-flash` | 200, 1.3 s | Thinking ON by default |
| `gemini-3.8-flash` | 200, 19.4 s (first call) | Newest flash; thinking ON; latency spiky |
| `gemini-3-flash-preview` | 200, 1.9 s | Thinking ON |
| `gemma-4-26b-a4b-it` | 200, 3.0 s | Open-weights Gemma 4 served free; thinking tokens reported |
| `gemini-3.7-flash` | 503 | "high demand" — unreliable |
| `gemma-4-31b-it` | 500 | Internal error |
| `gemini-flash-latest` | 200 but 220 s | Alias resolved to something congested — do not use |
| `gemini-2.5-flash` / `-lite` / `-pro` | 404 | Retired for new users |
| `gemini-3.1-pro-preview`, `gemini-4-argon`, `gemini-pro-latest` | 429, quota limit **0** | **Pro-class models are not available on the free tier at all** |

Implications: (1) the "strong model for reasoning" tier must be a thinking-enabled Flash (3.5/3.6/3.8-flash) unless we add a second provider; (2) set thinking budget to 0/minimal for bulk extraction to cut latency and tokens; (3) never hard-code `-latest` aliases; (4) every LLM call needs a timeout + fallback model chain because individual models return 503/500 intermittently.

**Free-tier quotas (validated by the coordinator against three independent Oct–Nov 2026 sources incl. an AI Studio rate-limit page read-out and a Google forum thread showing `quotaValue: 500`; Google no longer publishes the table, so treat as best-available, not guaranteed):**

| Model class | RPM | TPM (input) | RPD |
|---|---|---|---|
| gemini-3.8-flash / 3.6-flash / 3-flash-preview | 5 | 250k | **20** |
| gemini-3.5-flash-lite / 3.1-flash-lite | 15 | 250k | **500** |
| gemma-4-26b-a4b-it (and 31b when it works) | 30 | — | **14,400** |
| gemini-3.1-pro-preview / gemini-4-argon | 0 | 0 | 0 |

Quotas are **per Google Cloud project, not per key**, and reset at **midnight Pacific = 13:30 IST**. Paid Tier 1 (link billing, $5 prepay) lifts Flash to 1,000 RPM / 10,000 RPD — the brief says free tiers suffice and rewards efficiency, so the design target is to stay inside free limits.

Architectural consequences (binding for synthesis): the strong Flash tier is a **budget of ~20 calls/day** — reserve it for the few genuinely reasoning-heavy syntheses (promise adjudication, narrative-vs-numbers, bull/bear) and precompute + cache those per document hash; route all bulk work (announcement classification, one-liners, table/field extraction, guidance-sentence extraction) to Flash-Lite (500/day) and Gemma 4 (14,400/day — effectively the free workhorse); run ingestion as scheduled batches timed after the 13:30 IST reset so the 20:30 IST evening edition has a fresh daily quota; the UI must never depend on a live strong-model call except an explicit user "Ask"; implement a per-model daily counter + fallback chain (3.8-flash → 3.6-flash → 3.5-flash → flash-lite → gemma-4) with graceful "analysis queued" states.

**Market calendar for build/demo week — verified by the coordinator against NSE circulars CMTR71775 and EGR76928 (nsearchives.nseindia.com):**

- Sun 8 Nov 2026: Diwali Laxmi Pujan; special **Muhurat trading session 14:20–15:30 IST** (pre-open 14:05). This creates a real EOD bar dated 2026-11-08 with ~1 hour of volume. Any "volume vs N-day average" logic must exclude or flag special sessions, or Monday's normal volume will look like a >2× anomaly against a depressed average (and the Muhurat bar itself will look like a volume collapse).
- Mon 9 Nov: normal trading day. **Tue 10 Nov: trading holiday (Diwali-Balipratipada)** — no EOD bar; filings can still arrive. Wed 11–Fri 13 Nov: normal trading days.
- Sat 14 Nov 2026: SEBI LODR Reg 33 45-day deadline for Q2 FY27 (Jul–Sep 2026) results → the heaviest results-filing days are Wed 11–Sat 14 Nov, i.e. during the build week. The deadline is the day before our submission deadline (15 Nov).
- Implication: a grader may open the app on a holiday or weekend; "last 24h" windows must handle no-trading days gracefully (show filings, say "market closed", widen or explain the window) rather than appear empty or broken.

**Data-source reachability — verified by the coordinator 8 Nov 2026 ~17:40 IST (corroborates agents 08 and 10):**

- `GET https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=06-11-2026&to_date=08-11-2026` with only a Safari UA + `Accept: application/json` (no homepage cookie dance) → **200 in 1.5 s, 1,696 records / 1.6 MB** for a 3-day window. The same endpoint also returned valid JSON from an isolated cloud fetch server (empty array for a per-symbol query), i.e. at least some datacenter egress is not blocked. NSE *homepage* is 403 to plain clients — irrelevant for the API.
- Record fields: `symbol, sm_name, sm_isin, smIndustry, desc (NSE subject category), attchmntText (one-paragraph description), attchmntFile (PDF URL), attFileSize, fileSize, hasXbrl, an_dt ("08-Nov-2026 17:32:09"), sort_date, exchdisstime, dt, seq_id, orgid, bflag, csvName, difference, old_new, voiceSummary, voiceUrl`. `desc` values seen: "Acquisition", "Analysts/Institutional Investor Meet/Con. Call Updates", "Copy of Newspaper Publication", … — a clean, deterministic first-pass classifier input. `hasXbrl` flags structured filings (results XBRL opportunity). `voiceSummary`/`voiceUrl` suggest NSE now publishes its own audio summaries — secondary, push-side only.
- BSE `api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` → **403** to plain curl even with Referer/Origin (TLS fingerprinting; only `curl_cffi` impersonation works per agent 08). BSE PDF attachments and bhavcopies are fine with plain fetch.
- NSE UDiFF bhavcopy `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip` → 200, 208 KB zip / 624 KB CSV in 0.4 s; columns incl. `TradDt, TckrSymb, SctySrs, ISIN, OpnPric, HghPric, LwPric, ClsPric, LastPric, PrvsClsgPric, TtlTradgVol, TtlTrfVal, TtlNbOfTxsExctd`. Filter `SctySrs in (EQ, BE, BZ, SM)` for equities. This is the **primary EOD price/volume source** (Yahoo 429s plain clients; yfinance only works via curl_cffi) — one file per trading day for the whole market, perfect for 20-day averages and anomaly scans.
- Tooling state: `vercel` CLI installed but **not logged in** (`vercel login` needs an interactive browser step — a human action before deploy). Docker daemon not running (not needed). Tavily MCP key invalid (built-in web search works).
- NSE nuance (agent 11): a "more browser-like" header set produced **empty 200 responses**; the minimal UA + Accept set returned full bodies. Always validate the JSON body length, never just the status code. `countTokens` 404s on `v1beta` but works on `v1`.
- Node stack (agent 11): `create-next-app` → Next 16.4.5, React 19.3, Tailwind 4.3; prod build 4.2 s. Disable Next 16's default `cacheComponents: true` for this build. pnpm 10.17. `ngrok` on PATH is a broken pyngrok shim — use Vercel previews or `cloudflared`.
- Python (agent 11): both 3.12.9 and 3.14.4 install/import yfinance 1.8.0, pymupdf, pdfplumber, pandas 3.1, httpx, fastapi. Pin 3.12 via uv anyway; beware pandas 3.x semantics.

**Structured quarterly results via XBRL — the results card needs NO PDF parsing (found by agent 05, independently validated by the coordinator 8 Nov 17:50 IST):**

- `GET https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=RELIANCE&size=100` (Safari UA + Accept) → 200 in 0.23 s; 22 rows with fields `symbol, cmName, qe_Date ("30-SEP-2026"), consolidated ("Consolidated"/"Standalone"/null), audited, broadcast_Date, type, type_Sub, xbrl (URL), ixbrl (HTML URL), xbrlFileSize, pdf_attach, seq_Id, revised_Date, revision_Remark`. Rows with `INTEGRATED_FILING_INDAS_*` (or `_NBFC_*`, `_BANKING_*` taxonomies per agent 05) are financial results; `INTEGRATED_FILING_GOVERNANCE_*` rows are not. Coverage: SEBI Integrated Filing from Q4 FY25 onward; older quarters via legacy `/api/corporates-financial-results` (frozen Dec-2024).
- The XBRL (`https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1750537_30102026093254_WEB.xml`, 103 KB, 0.07 s, plain UA) parses with stdlib ElementTree. Facts are **absolute rupees (INR), not crore** (divide by 1e7). Contexts: `OneD` = current quarter (2026-07-01..2026-09-30), `FourD` = YTD; **each filing carries only the current quarter + YTD, so QoQ/YoY comparatives come from the prior quarters' filings** (all listed by the same endpoint). Key tags verified: `RevenueFromOperations, OtherIncome, Income, FinanceCosts, DepreciationDepletionAndAmortisationExpense, ProfitBeforeExceptionalItemsAndTax, ExceptionalItemsBeforeTax, ProfitBeforeTax, TaxExpense, ProfitLossForPeriod, ProfitLossForPeriodFromContinuingOperations, BasicEarningsLossPerShareFromContinuingOperations, NatureOfReportStandaloneConsolidated, WhetherResultsAreAuditedOrUnaudited, DateOfStartOfReportingPeriod, DateOfEndOfReportingPeriod`.
- RIL Q2 FY27 consolidated check: Revenue 3,32,861 cr; Other income 5,793; Finance costs 8,481; D&A 15,315; PBEIT = PBT 38,613 (exceptional 0); Tax 9,363; PAT 29,550; EPS 18.88. EBITDA (ex-other-income convention) = PBT + FinCost + D&A − OI = 56,616 cr; incl. OI = 62,409 cr — present the convention explicitly.
- Agent 05 also found BSE JSON equivalents (`Corp_BSEDnBResults_SEBI_Consolidated_Res_ng`, `Corp_detailedResult_Transpose_ng`) matching NSE to the rupee → use as cross-check. Banks/NBFCs use different taxonomies (NII/PPOP/PAT) — handle per agent 02's formats.
- Consequence: the Push results card = deterministic code over XBRL (5 quarters, QoQ/YoY, checksums), zero LLM tokens, sub-second; PDFs remain only for narrative (press release / investor presentation) and as a last-resort fallback for filers missing XBRL.

**Announcement feed reliability (agent 05, measured):** NSE 40/40 calls 200 (p50 0.20 s), full per-symbol history back to 2004 in one call, market-wide windows up to 365 days; NSE vs BSE 298/306 items matched within ±30 min (median 26 s apart) → NSE primary, BSE enrichment/failover. New since ~7 Nov 2026: NSE items carry a `voiceSummary` (100–150-word summary) on 453/455 live items. Classification: NSE `desc` alone labels 69%, regex over `desc`+`attchmntText` another 27%, BSE sub-category 2%, **~1.6% residue needs an LLM**. Failure modes are deterministic: default `python-requests` UA gets tarpitted (hangs), no-UA attachment downloads hang, Brotli garbage if `br` advertised without decoder → always set UA, Accept-Encoding gzip, hard timeouts.

**Portfolio verification (agent 21, `docs/research/21-portfolio-verification.md`, `data/seed/portfolio.json`) — gaps every builder must handle:**

1. Transcript discovery must UNION screener + NSE announcements + BSE (screener misses VEDL/MARUTI quarters; links may point to company IR domains). 7 Q2 FY27 transcripts are still pending → a "call held, transcript pending" state is required.
2. XBRL varies 14–140 KB; `ProfitLossAttributableToOwnersOfParent = 0` trap (RAJESHEXPO); HAL files *Audited* quarterlies; `NONINDAS` label exists; `Revision` rows exist (RAJESHEXPO has 10 revisions) → prefer the latest revision per (period, basis).
3. No-concall names (RAJESHEXPO, TRENT, ITC) need an AR-only degradation path for Pull.
4. Short histories (OLAELEC: 3 legacy quarters) break "trajectory to 2021" → trajectory must render whatever depth exists.
5. Zero portfolio filings in the last 24 h over the Diwali weekend → the default window must auto-widen (and say so). Muhurat bar is 0.03–0.5× normal volume for every name → exclude special sessions from baselines.
6. Best demo material: THERMAX −17.3% on 17.3× volume (6 Nov, day after results); PIIND −19.1% on 30× (5 Nov); MARICO +10% on 8.2× (3 Nov); results in-window: KALYANKJIL 10 Nov (a holiday!), IDEA/AMBER/OLAELEC 12 Nov, TMPV/INOXWIND 13 Nov; HDFCBANK has two "Change in Management" filings (31 Oct, 6 Nov).

## Human actions required before submission (cannot be done by agents)

1. `vercel login` (interactive browser auth) — needed for the deployed mobile link. Alternative: connect the GitHub repo in the Vercel dashboard for auto-deploys.
2. GitHub: SSH is denied (no identities); a fine-grained PAT for `ansh200516` in the macOS keychain works over HTTPS (64 repos visible) but repo-creation/push scope is unverified. Create the repo in the browser (or `brew install gh && gh auth login`) and test one push before the final day.
3. Optional: read the project's real quotas at aistudio.google.com/rate-limit; optionally link billing (Tier 1) as insurance only — the design target remains free tier.
4. Housekeeping: `~/.cursor/mcp.json` embeds a Tavily key inline — move it to an env reference.

## Rules for agents

- Keep ALL scratch work (venvs, test scripts, downloaded PDFs, notebooks) outside the repo, e.g. under `/tmp/finn-<yourname>/`. Use `uv venv --python 3.12 /tmp/finn-<yourname>/.venv` for Python experiments.
- Write your final report to `docs/research/NN-<your-name>.md` (the coordinator tells you the exact filename). Make it dense, specific, evidence-backed: include URLs, exact API endpoints, response shapes, measured latencies, error rates, code snippets that actually ran, and explicit confidence levels. Flag anything you could not verify.
- Do not fabricate. If something failed, say so and describe the fallback.
- Do not modify files outside `docs/research/` without being told to.
- Be opinionated. End with a prioritised list of recommendations and a list of the assumptions other agents should challenge.
