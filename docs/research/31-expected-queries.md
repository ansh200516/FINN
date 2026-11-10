# 31 — Expected queries

Extracted from the challenge PDFs. Nothing below is a question I added. The main brief’s interactions are written as instructions to the builder, not as a chat script. Where the brief describes an output or an interaction, the quote is that description. The reference PDF does not add questions; it defines the words those outputs use.

Sources:

- `problem statement/ENAM_AI_Engineer_Build_Challenge_Main.pdf` (3 pages)
- `problem statement/ENAM_Build_Challenge_Reference.pdf` (3 pages)

`RELIANCE.NS` appears once, on main page 1, as a Yahoo ticker example (`Indian tickers use .NS for NSE and .BO for BSE, e.g. RELIANCE.NS`). It is not a results question and not a promised-versus-delivered question.

## Main brief

### Two modes — page 1, “What you’ll build”

> Push — it proactively tells you what changed and why you should care.
>
> Pull — you ask it to research or analyse something on demand.

### Windowed digest — page 2, “Push — the app reaches out to you”

> 1. A windowed digest. For a time window I choose — by default the last 24 hours, but let me pick the period — show me every corporate filing/announcement across my portfolio, filtered and prioritised so I see what matters first and the routine stuff is collapsed or hidden.

### Triggered alerts — page 2, same section

> 2. Triggered alerts. Tell me the moment something crosses a threshold, for example:
>
> - a material announcement of a type I care about (results, M&A, management change, and so on); or
> - an unusual move in my end-of-day data — e.g. volume more than ~2× its recent average, or a price move beyond ±X% in a day. Make the threshold configurable: the point is that I decide what "unusual" means and the app watches for it.

### Management-change bio — page 2, “How a pushed item should be presented”

> Management change → don't just say "CFO resigned." Pull a short background/bio of the incoming person (e.g. from LinkedIn) so I instantly know who they are and where they came from.

### Results card — page 2, same section

> Quarterly results → take the actual results filing and give me a first cut of the headline numbers — Revenue, EBITDA, PBT and PAT — this quarter vs. last quarter (QoQ) and vs. the same quarter a year ago (YoY). Those four are defined in the reference document.

### Other filings — page 2, same section

> For every other announcement type, decide what earns my attention: a one-line summary next to the filing, or just the filing surfaced at the right priority. That judgment is the point.

### Pull menu — page 2, “Pull — you ask it to dig in”

> Below are eight kinds of output a good research view might contain — we spell them out because you may not have a finance background. Treat them as a menu: pick what you build and how deep you go. Each is explained further in the reference document.
>
> - Business snapshot — what the company does, its segments, revenue mix.
> - Financial snapshot — current headline numbers (revenue, margins, PAT, key ratios) at a glance.
> - Trajectory — the multi-year direction: what's growing, what's compressing.
> - Balance sheet — debt, leverage, working-capital cycle, funding structure.
> - Cash quality — cash-flow trend and cash conversion: do profits turn into cash?
> - Narrative vs. numbers — where management's story and the actual financials agree or diverge.
> - Guidance — what management has explicitly guided on headline numbers (growth, margins, capex).
> - Bull vs. bear — a tight case each way.

### Promised versus delivered — page 2, “Worked example — numbers vs. narrative”

> Worked example — numbers vs. narrative: take the last four quarters and, against management's own headline guidance and growth commentary, tell me what was promised vs. what was actually delivered. This is the difference between summarising management and analysing them — and it's the kind of thing we value most.

### What the pull answer may use — pages 2–3

> One discipline for the pull side: ground it in the primary sources (annual reports + transcripts). No broker notes, no news, no research reports, and don't lean on the model's own outside knowledge of the company. Differentiated signal lives in primary data; secondary commentary is where it gets noisy. (Push-side enrichment like a person's professional background is a different thing and completely fine.)

## Reference PDF — definitions, not extra questions

### Page 1, §1 Corporate announcement categories

> results — Quarterly/annual results, the board meeting approving them, results decks and shareholder letters, and ads confirming results were published.
>
> management_change — Any change at the top — a CEO, CFO, MD, or director joining, resigning, or retiring.

### Page 2, §2 Documents you'll work with

> Quarterly results — The financial results a company publishes every quarter (revenue, profit, etc.), filed with the exchanges. Less detailed than the annual report but far more current.
>
> Concall / earnings-call transcript — A quarterly call where management discusses the results and answers analysts' questions. The transcript is where you find guidance, tone, and what analysts are pressing on.

### Page 2, §3 Headline financial terms

> Revenue — Total sales — the top line of the P&L; the money coming in from selling goods/services.
>
> EBITDA — Earnings Before Interest, Tax, Depreciation & Amortisation. A rough proxy for operating profitability — how profitable the core business is before financing and accounting effects.
>
> PBT — Profit Before Tax — profit after all costs and interest but before income tax.
>
> PAT — Profit After Tax — the bottom line; what's left for shareholders after tax. Also called "net profit."
>
> QoQ (quarter-on-quarter) — This quarter compared with the immediately previous quarter.
>
> YoY (year-on-year) — This quarter compared with the same quarter a year earlier — the usual way to strip out seasonality.

### Page 3, §5 Corporate-action & market terms

> Guidance — Management's own stated forward expectations — for growth, margins, capex, and so on.
