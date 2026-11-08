# 01 — Product strategy: what FINN must be to be reached for daily

Role: product-strategy researcher. Date: 8 Nov 2026. Primary sources: `docs/challenge/brief.txt`, `docs/challenge/reference.txt`. Everything below is anchored in those two documents plus web evidence (URLs inline). Confidence tags: **[verified]** = read in a primary/secondary source; **[inferred]** = reasoned from several sources; **[speculation]** = my judgment, challenge it.

---

## 0. The thesis in one paragraph

The brief says the scarce skill is *filtering* — "surfacing the few things that actually matter and burying everything else, beautifully" — and that the thing they value most is "the difference between summarising management and analysing them" (brief, p.2). The user is a ~20-name, 5%-position, multi-year holder who "invests in management" and is "extremely focussed on the quality of management teams and governance" ([enam.com](https://www.enam.com/investment-philosophy.html)). For that user, *speed* is not the edge (filings are public; algos move price first) and *aggregation* is solved (screener.in, Trendlyne, a dozen indie Telegram feeds). What is unsolved is **memory and judgment**: did today's filing change my thesis, given what *this* management has said and done before? So FINN should be **a twice-daily brief that remembers what management promised** — Push items are ranked and worded against the company's own prior guidance and history, and Pull produces the promise ledger that gives Push its memory. Interaction POV: *brief, not feed; cards, not chat; thresholds I wrote, not scores you invented; silence is a feature; every number one tap from the filing.*

---

## 1. Who the grader actually is

### 1.1 ENAM Holdings as the model user **[verified]**

- Privately owned, "unlevered proprietary capital… free from… benchmark indexing and redemption pressures", "work closely with the owners and senior management", "fundamental, bottoms-up research", "extremely focussed on the quality of management teams and governance frameworks" — [About Us](https://www.enam.com/about-us.html).
- Philosophy page: long-term, margin of safety, "the majority of our time is spent analysing each functioning lever of a company's system", **"Invest in Management… ability to efficiently allocate capital"**, contrarian, "total upside… over number or frequency of wins" — [Investment Philosophy](https://www.enam.com/investment-philosophy.html).
- Manish Chokhani (Director): "if you don't have a 5% allocation in your portfolio, you will end up with a zoo… 20 names have to fight to get into your portfolio… The real power comes from holding, identification of companies and bet-sizing"; results are "a mark sheet" — [NDTV Profit, Jul 2023](https://www.ndtvprofit.com/business/the-india-opportunity-raamdeo-agrawal-manish-chokhani-say-power-of-holding-is-key-to-creating-wealth-10053546).
- Publicly disclosed listed book (>1% holdings) of Enam/Akash Bhanshali, Sep 2026: Gujarat Fluorochemicals, Laurus Labs, Schneider Electric Infra, Sudarshan Chemical, Welspun Corp, Amber Enterprises, Ramkrishna Forgings, Inox Wind, Welspun Living, Greenlam, plus (Dec 2025 list) Paytm, Natco, Shilpa Medicare, Genus Power, Dilip Buildcon, Somi Conveyor — 16–18 names, ₹6,200–6,800 Cr ([finmagine](https://www.finmagine.com/star-investors/?slug=akash-bhanshali), [smallcase](https://www.smallcase.com/star-investors/akash-bhanshali-portfolio/)). Nemish Shah: Asahi India Glass, LMW, Elgi, Bannari Amman, Investment & Precision Castings ([finology](https://ticker.finology.in/investor/nemish-s-shah)). Vallabh Bhanshali: 4 stocks.
  - Read: **mid/small-cap, promoter-run, capex-heavy industrials/chemicals/pharma-CDMO**. In these companies, "guidance" means capacity commissioning dates, utilisation ramps, margin bands, capex rupees, order books — exactly the stuff that is promised on concalls and either lands or quietly slips.
- Sister firm ENAM AMC's process page is the closest thing to a written spec of the grader's workflow: "**Monitoring** — continuously monitor investments to validate investment hypothesis… remain cognizant of any changes that influence our original investment thesis"; proprietary models for ~175 companies; 16-member investment team incl. 11 analysts; ~20-stock portfolios ([process](https://www.enamamc.com/strategy/investment-process/), [EIDEA flyer](https://www.enamamc.com/wp-content/uploads/2023/08/EIDEA-Flyer-Aug-2023.pdf)). Jiten Doshi (CIO): "The day begins with reading business newspapers and ends with browsing of the business news before sleeping… understand whether the management interest is aligned with its investors or not" ([BusinessLine](https://www.thehindubusinessline.com/portfolio/personal-finance/investing-is-a-field-of-passion-not-a-slave-of-time-clock-jiten-doshi/article66571397.ece)).

### 1.2 This challenge is their real project **[verified]**

ENAM is hiring ML/AI engineers in Mumbai to "create a suite of greenfield solutions for one of India's most respected investment firms, which is on a journey to reimagine its operations", wants a "builder mindset, building solutions rather than completed tasks/components", lists "Agentic AI orchestration", "knowledge graphs", "anomaly detection", "messy, real-world data" ([Instahyre listing](https://www.instahyre.com/job-437353-machine-learning-engineer-at-enam-mumbai/)). An "AI Engineer Intern at Enam" started fall 2026 ([LinkedIn](https://www.linkedin.com/posts/park-simon_i-am-excited-to-announce-that-i-will-be-starting-activity-7474344727987810304-Faz1)) **[weak evidence]**. The brief itself says "this challenge is a taste of the real problem". Implication: graders will evaluate FINN as the first sketch of something they intend to use, by people who will read the code. **[inferred]**

### 1.3 What this user is *not*

Not a trader. Not latency-sensitive. Reddit practitioners are blunt: "by the time it's on any app or news site, the algos have already moved the price" ([r/IndianStocks](https://www.reddit.com/r/IndianStocks/comments/1rx4ien/howfrom_where_you_can_get_these_type_of_news/)). BuzzInsight: "The only advantage on offer is the willingness to read" ([How to read an NSE filing](https://www.buzzinsight.in/article/how-to-read-an-nse-filing)). ENAM's edge is holding + management judgment, so FINN's job is **comprehension and memory**, not speed. **[inferred, high confidence]**

---

## 2. A day in the life, with timestamps

### 2.1 The rhythm **[verified from multiple Indian accounts]**

| IST | What happens | Evidence |
|---|---|---|
| 06:30–08:15 | Newspapers, overnight global cues, inbox (200–400 emails/day) | Cafemutual on Pankaj Tibrewal: "filter a deluge of information… 200-300 emails every day" ([link](https://cafemutual.com/news/industry/9712-a-day-in-a-life-of-fund-manager)); Mint "The money managers": 300–400 mails, "one annual report a day" habit ([link](https://www.livemint.com/Leisure/PYdWXwQ8y8QV6Lsk3kNsYN/The-money-managers.html)) |
| **08:15–08:45** | **Scan BSE/NSE announcements for holdings + press releases** | inSAKE: "8:15–8:45: Scan BSE/NSE corporate announcements, press releases, global cues" ([link](https://learn.insakeacademy.com/blog/day-in-the-life-equity-research-analyst-india)); Reddit: "check the NSE announcements page each morning for their watchlist stocks, it takes 2 minutes" ([link](https://www.reddit.com/r/IndianStreetBets/comments/1vbo038/)) |
| 08:30–09:00 | Team morning meeting | Naren (ICICI Pru) 9am; Tibrewal 9am for 60 min; Nilesh Shah 8:45 ([Cafemutual](https://cafemutual.com/news/industry/9494-a-day-in-a-life-of-a-cio-sankaran-naren)) |
| 09:15 | Market open | — |
| 09:30–12:00 | Concalls (results season), management meetings, plant visits | inSAKE 9:30–10:30 concalls; Tibrewal "heads out… to meet senior management" |
| 15:30 | Close | — |
| 16:00–19:00 | Synthesis; "note any after-hours corporate announcements, prioritize tasks for tomorrow" | [howtocfa](https://howtocfa.com/blog/day-in-life-cfa-analyst/) |
| **18:30–19:30** | **Results and board-outcome filings cluster here** | patternsradar, 6 Nov 2026: HMT 18:58, Bluspring 18:53, Data Patterns 18:51, Hind Oil 18:50, concall-schedule intimations 19:00–19:06 ([link](https://patternsradar.com/market/corporate)); some land at 23:24 or 01:40 ([ResultKal](https://resultkal.com/)) |
| 19:00–22:00 | Results-season reading, transcripts, ARs; "until 9 or 10 PM" in season | howtocfa; Doshi "ends with browsing business news before sleeping" |

Regulatory clock that produces the evening cluster: disclosure within **30 min of board-meeting close** (3 h if the meeting ends after market hours), 12 h for internal events, 24 h external ([NSE materiality policy PDF](https://nsearchives.nseindia.com/web/sites/default/files/inline-files/POLICY%20FOR%20DETERMINATION%20OF%20MATERIALITY%20OF%20EVENTS.pdf); [useflock](https://useflock.in/blog/corporate-announcement-alerts-india)). Boards meet after close to approve results, so the material stuff lands 18:30–21:00 and is *read* at 08:15 the next morning. EOD price/volume is final after ~18:00.

**Design consequence:** there are exactly two natural "editions" — **08:15 IST ("Overnight")**, covering yesterday 15:30 → now, and **19:30 IST ("Close")**, covering today's filings + EOD anomalies. Everything else is a tripwire alert or a pull. **[inferred, high confidence]**

### 2.2 Seasonality **[verified]**

- Daily filing volume, NSE+BSE combined: 1,000–3,000 on a business day; 4,000+ at results peaks; 200–300 companies file results on the same evening ([aktai](https://www.aktai.app/blog/bse-corporate-filings-research-analysts-guide)). Alfafinder daily counts: 5 Nov 2026 = 1,516 (led by results), 30 Sep = 1,668 (AGM season), Sunday 1 Nov = 63 ([archive](https://alfafinder.com/market/daily/)). BulletinTec week: Sun 255 / Mon 1,134 / Tue 1,414 / Wed 1,796 / Thu 1,863 / Fri 1,616 / Sat 26 ([link](https://bulletintec.com/insights)).
- Results windows: ~15 Oct–15 Nov, 15 Jan–15 Feb, 15 Apr–30 May, 15 Jul–15 Aug. AGM/postal-ballot noise peaks in September. The **submission deadline (15 Nov) sits at the tail of Q2 results season** — good for a live demo, but a Sunday-evening grader may hit a quiet feed → the window picker must default sensibly (see §7).
- For a 20-stock book: ~5–10 relevant filings on a quiet day, 20–50/day in results season (aktai's figure for 30 stocks; scale accordingly). Of those, "perhaps 8… require an immediate note".

### 2.3 What they read first, what is noise, what decisions follow

**What is read first** **[verified]**: own holdings' filings (subject line first — "Read the subject first. Read the body to confirm what the subject claims. Never the other way round", BuzzInsight), then results numbers, then the concall. Results-day order of operations from practitioners: confirm period/basis → Revenue, operating profit, PAT, EPS with YoY and QoQ → "pick the two or three biggest movements" → cash flow / exceptionals / segments → board outcome → "write down what the concall needs to answer" ([StockTool.AI checklist](https://stocktool.ai/pages/blog/results-day-checklist.html)). "Read in increasing order of editorial freedom… Read the narrative last" ([inve.money](https://inve.money/blog/how-to-analyse-quarterly-results)). "Keep reported facts apart from explanations… 'Revenue increased because of strong demand' is an explanation, and it belongs to whoever said it."

**What is noise** **[verified]**: "trading window closure, newspaper publication, compliance certificates, investor presentation uploads, and analyst meeting intimations… fill most of the page and almost never matter" (BuzzInsight). BulletinTec's category mix over a week: Company update 4,285, Investor update 2,091, Compliance 1,343, Results 416, Leadership 410, Corporate action 95, Orders 87, M&A 84 — and only **11 of 8,870 flagged priority**. NiftySutra on 7 Nov: 1,179 kept, **2,966 routine dropped** ([link](https://www.niftysutra.co.in/corporate-feeds)). The reference document's `unclassified` bucket (ESOP allotments, compliance certificates, ESG reports, auditor appointments) matches this.

**Decisions actually made from announcements** **[inferred from §1 + red-flag literature]**:

| Announcement | The question the PM is really asking | Typical decision |
|---|---|---|
| Quarterly results | Did they deliver what they said last quarter? Which 2–3 lines moved and why? | Update model; hold/add/trim; list questions for the call |
| Management change (CFO/MD/auditor/ID) | Who is leaving, why ("personal reasons" before results?), who is coming, is this the 2nd/3rd exit in 24 months? | Re-underwrite the "invest in management" leg; call the company |
| Pledge creation/increase; RPT; auditor qualification | Is value leaking? Is the promoter stressed? | Governance tripwire → size down/exit consideration |
| Fund raise (QIP/pref/rights/warrants) | Dilution %, price vs CMP, who is coming in, why now | Re-do per-share math |
| Capex approval / commercial production | Is this *the* capex they guided? On time? On budget? | Update guidance ledger |
| Order win | Size vs annual revenue; new vs extension; counterparty | Usually nothing; sometimes confirms guidance |
| Credit rating | Direction + rationale paragraph | Leverage check |
| Insider/promoter buy or sell | Conviction signal; disclose-and-sell patterns | Note |
| EOD anomaly (±X%, >2× volume) | Is there a filing explaining it? If not, who knows what? | Investigate |

Governance evidence: 125+ CFOs at listed Indian companies quit in Apr–Jun 2025 (+25% YoY), "nearly half… cited 'personal reasons'", with Gensol and IndusInd as cases where flags surfaced weeks later ([Mint](https://www.livemint.com/mint-top-newsletter/minttopofthemorning01072025.html)). "Auditor resignation… the single strongest signal… Read the resignation letter — listed companies must disclose the reasons" ([alphafunda](https://alphafunda.com/red-flags-in-annual-reports/)). "Rising pledging over 4 consecutive quarters is a red flag regardless of absolute level"; "When the auditor leaves quietly, the question to ask is: what did they see" ([watsinfo](https://watsinfo.com/blog/corporate-governance-stock-analysis.html)). "One red flag is a question; three or more are an answer" ([Stocks Sena](https://www.stockssena.com/learn/fundamental-analysis/16-governance-red-flags)). Manpasand: auditor exit + CFO arrest + ID resignations + 44% pledge at 24% interest — a *cluster* ([NDTV Profit](https://www.ndtvprofit.com/business/manpasand-boardroom-drama-pitches-promoter-against-independent-directors-10836964)).

**Key insight:** the value of an announcement is mostly *relational* — relative to what was promised, relative to this company's own history, relative to the size of my position. A filing-level "materiality score" cannot see any of that. BuzzInsight's practical routine ends with: "Write down what you learned, because the second time a company does something is only meaningful if you remember the first." **That sentence is the product.**

---

## 3. Unmet needs: where existing tools stop

Three layers: **aggregation** (solved), **filtering** (partially solved, generically), **judgment + memory** (unsolved).

| Tool | What it does well | Where it fails this user | Evidence |
|---|---|---|---|
| NSE/BSE sites | Authoritative, free | Firehose; no portfolio view; NSE 403s on plain fetch; subject taxonomy inconsistent across exchanges | shared-context; BuzzInsight |
| **screener.in** | Best free fundamentals; watchlist "newsfeed" + email alerts; Documents hub (ARs, concall transcript/notes/PPT); **Screener AI** (launched 8 Jul 2025) chat grounded in filings | **No mobile app** ("Sucks that there is no mobile app version", [r/IndianStockMarket](https://www.reddit.com/r/IndianStockMarket/comments/1q1ux95/)); AI is pay-per-answer (₹10–30, up to ₹100), pull-only, blank-prompt chat on the company page; no cross-quarter promise tracking; concall notes limited (10 AI summaries/mo free); data errors reported ("total debt and free cash" inaccurate) | [Screener AI](https://www.screener.in/ai/), [Premium](https://www.screener.in/premium/), [changelog](https://www.screener.in/docs/changelog/Screener-AI/) |
| Trendlyne | Alerts, broker reports, screens | Opaque scores: "ratings there are often nonsense… Avoid using their scores"; "data quality is poor and finding the necessary information is just a pain" | [r/IndianStreetBets](https://www.reddit.com/r/IndianStreetBets/comments/owxvy7/), [r/IndianStockMarket](https://www.reddit.com/r/IndianStockMarket/comments/1r5ew43/) |
| Tijori | Business-level KPIs, "Timeline" feed, new WhatsApp notifications | Free: 1 portfolio, 5 alerts; Forensics "outdated or inaccurate"; weak for small caps | [randomdimes review](https://randomdimes.com/tijori-finance-review-best-stock-research-tool/) |
| Bloomberg / CapIQ / AlphaSense | Everything, mobile apps, "Three C's: Consistency, Customization, Context" | Cost; built for US disclosure; India filings nuance poor; still a feed | [Bloomberg mobile report](https://www.bloomberg.com/professional/mobilereport), [AlphaSense mobile](https://www.alpha-sense.com/blog/product/alphasense-mobile-app/) |
| Broker WhatsApp/Telegram | Fast first-cut notes, free | Secondary commentary (banned for Pull by the brief); urgency and herding: "The palpable sense of urgency… causes us to rush to investment judgements" ([Mint](https://www.livemint.com/Money/Lkg0djOnEqkC2w00UfCRiM/Excess-information-Think-fast-react-slow.html)); brokers themselves now ship 2-minute AI audio because clients are "suffering from information overload" ([Axis Capital Sound Bytes, Aug 2025](https://www.axiscapital.co.in/contents/Press%20Release%20-ACL_AI-led%20Research%20Solutions-1757062784.pdf)) | — |
| Indie filing feeds (Gunpowder, BulletinTec, ALFA Finder, NiftySutra, myAlerts, Bajaar.me, Shodh, SS-tracker) | Prove demand; real-time Telegram/WhatsApp; LLM summaries; generic 0–10 materiality | Market-wide and speed-first; **no per-company memory, no thesis context, no position weighting**; "The score is a triage aid, not a prediction" | [Gunpowder methodology](https://www.gunpowderalerts.in/methodology), [BulletinTec methodology](https://bulletintec.com/methodology), [ValuePickr myAlerts](https://forum.valuepickr.com/t/myalerts-in-instant-whatsapp-email-notifications-ai-powered/201905) |
| Promise trackers (inve.money, CiteAlpha GCI, TickerSutra, ArthaLens) | **Validate that "guidance vs delivery" is a real, buildable workflow**: inve tracks 24,823 targets across 1,648 companies, "1,008 of 1,648 Indian companies have quietly dropped a target"; CiteAlpha scores against *original* guidance and shows every revision with filing links; TickerSutra "unknown stays unknown" | Pull-only, market-wide, score-centric; **not fused with the daily filing flow; not scoped to my book** | [inve](https://inve.money/promise-tracker), [CiteAlpha](https://citealpha.com/), [TickerSutra](https://tickersutra.com/promises), [ArthaLens on ValuePickr](https://forum.valuepickr.com/t/arthalens-free-quarterly-earnings-call-transcript-summaries-guidance-q-a-for-indian-listed-companies/195023) |
| US redline tools (BamSEC, Kestrali, FormDelta, Relic) | "What changed since last quarter, in management's own words" (sentence-level MD&A diff) | **No Indian equivalent for concall/presentation diffs found** | [FormDelta](https://www.formdelta.com/), [Kestrali](https://kestrali.com/) |

Even the founder of screener.in frames the problem exactly as the brief does: "the amount of information and disclosures being filed by listed companies has grown multi-fold. It has been very hard for me to follow and understand so many important updates" (Pratyush Mittal at Screener AI launch, [via 24vids](https://www.24vids.com/video/im-very-happy-and-excited-with-the-launch-of-screener-ai-this-is-probably-one-p-tw-1942861243632509159)).

**Complaint synthesis (what they say when tools fail them):**
1. "I missed it" — buyback/earnings slipped through the inbox ([r/IndianStreetBets](https://www.reddit.com/r/IndianStreetBets/comments/tn8zwu/where_do_you_guys_follow_corporate_actions/)).
2. "Too much, can't filter by type" — myAlerts users ask for "ability to filter the type of alerts by category… filter out everything but results, concalls and their summaries".
3. "Scores I can't trust" — Trendlyne/Tijori Forensics.
4. "No mobile" — screener.in.
5. "Summaries are shallow; I still have to read the PDF" — ValuePickr concall-summary builders explicitly added "assess whether management has delivered on past guidance" and "tone shift vs previous calls" to their prompts because plain summaries weren't enough ([ValuePickr static-site thread](https://forum.valuepickr.com/t/built-a-static-site-with-ai-generated-concall-summaries-and-analysis/189440)).
6. "AI costs add up per question" — Screener AI.
7. Serious long-term investors maintain *manual* thesis journals with "conditions under which I would exit" and quarterly monitors of margin/FCF/pledge/order book ([Kunal Jain journal](https://forum.valuepickr.com/t/kunal-jain-portfolio-journal/217692), [India 2040 checklist](https://forum.valuepickr.com/t/india-2040-the-next-generation-of-structural-compounders/223666)) — no tool does this for them.

---

## 4. What "filtering beautifully" means, concretely

### 4.1 Seven rules

1. **Materiality is relative, not absolute.** Rank by (SEBI-deemed materiality) × (position weight) × (novelty vs this company's history) × (relevance to this company's open promises). A ₹50 Cr order is loud for a ₹400 Cr-revenue company and silent for a ₹40,000 Cr one — SEBI's own Reg 30(4) quantitative test is "lower of 2% of turnover, 2% of net worth, 5% of 3-yr avg PAT" ([AZB on LODR 2023 amendment](https://www.azbpartners.com/bank/key-amendments-to-sebi-lodr-regulations/)). Use that as the floor, then layer thesis relevance. **[inferred]**
2. **Hide by default, but show the count.** "14 routine filings collapsed — tap to expand" preserves trust that nothing was lost. Never silently drop. **[speculation, strong opinion]**
3. **Facts before explanations; attribute every explanation.** Numbers from the filing in the card's first line; management's reason in quotes with the speaker and the call; FINN's own interpretation visually distinct and last ("increasing order of editorial freedom"). **[verified practice]**
4. **Every number is one tap from the page it came from.** Quartr's "clickable source traceability" and Screener users asking for "source reference… just to double-check a number" show this is the trust mechanism. **[verified]**
5. **A daily attention budget.** Default ≤3 interrupting alerts/day; everything else waits for an edition. Research: Robinhood's ±5% pushes raise retail trading ≥25% in the next 15 minutes ([Iowa dissertation](https://doi.org/10.25820/etd.006672)); FCA's 9,000-person experiment found push notifications increase trading frequency and risk-taking ([FCA 2024](https://www.fca.org.uk/publications/fca-research/research-note-digital-engagement-practices-trading-apps-experiment)); "ungrouped" items + push inflate judgments ~28% for FoMO-prone investors ([SSRN](https://papers.ssrn.com/sol3/Papers.cfm?abstract_id=2991262)). **Grouping is protective. Batching is a feature, not a limitation.**
6. **No invented scores.** Users distrust opaque "durability scores". Show *components* (what was guided, what was delivered, by how much) not a 0–100 credibility number — or if a number is shown, make it a transparent tally ("4 of 6 targets kept"). TickerSutra's "unknown stays unknown" discipline is right.
7. **Words earn their place.** No adjectives ("strong", "robust") unless quoted. Density like a Bloomberg first-cut, not a newsletter. Reference: sell-side first cuts are 4 bullets + a table: "Revenue: INLINE; EBIT: MISS; PAT: MISS… EBIT margin degrowth by 329bps" ([Axis Direct morning note](https://simplehai.axisdirect.in/app/index.php/insights/reports/downloadReport/file/Morning+note+and+CA+07+May+2026+%281%29_07-05-2026_08.pdf/type/fundamental)); "Management raised loan and deposit growth guidance" ([Sharekhan BoB first cut, 2 Nov 2026](https://www.sharekhan.com/news/earning/details/bank-of-baroda-%E2%80%93-q2fy27-first-cut/all)).

### 4.2 Default loudness map (reference categories → behaviour)

| Reference category | Default | Why / rule |
|---|---|---|
| `results` | **Loud (headline card)** | Always. Card = Rev/EBITDA/PBT/PAT QoQ & YoY (brief's example) + 2–3 auto-detected "movements" (margin bps, other-income share of PBT, exceptional items, PAT vs EBITDA divergence) + "vs guided" line from the ledger. Board-meeting *intimation* that results are coming → calendar, not card. Newspaper ad of results → hidden. |
| `management_change` | **Loud for KMP (MD/CEO/CFO/CS), auditor, independent director; quiet for non-exec/govt nominees** | Card = who/role/effective date, **reason quoted from the letter** (SEBI requires disclosure), timing flag ("3 days before results"), **running count of senior exits in 24 months**, incoming person's bio (brief's example; enrichment allowed on Push). |
| `litigation` | Loud if regulator/court order or insolvency; quiet if routine tax demand < threshold | Quote the amount and the order; note contingent-liability context from AR if available. |
| `insider_trading`, `pledging` | **Loud when direction is adverse or cumulative** (pledge up, promoter sell), quiet for small routine | Show trend over last 4 quarters, not a single point. |
| `fund_raise` | Loud | Dilution % at issue price vs CMP; instrument; who. |
| `M&A` | Loud if above Reg 30 quantitative threshold; else medium | Value / revenue; new vs previously announced. |
| `capex` | Medium → **loud if it matches an open guidance item** | "Guided ₹600 Cr Vizag capex by Q4 FY27 (Q1 call) → board approved ₹650 Cr today." |
| `credit_rating` | Medium; loud on downgrade/outlook change | Quote rationale paragraph. |
| `earnings_call` | Transcript → **feeds the ledger (loud as 'promise update')**; schedule/recording intimation → calendar only | — |
| `press_release` (order wins etc.) | Medium; loud only if size ≥ ~2–5% of TTM revenue or repeated pattern | BuzzInsight's four body checks: value, timeframe, counterparty, new-vs-extension. Beware "order" ≠ "order". |
| `dividend`, `bonus_split`, `agm_egm`, `postal_ballot` | Quiet (calendar / collapsed) | Unless AGM contains a contested resolution or RPT approval. |
| `investor_meetings` | Hidden by default | Pure noise for this user; optional calendar. |
| `unclassified` (trading window, compliance certificates Reg 74(5)/7(3)/40(9), newspaper copies, ESOP allotments, duplicate share certificates, ESG reports) | **Hidden, counted** | — |
| EOD anomaly | **Loud, user-configured thresholds** | Default ±5% / 2× 20-day median volume (brief); pair with "no filing explains this" vs "explained by: results". |

---

## 5. Jobs-to-be-done: Push vs Pull, and the bridge between them

**Push JTBD** **[inferred]**: *"When I pick up my phone at 08:15 or 19:30, tell me in 90 seconds whether anything in my book changed my thesis since I last looked, so I can decide what deserves my day — and leave me alone otherwise."* Success = I close the app feeling I saw everything that mattered and nothing that didn't.

**Pull JTBD** **[inferred]**: *"When I'm about to meet management, size a position, or re-underwrite a name, show me what they promised vs what they delivered and where the story and the numbers disagree, so I walk in with the right three questions."* This is the brief's "worked example" and "the kind of thing we value most".

**The bridge:** the **promise ledger** (extracted from the last 4–8 transcripts + AR guidance) is simultaneously the Pull deliverable and the *memory* that makes Push cards meaningful. A results filing without the ledger is a table; with it, it is a verdict. Illustrative with real screener data for Laurus Labs (Q2 FY27: Sales ₹2,206 Cr, +33% YoY, +9% QoQ; OPM 34% vs 24% a year ago; PAT ₹436 Cr vs ₹194 Cr — [screener](https://www.screener.in/company/LAURUSLABS/consolidated/)): the card's last line would read *"Guided (Q4 FY26 call): FY27 EBITDA margin 'north of 30%' → delivered 34% in Q2. Kept."* (guidance text illustrative, **not verified** — the Pull engine must extract the real quote).

**Which 1–2 workflows make an ENAM grader say "I'd use this tomorrow":**
1. **The 08:15 Overnight brief for a 15–20 stock book**, window-selectable, with results cards done *their* way (4 numbers × QoQ/YoY), management-change cards with bio + letter reason, routine collapsed with a count, and nothing invented. This is the daily habit; it is also what they explicitly spelled out.
2. **The promised-vs-delivered ledger for any NSE ticker**, last four quarters, each row: metric, quote, call/date, what was reported, verdict (kept / missed / revised / went quiet), one tap to the transcript page — and the same ledger's rows surfacing inside Push results cards. This is the thing they said they value most, and the thing no incumbent fuses with the daily flow.

---

## 6. Five product concepts, assessed

| | A. The 90-second brief | B. Promise ledger ("Walk the talk") | C. Thesis & tripwires | D. Narrative redline | E. Ask-the-filing copilot |
|---|---|---|---|---|---|
| **Core loop** | Two editions/day (08:15, 19:30) over a chosen window; portfolio filings ranked, routine collapsed; EOD anomalies appended; tripwire alerts in between | Per company: extract quantified/semi-quantified guidance from transcripts; match to reported numbers each quarter; verdicts; ledger rows feed Push cards | User writes 3–5 kill criteria per holding (margin band, pledge %, FCF, guidance miss, KMP exit); FINN watches filings + EOD and fires only on those | Diff this quarter's transcript/presentation vs last: added/removed metrics, hedging drift ("confident of" → "continue to target" → "lower end"), dodged questions | Chat grounded only in ARs + transcripts for any ticker; eight-item research menu as prompts |
| **Why reach for it daily** | It replaces the 08:15 NSE-page scan and the 19:30 results scramble — both already habits | Results evenings and pre-meeting prep; also the "mark sheet" moment every quarter | Peace of mind; it is the written-down discipline PMs admit they skip (Duke: "write it down in advance… kill criteria", [Motley Fool](https://www.fool.com/investing/2022/09/09/author-and-ex-professional-poker-player-annie-duke/)) | Results season only | Only when a question arises; blank-prompt problem |
| **Deliberately leave out** | Prices on the home screen, P&L, charts, news, broker notes, market-wide feed, chat | Credibility *scores*; sector comparisons; sentiment; price reaction | Automated "sell" suggestions; portfolio optimisation | Full-text search; sentiment scores | Anything not in primary docs; memory across sessions (v1) |
| **Differentiation** | Position-weighted, history-aware ranking; collapsed-with-count; attributed explanations; a designed *quiet state* | Portfolio-scoped and fused with Push; verdicts with evidence not scores; "went quiet" detection | Nobody offers user-authored fundamental tripwires on Indian filings; direct answer to the brief's "I decide what unusual means" | No Indian equivalent exists (US: FormDelta, Kestrali) | Screener AI already does this (₹10–30/answer); Quartr free on mobile |
| **Main risk** | Looks like "just another digest" if ranking isn't visibly smarter than category filters; quiet-day demo | Indian guidance is often qualitative ("double-digit", "17–20% band", "we don't give numbers" — TCS, Eicher); matching requires judgment; 4+ transcripts/company to fetch and parse | Heavy setup; hard to demo in 3 minutes; overlaps with B | Hard to make legible on a phone; subtle | Commodity; graded as "a model filling a template" |
| **7-day feasibility** | High | Medium (the extraction is the hard part; competitors prove it's doable) | High for thresholds; medium for fundamental criteria | Medium | High |
| **Brief fit** | Push ✓✓ | Pull ✓✓ (their worked example) | Push alerts ✓ ("configurable thresholds") | Pull "narrative vs numbers" ✓ | Pull ✓ |

**Verdict:** A + B are one product, not two: **the brief that remembers**. C is absorbed as the thresholds layer the brief already demands (price/volume + a few fundamental tripwires like "pledge ↑", "KMP exit", "guidance missed by >X%"). D is a *should* feature inside B (guidance-language drift column). E is the default everyone will build; skip as primary, keep an "ask about this filing" affordance only if time allows.

---

## 7. A point of view on how an investor should interact

The brief rewards "a point of view about how an investor should interact with this, not just what data to show". Here is one, stated as six opinions with consequences.

1. **Brief, not feed.** Feeds are infinite and ask the reader to do the filtering; a brief is finite and does the filtering for them, then *ends*. Newsletter readers choose finite formats precisely for this ("a finite, curated experience… a moment to pause"). FINN opens on an **edition** with a header like *"Overnight · Fri 7 Nov 15:30 → Sat 8 Nov 08:15 · 3 things changed · 17 routine filings collapsed"*. The window is a control, not a setting buried in preferences. Default = since last edition; the grader can drag it to "last 7 days" or "15 Oct–8 Nov (Q2 season)" — which also solves the quiet-Sunday demo problem.
2. **Cards, not chat.** The first screen never asks the investor to type. Every card has a fixed anatomy: *what happened (facts) · so what (one line, relative to history/thesis) · what they said (quoted, attributed) · what to check (not advice: "the Q3 call needs to explain other income = 41% of PBT")*. Chat is demoted to a per-card "ask about this filing" and to the Pull research order.
3. **Memory, not speed.** We will lose every latency race and we should say so. FINN's cards cite *what this company did last time*: "3rd CFO change since FY24"; "Guided ₹600 Cr capex by Q4 FY27 — this is the approval"; "Pledge 18% → 31% over 4 quarters". This is the feature competitors structurally lack because they are market-wide.
4. **Thresholds I wrote, not scores you invented.** Alerts fire only on criteria the user authored (price ±X%, volume >N× median, plus fundamental tripwires). No "FINN score". When FINN must rank, it shows the components that produced the rank on long-press. This honours the brief's "the point is that I decide what 'unusual' means".
5. **Silence is a feature.** A designed quiet state — *"Nothing changed your thesis today. 11 routine filings. Next results: Amber, 12 Nov."* — is the most honest thing an information product can show, and the opposite of engagement-maximising apps (FCA/Robinhood evidence above). No red/green flashing, no P&L on the home screen, no streaks.
6. **Every claim one tap from its page.** Tap a number → the PDF page, highlighted. Tap a quote → the transcript paragraph. This is both the hallucination defence and the trust builder that Screener users explicitly asked for.

Mobile specifics that follow: thumb-reachable window picker at the top; cards collapse to one line and expand to full; swipe right = "noted", swipe left = "follow up" (builds the investor's own journal, which ValuePickr users keep by hand); position-weight shown as a subtle chip; typography-dense (think first-cut note, not consumer fintech); offline-readable after load; **shareable card image** — WhatsApp forwarding of a card is how it would actually spread inside an Indian investment team **[speculation]**. Audio edition (à la Axis Sound Bytes) is a tempting stretch for the 08:15 commute but is a gimmick risk in 7 days; park it as "where we'd take it next".

What we reject and why: *chatbot-first* (blank prompt, commodity, Screener AI exists, costs scale per question), *dashboard-first* (desk pattern, dies on a phone), *real-time alert firehose* (behaviourally harmful and we can't win on speed), *scores* (distrusted).

**Architecture synergy worth stating in the covering note:** two editions/day means the pipeline is *batch*, not streaming — classify ~100–200 filings/day for 20 names with rules + a cheap model, run the strong model only on the ~3–8 loud items, cache per filing hash, and build the ledger once per transcript. Efficiency (which the brief scores) falls out of the product decision rather than being bolted on. **[inferred]**

---

## 8. What the covering note should emphasise

They said: "we're hiring for building ability, product instinct, and creativity" and grade "creativity, product sense, judgment, and architecture — not completeness". Mirror their language and prove each with one artefact.

- **Open with the thesis sentence and the POV** (§0, §7), in their vocabulary: filtering, burying everything else beautifully, analysing management rather than summarising them, thin-but-working.
- **Product instinct:** show their two "loved" examples done exactly their way — and then the one thing they didn't ask for but will recognise: the ledger row inside the results card. Show the quiet state. Show the collapsed-with-count. One screenshot each.
- **Judgment:** a crisp "what we left out and why" list (prices on home, news, broker notes, scores, chat-first, real-time, sector views, portfolio P&L) and "what we'd build next" (audio edition, narrative redline, tripwire authoring, team journal/shared notes, more sources).
- **Building ability / architecture:** a one-table model-routing map (rules → cheap model for classification/extraction → strong model only for loud-item synthesis and ledger verdicts), cache strategy, cost per company per quarter in rupees, how "any NSE ticker" works live (progressive rendering, graceful "data not available" states), evaluation harness (a hand-labelled set of ~200 filings for classification; a hand-checked ledger for 3 companies).
- **Honesty:** list known failure modes (qualitative guidance, scanned PDFs, NSE session handshake, transcript gaps for small caps) and what FINN shows when it isn't sure ("unknown stays unknown").
- **Demo script for a phone, ≤3 minutes:** open Overnight edition → expand a results card → tap "vs guided" → land in the transcript → back → drag the window to Q2 season → open Pull on an ad-hoc ticker they pick → ledger renders progressively. Say upfront which companies are pre-cached and that any other ticker runs live.
- **AI build history framing:** show how the agents were steered by product decisions (e.g., "we removed the chat from the home screen after seeing it compete with the brief"), not just that code was generated.

---

## 9. Deliverables

### (a) Recommended product concept

**"FINN — the brief that remembers what management promised."** A twice-daily, window-selectable brief over the portfolio's filings and EOD anomalies (Push), where every loud item is worded against the company's own history and open promises, backed by an on-demand promise ledger and research pack for any NSE ticker (Pull). Why: it is the only concept that (1) answers both halves of the brief with one spine, (2) produces the "worked example" they value most as a *daily* artefact rather than a one-off report, (3) is structurally hard for market-wide incumbents to copy, (4) encodes a clear interaction POV, and (5) is batch-shaped and therefore cheap.

### (b) The two workflows to nail

1. **Overnight edition (08:15 IST) for a 15–20 stock book** — ranked cards, results and management-change cards done their way, routine collapsed with count, window picker, EOD anomaly rows with user thresholds, quiet state. Must run on the grader's phone on a Sunday with a sensible default window.
2. **Promised-vs-delivered ledger for any NSE ticker (last 4 quarters)** — extraction from transcripts (+ AR for annual guidance), matched to reported numbers, verdict per row with evidence links; the same rows injected into the results cards of workflow 1.

### (c) Prioritised features

**Must (demo breaks without it)**
- Portfolio of 15–20 NSE tickers + 3–5 ad-hoc; works for any ticker where data exists; explicit "not available" states.
- Edition view with window picker (default since last edition; presets 24h / 7d / results-season; custom).
- Classification into the reference categories (rules + cheap model), loudness map from §4.2, routine collapsed with count.
- Results card: Rev/EBITDA/PBT/PAT, QoQ & YoY, margin bps, 2–3 auto-detected movements, "vs guided" line when a ledger exists, link to PDF page.
- Management-change card: role, effective date, quoted reason, timing flag, exits-in-24-months count, incoming bio (web enrichment allowed).
- EOD anomaly rows with user-editable thresholds (price %, volume multiple) and "explained by filing / unexplained".
- Pull research pack for a ticker: business snapshot, financial snapshot, **promise ledger (4 quarters)**, narrative-vs-numbers; progressive rendering; every claim linked to source.
- Quiet state and empty states designed, not defaulted.
- Mobile-first responsive web, deployable link, loads in <3s on 4G with cached data.

**Should (makes graders smile)**
- Guidance-language drift column (confident → target → lower end; metric disappeared from deck).
- Position-weight chip and ranking by weight.
- Swipe "noted / follow-up" → personal journal page.
- "Ask about this filing" (grounded, per card, cost-capped).
- Cluster detection across governance flags (auditor + CFO + pledge in 12 months).
- Shareable card image.
- Cost meter in the footer ("this edition cost ₹1.80") — makes efficiency visible.

**Skip (deliberately, and say so)**
- Prices/charts/P&L on the home screen; portfolio analytics; news; broker notes; sentiment or credibility *scores*; real-time streaming alerts; voice/audio edition; multi-user auth; native app store builds; sector/peer comparisons; macro.

### (d) Assumptions other agents should challenge

1. **Two editions (08:15 / 19:30 IST) are the right cadence** — alternative: one morning edition + tripwires only. Challenge with how often graders actually open things. **[speculation]**
2. **Materiality can be ranked usefully with rules + position weight + ledger relevance** without an opaque score — the ranking must be visibly better than screener's category filter in the demo, or concept A collapses into "another digest".
3. **Guidance extraction from Indian transcripts is reliable enough in 7 days** — Indian guidance is frequently qualitative or refused outright (TCS, Eicher). The ledger must handle "no quantified guidance" gracefully; inve/CiteAlpha/TickerSutra prove feasibility but at unknown precision. Data/LLM agents should measure precision on 3 companies before we commit the card copy to "Kept/Missed" language.
4. **Transcripts are available for the chosen portfolio for ≥4 quarters** (screener Documents, BSE) — small caps may have gaps; choose the demo book accordingly (mid-caps with rich IR; ENAM's own flavour: chemicals, industrials, pharma-CDMO, capital goods). Do not copy ENAM's actual holdings verbatim **[judgment call]** — rhyme with them.
5. **Enrichment (bio of incoming executive) can be done reliably from the web** in a 7-day build — LinkedIn is hostile to scraping; a fallback (company's own appointment PDF usually includes a brief profile under Reg 30 Schedule III Para A(7)) may be enough and is primary-source anyway.
6. **A Sunday/holiday demo will have a sensible default window** — default to "since last trading day's close" and auto-expand to 7 days if <N items; verify the feed on 14–15 Nov.
7. **Batch architecture is acceptable to graders who wrote "tell me the moment something crosses a threshold"** — EOD data only exists after close, and filings cluster after close, so "the moment" is practically 19:30; but we should make sure alerts can fire from a scheduled check, not only from editions.
8. **Hiding `investor_meetings` and `unclassified` by default is right for this user** — a trader would disagree; the brief's user is not a trader.
9. **No chat on the home screen** will read as a point of view, not a gap — mitigate by making the per-card "ask" obviously present.
10. **The grader will read the code and the AI build history** — so the model-routing and caching story must be real in the repo, not just in the note.

---

## Appendix A — Demo-portfolio flavour (suggestion for the data/UX agents, not a mandate)

Rhyme with ENAM's disclosed book without copying it: 15–20 NSE names spanning speciality chemicals, pharma/CDMO, capital goods/industrials, consumer durables EMS, auto components, a bank/NBFC, an IT/mid-tech name, a cement/infra name, and 2–3 large caps for contrast — chosen for (i) rich, regularly filed concall transcripts over ≥6 quarters, (ii) at least one management change or capex approval in the last 12 months, (iii) at least one recent results filing in Oct–Nov 2026 so the demo window is alive. Ad-hoc research names should include one the graders are likely to test (a widely held large cap) and one tricky one (qualitative-guidance company) to show the "unknown stays unknown" behaviour.

## Appendix B — Sources consulted (in addition to inline links)

- Brief and reference: `docs/challenge/brief.txt`, `docs/challenge/reference.txt`.
- ENAM: [management team](https://www.enam.com/management-team.html); [careers](https://www.enam.com/careers.html); Sridhar Sivaram on Moneycontrol's Wealth Formula podcast ([AI/IT](https://www.moneycontrol.com/news/business/markets/why-indian-it-companies-face-a-rough-ride-in-the-ai-era-13034072.html), [earnings](https://www.moneycontrol.com/news/business/average-to-disappointing-earnings-makes-us-cautious-says-enam-s-sridhar-sivaram-13032388.html)); Jiten Doshi in [Mint](https://www.livemint.com/money/personal-finance/how-enam-amc-s-jiten-doshi-picks-stocks-11662571302279.html).
- Day-in-life: [LinkedIn schedule post](https://www.linkedin.com/posts/yash-chandorkar-8ba7461b6_equityresearch-finance-investment-activity-7482363685999542272-1MkS); [Citadel analyst day](https://www.efinancialcareers.com/news/what-is-a-hedge-fund-analyst-a-day-in-the-life-of-an-equities-analyst-at-citadel).
- Noise/volume: [Gunpowder stats](https://www.gunpowderalerts.in/stats); [NSE corporate filings page](https://www.nseindia.com/companies-listing/corporate-filings-application?id=allAnnouncements); [Vinod Kothari LODR deck](https://vinodkothari.com/wp-content/uploads/2023/10/Recent-regulatory-developments-under-LODR-and-PIT-Regulations_.pptx-1.pdf).
- Results reading: [Kalkine](https://www.kalkine.co.in/article/personal-finance/how-to-read-a-quarterly-results-announcement-for-indian-companies); [YieldIQ](https://yieldiq.in/blog/reading-indian-financial-statements-guide); [Zerodha Varsity](https://zerodhavarsity.substack.com/p/how-to-read-a-company-during-results).
- Guidance culture: [Sansera guidance audit](https://exencialrp.substack.com/p/sansera-engineering-limited) ("at least 20%" guided → 7% delivered); [Altys concall analysis](https://tryaltys.ai/blog/indian-concall-analysis-examples/); [TCS transcript](https://alphastreet.com/india/tata-consultancy-services-ltd-tcs-q3-fy22-earnings-concall-transcript/); [Eicher concall post](https://www.linkedin.com/posts/hemanthyadav_100dayswithtvs-linkedin-finance-activity-7478330027835572224-vVGR).
- Channels/overload: [Sanjeev Research on SEBI survey 2025](https://www.sanjeevresearch.com/insights/india-investors-have-information-filtering-problem); [Moneycontrol on Telegram](https://www.moneycontrol.com/news/business/markets/brokerages-advisory-firms-prefer-telegram-to-whatsapp-heres-why-6327471.html); [Morningstar WhatsApp groups](https://www.morningstar.in/posts/39820/how-whatsapp-is-helping-advisers-bond.aspx).
- Attention research: [CEPR "Paying Attention"](https://cepr.org/system/files/2023-02/Paying%20Attention.pdf); [AAA press summary](https://aaahq.org/portals/0/newsroom/2020/ar920-iphoneapps_presscpapa.pdf).
- Kill criteria: [T. Rowe Price on Annie Duke](https://www.troweprice.com/financial-intermediary/us/en/insights/articles/2025/q4/ten-investing-lessons-from-a-master-of-probabilities.html); [Lenny's Newsletter](https://www.lennysnewsletter.com/p/making-better-decisions-annie-duke).
- Mobile pro tools: [Quartr](https://quartr.com/features/mobile-ai-chat-for-finance); [S&P CapIQ Pro mobile](https://www.spglobal.com/market-intelligence/en/solutions/mobile-app); [Bloomberg Professional app](https://professional.bloomberg.com/products/bloomberg-terminal/access/bloomberg-professional-app/).
- Indian indie tools: [ALFA Finder](https://alfafinder.com/market/); [Bajaar.me thread](https://forum.valuepickr.com/t/shiny-new-stock-market-tools/2399?page=3); [Tracking BSE Announcements](https://forum.valuepickr.com/t/tracking-bse-announcements/1948); [SS tracker](https://forum.valuepickr.com/t/special-situations-discovery-engine-your-edge-in-the-indian-stock-market/217608); [Shodh](https://forum.valuepickr.com/t/shodh-stock-research-platform-with-niche-data/84507); [KB's portfolio tracking](https://forum.valuepickr.com/t/kbs-portfolio-tracking/214251).
- US redline: [Last10K vs BamSEC](https://earningsfeed.com/blog/last10k-vs-bamsec); [Relic](https://relicinvestor.com/).

Not verified / could not access: inve.money promise-tracker page (403 to fetch; relied on search snippet); X/Twitter search unavailable to this account; Tavily key invalid — all web evidence came via WebSearch/WebFetch.
