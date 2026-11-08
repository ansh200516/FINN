# 09 — Adversarial evaluation: every way FINN fails, and how we grade ourselves

Role: adversarial evaluator. Written **before** any code exists, so that the build is shaped by how it will be graded, not by what is fun to build.
Inputs: `docs/challenge/brief.txt` and `docs/challenge/reference.txt` (read twice), `docs/research/00-shared-context.md`, plus live probes run from the build machine on **Sun 8 Nov 2026, 17:17–17:35 IST** (scratch in `/tmp/finn-adversarial/`). Everything marked **[verified]** was observed in those probes; **[reported]** is from current public sources I did not reproduce; **[assumption]** is my model of the graders.

---

## 0. Facts about the week that change the demo (verified)

These are not in the brief and most teams will miss them.

| Fact | Evidence | Consequence |
|---|---|---|
| **Sun 8 Nov 2026 = Diwali; a Muhurat session ran 14:20–15:30 IST** | NSE circular NSE/EGR/76928 (19 Oct 2026) [verified via search] | yfinance will contain a **Sunday bar with ~5–10% of normal volume**. Any "volume vs N-day average" computed on or including that day is skewed; a naive "today vs average" on that bar flags every stock as abnormal. Weekday-only assumptions break. |
| **Tue 10 Nov 2026 = NSE/BSE holiday (Diwali-Balipratipada)** | NSE circular CMTR71775 [verified] | No EOD bar on 10 Nov. Pipelines that assume "yesterday had a close" produce NaN/stale states. Build week has only 4 trading days (9, 11, 12, 13). |
| **Sat 14 Nov 2026 = SEBI Reg. 33 deadline for Q2 FY27 results (45 days from 30 Sep)** | SEBI LODR Reg. 33(3)(a); board meetings run on Saturdays (EIFFL met Sat 7 Nov 15:00 — [verified] in filing text) | Results flow peaks 9–14 Nov, then **stops**. The default "last 24h" window during grading (16 Nov onward) will show transcripts, investor-meet intimations and newspaper ads — not results. The demo must not depend on live results appearing. |
| **Tue 24 Nov 2026 = holiday (Guru Nanak Jayanti)** | same circular | Another gap in EOD data during a plausible grading window. |
| **Filings cluster in the evening IST** | RELIANCE history, 3,375 filings: hours 16–21 IST hold 69%; **42% are time-stamped after 18:30 IST** [verified] | Every filing after 18:30 IST lands on the **wrong calendar day** if NSE's naive `an_dt` strings are parsed as UTC. Weekend/evening filings are missed by a Monday-morning "last 24h". |
| **RELIANCE had 0 filings in the trailing 24h and 3 in the trailing 7 days on Sunday 8 Nov** | [verified] | For a 20-stock portfolio the default 24h digest will frequently be **empty or near-empty** (weekends, holidays, off-season). The empty state is a first-class screen, not an edge case. |
| **NSE-wide firehose: 1,665 filings across 917 symbols on 6–7 Nov** (1,239 on Fri 6 Nov) | [verified] | Top categories: 425 investor-meet intimations, **386 "Copy of Newspaper Publication"** (pure noise, files up to **30 MB**), 181 "Outcome of Board Meeting", 75 investor presentations. Filtering/collapsing is the whole product; downloading attachments indiscriminately is a cost and latency bomb. |
| **76 symbol×day×category groups had >1 filing on those two days** | [verified] | Duplicates and multi-filing events (result + press release + PPT + newspaper ad) are the norm. Group into events or the digest looks like spam. |

---

## 1. Requirements ledger

Weight: ★★★ = graders will actively test it / it decides the grade; ★★ = noticed if missing; ★ = tie-breaker. "Visible proof" = what must be on-screen on a phone within a 2-minute demo.

### 1.1 Product scope

| # | Requirement / preference | Quote | Weight | Visible proof in 2-min phone demo | How submissions silently fail it |
|---|---|---|---|---|---|
| R1 | Mobile-first working prototype | "The deliverable is a mobile-first working prototype" / "make it easy for us to try on a phone" | ★★★ | Production URL opens in iOS Safari & Android Chrome, no login, first content < 2.5 s on 4G, no horizontal scroll, 44-px targets | Preview-deployment URL behind Vercel auth; desktop grid squeezed; login wall; 20-s cold start |
| R2 | Filtering, not aggregating | "The scarce skill is not aggregating information. It's filtering it: surfacing the few things that actually matter and burying everything else, beautifully." | ★★★ | Digest header shows **"47 filings → 6 need you"**; routine items collapsed under one row; the ranking is explainable on tap | A chronological list of everything; "AI summary" of each filing; nothing hidden |
| R3 | Part of a daily workflow | "a product they reach for through the day that saves them time" | ★★ | Opens on "what changed since you last looked"; one-thumb navigation; works on day 2 with new data | Home screen is a chat prompt or a marketing hero; no notion of "seen" |
| R4 | Two modes: Push and Pull | "It works in two modes of interaction: Push… Pull…" | ★★★ | Two obvious entry points; both demoable in 60 s each | Only chat (= Pull) with a "news" tab bolted on |
| R5 | Portfolio 15–20 names, mixed sectors/sizes | "choose your own mock portfolio of 15–20 NSE/BSE-listed companies… different sectors and sizes will show more" | ★★ | Portfolio list visible; includes a bank/NBFC, a small cap, an IT/pharma name, a PSU; results cards adapt per sector | 20 Nifty-50 large caps only, all with clean text PDFs; no bank (so the EBITDA problem never surfaces) |
| R6 | 3–5 ad-hoc research names | "pick a handful of companies (say 3–5), which can be outside your portfolio" | ★ | Research screen lists them as pre-warmed dossiers | Research only works for portfolio names |
| R7 | **Generalise to any NSE ticker** | "The research must not be hard-wired to your demo set… We may point it at a company you didn't pick." | ★★★ | Search box accepts any NSE symbol/name; cold path shows staged progress and finishes; graceful "no transcripts on record" for small caps (EIFFL has none [verified]) | Hard-coded JSON per demo company; crash on a ticker with a Dec/June fiscal year, no concalls, or a BSE-only listing |
| R8 | Data sources are plumbing | "Get them working; don't over-engineer them — this part is plumbing, not the point." | ★★ | Data freshness stamp ("as of 7 Nov 18:42 IST"); nothing more | Half the README is about scrapers; the product is thin |
| R9 | Windowed digest, user-chosen window, default 24h | "For a time window I choose — by default the last 24 hours, but let me pick the period" | ★★★ | Window chips: 24h / since last close / 7d / custom; counts update instantly; evening and weekend filings land on correct IST days | Fixed 24h; UTC day boundaries; Monday-morning digest empty |
| R10 | Prioritised, routine collapsed | "filtered and prioritised so I see what matters first and the routine stuff is collapsed or hidden" | ★★★ | Three tiers visually distinct; one-tap expand of "23 routine filings" | Flat list; "priority: medium" badges on everything |
| R11 | Triggered alerts: material types I care about | "a material announcement of a type I care about (results, M&A, management change, and so on)" | ★★★ | Per-category toggles; alert feed shows category + why | Alerts are the same list as the digest |
| R12 | EOD anomaly alerts, **configurable thresholds** | "volume more than ~2× its recent average, or a price move beyond ±X%… Make the threshold configurable: the point is that I decide what 'unusual' means" | ★★★ | Slider/stepper for volume multiple and ±%; alerts recompute live; ideally "this setting would have fired 4× in the last 60 days" | Threshold in a config file; no UI; false positives on expiry/rebalance/Muhurat days |
| R13 | **Management change → bio of incoming person** ("example we love") | "don't just say 'CFO resigned.' Pull a short background/bio of the incoming person (e.g. from LinkedIn)" | ★★★ | Card: outgoing → incoming, role, effective date, 3-line bio **with source** (the filing's SEBI-mandated "Brief profile" — present in SUPRAJIT's 7 Nov filing [verified]; web enrichment optional) | "CFO resigned" one-liner; LinkedIn scrape that never works; bio of a different person with the same name; hallucinated bio |
| R14 | **Quarterly results → Revenue, EBITDA, PBT, PAT; QoQ & YoY** ("example we love") | "take the actual results filing and give me a first cut of the headline numbers — Revenue, EBITDA, PBT and PAT — this quarter vs. last quarter (QoQ) and vs. the same quarter a year ago (YoY)" | ★★★ | 4×3 grid that fits a phone: metric / Q2 FY27 / QoQ / YoY; units (₹ cr); consolidated vs standalone label; EBITDA formula on tap; link to the PDF page; bank template swaps in NII/PPOP/provisions | Wrong column (half-year as quarter), lakhs read as crores, standalone mixed with consolidated, EBITDA "found" in text, LLM-computed % wrong, "(6)" parsed as +6 |
| R15 | Judgment for every other type | "For every other announcement type, decide what earns my attention: a one-line summary next to the filing, or just the filing surfaced at the right priority. That judgment is the point." | ★★★ | Order win shows "₹412 cr ≈ 6% of FY26 revenue"; pledge shows delta; newspaper ad shows nothing but a collapsed row | One-paragraph LLM summary of every filing (slop); or zero context on anything |
| R16 | Pull grounded in AR + transcripts **only** | "ground it in the primary sources (annual reports + transcripts). No broker notes, no news, no research reports, and don't lean on the model's own outside knowledge" | ★★★ | "Sources used" panel listing exact documents (date, pages); every claim has a tap-to-source citation; "not disclosed in the provided documents" appears when true | Model mentions a subsidiary/event not in the docs; answers about last week's news; bios on the Pull side from the web |
| R17 | Pull menu (8 items) — pick what you build | "Treat them as a menu: pick what you build and how deep you go" | ★★ | 2–4 sections done well; others visibly "not built" rather than stubbed | 8 sections all shallow; "bull vs bear" with no numbers |
| R18 | **Promised vs delivered** ("the kind of thing we value most") | "take the last four quarters and, against management's own headline guidance and growth commentary, tell me what was promised vs. what was actually delivered" | ★★★ | A table: guidance item · quote (speaker, call date, page) · metric promised · delivered (from results) · verdict (met / missed / unverifiable) | Summaries of each call; no linkage to actual numbers; guidance that was never given ("promised 15% growth") |
| R19 | Interaction model: a point of view | "The best submissions will show a point of view about how an investor should interact with this, not just what data to show" | ★★★ | Stated in one sentence in README and visible in the home screen (e.g., "it tells you; you only ask when you want to go deeper") | Chat box as the front door; dashboard of cards with no hierarchy |
| R20 | No AI slop: core, concise, beautiful, interactive, dense | "core, concise, beautifully presented, and interactive… feel like a product someone thought hard about, not a model filling a template. Density and design both count." | ★★★ | Numbers everywhere, tabular figures, no paragraphs > 2 lines, no "Key insights" cards, no emoji, no gradient hero | See §2.4 slop tells |
| R21 | Model routing / efficiency | "Efficiency earns bonus points… Smart model routing (cheap models for bulk extraction, a stronger model only where reasoning demands it), caching, and chunking" | ★★ | Per-item cost/model footer ("classified by rules; extracted by Flash-Lite, 2.1k tokens, ₹0.02"); README routing table; cache-hit stats | "We use GPT-5 for everything"; no numbers; or a 200k-token AR stuffed into every prompt |
| R22 | Thin-but-working; a demo that doesn't run is the worst outcome | "Thin-but-working beats broad-but-broken… A demo that doesn't run is the worst outcome." | ★★★ | Everything on screen works; offline/degraded states exist; a 90-s demo video is linked as insurance | Spinner that never resolves; 500s from a paused DB; features visible but disabled |
| R23 | Smallest thing that proves you can build the real thing | "Build the smallest thing that proves you can build the real thing well." | ★★ | One or two workflows end-to-end incl. data refresh | Many half-built tabs |

### 1.2 Submission logistics (binary — any miss is fatal or embarrassing)

| # | Requirement | Quote | Proof |
|---|---|---|---|
| L1 | Email to **assessment@enam.com** | "Submit your response in an email with the links and attachments to assessment@enam.com" | Sent from an address you will monitor; test-send to yourself first |
| L2 | Subject **exactly** `IIT Delhi – AI Engineer - 2027` (en dash after "Delhi", hyphen before "2027") | "with the subject line as 'IIT Delhi – AI Engineer - 2027'" | Copy-paste from the brief; do not "fix" the dashes — their filter may be literal |
| L3 | Deployed link usable on a phone | "a deployed link, Expo/TestFlight, or responsive web" | Production URL, HTTPS, no auth, tested in private tab on iOS Safari and Android Chrome from a **cellular** connection |
| L4 | GitHub repository | "The GitHub repository" | Public (or invite granted); README renders on a phone; no secrets in history |
| L5 | AI build history | "the coding-agent and LLM conversations you used while building (e.g. Claude Code, Cursor, or ChatGPT exports / share links). We want to see how you work with the tools" | Exported transcripts (Cursor JSONL → readable Markdown) in a `build-history/` folder or Drive link, plus a 1-page curated index of key sessions; secrets scrubbed |
| L6 | Covering writeup in the email body | "A short writeup (in your covering email) Cover what you built, the key decisions and trade-offs, what you deliberately left out, and where you'd take it next." | ≤ 450 words in the body, four headed sections, links at the top |
| L7 | Deadline **15 Nov 2026** (Sunday; no time zone given) | "Deadline: 15 November 2026" | Treat as 15 Nov 12:00 IST; freeze code 14 Nov evening; keep the last 24 h for the phone script (§5.3) and email |
| L8 | Keep attachments small | implied | Build history as a link if > 10 MB; no zip of `node_modules` |

---

## 2. Grader model [assumption, informed by the brief's language]

### 2.1 Who reads it
- **Reader A — investor/PM who owns the "AI intelligence layer."** Finance-fluent (the brief distinguishes primary vs secondary data, uses "numbers vs narrative", "cash conversion"). Knows every large-cap number cold. Reads on a phone, probably in the evening or between meetings. Decides creativity, product sense, judgment.
- **Reader B — the engineer who will have to live with your code.** Opens the repo and the build history. Decides architecture, efficiency, "how you work with tools."
- Volume: this is campus hiring (`IIT Delhi – AI Engineer - 2027`). Expect **dozens of submissions**, so first-pass budget per submission is **3–5 minutes**, maybe 15 for finalists. Nothing you do not show in the first minute exists.

### 2.2 The first 60 seconds on their phone
1. Tap the link from the email (iOS Mail → Safari, cellular). If a Vercel login or an Expo Go install appears, they go to the next email.
2. First paint. If > 3 s or a layout shift, irritation; if a spinner > 8 s, tab closed.
3. They read the home screen **without tapping** for ~10 s. Question in their head: *"Does it know what happened in these companies this week — and did it filter?"* They will look for a company they follow and check whether the item shown is the one that mattered.
4. First tap: a results card (it is their worked example). They check one number they already know (e.g., a large cap's PAT). **If it is wrong, the submission is dead**; a wrong number is worse than no number.
5. Second tap: the management-change card. Is the bio real, sourced, the right person?
6. Third tap: Pull on a company they know deeply. They read for leakage (news, broker language, facts not in a transcript) and for whether "promised vs delivered" is actually a comparison or a summary.
7. They will type a ticker you did not pick. Likely a mid/small cap with messy filings, or a bank.
8. Reader B opens the README: architecture diagram, model-routing table, how to run, what is cached vs live, tests. Then skims the build history for signs of thinking vs pasting.

### 2.3 What makes them smile vs close the tab
Smile: a correct 4×3 results grid with the PDF page link; "47 → 6" filtering with the routine stuff truthfully collapsed; a bank card that shows NII/PPOP instead of pretending EBITDA exists; a dated transcript quote next to the delivered number; a threshold slider that says "would have fired 3× in 60 days"; a cost footer; an honest "quiet day — 2 routine filings" empty state; the covering note's "left out" section.

Close the tab: a chat prompt as the home screen; "Hello! I'm FINN, your AI investment assistant 👋"; a spinner while the server scrapes NSE; a wrong PAT; a bio of the wrong Rajesh Kumar; purple/indigo gradient hero; a pie chart of sector allocation; "Key Insights" cards with three bullets each and no numbers; a 6-line disclaimer; "bull case: strong brand, bear case: competitive intensity"; a sign-up form.

### 2.4 "Model filling a template" vs "someone thought hard" — concrete tells

| Slop tell | Why it reads as slop | Thought-through counterpart |
|---|---|---|
| Generic chat UI with suggested prompts ("Analyse my portfolio") | Blank-page problem, no prioritisation, ignores "filtering" thesis | Ranked feed; chat only as a scoped follow-up inside a dossier |
| Purple/indigo gradients, glassmorphism, rounded "AI" sparkle icons | Default Tailwind/shadcn palette = every other submission | Neutral, high-contrast, typographic; colour reserved for direction (up/down) and severity |
| Bullet summaries without numbers ("Revenue grew strongly") | Unfalsifiable, un-cited, vague | "Revenue ₹4,177 cr, −1.8% QoQ, +7.7% YoY (consolidated)" |
| "Key insights" / "Highlights" / "Summary" cards | Template headings from a prompt | Headings that are claims: "Guidance missed on margins, met on volume" |
| Emoji in product text; exclamation marks | Consumer-chat register | None |
| Pie/donut charts; radar charts | Decoration, unreadable on phones | Sparklines, small-multiple bars with values printed |
| Hallucinated bios / un-cited claims | Reader A will know the person | Every fact has a source chip; bio prefixed "from the filing" |
| Uniform card grid where every item has the same visual weight | No judgment | Three tiers with different sizes; routine collapsed |
| Long disclaimers, "As an AI model…" | Model residue | One line in settings |
| Every pull section exactly 3 bullets | Prompt artefact | Variable length driven by evidence; "nothing disclosed" allowed |
| Dates like "Q2" without fiscal year or "2026-09-30T00:00:00Z" | Nobody looked at the screen | "Q2 FY27 (Jul–Sep 2026)" |
| Percentages with 4 decimals, mixed units (₹ cr vs ₹ mn), unsigned deltas | Nobody looked at the numbers | Tabular figures, 1 decimal, ₹ cr everywhere, signed deltas, parentheses for losses |

---

## 3. Failure-mode catalogue

Scale: likelihood L (1 rare – 5 near-certain) × impact I (1 cosmetic – 5 demo dead or credibility dead). Ordered within groups by L×I.

### 3.1 Data acquisition

| # | Failure | L | I | Evidence | Mitigation |
|---|---|---|---|---|---|
| F1 | **Live scraping during the grader's session** (NSE/BSE/Yahoo) times out or 403s | 5 | 5 | NSE is behind Akamai Bot Manager; policy changes month to month (nsepython shipped an "Akamai fix" in Oct 2026 [reported]); BSE API returned **403 Access Denied** to a well-headed curl from this machine [verified]; Yahoo "readily blocks shared cloud IPs" [reported] | **Never fetch external data on a user request.** Collector runs on a schedule (laptop/cron/GitHub Action), writes to storage; the app reads storage only. Snapshot the full demo dataset into static files committed or in blob storage so the UI works even if every upstream is dead. |
| F2 | NSE blocks the collector's **cloud IP** (Vercel/Render/GitHub Actions) | 3 | 4 | Per-endpoint Akamai gating: `quote-equity` 403 from both cloud and residential, `corporate-announcements` 200 from both (Aug 2026 Cloudflare Worker spike [reported]); my plain curl with a UA got 200 today [verified] — fickle | Run the collector where it works (residential IP, `curl_cffi` with Chrome impersonation), keep a BSE fallback *if* it can be made to work, and keep yesterday's data if today's fetch fails (stale-but-present beats empty). Log fetch health; show "data as of" in the UI. |
| F3 | **yfinance 429 / silent empty DataFrame** | 4 | 4 | yfinance 1.7.0 `download()` **returns an empty DataFrame on 429 instead of raising** [reported, apiwren 29 Oct 2026]; curl to Yahoo chart endpoint → 429 from this machine (shared context) | Treat empty frames as failures; retry with backoff; batch all tickers in one call; **prefer NSE bhavcopy** — one 624 KB zip/day for all 3,716 instruments from `nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip` (200 in 0.36 s [verified]) — it is the primary source and has `ClsPric`, `PrvsClsgPric`, `TtlTradgVol`, `TtlNbOfTxsExctd`. Keep yfinance for history backfill only. |
| F4 | Yahoo ToS / personal-use restriction raised by Reader B | 2 | 2 | Yahoo terms limit to personal use [reported] | Bhavcopy as the primary EOD source; mention in README. |
| F5 | **Attachment formats**: zip instead of PDF, 30 MB newspaper scans, XBRL-only | 4 | 3 | `SALSTEEL_ROID_104297_KMP_Doc.zip`, `MANAPPURAM_ROID_104248_KMP_Doc.zip`; newspaper PDFs 21–30 MB [verified] | Classify from NSE's `desc` + `attchmntText` first; download attachments lazily and only for categories that need extraction (results, management change, M&A, orders, pledges); size cap 8 MB; handle zip. |
| F6 | **Scanned PDFs** (image-only results) | 4 | 4 | EIFFL Q2 results: 7 pages, only **1,691 chars** of text (cover letter); TATACHEM: 20 pages, 99,112 chars [verified] | Detect low text density → route to a vision-capable model (Gemini reads PDF pages natively) or OCR; fall back to screener.in's quarterly table (normalised ₹ cr) with a "numbers from screener, filing is scanned" label. Budget: scanned small-cap results are the norm, not the exception. |
| F7 | screener.in changes markup / rate-limits / gates documents behind login | 3 | 4 | Documents section (ARs, transcripts, PPTs) served without login today; AR and transcript links point to **bseindia.com** PDFs which downloaded fine (29-page transcript, 187-page AR, 11 MB) [verified]; the quarterly table header shows Sep 2023 → Sep 2026 [verified] | Cache every document locally once fetched; keep the parser tiny and tested against a saved HTML fixture; polite rate (≤1 req/2 s), real UA. Note screener's AR links for older years go to `archives.nseindia.com/annual_reports/*.zip`. |
| F8 | No concall (and sometimes no AR) for the grader's ticker | 4 | 3 | EIFFL on screener: **0 transcript links, 0 investor presentations**, but Annual Reports 2023–2026 present [verified] — guidance extraction has nothing to work from; AR-only research is possible | Explicit state: "No transcripts on record for this company; guidance view unavailable — research limited to the annual report and results filings." Still show financial snapshot from results. Expect many small caps to look like this. |
| F9 | Ticker resolution fails for the grader's company (NSE symbol vs BSE code vs Yahoo suffix vs screener slug) | 3 | 4 | `EQUITY_L.csv` (200 [verified]) gives symbol/ISIN/name; screener search API returns 200 [verified] | Resolve via ISIN; preload NSE equity master; handle recent symbol changes; show the resolved legal name before running research. |
| F10 | GitHub Actions cron drifts or is disabled | 3 | 3 | Scheduled workflows can be delayed under load and are disabled after 60 days of repo inactivity [reported] | Not fatal if the UI serves last-good data; add a manual "refresh" admin route protected by a token. |

### 3.2 Extraction correctness (where credibility dies)

| # | Failure | L | I | Evidence | Mitigation |
|---|---|---|---|---|---|
| F11 | **Standalone vs consolidated mixed** (this Q consolidated, last Q standalone) | 4 | 5 | TATACHEM filing contains both "Unaudited Consolidated and Audited Standalone" [verified]; most filings do | Always extract both; display consolidated by default with a label; QoQ/YoY must be computed within one basis; cross-check with the filing's own comparatives. |
| F12 | **Units**: lakhs vs crores vs millions; rupee glyph lost | 4 | 5 | TATACHEM shows "( in crore)" — pdftotext **dropped the ₹ glyph** [verified]; small caps commonly report in lakhs; some MNCs in ₹ million | Parse the unit line without relying on the currency symbol; normalise to ₹ cr; sanity-check magnitude against market cap and against screener's table; flag ×100 jumps. |
| F13 | **Wrong column**: half-year/9M/FY read as a quarter; variable column count by quarter | 4 | 5 | Q2 filings have 6 columns (Q2, Q1, Q2 LY, H1, H1 LY, FY) [verified in TATACHEM]; Q1 has 4; Q3 has 6 (9M); Q4 has 5 | **Use period end dates from the header, not position.** Mandatory checksum: Q1+Q2 = H1 (TATACHEM 4,255+4,177 = 8,432 ✓ [verified]), Q1+Q2+Q3 = 9M, 4 quarters = FY. If the checksum fails, mark the card "unverified" and do not show percentages. |
| F14 | **Negative numbers in parentheses** parsed as positive | 4 | 5 | TATACHEM PBT "(6)", PAT "(50)" [verified] | Parser rule; also QoQ% when the base is negative or crosses zero is meaningless → render "swung to loss" / "loss narrowed", not "−105%". |
| F15 | **EBITDA is not a reported line** in SEBI format; derivation conventions differ; exceptional items; share of JVs | 5 | 4 | TATACHEM has "profit before exceptional items, share of profit of joint ventures and associate", exceptional (65), finance costs 151, D&A 351 [verified] | Define once: EBITDA = PBT before exceptional items + finance costs + D&A (state whether other income is included); show the formula on tap; never "find" EBITDA in prose (that is usually the investor presentation's adjusted figure). |
| F16 | **Banks/NBFCs/insurers do not fit Revenue/EBITDA/PBT/PAT** | 5 | 4 | Bank results format: interest earned, other income, operating profit before provisions, provisions, PBT, PAT; NBFC finance cost is operating | Sector-aware templates: bank → NII, PPOP, provisions, PAT, GNPA/NNPA if disclosed; NBFC → NII, PPOP, credit cost, PAT; insurer → premium, VNB/PAT. Shows judgment; the brief wants mixed sectors so this will come up. |
| F17 | **LLM arithmetic** for QoQ/YoY | 4 | 4 | Known weakness | LLM extracts raw numbers only; code computes deltas; render with 1 decimal and sign. |
| F18 | **Fiscal-year assumptions**: Dec/June/Sept year-ends; "same quarter last year" computed from Indian FY labels | 3 | 4 | Several listed MNCs use Dec FY (e.g. Castrol India, Sanofi India, Linde India, Schaeffler — [reported], verify per company) | Compare on period-end dates; never on "Q2". Label as "Q2 FY27 (Jul–Sep 2026)" derived from dates. |
| F19 | dd.mm.yyyy dates parsed as mm/dd | 3 | 4 | "30.09.2026", "07th November, 2026" styles [verified] | Explicit Indian date parsing; never `new Date(string)`. |
| F20 | Layout extraction shifts numbers across columns | 3 | 4 | `pdftotext -layout` works on TATACHEM but wide tables wrap | Use a table-aware extractor (pdfplumber/camelot) or Gemini on the page image + checksum (F13). |
| F21 | Cross-source disagreement (filing vs screener vs presentation) | 3 | 3 | Screener normalises and sometimes restates | Filing is truth; screener is the cross-check; show "matches screener ✓" or "differs by X" quietly. |

### 3.3 Classification, dedup, timing

| # | Failure | L | I | Evidence | Mitigation |
|---|---|---|---|---|---|
| F22 | Mis-classification by an LLM when NSE already provides a category | 4 | 3 | NSE `desc` values: "Outcome of Board Meeting", "Appointment", "Resignation of Director/KMP/SMP", "Change in Management", "Credit Rating", "Bagging/Receiving of orders/contracts", "Copy of Newspaper Publication"… [verified] | Deterministic map NSE `desc` → reference taxonomy for ~80%; LLM (Flash-Lite) only for "Updates", "General Updates", "Press Release", "Outcome of Board Meeting" (which can be results or anything). Store the rule used. |
| F23 | `attchmntText` is incomplete or blank in places | 3 | 3 | SRPL: "Appointment of   as Chairman & Managing Director" (name missing) [verified] | Never show `attchmntText` raw; fall back to PDF first page when a key field is empty. |
| F24 | **Duplicates**: same event filed as 3–5 announcements; NSE and BSE both | 5 | 3 | 76 multi-filing groups in two days [verified]; "results" category in the reference explicitly includes the board meeting, the deck, and the newspaper ad | Group by (symbol, event type, ±24 h) into one event card with child filings; dedupe NSE/BSE by attachment hash or by (symbol, time ±5 min, size). |
| F25 | **Time zone**: naive IST strings parsed as UTC; server in UTC; "24h" boundaries | 5 | 4 | `an_dt` is naive ("06-Nov-2026 19:10:58"); 42% of filings after 18:30 IST [verified] | Parse as `Asia/Kolkata`; store UTC; compute windows in IST; label every timestamp IST; unit test with a 19:10 IST filing. |
| F26 | "Last 24h" is empty on Monday morning / after holidays | 5 | 4 | 0 filings in 24h for RELIANCE on Sunday [verified]; Nov 10 holiday | Default to "since previous trading-day close" or "since you last opened"; make the empty state informative ("Quiet: 2 routine filings; results season ended 14 Nov"). |
| F27 | Materiality judged without scale | 4 | 3 | Order wins of ₹5 cr and ₹5,000 cr share a category | Compute order/deal value as % of trailing revenue or market cap when extractable; otherwise rank by category prior. |

### 3.4 Anomaly alerts

| # | Failure | L | I | Evidence | Mitigation |
|---|---|---|---|---|---|
| F28 | **Muhurat session bar** (Sun 8 Nov, ~1 h) poisons averages and triggers alerts | 5 | 3 | Circular [verified] | Drop sessions < 2 h or mark as special; use median, not mean, for the baseline. |
| F29 | False positives on F&O expiry, index rebalance days, MSCI reviews, block deals, ex-dates | 4 | 3 | Nifty semi-annual rebalance effective last trading day of Sep (just passed) and Mar; MSCI Nov review implemented late Nov [reported]; monthly expiry currently last Tuesday [reported — verify] | Annotate alerts with context flags; let the user exclude known calendar effects; show "3.1× 20-day median" with the distribution. |
| F30 | Split/bonus day shows a −50% "price move" | 3 | 5 | Store-and-diff pipelines break on corporate actions | Recompute from a fresh adjusted series daily; detect via bhavcopy `PrvsClsgPric` jumps + corporate-action feed; suppress with explanation. |
| F31 | Small caps fire constantly at 2× (alert fatigue) | 5 | 3 | Illiquid names swing 3–5× routinely | Per-stock baseline (log-volume z-score) plus absolute turnover floor; **backtest preview**: "at 2× this would have fired 11× in 60 days; at 3×, 4×". |
| F32 | Partial-day volume if the collector runs before EOD files are final | 3 | 4 | NSE EOD finalises ~18:00–19:00 IST | Run after 19:30 IST; use bhavcopy (only published when final). |
| F33 | Missing bars on holidays → NaN deltas | 4 | 2 | Nov 10, Nov 24 holidays [verified] | Compare to previous available session; display the date compared against. |

### 3.5 Bios (Push enrichment)

| # | Failure | L | I | Evidence | Mitigation |
|---|---|---|---|---|---|
| F34 | LinkedIn scraping does not work (auth wall, ToS) | 5 | 3 | Common knowledge | Do not try. The filing contains a SEBI-mandated **brief profile** (SUPRAJIT 7 Nov: education, 30 years at Bosch [verified]). Use it as the anchor; optionally enrich with a web search restricted to the prior employer named in the filing. |
| F35 | **Wrong person** (same name) | 4 | 5 | Common Indian names; Reader A knows the person | Entity-match on prior employer/designation from the filing; show the source URL; if no corroboration, show only the filing profile. |
| F36 | Hallucinated bio for an unknown person | 4 | 5 | Models fabricate for low-frequency names | Never let the model write a bio from memory; bio text must be extractive from the filing or a fetched page. |
| F37 | Resignation with no incoming person | 4 | 2 | MANAPPURAM GCTO resignation 7 Nov [verified] | Card states "no successor named"; surface the reason line from the filing (SEBI requires the reason). |

### 3.6 Pull / grounding

| # | Failure | L | I | Evidence | Mitigation |
|---|---|---|---|---|---|
| F38 | **World-knowledge leakage** (subsidiary names, events, analyst views not in the docs) | 5 | 5 | Models know RELIANCE/TCS/HDFCBANK cold; graders will probe exactly this | Chunk-level citations required for every sentence; sentences without a citation are dropped before render; numbers must string-match the source; red-team test: ask about a post-document event, expect "not in the provided documents". Test with an obscure company too (hallucination direction flips). |
| F39 | "Promised vs delivered" degenerates into call summaries | 4 | 5 | It is the hardest and most valued output | Two-stage: (1) extract guidance statements with speaker/date/metric/horizon/quote (Flash-Lite over each transcript); (2) deterministic join to actuals by metric+period; (3) stronger model only for the verdict wording. Allow "guidance was qualitative — unverifiable" rows. |
| F40 | Fiscal-year guidance compared with a single quarter | 4 | 4 | "FY27 capex ₹X cr" vs Q2 capex | Carry the horizon; compare FY guidance to YTD run-rate with an explicit label. |
| F41 | Latency: cold research on a new ticker takes minutes | 5 | 4 | A 187-page AR = ~171k words (~230k tokens) [verified]; a transcript ~16.6k words (~22k tokens) [verified] | Stream sections as they finish; show step list with elapsed time; prewarm the demo set; cap AR to targeted sections (MD&A, segment note, cash flow) via page-level keyword routing; cache extractions by document hash. |
| F42 | **Gemini free tier is far smaller than teams assume** | 5 | 5 | Current free limits [reported, Oct 2026]: Flash **5 RPM / 20 RPD**; Flash-Lite 10–15 RPM / 500 RPD; Pro **0** on free; Gemma 4 30 RPM / 14,400 RPD; TPM 250k; RPD resets midnight Pacific (13:30 IST); quotas per project. Google no longer publishes the table — check AI Studio for *your* project. | A single cold-research run can exhaust Flash's daily quota. Decide now: link billing (Tier 1, $5 prepay) **or** route bulk to Flash-Lite/Gemma 4 and reserve Flash for ≤ 3 calls per research. Precompute demo-set outputs; cache aggressively; keep a second provider (Groq/OpenRouter free) as fallback. |
| F43 | Bull vs bear without numbers | 4 | 3 | Most slop-prone section | Either every point cites a number from the docs or the section is not built. |
| F44 | Research for a company with only standalone statements or recent IPO (<4 quarters) | 3 | 3 | Generalisation requirement | Degrade gracefully: show what exists, label what is missing. |

### 3.7 Infrastructure and mobile

| # | Failure | L | I | Evidence | Mitigation |
|---|---|---|---|---|---|
| F45 | **Supabase free project paused** when graders open it ≥ 7 days after you stop touching it | 4 | 5 | Supabase pauses free projects after ~1 week of low DB activity [verified docs] | Avoid a managed DB for the demo (static JSON/SQLite in blob) or add a daily keep-alive ping and a paid plan for 1 month. |
| F46 | Render free spin-down (15 min idle → ~1 min cold start) | 5 (if used) | 5 | Render docs [verified] | Do not host the API on Render free. Vercel Hobby functions: 300 s max duration [verified]; static-first anyway. |
| F47 | Vercel **preview** URL behind Vercel Authentication | 4 | 5 | Hobby: "Vercel Authentication for preview and production deployments" (production is public by default; previews are not) [verified docs] | Send the production domain; open it in a private tab on a phone that has never logged into Vercel. |
| F48 | ngrok/laptop-hosted demo dies when the laptop sleeps | 3 | 5 | — | Never for submission. |
| F49 | Slow first paint on mobile data (web fonts, chart libs, 300 KB JS) | 4 | 4 | Default Next.js + recharts + Inter | Budget: < 150 KB JS gzipped, system font stack or one subset font with `font-display: swap`, server-rendered digest, no chart library on the first screen. Test Lighthouse mobile / Slow 4G. |
| F50 | iOS Safari quirks: 100vh, safe-area insets, 16-px input zoom, fixed bottom bar hidden behind toolbar, hover-only affordances | 4 | 3 | Standard | Test on a real iPhone; `dvh`, `env(safe-area-inset-*)`, inputs ≥ 16 px. |
| F51 | PWA install / web push expectations | 3 | 3 | iOS web push requires Add to Home Screen | Do not depend on install. Manifest is fine; "push" is demonstrated in-app (badge, alerts feed) and optionally via email/Telegram digest. |
| F52 | Expo Go / TestFlight friction | 4 (if chosen) | 5 | Requires installs/invites | Responsive web. |
| F53 | Three graders hit the app simultaneously → rate limits or quota | 3 | 3 | Gemini 5 RPM | Nothing on the request path should call an LLM except explicit cold research; cache per ticker. |
| F54 | Secrets in repo or in exported build history | 3 | 4 | Terminal output in transcripts often includes keys | `gitleaks`-style scan on repo and exports; rotate keys before submission. |

---

## 4. Where the field will cluster, and how to be defensibly better

### 4.1 The median submission (what ~80% will build)
Next.js + Tailwind/shadcn + Vercel AI SDK **chat** home screen; yfinance in a Python/FastAPI service (or called from a serverless function on each request); NSE announcements via `nsepython`/`jugaad-data` fetched live; an LLM "summariser" per filing producing 3 bullets; a "Research" tab that stuffs whatever text it could scrape into a prompt and prints the 8 menu headings; a Supabase Postgres; maybe Pinecone/Chroma "RAG"; dark mode, gradient hero, bottom tabs Portfolio/Alerts/Research/Chat; thresholds in `.env`; bios from the model's memory; a README with a feature list. Failure profile: first paint 4–8 s, live fetch breaks during grading, wrong units on at least one results card, zero citations, empty Monday digest.

### 4.2 Ten ways to be visibly better — each tied to the brief's words

1. **Filter ratio as the hero number** ("filtering… burying everything else"): every digest starts with "N filings → k need you", and the collapsed k..N are one tap away with honest category labels. Nobody else will quantify their own filtering.
2. **Event grouping instead of filing lists** ("routine stuff collapsed"): results + press release + PPT + newspaper ad = one event with children. Immediately reads as judgment.
3. **The 4×3 results grid done correctly, with proof** ("first cut of the headline numbers"): period dates from the header, consolidated/standalone label, units, EBITDA formula on tap, Q1+Q2=H1 checksum badge, link to the PDF page, sector template for banks. Correctness is the differentiator because most will be wrong once.
4. **Bio from the filing, not from LinkedIn** ("short background/bio of the incoming person"): the SEBI-mandated brief profile is primary, sourced, and never wrong-person. Say so in the UI: "from the filing".
5. **Promised vs delivered as a reconciliation table, not prose** ("the kind of thing we value most"): quote · speaker · date · page · metric · promised · delivered · verdict. Include "unverifiable" rows — graders trust tables that admit gaps.
6. **Threshold controls with backtest feedback** ("I decide what 'unusual' means"): moving the slider instantly shows how many alerts it would have produced in the last 60 days per stock, with calendar-effect flags (expiry, Muhurat, rebalance). This is "interactive" in the brief's sense.
7. **Windows that match an investor's day** ("let me pick the period"): "since last close" default, 24h, 7d, custom; IST everywhere; weekend/holiday aware; an empty state that explains why it is quiet.
8. **Grounding you can see** ("primary sources only"): a sources drawer listing the exact documents used (type, date, pages), citation chips on every sentence, "not disclosed in the provided documents" as a legitimate answer, and a one-line statement of the red-team test you ran.
9. **A cost ledger in the product and the README** ("efficiency earns bonus points"): per item: rule vs model, tokens, ₹; per day for a 20-stock portfolio; cache hit rate. Routing table: rules → Flash-Lite/Gemma for extraction/classification → Flash only for reconciliation wording. Nobody will show numbers; show numbers.
10. **Static-first reliability** ("a demo that doesn't run is the worst outcome"): the entire demo dataset is served from static storage; live refresh is a background job; a 90-s demo video is linked in the email as insurance; a status line shows data freshness.

### 4.3 Team assumptions to challenge (verdicts)

| Assumption | Verdict | Why (in the brief's terms) |
|---|---|---|
| Chat is the right interface | **No as the front door; yes as a scoped follow-up.** | The brief's thesis is filtering; chat is pull-only, has a blank-page problem, hides density, and adds latency on every tap. Home = ranked digest. Inside a dossier, a question box scoped to the loaded documents is legitimate Pull. |
| More Pull sections = better | **No.** | "Thin-but-working beats broad-but-broken." Each section multiplies leakage and latency risk. Build financial snapshot (deterministic), promised-vs-delivered (hero), narrative-vs-numbers (if time). Mark the rest "not built" in the note. |
| We need a vector DB | **No.** | 4 transcripts ≈ 90k tokens; targeted AR sections ≈ 50–100k. Section-level routing by keywords + long context + caching beats RAG infra for 20 companies, and Reader B will see the unnecessary moving part. SQLite FTS if search is needed. |
| We need React Native/Expo | **No.** | Install friction kills the first 60 s. Responsive web, system fonts, server-rendered. |
| Push means OS notifications | **No.** | iOS web push needs Home-Screen install; graders will not install. Push = the app's proactive surface (digest, alert feed, badge) plus optional email/Telegram digest as a visible artefact. |
| Scrapers must run in the cloud | **No, and it is risky.** | Akamai/Yahoo treat cloud IPs worse; the collector can run from a laptop/cron and publish to storage. The grader never needs a live fetch. |
| Bull vs bear is valuable | **Only with numbers.** | Without citations it is the purest slop. Skip unless each line cites a figure. |
| The default 24h digest will have content | **No.** | Weekends, 10 Nov and 24 Nov holidays, post-14-Nov lull. Design the empty state and "since last close". |
| Free tiers are enough as-is | **Not for Gemini Flash (20 RPD).** | Decide billing vs routing to Flash-Lite/Gemma now; precompute. |
| Large caps make the best demo | **Partly.** | Include a bank, a small cap with scanned PDFs, a company with no concall — and show they are handled. That is where judgment becomes visible. |

---

## 5. Self-evaluation rubric

Score each iteration 0–5 per dimension. **Gate:** Demo reliability < 4 or Correctness < 4 → do not submit; fix first. Target for submission: ≥ 4 on every dimension, ≥ 4.5 average.

| Dimension (weight) | 0 | 1 | 3 | 5 |
|---|---|---|---|---|
| **Creativity / point of view** (1.0) | Chat box + cards | Dashboard with the 8 menu headings | A stated POV, partially embodied (e.g., ranked digest but research is a text dump) | POV stated in one sentence and visible in every screen: it tells you first; Pull is a reconciliation, not a summary; one idea the graders have not seen (e.g., threshold backtest, filter ratio, "from the filing" bios) |
| **Product sense** (1.0) | Everything shown, nothing hidden | Routine hidden, but no event grouping, no empty state | Grouping, tiers, "since last close", empty state exist; some cards still generic | Every pushed item answers "why should I care" with a magnitude; density high; no slop tells from §2.4; a finance reader nods |
| **Judgment / prioritisation** (1.0) | Eight shallow sections, live scraping | Six sections, two work | Two workflows end-to-end, rest explicitly cut; sector-aware results templates | Cuts documented with reasons; the hardest valued thing (promised vs delivered) is the deepest; nothing on screen is half-built |
| **Architecture & efficiency** (1.0) | LLM on every request; no caching; vector DB | Caching exists; one model for everything; no cost visibility | Rules → cheap model → strong model routing; costs logged; static-first | Routing table with measured tokens/₹ per item and per day; cache hit rate shown; collector/app separation; a stranger can run it locally in 10 minutes |
| **Correctness / grounding** (1.5) | A number the grader knows is wrong, or a hallucinated bio | Numbers mostly right, no sources | Numbers right with links; consolidated/units labelled; citations on most claims | Checksums (Q1+Q2=H1) pass and are shown; every Pull sentence cited; red-team leakage test documented; bank template correct; negatives and swings handled |
| **Mobile UX & density** (1.0) | Desktop layout; horizontal scroll | Responsive but sparse; chart library on first screen | Fits a phone; tabular figures; 4×3 grid; < 3 s first content | < 1.5 s first content on 4G; one-thumb; safe areas; every number signed/unit-labelled; nothing requires hover |
| **Demo reliability** (1.5) | Depends on live NSE/Yahoo/LLM at request time | Works on Wi-Fi from your laptop | Static-first; survives upstream failure; cold research shows progress | Survives: DB paused, upstream 403, 3 concurrent users, 7 days unattended, airplane-mode mid-session (shows cached); demo video linked |
| **Communication** (1.0) | README is a feature list | README has setup only | README has architecture, routing table, what is cached vs live, known failure modes | Plus: covering note answers §6's five questions in ≤ 450 words, build history indexed, cost stated, "left out" is specific |

### 5.1 Scoring notes
- A single wrong headline number caps Correctness at 1 regardless of everything else.
- A spinner > 8 s anywhere on the demo path caps Demo reliability at 2.
- Any slop tell from §2.4 on the home screen caps Product sense at 3.
- If the grader can type a ticker and get a dossier for a company with no concall without an error, add +0.5 to Judgment.

### 5.2 Pre-submission conditions
- Last deploy ≥ 48 h before the email, then **no deploys** — only the phone script below.
- Collector has run unattended for ≥ 3 consecutive days with health logs.
- Keys rotated; repo and build-history scanned for secrets.

### 5.3 The 10-step grader script (run on a real phone, cellular, private tab, three times: iOS Safari, Android Chrome, and iOS with Low Data Mode)
1. **Cold open** the production URL from the email draft. Stopwatch: first meaningful content ≤ 2.5 s; no login; no layout shift; no horizontal scroll. Note the "data as of" stamp — is it today or the last trading day?
2. **Read without tapping for 10 s.** Can you say what mattered across the portfolio? Count visible vs collapsed items; verify the collapsed ones really are routine (open three).
3. **Change the window** to 24h → since last close → 7d → custom range spanning the 10 Nov holiday. Counts must change; a filing time-stamped after 18:30 IST must sit on the right day.
4. **Open a results event.** Check: 4 metrics × (Q, QoQ, YoY); units; consolidated label; period dates; EBITDA formula on tap; **open the PDF and verify PAT and Revenue by eye**; confirm Q1+Q2=H1 badge. Do this for a bank too.
5. **Open a management-change event.** Name, role, effective date, bio with "from the filing" source; cross-check the name against the PDF. If web-enriched, the enrichment must mention the prior employer named in the filing.
6. **Alerts settings:** set volume 2×→3×, price ±3%→±6%. Alert list recomputes immediately; backtest counts change; calendar flags appear on 8 Nov (Muhurat) if present.
7. **Pull on a prewarmed company:** promised-vs-delivered table has quotes with speaker/date/page; tap a citation → the source opens at the right place; every delivered number matches the results card.
8. **Pull on a company you did not pick** (pick one mid-cap with a text PDF, one small cap with no concall such as EIFFL): progress steps visible within 1 s, first section ≤ 30 s, complete ≤ 3 min or an honest partial; the no-concall case degrades with a clear message.
9. **Red-team grounding:** ask about an event after the latest document, and about a well-known fact not in the documents. Expect "not disclosed in the provided documents"; scan output for news/broker vocabulary ("analysts expect", "reportedly").
10. **Degrade and read:** toggle airplane mode mid-session (cached content remains; clear offline state); reopen after 24 h unattended; then read the README and the covering note on the phone — can a stranger understand the architecture and run it? Does the build-history link open and is it indexed?

---

## 6. The covering note

### 6.1 Five questions it must answer (and that graders will look for)
1. **What exactly did you build, and what does it not do?** Two workflows named precisely (e.g., "a since-last-close digest with event grouping and sector-aware results cards; a promised-vs-delivered dossier for any NSE ticker"). One sentence each on what is out of scope.
2. **What is your point of view on how an investor should interact — and why not chat-first?** One paragraph, with the design consequence ("home screen is the ranked digest; questions are scoped to loaded documents").
3. **What were the hardest judgment calls and trade-offs, with costs?** Data source choices (bhavcopy over yfinance; filing profile over LinkedIn), model routing (what runs where and why), static-first over live, scope cuts. Include measured latency and ₹ per research / per day.
4. **How do you know the numbers are right, and where could they still be wrong?** Checksums, consolidated/units handling, citations, the leakage red-team, scanned-PDF fallback — and the honest residual risks (e.g., exceptional-item treatment in EBITDA).
5. **What did you deliberately leave out, and what is next?** Named omissions with the reason (not "time"): e.g., "no OS push — iOS requires install; the digest is the push surface"; "no bull/bear — not defensible without numbers in a week". Next steps that follow from the architecture, not a wish list.

Plus the mechanics at the top of the email: production URL, repo URL, build-history link, demo video link, "data snapshot as of …", and how long cold research takes.

### 6.2 Traps in writing it
- **Overclaiming:** "real-time", "production-ready", "fully automated", "AI-powered", "99% accurate". Graders will test the claim and the gap becomes the story. Use "end-of-day", "prototype", "manual refresh on demand".
- **Not stating what was left out** — or stating it as a feature list of the future. The brief asks for it explicitly; omission reads as either lack of judgment or hiding.
- **Describing features that are not in the demo**, or that fail on the phone script.
- **Marketing register:** "seamless", "leverages", "cutting-edge", "robust", emoji. Finance readers switch off.
- **Burying the links** below the prose; the subject line with "fixed" dashes; attaching large exports instead of linking.
- **Vagueness about models and cost:** name the models and the routing; give the number.
- **Hiding the snapshot:** if the demo serves a frozen dataset, say so and say how refresh works. Discovery feels like deceit; disclosure reads as engineering.
- **Claiming primary-source-only without evidence:** name the red-team test and what it showed.
- **Length:** > 500 words will not be read on a phone. Four headings, short paragraphs, no bullets inside bullets.
- **Pronoun confusion:** be clear whether it is one person or a team.

### 6.3 Skeleton (≤ 450 words)
Links (5 lines) → What it is (POV, 2 workflows) → What is deliberately thin or absent, and why → Key decisions and trade-offs with numbers (data, models, cost, latency, reliability) → How to verify it is right → Next → Build history pointer.

---

## 7. Top-10 risks, prioritised recommendations, and assumptions for other agents

### 7.1 Top-10 risks (likelihood × impact)
1. Live upstream calls on the request path (NSE Akamai, BSE 403, Yahoo 429) → demo dead. (F1–F3)
2. A wrong headline number — units, column, standalone/consolidated, parentheses — on a company the grader knows. (F11–F14)
3. Gemini free tier: Flash is 5 RPM / 20 RPD, Pro unavailable on free; quota exhausted during grading. (F42)
4. World-knowledge leakage in Pull on a large cap; hallucination on a small cap. (F38, F36)
5. Empty or misdated digest: UTC parsing of IST stamps, Monday/holiday windows, results season ending 14 Nov. (F25, F26)
6. Infra sleep: Supabase pause after 7 days, Render spin-down, Vercel preview auth wall. (F45–F47)
7. Promised-vs-delivered collapses into summaries. (F39)
8. Anomaly false positives: Muhurat bar, splits, expiry/rebalance, illiquid small caps. (F28–F31)
9. Scanned small-cap PDFs and zip attachments break extraction silently. (F5, F6)
10. Bank/NBFC results forced into Revenue/EBITDA, and "any NSE ticker" failing on no-concall or non-March FY companies. (F16, F18, F8)

### 7.2 Recommendations in priority order
1. Static-first architecture: collector (local/cron) → storage → app; no upstream or LLM call on the request path except explicit cold research with streaming progress.
2. Decide the Gemini billing/routing question on day 1; measure the project's limits in AI Studio; precompute demo-set outputs.
3. Build the results parser with fixtures from real filings (TATACHEM text, EIFFL scanned, a bank, a Dec-FY company); enforce the H1=Q1+Q2 checksum; label basis and units; deterministic deltas.
4. Parse all exchange timestamps as `Asia/Kolkata`; default window "since last close"; design the empty state.
5. Group filings into events; classify from NSE `desc` first; download attachments lazily by category and size.
6. Bios from the filing's brief profile; web enrichment only with entity corroboration.
7. Promised-vs-delivered as a two-stage extract-then-join with "unverifiable" rows; citations on every sentence; red-team test documented.
8. Thresholds with backtest preview and calendar flags; median baselines; adjusted series recomputed daily.
9. Run the 10-step phone script three times before sending; link a 90-s demo video; freeze deploys 48 h before.
10. Write the covering note from §6.3; export and index build history early (do not leave it for the last hour).

### 7.3 Assumptions other agents should challenge
- That the NSE `corporate-announcements` endpoint will keep returning 200 to a plain UA from this machine (it did today; Akamai policy changed in Oct 2026).
- That BSE's API can be made to work at all from scripts (it returned 403 with browser-like headers today).
- That yfinance from a cloud host will work during grading week; that the Muhurat bar appears in Yahoo data as a Sunday row (check on 9 Nov).
- That screener.in's documents section will stay login-free and that its transcript links (all on bseindia.com) keep downloading without cookies.
- That "Annual Report 2026" on screener is the full integrated report (RELIANCE's link was 187 pages, which looks abridged).
- That the grading window is 16–27 Nov and graders use iPhones — unverifiable, but design for the worst (cellular, Safari, private tab, 7 days after last deploy).
- That Gemini's limits quoted above match this project — read them in AI Studio before architecting routing.
