# How FINN was built

This is the history of the build for the ENAM challenge: the research, the four builders, the correctness loop, and the deploy. It is a narrative, not a transcript. Where a number appears, it is copied from the experiment log or from a numbered critique.

The running log is [`docs/experiments/LOG.md`](../experiments/LOG.md). The decision it starts from is [`docs/research/20-synthesis-and-decision.md`](../research/20-synthesis-and-decision.md). The critique series is `docs/research/23` through `docs/research/29`.

## Research, before any product code

Sunday 8 November 2026, the day the brief was released. Fourteen agents investigated in parallel, each required to measure rather than assert. The roster and the remits are in [`docs/research/README.md`](../research/README.md): product strategy, the accounting, competitors, prices, the announcements feed, models, design, architecture, a hostile grader, interaction concepts, the local toolchain, document extraction, mobile delivery, and push enrichment.

The coordinator re-checked the load-bearing facts on this machine and wrote them into the synthesis. Gemini's free tier was Flash at 20 requests a day and Flash-Lite at 500, with Pro unavailable. NSE's announcements API answered a plain client, including from a datacenter; BSE's API did not, without a browser impersonation. NSE's integrated-filing XBRL parsed to the headline numbers. The next day, 10 November, was a holiday, so a 24-hour window would open on an empty book unless it widened and said so.

The decision, recorded as EXP-000 and EXP-001: FINN is a brief that remembers what management promised. Home is a finite edition. Research is a ledger settled against exchange XBRL. Alerts are rules the investor writes. The stack is one TypeScript app, with everything the grader sees computed ahead of the request. Flash-Lite does bulk extraction. Flash is reserved for synthesis. Four of the reports (01, 03, 07, 10) had reached "brief plus ledger" separately. The synthesis records what was rejected: a Python worker with no free host that stays awake, an Expo build, a chat as the home screen, a vector database, PDF-first results, and Gemma as something the product depends on.

## Four builders on one scaffold

The same evening, a scaffold of about forty minutes put the contracts in place: Next.js 16, the schema, a Gemini gateway that stops each model at 80% of its daily free-tier allowance, quote and number gates, and placeholder routes. Four builders then filled behaviour in parallel, with folder ownership so they would not edit the same files. The ownership table is `CONTRIBUTING-AGENTS.md`.

- **A — market data and push.** NSE announcements, end-of-day prices, and the material that becomes a card. Commits `b94382d` and `858cc07`.
- **B — results.** The XBRL parser, identity checks, quarter-on-quarter and year-on-year arithmetic, the bank grid, and a PDF path only as a checked fallback. The results series ends at `3e83e8e`.
- **C — documents and the ledger.** Discovery, transcript parsing, guidance kept only when the quote is an exact substring, adjudication, and an annual-report page map. Commit `9c3d674`.
- **D — the product.** The Ledger interface: brief, card, company, alerts, inbox, add, and status, reading the database. Commit `d39793a`.

EXP-002 records the state at the end of that wave. 265 tests passed. The database held 26 companies, 305 announcements collapsed to 189 events (42 of them tier 1), 1,323 price bars, and 614 results quarters with a 99.67% identity pass. Forty-seven documents and 141 verified guidance statements were in, with a 95.8% verbatim pass and 90% precision on a manual read, and ledgers for five companies. The classifier was at or above 95% on 178 hand-labelled filings. First-load JavaScript was 137–140 KB gzipped per route. Review of that UI sent the open issues into the next wave.

## Wiring, then a check of the documents

Later that night two further agents worked on disjoint folders. One wired a resumable job runner, put the brief on a single `buildBrief`, added any-ticker research with a receipt, fed tripwires into the inbox, and answered Ask from one company's filings, dropping any quote that failed the verbatim check (`6cb3fff`, `d63cec7`). The other split multi-person appointment letters into one card per person, gave banks their own results grid, and kept the phone edition inside the notch (`9645a0a`, `fdbcea5`, `a774a31`). A ledger pass refused a number that was not written in the quote, and recovered an IndusInd transcript from the company's own page (`dd2c668`). That wave is EXP-003.

Before any of those verdicts were trusted, a query across the stored transcripts found three source bugs (EXP-004). Reliance's publish date said FY27 while the PDF header said FY26, and the text-derived label had won, which would have settled a new promise against last year's quarter. HDFC Bank, Infosys, Reliance, and Supreme each held the Q2 FY27 transcript twice, once from each exchange, so a cap of four transcripts could drop a real quarter. All six of IndusInd's "transcripts" were one-page cover letters. The fix (`6b076c2`) keeps the publish-date period when the two labels disagree by a year, marks the duplicate PDF, and labels a cover letter as a cover letter. The note in the log: every derived label needs a second derivation, and a rule for when they disagree. The company page then grew a single line for a call that is actually still due, and only in that case (EXP-005, `4d68df3`).

## The correctness loop

A read-only critique of the built app (`docs/research/23-critique-round-1.md`, commit `1c18d51`) scored correctness 1 and demo reliability 3. The synthesis had set a gate of 4 on both, and a cap of 1 on correctness for any wrong headline number. Reliance's results grid matched its stored quarter. The failures were on the ledger.

**Wrong-quantity beats.** The quote was in the transcript. The number beside it was the company's consolidated result, and the row said beat or miss. Amber's Power-One range of ₹265–275 crore was scored against company revenue. Dixon's IT-and-hardware line, and a separate export line, were scored the same way. Vedanta's "surpassing $6 billion" of EBITDA was compared with a rupee total as if the units matched. Bajaj Finance's "AUM growth will gravitate between 22% and 23%" was stored as revenue growth and called a miss. Kalyan's Candere target had the same shape. Company-level rows could already be right: Supreme's FY26 revenue, L&T's margin, PI's margin.

The first fix (`c97d891`) writes kept, beat, or miss only when the quote and the delivered line are the same metric, the same unit, and the same scope. Otherwise the row is unverifiable and the company figure is not left beside a different promise.

That did not clear the book. The next critiques found the scope hiding outside the stored quote. Amber's "14% to 15%" was an answer to a question about RAC, and it was still called a beat against company revenue growth (`docs/research/24-critique-round-2.md`). Candere's "PAT neutral" was unverifiable but still carried the company's profit. Later rounds found a company interim printed on a slice, a company margin on another metric, a named division (L&T's projects business), and Dixon's "without the Vivo also" printed as the company growth rate. Each round was read-only. Each fix cleared the company total from a promise that was not that total: `55cb57c`, `7bb26fd`, `0021178`, `9be711a`, `56cb57d`, `099ff76`. Rounds 2 through 6 are `docs/research/24` through `docs/research/28`. Round 6 still capped correctness at 1, because the ex-Vivo growth line showed 34.9% as the running figure, and it scored reliability 4 once Ask stopped sitting on an unnamed "Asking…".

Round 7 (`docs/research/29-critique-round-7.md`), after `099ff76`, scores correctness 4 and demo reliability 4. The Dixon rupee line that excludes Vivo was judged the same perimeter as reported revenue until that consolidation starts. The note is explicit that a higher bar is still open: the checksum visible without opening the database, a red-team write-up, and a citation on every research sentence. The synthesis gate is open. That is the score we are willing to put in front of a grader. It is an internal read of our own database.

**HDFC's half-year badge.** The same first critique found that HDFC Bank's consolidated card said the exchange had verified it while the half-year check failed. The sum of the first two quarters of profit before tax was ₹55,018.64 crore against a year-to-date of ₹53,880.66 crore, and profit after tax was ₹41,082.72 crore against ₹39,944.74 crore. The gap, ₹1,137.98 crore, is the first quarter's minority interest. The chip appeared only when the check passed, so a failure was invisible, and "verified" followed from the source being XBRL. Commit `c827099` stops that. A failed half-year is not called verified. Round 2 re-read the rows: Reliance's consolidated half-year, which matches to the rupee, still carries the badge; HDFC's says the half-year check failed. Cover-letter transcripts stopped reading as a download still in progress.

Reliability moved on the Ask wait. The button had been able to sit on "Asking…" for up to a minute. It now says it is reading that company's filings, and after eight seconds it says the read can take a minute (`bdefd31`). Rounds 6 and 7 treat that receipt as a named wait, and score reliability 4. A live model call is why the note does not go to 5.

## Deploy

Production is [https://finn-gray.vercel.app](https://finn-gray.vercel.app), on Vercel in Mumbai (`bom1`). The database is Supabase Postgres on the existing project, in Sydney. Local development stays on a libSQL file, which is what the ingest scripts already spoke. Vercel cannot speak libSQL to Supabase, so a `postgres://` URL uses Postgres, with epoch milliseconds stored as bigint and the JSON columns mapped explicitly (`910e44c`). The URL and the fact that secrets stay on the Vercel project, not in git, are recorded in `8008027` and `bf603e5`.

The first deployed brief never left its loading shell. Supavisor in transaction mode, port 6543, drops the reply when the Postgres client pipelines a second query, and the caller waits while the backend sits idle. Turning the pipeline off did not stop that extra query. The app now opens the same host and credentials on the session pooler, port 5432, which keeps one backend for the life of the connection (`b08a91a`, 9 November, described in `src/db/dialect.ts`). The next commit loads every results card in one query (`5510c7f`). The alerts page was then turned into three questions — price, volume, and which filings always surface — with one save (`d76ddb8`). That is the screen in the ten-minute path.

## NSE's official MCP

On 10 November Ask was wired to NSE's official MCP, the page at [https://www.nseindia.com/nse-mcp](https://www.nseindia.com/nse-mcp). NSE publishes two public Streamable HTTP servers there, with no API key. End-of-day is `https://mcp.nseindia.in/bhavcopy/cm/mcp`. Delayed prices, 1–3 minutes, are `https://mcp.nseindia.in/cmmkt/mcp`. `tools/list` returned 36 tools. FINN wires five: a live stock quote, a live index quote, data status, corporate actions, and one index close on a date. Commit `79f9ec3` wired the live quote, the live index, and data status. Commit `527f876` added corporate actions, one index close on a date, and the inventory. The other 31 are not used: calculated screens (moving averages, beta, mood), mover boards, bonds, SME and derivatives, and history the app already stores. NSE does not publish announcements, board meetings, shareholding, delivery, or whether the market is open on these servers. Data status is the crawl time, not an open flag. A live quote never replaces an XBRL result or a promise-ledger verdict. "reliance price" is the delayed NSE quote. "results" stays the filing. The inventory is [`docs/research/30-nse-mcp-tools.md`](../research/30-nse-mcp-tools.md).

## The brief stayed home, and chat learned the book

On 10 November the desk became Finnie. The greeting and the typed examples are `77781a7`. That evening `/` opened on chat (`eef4344`). On 15 November the front door went back to the brief (`f143131`). `/` replaces itself with `/brief`, and a window query such as `/?w=7d` is kept. Chat stayed a tab.

The turn plans tool calls and answers from the tool JSON (`cd356bd`, `d287855`). A promised-versus-delivered question is `get_results` and `get_promises` together (`6f1732a`). The card is one pair per quote: the sentence, what was promised, what was delivered, and a chip (`78d5e21`, `src/lib/promiseCompare.ts`). A quote is scored against the quarter it names (`e5df47c`). The bubble stays a short sentence (`3c12203`, `8ae5a0b`). Both Finnie steps use the Flash ladder. Flash-Lite remains the last rung on that ladder, and it remains the bulk extractor.

While a turn runs, the screen shows step titles, and a thought only when the model actually returns one (`src/lib/finnieTrace.ts`, `src/ui/ThoughtRow.tsx`). Signatures and redacted parts stay off the screen. A fallback provider does not invent a thought summary. The titles already shown stay.

Independent tool calls in one turn run together, four at a time. `mark_read` stays in order (`01feff5`, `TOOL_CONCURRENCY` in `src/lib/finnieTurn.ts`). On the brief, a real promise break sorts above a results card, and both sort above routine noise (`attentionRank` in `src/ui/decision.ts`).

## When one provider is out of credit

Finnie still tries Gemini first. On a daily cap, or a quota, 429, credit 403, or 503, the plan or the answer tries the next configured provider (`302116b`, `src/engine/llm/providers.ts`): Groq `openai/gpt-oss-20b`, then OpenRouter `openrouter/free`, then Cerebras `qwen-3.8-27b`. An empty key skips that provider. Those calls use the same JSON schema and do not read or write `llm_cache`. Production has Groq and OpenRouter set beside Gemini. Cerebras is not set, so that provider is not called.

## Citations, an unpicked symbol, and three different quantities

A guidance row stores the page its speaker turn started on. The quote can sit later in that turn. `pageForQuote` (`01feff5`, `src/lib/quotePage.ts`) opens the extracted page that contains the quote when that page is the only match. When the stored page itself contains the quote, that page stays, including when the same sentence also appears elsewhere. When the quote is on no extracted page, or on several pages and not the stored one, the stored page is kept. The chip still shows the quote. A `#page=` link is not reliable on every phone.

An NSE symbol that is not already on the book is still carried to `/c/<symbol>` (`01feff5`, `ensureCompanyLinks` in `src/lib/finnieTurn.ts`). The company route starts the existing research job (`src/lib/companyRoute.ts`). Until that job finishes, the page is a receipt that says the name is not in the book yet. A name already in the portfolio keeps its page. A symbol the exchange does not list gets the cold state, not an empty ledger.

The company pull menu is eight readings from the filings, with no model call. A segment table, a leverage ratio, and a guidance quote are different quantities (`302116b`, `src/lib/pull.ts`). A segment-revenue table stays in the business snapshot. Debt-equity, interest coverage, and borrowings stay on the balance sheet, and a ratio is not paired with the next printed number. Guidance is the headline guidance rows. On the deployed Supreme page the business snapshot is the printed turnover mix, piping 70%, packaging 15%, industrial 11%, consumer 4%, and the FY26 revenue promise is the ledger row.

The alias https://finn-gray.vercel.app was serving commit `302116b` on 15 November 2026, in Mumbai. These submission documents are a later commit. The running app does not serve them.

## What this file is not

Raw agent transcripts are not pasted here. No line above is presented as something an agent said. This repository does not contain a Cursor session export or any other saved build dialogue. The narrative is taken from the experiment log, the commits it names, and the code those commits left. The covering note, ready to paste, is [`covering-note.md`](covering-note.md).
