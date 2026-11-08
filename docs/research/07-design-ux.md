# 07 — Product design & UX research: how an investor should meet FINN on a phone

Author: product design / UX research agent. Date: Sun 8 Nov 2026 (day 0 of 7).
Inputs read in full: `docs/research/00-shared-context.md`, `docs/challenge/brief.txt`, `docs/challenge/reference.txt`, the `frontend-design` skill. Everything below is my opinion backed by the references listed in §11; where I could not verify something it is flagged.

All company names, numbers and quotes inside wireframes are **illustrative placeholders**, not data.

---

## 0. The recommendation in one screen

Build **"The Brief"** — an editor, not a terminal — as the shell; make **"The Ledger of Promises"** the signature of Pull and the brain behind the results alert; demote chat to a single **"Ask"** field that opens a sheet and answers in the same card grammar. No chat bubbles, no dashboard tiles, no purple.

The point of view, in one paragraph (reusable in the covering note):

> An investor's day is a read, not a browse and not a conversation. Twice a day — after the close, when Indian filings actually land (16:00–20:00 IST), and before the open — FINN writes a short brief: what changed, why it matters, and the receipt. Everything else is folded, not hidden. Management is kept on the record: every guidance statement becomes a line in a ledger that the next filing settles as kept, missed or pending. Thresholds are the investor's own words ("more than 4% in a day"), and the app shows how noisy those words would have been last month before they are saved. A quiet day is reported as a result, not an empty screen. Every number carries its source one press away.

Design system in one line: **"Ledger"** — warm paper (default) / ink (dark), IBM Plex Sans with tabular figures for everything numeric, IBM Plex Mono for receipts and eyebrows, Newsreader for the dateline only; green-up/red-down tuned to pass WCAG AA on paper; hairline rules instead of boxes; motion only where it carries meaning.

---

## 1. What the brief actually asks the frontend to prove (and the constraints that shape it)

Read literally, the brief asks for two surfaces (Push digest + alerts, Pull research) with two presentation examples (results four-liner, management-change bio), and then says the frontend is "the heart", wants "a point of view", "density and design", "no AI slop", "thin-but-working". Read between the lines:

1. **They will grade judgment, visible on a phone screen, in under three minutes.** The first screen after the link opens is 60% of the grade. No login, no onboarding, no empty state.
2. **"Filtered and prioritised … routine collapsed or hidden"** is a ranking + folding problem, so the UI must make the *fold* visible and trustworthy (they must see that 11 routine things were folded, and be able to unfold).
3. **"Time window I choose"** is a first-class control, not a settings item.
4. **"I decide what unusual means"** → thresholds must be legible as sentences and their consequences previewable.
5. **"Grounded in primary sources … no model world-knowledge"** → evidence must be visible in the UI, not just claimed in the writeup. Citations are a product feature here, not a footnote.
6. **"Promised vs delivered over four quarters" is what they value most** → it deserves its own object in the UI, not a paragraph inside a research section.

Constraints verified this week that change design decisions:

| Fact | Source | Design consequence |
|---|---|---|
| Q2 FY27 results deadline is **Sat 14 Nov 2026**; 55 of 501 tracked companies report 9–14 Nov (21 on Thu 12, 20 on Fri 13). | quarterlyresults.in blog, thefootnotes.in (§11) | Demo week is peak results week. Pick a portfolio with several reporters on 10–13 Nov; the results card will show **live** data. A "Results week" window preset is justified. |
| Results are filed **after close, typically 16:00–20:00 IST**; the post-close filing window is 3 hours (LODR Reg 30 proviso, since Dec 2024). | thefootnotes.in; Vinod Kothari note | The natural cadence is an **Evening brief (~20:30 IST)** and a **Morning brief (~08:30 IST)**. "Last 24h" stays the default, but the dateline says "after close" / "pre-open". |
| Concall **transcripts arrive up to 5 working days** after the call. | thefootnotes.in timeline | Promise settlement lags results. The UI needs an explicit "awaiting transcript, due by Thu 19 Nov" state. |
| **Muhurat session Sun 8 Nov 14:20–15:30; markets closed Tue 10 Nov** (Diwali Balipratipada). | NSE circular NSE/COM/76978; ET; BusinessToday (§11) | The dateline needs a "market holiday" phase; "last 24h" must auto-widen on holidays, not just weekends; volume averages must skip the special session. |
| Indian results filings already have the three columns we need: *Quarter ended*, *Preceding quarter ended*, *Corresponding quarter ended* (plus previous year). | SEBI LODR Reg 33 format; sample filings (§11) | The results card is a faithful **re-typesetting of the filing's own table** into QoQ/YoY, which is both honest and cheap. Show "₹ Cr" once, as the filing does. |
| On iOS, **web push works only for Home-Screen web apps** (16.4+); Safari tabs cannot subscribe; notifications must be shown immediately or permission is revoked. | WebKit blog; Apple docs; OpenPWA | A responsive-web prototype gets push only after Add-to-Home-Screen. Design the Brief to be fully valuable **without** push; treat push as a bonus with a clear one-tap "Install for alerts" path. |
| **`navigator.vibrate` is unsupported on iOS**; the only web haptic is a native `<input type="checkbox" switch>` tapped directly (one tick; programmatic clicks were patched out in iOS 26.5). Android Chrome supports `vibrate()`. | WebKit bug 266066; `web-haptics` issue #41; `howdoiusekeyboard/haptics` README | Haptics are a progressive enhancement on a few direct-tap controls (threshold stepper detents, swipe-to-seen commit), never load-bearing. |
| India uses **green = up, red = down** (like the West; opposite to mainland China/Japan/Taiwan). | Jiang 2014 (J. Behavioral Decision Making); ECharts docs; BSE site observation | Keep the convention; tune hues for the paper background; never rely on colour alone (▲/▼ + sign). |
| `Intl.NumberFormat('en-IN')` gives lakh/crore grouping and compact `L`/`Cr`; compact notation **over-rounds** (₹9.99L → "10L") unless `maximumFractionDigits` is set. | MDN; monu-kumar.hashnode.dev | Format rule: full `en-IN` grouping where a number is the answer; compact only in chips/axes, always with `maximumFractionDigits: 2`. |

---

## 2. Research digest: what exceptional dense-information mobile products actually do

I looked at the products the coordinator listed plus a few adjacent ones, via design writeups, help centres, teardown pages and vendor blogs (Mobbin/Dribbble only as a secondary sanity check; they are logged-in or low-signal). The lesson is listed before the product, because the lesson is what we steal.

### 2.1 Finance & markets apps

- **Bloomberg Professional mobile** — the "Today" view is a *time-of-day-aware* card feed: Daybreak cards appear at 05:30 and are removed at market open; card types are user-configurable; drill-in "soft lands" and Back returns to Today. Lesson: *the digest has a clock*; content retires itself. (makeyourdesignwork.com/portfolio/work17; amewongsa.com Bloomberg case)
- **Koyfin mobile (DIXI case study)** — "Dense by design … keep the data, fix the scanning: aligned columns, tabular numbers, colour used only for signal"; mobile tables are **three columns with sortable headers**; "mobile does the jobs, not the screens". Users still complain mobile lacks depth — density is wanted, not feared. (dixi.agency/koyfincase; App Store reviews)
- **Robinhood** — Capsule Sans (a refined Maison Neue), **tabular figures on every price**, one rationed green, orange-red for down, near-flat depth, chart as hero with a draggable scrubber. Lesson: *numbers are typography*; one accent, rationed. (oh-my-design.kr Robinhood DESIGN.md; the-brandidentity.com COLLINS case)
- **Trade Republic 4.0 (2025)** — restraint as strategy; big numbers given room; a *real-money confirmation rendered as a calm short list*; a jury note that the only density lapses were an unlabeled %-only axis and crowded timeframe tabs. Also: users rejected "logo-colour" charts because a red Adobe chart going up felt wrong — **semantic colour must not be overridden by brand colour**. (vand.org certification page; Dribbble case study of user complaints)
- **Delta 3.0** — switched to Public Sans specifically for weights and **monospacing of numerals**; unified margins/line-heights; a Monochrome mode where *only* profit/loss keep colour. Lesson: a monochrome UI with semantic colour reserved for deltas reads as expensive. (blog.delta.app)
- **Zerodha Kite** — Kailash Nadh's "user disengagement": only do what is useful; no engagement tracking; push notifications used "very conservatively, never to bring users back". Kite's look has barely changed in years; users praise "colours which do not interfere with our concentration on numbers". Lesson: the investor's trust is earned by *not* nagging. (zerodha.tech/blog/user-disengagement; YourStory App Fridays)
- **Groww** — experiments showed **focus beats flashiness**: a focused single-action screen lifted conversion ~50% regardless of content; "flashy dynamic cards" did nothing. Lesson: one thing per screen, fewer choices. (vedantja.in/writing/junta-quirks)
- **Public's Alpha** — a GPT-4 "co-pilot" that summarises earnings calls with excerpts; Public itself frames it as experimental and warns users to verify. Lesson: a chat assistant alone is now table stakes and carries a trust discount; our edge must be *visible evidence*. (help.public.com; medium.com/the-public-blog)
- **Copilot Money** — ultra-dark navy canvas, charts are the interface, 90% white text to reduce fatigue, Swift Charts; the *marketing* uses thin weights and 148px display type but the *app* is disciplined. Lesson: semantic colour vocabulary applied without exception (income/spend/net/pending). (developer.apple.com/articles/copilot-money; refero styles page)
- **Apple Stocks / Weather / Health** — Stocks: swipe actions, one tap to switch the watchlist column between % / price / market cap. Weather (iOS 15→27): a *text summary near the top* ("Rain expected later") evolved into a **Highlights card** of near-term things that would change your plans; forecast rows can be swapped between Conditions/Precipitation/Wind without leaving the screen. Health: a Summary of favourites + *Highlights comparing recent data* ("stairs this week vs last"). Lesson: lead with a sentence, then let the same rows be re-sliced in place. (appleinsider; techbetweenthelines iOS 27 Weather; screensdesign Stocks/Health; MacStories Health iOS 13)

### 2.2 Triage, lists and calendars

- **Superhuman mobile** — gestures replace shortcuts: swipe *anywhere* to go back, pull down to search, pull-down-then-right for Command; Split Inbox (≤7 splits) prioritises rather than files; default swipe left = Done, right = Remind; triage bar customisable. Lesson: *triage is a swipe, and every swipe is reversible.* (blog.superhuman.com; help.superhuman.com)
- **Things 3** — "a quiet white room": one blue, one yellow star; headings with hairline dividers chunk a long list; **This Evening** as a discrete sub-list; animations exist "to convey information, if you get bored of them during development they are unnecessary". Lesson: hairlines and type weight do the structural work boxes usually do. (uiskillbook Things 3 DESIGN.md; sspai interview)
- **Fantastical** — the **DayTicker**: a horizontal strip of days whose tiny coloured pills show *when in the day* events happen, synchronised with the list below; pull down for a month; natural-language entry with recognised tokens flying into fields. Lesson for our window picker: *a density strip that scrubs the list*. (MacStories review; flexibits help)
- **Linear** — 32–36px rows carrying status, ID, title, project, priority, assignee, labels — via aggressive **icon-over-label substitution**; near-black with a faint blue tint; 1px borders instead of gaps; Inter + Berkeley Mono. Lesson: a learned glyph vocabulary is how you get 8 fields in one row. (designmd.cc Linear; Exocortex notes)
- **Flighty** — airport departure boards as the design language ("one line per flight, 50 years of refinement"); 15 time-aware states; **shows its predicted time alongside the official one, never replacing it**; data is "packed, wrapped and coloured so you don't have to interpret". Lesson: show the derived number *next to* the official number, never instead of it. (developer.apple.com Behind the Design; flighty.com/help; blakecrosley.com Flighty)
- **CARROT Weather** — the user chooses layout density and personality (Professional mode exists); 72px/200-weight temperature; details in expandable cards. Lesson: a serious mode must exist; density is a user setting, not a brand setting. (support.meetcarrot.com; MacStories 5.8/5.9)
- **Readwise Reader** — Ghostreader chat opens *as a sheet over the document* with the passage attached; long-form mode hides the action bar; reading-progress display is configurable. Lesson: **ask-in-context as a sheet**, not a separate chat tab. (docs.readwise.io)

### 2.3 AI answer products (what to copy, what to avoid)

- **Perplexity** — inline numbered citation chips (`[1]`, 18pt tall, 4pt radius, mono digits) link to a horizontally scrolling source-card row; later versions use **publisher-first chips with "+N"**; tapping a chip opens a popover with the exact excerpt before leaving. Lesson: *receipts inline, excerpt before link.* (awesome-ios-design-md Perplexity DESIGN.md; aiuxplayground teardown)
- **Arc Search "Browse for me"** — the page is *built in front of you* with haptic ticks and three visible steps (search → reading → building); sections are uniform (header, 3–5 bolded points, a pull-quote behind a toggle, Dive Deeper links). Lesson: **show the pipeline while it runs**; uniform section grammar. Avoid: the emoji sub-heads. (medium.com Design Bootcamp breakdown; inverse.com interview)
- **Artifact** — consistent "AI involved" iconography, animation to signal work in progress because "lack of feedback led people to think something had gone wrong", human-in-the-loop, and the warning that summaries "may contain mistakes". Also: clickbait rewriting worked only when the original title was *excluded* from the prompt. Lesson: label AI work, keep the full source one tap away. (medium.com/artifact-news)

### 2.4 Editorial information design

- **Tufte** — sparklines are "small, intense, word-sized graphics with typographic resolution", data-ink ratio 1.0 (no frames, ticks), aspect ratio ~5:1 for financial series, slopes averaging 45°; **small multiples** for comparison across companies. (edwardtufte.com sparkline theory)
- **FT Visual Vocabulary / Economist style guide** — choose chart by data relationship (change-over-time, deviation, magnitude); on mobile, *rotate timelines vertically*, "compress horizontally, number labels on chart and list below"; limited palette, one highlight colour; leader-block charts "simplified as much as possible, minimal gridlines". (ft-interactive.github.io; Economist CHARTstyleguide PDF)
- **Axios Smart Brevity** — headline <10 words with the muscle word first; one sentence of "what's new"; **"Why it matters"** in 1–2 sentences aimed at *this* reader; short labelled blocks; "Go deeper" link. "Axioms build muscle memory … readers finish in half the time." Lesson: a fixed grammar of labelled blocks is what makes AI text scannable. (smartbrevity.com; axioshq.com)

### 2.5 Notifications

- Apple HIG: concise, no duplicates for the same thing, actions that avoid opening the app, **interruption levels** (Passive / Active / Time-Sensitive), `relevanceScore` picks the featured item in a scheduled summary; Apple Intelligence summarises stacks and shows summaries in italics. Lesson: one *summary* notification per brief (Active), *threshold alerts* immediate (Active, not Time-Sensitive — a 4% move is not a security issue), never one notification per routine filing. Web push cannot set `relevanceScore`; compensate by sending fewer, better notifications. (developer.apple.com HIG Notifications; Apple Support iOS 18.1)

### 2.6 Typography for numbers — verified facts

- **IBM Plex Sans**: variable (wght 100–700, wdth 75–100) on Google Fonts; **tabular figures by default** (BoldMonday on IBM/plex issue #131: "Default numbers are already tabular numbers"); OFL; Devanagari companion exists. Plex Mono: 87 KB OTF, tabular by nature, no ligatures.
- **Geist / Geist Mono**: `tnum` available; OFL. Strongly associated with Vercel/v0-generated UIs — I would avoid it for exactly the "AI slop" reason.
- **Satoshi (Indian Type Foundry, Fontshare)**: proportional by default, **tabular lining via `tnum`**; nice Indian provenance; Fontshare licence (free, commercial OK) but not OFL — fine for a prototype.
- **Inter / Source Sans 3 / Public Sans**: all have `tnum`; Public Sans is retired/unmaintained; Inter is the generic default the skill tells us to avoid.
- **Söhne-like free options** (for reference only): Inter Tight, Geist, Switzer, Satoshi. (fontalternatives.com; void.parthkapoor.me table)

### 2.7 Mobile ergonomics — correcting the "thumb zone" myth

Hoober's 2013 observations (1,333 people): 49% one-handed, 36% cradled, 15% two-handed; 67% right thumb. His later touch-accuracy data revises the heat map: people **shift grip constantly**, touch accuracy is best at the **centre** (7 mm targets), worse at edges (9 mm) and corners (12 mm); top and bottom edges are the hardest. Practical rules I apply below: reading lives in the upper 60%, *controls* live in the lower 40% but **not glued to the edge** (bottom bar ≥56px tall, items ≥48px, 10–12 mm spacing near the edge), full-row swipe targets, nothing important in corners. (uxmatters 2013/2017; 4ourthmobile.com)

---

## 3. The point of view (six principles the UI must make visible)

1. **Read, don't browse.** FINN is an editor. It writes two editions a day and otherwise stays quiet (Zerodha's disengagement). The home screen is a brief, not a dashboard.
2. **Fold, don't hide.** Every brief shows the fold line: "11 routine filings folded", with a glyph per category and one tap to unfold. Trust comes from seeing what was left out.
3. **Receipts, not confidence scores.** Every number and claim has a source one press away (filing page, transcript timestamp). We never print "87% confidence"; we print *where it came from* and how many sources agree.
4. **Management is on the record.** Guidance becomes ledger lines; filings settle them. The results alert is the settlement, not just the P&L.
5. **The investor's words are the rules.** Thresholds read as sentences and show their 30-day backtest before saving.
6. **Quiet is a result.** "Nothing material since Friday's close" is stated with the evidence (18 companies checked at 08:10) and what's coming up.

Copy rules that follow (give these to the prompt/backends): headline ≤8 words, muscle word first; "Why it matters" ≤25 words; section verdict ≤12 words; bullet ≤20 words; numbers before adjectives; banned words: *insight(s), delve, robust, impressive, leverage (verb), unlock, landscape, game-changer*; no exclamation marks; no emoji anywhere.

---

## 4. Three interaction concepts

Screen widths drawn at ~390 pt (iPhone 15/16 class). ASCII is schematic; proportions matter more than glyphs.

### Concept A — "The Brief" (time-windowed, prioritised, folded)

**Premise.** The app is a twice-daily brief over a user-chosen window. Three tiers: *Material* (expanded cards, max 5), *Worth knowing* (one-liners), *Routine* (folded count). EOD anomalies are items in the same list. A floating window pill controls the period; a Rules screen defines "unusual".

**Information architecture.** Bottom bar with three destinations: **Brief** · **Companies** · **Rules**. Company pages are reached by tapping any ticker. No settings beyond theme/install.

**Home — Evening brief**

```
┌───────────────────────────────────────────┐
│ FINN                                 ◐  ⚙ │
│                                           │
│ EVENING BRIEF                              │ ← mono eyebrow
│ Thursday 12 November · after close        │ ← serif dateline
│ Three things matter. Eleven routine        │ ← deck: the editor's verdict, ≤2 lines
│ filings folded.                            │
│ ─────────────────────────────────────────  │
│ ▌PIDILITIND · Q2 results     18:42 · 2h   │ ← tier-1 card, left ink rule
│ ▌Revenue beat, margin slipped              │
│ ▌ ₹ Cr        Q2     QoQ      YoY          │
│ ▌ Revenue   3,452  +4.1%    +9.8%  ▂▃▃▅▆   │ ← five-quarter sparkline
│ ▌ EBITDA      812  −2.3%   +12.4%  ▂▂▃▅▅   │
│ ▌ PBT         741  −3.0%   +11.0%          │
│ ▌ PAT         556  −2.8%   +10.6%          │
│ ▌ Margin    23.5%  −150bp   +50bp          │
│ ▌ Why it matters  Growth promise kept;     │
│ ▌ margin guidance (24–25%) missed.         │
│ ▌ ⌕ Results PDF p.2   ◷ Concall Fri 10:00  │ ← receipts line (mono, tertiary)
│ ─────────────────────────────────────────  │
│ ▌HDFCBANK · CFO change       09:12 · 11h  │
│ ▌Vaidyanathan out 31 Dec; Shukla in        │
│ ▌ ▸ Who is Rahul Shukla?  3 sources        │ ← tap to expand bio
│ ─────────────────────────────────────────  │
│ ▌TATAPOWER · ▲6.2% on 3.1× volume   EOD   │
│ ▌No filing explains it. Board meets Wed.   │
│ ▌ ▁▂▁▃▁▂▁▂▁█  volume vs 20-day avg          │
│ ─────────────────────────────────────────  │
│ WORTH KNOWING                              │
│ CIPLA    CRISIL reaffirms AA+ · stable     │
│ INFY     Investor meet 13 Nov · Mumbai     │
│ ─────────────────────────────────────────  │
│ ▸ 11 routine filings  ⌧⌧⌧⌧ ◫◫◫ ⊟⊟ ⋯        │ ← fold line, glyph per category
│ · · · · · · · · · · · · · · · · · · · · ·  │ ← stitched rule = end of edition
│ Read in 2 min · checked NSE 20:31 IST       │
│                                           │
│            ╭─────────────────╮             │
│            │ ◔ Last 24h ▾    │             │ ← floating window pill (thumb reach)
│            ╰─────────────────╯             │
│ ┌───────────────────────────────────────┐ │
│ │   ● Brief      ○ Companies   ○ Rules  │ │ ← 56px bar + safe area
│ └───────────────────────────────────────┘ │
└───────────────────────────────────────────┘
```

Hierarchy, top to bottom: edition → verdict → material items (each: ticker/type/time, headline, numbers, why-it-matters, receipts) → one-liners → fold → provenance footer. Nothing else on the screen.

**Primary gestures.**
- Tap a card header → expands/collapses in place (no navigation for tier-1; detail *is* the card).
- Swipe left on any item → **Seen** (collapses to one line in a "Seen" group at the bottom; undo toast 5 s). Swipe right → **Snooze this company 7 days** (removes from brief; visible on Rules › Per company). Both full-row, follow-the-finger, reversible (Superhuman).
- Tap ticker → Company page. Tap any receipt chip → Citation sheet. **Press-and-hold any number** → inline source quote popover.
- Pull down → refresh with "checked NSE hh:mm" (Zerodha-style honesty, no spinner theatre).
- Tap the window pill → Window sheet.

**How the time window is chosen** (bottom sheet, Fantastical DayTicker × Apple Health bars):

```
┌───────────────────────────────────────────┐
│                  ═══                      │
│ Window                                    │
│ Fri 7 Nov 15:30 → now (Thu 12 Nov 20:31)  │ ← live label while dragging
│                                           │
│  ▁▂▁▁▃▁▁▂▆▂▁▁▁▃▇▅▁▁▁▂▁▁█▆▁▁▁▂▁▂            │ ← 30 days, 1 bar/day; dark = material
│  ╞═════════════════════════════╡           │ ← two handles; snap to 15:30 closes
│ 13 Oct                     12 Nov          │
│                                           │
│ [24h] [Since Fri close] [7d] [Results wk]  │ ← presets; "Since I last read" when known
│ [Custom]                                  │
│                                           │
│          ( Show 14 filings · 3 material ) │ ← count updates live
└───────────────────────────────────────────┘
```

Rules: default **24h**; if the 24h window has zero filings (weekend/holiday) the brief **auto-widens to "since last trading close" and says so in the deck** ("Quiet weekend — showing since Friday's close"). Snap points are market closes. The density strip is the whole 30-day cache, so the picker doubles as a "what kind of month was it" chart.

**How thresholds are configured** (Rules tab; sentences with embedded steppers; backtest preview):

```
┌───────────────────────────────────────────┐
│ Rules                                     │
│ What counts as unusual. You decide.       │
│ ─────────────────────────────────────────  │
│ PRICE                               ● on  │
│ Tell me when a stock moves more than      │
│    ⟨ −   4.0 %   + ⟩   in a day           │ ← stepper, 0.5 detents, haptic tick
│ ─────────────────────────────────────────  │
│ VOLUME                              ● on  │
│ Tell me when volume is over               │
│    ⟨ −   2.0 ×   + ⟩  its  ⟨ 20-day ▾ ⟩   │
│ ─────────────────────────────────────────  │
│ ANNOUNCEMENTS — always surface            │
│ [●Results] [●M&A] [●Mgmt change] [●Pledge] │
│ [●Credit rating] [●Litigation] [○Dividend] │
│ [○Capex] [○Fund raise] [○Insider] [○AGM]   │
│ Everything else folds into routine.       │
│ ─────────────────────────────────────────  │
│ IF THESE RULES HAD RUN FOR 30 DAYS        │
│ 7 alerts · about 1.6 a week               │ ← computed from cached EOD data
│ ▁▃▁▁▆▁▂   TATAPOWER ×3 · PIDILITIND ×2 · … │
│ ─────────────────────────────────────────  │
│ PER COMPANY                               │
│ TATAPOWER   snoozed until 19 Nov      ↺    │
│ ZOMATO      price ±7% (looser)        ✎    │
└───────────────────────────────────────────┘
```

The backtest line is the single most persuasive "judgment" detail in the app and costs one pass over 20×30 cached bars.

**How a pushed results item presents the four numbers.** As above: a 5-column mini table — label · value (₹ Cr, tabular) · QoQ · YoY · 5-quarter sparkline — plus one derived row (EBITDA margin, deltas in bp) and one *Why it matters* line that references the ledger. The columns map 1:1 to the filing's own *Quarter ended / Preceding quarter / Corresponding quarter* columns, so the receipt is literally "Results PDF p.2". Consolidated vs standalone is a small toggle inside the expanded card, default consolidated when present.

**How a management change presents a bio** (expanded state):

```
│ ▌HDFCBANK · CFO change          09:12 · 11h│
│ ▌Vaidyanathan steps down 31 Dec.           │
│ ▌Rahul Shukla takes over 1 Jan 2027.       │
│ ▌ ┌─────────────────────────────────────┐  │
│ ▌ │ RAHUL SHUKLA                        │  │
│ ▌ │ CFO, ICICI Lombard        2019–2026 │  │ ← role rows, right-aligned years
│ ▌ │ Head of Treasury, HDFC Bk 2008–2019 │  │
│ ▌ │ CA (ICAI) · PGDM, IIM Ahmedabad     │  │
│ ▌ │ from: filing · company release ·    │  │ ← provenance by source list,
│ ▌ │       press (2)                     │  │   never a confidence %
│ ▌ └─────────────────────────────────────┘  │
│ ▌ Why it matters  Second CFO exit in three │
│ ▌ years; internal successor, no search.    │
│ ▌ ⌕ Reg 30 filing  ◷ effective 1 Jan       │
```

If the bio cannot be sourced, the card says so ("No public background found beyond the filing") rather than inventing one.

**How Pull research is navigated on a phone.** Company page = header (name, price, 1y sparkline, market cap in ₹L Cr, last filing) → **Promises** block (3 rows + "Open ledger") → **Research** as an accordion of the eight sections, each row showing a ≤12-word *verdict* while collapsed, so the collapsed list is itself a dense one-screen summary → expanded section = 3–5 bullets, each with ≤1 citation chip → chip → Citation sheet (passage highlighted, "Open PDF at page") → **Filings** for this company over the current window. The Ask field is pinned above the bar.

**How evidence shows without clutter.** One receipts line per card (mono, tertiary, at the end); in research, one chip per bullet at line end; sourced numbers get a dotted underline and press-and-hold shows the quote; the Citation sheet shows the *excerpt first* and the link second (Perplexity's popover order).

**"Nothing important happened" state** (Morning brief):

```
┌───────────────────────────────────────────┐
│ MORNING BRIEF                              │
│ Tuesday 10 November · market holiday       │ ← Diwali Balipratipada: NSE/BSE closed (verified)
│ Nothing material since Monday's close.     │
│ ─────────────────────────────────────────  │
│ 18 companies checked · 08:10 IST           │
│ ▸ 4 routine filings  ⌧⌧ ◫ ⊟                │
│ ─────────────────────────────────────────  │
│ COMING UP                                  │
│ Wed 11   TATAPOWER   board · Q2 results    │ ← from NSE board-meeting intimations (Reg 29)
│ Thu 12   PIDILITIND  board · Q2 results    │
│ Fri 13   ALKEM board · CIPLA concall 11:00 │
│ ─────────────────────────────────────────  │
│ EOD (Mon) · all 18 inside your rules       │
│ ▂▁▂▁▁▃  ▁▁▂▁▂▁  ▁▃▁▁▁▂  ▁▁▁▂▁▁  (18 tiles) │ ← small multiples, tap → company
└───────────────────────────────────────────┘
```

The dateline must know the exchange calendar: "after close", "pre-open", "market holiday", "weekend". Tue 10 Nov 2026 is a real NSE/BSE holiday (Diwali Balipratipada), so the grader may well open the app on a day when the quiet state *is* the demo — it has to look deliberate.

**Evaluation.**
- Time-to-value: **5/5** — the verdict sentence is the first thing read.
- Density: **4/5** — tier-1 cards are dense; one-liners and folds carry the rest.
- Thumb ergonomics: **4/5** — reading at top, pill + bar at bottom; swipes are full-row.
- Demo-ability: **5/5** — works without login/push; results week guarantees real material items.
- 7-day feasibility: **4/5** — ~7 surfaces, all list/card primitives; the window sheet and backtest are small.
- Point of view: **4/5** — "editor not terminal" is clear; risk of reading as "a nicer feed" unless the ledger line is present.

### Concept B — "The Copilot" (chat/voice-first with generative cards)

**Premise.** One thread. FINN posts proactively (brief, alerts) into the same thread you ask questions in; answers are cards, not prose; a mic button for voice; natural-language rules ("tell me if anything moves more than 4%").

**Core screens.**

```
┌───────────────────────────────────────────┐
│ FINN                                      │
│ ─────────────────────────────────────────  │
│   ◦ 20:31  Evening brief                   │ ← system card (same results table as A)
│   [ PIDILITIND results card … ]            │
│   [ HDFCBANK CFO card … ]                  │
│   [ 11 routine folded ]                    │
│                                           │
│                     What happened since ▐  │ ← user turn, right-aligned
│                     Friday for Cipla?   ▐  │
│   ◦ Window set: Fri 7 Nov 15:30 → now      │ ← parsed-intent confirmation chip
│   [ CIPLA · 2 filings · rating reaffirmed ]│
│                                           │
│   Suggested: "Guidance vs delivered, last  │
│   4 quarters"  "Who is the new CFO?"       │
│ ┌───────────────────────────────────────┐ │
│ │ ◉  Ask FINN…                      ↑   │ │ ← input + hold-to-talk
│ └───────────────────────────────────────┘ │
└───────────────────────────────────────────┘
```

- **Time window**: natural language parsed to a confirmation chip (Fantastical-style token highlighting); a tap on the chip opens the same range sheet as A.
- **Thresholds**: "tell me when volume doubles" → a rule card showing the parsed rule with steppers to correct it; saved rules live in a "Rules" card pinned at top of thread.
- **Results item / management change**: identical cards to A, posted into the thread.
- **Pull**: "Research Pidilite" → an Arc-style generated page (uniform sections = the eight menu items, each with verdict + bullets + chips), opened as a full-screen sheet from the thread.
- **Evidence**: inline numbered chips → source row (Perplexity).
- **Nothing happened**: a one-line system message "Quiet since Monday's close · 4 routine folded · next: TATAPOWER Wed".

**Evaluation.**
- Time-to-value: **2/5** — the thread is a log; yesterday's brief scrolls away; the user must *ask* to get value.
- Density: **2/5** — bubbles and turn-taking waste 30–40% of the viewport; cards inside bubbles get narrower.
- Thumb ergonomics: **4/5** — input at the bottom is natural.
- Demo-ability: **3/5** — high wow if latency <3 s; on Gemini free tier a research answer is 5–20 s and a grader will type something we did not anticipate. Voice on a grader's phone is unreliable (permissions, noise).
- 7-day feasibility: **3/5** — intent parsing, generative layout and streaming are each a day; failure modes are visible.
- Point of view: **2/5** — "chat with your data" is the default 2026 answer; it is exactly the "model filling a template" the brief warns against.

Verdict: chat is a good *tertiary* affordance (follow-up questions in context) and a bad primary one for Push.

### Concept C — "The Ledger of Promises" (non-obvious)

**Premise.** The primary object is a **Promise**: a guidance statement extracted from a transcript or annual report (who, when, metric, target, horizon, exact quote) and a **Settlement**: the filing that tests it. The portfolio home is a ledger; Push is a stream of settlements and newly made promises; EOD anomalies appear as "unexplained" lines awaiting a filing. This is the bahi-khata idea made literal: *naam/jama*, kept/missed.

**Core screens.**

```
┌───────────────────────────────────────────┐
│ LEDGER                      Q2 FY27 season │
│ 9 settled this week · 2 missed · 14 open   │
│ ─────────────────────────────────────────  │
│ SETTLED THIS WEEK                          │
│ ● PIDILITIND  "double-digit rev growth"    │
│      kept · +9.8% YoY  (said Q4 call 00:41)│
│ ✕ PIDILITIND  "EBITDA margin 24–25%"       │
│      missed · 23.5%     (said Q4 call 00:43)│
│ ● CIPLA       "US launches: 4 in H1"        │
│      kept · 5           (AR FY26 p.31)     │
│ ─────────────────────────────────────────  │
│ DUE NEXT                                   │
│ ◐ TATAPOWER   "4.3 GW RE capacity by FY27" │
│      3.9 GW · board Wed                    │
│ ◐ ALKEM       "mid-teens India growth"     │
│      results Fri                           │
│ ─────────────────────────────────────────  │
│ UNEXPLAINED                                │
│ ▲ TATAPOWER  +6.2% on 3.1× vol · no filing │
│ ─────────────────────────────────────────  │
│ NEW PROMISES  (from 2 transcripts this wk) │
│ + INFY  "FY27 revenue growth 2–3% cc"      │
│                                           │
│ ┌───────────────────────────────────────┐ │
│ │  ● Ledger    ○ Companies    ○ Rules   │ │
│ └───────────────────────────────────────┘ │
└───────────────────────────────────────────┘
```

Company ledger (Pull): the four-quarter grid the brief asks for —

```
┌───────────────────────────────────────────┐
│ ‹ Pidilite · Promises vs delivered          │
│ Guidance        Q3    Q4    Q1    Q2       │
│ Revenue growth  ●     ●     ●     ●        │ ← ● kept  ✕ missed  ◐ pending  – n/a
│   "double digit" 12%   11%   10%   9.8%    │
│ EBITDA margin   ●     ✕     ✕     ✕        │
│   "24–25%"      24.1  23.2  23.0  23.5     │
│ Capex FY27      –     –     ◐     ◐        │
│   "₹600 Cr"                 90   210 (cum) │
│ Volume growth   ●     ●     ◐     ◐        │
│   "high single"  8%    8%   n/d   n/d      │ ← n/d = not disclosed this quarter
│ ─────────────────────────────────────────  │
│ Narrative vs numbers · 2 divergences       │
│ · Says "pricing stable", realisation −2%   │
│   [Q2 call 00:12:05] [Results PDF p.4]     │
│ ─────────────────────────────────────────  │
│ ▸ Business  ▸ Financials  ▸ Trajectory …   │ ← the other research sections below
└───────────────────────────────────────────┘
```

- **Gestures**: tap a status glyph → the quote and the number side by side; swipe a promise → "Watch" (alert me when it settles); long-press → copy quote with citation.
- **Time window**: "settled between" and "due within" ranges — same sheet as A but the density strip counts settlements.
- **Thresholds**: unchanged for EOD (same Rules screen); announcement rules become "which settlements/promises notify me" (missed only / all).
- **Results item**: the settlement card = A's numbers table + the promise rows it touches.
- **Management change**: a "signatory change" line — promises made by the departing executive are tagged *orphaned* and listed under the bio. (This is a genuinely new idea no reference app has.)
- **Pull**: the ledger is the Guidance and Narrative-vs-numbers sections; the other six sections sit below as in A.
- **Evidence**: every promise *is* a quote with a locator; nothing to add.
- **Nothing happened**: "No settlements since Monday. 14 open; next test Wednesday."

**Evaluation.**
- Time-to-value: **3/5** — brilliant for someone who already knows the companies; a cold grader needs the brief's framing first.
- Density: **5/5** — table-like, every row carries a claim, a number and a receipt.
- Thumb ergonomics: **3/5** — grids need horizontal care at 390 pt; rows must be ≥40 px.
- Demo-ability: **3/5** — spectacular when the extraction is right; a single wrong "missed" is very visible. Depends on transcripts, which lag results by up to 5 working days — some Q2 promises will show *pending* during the demo week.
- 7-day feasibility: **2/5 for 20 companies, 4/5 for the 3–5 ad-hoc research companies** (which is exactly the brief's Pull set).
- Point of view: **5/5** — "we hold management to their words" is a position, and it is the example the firm said it values most.

Coverage gap: M&A, pledges, ratings, dividends do not fit a ledger. C needs A's feed anyway.

---

## 5. Comparison and the recommended hybrid

| Criterion (weight) | A · Brief | B · Copilot | C · Ledger |
|---|---|---|---|
| Time-to-value (25%) | 5 | 2 | 3 |
| Density (20%) | 4 | 2 | 5 |
| Thumb ergonomics (10%) | 4 | 4 | 3 |
| Demo-ability on a grader's phone (20%) | 5 | 3 | 3 |
| 7-day feasibility (15%) | 4 | 3 | 2–4 |
| Point of view (10%) | 4 | 2 | 5 |
| **Weighted** | **4.5** | **2.6** | **3.6** |

**Recommendation: A as the shell, C as the signature, B as a sheet.**

- The **Brief** is the home and the Push surface. Its tier-1 results card carries a one-line settlement ("2 of 3 promises settled: growth kept, margin missed") — that line is C leaking into A and is what will make a grader lean in.
- The **Company page** carries the full **Ledger** (four-quarter grid + narrative-vs-numbers) above the other six research sections. Build the ledger for the ad-hoc research set first; show "awaiting transcript" honestly for portfolio names whose Q2 calls have not been transcribed.
- **Ask** is a field pinned above the bar on the company page (Readwise pattern). It opens a sheet; the answer uses the same grammar (headline → numbers → why it matters → receipts), with inline chips. No history view, no bubbles, no avatar.

Surfaces to build (seven): Brief · Window sheet · Rules · Companies list · Company page (header, promises, research accordion, filings) · Citation sheet · Ask sheet. Explicitly cut: onboarding, auth, portfolio editing UI (ship a JSON portfolio + a search box for ad-hoc tickers), notification settings beyond one "Install for alerts" row, charts beyond sparklines/bars, light/dark beyond a toggle.

Gesture map for the hybrid:

| Gesture | Where | Effect | Reversible |
|---|---|---|---|
| Tap header | Card | Expand/collapse in place | — |
| Swipe left | Any brief item | Seen → collapses into "Seen" group | Undo toast |
| Swipe right | Any brief item | Snooze company 7d | Rules › Per company |
| Tap ticker | Anywhere | Company page | Back / swipe |
| Tap chip | Receipts | Citation sheet (excerpt → link) | Swipe down |
| Press-and-hold | Any number | Source quote popover | Release |
| Tap pill | Brief | Window sheet | Swipe down |
| Drag handle | Window sheet | Live count + dateline | — |
| Stepper ± | Rules | Threshold, haptic tick at detents | — |
| Pull down | Brief | Refresh, "checked NSE hh:mm" | — |

---

## 6. Recommended design-system direction: "Ledger"

### 6.1 Concept

The traditional Indian account book — bahi-khata / chopda — is red-cloth-bound, hand-stitched, with pages crimped into columns for *naam* (debit) and *jama* (credit); traders open a fresh one at Diwali (Chopda Pujan). We borrow its **grammar, not its costume**: ruled paper, columns, right-aligned figures, a stitched dotted rule to close an edition, two kinds of entries (kept/missed). We do **not** paint the UI red (red is reserved for "down") and we do not put Shubh-Labh on the splash screen. (Sources: asiainch.org bahi craft; Indian Express on Chopda Pujan; gaatha.com.)

Default theme is **Paper** (warm off-white) — distinctive against the sea of near-black fintech and crypto UIs, legible in daylight on a grader's phone, and it reads "editorial" (FT/Economist) rather than "terminal". **Ink** (dark) is one toggle away and auto-follows `prefers-color-scheme`.

### 6.2 Typography

| Role | Face | Why | Loading |
|---|---|---|---|
| UI + all numbers | **IBM Plex Sans** (variable, wght 100–700) | Tabular lining figures by default, engineered/"man-and-machine" character that suits a ledger, OFL, variable file, not the Inter/Geist default. Use 400 / 500 / 600 only. | self-host WOFF2 latin subset, `font-display: swap`, size-adjusted fallback `system-ui` |
| Eyebrows, receipts, timestamps, citation chips | **IBM Plex Mono** 400/500 | Same superfamily; monospace says "evidence / machine-read"; 11–12 px caps tracked +0.08em | two static WOFF2 files |
| Dateline + deck only | **Newsreader** (variable, opsz) 500 | Designed by Production Type for on-screen news reading; one serif moment that says "an editor wrote this". Fallback: IBM Plex Serif. | one WOFF2; optional, drop if budget is tight |

Rules: `font-variant-numeric: tabular-nums lining-nums` on `html`; true minus `−` (U+2212) never hyphen; decimals aligned in tables; percentages one decimal; margins in **bp**; money in `₹` with `en-IN` grouping; compact `L`/`Cr` only in chips with `maximumFractionDigits: 2`; ticker symbols in Plex Sans 500 tracked +0.02em; never weight 300 or lighter in product UI.

Type scale (px / line-height / weight):

```
--fs-eyebrow  11/14  mono 500 caps +0.08em
--fs-meta     12/16  400
--fs-small    13/18  400
--fs-body     15/22  400
--fs-row      15/20  600       (card and row titles)
--fs-title    17/22  600
--fs-headline 20/26  600 −0.01em
--fs-dateline 24/28  serif 500 −0.005em
--fs-num-lg   28/32  500 tabular  (price in company header)
```

### 6.3 Colour (WCAG ratios verified with a script, `/tmp/finn-design/contrast.py`)

Paper mode (default):

| Token | Hex | Use | Contrast vs bg / surface |
|---|---|---|---|
| `--bg` | `#F6F2EA` | page | — |
| `--surface` | `#FDFBF6` | cards, sheets | — |
| `--ink` | `#15130F` | primary text | 16.6 / 17.9 (AAA) |
| `--ink-2` | `#4B4740` | secondary text | 8.3 / 8.9 (AAA) |
| `--ink-3` | `#6F6A60` | tertiary/meta | 4.8 / 5.2 (AA) |
| `--rule` | `#E2DCCE` | hairlines | 1.2 (decorative) |
| `--accent` | `#1F3FA8` | links, selected tab, handles, focus | 8.1 / 8.7 (AAA) |
| `--up` | `#1A7A4C` | positive delta | 4.8 / 5.2 (AA) |
| `--down` | `#B3261E` | negative delta | 5.9 / 6.3 (AA) |
| `--warn` | `#8F6400` | pending / revised / unexplained | 4.7 / 5.1 (AA) |

Ink mode:

| Token | Hex | Contrast vs bg / surface |
|---|---|---|
| `--bg` `#0F1013` · `--surface` `#17181C` · `--rule` `#272A30` | | — |
| `--ink` `#ECE8DF` | 15.6 / 14.5 (AAA) |
| `--ink-2` `#ACA79C` | 7.9 / 7.4 (AAA) |
| `--ink-3` `#8A857C` | 5.2 / 4.8 (AA) |
| `--accent` `#93A9FF` | 8.5 / 7.9 (AAA) |
| `--up` `#4FC98C` | 9.1 / 8.5 (AAA) |
| `--down` `#F2776D` | 6.9 / 6.5 (AA) |
| `--warn` `#E3B64A` | 10.0 / 9.3 (AAA) |

Colour discipline: colour appears **only** on deltas (up/down/warn) and interactive affordances (accent). Categories, tiers and companies are never coloured — tiers use weight and the left rule; categories use a glyph + small caps. Up/down are always paired with a sign and ▲/▼ (luminance difference between up and down is small on paper: 0.036 — colour alone would fail colour-vision users).

### 6.4 Spacing, density, shape

- 4-pt base. Page gutter 16. Card padding 12 (vertical) × 16 (horizontal). Gap between tier-1 cards 12; between tiers 24.
- Rows: dense list 40 px; interactive row 48 px; chip visual 28 px with 44 px hit area; bottom bar 56 px + `env(safe-area-inset-bottom)`.
- Separation by **1 px hairlines**, not boxes or shadows. Only sheets and the popover get a shadow.
- Radii: 4 (chips), 8 (cards — barely rounded, paper not pill), 16 (sheets top corners), 999 (window pill).
- Sparkline: 56×14 px inline (≈4:1 → 5:1 per Tufte), stroke 1.25 px `--ink-2`, last point as a 2.5 px dot, no axes; volume bars 10×14 px, today's bar in `--warn` or `--up/--down`.

### 6.5 Component inventory (with the one spec that matters for each)

1. **DatelineHeader** — eyebrow (mono caps) + serif dateline + deck (≤2 lines, `--fs-body`, `--ink-2`).
2. **TierHeader** — mono caps eyebrow with trailing hairline; "WORTH KNOWING", "ROUTINE".
3. **FilingCard** — collapsed: 2 lines (ticker·type·time / headline); expanded: + body block + why-it-matters + receipts. Left 2 px `--ink` rule for tier 1 only. Swipe actions revealed behind the row.
4. **ResultsTable** — 5 columns `label | value | QoQ | YoY | spark`; `grid-template-columns: 1fr 64px 64px 64px 56px`; unit "₹ Cr" once in the header; a consolidated/standalone segmented toggle in the expanded state.
5. **DeltaChip** — `▲+9.8%` / `▼−2.3%` / `−150bp`; colour + glyph + sign; neutral grey when |Δ| < 0.05%.
6. **Sparkline / VolumeBars** — pure SVG, `aria-label="Revenue, five quarters, rising; latest 3,452 crore"`.
7. **BioCard** — name, role rows (title left, years right-aligned tabular), education line, provenance line listing source *types* and counts.
8. **SectionAccordion** — row = title + verdict (≤12 words, `--ink-2`); expanded = 3–5 bullets, each ≤1 **CitationChip**; chevron rotates 90°, height animates 200 ms.
9. **CitationChip** — mono 11 px, 4 px radius, `--surface` on `--bg` with `--rule` border; text like `AR FY26 p.118` or `Q2 call 00:41:20`; tap → sheet; long-press → inline quote.
10. **CitationSheet** — doc title · locator · highlighted excerpt (serif or mono, 15/22) · "Open PDF at page" (`#page=118` works in desktop/Android viewers; iOS Safari ignores it — fall back to opening the PDF plus showing the excerpt) · "Copy quote".
11. **PromiseRow / PromiseGrid** — status glyphs `● kept  ✕ missed  ◐ pending  – n/a`; quote in italics `--ink-2`; actual vs target tabular.
12. **WindowPill + WindowSheet** — pill shows `◔ Last 24h ▾` (or "Since Fri close"); sheet with 30-day density strip, two handles snapping to 15:30 IST closes, presets, live count button.
13. **RuleStepper** — sentence-embedded `⟨ − 4.0 % + ⟩`, detents 0.5 % / 0.25×; haptic tick on iOS via a transparent native switch overlay on the ± buttons, `navigator.vibrate(8)` on Android.
14. **ToggleChip** — announcement categories; on = `--ink` fill with paper text; off = outline.
15. **BacktestStrip** — 30 bars + sentence "7 alerts · about 1.6 a week" + top offenders.
16. **QuietState** — verdict sentence + checked-at line + fold + COMING UP list + EOD small multiples.
17. **WorkingReceipt** — staged lines that tick as they complete ("Reading 42-page results PDF · Found P&L table p.2 · Computing QoQ/YoY · Checking 3 promises"); replaces skeletons for anything > 1 s; renders partial results as soon as the numbers exist.
18. **StaleBanner** — "Showing data checked 21 min ago · NSE unreachable" as a hairline strip, never a modal.
19. **BottomBar** (3 tabs) and **AskField** (pinned above bar on company page; opens AskSheet).
20. **Toast** — single, bottom, 5 s, with Undo; never stacks.
21. **TickerRow** (Companies list) — name · price · delta chip · 1y sparkline · last-filing age; swipe = snooze.

### 6.6 Motion principles

- Three durations: 120 ms (state), 200 ms (expand/collapse, chip), 320 ms (sheet). Easing `cubic-bezier(.2,0,0,1)` out, `cubic-bezier(.4,0,.2,1)` in-out.
- Motion only where it carries meaning: accordion height, sheet slide, swipe follow-the-finger, **NumberFlow** (`@number-flow/react`, MIT, 7.7k★) rolling the four results numbers *once* when a card expands (trend-aware, respects reduced motion).
- One choreography on first paint: dateline → deck → cards, 60 ms stagger, ≤240 ms total. Nothing loops; nothing pulses; no shimmer.
- `prefers-reduced-motion`: everything becomes opacity-only ≤120 ms.

### 6.7 Empty, loading, error and quiet states

| State | What the screen says | Why |
|---|---|---|
| First open (grader) | The current brief, pre-loaded portfolio, no login | the first screen is the grade |
| Quiet window | "Nothing material since Monday's close." + checked-at + fold + Coming up | quiet is a result |
| Window auto-widened | deck says "Quiet weekend — showing since Friday's close" | honesty about the window |
| LLM work > 1 s | WorkingReceipt with named steps; numbers appear before narrative | Arc/Artifact: show the pipeline |
| Cached research | instant render + "as of 6 Nov · refresh" | efficiency is graded |
| Parse failure | "Couldn't read this filing (scanned image). Open filing ↗" | the raw filing is always the floor |
| Transcript not yet filed | promise rows `◐ pending · transcript due by Thu 19 Nov` | settlement lags results |
| Data source down | StaleBanner with last-checked time | never a blank screen |
| Ad-hoc ticker | "Fetching AR FY26 (218 pp)…" receipt with ETA; partial sections appear as they finish | generalisation must be visible |

### 6.8 Accessibility basics

Contrast as above (all text ≥4.5:1); never colour-only (sign + glyph); ≥44 × 44 pt hit areas with 8 px gaps (10–12 mm near screen edges per Hoober); `rem`-based type so Dynamic Type / browser zoom scales it; swipe actions also exposed as buttons in the expanded card (gestures are never the only path); `aria-live="polite"` on the brief deck when the window changes; sparklines carry `aria-label` sentences; focus rings in `--accent` 2 px; sheets trap focus and close on Escape/swipe-down; `prefers-reduced-motion` honoured; IST timestamps written in full on first mention ("18:42 IST").

### 6.9 CSS variables (drop-in)

```css
:root {
  /* colour — paper */
  --bg:#F6F2EA; --surface:#FDFBF6; --ink:#15130F; --ink-2:#4B4740; --ink-3:#6F6A60;
  --rule:#E2DCCE; --accent:#1F3FA8; --up:#1A7A4C; --down:#B3261E; --warn:#8F6400;
  --shadow-sheet:0 -8px 24px rgba(21,19,15,.12);

  /* type */
  --font-sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --font-serif:"Newsreader","IBM Plex Serif",Georgia,serif;
  --fs-eyebrow:11px; --lh-eyebrow:14px; --ls-eyebrow:.08em;
  --fs-meta:12px;    --lh-meta:16px;
  --fs-small:13px;   --lh-small:18px;
  --fs-body:15px;    --lh-body:22px;
  --fs-row:15px;     --lh-row:20px;
  --fs-title:17px;   --lh-title:22px;
  --fs-headline:20px;--lh-headline:26px; --ls-headline:-.01em;
  --fs-dateline:24px;--lh-dateline:28px;
  --fs-num-lg:28px;  --lh-num-lg:32px;
  --w-regular:400; --w-medium:500; --w-semibold:600;

  /* space (4-pt) */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px; --s-6:24px; --s-8:32px; --s-10:40px;
  --gutter:16px; --card-pad-y:12px; --card-pad-x:16px;
  --row-h:40px; --row-h-touch:48px; --hit-min:44px; --bar-h:56px;

  /* shape */
  --r-chip:4px; --r-card:8px; --r-sheet:16px; --r-pill:999px; --hairline:1px;

  /* motion */
  --dur-1:120ms; --dur-2:200ms; --dur-3:320ms;
  --ease-out:cubic-bezier(.2,0,0,1); --ease-in-out:cubic-bezier(.4,0,.2,1);

  /* layers */
  --z-bar:30; --z-sheet:40; --z-toast:50;

  /* data viz */
  --spark-w:56px; --spark-h:14px; --spark-stroke:1.25px;
}
[data-theme="ink"] {
  --bg:#0F1013; --surface:#17181C; --ink:#ECE8DF; --ink-2:#ACA79C; --ink-3:#8A857C;
  --rule:#272A30; --accent:#93A9FF; --up:#4FC98C; --down:#F2776D; --warn:#E3B64A;
  --shadow-sheet:0 -8px 24px rgba(0,0,0,.5);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="paper"]) { /* same as [data-theme="ink"] */ } }

html { font-family:var(--font-sans); font-variant-numeric:tabular-nums lining-nums;
       background:var(--bg); color:var(--ink); -webkit-text-size-adjust:100%; }
.num { font-variant-numeric:tabular-nums lining-nums; letter-spacing:0; }
.delta-up { color:var(--up); } .delta-down { color:var(--down); } .delta-warn { color:var(--warn); }
.eyebrow { font:var(--w-medium) var(--fs-eyebrow)/var(--lh-eyebrow) var(--font-mono);
           letter-spacing:var(--ls-eyebrow); text-transform:uppercase; color:var(--ink-3); }
.receipt { font:var(--w-regular) var(--fs-eyebrow)/var(--lh-eyebrow) var(--font-mono); color:var(--ink-3); }
.rule { border-top:var(--hairline) solid var(--rule); }
.rule-stitched { border-top:var(--hairline) dotted var(--ink-3); }   /* closes an edition */
.card-material { border-left:2px solid var(--ink); padding-left:calc(var(--card-pad-x) - 2px); }
.bar { height:calc(var(--bar-h) + env(safe-area-inset-bottom)); padding-bottom:env(safe-area-inset-bottom); }
@media (prefers-reduced-motion: reduce) { * { animation-duration:1ms !important; transition-duration:1ms !important; } }
```

Number formatting helpers (TypeScript):

```ts
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });          // 3,452  (₹ Cr given once in header)
const inrCompact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }); // 1.52L Cr chips
const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}%`;   // U+2212 minus
const bp  = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x))}bp`;
```

---

## 7. Anti-patterns (what will read as AI slop to this jury)

1. **Purple/indigo gradients, glass cards, glowing borders.** Instead: paper, hairlines, one ink accent.
2. **Chat bubbles as the primary surface**, avatars, "typing…" dots. Instead: a brief; Ask as a sheet.
3. **Emoji section headers / emoji bullets** (Arc's one misstep). Instead: mono caps eyebrows and glyphs from a fixed vocabulary.
4. **"Insights" cards with no evidence**, "AI-generated summary" badges with sparkle icons everywhere. Instead: receipts on every card; one small "generated" label in the footer.
5. **Confidence percentages** ("87% confident"). Instead: how many sources and which.
6. **Endless skeleton loaders / shimmer.** Instead: WorkingReceipt with named steps; partial results first.
7. **Pie/donut charts** for revenue mix; **3D or gradient-filled area charts**. Instead: a one-line mix ("Adhesives 55% · C&B 32%") or a horizontal bar; sparklines for trend.
8. **Hero portfolio number with no comparison**; Instead: every number has a QoQ/YoY or a target beside it (Flighty: official next to predicted).
9. **Colour as decoration**: coloured category badges, rainbow tickers, brand-coloured charts (Trade Republic's rejected "logo mode"). Instead: colour only on deltas and affordances.
10. **Desktop dashboard squeezed into a phone**: three-column grids, tooltips on hover, hamburger menus hiding the eight research sections. Instead: accordion with verdict lines; press-and-hold instead of hover.
11. **Over-rounded money** ("₹10L" for ₹9.99L), hyphen as minus, proportional digits that jitter. Instead: `en-IN`, `maximumFractionDigits: 2`, U+2212, tabular figures.
12. **Toasts, modals and "Rate us" prompts**; onboarding carousels; "Welcome back, Investor!" greetings. Instead: open straight into the brief; one undo toast at most.
13. **Summaries that restate the title** ("Company announces results") and adjectives ("impressive beat"). Instead: numbers first; copy rules in §3.
14. **Per-filing push notifications.** Instead: one summary notification per edition plus immediate threshold alerts.
15. **Hidden window**: a date picker buried in settings. Instead: the pill is always on screen.

---

## 8. Delight details that cost little and signal craft

| Detail | Cost | Why it lands |
|---|---|---|
| Relative time + market phase: "filed 18:42 IST · after close", "pre-open", "during trading" | trivial | Says we understand Indian market hours |
| Numbers roll once on expand (NumberFlow), trend-aware direction | 1 h | Robinhood/Family-grade polish, no gimmick |
| Press-and-hold any number → source quote | 2 h | Receipts become tactile |
| Swipe left = Seen, swipe right = Snooze company 7d, with Undo | 3 h | Superhuman triage; the user curates their own fold |
| Haptic tick on stepper detents and on swipe commit (iOS switch overlay; Android `vibrate`) | 2 h | Rules feel like a physical dial |
| "Since you last read" preset and a hairline marker in the brief where you stopped | 2 h | The brief remembers you (Slack's red line) |
| Fold line with a glyph per routine category (⌧ newspaper ad, ◫ investor meet, ⊟ compliance) | 1 h | Density + transparency in one line |
| "Read in 2 min · checked NSE 20:31 IST" footer | trivial | Smart Brevity's read-time + Zerodha's honesty |
| Auto-widen on quiet weekends with an explicit sentence | 1 h | Robust demos on a Sunday |
| 30-day density strip in the window picker doubles as a season chart | 2 h | One component, two jobs |
| Backtest sentence under the rules ("would have fired 7 times") | 2 h | Shows judgment about noise |
| "Coming up" board-meeting dates in the quiet state (NSE Reg 29 intimations) | 2 h | The app knows the calendar |
| Orphaned promises under a departing executive's bio | 1 h (given ledger) | A genuinely new idea |
| Share a results card as a PNG (html-to-image) | 2 h | Graders will screenshot it anyway |
| Stitched dotted rule to close an edition; serif dateline | trivial | The ledger metaphor, quietly |
| Install prompt as one row: "Install for alerts" → A2HS instructions | 1 h | Honest about iOS push |
| Stretch: cited PDF page rendered as an image with the passage highlighted (`pdftoppm` + `pdftotext -bbox`, both installed) | 1 day | Evidence you can see, not just a link |

---

## 9. Prioritised recommendations for the team

1. **Lock the hybrid (Brief + Ledger + Ask-sheet) and the seven surfaces today.** Everything else is scope creep.
2. **Choose the portfolio for the calendar**: include 5–8 companies with Q2 board meetings on 10–13 Nov (quarterlyresults.in lists them) so tier-1 results cards are live during grading; include 2–3 banks/insurers to prove the results parser handles their different Reg 33 format (or explicitly show "bank format — PBT/PAT only").
3. **Ship the design tokens in §6.9 on day 1** and build every component against them; no ad-hoc colours or sizes.
4. **Make the results card the first component**: it is the brief's example, it is the settlement view, and it is the screenshot.
5. **Build the Rules screen with the backtest** before any alert plumbing — it demonstrates judgment even if push never ships.
6. **Build the Ledger for the 3–5 ad-hoc companies first**, with the four-quarter grid; portfolio companies show `◐ pending` where transcripts are missing.
7. **Treat push as a bonus**: a Home-Screen install row + one summary notification per edition; the Brief must be complete without it.
8. **Enforce the copy budgets in prompts** (§3) and render `WorkingReceipt` steps from real pipeline stages — it is the cheapest "no AI slop" signal.
9. **Self-host three font files**, preload Plex Sans and Plex Mono; drop Newsreader if the budget is tight.
10. **Test on a real iPhone in Safari and an Android Chrome** by day 3: swipe conflicts with back-gesture, safe areas, `#page=` behaviour, A2HS.

---

## 10. Assumptions other agents should challenge

1. **Paper (light) as the default theme.** I believe it is more distinctive and more legible for a daytime grader; a dark default is the "serious finance" cliché. If the team's stakeholders strongly expect dark, flip the default — the tokens support both.
2. **Twice-daily cadence (20:30 / 08:30 IST)** is the right rhythm for a "lean public-markets firm". If the backend polls NSE every 15 minutes anyway, a live brief with "new since you opened" markers may be better; I still would not notify per filing.
3. **Default window = 24h with auto-widen on quiet weekends.** The brief says default 24h; auto-widening changes the default silently (we say so in the deck). Challenge whether graders will see that as helpful or as disobeying the spec.
4. **Promise extraction quality.** The Ledger is the signature; a wrong "missed" is a visible failure. If extraction precision cannot reach ~90% on the ad-hoc set by day 4, reduce the ledger to Guidance + Narrative-vs-numbers prose with quotes, and keep the grid as a "what it would look like" with real quotes.
5. **The 3-tier fold** (Material ≤5 / Worth knowing / Routine) assumes a classifier that is reliable on `unclassified`, `press_release` and `investor_meetings` — the bulk of results-week noise. If recall on material items is uncertain, add a "Not sure — 2 filings" bucket rather than mis-folding.
6. **Exchange calendar edge cases this very week** (verified via NSE circular and ET/BusinessToday, 8 Nov): Muhurat trading ran **Sun 8 Nov 14:20–15:30**, markets are open Mon 9 Nov and **closed Tue 10 Nov** (Diwali Balipratipada). The Sunday session produces a tiny-volume bar that will poison 20-day volume averages and could fire false "2× volume" anomalies on Monday; the Tuesday holiday will make a naive "last 24h" window empty. Exclude special sessions from averages and drive the dateline/auto-widen logic from the NSE holiday list, not from weekdays. (Whether yfinance even returns the Muhurat bar is unverified — the backend agent should check.)
7. **Bio sourcing**: LinkedIn is not scrapable in practice; I assumed bios come from the filing text (SEBI's Reg 30 / Schedule III disclosure format asks for a "brief profile" on appointments, so the filing itself usually has 2–4 lines), prior filings and web search. The UI shows the source list; if only the filing is available, the card must say so.
8. **Gesture conflicts**: swipe-right-to-snooze collides with iOS back-swipe at the left edge and with Android back gesture. The implementation should start swipes ≥24 px from the edge or use a leading "handle" region.
9. **Bank/insurer results format** (no EBITDA, different line items) breaks the four-row table; the design assumes a variant row set per company type.
10. **Haptics and `#page=` deep links** are progressive enhancements that behave differently on iOS; nothing should depend on them.

---

## 11. References (accessed 8 Nov 2026)

Finance & markets apps
- Bloomberg mobile redesign case — https://makeyourdesignwork.com/portfolio/work17/ ; https://www.amewongsa.com/case-studies/bloomberg-mobile-2
- Koyfin mobile case (DIXI) — https://www.dixi.agency/koyfincase ; features — https://www.koyfin.com/help/mobile-app-feautres/
- Robinhood design notes — https://oh-my-design.kr/design-systems/robinhood ; COLLINS × Robinhood — https://the-brandidentity.com/project/collins-robinhood-combine-make-investing-accessible-affordable-engaging
- Trade Republic 4.0 — https://vand.org/vand-certified/trade-republic-mobile-application-interface ; https://support.traderepublic.com/pl-pl/1602-What-has-changed-in-the-new-app-design-
- Delta 3.0 (Public Sans, monochrome mode) — https://blog.delta.app/introducing-delta-3-0-3508e1cb3d5 ; Portfolio 3.0 — https://delta.app/academy/post/your-portfolio-your-way
- Zerodha "User disengagement" — https://zerodha.tech/blog/user-disengagement/ ; Kite — https://yourstory.com/2020/11/app-kite-zerodha-speed-simplicity-first-time-stock-trader
- Groww experiments — https://vedantja.in/writing/junta-quirks ; https://www.figma.com/customers/figma-helps-groww-simplify-investing/
- Public Alpha — https://help.public.com/en/articles/9354354-what-is-alpha ; https://medium.com/the-public-blog/introducing-alpha-your-investing-co-pilot-c536b740e907
- Copilot Money — https://developer.apple.com/articles/copilot-money/ ; https://styles.refero.design/style/91b110da-902b-4d09-8bf0-26bd1f25f8b2
- Apple Weather iOS 15 / iOS 27 Highlights — https://appleinsider.com/articles/21/07/26/how-to-use-the-new-weather-app-in-ios-15 ; https://www.techbetweenthelines.com/whats-new-in-the-ios-27-weather-app-highlights-and-new-forecast-views-explained/
- Apple Stocks / Health breakdowns — https://screensdesign.com/showcase/stocks ; https://screensdesign.com/showcase/apple-health ; https://www.macstories.net/stories/health-in-ios-13-a-foundation-for-apples-grand-wellness-ambitions/
- Revolut 10 — https://www.revolut.com/blog/post/revolut-10/

Triage, lists, calendars
- Superhuman mobile gestures — https://blog.superhuman.com/superhuman-for-iphone-now-faster-than-ever/ ; swipes — https://help.superhuman.com/hc/en-us/articles/46005742942861-Customizing-Swipes-and-Triage-Bar ; Split Inbox — https://help.superhuman.com/hc/en-us/articles/46005619081101-Default-Split-Inbox
- Things 3 — https://www.uiskillbook.com/design-md/things-3 ; https://culturedcode.com/things/features/ ; interview — https://sspai.com/post/39724
- Fantastical DayTicker — https://www.macstories.net/reviews/fantastical-for-iphone-review/ ; https://flexibits.com/fantastical-ios/help/calendar-views
- Linear — https://designmd.cc/benchmarks/linear ; https://www.uiskillbook.com/design-md/linear.md
- Flighty — https://developer.apple.com/news/?id=970ncww4 ; https://flighty.com/help/delay-predictions ; https://blakecrosley.com/guides/design/flighty
- CARROT Weather — https://support.meetcarrot.com/weather/index.html ; https://www.macstories.net/reviews/carrot-weather-5-9-a-robot-relationship-and-layouts/
- Readwise Reader — https://docs.readwise.io/reader/guides/ghostreader/chat ; https://docs.readwise.io/reader/docs/faqs/appearance

AI answer products
- Perplexity citation chips — https://github.com/Meliwat/awesome-ios-design-md/blob/main/design-md/misc/perplexity/DESIGN.md ; https://aiuxplayground.com/teardowns/perplexity/citations
- Arc Search "Browse for me" — https://medium.com/design-bootcamp/a-product-manager-breaks-down-the-arc-search-app-99bc2a15c762 ; https://www.inverse.com/tech/arc-search-ios-app-interview-lead-designer-engineer
- Artifact (AI transparency, clickbait rewriting) — https://medium.com/artifact-news/clickbait-rewriting-on-artifact-behind-the-scenes-5e3d0971383 ; https://medium.com/@artifact_team/summaries-tool-now-on-artifact-19088bca76bb

Editorial information design
- Tufte sparklines — https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/ ; https://www.edwardtufte.com/notebook/sparklines-history-by-tufte-1324-to-now/
- FT Visual Vocabulary — https://ft-interactive.github.io/visual-vocabulary/ ; Economist chart style guide (PDF) — https://sa.ipaa.org.au/wp-content/uploads/2026/02/Economist-CHARTstyleguide_20170505.pdf ; https://education.economist.com/blog/interviews/tips-for-visualising-data-like-the-economist
- Smart Brevity — https://www.smartbrevity.com/what-is-smart-brevity ; https://axioshq.com/insights/axioms-cut-read-time-and-boost-comprehension

Notifications, platform, ergonomics
- Apple HIG Notifications — https://developer.apple.com/design/human-interface-guidelines/notifications ; interruption levels — https://appguidelines.com/human-interface-guidelines/version/22/managing-notifications/ ; `relevanceScore` — https://developer.apple.com/documentation/usernotifications/unnotificationcontent/relevancescore ; iOS 18.1 summaries — https://support.apple.com/en-us/108781
- Web Push on iOS — https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ; https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers ; https://openpwa.net/reference/platforms/ios-safari/
- iOS web haptics — https://bugs.webkit.org/show_bug.cgi?id=266066 ; https://github.com/lochie/web-haptics/issues/41 ; https://github.com/howdoiusekeyboard/haptics
- Hoober on grip and touch accuracy — https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php/ ; https://www.uxmatters.com/mt/archives/2017/03/design-for-fingers-touch-and-people-part-1.php ; https://www.4ourthmobile.com/publications/designing-for-touch
- NumberFlow — https://number-flow.barvian.me/ ; https://github.com/barvian/number-flow/

Typography & number formatting
- IBM Plex (OFL; tabular default; Devanagari) — https://github.com/ibm/plex/ ; issue #131 — https://github.com/IBM/plex/issues/131 ; variable axes — https://fontsource.org/fonts/ibm-plex-sans/about
- Geist OpenType features — https://www.csstypestudio.com/library/font/geist ; Satoshi (Fontshare) — https://fontshare.com/fonts/satoshi
- Font alternatives & numerals — https://fontalternatives.com/blog/best-fonts-legible-numerals-ui/ ; https://fontalternatives.com/alternatives/sohne/ ; https://void.parthkapoor.me/docs/inspire/font-alternatives
- `Intl.NumberFormat('en-IN')` — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat ; rounding trap — https://monu-kumar.hashnode.dev/100-000-is-wrong-formatting-indian-currency-in-javascript ; https://www.localization.guide/country/in
- Colour conventions — Jiang et al. 2014 — https://onlinelibrary.wiley.com/doi/10.1002/bdm.1800 ; ECharts candlestick note — https://github.com/apache/echarts/issues/14338

Indian market context
- Q2 FY27 results week & timings — https://quarterlyresults.in/blog/ ; LODR timeline — https://thefootnotes.in/articles/quarterly-results-due-date-timeline-q2-fy27 ; SEBI EoDB (3-hour window) — https://vinodkothari.com/wp-content/uploads/2024/10/EODB_SEBI-BM-dated-30.09.2024_VKCo.pdf
- Reg 33 results format (sample filings) — https://www.puravankara.com/uploads/Unaudited_Standalone_and_Consolidated_Financial_Results_Q12027.pdf ; https://www.bseindia.com/downloads1/Regulation_33_Financial_Result.pdf
- Muhurat trading 2026 & holiday on Tue 10 Nov — https://nsearchives.nseindia.com/content/circulars/COM76978.pdf ; https://economictimes.indiatimes.com/markets/stocks/news/muhurat-trading-2026-date-time-settlement-rules-and-other-key-things-to-know/articleshow/135562482.cms ; https://www.businesstoday.in/markets/stocks/story/diwali-muhurat-trading-2026-nse-bse-timings-monday-market-schedule-what-investors-should-know-566348-2026-11-08
- Bahi-khata / Chopda Pujan — https://asiainch.org/craft/bahi-clothbound-books-of-rajasthan/ ; https://indianexpress.com/article/cities/ahmedabad/ahmedabad-chopda-pujan-tradition-of-writing-accounts-survive-even-in-digital-era-7606683/ ; https://gaatha.com/bahi-khata-story/

Not verified / not accessible: Mobbin and Dribbble (login-walled or low-signal; used only as secondary confirmation), Stratechery (newsletter design, no public writeup found worth citing), Bloomberg Graphics mobile chart guidelines (no public style guide located), Söhne-specific comparisons beyond fontalternatives.com. The Tavily search MCP returned "Invalid API key"; all web research used the built-in search tool.
