# 10 — Innovation concepts: a point of view on how an investor should interact with FINN

Independent innovation researcher · Sunday 8 Nov 2026 · scratch in `/tmp/finn-innovation/` (probe scripts, two downloaded KPIT transcripts, one Gemini experiment log).

Everything marked **[verified]** was run or fetched today from the build machine; **[reported]** means consistent across ≥2 third-party sources but not checked in our own account; **[assumption]** is a judgment call.

---

## 0. TL;DR

The conventional reading of the brief is "chat + dashboard". The brief itself tells us that is the floor, not the bar: *"the best submissions will show a point of view about how an investor should interact."* My point of view, after a day of probing data and adjacent products:

> **FINN should behave like a junior analyst who keeps the ledger, watches the tripwires, and interrupts rarely — and whose every sentence can be traced to a page of a filing.**

That resolves into three objects, not three features:

| Object | Conventional form | Our form |
|---|---|---|
| A **filing** | a row in a feed | a **card** whose shape depends on type, inside a **finite morning brief** that ends with "you're done" |
| A **commitment** management made | a sentence buried in a chat answer | a **ledger row** with a due date and a status (kept / on track / revised / withdrawn / quietly dropped) that accrues across quarters and *generates* push |
| A **condition** the investor cares about | a numeric threshold | a **tripwire** written in plain language ("if EBITDA margin < 18% for two quarters, or any new promoter pledge") compiled into watchers |

**Top 3 concepts (details in §5):** (1) **The Promise Ledger**, (2) **Thesis Tripwires**, (3) **The Finite Brief**. They share one pipeline and one grounding discipline, so the submission stays thin-but-working: the Brief *is* the required digest, Tripwires *are* the required configurable alerts, and the Ledger *is* the brief's most-valued worked example (promised vs. delivered) turned into a persistent product object.

**Three facts discovered today that change the plan:**

1. **The Gemini free tier is far tighter than the brief assumes.** Reported (three sources, Oct 21–Nov 5 2026) per-project daily caps: `gemini-3.8-flash` **20 requests/day** (5 RPM); `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` **500 RPD**; `gemma-4-31b-it` ~14,400 RPD; TTS models **10 RPD**; Pro models **0** on free. **[reported]** The live `models.list` on our key confirms these model IDs exist **[verified]**. Consequence: the strong model is a scarce resource (≈20 calls/day across the whole team), so everything bulk must run on Flash-Lite/Gemma and be cached; "efficiency earns bonus points" is not optional — it is forced. §7 has the budget.
2. **NSE's JSON endpoints answer to a plain Safari user-agent with no cookie dance** (the homepage 403s, the `/api/*` routes return 200) **[verified]**: event calendar (626 upcoming events today, 617 of them results), per-symbol announcement history (3,382 rows for RELIANCE, 723 for KPITTECH, with category `desc`, summary text, and PDF URL), board-meeting intimations, annual-report PDFs, insider trades, corporate actions. BSE's `api.bseindia.com` is **403 (Akamai) to us** — avoid it; screener's transcript links are BSE PDFs but those download fine (0.3 s) **[verified]**.
3. **The build week is the peak of Q2 FY27 results season** (SEBI's 45-day deadline is 14 Nov): the NSE calendar shows **184 companies reporting on 12 Nov, 211 on 13 Nov, 141 on 14 Nov** **[verified]**. Transcripts then arrive over the following five working days (SEBI LODR Sch. III 15(b)(iii)) — i.e., *during the evaluation week*. Pick portfolio names with results on 9–14 Nov and the push side demos itself; add a replay mode so it also demos on a quiet Sunday.

---

## 1. Who the user is, and what "interaction" should mean for them

- A small team making **high-conviction** decisions and living with the outcomes. Their unit of time is the quarter, not the tick. Their scarce resource is attention; their biggest risk is not missing a filing but **missing a slow change in management credibility** — the guidance that quietly drifts, the capex that keeps slipping, the margin target that stops being mentioned.
- They already have Bloomberg-style aggregation if they want it. What they do not have is a product that **knows their thesis**, remembers **what management said last time**, and has the discipline to stay silent.
- So the question "chat or dashboard?" is the wrong axis. The right axes are: **(a) how often does it interrupt, and with what evidence; (b) what does it remember across quarters; (c) what can the investor teach it.** Each top-3 concept is a strong answer to one axis.

---

## 2. Adjacent-domain scan → interaction primitives

| Domain / product | What it does well | Transfer to FINN | Verdict |
|---|---|---|---|
| **Flighty** (flight tracking) — tracks the inbound aircraft 25 h ahead, predicts delays up to 6 h before the airline admits them; Live Activities on the lock screen **[verified from flighty.com]** | Proactivity by watching *precursors* of the event, not the event | The "inbound legs" of a results event are all filed: board-meeting intimation (≥2 working days before a call), investor presentation (before the call), audio link (≤24 h), transcript (≤5 working days). Build an **earnings-week timeline** per company and tell the investor what is about to land and what is *late*. | Strong. Folded into Ledger (pre-read) and Brief (upcoming strip). |
| **Medical triage** — ESI/Manchester five-level triage; **SBAR** handoff (Situation, Background, Assessment, Recommendation) | Severity tiers decided by protocol, not by volume of paperwork; a handoff format that forces "so what" | Brief tiers: **Act / Read / Skim / Filed**. Card body in SBAR order: what was filed → what the primary sources say → what it means vs. guidance/thesis → what to do (read transcript / nothing). | Strong. Use the tiers and SBAR; drop the medical vocabulary. |
| **Intelligence briefings** — PDB, **BLUF** (bottom line up front), ICD-203 estimative language ("likely", "roughly even chance") with explicit confidence and "what we don't know" | Dense, prioritised, honest about uncertainty, short | Every card leads with one BLUF line (≤18 words). Every analytic sentence carries an estimative word + source count: *"Likely (2 transcripts, 1 AR)"*. A "what we don't know" footer. | Strong, cheap. Small detail #3. |
| **Sports live-trackers** — key-moments filter, win-probability curve | Collapsing a long stream to the few moments that moved the outcome | "Key moments" filter for a quarter's filings = the Brief's collapse. Win probability → **no**: a single-number "stock health" invites exactly the false precision the brief warns about. | Take the collapse; refuse the number. |
| **Duolingo streaks** | Engagement via habit loops, guilt, daily goals | **Wrong here, deliberately.** The brief's success metric is *time saved*; a streak optimises *time spent*. Streaks also nudge toward action (over-trading) when the correct action most days is nothing. The *inverted* version works: a counter of **quiet days** ("nothing needed you for 6 days") and a daily "you're done" — reward for *not* opening the app again. | Reject; keep the inversion (small detail #1). |
| **Superhuman** — split inbox, "get to zero", **"remind me if no reply"** | Triage speed; an alert for *absence* of an expected event | "Remind me if no reply" → **silence alerts**: transcript not filed within 5 working days; promise due date passed with no mention; no concall scheduled for the first time in 8 quarters. "Get to zero" → the finite brief. | Strong. Concept 11, folded into Ledger/Brief. |
| **Tinder-style card triage** | One-thumb decisions; muscle memory | Swipe left = "never show this filing type for this company"; right = "always alert me". The *memorable* part is that the filter visibly learns: "you've taught FINN 7 rules". Unconstrained swiping of filings is a gimmick. | Constrained version only (concept 10). |
| **Apple Watch complications** | One glance, one number, no navigation | The app's first paint is a complication: **"3 need you · ~4 min"** before any list renders. PWA can't do real widgets; the badge count (Badging API works in iOS Home Screen web apps **[verified: WebKit docs]**) can carry "3". | Adopt as the Brief's header. |
| **Voice assistants** | Hands-free, commute | A "play my brief" button is enough; two-way voice Q&A on a phone over a Vercel function with 20 strong-model calls/day is a demo that will fail live. | Audio out: yes (concept 6). Voice in: no. |
| **NotebookLM Audio Overviews** | Two-host audio makes dense material tolerable on a commute | The public Audio Overview API exists only in Gemini Notebook Enterprise (pre-GA, licensed) **[verified: cloud docs]** — not usable. Substitute: `gemini-3.8-flash-tts` multi-speaker, **10 RPD free** → one cached daily brief is feasible; a per-company audio is not. Fallback: on-device `speechSynthesis` (free, en-IN voices). | Feasible as a single cached artefact. |
| **Arc "Browse for Me"** | Shows the agent reading sources, then composes a page | Arc is being sunset (Browse for Me turns off 23 Nov 2026) **[verified: arc.net]** — cite the pattern, not the product. The transferable bit is the **progress screen**: "Reading Q2 FY27 transcript (22 pp)… 2 commitments found" while first-time research runs 60–90 s. Turns latency into trust. | Adopt for on-demand research of a new ticker. |
| **Perplexity Pages / Comet** | Shareable cited pages; scheduled tasks | Shareable **filing card** image with footnoted sources (concept 9); "scheduled tasks" = the Ledger's due-date watchers. | Adopt the artefact idea. |
| **Generative UI** (Vercel AI SDK) | Model output rendered as components | Use **AI SDK UI typed tool parts** (`tool-<name>` with `input-available / output-available` states); AI SDK RSC `streamUI` is still marked experimental and not recommended for production **[verified: ai-sdk.dev]**. Our use is narrower and safer: the model emits a **typed card** (discriminated union on `card_type`); the client renders it. No streaming UI trees. | Adopt the typed-card version (concept 7). |
| **Timeline scrubbers** | Scrub time, see state | Scrub the Brief to any past date ("what would FINN have shown me on 28 Oct?") — doubles as **replay/demo insurance** (concept 12) and as the Ledger's quarter scrubber. | Adopt. |
| **Diff views** (GitHub PR) | Change is more informative than state | A *textual* diff of two transcripts is noise (different analysts, different questions). A **semantic diff of claims** (extract structured claims per quarter, diff the sets: added / removed / changed) is the useful object (concept 5). "Words that disappeared" ("margin expansion" last mentioned Q4 FY26) is the memorable row. | Semantic only. |
| **Promise ledger / commitment tracking** | Project-management discipline applied to people's words | The core of concept 2. | Top 3. |
| **Confidence meters** | Visible uncertainty | Only if tied to *evidence count and verbatim-match*, never a free-floating %. | Adopt as estimative language + source count. |
| **Counterfactual alerts** ("this didn't happen") | Absence as information | Concept 11 (silence detector), anchored in *rules* (SEBI deadlines, the company's own cadence) so it is not hand-wavy. | Adopt. |
| **Quiet hours / attention budgets** | Protecting focus | No pushes 09:15–15:30 IST unless a tripwire fires; the Brief is capped at 5 cards and declares its budget up front. | Adopt (part of the Brief). |

---

## 3. Concept catalogue

Scoring: **M** = memorability to a high-conviction investment team (1–5); **F** = honest feasibility in 7 days on the free tier *including a working phone demo* (1–5); **Gimmick** = risk it reads as a toy (L/M/H); **Score = M × F**.

### C1 · The Finite Brief — "You're done for today."
**Pitch.** The morning brief is a *finite* object, not a feed. It opens with a complication — "Mon 9 Nov · 31 filings across 18 companies · **3 need you** · ~4 min" — then shows at most five typed cards in triage order (Act / Read / Skim), each with a BLUF line and SBAR body, and ends on a hard stop: "You're done. 28 routine filings filed away →". No infinite scroll, no pings during market hours unless a tripwire fires, a window scrubber (last 24 h / since my last visit / 7 d).
**Why this user.** They want fewer, better interruptions. A product that *ends* is a product that respects the team's attention and signals that "nothing today" is a legitimate, confident output.
**Data.** NSE per-symbol announcements (`/api/corporate-announcements?index=equities&symbol=X`: `desc`, `attchmntText`, `attchmntFile`, `an_dt`) **[verified]**; results PDFs (the SEBI results format carries *current quarter, preceding quarter, corresponding quarter last year* in one table → QoQ and YoY from a single document); appointment filings carry a brief profile of the appointee (SEBI requires it) → the "incoming person" bio is mostly primary, with optional Google-Search grounding (free, 500 RPD shared with Flash-Lite **[reported]**) for prior roles. EOD via yfinance.
**Feasibility.** High. Classification is mostly deterministic on `desc` (observed values include `Financial Result Updates`, `Outcome of Board Meeting`, `Change in Management`, `Appointment`, `Dividend`, `Record Date`, `Acquisition`, `Spurt in Volume`, `Trading Window`, `Copy of Newspaper Publication`, `ESOP/ESOS/ESPS`…) with an LLM only for the ambiguous buckets (`Updates`, `General Updates`, `Press Release`, `Outcome of Board Meeting`) on Gemma 4/Flash-Lite. The daily lead sentences are 1 strong-model call/day — or none, if written from the structured card fields.
**60-s demo.** Open PWA → complication → three cards (results QoQ/YoY table; management change with bio; a dividend one-liner) → "You're done" → tap "28 filed away" to prove nothing was hidden silently.
**Gimmick risk.** Low. The risk is the opposite: looking conventional. The "done" state, the budget header and the triage tiers carry the POV.
**M 4 · F 5 · Score 20 · Gimmick L.**

### C2 · The Promise Ledger
**Pitch.** Every forward-looking statement management makes on a call becomes a row: metric, verbatim quote, speaker, target, horizon, first-seen quarter, last-seen quarter, status. Each new transcript re-adjudicates open rows — **kept / on track / revised up / revised down / withdrawn / not mentioned** — and "not mentioned for 2+ quarters" surfaces as **quietly dropped**. Due dates ("by Q4 FY27") feed a **guidance calendar**; the ledger auto-writes **three questions for management** from the gaps; two days before a scheduled call it assembles a **pre-read** ("what to listen for"). Track record is shown as counts (7 kept / 2 missed / 3 dropped), never as a score.
**Why this user.** This *is* the brief's "difference between summarising management and analysing them", made persistent. A high-conviction holder's edge is knowing when a management team's words stop matching its numbers earlier than the market does.
**Data.** screener.in company page → "Concalls" rows with month label + Transcript (BSE `AnnPdfOpen.aspx?Pname=<guid>.pdf`) + PPT + REC (mp3) **[verified: 20 transcript links for RELIANCE and KPITTECH]**; NSE announcements with `desc = "Analysts/Institutional Investor Meet/Con. Call Updates"` and "Transcript" in the text as a second source (nsearchives PDF) **[verified]**; results PDFs for delivered numbers; screener quarterly table as cross-check. NSE's structured results endpoint (`/api/corporates-financial-results`, with XBRL links giving `RevenueFromOperations`, `ProfitBeforeTax`, `ProfitLossForPeriod` deterministically) **stops at Dec 2024 for both companies tested** **[verified]** — usable for history, not for current quarters.
**Feasibility.** Medium-high. **Ran end-to-end today on KPIT Q1 FY27 → Q2 FY27 with `gemini-3.5-flash-lite`:** transcripts are 22 pp / ~8.6k words / ~12.8k tokens each; extraction call 2.0 s, adjudication call 2.9 s; the model extracted 2 commitments (H2 > H1 and "return to growth by Q4"; "22–24% margin aspiration by FY29"), adjudicated both as *on track* with the Q2 quote "we have mentioned last time that H2 will be better than H1… we will maintain that" (verified verbatim at line 460 of the Q2 text), pulled delivered numbers (6.5% YoY growth and 17.8% EBITDA margin — both verified against the transcript; its "0.5% CC QoQ" was *not* found, the transcript says 1%), and wrote three pointed questions (on the top-two-client decline, the QORIX timeline slipping to 2029–30, and fixed-price mix vs. the FY29 margin target). **Two honest problems surfaced:** recall was low (regex finds ~29 guidance-like lines in Q1; one Flash-Lite pass returned 2 commitments → chunk by speaker turns or run two passes), and **one of two evidence quotes was fabricated by copying the prior-quarter quote** — caught only because I string-matched quotes against the source. The verbatim gate is therefore a hard requirement, not polish.
**60-s demo.** Pull → KPIT → Ledger: 8 rows, statuses coloured, tap a row → both quotes side by side with page numbers → "Questions for the Q3 call" → "Pre-read" tab.
**Gimmick risk.** Low if every status has a quote; high if it shows a credibility *percentage*.
**M 5 · F 4 · Score 20 · Gimmick L.**

### C3 · Thesis Tripwires — "What would change my mind."
**Pitch.** For each holding the investor writes, in plain language, why they own it and what would make them sell: *"Thesis: margin recovery to 20%+ by FY27 on fixed-price mix. Tripwires: EBITDA margin < 18% for two consecutive quarters; any promoter pledge; top-client revenue decline mentioned on a call; capex guidance raised > 20%."* FINN compiles each into a watcher — numeric ones run in code over EOD and extracted results; textual ones run as one batched Flash-Lite check per new filing/transcript — and only interrupts when a tripwire fires, with the evidence quote attached. A **thesis health strip** per holding shows green/amber/red *with the triggering fact*, never a number.
**Why this user.** This is what "I decide what unusual means" looks like for a conviction investor. The brief's ±X% price move and 2× volume are tripwires too — the generalisation costs little and reframes the whole alert system around the investor's own reasoning.
**Data.** EOD (yfinance); results numbers (results PDF extraction from C1); NSE pledge (`/api/corporate-pledgedata`), insider trading (`/api/corporates-pit`), corporate actions, announcements **[all verified reachable]**; transcripts (C2).
**Feasibility.** Medium (3.5/5). Compile step: 1 strong-model call per tripwire, user-triggered, maybe 20 in the whole demo. Evaluation: numeric in code; textual = 1 Flash-Lite call per new filing carrying all active textual tripwires for that company (≤30/day). The hard part is demoing a *trip* on a quiet day → needs replay (C12) or seeded historical filings.
**60-s demo.** Holding → "What would change my mind" → type one sentence → watch it compile into two watchers → scrub replay to 28 Oct → the margin watcher fires on the Q2 results PDF with the quote and the number.
**Gimmick risk.** Medium: a fuzzy "AI thinks your thesis is at risk" is a toy; a watcher that cites "EBITDA margin 17.8% (Q2 FY27 transcript, p. 7) vs. your 18% floor" is a tool.
**M 5 · F 3.5 · Score 17.5 · Gimmick M→L with evidence gate.**

### C4 · Earnings Week — Flighty for results
**Pitch.** Each company has a flight: intimation → results board meeting → presentation → call → audio (≤24 h) → transcript (≤5 working days) → ledger update → quarter diff. FINN shows the timeline, a "lands in 2 days" pre-read, and a "late plane" alert when a leg is overdue. Real KPIT Q2 FY27 timeline **[verified]**: intimation 21 Oct → presentation 28 Oct 13:15 → outcome 28 Oct → audio link 28 Oct 21:53 → transcript 3 Nov 22:07 (4 working days).
**Data.** NSE event calendar and board-meetings endpoints (with intimation PDFs) **[verified]**; announcements.
**Feasibility.** High for the timeline; the *live* pre-read depends on dates — after 14 Nov the calendar is nearly empty (1 company on 16 Nov, 1 on 18 Nov), so the evaluation week shows past timelines unless replayed.
**Demo.** Company → timeline with the transcript leg "due Thu" → tap pre-read.
**Gimmick.** Low. **M 4 · F 4 · Score 16.** Fold into C1 (upcoming strip) and C2 (pre-read); don't ship as a separate tab.

### C5 · Quarter Diff
**Pitch.** Extract structured claims from consecutive quarters' prepared remarks + outlook (and the AR's MD&A year over year); show added / removed / changed, PR-diff style, plus "words that disappeared". **Data.** Transcripts/AR (C2). **Feasibility.** Medium — the extraction is C2's; matching claims across quarters needs either `gemini-embedding-2` (1,000 RPD **[reported]**) or an LLM pass per pair. **Demo.** Two-column diff with 6 rows. **Gimmick.** Medium: a literal text diff looks impressive and means nothing — do it semantically or not at all. **M 4 · F 3 · Score 12.**

### C6 · The Morning Call (audio)
**Pitch.** A 90–150 s two-voice audio of the Brief ("PM" asks, "analyst" answers, strictly from the cards), cached once per day, with per-company chapters; "commute mode" is just the play button on the complication. **Data.** None new. **Feasibility.** Medium: `gemini-3.8-flash-tts` is listed on our key **[verified]**; free quota 3 RPM / 10 RPD **[reported]** → exactly enough for one cached daily artefact plus retries; script via Flash-Lite. Fallback: on-device `speechSynthesis` with two en-IN voices (zero quota, lower quality). **Demo.** Press play; 20 seconds of audio over the phone speaker is very memorable in a 60-s demo. **Gimmick.** Medium-high if the voices banter; low if it is dry and ends with "that's all that needed you today". **M 4 · F 3 · Score 12.**

### C7 · Shape-shifting cards (typed generative UI)
**Pitch.** The model does not write prose about a filing; it emits a typed card: `results` (four-metric QoQ/YoY table), `management_change` (who left, who comes, brief profile, effective date), `dividend` (₹/share, record date), `m_and_a` (target, consideration, rationale quote), `pledge` (Δ%), `capex` (₹, capacity, timeline → becomes a ledger row), `credit_rating` (from → to), `routine` (one line). The client renders; the renderer never sees free text it did not ask for. **Data.** Announcements + PDF first pages. **Feasibility.** High with Gemma 4/Flash-Lite and JSON schemas; this is the brief's "decide what earns my attention" made concrete. **Gimmick.** Low. **M 3 · F 5 · Score 15.** It is the card layer of C1.

### C8 · Telegram-native FINN
**Pitch.** The Brief and tripwire alerts delivered where Indian investors already live, with inline buttons (Mute this type · Open filing · Ask) and `/research TICKER`. **Feasibility.** Telegram Bot API: a day's work, anyone can open a `t.me` link. **WhatsApp Cloud API is not demo-able to unknown evaluators**: the test number only messages up to ~5 pre-verified recipients and the first message must be a pre-approved template **[verified: Meta docs/third-party]**. **Demo.** Show the same card arriving in Telegram. **Gimmick.** Low, but it is a channel, not a POV. **M 3 · F 4 · Score 12.** Optional, after the core works.

### C9 · The Filing Card (shareable image)
**Pitch.** One tap renders a 1080×1350 PNG of a results card or a ledger verdict with footnoted sources and a QR to the filing (satori / `@vercel/og`), shared via `navigator.share` to WhatsApp. **Feasibility.** High. **Gimmick.** Medium — nice, not decisive. **M 3 · F 4 · Score 12.** Candidate "small detail".

### C10 · Swipe-to-teach
**Pitch.** Swipe a Skim card left: "never show *Copy of Newspaper Publication* for *Whirlpool*"; right: "always alert me on *Acquisition* for anyone". A "rules you taught FINN" screen. **Feasibility.** High (framer-motion drag + a rules table). **Gimmick.** High unless limited to filter-teaching; swiping *decisions* about stocks would be a disaster of tone. **M 3 · F 4 · Score 12.**

### C11 · The Silence Detector
**Pitch.** Alerts for things that did not happen, each anchored in a rule or the company's own cadence: transcript not filed within 5 working days of the call (SEBI LODR Sch. III 15(b)(iii) **[verified]**); no call scheduled this quarter when there was one for 8 quarters; a promise's due date passed without mention; an exchange **Spurt in Volume** clarification request with no company reply yet (NSE files these as announcements **[verified: KPITTECH, Apr 2022]**). **Feasibility.** High — all rule-based over data we already pull. **Gimmick.** Low. **M 4 · F 4 · Score 16.** Folded into C2 (promise silence) and C1 (filing silence).

### C12 · Replay — the time machine
**Pitch.** Scrub the Brief to any date; FINN recomputes what it would have shown with only the data available then. **Why.** Product reason: investors review their own past attention. Demo reason: evaluators test on a random weekday after results season; replay to 28 Oct (KPIT results day) or 13 Nov (211 companies) makes the demo deterministic. **Feasibility.** High if every ingested item carries its NSE `an_dt` and LLM outputs are cached by (item, prompt-version). **Gimmick.** Low. **M 3 · F 5 · Score 15.** Build it; it is also the test harness.

### Considered and demoted
- **Management credibility score (0–100).** M 3 · F 2 · Score 6 · Gimmick H. With 4–8 quarters of data per company the number is noise with a decimal point; it is also the kind of "model filling a template" the brief dislikes. The ledger's *counts* and *quietly dropped* rows deliver the same insight honestly.
- **Two-way voice.** M 2 · F 2 · Score 4. Latency + quota + ambient noise = a live-demo failure mode.
- **Streaks / gamification.** Rejected in §2.

### Scoreboard

| # | Concept | M | F | Score | Gimmick | Role in submission |
|---|---|---|---|---|---|---|
| C2 | Promise Ledger | 5 | 4 | **20** | L | Pull flagship + proactive push |
| C1 | Finite Brief | 4 | 5 | **20** | L | The required digest, with a POV |
| C3 | Thesis Tripwires | 5 | 3.5 | **17.5** | M→L | The required alerts, generalised |
| C4 | Earnings Week | 4 | 4 | 16 | L | Folded into C1/C2 |
| C11 | Silence Detector | 4 | 4 | 16 | L | Folded into C1/C2 |
| C7 | Typed cards | 3 | 5 | 15 | L | C1's card layer |
| C12 | Replay | 3 | 5 | 15 | L | Demo insurance + test harness |
| C5 | Quarter Diff | 4 | 3 | 12 | M | Stretch, day 6+ |
| C6 | Morning Call audio | 4 | 3 | 12 | M–H | Stretch, one cached artefact |
| C8 | Telegram | 3 | 4 | 12 | L | Optional channel |
| C9 | Filing Card image | 3 | 4 | 12 | M | Small detail |
| C10 | Swipe-to-teach | 3 | 4 | 12 | H→M | Only the constrained form |

---

## 4. The one pipeline underneath (so three concepts cost ~1.3 builds)

```
NSE announcements (per symbol, incremental by an_dt) ─┐
NSE event calendar / board meetings ──────────────────┤
yfinance EOD (.NS) ───────────────────────────────────┼─► ingest + cache (SQLite/JSON; key = PDF URL hash)
screener.in → transcript/AR PDF links (BSE/NSE/IR) ───┤        │
pdftotext (0.1 s / 22 pp) ────────────────────────────┘        ▼
                                              ┌── classify filing (rules on `desc`; Gemma-4 / Flash-Lite for ambiguous)
                                              ├── extract typed card fields (Flash-Lite, JSON schema)        → C1/C7 cards
                                              ├── extract commitments per transcript (Flash-Lite, chunked)   → C2 rows
                                              ├── adjudicate open rows vs. new transcript + results (Flash-Lite; 3.8 Flash only for low-confidence) → C2 statuses, questions
                                              ├── compile tripwire NL → spec (3.8 Flash, user-triggered)     → C3 watchers
                                              ├── evaluate textual tripwires per new filing (Flash-Lite, batched) → C3 fires
                                              └── numeric watchers, silence rules, cadence baselines (code)  → C3/C11 fires
                                                        │
                                              verbatim-quote gate (string match vs. source text) → drop/flag
                                                        │
                                              rank: tier = f(category, tripwire hit, ledger relevance, holding) → Brief (≤5 cards) → Web Push / Telegram / TTS
```

The Brief, the Ledger and the Tripwires are three *views* over the same cached, gated JSON. Replay is a filter on `an_dt`.

---

## 5. Top three, fleshed out

Wireframes below are illustrative: row counts, page numbers, the Whirlpool CFO example and the revenue figure are placeholders; the KPIT margin numbers (17.2% → 17.8%), growth (6.5% YoY) and quotes are the verified ones from today's run.

### 5.1 The Promise Ledger

**Screens (phone, one thumb).**

```
┌──────────────────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────────────┐
│ ‹ KPIT Technologies          │  │ ‹ Ledger · row 3 of 8        │  │ ‹ Pre-read · Q3 FY27 call    │
│ Snapshot · Ledger · Pre-read │  │ EBITDA margin 22–24% by FY29 │  │ Scheduled 28 Jan? (not yet   │
│──────────────────────────────│  │ ● ON TRACK · medium conf.    │  │ intimated — last 8 calls were│
│ Track record (6 qtrs read)   │  │                              │  │ ~7 days after intimation)    │
│ 7 kept · 2 missed · 3 dropped│  │ Promised  Q1 FY27 · CFO      │  │──────────────────────────────│
│──────────────────────────────│  │ "…an aspiration of achieving │  │ Falling due this quarter     │
│ ● KEPT   Rev growth H2>H1    │  │  22% to 24% by FY'29…" p.14  │  │ ▸ "Return to growth by Q4"   │
│   last seen Q2 FY27          │  │                              │  │ ▸ Deal TCV commentary        │
│ ● ON TRACK Margin 22–24% FY29│  │ Heard    Q2 FY27 · CEO       │  │──────────────────────────────│
│   first Q4 FY25 · seen 5×    │  │ "…we will maintain that…"    │  │ Listen for                   │
│ ○ NOT MENTIONED Capex ₹…     │  │  p.19 · verbatim ✓           │  │ 1. Top-2 clients: bottomed?  │
│   last seen Q4 FY26 (2 qtrs) │  │                              │  │ 2. QORIX timeline 2029–30…   │
│ ▲ REVISED DOWN Rev guide…    │  │ Delivered 17.8% (Q2 FY27,   │  │ 3. Fixed-price 70% → margin? │
│──────────────────────────────│  │ results p.3) · gap −4.2 pp   │  │──────────────────────────────│
│ Questions for management (3) │  │ [open filing] [add tripwire] │  │ Sources read: 2 transcripts, │
└──────────────────────────────┘  └──────────────────────────────┘  │ 1 results PDF, 1 AR           │
                                                                    └──────────────────────────────┘
```

**Data flow.** `ticker` → screener company page (consolidated) → parse "Concalls" rows (month label, Transcript PDF URL, PPT, REC) and "Annual reports" links → fall back to NSE announcements with `desc = Analysts/Institutional Investor Meet/Con. Call Updates` containing "Transcript" → download PDFs (BSE `AnnPdfOpen.aspx` needs a UA header; 0.3 s / 0.5 MB) → `pdftotext -layout` → cache text by URL hash → split into speaker turns (regex on `^Name:` lines; the KPIT transcript uses `Kishor Patil:` style) → **extract** per transcript → normalise metric names (small synonym table: "EBITDA margin"/"operating margin"; "revenue growth"/"top line") → **adjudicate** each open row against the next transcript and the results-card numbers → persist rows with `first_seen`, `last_seen`, `status_history[]` → due-date index for the guidance calendar → pre-read assembled from open rows due this quarter + last call's analyst themes.

**LLM tasks (exact).**

- **T-L1 Extract commitments** — model `gemini-3.5-flash-lite` (500 RPD), temperature 0.1, `responseMimeType: application/json`, schema: `{commitments: [{metric, statement (verbatim ≤40 words), speaker, target, horizon, kind: quantitative|qualitative}]}`. Prompt: *"Extract every explicit forward-looking statement by management about headline metrics… Only statements in the text; quote verbatim; skip analyst speech."* Run **per chunk of ~3k tokens** (speaker-turn aligned) and merge, because the single-pass run today returned 2 commitments against ~29 candidate sentences. Cost: ~5 calls per transcript → 25 per company for 5 quarters → 20 portfolio + 5 ad-hoc companies ≈ 625 calls, **spread over two days of quota or run on Gemma 4** (14,400 RPD) with Flash-Lite reserved for adjudication. Cache forever (transcripts don't change).
- **T-L2 Adjudicate + questions** — same model; input = open rows JSON + new transcript (+ the four results numbers from the results card); schema: `{delivered_headline:[{metric,value,quote}], verdicts:[{commitment_index, status ∈ kept|missed|on_track|revised_up|revised_down|withdrawn|not_mentioned, evidence_quote (verbatim or empty), confidence, note ≤25 words}], questions_for_management:[3 strings, each tied to a gap]}`. Measured today: 13.1k input tokens, 2.9 s. Route rows with `confidence = low` or `status ∈ {missed, withdrawn}` to **`gemini-3.8-flash`** for a second opinion — these are rare and are the only place the 20/day budget is spent on the Ledger.
- **T-L3 Pre-read** — no LLM needed beyond T-L2's outputs: it is a *layout* of open rows due this quarter, last call's three questions, and the numbers to check. One optional Flash-Lite call to write a 40-word framing line.

**How it stays grounded.**
1. The model only ever sees fetched primary text (transcripts, results PDFs, AR); no news, no broker notes; the system prompt forbids outside knowledge and the UI shows the exact "Sources read" list per view.
2. Every status requires a quote; a **verbatim gate** normalises whitespace/hyphens and checks a 60-char prefix (then a 0.9 fuzzy ratio) against the source. Pass → "verbatim ✓" and a page number (page from form-feed count in `pdftotext`). Fuzzy pass → "paraphrase" badge. Fail → the status degrades to *not mentioned* and the row is flagged for review. **This gate caught a fabricated evidence quote in today's run** — the model reused the Q1 quote as Q2 evidence.
3. Numbers are **double-sourced**: a delivered number is shown only when the transcript figure and the results-PDF/screener figure agree within rounding; otherwise both are shown with the discrepancy (today: "0.5% CC QoQ" from the model vs. "1%" in the text would have been displayed as a conflict, not a fact).
4. Thin-data honesty: fewer than 3 transcripts → the Ledger shows "not enough history to judge" and offers the AR-based snapshot instead; the track-record line always carries "(N quarters read)".

**Combination with the conventional core.** The Pull menu (business snapshot, financial snapshot, trajectory, balance sheet, cash quality, narrative vs. numbers, guidance, bull vs. bear) still exists; the Ledger *is* "guidance" and "narrative vs. numbers" rendered as a persistent object instead of prose, and bull/bear is written *from* the ledger rows (1 Flash call, cached per quarter). Cut list if time is short: pre-read tab (keep the "falling due" list inside the Ledger), guidance calendar as a separate view, embedding-based metric matching (use the synonym table).

### 5.2 Thesis Tripwires

**Screens.**

```
┌──────────────────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────────────┐
│ ‹ Whirlpool of India         │  │ Compiled into 3 watchers     │  │ ⚠ TRIPWIRE · KPIT · 28 Oct   │
│ Why I own it                 │  │ ✓ EBITDA margin < 18% for 2  │  │ "EBITDA margin < 18% for two │
│ [Margin recovery to 20%+ on  │  │   consecutive quarters        │  │  consecutive quarters"       │
│  mix; promoter overhang gone]│  │   source: results PDF, qtrly │  │ Q1 FY27 17.2% · Q2 FY27 17.8%│
│──────────────────────────────│  │ ✓ Any new promoter pledge    │  │ results p.3 · transcript p.7 │
│ What would change my mind    │  │   source: NSE pledge data    │  │ "…our EBITDA has grown from  │
│ [EBITDA margin < 18% for two │  │ ✓ Call mentions pricing      │  │  17.2% to 17.8%…" verbatim ✓ │
│  quarters; any promoter      │  │   pressure from top clients  │  │──────────────────────────────│
│  pledge; pricing pressure    │  │   source: transcript (LLM)   │  │ Thesis health: AMBER          │
│  from top clients]           │  │ Also watching (defaults):    │  │ 1 of 3 tripwires fired        │
│ [ Compile ]                  │  │ · |Δprice| > 5% · vol > 2×   │  │ [open ledger] [snooze 1 qtr] │
└──────────────────────────────┘  └──────────────────────────────┘  └──────────────────────────────┘
```

**Data flow.** Free text → **compile** → `watchers[]` persisted per holding → nightly job: numeric watchers evaluated in code against yfinance EOD (price/volume vs. configurable X% and N× average), results-card numbers (from C1 extraction, with period keys), NSE pledge / insider / corporate-actions endpoints; textual watchers evaluated per *new* filing or transcript for that company in **one batched Flash-Lite call** carrying all active textual tripwires → `fires[]` with evidence → gate → alert card into the Brief (tier Act) and a Web Push.

**LLM tasks.**
- **T-T1 Compile** — `gemini-3.8-flash` (one call per tripwire; user-triggered; ≈10–20 in the whole demo). Schema: `{watchers:[{kind: numeric|textual|event, metric?, operator?, threshold?, consecutive_periods?, source ∈ eod|results|pledge|insider|announcement|transcript, nl_condition (for textual), rationale ≤20 words}], unparseable: [strings]}`. The screen shows the compiled watchers so the investor can see what FINN *actually* understood — a trust move and a demo moment.
- **T-T2 Evaluate textual** — `gemini-3.5-flash-lite`, one call per new document: `{fires:[{watcher_id, fired: bool, evidence_quote, confidence, note}]}`; the gate drops anything without a verbatim quote. Default tripwires (price, volume, material categories) never touch the LLM.

**Grounding.** Same gate; numeric fires carry the number and the document/page; textual fires require a quote; "fired with medium/low confidence" is shown as **"possible — check"** in tier Read, never as Act. Compile-time ambiguity is surfaced, not guessed ("I couldn't turn *'if the story changes'* into a watcher — try naming a metric or a filing type").

**Combination with the core.** The brief's required alerts (material announcement types, EOD anomalies with configurable thresholds) are simply the default watcher set every holding gets; the tripwire UI is where the threshold *configuration* lives. No separate settings screen. Cut list: per-tripwire snooze; thesis text field (keep only the tripwires); multi-condition logic (treat `;` as OR).

### 5.3 The Finite Brief

**Screens.**

```
┌──────────────────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────────────┐
│ Mon 9 Nov · since Fri close  │  │ ACT · KPIT · results         │  │ ✓ You're done for today.     │
│ 31 filings · 18 companies    │  │ Rev ₹— cr      +6.5% YoY     │  │                              │
│ ●●● 3 need you · ~4 min      │  │                +1.0% QoQ     │  │ 3 shown · 28 filed away      │
│ ▶ play (2:10)                │  │ EBITDA 17.8%   +60 bp QoQ    │  │ quiet days this month: 6     │
│──────────────────────────────│  │ PBT  …  PAT  …  (QoQ · YoY)  │  │                              │
│ ACT                          │  │──────────────────────────────│  │ Next: ABB results Thu 13 Nov │
│ ▸ KPIT · Q2 results + call   │  │ vs. ledger: H2>H1 reaffirmed │  │ KPIT transcript due by Tue   │
│   margin 17.8% (<18% wire)   │  │ vs. tripwire: margin < 18% ⚠ │  │──────────────────────────────│
│ ▸ Whirlpool · CFO change     │  │──────────────────────────────│  │ 28 filed away ▾              │
│   incoming: ex-… (profile)   │  │ "…EBITDA has grown from 17.2%│  │ · 9 newspaper publications   │
│ READ                         │  │  to 17.8%…" transcript p.7 ✓ │  │ · 6 trading-window closures  │
│ ▸ MRF · dividend ₹… rec. date│  │ [open filing] [ledger]       │  │ · 5 investor-meet schedules  │
│──────────────────────────────│  │                              │  │ · …                          │
│ 28 routine · filed away ▾    │  │                              │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘  └──────────────────────────────┘
```

**Data flow.** Nightly (after NSE's late filings, e.g. 06:30 IST) and on demand for the chosen window: fetch new announcements per portfolio symbol (incremental by `an_dt`) → deterministic category from `desc` where unambiguous → LLM classification + card extraction for the rest (first 2 pages of PDF text) → results card from the results PDF → bio card from the appointment filing's annexure (+ optional search-grounded enrichment, labelled "enrichment") → merge tripwire fires and ledger relevance → **tier**: Act (tripwire fired, results, M&A, management change, rating change, pledge Δ, litigation) / Read (dividends, capex, fund raise, insider trades above a size) / Skim (investor meets, press releases) / Filed (everything else, counted and listed, never deleted) → cap at 5 cards; if more than 5 qualify, the sixth onward are grouped by company under "also today" → "done" state → Web Push to the Home-Screen web app (iOS 26 opens any added site as a web app by default; push works in that context **[verified: WebKit]**) and optionally Telegram.

**LLM tasks.**
- **T-B1 Classify + one-liner** — `gemma-4-31b-it` (bulk, ~14k RPD **[reported]**) or Flash-Lite: `{category (reference taxonomy), materiality 0–3, one_line ≤18 words, card_type}`. Only for ambiguous `desc` values; ≈40% of filings.
- **T-B2 Results card** — Flash-Lite on the results PDF table: `{period, revenue, ebitda (reported or PBT+finance+D&A, flagged which), pbt, pat} × {current, prev_q, same_q_ly}` → QoQ/YoY computed in code, never by the model.
- **T-B3 Bio card** — Flash-Lite on the appointment PDF (`{outgoing, incoming, role, effective_date, brief_profile_quote}`), then optionally one search-grounded Flash-Lite call for prior roles (free search grounding, shared 500 RPD **[reported]**); the card labels which part is primary and which is enrichment.
- **T-B4 Lead lines + audio script** — one `gemini-3.8-flash` call per day over the ≤5 structured cards: `{leads:[≤30 words each], rest_line, audio_script:[{speaker, text}]}`; then one `gemini-3.8-flash-tts` call (multi-speaker) cached as the day's MP3. If TTS quota is exhausted, fall back to on-device speech.

**Grounding.** Cards show the filing's own text (`attchmntText`) and quote from the PDF; numbers come from the results table extraction and are shown with the document page; the bio's enrichment is visibly separated ("from the filing" vs. "from the web"). Nothing is hidden: "filed away" is expandable and counted.

**Combination with the core.** This *is* the required windowed digest; the scrubber provides "let me pick the period"; the alert cards are tripwire fires; the ledger lines inside results cards are C2. Cut list: audio (do it on day 6 if the quota is healthy), quiet-days counter, Telegram mirror.

---

## 6. Five small-but-memorable details (cheap on any concept)

1. **The brief ends.** A real terminal state — "You're done for today · 3 shown · 28 filed away · ~4 min" — plus a *quiet days* counter instead of a streak, and quiet hours (no pushes 09:15–15:30 IST unless a tripwire fires). Cost: one screen and a scheduler rule. It is the single clearest expression of the POV.
2. **Verbatim ✓ on every quote, tap-to-page.** Run the string-match gate and show the badge; tapping opens the PDF at the page (`#page=N` works in desktop viewers; on iOS Safari show the page number and a "copy quote" action). Quotes that fail the gate are labelled *paraphrase* or dropped. It is the difference between "AI said" and "the CFO said, page 14" — and today's run shows it is needed.
3. **Estimative language + source count** on every analytic sentence: *"Likely on track (2 transcripts, 1 results PDF)"*, *"Unclear — not mentioned since Q4 FY26"*. Borrowed from intelligence briefings; costs one enum and one integer per claim.
4. **"Last seen" on every promise and metric.** *"Margin target 22–24% by FY29 — first said Q4 FY25, last heard Q2 FY27 (reaffirmed)"*. The quietly-dropped detector is just this field going stale; the UI makes drift visible without a score.
5. **Pair every volume/price anomaly with the exchange's own paper trail.** NSE files *Spurt in Volume* clarification requests and the company's reply as announcements **[verified]**. "Volume 2.7× average · NSE sought clarification 17:49 · company replied 'no undisclosed information' 12:08 next day" turns a bare number into a primary-source story. Rules only, no LLM.

Runners-up: the typed **filing card** PNG for WhatsApp (C9); the **"Sources read"** footer on every view; the **compiled-watchers** reveal screen (C3); the "transcript due by Thu" SEBI-deadline countdown on results cards.

---

## 7. Free-tier budget and routing (the binding constraint)

Reported free-tier caps (verify in AI Studio for *our* project on day 1 — three sources agree, but Google no longer publishes the table): `gemini-3.8-flash` 5 RPM / 20 RPD; `gemini-3.5-flash-lite` & `gemini-3.1-flash-lite` 10–15 RPM / 500 RPD; `gemma-4-31b-it` 30 RPM / ~14,400 RPD; `gemini-3.8-flash-tts` 3 RPM / 10 RPD; `gemini-embedding-2` ~1,000 RPD; Google-Search grounding 500 RPD shared with Flash-Lite; Pro models and `gemini-4-argon` 0. Limits are per *project*, reset midnight Pacific.

| Workload | Volume (demo set: 20 + 5 companies) | Model | Daily cost |
|---|---|---|---|
| Filing classification (ambiguous only) | ~30–60/day in results week | Gemma 4 31B | ≪ cap |
| Results / bio / typed-card extraction | ~5–20/day | Flash-Lite | 20 |
| Commitment extraction (chunked) | ~625 one-off, then ~25/week | Gemma 4 (bulk) or Flash-Lite over 2 days | one-off |
| Adjudication + questions | ~125 one-off, then ~25/week | Flash-Lite; escalate low-confidence to 3.8 Flash | ≤5 Flash |
| Tripwire compile | user-triggered | 3.8 Flash | ≤5 |
| Textual tripwire evaluation | ≤30/day | Flash-Lite | 30 |
| Brief leads + audio script | 1/day | 3.8 Flash | 1 |
| Daily audio | 1/day | 3.8 Flash TTS | 1 of 10 |
| Bull/bear per company | cached per quarter | 3.8 Flash | ≤5 one-off |

Rules: (1) **precompute and cache everything for the demo set before submission** so evaluator taps hit JSON, not models; (2) new-ticker research is Flash-Lite/Gemma only, with the progress screen (expect 60–120 s for 5 transcripts + 1 AR); (3) a visible "quota" guard that degrades gracefully (cached answer, or "FINN is out of daily budget — here is what it already knows") beats a 429 on the evaluator's phone; (4) a second Google project doubles the budget legitimately if needed; (5) local `gemma3:4b` via Ollama is a last-resort classifier for offline dev, not for the deployed demo.

---

## 8. Gimmick audit — what would make this look like AI slop

- Any **score out of 100** for credibility, thesis health or "sentiment". Use counts, statuses and quotes.
- **Two-way voice**, chat bubbles with typing indicators, "thinking…" theatre.
- A **literal text diff** of transcripts.
- Swiping on **stocks** (vs. swiping on filter rules).
- Audio with **banter**. If the voices joke, cut the feature.
- An **infinite feed**. The Brief must end.
- Any sentence the user cannot trace to a page. The gate is the product.

---

## 9. Recommendations (prioritised) and assumptions to challenge

1. **Build the pipeline in §4 first**, with caching and the verbatim gate from day 1; the three views come almost free afterwards. Target "thin-but-working" = Brief (with typed results + bio cards) + Ledger for the 5 ad-hoc companies + default tripwires (price/volume/material types) with the NL compile step. Audio, Telegram, Quarter Diff are day-6 options.
2. **Choose the portfolio for the calendar.** Include several names reporting 9–14 Nov (the NSE calendar today lists e.g. WHIRLPOOL 9 Nov; MRF, COCHINSHIP, KALYANKJIL 10 Nov; ALKEM, AMBER 12 Nov; ABB 13 Nov) so the build week has live results, calls and transcripts; keep KPIT (clean transcripts, concall cadence, a live margin story) as an ad-hoc research company. Build **replay** so the evaluation week is not at the mercy of the calendar.
3. **Verify the Gemini quotas in AI Studio on day 1** and write the routing table into the covering note — the brief explicitly rewards it.
4. **Use NSE, not BSE, for announcements** (BSE API is 403 to us); use screener only as a link index (never its "AI Summary", which is secondary and is exactly the thing we are supposed to produce ourselves).
5. **Chunk transcripts for extraction** (speaker-turn aligned, ~3k tokens) — the single-pass recall today was poor — and double-source every number.
6. **Write the POV into the covering note in one paragraph**: fewer interruptions, a ledger that remembers, tripwires the investor writes, and a gate that makes every sentence traceable. Name what was left out and why (credibility scores, voice, WhatsApp).

**Assumptions other agents should challenge.**
- That NSE `/api/*` keeps answering a plain UA from a cloud IP (today it did from a residential IP, with no cookies). Test from the deployment region early; keep a cached snapshot as fallback.
- That the reported free-tier numbers (20 RPD on 3.8 Flash) apply to our project — check in AI Studio; if the real cap is higher, promote adjudication to Flash.
- That screener's Concalls section exists for small caps in the portfolio (both tests were mid/large caps); fall back to the NSE announcement search for "Transcript".
- That results PDFs are text-based, not scanned. Spot-check 5 portfolio companies; keep Gemini's native PDF/document input as a fallback (billed as image tokens; Flash-Lite 250k TPM is enough).
- That evaluators will add the site to the Home Screen for push; design the Brief so it is complete without notifications, and offer Telegram as the alternative channel.
- That Web Share with files and the Badging API behave on the evaluators' devices — treat as enhancements, not dependencies.

---

## Appendix A — Evidence log (8 Nov 2026, build machine)

**NSE** (Safari UA + `Referer: https://www.nseindia.com/`, no cookies; homepage 403 but APIs 200):
- `GET /api/event-calendar?index=equities` → 626 items; fields `symbol, company, purpose, bm_desc, date`; results events by date: 9 Nov 6 · 10 Nov 23 · 11 Nov 48 · 12 Nov 184 · 13 Nov 211 · 14 Nov 141 · 16 Nov 1 · 18 Nov 1.
- `GET /api/corporate-board-meetings?index=equities` → 20 latest with `attachment` (prior-intimation PDF on nsearchives).
- `GET /api/corporate-announcements?index=equities&symbol=RELIANCE` → 3,382 rows in 0.1 s; `symbol=KPITTECH` → 723 rows in 0.7 s; fields `an_dt, desc, attchmntText, attchmntFile, hasXbrl, sm_isin, smIndustry, seq_id`. KPITTECH `desc` histogram (top): Analysts/Institutional Investor Meet/Con. Call Updates 160 · Updates 68 · Disclosure under SEBI Takeover Regulations 58 · Copy of Newspaper Publication 40 · General Updates 35 · Shareholders meeting 33 · Outcome of Board Meeting 30 · Trading Window 28 · Loss of Share Certificates 23 · Financial Result Updates 22 · Acquisition 21 · Investor Presentation 19 · Record Date 16 · Press Release 15 · Dividend 13 · Appointment 10 · Change in Management 9 · Related Party Transactions 9 · Spurt in Volume 6 · ESOP/ESOS/ESPS 6 · Schedule of Analysts/Institutional Investor Meet/Con. Call 5.
- KPIT Q2 FY27 trail: 21 Oct 17:31 call intimation (call on 28 Oct) → 28 Oct 13:15 investor presentation → 28 Oct 13:28 appointment of an independent director at a material subsidiary → 28 Oct 21:53 audio-recording link → 3 Nov 22:07 transcript (`KPITTECH_03112026220723_KPIT_Q2FY27_Transcript_Signed.pdf`).
- Without symbol → 20 most recent across equities (polling feed). `GET /api/annual-reports?index=equities&symbol=RELIANCE` → 17 years of AR PDFs (2025–26 AR 10.5 MB on nsearchives). `GET /api/corporates-pit?...&symbol=RELIANCE` → insider trades; `GET /api/corporate-pledgedata?...` → 200 (empty for RELIANCE); `GET /api/corporates-corporateActions?...` → dividend record dates.
- `GET /api/corporates-financial-results?index=equities&symbol=KPITTECH&period=Quarterly` → 47 rows but latest period **31-Dec-2024** (same for RELIANCE, 130 rows) → stale for current quarters. XBRL XML (28 KB) parses to `RevenueFromOperations 6,857,240,000`, `ProfitBeforeTax 1,117,080,000`, `ProfitLossForPeriod 872,820,000` for Q1 FY23 — deterministic where available. Detail endpoint needs `params, seq_id, industry, ind, format` → returns `resultsData, segmentData, notes`.

**BSE**: `api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?...` and `CorpforthResults/w?...` → **403 Access Denied (Akamai)** with the same UA. `www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=<guid>.pdf` → 200, `application/pdf`, 492 KB in 0.3 s.

**screener.in**: `/company/KPITTECH/consolidated/` 239 KB in 0.2 s; "Concalls" list rows = month label + `Transcript` (BSE PDF) + `AI Summary` (screener's own; do not use) + `PPT` (BSE PDF) + `REC` (company-hosted mp3); 20 transcript links each for RELIANCE and KPITTECH; 15–16 annual-report links (BSE `AttachHis` PDFs or company IR, e.g. `ril.com/...Annual-Report-2025-26.pdf#page=169`); quarterly table present.

**PDF text**: `pdftotext -layout` on the 22-page KPIT Q2 FY27 transcript: 0.1 s, 8,544 words (~12k tokens). Q1 FY27: 8,773 words.

**Gemini** (`models.list` on our key, 61 models) includes: `gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-flash-latest, gemini-flash-lite-latest, gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts, gemini-3.1-flash-tts-preview, gemini-2.5-flash-preview-tts, gemini-3.5-transcribe, gemini-embedding-2, gemma-4-31b-it, gemma-4-26b-a4b-it, gemini-3.1-pro-preview, gemini-4-argon, gemini-omni-1.2-flash`. Two `gemini-3.5-flash-lite` calls run today: 12,780 in / 249 out tokens in 2.0 s; 13,084 in / 631 out in 2.9 s; JSON schema honoured both times. Grounding check: 2/2 commitment quotes verbatim in Q1; 1/2 evidence quotes verbatim in Q2 (the other was a copy of the Q1 quote); "6.5% YoY" and "17.8%" verified at Q2 lines 123 and 159; "0.5% CC QoQ" not found (text says 1%).

**Platform facts**: iOS 26 opens any Home-Screen-added site as a web app by default; Web Push/Badging work in that context and the service worker must show the notification immediately (WebKit blog, Apple docs). Vercel AI SDK: use AI SDK UI typed tool parts; RSC `streamUI` experimental. WhatsApp Cloud API test number: ~5 verified recipients, template-first, 24 h service window. SEBI LODR (Reg 46(2)(oa), Sch. III Pt A 15): call schedule ≥2 working days ahead; presentation before the call; audio ≤24 h / next trading day; transcript ≤5 working days with simultaneous exchange filing. NotebookLM Audio Overview API: Gemini Notebook Enterprise only (pre-GA). Arc: Browse for Me off 23 Nov 2026, Arc sunset 22 Dec 2026. Flighty: inbound-aircraft tracking 25 h ahead, delay prediction up to 6 h before airline notice.
