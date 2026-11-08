# 06 — AI/ML approach: model routing, grounding, cost (evidence from real calls)

Author: AI/ML research agent · Date: 8 Nov 2026 · Scratch work (scripts, PDFs, call log) under `/tmp/finn-ai/` (not in repo).

Everything below that is marked **measured** came from real API calls made today with the project's `GEMINI_API_KEY` (free tier) and from local Ollama runs. Every call is logged in `/tmp/finn-ai/calls.jsonl` (76 successful calls, 944k input / 48k output tokens total). Test documents are real BSE filings of Infosys (results filing Q2 FY27, four concall transcripts, FY26 annual report) plus 600 real BSE announcements from 6 Nov 2026. Nothing was run on a paid key; "paid-equivalent cost" = tokens × list price, to show what the pipeline would cost if the free tier ran out.

---

## 0. TL;DR — recommended routing

| Task | Route (all free tier) | Measured |
|---|---|---|
| Announcement triage (hundreds/day) | **Rules first** (BSE `SUBCATNAME` map + regex: ~65% of volume decided with zero LLM) → remainder **batched** into one `gemini-3.5-flash-lite` call (`thinkingLevel=MINIMAL`, `responseSchema`), 48 items/call. Local `qwen3:4b` via Ollama as offline fallback. | Flash-Lite 47/48 (97.9%) on real headlines, 6.2 s for 48 items, 4.7k in / 2.5k out tokens ($0.0076 paid-eq, $0.00016/item). qwen3:4b 46/48, 1.27 s/item, $0. gemma3:4b 42/48. |
| Quarterly results → Revenue/EBITDA/PBT/PAT, QoQ/YoY | pdftotext **page locator** (regex) → send only the 1–2 SEBI-format statement pages as **native PDF** to Flash-Lite with `mediaResolution=MEDIA_RESOLUTION_HIGH` → **arithmetic identity checks in code** (Rev+OI−Exp=PBT, PBT−tax=PAT); QoQ/YoY/EBITDA computed in code. Fallback on check failure: 3.8 Flash on same pages; last resort whole PDF. | 21/21 figures correct across 3 quarter columns (2 pages, 2.4k tokens, $0.0026). Default resolution misread one digit (48,287 vs 48,211) — caught by the identity check. Text-only path could not read revenue (OCR layer broken) and correctly returned `null`. Whole 195-page PDF: also 21/21 but 104k tokens, 75 s ($0.033). |
| Concall → guidance with verbatim quotes | **Map-reduce** with Flash-Lite MINIMAL (8-page chunks → candidates → **exact-substring quote gate in code** → reduce). Speaker attribution verified in code by scanning back to the nearest speaker line across page breaks. | 3 transcripts: 75 candidate quotes, 71 verified verbatim (94.7%); after the gate 100% of shipped quotes/pages/speakers verify. Single-pass extraction (any model) returned only 3 items — low recall; map-reduce returned 8–18. ~27k in / ~5k out tokens, $0.02 per transcript. |
| Annual report (384 pp) → snapshot | **TOC/regex-targeted pages** (≈23 pages, 20k tokens, 10 s, $0.0085) for financial statements; **single-pass native PDF** (200k tokens, 110 s, $0.063) only for things that live in charts (segment mix). **Avoid chunked map-reduce**: it fabricated 4 of 12 numbers (OCF 33,177 vs 33,986 etc.) — caught by the number-grounding gate. | Targeted: 13/13 numbers literally present in source. Full PDF: 12/12 + segment shares correct. Chunked: 8/12. |
| Narrative-vs-numbers ("promised vs delivered") | Precompute at ingest with a **strong tier**: `gemini-3.5-flash`/`3.6-flash` `thinkingLevel=LOW` (3.5–7 s) or `3.8-flash LOW` (best insight, but 71–297 s on free tier → batch/offline only). Inputs are *only* verified facts with ids; every claim cites ids; code re-checks ids and numbers. | 3.8 Flash and 3.5 Flash both linked the two guidance cuts (1.5–3.5% → 1.5–3% → 1–2%) to the reported CC growth slide (4.1% → 2.4% → 1.5%); Flash-Lite MINIMAL listed the facts but did not connect them. 0 ungrounded numbers in 3 of 4 runs. |
| Bull vs bear | Same call as above (one schema, two arrays). Flash-Lite HIGH is acceptable; 3.5 Flash LOW is noticeably sharper. | 8.8k in / 1.3k out tokens, $0.012–0.025 per company. |
| Management-change bio enrichment | **Not** Gemini Search grounding (free tier → 429, verified). Use an external search API (Tavily free tier / DuckDuckGo HTML) + Flash-Lite summarisation, or skip. | — |
| EOD anomalies, QoQ/YoY, margins | **No LLM.** Pure code. | — |

Hard free-tier facts that shape everything: `gemini-3.5-flash-lite` = 10 RPM / 250k TPM / **500 RPD**; `gemini-3.8-flash` and `3.6-flash` = 5 RPM / 250k TPM / **20 RPD each**; `gemini-3.1-pro-preview` and `gemini-4-argon` = **limit 0** (not on free tier, verified by 429 body); explicit context caching = **limit 0 on free tier** (verified); Search grounding = **not available** (verified). All `gemini-2.5-*` models return 404 "no longer available to new users".

---

## 1. Model landscape (as of 8 Nov 2026)

### 1.1 What this key can actually call — measured (`/tmp/finn-ai/01_probe_models.py`)

`GET /v1beta/models` returned 61 models. Text-capable ones that matter, with one real `generateContent` probe each:

| Model id | Context in / out | Probe status | Latency | Notes from probe |
|---|---|---|---|---|
| `gemini-3.8-flash` | 1,048,576 / 65,536 | 200 | **19.4 s** (trivial prompt); later 71 s and 297 s on real tasks | thinking on by default (57 thought tokens on "reply {ok:true}"); `thinkingLevel` LOW/MEDIUM/HIGH only (MINIMAL rejected per docs) |
| `gemini-3.7-flash` | 1M / 65k | **503** "high demand" | — | not retried further |
| `gemini-3.6-flash` | 1M / 65k | 200 | 1.3 s; 3.5 s on 24k-token task | supports MINIMAL..HIGH |
| `gemini-3.5-flash` | 1M / 65k | 200 | 1.5 s; 3.5–7 s on real tasks | still served, but **absent from the current pricing page** (listed only on an older cached copy) — treat as deprecating |
| `gemini-3.5-flash-lite` | 1M / 65k | 200 | 1.2–1.6 s small prompts; 5–20 s with PDFs; 75–110 s with 100–200k-token PDFs | default thinking MINIMAL (0 thought tokens observed) — the workhorse |
| `gemini-3.1-flash-lite` | 1M / 65k | 200 | 1.7 s | same accuracy as 3.5 Flash-Lite on classification |
| `gemini-3-flash-preview` | 1M / 65k | 200 | 1.9 s | legacy |
| `gemini-2.5-flash`, `-flash-lite`, `-pro` | — | **404** | — | "no longer available to new users", redirects suggested to 3.8-flash / 3.5-flash-lite / 3.1-pro-preview |
| `gemini-3.1-pro-preview`, `gemini-pro-latest` | 1M / 65k | **429** | — | body: `generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro` — not on free tier |
| `gemini-4-argon` | 1M / 32k | **429** | — | `limit: 0` — not on free tier; pricing page: "not available on the Free tier" |
| `gemma-4-26b-a4b-it` | 262,144 / 32,768 | 200 (trivial) but **500 Internal error** on both real 5k-token prompts | 3.0 s | unreliable today; also emits thought tokens |
| `gemma-4-31b-it` | 262k / 32k | **500** | — | — |
| `gemini-flash-latest` | alias | 200 | **220.6 s** | aliases have wild latency; pin explicit ids |
| `gemini-flash-lite-latest` | alias | 200 | 1.4 s | — |

Gotcha found in the probe: thinking tokens count toward `maxOutputTokens`; with `maxOutputTokens=64` the thinking models returned truncated JSON (`{"ok`). Set generous output limits or `thinkingLevel=MINIMAL`/`LOW`.

### 1.2 Official free-tier / pricing facts (read 8 Nov 2026)

Sources: pricing page https://aistudio.google.com/docs/pricing (current; lists 4 Argon, 3.8/3.6 Flash, 3.5/3.1 Flash-Lite, Gemma 4), rate-limit doc https://ai.google.dev/gemini-api/docs/rate-limits (Google no longer prints per-model free numbers; "view in AI Studio"), third-party tables that transcribe the AI Studio screens: https://www.scriptbyai.com/gemini-api-rate-limits/ (updated 5 Nov 2026), https://itdeok.com/en/gemini-free-api-key-free-tier-limits/ (Jul 2026), https://gravity.fast/data/free-llm-api-tiers/ (daily re-verified).

| Model | Free tier RPM / TPM / RPD (third-party transcription of AI Studio) | Paid list $/1M in → out | Caching | Search grounding (free) |
|---|---|---|---|---|
| 3.8 Flash | 5 / 250k / **20** | 0.75 → 3.75 (doubles 1 Jan 2027) | explicit listed as "free of charge" on pricing page, **but API returned `TotalCachedContentStorageTokensPerModelFreeTier limit=0`** today | not available (verified 429) |
| 3.6 Flash | 5 / 250k / **20** | 0.75 → 3.75 | same (`limit=0` measured) | not available |
| 3.5 Flash | not in current table (ITDeok: "3.5 Flash and similar: 5–10 RPM, 20 RPD") | 1.50 → 9.00 (older page) | — | — |
| 3.5 Flash-Lite | 10 / 250k / **500** | 0.30 → 2.50 | explicit caching "Not available" | not available (verified 429) |
| 3.1 Flash-Lite | 10–15 / 250k / 500 | 0.25 → 1.50 | not available | not available |
| 3.1 Pro preview | **0** (paid only) | 2.00 → 12.00 (≤200k) | 0.20 | paid only |
| 4 Argon | **0** (paid only) | 2.00 → 10.00 (4.00 → 20.00 from 1 Dec 2026) | implicit only | paid only |
| Gemma 4 26B/31B | 15 / 1M / 1,500 (third-party) | free only | — | — |
| Embedding 2 | 100 RPM / 1,000 RPD (third-party) | 0.15 | — | — |

Other verified capability facts:
- **PDF/Files API**: PDFs up to 50 MB / 1,000 pages (https://ai.google.dev/gemini-api/docs/document-processing). Files API stores 48 h, 20 GB/project (https://aistudio.google.com/docs/file-input-methods). Measured density: **≈520–530 image tokens/page** at default resolution (195 pp → 103,692; 384 pp → 200,133), **1,092/page at `MEDIA_RESOLUTION_HIGH`**. Docs' "258 tokens/page" is for 2.5-era models; budget ~530.
- **Structured output**: `responseMimeType: application/json` + `responseSchema` works on all Flash/Flash-Lite models; the schema dialect is OpenAPI-subset — `"type": ["number","null"]` is rejected (400), use `"nullable": true`. Enums work.
- **Thinking**: Gemini 3.x uses `thinkingConfig.thinkingLevel` (MINIMAL/LOW/MEDIUM/HIGH); `thinkingBudget` is deprecated and can 400. Defaults: 3.5 Flash-Lite MINIMAL, 3.6/3.8 Flash MEDIUM. (https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking)
- **Implicit caching**: observed `cachedContentTokenCount: 21,767` on a 3.6 Flash call and 19,498 on a Flash-Lite chunk — it happens, but is not controllable; do not budget on it.
- **Content on the free tier is used to improve Google's products** — fine for public filings.

### 1.3 Other free/cheap hosted options (no keys available — desk research only, not tested)

| Provider | Free allowance (provider page, date read by tracker) | Models | Worth adding? |
|---|---|---|---|
| Groq | 30 RPM, 1,000 RPD, 8k TPM, 200k TPD per model (https://console.groq.com/docs/rate-limits) | `openai/gpt-oss-120b`, `gpt-oss-20b`, `qwen/qwen3.8-27b` (Llama removed from free tier Aug 2026) | **Yes, as the second classifier/extractor pool** if a key is obtained: 1,000 RPD at ~300 tok/s is ideal for batched triage; 8k TPM makes it unsuitable for transcripts/PDFs. |
| Cerebras | No permanent free tier; $5 trial, 30 days, card required, 5 RPM (https://inference-docs.cerebras.ai/support/rate-limits) | gpt-oss-120b, qwen-3.8-27b | No. |
| OpenRouter `:free` | 20 RPM, **50 RPD** (1,000 after buying $10) (https://openrouter.ai/docs/api-reference/limits) | 12 free text models on 7 Nov 2026 (Nemotron 3.x, Gemma 4 variants, stealth models) | Only as an emergency fallback; 50 RPD is too small. |
| Mistral La Plateforme | ~$10/month credits, limits in console only | Mistral Small/Medium | Maybe for OCR fallback (Mistral OCR); not needed. |
| Cohere trial | 1,000 calls/month, 20 RPM | Command A/R | No. |
| SambaNova | 20 RPM, **20 RPD**, 200k TPD per model | DeepSeek-V3.x, Llama 3.3 70B, gpt-oss-120b | Too few requests. |
| Together / Fireworks / DeepSeek / xAI | no free tier (min $5 purchase) | — | No. |
| GitHub Models | **retired 30 Jul 2026** | — | No. |
| Cloudflare Workers AI | 10,000 Neurons/day free (≈ a few M tokens on 1–3B models) | Llama 3.x small, Gemma, Qwen small | Interesting if the backend is on Cloudflare; otherwise skip. |
| Hugging Face Inference Providers | $0.10/month credit | — | No. |

Source for the table: https://gravity.fast/data/free-llm-api-tiers/ (CC-BY, each row dated, re-fetched daily) cross-checked against Groq/Cerebras official pages.

### 1.4 Local models on this 18 GB Mac (Ollama 0.12.6)

- Installed and **measured**: `qwen3:4b` (pulled today, 2.5 GB, Q4_K_M, `think:false`), `gemma3:4b`, `llama3.2:3b`.
- `qwen3.5:4b` / `gemma4:*` require a newer Ollama (pull failed: "Please download the latest version"). Upgrading Ollama was not done (system change); if done, community measurements favour `qwen3.5:4b` (5.99 GiB resident, 12/12 JSON tests) and `qwen3.5:9b` (7.95 GiB) for 16–18 GB Macs (https://talkaiwith.substack.com/p/how-much-ram-does-a-local-llm-actually, https://mlx.app/mac/18gb).
- Measured classification on 48 real headlines (one call per item, JSON-schema `format`, temp 0): **qwen3:4b 95.8% @ 1.27 s mean (p95 1.47 s)**, gemma3:4b 87.5% @ 1.39 s, llama3.2 77.1% @ 1.09 s. Local is a credible zero-cost fallback for triage, not for PDFs/transcripts (no vision, slow prefill on 25k tokens).
- Practical caveat: the deployed demo (Vercel/Expo) cannot reach a laptop Ollama; local models only help a self-hosted backend or offline batch jobs.

---

## 2. Task-by-task routing — experiments

### 2.1 (a) Announcement classification + priority + one-liner

**Data**: 600 real BSE announcements for 6 Nov 2026 fetched from `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` (needs a browser UA, `Referer: https://www.bseindia.com/` and a prior GET on bseindia.com for cookies; a bare curl gets 403). 48 of them hand-labelled into the reference taxonomy with an "also acceptable" label for 17 genuinely ambiguous ones (`/tmp/finn-ai/data/classif_set.json`). BSE's own `CATEGORYNAME/SUBCATNAME` is included as a feature.

**Results (category accuracy, gold-or-acceptable)** — `/tmp/finn-ai/03_classify_eval.py`:

| System | Acc | Latency | Tokens | Paid-eq cost / 48 |
|---|---|---|---|---|
| Rules: BSE subcategory map + regex (written after seeing the data — optimistic) | 47/48 | 0.8 ms total | 0 | $0 |
| `gemini-3.5-flash-lite` MINIMAL, **one batched call, 48 items, with BSE category** | **47/48** | 6.2 s | 4,691 in / 2,485 out | $0.0076 |
| same, without BSE category | 46/48 | 5.9 s | 4,086 / 2,387 | $0.0072 |
| `gemini-3.1-flash-lite` MINIMAL batched | 47/48 | 5.9 s | 4,691 / 2,319 | $0.0047 |
| `gemini-3.5-flash-lite` single-item calls (first 10) | 10/10 | 1.57 s mean | 665 in / 39 out per item | 7× more input tokens per item than batching |
| `gemma-4-26b-a4b-it` (API) | — | — | **500 Internal error** ×2 | — |
| Ollama `qwen3:4b` | 46/48 | 1.27 s/item | 32k / 1.7k | $0 |
| Ollama `gemma3:4b` | 42/48 | 1.39 s/item | | $0 |
| Ollama `llama3.2` | 37/48 | 1.09 s/item | | $0 |

The only Flash-Lite "miss" was a delisting reverse-book-building outcome labelled `M&A` (defensible). Sample outputs (category / priority / one-liner):

```
results  high   | Audited results and interim dividend approved for the period ended September 2026
M&A      high   | Sanction of scheme of amalgamation with AeroStructures Manufacturing India.
litigation high | Received tax order and demand from CGST authorities.
unclassified low| Compliance certificate under Regulation 74(5) of SEBI depositories regulations.
press_release medium | Received new orders worth Rs. 909 crores.
```

Two product-relevant weaknesses of model-assigned priority: a *board-meeting intimation* to consider results got `high` (it is a scheduling notice), and an independent director's term-end cessation got `high` like a CFO exit. **Decide priority in code** from (category, doc_kind, role) rather than asking the model; ask the model for `doc_kind ∈ {filing, intimation, newspaper_ad, transcript, recording, deck, press_release}` and `role` instead.

Volume maths from the 600-row sample: 37% of announcements map deterministically from `SUBCATNAME` alone; adding two regexes ("Board Meeting" + results words → `results`; "Analyst / Investor Meet" + audio/recording → `earnings_call` else `investor_meetings`) covers ≈65%. The remaining ≈35% (Outcome of Board Meeting, General, Newspaper Publication, Press Release, Others) are the ones worth an LLM look. A 20-stock portfolio produces a handful to ~40 announcements/day → **one Flash-Lite batch call per refresh**.

Prompt used (system; abbreviated — full text in `03_classify_eval.py`):

```
You classify Indian stock-exchange (BSE/NSE) corporate announcements for an investor app.
Categories (use exactly one of these ids): <taxonomy from reference.txt, one line each>
Priority: high = likely to move the stock or change the thesis (...); medium = worth a glance (...); low = routine (...).
Summary: one line, <= 15 words, concrete, no filler, no company name.
--- user: Classify each announcement. Return one item per id.
[0] Company: ... / Subject: ... / Headline: ... / BSE category: Result / Financial Results
...
responseSchema: {items:[{id:int, category:enum, priority:enum, summary:string}]}
```

### 2.2 (b) Quarterly results → headline numbers

**Document**: Infosys "Results for the quarter and half year ended September 30, 2026" — the actual BSE attachment (`AttachLive/26c12463-….pdf`, **195 pages, 25.5 MB**: cover letter, auditor reports, SEBI-format statements, IFRS INR/USD press releases, full Ind AS consolidated + standalone statements). Ground truth = page 162 (clean text Ind AS P&L) + screener.in consolidated table. Note on Indian results filings: **the SEBI-format statement (here p.18) has three quarter columns — current, previous, year-ago — so one page yields QoQ and YoY**; it is often a scanned image with a broken OCR layer (here `pdftotext` lost the revenue and other-income rows entirely and garbled digits: `11 ,063`, `3,1 78`).

**Results** (`/tmp/finn-ai/04_results_extract.py`; 7 fields × 3 quarters = 21 figures):

| Input to Flash-Lite (MINIMAL unless noted) | Correct | Tokens (in/out) | Latency | Paid-eq |
|---|---|---|---|---|
| Text of OCR page 18 only | 15/21 — **returned `null` for the 6 OCR-lost cells (good abstention), 15/15 of the rest right despite garbling** | 2,567 / 709 | 8.8 s | $0.0025 |
| Text of pages 18 + 162 | 14/21 — preferred clean p.162, which lacks the June column | 4,142 / 521 | 9.2 s | $0.0026 |
| **Native PDF, pages 18–19, default resolution** | 20/21 — June revenue read as **48,287** (true 48,211, verified from the page image) | 1,251 (1,064 image) / 761 | 5.1 s | $0.0023 |
| Same, `thinkingLevel=LOW` | 20/21 — same misread (deterministic) | 1,251 / 761 | 8.0 s | $0.0023 |
| **Native PDF, pages 18–19, `mediaResolution=MEDIA_RESOLUTION_HIGH`** | **21/21** | 2,371 (2,184 image) / 761 | 20.2 s | $0.0026 |
| `gemini-3.8-flash` LOW, pages 18–19, default res | **21/21** | 1,251 / 845 | **71.5 s** | $0.0041 |
| Whole 195-page PDF via Files API, Flash-Lite | 21/21 | **103,850** / 638 | 75.1 s | $0.033 |

The 48,287 misread is exactly the failure mode a UI must never show. It is caught mechanically: `revenue + other_income − total_expenses = PBT` → `48,287 + 984 − 38,167 = 11,104 ≠ 11,028`. **Rule: never ship a results card whose identities don't close; escalate (HIGH res → 3.8 Flash → whole PDF → human).** EBITDA is computed, not extracted: `EBITDA = PBT + finance cost + D&A − other income` reproduced screener's "Operating Profit" for all three quarters (11,689 / 11,409 / 10,535).

Page locator used (zero tokens): pages whose text contains ≥5 of {consolidated, revenue from operations, profit before tax, quarter ended|three months ended, profit for the period, total expenses} → `[18, 22, 127, 162]`; prefer the earliest "Statement of Consolidated … Results" page.

Prompt (user part; schema in script):

```
From this quarterly results filing extract the CONSOLIDATED statement of profit and loss (prefer Ind AS over IFRS; if only standalone exists, say so).
Return every period column shown (3-month quarters and 6/12-month periods). Use the numbers exactly as printed (₹ crore, no scaling). Use null when a figure is not disclosed — never estimate.
Field mapping: revenue='Revenue from operations'; other_income='Other income, net'; total_expenses='Total expenses'; depreciation=...; finance_cost=...; pbt='Profit before tax' (after exceptional items); pat='Profit for the period' (total, before split to owners/NCI).
```

Sample output (HIGH-res run, trimmed): `{"statement":"Consolidated, Ind AS","unit":"₹ crore","source_page":18,"periods":[{"period_end":"2026-09-30","months":3,"revenue":49244,"other_income":848,"total_expenses":39029,"depreciation":1359,"finance_cost":115,"pbt":11063,"pat":7838}, {"period_end":"2026-06-30",…,"revenue":48211,…,"pbt":11028,"pat":7775}, {"period_end":"2025-09-30",…,"revenue":44490,…,"pbt":10229,"pat":7375}, …6m and 12m rows…]}`

### 2.3 (c) Concall transcript → guidance with verbatim quotes, speaker, page

**Documents**: Infosys transcripts filed on BSE for Q4 FY26 (Apr 2026, 46 pp), Q1 FY27 (Jul 2026, 48 pp), Q2 FY27 (Oct 2026, 48 pp; press conference + analyst call, ~18k words ≈ 23.8k tokens). Links come straight off the screener.in company page (`Concalls` block → `bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=<uuid>.pdf`, downloadable with a browser UA).

**Single-pass extraction** (whole transcript with `[[page N]]` markers, schema with `quote/speaker/page`): Flash-Lite MINIMAL, Flash-Lite LOW, 3.5 Flash LOW, 3.6 Flash LOW **all returned the same 3 statements** (revenue growth 1–2% CC, margin 20–22%, ~20,000 freshers) — all quotes verified verbatim, but recall is poor. Latency 3.5 s (3.5/3.6 Flash) to 21 s (Flash-Lite LOW); 23.8k input tokens.

**Map-reduce** (Flash-Lite MINIMAL; 8-page chunks with a high-recall "list every forward-looking statement by management" prompt → candidates → **verbatim gate** → one reduce call to dedupe/structure):

| Transcript | Candidates | Verified verbatim | Final statements | Quote/page/speaker verified | Tokens in/out | Latency |
|---|---|---|---|---|---|---|
| Q4 FY26 (Apr 26) | 25 | 24 | 9 | 9/9 · 8/9 page · 8/9 speaker | 26.6k / 4.6k | 118 s (sequential, incl. one 503 retry) |
| Q1 FY27 (Jul 26) | 28 | 27 | 18 | 18/18 · 18/18 · 18/18 | 27.4k / 6.3k | 37 s |
| Q2 FY27 (Oct 26) | 22 | 20 | 8 | 8/8 · 8/8 · 8/8 | 26.9k / 4.2k | 79 s |

Verbatim fidelity at the map stage: **71/75 = 94.7%**. The 4 rejects: 2 light paraphrases (fuzzy 94), 2 exact quotes that straddle a page break (fuzzy 98 with the page off by one) — accept adjacent-page spans and display the *source* span, not the model's string. The product-level output is 100% verified by construction. Example statements shipped (Q2 FY27):

```
p4  Salil Parekh      | revenue growth   | 1% to 2% YoY CC | FY27 | "Based on our Q2 performance and revised outlook for rest of the year, our revenue growth guidance is 1% to 2% YoY.in constant currency terms."
p4  Salil Parekh      | operating margin | 20% to 22%      | FY27 | "Our operating margin guidance remains at 20% to 22% for the year."
p28 Jayesh Sanghrajka | effective tax    | 29% to 30%      | FY27 | "We expect effective tax rate for the year to be in the range of 29% to 30%."
p47 Jayesh Sanghrajka | growth impact    | 1.8% to 2%      | FY27 | "both the factors, the offshoring and the large deal, Europe manufacturing client that we d…"
```

Speaker verification needed a fix discovered in testing: speeches span pages, so the nearest speaker line must be searched **backwards across page breaks** (page-local search mis-attributed 3/8).

Cost per transcript: ~$0.02 paid-equivalent, 7 Flash-Lite requests (≈4 if chunks are 16 pages). Prompts: `MAP_SYSTEM`, `SYSTEM` in `/tmp/finn-ai/05_guidance_extract.py`; the key sentence is *"The quote MUST be copied verbatim and contiguous from the transcript (same words, same order, no ellipses) — it will be string-matched by a program; a quote that does not match exactly is discarded."*

A companion one-call extractor pulled the quarter's **reported actuals** in management's words (CC growth YoY/QoQ, margin, TCV, FCF, attrition…) from the first 14 pages: 8/8, 7/7, 10/11 quotes verified (`08_actuals_extract.py`).

### 2.4 (d) Annual report (384 pages) → sectioned extraction

**Document**: Infosys Integrated Annual Report FY26 as filed to BSE (`xml-data/corpfiling/AttachHis/19dd605c-….pdf`, 9 MB, 384 pp). `pdftotext -layout` → 193k words ≈ **636k tokens** (layout whitespace); raw mode ≈ 325k tokens — **both exceed the 250k free-tier TPM**, so a single text pass is impossible on free tier; as native PDF it is 200,133 tokens (fits in one request, but only one such request per minute).

| Approach (Flash-Lite MINIMAL) | Headline (rev/PBT/PAT) | All numbers literally present in source | Tokens in/out | Latency | Paid-eq |
|---|---|---|---|---|---|
| **C. TOC/regex-targeted pages** (23 pages: auditor opinion, BS, P&L, CF, segments, contingent, RPT, MD&A, dividend, employees) | 3/3 (PAT given as owners' 29,440 — both 29,440 and 29,474 are printed; schema must say which) | **13/13** | 19.7k / 1.0k | 10.4 s | $0.0085 |
| **A. Whole PDF, one pass (Files API)** | 3/3 | **12/12**, plus all 8 segment revenue shares correct (27.9/16.3/13.3/12.9/12.2/7.8/6.9/2.7 — read off a chart) | 200.3k / 1.1k | 110.6 s | $0.063 |
| **B. Chunked map-reduce** (12 × 32-page text chunks + reduce) | 3/3 | **8/12 — OCF 33,177 (true 33,986), OCF FY25 28,424 (35,694), capex 2,426 (2,727), 2,049 (2,237) are NOT in the document** although the correct cash-flow page was inside the chunk | 356k / 10.4k | 296 s (13 calls, paced for TPM) | $0.133 |

Three lessons: (1) Indian ARs contain **both standalone and consolidated** statements and notes; chunking blurs them (my targeted locator also pulled a standalone contingent-liabilities note, 1,944 vs Group 3,117, and a BRSR headcount 3,52,095 vs consolidated 3,28,594 — definitional, not fabricated, but the locator must prefer pages after the "Consolidated Financial Statements" index page). (2) Flash-Lite **can fabricate plausible numbers in dense 29k-token chunks** even when told to return null — only a literal-match gate catches it. (3) Page references returned when the model *sees* the PDF are the **printed folio numbers** (e.g. "307" for PDF page 277); build a folio→index map from each page's footer text, or anchor on `[[page N]]` markers in text mode.

Recommended AR pipeline: targeted text pages for everything numeric (cheap, 1 call) + one whole-PDF pass per AR only when the UI needs chart-only facts (segment mix, geography) — or read those from the segment note (text) instead and skip the 200k-token call entirely.

### 2.5 (e)+(f) Narrative-vs-numbers and bull/bear — which tier?

**Setup** (`09_reasoning_eval.py`): 65 verified facts with ids — 35 guidance statements and 25 reported actuals from the three calls (all quote-verified), plus 5 quarters of consolidated numbers — ~8.8k tokens. The model may use only these facts; each claim must cite ids; code checks ids exist and that every number in a claim appears in its cited facts (or is a one-step difference/ratio of them).

| Model / thinking | Latency | Tokens in/out(+think) | Paid-eq | Grounding check | Quality (my read) |
|---|---|---|---|---|---|
| Flash-Lite MINIMAL | 3.4 s | 8.8k / 0.8k | $0.005 | 11/11 claims OK | Lists the three guidance ranges by date but labels the first "on_track"; never connects cuts to delivered growth. Serviceable facts, no analysis. |
| Flash-Lite HIGH | 9.3 s | 8.8k / 0.6k (+2.9k think) | $0.012 | 11/11 OK | Adds "delivered" verdicts for FY26 (3.1% CC, 21% margin) and margin-vs-guidance tracking. Still no cut-vs-actual link. |
| **3.5 Flash LOW** | **7.1 s** | 8.8k / 1.3k | $0.025 | 12/12 (one false alarm: "2.0%" vs "2%") | "progressively cut … 1.5–3.5% → 1.5–3.0% → 1.0–2.0%"; bear case: CC growth **4.1% → 2.4% → 1.5%**; clean not-disclosed list (segment growth, ETR actuals, headcount). |
| 3.8 Flash LOW | **296.9 s** | 8.8k / 1.4k | $0.012 | 12/12 OK | Best: ties the cuts to the growth slide in one sentence, notices the onsite-mix target drift (70 bps → 75 bps–1%), notes the walked-away European deal, flags that Q2 TCV lacks the net-new split Q1 disclosed. |

Verdict: the analysis layer needs the Flash tier, not Flash-Lite; 3.5/3.6 Flash LOW at 3–7 s is the interactive choice; 3.8 Flash is better but on the free tier its latency (19 s → 71 s → 297 s across the day) makes it **precompute-only**. With 20 RPD per Flash model, spread the ~20 companies across 3.8/3.6/3.5 Flash pools and regenerate only when a new document lands.

---

## 3. Grounding & verification pipeline (working prototype)

Principle: **the model proposes, code disposes.** Every fact shown in the UI passes a mechanical gate; what fails is dropped or marked "not disclosed", never paraphrased into existence.

1. **Schema-constrained outputs everywhere** (`responseSchema`, enums, `nullable` numbers). Measured: no JSON parse failure on any of the 76 successful responses (the one schema error was a request-side 400 for `"type": ["number","null"]`).
2. **Quote-then-verify** (transcripts, MD&A, auditor opinion): normalise (NFKC, curly quotes, dashes, whitespace, case) and require an exact substring match on the cited page, else on adjacent pages, else anywhere in the document (then correct the page). Fuzzy ≥97 may be accepted *only* by substituting the source span. Measured acceptance 94.7% at map stage; 100% of shipped quotes verified.
3. **Speaker verification**: scan backwards from the quote offset across page breaks to the nearest line matching a speaker pattern; compare with the claimed speaker. 34/35 after the cross-page fix.
4. **Number grounding**: every numeric field must appear literally in the source text in Indian (`3,52,095`) or international (`352,095`) grouping, optional decimals/parentheses (`07_verify_numbers.py`). Caught 4/4 fabrications in the chunked-AR run; 0 false positives on 25 grounded numbers.
5. **Arithmetic identities** (results): `revenue + other_income − total_expenses = PBT`, `PBT − current − deferred tax = PAT`, `PAT = owners + NCI`, half-year = Q1 + Q2 when both are present, prior-quarter column = previous filing's current column. Tolerance ±1 crore (rounding). Caught the 48,287 vision misread.
6. **Derived numbers only in code**: QoQ, YoY, EBITDA, margins, growth, working-capital days. The model never emits a growth rate for a results card.
7. **Fact-ids for synthesis**: reasoning prompts receive only verified facts with ids; the output cites ids per claim; code drops claims with unknown ids or numbers not in cited facts (one false positive observed: "2.0%" vs "2%" — normalise trailing zeros).
8. **Abstention by design**: `null` / "not disclosed" is a first-class value in every schema; the `not_disclosed` array in synthesis outputs is rendered in the UI (3.5 Flash's list was investor-grade).
9. **Self-consistency where cheap**: classification and results extraction are deterministic at temperature 0 (same misread twice) — self-consistency does not fix systematic vision errors; resolution/model escalation does. Use a second sample only for the analysis tier if budget allows.
10. **Provenance in the UI**: every card carries `{doc_hash, page, quote|cell}` so a tap opens the source page.

Core of the prototype (from `/tmp/finn-ai/05_guidance_extract.py` and `07_verify_numbers.py`):

```python
def norm(s):
    s = unicodedata.normalize("NFKC", s).replace("’","'").replace("‘","'").replace("“",'"').replace("”",'"').replace("–","-").replace("—","-")
    return re.sub(r"\s+", " ", s).strip().lower()

def verify(st):                         # st = {"quote","page","speaker",...} from the model
    q = norm(st["quote"]); pg = st["page"]
    if q in NPAGES[pg-1]:               # exact on cited page
        m = re.search(r"\s+".join(map(re.escape, st["quote"].split())), PAGES[pg-1], re.I)
        spk = find_speaker(pg-1, m.start())          # nearest speaker line, searching back across pages
        return {"ok": True, "speaker_ok": norm(spk) in norm(st["speaker"]) or norm(st["speaker"]) in norm(spk)}
    for i, np_ in enumerate(NPAGES, 1):             # exact elsewhere -> fix the page
        if q in np_: return {"ok": True, "page_fixed": i}
    return {"ok": False, "fuzzy": max(fuzz.partial_ratio(q, np_) for np_ in NPAGES)}

def variants(x):                        # 352095 -> {'352095','352,095','3,52,095','352095.0',...}
    s = str(int(x)); out = {s, f"{int(x):,}"}
    head, tail = s[:-3], s[-3:]; parts = []
    while len(head) > 2: parts.insert(0, head[-2:]); head = head[:-2]
    if head: parts.insert(0, head)
    return out | {",".join(parts) + "," + tail}

def grounded(x, text): return any(re.search(r"(?<![\d,.])" + re.escape(v) + r"(?![\d])", text) for v in variants(x))

def identities_close(p, tol=1):         # p = one period of the results schema
    return (abs(p["revenue"] + p["other_income"] - p["total_expenses"] - p["pbt"]) <= tol
            and abs(p["pbt"] - p["tax_current"] - p["tax_deferred"] - p["pat"]) <= tol)
```

Ingest-time flow per document (all precomputed, keyed by `sha256(pdf)`): download → `pdftotext` (layout + raw) → page classifier/locator (regex, 0 tokens) → model call(s) on the located pages → gates → store `{facts, quotes, pages, status}`; the UI reads the store only. Re-running the same `(doc_hash, prompt_version)` never calls the model (the experiments used exactly this: a local cache made re-scoring free).

---

## 4. Cost model (measured tokens × list prices; free tier = $0 within limits)

Per-document costs (Flash-Lite unless noted; paid-equivalent at $0.30/M in, $2.50/M out; thinking tokens billed as output):

| Unit of work | Requests | Tokens in / out | Paid-eq |
|---|---|---|---|
| Classify 48 announcements (one batch) | 1 | 4.7k / 2.5k | $0.0076 |
| Results filing → headline table (located 2 pages, HIGH res) + identity checks | 1 (+1 fallback 3.8 Flash in ~5% of cases) | 2.4k / 0.8k | $0.0026 (+$0.004) |
| Results filing, whole-PDF fallback | 1 | 104k / 0.6k | $0.033 |
| Transcript → guidance (map-reduce) + actuals | 7–8 (4–5 with 16-page chunks) | 34k / 5.5k | $0.024 |
| Annual report → snapshot (targeted pages) | 1 | 20k / 1k | $0.0085 |
| Annual report, whole-PDF pass (optional, chart facts) | 1 | 200k / 1k | $0.063 |
| Promised-vs-delivered + bull/bear (3.5 Flash LOW) | 1 | 8.8k / 1.3k | $0.025 ($0.012 on 3.8 Flash) |
| Business/financial snapshot prose from verified facts (Flash-Lite) | 1 | ~6k / 1k | ~$0.004 |

**Full Pull research run, first time for one company** = 1 AR (targeted) + 4 transcripts + 4 results filings + 1 strong synthesis + 1 snapshot ≈ **35–40 Flash-Lite requests + 1 Flash request, ≈ 180k in / 28k out tokens, ≈ $0.14 paid-equivalent** (≈$0.20 with the optional whole-AR pass). On the free tier: 500 Flash-Lite RPD → **~12 companies/day** at 40 req each (25 with 16-page transcript chunks); 20 RPD per Flash model → ~60 strong calls/day across 3.8/3.6/3.5 Flash. The 20-company portfolio + 5 ad-hoc names ingest comfortably over the build week; incremental updates are one or two documents per company per quarter.

**Push per day over 20 stocks**: announcement classification ≤2 batch calls; results extraction on results days (peak ≈ 8 companies/day in season) ≤ 16 calls; management-change bios ≤ 3 calls (external search + Flash-Lite); EOD anomaly detection 0 calls. **< 25 requests and < 150k tokens/day → $0 (≈$0.05/day paid-equivalent).** TPM (250k/min) is the real ceiling, not RPD: never send a 200k-token PDF while another large job is in flight; serialise big calls through a single queue with a token bucket.

What must be cached/precomputed (so the UI is instant): per-document extraction JSON keyed by document hash (immutable filings → cache never expires), per-company fact store (guidance history, actuals, quarterly table), synthesis outputs keyed by `(company, set of doc hashes, prompt_version)`, and the announcement classification keyed by `NEWSID`. Explicit Gemini context caching is unavailable on the free tier (limit 0) — our own result cache replaces it; implicit caching is a free bonus when it happens.

Sensitivity: paid prices for 3.8/3.6 Flash double on 1 Jan 2027 and 4 Argon on 1 Dec 2026; Flash-Lite is unchanged. Even at 10× the volume above, the paid bill would be a few dollars per month.

---

## 5. Relevant 2025–2026 literature (only what I actually found/read today)

- **Citation-grounded earnings-call benchmark (ECTs-100)** — arXiv 2610.00969 (Oct 2026): proposes numeric-evidence groundedness evaluation without expert labels; finds LLM citation *precision* 0.97 but recall 0.71 and claim F1 0.65, and studies "conscious incompetence" (refusing when evidence is insufficient). Transfers directly: our quote gate enforces precision; map-reduce addresses recall; `not_disclosed` arrays operationalise abstention. https://arxiv.org/html/2610.00969
- **LEDGER** — arXiv 2606.13100 (Jun 2026): 4,999 full annual reports, 31 consolidated KPIs; single-value lookup ability does not transfer to full-schema extraction (one model drops from 87.9% needle accuracy to 41.4% recall with many hallucinated cells); schema constraints help; no model > 80% recall. Matches what we saw with chunked extraction, and argues for narrow, per-section schemas. https://arxiv.org/html/2606.13100
- **FinLongDocQA / FinLongDocAgent** — arXiv 2604.03664 (Apr 2026): annual reports > 129k tokens cause "context rot" in locating tables; iterative retrieve → compute → verify beats long-context prompting for cross-table numeric QA. Supports targeted retrieval + code-side arithmetic over one-shot long context. https://arxiv.org/html/2604.03664v1
- **FAITH** — arXiv 2508.05201 (Aug 2025): masked-span benchmark from 10-Ks for intrinsic numeric hallucination; taxonomy lookup / comparative / bivariate / multivariate. Our design pushes everything above "lookup" into code. https://arxiv.org/html/2508.05201
- **FinRank** — arXiv 2608.07400 (Aug 2026): provenance-sensitive retrieval over 10-K/10-Q; confusable passages across periods/entities are the hard negatives (our standalone-vs-consolidated confusion is the Indian analogue). https://arxiv.org/html/2608.07400
- **KPI extraction from earnings calls** — arXiv 2605.03147 (May 2026): encoder models trained on SEC filings fail on conversational calls; LLM open-ended extraction reaches 79.7% precision under human evaluation — in line with our 94.7% verbatim-quote rate once quotes are required. https://arxiv.org/html/2605.03147
- **Earnings2Insights** (FinNLP 2025 shared task): analyst-report generation from call transcripts; automatic metrics diverge from human decision utility — judge the Pull outputs by whether an investor acts on them, not by ROUGE. https://aclanthology.org/2025.finnlp-2.17.pdf
- **FinDVer** (2024/25): claim verification over long hybrid financial documents, long-context vs RAG. https://doi.org/10.48550/arxiv.2411.05764
- **EviFiVQA** (IIIT-H, 2025): evidence-localised VQA over financial statement tables (bounding boxes) — the right frame for scanned SEBI-format pages. https://cvit.iiit.ac.in/images/ConferencePapers/2025/EviFiVQA.pdf
- **IndFin-Bench** (2026): 100 questions over Indian listed-company filings FY23–FY26 (CC-BY-NC) — small, but the only India-specific set I found; useful for a sanity sweep. https://cofacto.substack.com/p/introducing-indfin-bench-a-pioneering
- Classics still used as yardsticks: FinanceBench, DocFinQA, FinQA/ConvFinQA, TAT-QA, ECTSum (summary at https://www.patronus.ai/resources/financial-llm-benchmarks). A FinanceRAG paper (ICLR 2025 workshop, arXiv 2503.15191) reports hybrid BM25+dense retrieval optimal weights differ by task (fact lookup favours sparse) — our regex page locator is the degenerate, zero-cost version of that.

---

## 6. Open risks and what could not be verified

1. **3.8 Flash latency on the free tier is erratic (19 s / 71 s / 297 s today)** and 3.7 Flash returned 503. Do not put any Flash-tier call on the request path of the demo; precompute. Keep 3.6 and 3.5 Flash as alternates (3.5 s observed).
2. **Only one hosted key.** All Gemini quotas are per project; a demo day with evaluators hammering ad-hoc research on new tickers can exhaust 500 Flash-Lite RPD. Mitigation: everything cached by doc hash, a visible "researching… ~90 s" state for first-time tickers, a Groq key as a second pool if obtainable, qwen3:4b/rules for triage.
3. **Vision digit errors are deterministic, not noisy** (same misread at two thinking levels). Only resolution/model escalation plus identity checks protect against them. Filings whose statements don't close (banks/NBFCs use a different P&L format: NII, provisions, no "total expenses") need a second schema.
4. **Standalone vs consolidated contamination** is the most likely silent error in Indian documents; prefer consolidated pages structurally and store `statement_type` with every number.
5. **Printed folio ≠ PDF page** when the model reads PDFs visually; build the mapping from footers before trusting page anchors.
6. **Gemma 4 via API 500s on real prompts** and Gemma-4/Qwen-3.5 local need an Ollama upgrade — not done.
7. **Free-tier numbers are transcribed by third parties**; Google only shows them in AI Studio. The limits that matter (Flash 20 RPD, Pro/Argon 0, caching 0, grounding 0) were confirmed by real 429 bodies today; the 500 RPD for Flash-Lite was *not* hit (≈50 calls) so it is unconfirmed but consistent with three sources.
8. **Rules baseline is optimistic** (written after seeing the headlines); expect ~90% on unseen weeks and let the LLM own the long tail.
9. **No live test of Groq/OpenRouter/Cloudflare** — no keys.
10. **Search grounding is paid-only**; the "incoming CFO bio" feature needs an external search API or should be scoped to what the filing itself says (BSE announcements for appointments usually include a short profile paragraph — extract that first; it is primary and free).

## 7. Prioritised recommendations

1. Build the ingest pipeline exactly as in §3: pdftotext → regex locator → Flash-Lite with schema → gates → cache by hash. Ship results cards only when identities close.
2. Route: Flash-Lite MINIMAL for all extraction/classification (batched); `MEDIA_RESOLUTION_HIGH` for scanned statement pages; 3.5/3.6 Flash LOW for synthesis (precomputed; 3.8 Flash in a nightly batch if its latency behaves).
3. Compute every derived number (QoQ, YoY, EBITDA, margins, promised-vs-delivered deltas) in code; the model writes sentences that cite fact ids.
4. Make `not disclosed` visible in the UI; it is a feature evaluators will notice.
5. Spend zero tokens on EOD anomalies and ~65% of announcements (rules).
6. Keep the Ollama path (`qwen3:4b`) as a documented fallback for triage; don't build on it for the deployed demo.

## 8. Assumptions other agents should challenge

- That BSE's `SUBCATNAME` is available for every announcement the data agent ingests (NSE's feed has a different taxonomy; a mapping table is needed).
- That results filings for mid/small caps also carry the three-column SEBI statement near the front (true for the sample I saw in the 600-announcement feed, but scanned quality varies more than Infosys').
- That screener.in's standardised quarterly table may be used as a cross-check (it is derived from primary filings, but the brief's "primary sources only" rule should be read as: display numbers from the filing, use screener only to validate).
- That 500 RPD Flash-Lite is really available to this project (confirm in AI Studio's rate-limit screen; it requires a login I don't have).
- That a 90-second first-time research latency is acceptable UX for an ad-hoc ticker (alternative: pre-ingest the NIFTY 100 overnight).

## Appendix — scripts (all under `/tmp/finn-ai/`, Python 3.12 venv, deps: requests, google-genai, pypdf, rapidfuzz, pillow)

| File | Purpose |
|---|---|
| `gem.py` | REST helper: `generate()` with schema/thinkingLevel/mediaResolution, retry on 503/429-RPM, response cache keyed by request hash, call log, paid-equivalent cost; `upload_file()` (Files API resumable upload); `count_tokens()` |
| `01_probe_models.py` | one probe per model → `01_probe_results.json` |
| `02_build_classif_set.py` | 48 hand-labelled real announcements from `data/bse_ann_nov6.json` |
| `03_classify_eval.py` | rules vs Ollama vs Gemini (batched/single) classification eval |
| `04_results_extract.py` | results PDF: text vs native-PDF pages vs whole PDF; scoring vs ground truth |
| `05_guidance_extract.py` | transcript guidance extraction (single-pass and map-reduce) + quote/page/speaker verification |
| `08_actuals_extract.py` | reported actuals with verified quotes |
| `06_annual_report.py` | AR: whole-PDF vs chunked vs targeted; `07_verify_numbers.py` number-grounding gate |
| `09_reasoning_eval.py` | fact-id grounded promised-vs-delivered + bull/bear across model tiers with code checks |
| `calls.jsonl`, `cache/` | every call's model/status/latency/usage; cached responses |
| `data/` | the BSE PDFs/text (results 195 pp, AR 384 pp, 4 transcripts), 600 announcements, screener HTML |

`gem.generate` call shape used throughout (REST, no SDK dependency):

```python
body = {"contents": [{"role": "user", "parts": [{"text": PROMPT}, {"inline_data": {"mime_type": "application/pdf", "data": b64_pages}}]}],
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "generationConfig": {"temperature": 0, "maxOutputTokens": 4096, "responseMimeType": "application/json", "responseSchema": SCHEMA,
                             "thinkingConfig": {"thinkingLevel": "MINIMAL"}, "mediaResolution": "MEDIA_RESOLUTION_HIGH"}}
requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", params={"key": KEY}, json=body)
```
