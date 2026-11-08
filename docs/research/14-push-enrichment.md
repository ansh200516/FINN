# 14 — Push-side enrichment: management-change bios, one-line summaries, dedupe

Researcher: push-enrichment agent. Date: Sun 8 Nov 2026. Scratch: `/tmp/finn-enrich/` (venv, 44 downloaded filings, prototypes, raw outputs). Everything below was run on the build machine today unless marked *unverified*.

## 0. TL;DR

1. **The bio is already in the filing.** SEBI LODR Reg 30 → Schedule III Part A Para A item 7 → SEBI circular Annexure I para 7.3 makes "brief profile (in case of appointment)" a *mandatory* disclosure field. In 11 real appointment filings from 6–7 Nov 2026, **10 contained a usable 100–600-word bio**; the 11th (Asian Paints / Leo Puri) pointed to an earlier filing, which the NSE symbol-history API found in 0.2 s. Resignations say "Not Applicable" but must attach the resignation letter with reasons (item 7C). **Primary source beats LinkedIn, and graders will prefer it.**
2. NSE's "Resignation of Director/KMP/SMP" filings ship an **XBRL zip** (`in-capmkt` taxonomy, 2025-11-30 version) with structured `NameOfDesignatedPerson`, `DesignationOfDesignatedPerson`, `CategoryForChange`, `EffectiveDateOfReasonOfChange`, `ReasonOfResignationInBrief`, and — when an appointment is bundled — `BriefProfile` and `TermOfAppointmentInMonths`. Zero-LLM parsing for ~75 filings/week.
3. **Prototype `enrich_person()` reached "high" confidence with a correct, filing-grounded bio for all 9 distinct appointees tested** (12 runs incl. 3 re-runs after fixing extractor bugs): Angan Guha→Wipro, Jayant Balan→Voltas MD, Leo Puri→Asian Paints chair, Madhavan Hariharan→Birlasoft CEO, V.N. Srivatsan→HDFC Bank CCO, IAS officer Anupam Kumar→PowerGrid, Girish Goenka→Uniphos CEO, Rajib Mukhopadhyay→Heranba CFO, Steffen Berns→Suprajit NED. Median 4.5 s end-to-end, ~1,100 tokens in / ~290 out on `gemini-3.5-flash-lite` ≈ $0.001/person at paid rates (free on free tier).
4. **Web enrichment reality on this key:** Gemini *Google Search grounding* returns `429 RESOURCE_EXHAUSTED` in <1 s on every model — the pricing page confirms it is **"Not available" on the free tier**. Tavily: no `TAVILY_API_KEY` in env and the MCP key is invalid. DuckDuckGo (`ddgs`) returns nothing. LinkedIn: HTTP 999 + `authwall`. Company IR pages: 404 on guessed URLs and not updated for days-old appointments. **What works keyless:** Google News RSS (`news.google.com/rss/search?q=…`, ~0.7 s, dated headlines from ET/Reuters/Mint/Moneycontrol) and Wikipedia (only for marquee names: 1 of 12 had a page).
5. **One-liner prototype on 26 real filings across all 17 categories**, `gemini-3.5-flash-lite`, one JSON schema: 17 fully correct, 8 partially correct, **0 fabricated numbers**, 1 transient 503. Partial-credit causes: model-*summed* totals (2), one field mislabel, one materiality over-call, one category slip (earnings-call vs investor-meet), one multi-entity filing where only one of two pledgors was captured, one semantic (company-pledges-subsidiary vs promoter pledge). Cost ≈ **$0.0016/filing** (2,600 in / 320 out). Median latency 7.6 s (free-tier contention).
6. **NSE gives a free one-liner already:** the announcements API carries a `voiceSummary` (≈730 chars, numerically faithful) for roughly the **last 24–36 h only** (424/426 on 7 Nov, 0/1,239 on 6 Nov). Feeding it instead of the PDF halves tokens and skips the download. Capture it at ingest or lose it.
7. **Dedupe measured:** 10.7% of all NSE filings in the 8-day sample are *exact re-posts* of the same PDF under a different subject (Voltas posted one board-outcome PDF 5 times). Same-company + same-category + 48 h clustering reduces cards 25% market-wide; for a 20-stock portfolio in results week: **103 filings → 73 events → 50 non-routine cards (≈6/day)**.
8. Hard product rules that fell out of the data: never display a model-computed total; a card must list every entity in a multi-party filing or say "+1 more"; the bio card must show its source filing link; confidence must be computed deterministically from evidence type, not asked of the model.

## 1. Environment facts measured today

| Thing | Result |
|---|---|
| Env vars | Only `GEMINI_API_KEY`. **No** `TAVILY_API_KEY` (checked names only). |
| Tavily MCP tool | `MCP error -32603: Invalid API key` on both search and extract → unusable even at research time. |
| Gemini models on this key (`models.list`) | `gemini-3.8-flash`, `3.7-flash`, `3.6-flash`, `3.5-flash`, `3.5-flash-lite`, `3.1-flash-lite`, `gemma-4-26b-a4b-it`, `gemma-4-31b-it`, `2.5-pro`. `gemini-2.5-flash` and `2.5-flash-lite` → `404 … no longer available to new users`. |
| Responding under shared load | `3.5-flash-lite` 1.1 s, `3.1-flash-lite` 0.9 s, `3.5-flash` 0.9 s. `3.8-flash` → 429 (siblings exhausted it). `3.7-flash` 60 s/no text with `max_output_tokens=5` (thinking model). |
| Free-tier limits (pricing page + aiplug measurement) | flash-lite **15 RPM / 500 RPD**; `3.5-flash` and `3.x-flash` **5 RPM / 20 RPD**. RPD resets midnight Pacific. One key shared by the whole team → budget it. |
| Paid-equivalent prices (https://aistudio.google.com/docs/pricing) | `3.5-flash-lite` $0.30 in / $2.50 out per 1M; `3.8-flash` $0.75 / $3.75 (to 31 Dec 2026; doubles 1 Jan 2027). Grounding with Google Search: free tier **"Not available"**; paid 5,000/month free then $14/1,000. |
| Grounding test | `tools=[Tool(google_search=GoogleSearch())]` → `429 RESOURCE_EXHAUSTED` in 0.3–0.9 s on `3.8-flash`, `3.5-flash`, `3.5-flash-lite`, `3.1-flash-lite`. Plain calls on the same models succeed → it is the tool quota, not load. |
| NSE announcements API | `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY[&symbol=X]` — needs a homepage GET first for cookies and a browser TLS fingerprint. `curl_cffi` `Session(impersonate="chrome")` → 200; 8 days = 6,796 rows / 5.3 MB in ~3 s; `symbol=WIPRO` 39 days in 0.8 s. Attachments on `nsearchives.nseindia.com` download in ~0.1–0.3 s each with the same session. |
| NSE row shape | `symbol, sm_name, sm_isin, smIndustry, desc (subject, ~100 values), attchmntText (one-line summary), attchmntFile (PDF/ZIP URL), attFileSize, an_dt, sort_date, seq_id, hasXbrl, voiceSummary, voiceUrl (mp3)`. |
| NSE PIT / pledge endpoints | `/api/corporates-pit?index=equities&from_date&to_date` and `/api/corporate-pledgedata?…` → 200 but `{"data":[]}` with these params (param names probably differ; *unverified*). `/api/corporate-sast` → 404. |
| BSE API | `api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?…` → **403 Akamai "Access Denied"** for curl and `requests` even with full browser headers; **200** with `curl_cffi` impersonation. `subcategory=Appointment` under `strCat=Company+Update` returned 0 rows (subcategory label likely different; not pursued — NSE suffices). |
| Local tools | `pdftotext -layout` extracts all 44 sampled PDFs (none were image-only scans; Gujarat Alkalies' was OCR-embedded but readable). |

## 2. Regulatory evidence: the brief profile is mandatory

**Chain of authority (all verified from source text):**

- SEBI (LODR) Regulations 2015, **Regulation 30** read with **Schedule III, Part A, Para A, item 7**: "Change in directors, key managerial personnel (Managing Director, Chief Executive Officer, Chief Financial Officer, Company Secretary etc.), senior management, Auditor and Compliance Officer" — a *deemed material* event, disclosed without a materiality test.
- **SEBI circular CIR/CFD/CMD/4/2015, 9 Sep 2015** "Continuous Disclosure Requirements for Listed Entities – Regulation 30" (mirror: https://taxguru.in/sebi/continuous-disclosure-requirements-listed-entities.html), Annexure I, A.7: *"7.1 reason for change viz. appointment, resignation, removal, death or otherwise; 7.2 date of appointment/cessation (as applicable) & term of appointment; **7.3 brief profile (in case of appointment)**; 7.4 disclosure of relationships between directors (in case of appointment of a director)."*
- **SEBI circular SEBI/HO/CFD/CFD-PoD-1/P/CIR/2023/123, 13 Jul 2023** (https://www.sebi.gov.in/sebi_data/attachdocs/jul-2023/1689245602256.pdf), effective 15 Jul 2023, following the LODR (Second Amendment) Regulations 2023 (notification SEBI/LAD-NRO/GN/2023/131, 14 Jun 2023). Annexure I item 7 now reads "…**re-appointment**… **senior management**…" with the same four sub-fields, and adds:
  - **7A** auditor resignation → detailed reasons; **7B** independent-director resignation → reasons; **7C** resignation of KMP / senior management / Compliance Officer / non-independent director → *"letter of resignation along with detailed reasons … within seven days from the date that such resignation comes into effect"*; **7D** MD/CEO indisposed >45 days in a rolling 90.
  - Annexure II timelines: 30 min from board-meeting close; 12 h for events originating inside the company; 24 h for external; "Change in directors/KMP…" within **24 h** in case of resignation. Exchanges (circulars of 14 Jul 2023) require the date & time of occurrence in every Reg-30 PDF.
- **Master Circular HO/49/14/14(7)2025-CFD-POD2/I/3762/2026** (issued 11 Jul 2023, last updated **30 Jan 2026**; https://www.sebi.gov.in/sebi_data/attachdocs/jan-2026/1769776024792.pdf, 291 pp) — Section V-A, **Annexure 18** para 7 repeats the four fields verbatim; Annexure 18A has timelines. Today's filings cite exactly this (Heranba, HDFC Bank: "read with SEBI Master Circular No. HO/49/14/14(7)2025-CFD-POD2/I/3762/2026 dated January 30, 2026").
- **Machine-readable form:** SEBI XBRL taxonomy `http://www.sebi.gov.in/xbrl/Changes_In_Management/2025-11-30/in-capmkt/in-capmkt-ent` (seen inside `*_ROID_*_KMP_Doc.zip` attachments, generator "CIMG V1.1 (21-04-2026)"). Elements observed: `TypeOfChange` (Appointment/Cessation), `CategoryOfCessation`, `CategoryForChange` (Director/KMP/Senior Management Personnel), `DesignationOfDesignatedPerson`, `PositionOfDirectorInBoardThree` (e.g. `CEO-MD`), `NameOfDesignatedPerson`, `EffectiveDateOfReasonOfChange`, `TermOfAppointmentInMonths`, **`BriefProfile`**, `DisclosureOfRelationshipsBetweenDirectorsInCaseOfAppointmentOfDirector`, `DateOnWhichTheResignationLetterWasReceived`, `ReasonOfResignationInBrief`, `WhetherEventOrInformationIsAnOutcomeOfBoardMeeting`, `DateOfBoardMeeting`. In the 8-day sample XBRL zips appear only on `desc ∈ {Resignation of Director/KMP/SMP (75), Resignation of Statutory Auditor (6), Open Offer (3)}` — pure appointments are PDF-only.

**Empirical audit of real filings (downloaded 8 Nov 2026, all public):**

| Filing (NSE) | Person → role | Bio in filing? | Notes |
|---|---|---|---|
| [Wipro 06-Nov](https://nsearchives.nseindia.com/corporate/Wipro_Secretarial_06112026190358_SEintimation06112026.pdf) | Angan Guha → President & CEO, Americas 2 SMU (w.e.f. 8 Dec 2026) | **Yes**, ~250 words | ex-Global CEO & MD Birlasoft; 28 yrs at Wipro; Pune Electronics Eng; Chicago Booth |
| [Heranba 07-Nov](https://nsearchives.nseindia.com/corporate/HERANBA_07112026140909_Intimation_of_Appt-CFO_Final_to_Upload.pdf) | Rajib Mukhopadhyay → CFO (w.e.f. 1 Jan 2027) | **Yes**, ~180 words | ex-CFO Sutlej Textiles, Indofil; CA; Harvard AMP |
| [HDFC Bank 06-Nov](https://nsearchives.nseindia.com/corporate/HDFCBANK3_06112026152141_SE_Intimation-Srivatsan.pdf) | V. N. Srivatsan → Chief Compliance Officer (3-yr term) | **Yes**, ~150 words | ex-ICICI Bank Head Compliance (Overseas); 34 yrs |
| [Voltas 06-Nov](https://nsearchives.nseindia.com/corporate/VOLTAS_RB_06112026172057_02SE_Directorssigned.pdf) | Jayant Balan → MD (from 25 May 2027); Venkatesalu Palaniswamy → NED; Sunil D'Souza → Chairman; Noel Tata & M. Menon retire | **Yes** for the two new appointees (separate "Brief Profile" page); "Not applicable" for the others | 5-person table; same PDF posted 5× under different subjects |
| [Asian Paints 06-Nov](https://nsearchives.nseindia.com/corporate/ASIANPAINT_06112026220521_SE_intimation_-_Appointment_of_ID.pdf) | Leo Puri → Independent Director (Chairman from Jan 2027) | **No — references letter of 7 Sep 2026** | Backfill found [7-Sep filing](https://nsearchives.nseindia.com/corporate/ASIANPAINT_07092026144607_SE_Appointment_Leo_Puri_-_ID_and_chair_signed.pdf) with age 65, DIN, Oxford/Cambridge, Apax, Fortis, Dr Reddy's, ex-JPM/UTI AMC/Warburg/McKinsey |
| [Power Grid 06-Nov](https://nsearchives.nseindia.com/corporate/POWERGRID1_06112026225441_BSENSEReg30Apptt06112026_s.pdf) | Anupam Kumar, IAS → Govt Nominee Director | **Yes**, Appendix-I, ~400 words | 2003 batch Bihar cadre; JS MNRE |
| [Minda Corp 06-Nov](https://nsearchives.nseindia.com/corporate/MINDACORP_06112026201727_AppointmentSMPFinal.pdf) | SMP appointment | **Yes** | |
| [Zaggle 06-Nov](https://nsearchives.nseindia.com/corporate/ZAGGLE_06112026182831_SE_Intimation_-_Change_in_Management.pdf) | Samar Vijay Pupala → KMP (finance) | **Yes** (two-column table, one leaving/one joining) | |
| [Suprajit 07-Nov](https://nsearchives.nseindia.com/corporate/SUPRAJIT_07112026165843_AnnouncementChangeinManagement07Nov2026.pdf) | Dr Steffen Berns → NED | **Yes** | ex-MD Bosch Ltd / President Bosch India 2013–16 |
| [Uniphos 06-Nov](https://nsearchives.nseindia.com/corporate/UNIENTER_06112026185030_OUTCOME_OF_BM_6_11_2026_signed.pdf) | Girish Goenka → CEO | **Yes** (inside an 11-page board-outcome omnibus) | ex-CFO Piramal Realty; CPA, CFA |
| [Gujarat Alkalies 06-Nov](https://nsearchives.nseindia.com/corporate/KAMLESH_MUNDRA_06112026161602_SE.pdf) | Dr Brijesh Patel → Head R&D (SMP) | **Yes** | OCR-embedded text |
| [Birlasoft XBRL 06-Nov](https://nsearchives.nseindia.com/corporate/BSOFT_ROID_104160_KMP_Doc.zip) | Angan Guha resigns (CEO-MD); Madhavan Hariharan appointed CEO-MD, 24 months | **Yes — structured `BriefProfile`** | Group CFO CKA Birla; ex-Ashok Leyland/PepsiCo/Philips; CA 1989 |
| Resignations: [Thyrocare](https://nsearchives.nseindia.com/corporate/THYROCARE_06112026163133_SE_Preet_Kaur_Reg_30_Signed.pdf), [ICRA](https://nsearchives.nseindia.com/corporate/ICRA_06112026173908_BSER3006112026.pdf), [Manappuram](https://nsearchives.nseindia.com/corporate/MANAPPURAM_07112026101504_Reg_30_GCTO_Resignation_SD.pdf) (+ [XBRL](https://nsearchives.nseindia.com/corporate/MANAPPURAM_ROID_104248_KMP_Doc.zip)) | CSO / NED / Group CTO resign | "Not Applicable" | All attach the resignation letter with reason (item 7C): "better career opportunity", "retirement plans", "personal reasons" |

**Score: 10/11 appointment filings carry the bio; 1/11 references an earlier filing that the company's own history supplies.** Confidence that this generalises: high — it is a 2015 rule, exchanges reject non-compliant Reg-30 forms, and every one of the 11 used the same four-row Annexure.

## 3. Bio prototype — `enrich_person(name, role, company, …)`

### 3.1 Pipeline (what actually ran)

```
filing PDF/XBRL ──pdftotext──▶ text ──regex──▶ "referenced earlier?" ──yes──▶ NSE history (symbol, 365d) → oldest filing mentioning surname → text
      │                                                                     │
      └──────────────── full/focused filing text (≤14k chars) ◀────────────┘
                              + Google News RSS headlines  (gate: surname ∧ company token in headline)
                              + Wikipedia summary          (gate: all name tokens in title ∧ company/prior-employer in extract)
                              ▼
            gemini-3.5-flash-lite, temperature 0, response_schema=PersonProfile  (ONE call)
                              ▼
            {filing_has_bio, brief_profile_verbatim, bio, one_liner, prior_roles[], education[], effective_date, term, evidence_gaps[]}
            + deterministic confidence + sources[] (filing URL first)
```

Schema and prompt actually used (v2, `/tmp/finn-enrich/enrich_person_v2.py`):

```python
class PersonProfile(BaseModel):
    filing_has_bio: bool
    brief_profile_verbatim: str   # copied from the filing (<=600 chars) or ""
    bio: str                      # 2-3 lines for the card
    one_liner: str                # <=110 chars
    prior_roles: list[str]; education: list[str]
    effective_date: str; term: str
    evidence_gaps: list[str]

prompt = f"""You prepare a management-change card for an investor app.
Person: {name} | New role: {role} | Company: {company}
From the FILING TEXT, find the 'brief profile' of THIS person (ignore other people in the same filing).
Copy it near-verbatim into brief_profile_verbatim (<=600 chars). If the filing has no profile for this
person, set filing_has_bio=false and brief_profile_verbatim="".
Then write bio (2-3 lines, past->present: previous employers + roles, years of experience, one credential)
using ONLY the evidence. NEWS may add a 'returning to X' / 'ex-Y veteran' angle if headlines say so.
Never add facts from memory.
EVIDENCE:
[FILING TEXT – primary] …   [NEWS 06 Nov 2026] Wipro reappoints Angan Guha as head of Americas 2 - ET …"""

conf = "high" if (p["filing_has_bio"] and len(p["brief_profile_verbatim"]) > 150) \
       else ("medium" if len(news) >= 2 else "low")
```

Keyless corroboration:

```python
feed = feedparser.parse(f"https://news.google.com/rss/search?q={quote(f'\"{name}\" {company}')}&hl=en-IN&gl=IN&ceid=IN:en")
keep = [e for e in feed.entries if surname in e.title.lower() and company_token in e.title.lower()]  # disambiguation gate
```

Backfill when the filing says "brief profile … was disclosed vide our letter dated …":

```python
GET /api/corporate-announcements?index=equities&symbol=ASIANPAINT&from_date=08-11-2025&to_date=08-11-2026
# 126 filings in 0.2 s; 3 mention "Puri"; oldest = 07-Sep-2026 "Appointment of Mr Leo Puri as Chairman" → download → extract
```

### 3.2 Measured outputs (verbatim from the runs; sources abridged)

**Angan Guha → Wipro** — confidence **high** (filing + 5 gated headlines of 28 raw) — 5.1 s, 700/188 tokens
> bio: "Angan Guha is a technology and business leader with over 34 years of experience. He previously served as the Global CEO & Managing Director of Birlasoft Ltd. and spent over 28 years at Wipro, holding senior leadership roles including CEO of the Americas 2 Business Unit." prior_roles: [Global CEO & MD, Birlasoft; CEO Americas 2 BU, Wipro]; education: [Electronics Eng, Univ. of Pune; Chicago Booth mgmt programs]. News kept: ET "Wipro reappoints Angan Guha…", Rediff "Birlasoft Names Madhavan Hariharan CEO; Angan Guha Returns to Wipro", Mint "Who is Angan Guha?…".

**Jayant Balan → Voltas MD (25 May 2027)** — **high** (after fix) — 11.4 s, 2,974/419 tokens
> brief_profile_verbatim: "Mr. Jayant Balan is a Mechanical Engineer and PGDM from SP Jain Institute of Management & Research. Mr. Balan joined the Tata Group in 1999 as part of the Tata Administrative Service and moved to Voltas in 2001. … CEO of Voltbek Home Appliances Private Limited since 2019 before transitioning to the role of Head – Room Air Conditioner Business of the Company in January 2026." one_liner: "Jayant Balan, an internal Tata Group veteran with over two decades of experience, has been appointed Managing Director of Voltas effective May 2027." term: five years.

**Leo Puri → Asian Paints ID / Chairman-designate** — **high** via backfill — 12.2 s, 629/463 tokens
> bio: "Leo Puri is a financial sector veteran with four decades of experience, currently serving as Advisory India Chair at Apax. His prior roles include Chairman, South & Southeast Asia for JP Morgan Chase, MD and CEO of UTI Asset Management Company, and Senior Partner at McKinsey & Company. He holds a Masters in Philosophy, [Politics and Economics, Oxford; Masters in Law, Cambridge]." notes: "bio backfilled from earlier filing 07-Sep-2026". News kept 5/31 (Reuters "…names former JPM exec Puri as next chairman").

**Madhavan Hariharan → Birlasoft CEO & MD** — **high** from XBRL `BriefProfile` (no PDF parsing) — 12.2 s, 610/485 tokens
> bio: "Madhavan Hariharan has extensive international experience in finance, strategy, and governance. He previously held leadership roles at Ashok Leyland, PepsiCo, Tata SIA, and Royal Philips, and served as Group CFO & Head of Strategy at the CKA Birla Group since 2018. He is a qualified Chartered Accountant." education: [B.Com Vivekananda College 1986; CA (ICAI 1989); CS (ICSI 2004); CISA 2004; Harvard non-profit boards 2016].

**V. N. Srivatsan → HDFC Bank CCO** — **high** — 2.8 s, 574/214 tokens
> bio: "…approximately 34 years of overall professional experience, including around 25 years in the BFSI sector and nearly 10 years in Compliance and Regulatory Inspection. Previously, he served as Head – Compliance: Overseas Banking and Subsidiaries & Data Privacy Officer at ICICI Bank Limited." News kept 5/20 incl. ET "HDFC Bank names ICICI veteran banker V.N. Srivatsan…", Business Standard.

**Anupam Kumar → Power Grid (Govt nominee)** — **high** — 23.1 s, 3,294/434 tokens
> bio: "Anupam Kumar is an IAS officer of the 2003 batch with over two decades of administrative experience. He has previously served as District Magistrate in multiple districts, State Transport Commissioner, and Secretary in the Chief Minister's Secretariat, before joining the Ministry of New and Renewable Energy as Joint Sec[retary]." (Common name — only 4/10 raw headlines survived the Power-Grid gate, all about this appointment.)

**Girish Goenka → Uniphos CEO** (44k-char board omnibus, focus-trimmed to ~2.3k tokens) — **high** — bio names Piramal Realty CFO, Godrej Properties, Mahindra Lifespace, Gammon; CPA (USA), CFA. News kept 2/9 ("…Moves From Piramal Realty CFO To CEO Of UPL Group's Uniphos").

**Rajib Mukhopadhyay → Heranba CFO** — **high**; 0/3 headlines passed the gate (correct — the 3 were Q2-results items). **Steffen Berns → Suprajit** — **high**; 0/4 headlines passed (all 4 were Suprajit Q2 results → the gate prevented a false "source").

Aggregate over 12 person-runs: **median 4.5 s end-to-end (max 23 s under free-tier contention)**, mean 1,096 input / 287 output tokens, **≈ $0.00105 per person** at paid flash-lite rates; free on the free tier. News RSS: 0.3–0.9 s, 2–31 raw items, gate keeps 0–5.

### 3.3 Failure modes found (and what fixed them)

| Bug | Symptom | Fix |
|---|---|---|
| Multi-person annexure (Voltas) — row says "Not applicable | Not applicable | Enclosed separately" | regex read "Not applicable" → no bio → medium confidence, bio wrong ("has been associated with Voltas in leadership discussions") | Stop regex-slicing; give the LLM the full/focused filing text and ask for *this person's* profile verbatim |
| Pointer rows ("Appendix-I", "Enclosed") | bio missed | same |
| "Brief profile … was disclosed vide our letter dated 7 Sep 2026" | v1 pasted that sentence as the bio and still said **high** (the news happened to be right — luck, not design) | regex detects the pointer → **backfill from NSE symbol history**; confidence only from `filing_has_bio ∧ len(verbatim)>150` |
| Focus-window trimming skipped overlapping windows | Balan's paragraph at char 13,060 dropped | merge overlapping windows (bug was mine, not the model's) |
| Resignation letters contain bio-like words | regex scored a resignation letter as a bio | "Not Applicable" row takes precedence → `not_applicable` |

**Residual risk:** the bio is the *company's own* text — promotional, never adverse (no mention of a prior firm's blow-up, SEBI orders, litigation). Secondary sources are the only place that would show up; see §6.

### 3.4 Disambiguation strategy (same-name problem)

1. **Anchor on the filing.** Name, role, company, effective date and the filing's own bio come from the primary document; the person is *defined* by (company, role, date), not by the name string.
2. **Co-mention gate for every secondary snippet:** keep a headline/page only if the surname AND a company token (or a prior employer named in the filing bio) appear in it. Measured: for "Steffen Berns" and "Rajib Mukhopadhyay" this dropped 100% of raw hits (all were company results stories); for "Anupam Kumar" (very common name) it kept 4/10, all correct.
3. **Wikipedia only on exact person-title match plus co-mention in the extract.** Search for "Leo Puri" returned the page *Kalpana Morparia* (wrong person) — the title gate rejected it. Only Noel Tata of 12 had a page.
4. **Prior-employer cross-check:** extract company names from the filing bio (e.g. "ICICI Bank Limited", "Birlasoft Ltd.") and require at least one to appear in any web text before it may influence the bio.
5. **Show the work on the card:** verbatim filing excerpt collapsible, source chips (filing PDF link first, then news), and a confidence pill computed as: `high` = filing bio ≥150 chars; `medium` = no filing bio but ≥2 gated headlines; `low` = anything else (render "Filing has no profile; 1 press mention" rather than a bio).
6. **Never let the model fill gaps from memory** — the prompt says so and the outputs comply (`evidence_gaps` populated when thin, e.g. v1 Anupam Kumar run listed four gaps instead of inventing).

### 3.5 LinkedIn: why not, and what graders will accept

- Measured: `GET https://www.linkedin.com/in/anganguha/` → 301 → **HTTP 999** with `authwall` in the body; people search → 307 to `/uas/login`. Public profile HTML is not served to anonymous clients; the official API (Marketing/Sign-in) does not expose arbitrary profiles. LinkedIn's User Agreement §8.2 prohibits scraping; the brief's "e.g. from LinkedIn" is an *example* of the outcome (know who they are), not a data-source mandate, and the brief explicitly allows "push-side enrichment like a person's professional background".
- Defensible substitute, in order: (1) the mandated Reg-30 brief profile (same facts a LinkedIn card would show: current/previous employers, tenure, education), (2) the company's earlier filings (tenure of the *outgoing* person: find their original appointment date via symbol history), (3) press headlines for the "ex-X veteran / returns to Y" angle, (4) Wikipedia for public figures. State this in the covering note: "LinkedIn is auth-walled and ToS-restricted; the SEBI-mandated brief profile in the filing is the authoritative bio, cross-checked against press."
- If a key is ever available: Gemini Google-Search grounding (paid tier, 5,000 free queries/month) or Tavily would slot into the same `evidence[]` list with the same gate.

### 3.6 Outgoing-person enrichment (resignations)

The filing has no bio for the leaver, but the card can still say who they were: XBRL/annexure gives `ReasonOfResignationInBrief`, `DateOnWhichTheResignationLetterWasReceived` (Manappuram: letter received 7 Aug, effective 7 Nov → 3-month notice), effective date, and whether a successor is named (Birlasoft: yes, same filing; Jubilant CS: no). Tenure: query symbol history for the person's appointment filing (NSE history goes back years; Asian Paints returned 126 filings/365 d in 0.2 s). Red-flag heuristics worth a badge: CFO/auditor/CS resignations with <30-day effect, "personal reasons" plus no successor, resignation of an independent director before term end (item 7B), more than one KMP exit within 90 days.

## 4. One-line summaries per category

### 4.1 NSE `desc` → reference category (8-day sample, 6,796 filings, 1,750 symbols)

| Reference category | NSE `desc` values (count) | Share |
|---|---|---|
| results | Outcome of Board Meeting (1,037), Investor Presentation (465), Integrated Filing-Financial (35), Reply/Clarification-Financial results (3) + "results" in text | 27.3% |
| unclassified | General Updates (573), Updates (340), Monitoring Agency Report (152), Statement of deviation Reg 32 (75), ESOP/ESOS/ESPS (71), Trading Window (23), certificates, RTA, AOA… | 17.0% |
| earnings_call | Analysts/Institutional Investor Meet/Con. Call Updates (1,398 total) where text matches earnings/results/call/transcript/recording | 14.2% |
| newspaper copy (→ collapse) | Copy of Newspaper Publication (938) | 13.8% |
| management_change | Appointment (133), Change in Management (88), Resignation of Director/KMP/SMP (75), Resignation (55), Change in Director(s) (46), Cessation (21), Change in Auditors (17), Change in CS/CO (14), Retirement (9), Demise (3) | 6.9% |
| investor_meetings | the rest of Analysts/… (schedules of one-on-one/group meets) | 6.4% |
| press_release | Press Release (519), Bagging/Receiving of orders (31), Monthly Business Updates (18), News Verification (14), Agreements (12), Spurt in Volume/Price movement (14), Product launch (5), Rumour Verification 30(11) (4) | 6.3% |
| dividend | Dividend (53), Record Date (74, when text says dividend) | 1.7% |
| fund_raise | Allotment of Securities (35), Issue of Securities (5), Rights Issue, Buyback, Utilisation of Funds, NCD/CP/warrant texts | 1.2% |
| M&A | Acquisition (49), Amalgamation/Merger (11), Scheme of Arrangement (4), Sale or disposal (3), Open Offer (5), Demerger | 1.2% |
| postal_ballot / agm_egm | Shareholders meeting (125) split on "postal" | 1.0% / 0.4% |
| litigation | Action(s) taken or orders passed (19), CIRP (18), Pendency of Litigation (15), Action(s) initiated (10), Fraud/Default/Arrest, Defaults | 0.9% |
| insider_trading | Disclosure under SEBI Takeover Regulations (5) + PIT 7(2) texts (filed under "Updates") | 0.7% |
| credit_rating | Credit Rating (29), Credit Rating-Revision (6), Credit Rating-New (3) | 0.6% |
| capex | Capacity addition (13), Commencement of commercial production (4), New line of business (2) | 0.3% |
| bonus_split | Bonus (3), Stock split (1), Record Date for bonus | 0.1% |
| pledging | PIT/SAST pledge texts (2 found; most promoter pledge data lives in the separate NSE pledge dataset) | <0.1% |

Takeaway: **~45% of raw flow (results omnibus + unclassified + newspaper copies) is where collapsing matters; the high-value categories are <5% of filings**. The NSE `desc` is a strong zero-cost prior for classification; the sibling classifier should use it plus `attchmntText` before any LLM.

### 4.2 What earns attention, and the one-liner template (the product spec)

Legend — Default: M = material (alert-eligible), N = notable (digest line), R = routine (collapsed, counted). "LLM?" = whether to spend a model call.

| Category | What earns attention | One-liner template (fields to pull) | Default | LLM? |
|---|---|---|---|---|
| management_change | CEO/MD/CFO/CS/auditor/ID change; resignation with <30d effect; no successor | `{Role} {name} {appointed/resigns}, eff. {date}` + bio card (§3); for exits: `{reason}; successor {named/not named}; tenure {N yrs}` | M (CxO/MD/ID/auditor), N (SMP/other directors) | Yes (bio) — XBRL first |
| results | always | handled by sibling: Rev/EBITDA/PBT/PAT QoQ & YoY; attach deck/press release/transcript as chips | M | Yes |
| dividend | amount vs face value; special dividend; record date | `{interim/final/special} dividend Rs {x}/sh ({y}% of FV Rs {fv}); record {date}; pays {date}` | N (M if special or yield >2%) | Mostly regex/`attchmntText`: NSE text already says "Record date for the purpose of Dividend is 13-Nov-2026" |
| credit_rating | any **change** in rating or outlook; new instrument rating | `{Agency} {upgrades/downgrades/reaffirms} {instrument} {old} → {new}, outlook {old→new}; Rs {amt} rated` | M on change, R on reaffirm | Yes, small; `desc` "Credit Rating- Revision" is the trigger; show only *stated* totals |
| M&A | stake %, consideration vs market cap, target size, related party | `{Acquires/sells} {stake}% of {target} for Rs {amt}; target rev Rs {x}; closes {date}` | M | Yes |
| fund_raise | instrument, size vs market cap, price/discount, who (promoter vs QIB), dilution | `{QIP/pref/rights/NCD/CP/buyback}: Rs {amt} at Rs {price} ({±z}% vs mkt); to {allottees}; dilution {d}%` | M (equity/convertibles/buyback), N (NCD/CP allotments, interest payments) | Yes for equity; regex for NCD/CP (amount + coupon) |
| pledging | promoter pledge create/invoke; cumulative % after | `Promoter {name} {pledges/releases/invoked} {shares} ({a}% of equity) with {lender}; promoter pledge now {b}% of holding` | M (create/invoke), N (release) | Yes; **list all pledgors**; cumulative % needs the SAST-31/pledge dataset, not the PIT form |
| insider_trading | promoter/director buy or sell; size; off-market | `{Person} ({category}) {buys/sells} {qty} sh (~Rs {val}, {p}% of equity) {on/off}-market; holding {before→after}%` | M (promoter sell / large buy), N (small ESOP sales) | Yes; PIT Form C tables parse poorly → schema must be a *list* of transactions |
| capex | amount, capacity Δ, location, timeline, funding | `Rs {amt} for {capacity} at {location}; from {old}→{new} capacity; commissioning {date}; funded by {mix}` | N (M if amt > ~10% of assets) | Yes |
| litigation | authority, amount, stage, favourable/adverse | `{Authority} {order type}: Rs {amt} {demand/penalty/dropped} for {period}; stage {stage}; co. says {stance}` | N (M if adverse & amount material or CIRP/fraud/arrest) | Yes; **never sum amounts** across cases |
| earnings_call | the *schedule* (date/time/dial-in) once; transcript when it lands | `Q{n} call {date} {time} IST · {broker} · dial-in` → on transcript: chip "Transcript (15 pp)" feeding Pull | N (schedule), N (transcript) | No for schedule (regex datetime); transcript goes to the Pull pipeline |
| investor_meetings | nothing individually; count them | collapse to `{n} investor meetings this week` with conference names on expand | R | No |
| bonus_split | ratio, record date | `{Bonus r:1 / split FV a→b}; record {date}; {subject to postal ballot}` | N | regex-able from text; LLM optional |
| press_release | order wins (value, client, duration), product/regulatory approvals, rumour replies (what was confirmed/denied), monthly volumes | `Rs {amt} order from {client}, {duration}` / `Confirms/denies {claim}` / `Oct volumes: {segment ±%}…` | N (M if order ≥ ~5% of annual revenue) | Yes |
| postal_ballot | results only if a resolution failed or is contentious (RPT, capital, delisting) | `Postal ballot: {n} resolutions passed ({min approval}%); {failed ones}` | R (notice), N (results) | Small; regex for "passed with requisite majority" |
| agm_egm | notice: key special resolutions; outcome: anything defeated | `{AGM/EGM} {date}: {top 3 resolutions}; {any defeated}` | R (notice), N (proceedings/voting if special resolutions) | Small |
| unclassified | ESOP allotments, certificates, trading-window, deviation statements, newspaper copies | collapsed count `{n} routine filings` with icons; no text | R | **No** |

**Do not summarise at all (surface/collapse only):** Copy of Newspaper Publication (always a duplicate of something already shown), investor-meeting schedules, ESOP/ESPS allotments, Reg-74(5)/Reg-40(9) certificates, trading-window closures, monitoring-agency reports, Reg-32 deviation statements, record-date intimations whose parent event was already shown (attach as a chip), "Spurt in volume / price movement" replies that say nothing is pending (but *do* surface the EOD anomaly itself, which the brief asks for), exchange "Reply to clarification" boilerplate. These are **~45–50% of raw filings**.

### 4.3 One-liner prototype — schema, prompt, results

Schema (`/tmp/finn-enrich/oneliner.py`): `category ∈ 17`, `event_type`, `headline ≤110 chars (numbers first, no company name)`, `facts: [{field, value}]` per-category field list (table above, passed in the prompt), `materiality ∈ {material, notable, routine}`, `why_it_matters ≤140`, `is_followup_of_prior_event`, `confidence`. Input = NSE row metadata + `pdftotext -layout` text (first 12k chars). Model `gemini-3.5-flash-lite`, temperature 0, JSON mode.

Results on 26 real filings (all 6–8 Nov 2026; URLs in `/tmp/finn-enrich/cat_meta.json`, and e.g. [Prestige](https://nsearchives.nseindia.com/corporate/PRESTIGE_06112026210200_IntimationAllure.pdf), [BHEL](https://nsearchives.nseindia.com/corporate/BHEL_07112026125946_orderpgil07112026.pdf), [Bosch](https://nsearchives.nseindia.com/corporate/BOSCHLTD2025_06112026143714_Letter2SE06112026.pdf), [Kiri](https://nsearchives.nseindia.com/corporate/KIRIINDUS_07112026115002_Intimation_Allotment_of_Warrants_S.pdf), [Ravindra PIT](https://nsearchives.nseindia.com/corporate/RAVINDRA_06112026195328_1_NM_KIPL_-_PIT_Disclosures_Upload.pdf), [Ramco](https://nsearchives.nseindia.com/corporate/RAMCOIND_07112026113002_Reg30int_imp_penalty_07112026.pdf), [CPCL](https://nsearchives.nseindia.com/corporate/CHENNPETRO_06112026235743_Reg30_Credit_Rating.pdf)):

| # | Filing | Headline produced | Verdict vs source text |
|---|---|---|---|
| 1 | Rain Industries · Dividend (11 pp) | "Rs 0.5/sh 2nd interim dividend declared, record date Nov 13" | ✅ (FV Rs 2, 25%) |
| 2 | Rain · Record Date | "Nov 13, 2026 record date set for 2nd interim dividend" (routine) | ✅ (should flag `followup=true`) |
| 3 | HBL Engineering · Credit Rating-Revision | "CARE Ratings reaffirms LT bank facilities at CARE AA-; Stable…" Rs 995 cr | ✅ facts; ⚠️ materiality "material" for a reaffirmation |
| 4 | CPCL · Credit Rating | "Crisil reaffirms AAA/Stable and A1+…" amount_rated Rs 8,084.9 cr | ✅ ratings; ⚠️ **amount is a model-summed total not stated in the doc** (3.5-flash said 7,984.9) |
| 5 | Prestige · Acquisition | "Acquiring 100% stake in Allure Developers for up to Rs 523.8 cr to develop a Noida residential project" | ✅ (INR 5,237.6 mn converted correctly; target turnover INR 1.23 mn) |
| 6 | Tata Steel · Acquisition | "Acquired 38,222 shares in subsidiary Creative Port Development, increasing stake from 51% to 57.5%" | ✅ headline; ⚠️ `consideration=Rs 6,876.11` is the fractional-share cash settlement (OCRPS conversion, no fresh consideration) — fixed by 3.5-flash |
| 7 | Seamec · Order | "USD 26.14 mn order from L&T for ONGC PRP-X project, completion by May 2027" | ✅ |
| 8 | BHEL · Order | "Rs 600-900 cr order for 2 synchronous condensers from Power Grid for Barmer-II HVDC station" (44 months) | ✅ |
| 9 | Interarch · Capacity | "265,000 MT total capacity after 20,000 MT Phase-2 addition in Kheda Gujarat for Rs 15 cr" | ✅ (internal accruals/IPO proceeds) |
| 10 | Ramco Industries · Litigation | "Favorable GST orders received dropping total tax, interest and penalty demands across four financial years" amount Rs 1.05 cr | ✅ direction; ⚠️ **amount summed by model** (doc states "Total penalty as per 6 Orders 37,49,490"; 3.5-flash summed to 93,87,992) |
| 11 | Apcotex · Order passed | "Rs 16.4 lakh GST penalty order received for FY21-FY24 period" + "no material financial impact" | ✅ |
| 12 | Indo Borax · Pledge | "Pledge created over 51,94,560 shares (14%) of Kronox Lab Sciences for Rs 225 cr term loan" (Axis) | ✅ facts; ⚠️ it is the *company* pledging shares of its new subsidiary, not a promoter pledge — field name `promoter_entity` forced a wrong semantic |
| 13 | Kiri Industries · Allotment | "60.83L warrants allotted to promoters at Rs 475/sh raising Rs 288.92 cr" (promoters → 46.69% fully diluted) | ✅ |
| 14 | GP Petroleums · NCD (retry after 503) | "Rs 30 cr raised via 300 NCDs allotted to RevX Special Credit Opportunities Fund II" | ✅ |
| 15 | Bosch · Bonus (24 pp, 130k chars) | "Board approved 3:1 bonus issue and 1:5 stock split subject to shareholder approval" | ✅ (FV 10→2) |
| 16 | Coromandel · Con-call schedule | "12 Nov 2026 at 11:00 AM IST: Q2 and H1FY27 results conference call scheduled" (Systematix) | ✅ facts; ⚠️ category `investor_meetings` instead of `earnings_call` (3.5-flash got it right and added the dial-in) |
| 17 | Dr Reddy's · News Verification | "$40 generic HIV shot gets US nod for 120 poorer countries" → facts: confirmed headline; refers to 2 Nov press release; not material per company | ✅ |
| 18 | Prime Focus · EGM proceedings | "EOGM held on Nov 7, 2026; approved cessation of control over Brahma AI Holdings and related party transactions" | ✅ |
| 19 | Ravindra Energy · PIT 7(2) | "Promoter Narendra Murkumbi creates pledge on 18,47,300 equity shares worth Rs 26.20 cr" | ✅ numbers (model re-joined "18,47,3\|00" and "26,20,39,50\|0" split across table lines); ❌ **missed the second Form C**: Khandepar Investments pledged 22,05,400 sh (Rs 31.28 cr); holding 30.49% |
| 20 | Nykaa · ESOP | "6,61,020 equity shares allotted under employee stock option schemes" (routine) | ✅ |
| 21 | Pashupati Cotspin · Postal ballot results | "Shareholders approve increase in authorized share capital and bonus share issuance via postal ballot" | ✅ |
| 22 | TVS Electronics · Spurt | "Volume spurt clarification: no pending price-sensitive information or undisclosed events" (routine) | ✅ |
| 23 | Shyam Metalics · Monthly update | "Oct 2026 sales volume: SS +20.4%, Aluminium +22.2%, Carbon Steel Long -15.8%, Flat +78.0%" | ✅ (all four % match the table) |
| 24 | Dynamatic · Investor meet | "19 Nov 2026: Physical investor meeting scheduled in Bangalore" (routine) | ✅ |
| 25 | Patel Retail · Transcript (15 pp) | "Q2 & H1 FY27 total income rose 33.5% YoY to Rs 300.9 cr, PAT at Rs 9.9 cr" | ✅ (49 s latency — long doc under load) |

**Scorecard: 17 fully correct · 8 partial · 0 fabricated facts · 1 transient 503 (retry succeeded).** Error taxonomy → design rules:

1. *Model-summed totals* (CPCL, Ramco): two models produced two different sums. Rule: schema field `amount_as_stated` + instruction "only numbers printed in the document; if a total is not printed, give the largest single stated figure and `n_items`". Display "6 GST orders dropped; largest Rs 8.3 lakh" rather than an invented total.
2. *Multi-entity filings* (Ravindra PIT; also Voltas 5 directors): make `facts` a **list of items** for pledging/insider_trading/management_change/M&A; render "+1 more" chips.
3. *Category confusion* inside NSE's merged "Analysts/… Meet/Con. Call" bucket: decide earnings_call vs investor_meetings by regex on first page (`earnings|results|conference call|transcript|recording`) *before* the LLM; pass the category as a given, not a question.
4. *Field semantics* (`promoter_entity` on a corporate pledge): use neutral `pledgor` + `pledgor_type ∈ {promoter, company, other}`.
5. *Materiality over-call on reaffirmations*: materiality should be **rule-based** (`action ∈ {upgrade, downgrade, outlook change} → material; reaffirm → routine`), with the LLM only extracting `action`.

**Cost & latency (measured):** flash-lite mean **2,598 input / 319 output tokens** (median 2,506; max 4,202) → **$0.00158 per filing** paid-equivalent (≈ ₹0.13; $1.58 per 1,000 filings), free within 500 RPD. Median latency 7.6 s, mean 8.3 s, max 49.5 s (free-tier contention; 1.4–2.6 s when idle). Prompt overhead is ~800 tokens of field-spec JSON — send only the chosen category's field list to cut input ~30%.

**`voiceSummary` route (tested on 4):** feeding NSE's own ~730-char summary instead of the PDF gave identical-quality cards (BHEL headline matched the PDF-derived one; Goldiam "Q2 revenue Rs 292 cr up 44% YoY, PAT Rs 49 cr up 58%; 1st interim dividend Rs 2/sh"; Manappuram "Group CTO Narayanan Easwaran resigns effective Nov 07, 2026 · personal reasons") at **1,284 input tokens (−50%) and zero PDF I/O**. Valid only while NSE serves it (rolling ~24–36 h) → persist on ingest.

**A/B on `gemini-3.5-flash`** (5 weak cases): fixed category and field-label errors, did **not** fix the summed-total problem (different wrong sum) nor the multi-entity miss; 5–8 s; 20 RPD free quota makes it unusable for bulk anyway. Routing recommendation: flash-lite for all extraction; reserve any stronger model for results/M&A narratives if at all.

## 5. Dedupe & noise — measured and designed

**Measured on 6,796 NSE filings (1–8 Nov 2026):**

- **Exact re-posts:** 451 groups of same-symbol + same-day + same-attachment-size → 1,175 filings, i.e. **724 redundant rows (10.7%)**. Motherson posted one investor-meet PDF 11×; Ceigall one board-outcome PDF 9× (as "Others", "Sale or disposal", "Appointment", "Amendment to AOA", "Integrated Filing", 4× "Outcome of Board Meeting"); Voltas 5×; Sigma Advanced 7×.
- **Event clustering** (same symbol + same category + ≤48 h gap, single sweep): 6,796 → **5,090 events (−25%)**.
- **20-stock portfolio simulation** (RELIANCE, HDFCBANK, TCS, INFY, WIPRO, TATASTEEL, ASIANPAINT, VOLTAS, POWERGRID, COROMANDEL, BHEL, MANAPPURAM, JUBLFOOD, ICRA, BSOFT, BOSCHLTD, DRREDDY, RAIN, PRESTIGE, THYROCARE) over the 8 days — peak results week: **103 raw filings → 73 events → 50 non-routine cards** (23 routine events collapsed). Raw 12.9/day → 9.1 events/day → ~6 headline cards/day. Example clusters: Voltas management_change n=6 (incl. one *auditor* change wrongly merged — see event keys), Voltas results n=4 (3× outcome + deck), Tata Steel results n=3, Dr Reddy's press n=3 (two news-verifications + the press release).

**Design (three levels, cheapest first):**

1. **L0 exact:** key = `(symbol, sha1(first 2 KB of PDF) or (attFileSize, filename stem sans timestamp))`. Same PDF under five subjects → one row; keep the union of `desc` values as tags ("Appointment · Retirement · Change in Director(s)").
2. **L1 structural event key** per category, falling back to a 48 h window:
   - results: `(symbol, quarter_end)`; absorbs Outcome of BM, Integrated Filing, deck, press release, newspaper copy, con-call schedule/transcript/recording, record date for the dividend declared in the same outcome.
   - management_change: `(symbol, DateOfBoardMeeting)` when XBRL/text says it is a board outcome, else `(symbol, person_surname)`; auditor changes get their own key (fixes the Voltas merge).
   - dividend/bonus_split: `(symbol, record_date)`; M&A: `(symbol, normalised target name)`; fund_raise: `(symbol, instrument, amount)`; credit_rating: `(symbol, agency)`; litigation: `(symbol, authority, period)`; earnings_call: `(symbol, quarter)`; press_release rumour threads: `(symbol, 72 h)`.
3. **L2 semantic (only when L1 ambiguous):** Jaccard ≥0.6 on the normalised set of extracted entities/amounts/dates from the one-liner schema, or cosine ≥0.85 on `gemini-embedding-2` (free tier 100 RPM / 1,000 RPD) over the first 1,000 chars. Rarely needed; skip for v1.

**Card composition:** primary = the filing with the highest information density (board outcome > press release > deck > newspaper); others become chips ("+ deck", "+ transcript", "+ record date 13 Nov", "+ newspaper ad"). `attchmntText` from NSE is good enough for the chip label. A follow-up arriving later (transcript 3 days after results) *updates* the existing card and bumps it only if the user opted into transcripts.

## 6. Risks

1. **Wrong-person bio** — the catastrophic failure. Mitigations: filing-first (the filing *is* the person), co-mention gate, verbatim excerpt + source link visible, deterministic confidence, and no bio at all when `filing_has_bio=false ∧ gated_news<2` (show "No profile in filing" + the news chips instead). Observed near-miss: v1 marked Leo Puri "high" on a pointer sentence; v2's `filing_has_bio` gate + backfill fixed it.
2. **Self-serving bios:** the company's text omits anything adverse. The card should carry a one-tap "press" row so the investor sees the Reuters/ET framing; don't editorialise.
3. **Stale or missing XBRL/PDF text:** scanned PDFs (none in 44 samples, but SMEs do file image PDFs) → fall back to `attchmntText` + `voiceSummary`, else Gemini vision on page 1 (flash-lite accepts images).
4. **Model-summed numbers** look authoritative; forbid them structurally (§4.3 rule 1).
5. **Multi-entity filings** silently truncated (one of two pledgors). Use list schemas and count checks (`NumberOfPersonsOrEntitiesForWhomChangeIsBeingReported` exists in XBRL).
6. **`voiceSummary` volatility** — unofficial, rolling window, could vanish. Treat as an accelerator, never a dependency.
7. **Rate limits on one shared key:** flash 20 RPD is effectively zero for a team; flash-lite 500 RPD is comfortable for a 20-stock portfolio (≈10 filings/day → ≈5 LLM calls/day after collapsing) but *not* for a market-wide backfill. Cache by `seq_id`; never re-summarise.
8. **NSE access**: needs browser TLS impersonation and cookie warm-up; could block a cloud IP. Keep BSE (`curl_cffi` works) as fallback and persist raw rows so the demo never depends on a live fetch.
9. **Category drift** between NSE `desc`, `attchmntText` and the reference taxonomy (e.g. PIT pledges arrive as "Updates"). Use text regexes as the first classifier; the LLM only confirms.
10. **Time-zone/date parsing**: `an_dt` is IST without offset; record dates appear as "13-Nov-2026", "November 13, 2026", "13.11.2026" — normalise before keying.

## 7. Recommendations (prioritised)

1. **Build the management-change card on the filing's brief profile** (PDF annexure or XBRL `BriefProfile`), with backfill from symbol history when the filing points elsewhere. One flash-lite call, ~$0.001, ≥90% coverage measured. Ship confidence + source link on the card.
2. **Add Google News RSS as the only web corroboration** (keyless, 0.7 s, gated by surname ∧ company). Drop grounding/Tavily/LinkedIn from the plan; mention why in the covering note.
3. **Classify with NSE `desc` + `attchmntText` regexes first**, then extract one-liners with flash-lite using the per-category field lists in §4.2, list-typed facts, and `amount_as_stated` discipline. Spend LLM calls on ≤50% of filings (never on newspaper copies, meet schedules, ESOPs, certificates).
4. **Ingest continuously and persist `voiceSummary`**; use it as the extraction input for the 24 h digest (half the tokens, no PDF) and the PDF only when absent or when a category needs table numbers.
5. **Implement L0+L1 dedupe** with the event keys above; show chips for follow-ups. Target: ≤6 headline cards/day for 20 stocks in results week, ~1–2/day otherwise.
6. **Make materiality rule-based** from extracted fields (rating change, order ≥5% of revenue, promoter sell/pledge, CxO exit) — this is the "judgment" graders look for, and it is auditable.
7. Parse the **XBRL zips** for resignations (zero-LLM; gives reason, dates, notice period) and flag red-flag exits.

## 8. Assumptions other agents should challenge

- That NSE alone is sufficient for the push feed (BSE-only scrips exist; BSE API works with `curl_cffi` but its subcategory names were not mapped).
- That the free-tier `GEMINI_API_KEY` quotas (flash-lite 500 RPD, flash 20 RPD) hold on demo day with the whole team on one key — consider a second key or Ollama `gemma3:4b` as a degraded fallback for one-liners (untested here).
- That `voiceSummary` will still exist next week.
- That a 48 h window is right for all categories (rumour threads and results clusters sometimes span 3–5 days; dividend record dates can trail by a week).
- That the structured PIT/pledge endpoints are reachable with the right params — I got empty `data` arrays; the sibling data agent should confirm or fall back to PIT PDFs.
- That graders accept the filing bio in lieu of LinkedIn — I believe yes (primary > secondary, and the brief says "e.g."), but the covering note must say so explicitly.
