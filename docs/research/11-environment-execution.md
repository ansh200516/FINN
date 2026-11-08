# 11 — Environment & execution audit (toolchain, keys, network, scaffolding, build-history capture)

Audited Sunday 8 Nov 2026, ~17:20–18:00 IST, on the build machine (macOS 26.3.1, arm64, 18 GB RAM). All checks were read-only except scratch work under `/tmp/finn-exec/` (now cleaned to <2 MB). Nothing was deployed, no cloud resources were created, no secrets are reproduced here.

## 0. Executive summary — blockers first

| Severity | Finding | Evidence | Action |
|---|---|---|---|
| **BLOCKER (deploy)** | Vercel CLI is **not logged in** (`auth.json` is `{}`) | `vercel whoami` → "No existing credentials found" | User runs `vercel login` once, **or** (preferred) connect the GitHub repo in the Vercel dashboard so pushes auto-deploy; no CLI needed |
| **BLOCKER (repo)** | GitHub over **SSH is denied** (`Permission denied (publickey)`), `ssh-agent` has no identities, `gh` not installed | `ssh -T git@github.com` with and without `-i ~/.ssh/id_ed25519` | Use **HTTPS**: a fine-grained PAT for user `ansh200516` is already in the macOS keychain and validated against `api.github.com/user` (200). Caveat: fine-grained PATs are scoped to selected repos — create the repo in the browser first, then test `git push`; if 403, edit the PAT's repository access or `brew install gh && gh auth login` |
| **HIGH (LLM)** | Gemini project is on the **free tier**, and **all `gemini-2.5-*` models return 404 for this key** ("no longer available to new users"). Pro models return 429 with `limit 0` | `gemini-2.5-flash-lite:generateContent` → 404; `gemini-3.1-pro-preview:generateContent` → 429 `…-FreeTier` quota IDs | Build on **`gemini-3.5-flash-lite`** (verified 200, 1.2 s) as the workhorse; treat Flash-class models as scarce (third-party measurements: ~20 requests/day/model on free tier); precompute + cache all LLM output into the repo so the demo never depends on live quota. Details §3 |
| **MEDIUM** | `ngrok` on PATH is a **broken `pyngrok` shim** (python.org 3.12 with no CA certs → `CERTIFICATE_VERIFY_FAILED`), no real ngrok binary, no authtoken | `which ngrok` → `/Library/Frameworks/Python.framework/Versions/3.12/bin/ngrok` | Don't rely on it. Phone testing: Vercel preview URLs (HTTPS, needed for PWA), or `brew install cloudflared && cloudflared tunnel --url http://localhost:3000` (no account), or LAN `next dev -H 0.0.0.0` |
| **MEDIUM** | Data-source bot protection: `api.bseindia.com` → **403 Akamai** for curl even with Referer/Origin; Yahoo chart → **429** for curl | §6 | Both solved by TLS impersonation: `curl_cffi` (`impersonate="chrome"`) → BSE 200 in 0.10 s; yfinance 1.8.0 (uses curl_cffi) → RELIANCE.NS history in 0.8 s. Expect the same blocks from Vercel IPs → ingest from the laptop, commit snapshots |
| **LOW** | `~/.cursor/mcp.json` embeds the **Tavily API key inline** in `args` | read-only inspection | Move to an env reference; make sure build-history exports are redacted (script in §9 does this) |
| **LOW** | Disk: 21 GB free at start, **19 GB** at end of audit (pnpm store +392 MB, other agents working) | `df -h` | Budget: one `node_modules` (~460 MB hardlinked), one `.venv` (~375 MB). No Docker (daemon not running anyway), no Playwright browsers unless needed |
| **INFO** | Python 3.14 is **not** a blocker for our package set (all 11 packages install + import on 3.14.4), but pin 3.12 anyway | §4 | `uv venv --python 3.12` (uv-managed 3.12.9 is already downloaded) |

What works out of the box: Node 24 + pnpm 10 + `create-next-app` (Next 16.4.5 scaffold in 17.5 s, production build in 4.2 s), uv + Python 3.12/3.14 with every needed wheel cached, Gemini key (61 models listed; `gemini-3.5-flash-lite` answers in ~1.2 s), Ollama running locally (`gemma3:4b`, `llama3.2`), git configured, screener.in / NSE API / NSE archives / BSE homepage all reachable with sub-250 ms latency.

---

## 1. Toolchain versions

| Tool | Version / state | Notes |
|---|---|---|
| macOS | 26.3.1 (arm64, 18 GB RAM) | |
| node | **v24.9.0** | |
| pnpm | **10.17.1** | store: `~/Library/pnpm/store/v10` (3.16 GB → 3.55 GB after Next probe) |
| bun | 1.2.4 | old (Feb 2025); fine as a script runner, don't make it a dependency |
| npm | 11.6.2 | |
| python3 (`which`) | **3.14.4** → `/opt/homebrew/bin/python3` | HTTPS works (certs OK) |
| python3.12 (`which`) | → `/opt/homebrew/bin/python3.12` (3.12.11) | OK |
| python (`which`) | → `~/miniconda3/bin/python` (3.12.7) | conda base leaks onto PATH; don't use bare `python` |
| python.org 3.12.5 | `/Library/Frameworks/Python.framework/Versions/3.12` (also `/usr/local/bin/python3`) | **SSL broken** (`CERTIFICATE_VERIFY_FAILED`): `Install Certificates.command` never run. This is what hosts the broken `ngrok` shim |
| uv | **0.6.3** (Feb 2025) | old but works. `uv python list`: 3.14.4 (brew), 3.13.2 (uv-managed), **3.12.9 (uv-managed)**, 3.12.11 (brew), 3.12.7 (conda), 3.12.5 (python.org), 3.11.13 (brew), 3.9.6 (CLT); downloads available for 3.8–3.14 incl. free-threaded. `uv venv --python 3.12` selected 3.12.9 (managed) in 0.04 s. `uv python find 3.12` → miniconda (inconsistent) → set `UV_PYTHON_PREFERENCE=only-managed` in the Makefile |
| uv cache | `~/.cache/uv` = 2.4 GB | already contains all wheels we need |
| git | 2.53.0; `user.name=Ansh Singh`, `user.email=ansh.singh.160305@gmail.com`, `init.defaultbranch=main`, git-lfs filters configured, `credential.helper=osxkeychain` (from `/opt/homebrew/etc/gitconfig`) | |
| gh | **not installed** | `brew install gh` if we want PR/issue tooling |
| docker | CLI 27.4.0, buildx, compose; **daemon not running** (`Cannot connect to the Docker daemon`) | Not needed; keep it off (RAM) |
| vercel | CLI 48.6.7, **not logged in** | |
| ngrok | **broken pyngrok shim**; no `~/Library/Application Support/ngrok/ngrok.yml` → no authtoken | |
| ollama | 0.12.6, **running** (`Ollama.app` → `ollama serve`, `localhost:11434` → 200 in 1 ms); models `gemma3:4b` (3.3 GB, 20 months old), `llama3.2` (2.0 GB) | local fallback for bulk classification |
| pdftotext | poppler 26.08.0 | |
| make / just | `/usr/bin/make` present; `just` absent | → Makefile |
| jq / rg | 1.7.1 / ripgrep 15.2.0 | |
| Other deploy/tunnel CLIs | **none**: cloudflared, tailscale, fly, railway, wrangler, netlify, supabase, eas, expo | |

### 1.1 Auth & credentials (names only)

| Credential | State | Evidence |
|---|---|---|
| `GEMINI_API_KEY` (env) | present (`AIza…`), valid | models.list 200; see §3 |
| GitHub HTTPS | **works**: keychain holds a fine-grained PAT (`gith…`) for login `ansh200516` (plan: free) | `GET /user` 200 (7.0 s), `GET /user/repos?affiliation=owner` → 64 repos (18 s — api.github.com is slow from here) |
| GitHub SSH | **fails**: `Permission denied (publickey)`; keys on disk: `id_ed25519`, `id_ed25519_iitdhpc`, `copybot`, `google_compute_engine`; agent empty; `~/.ssh/config` has no `github.com` stanza | `ssh -T git@github.com` |
| Vercel | not logged in | `auth.json` = `{}` |
| ngrok | no config | |
| Tavily | key present in `~/.cursor/mcp.json` (inline) and available to agents as an MCP tool | |

---

## 2. Cursor configuration (read-only)

- `~/.cursor/mcp.json`: two servers — `tavily-mcp` (via `npx tavily-mcp@0.1.3`, **API key hard-coded inline in `args`** — leak risk if this file is ever shared; prefer `"env": {"TAVILY_API_KEY": "…"}` or an env reference) and `Playwright` (`@playwright/mcp@latest`).
- `~/Library/Application Support/Cursor/User/settings.json`: only `cursor.composer.usageSummaryDisplay: "always"` of relevance. No `~/.cursor/hooks.json`. No `~/.cursor/agents` entries. User skills: `~/.cursor/skills/frontend-design`; built-in skills under `~/.cursor/skills-cursor/`.
- The repo has **no** `.cursor/` folder, no `AGENTS.md`. Recommend adding both (§8.6) — Next 16's `next dev` auto-generates an `AGENTS.md` block that tells agents to read `node_modules/next/dist/docs/` because "This is NOT the Next.js you know".
- Chat storage locations verified in §9.

---

## 3. Gemini API

### 3.1 Key validation
`GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=200` with header `x-goog-api-key` → **HTTP 200 in 0.55 s**, 61 models, no `nextPageToken`. No rate-limit headers are returned by this API (only `server-timing`).

### 3.2 Model list (as returned by the API, 8 Nov 2026)

Token limits are `inputTokenLimit` / `outputTokenLimit`. "Free?" is our verification state for *this* key: **V** = verified by us, **R** = reported by third parties (Sep–Oct 2026, unverified here), **—** = unknown.

**Text generation (`generateContent`, all also `countTokens`; CC = `createCachedContent`, B = `batchGenerateContent`)**

| Model | In / Out tokens | Extras | Free? |
|---|---|---|---|
| `gemini-3.5-flash-lite` | 1,048,576 / 65,536 | CC, B | **V yes** — 200, 1.2 s |
| `gemini-3.1-flash-lite`, `gemini-3.1-flash-lite-preview` | 1,048,576 / 65,536 | CC, B | R yes (~15 RPM / 500 RPD) |
| `gemini-flash-lite-latest` (alias) | 1,048,576 / 65,536 | CC, B | R yes |
| `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash` | 1,048,576 / 65,536 | CC, B | R yes but tiny (~5 RPM / **20 RPD** per model); 3.7 reported very slow (27–148 s) |
| `gemini-3-flash-preview` | 1,048,576 / 65,536 | CC, B | R yes (~20 RPD) |
| `gemini-flash-latest` (alias) | 1,048,576 / 65,536 | CC, B | R yes |
| `gemini-3.1-pro-preview` | 1,048,576 / 65,536 | CC, B | **V no** — 429 free-tier `limit 0` |
| `gemini-3.1-pro-preview-customtools`, `gemini-pro-latest` | 1,048,576 / 65,536 | CC, B | R no (paid) |
| `gemini-4-argon` | 1,048,576 / 32,768 | B | R no (paid) |
| `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite` | 1,048,576 / 65,536 | CC, B | **V no** — 404 "no longer available to new users" |
| `gemma-4-26b-a4b-it`, `gemma-4-31b-it` | 262,144 / 32,768 | — | R yes (free, limits unknown) |
| `antigravity-preview-05-2026`, `-09-2026`, `-latest` | 1,048,576 / 65,536 | — | — |
| `deep-research-preview-04-2026`, `deep-research-max-preview-04-2026`, `deep-research-pro-preview-12-2025` | 131,072 / 65,536 | — | R no (Interactions API / paid) |
| `gemini-robotics-er-2-preview` | 131,072 / 65,536 | CC, B | — |
| `gemini-2.5-computer-use-preview-10-2025` | 131,072 / 65,536 | — | R no |

**Image / audio / music / live (not needed for FINN unless we do voice)**

| Group | Models | In / Out |
|---|---|---|
| Image gen | `gemini-2.5-flash-image` (32,768/32,768); `gemini-3-pro-image[-preview]`, `nano-banana-pro-preview` (131,072/32,768); `gemini-3.1-flash-image[-preview]`, `gemini-3.1-flash-lite-image`, `gemini-nano-banana-2.1` (65,536/65,536) | R: paid only |
| TTS | `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`, `gemini-3.1-flash-tts-preview`, `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts` | 8,192 / 16,384 |
| Omni / transcribe | `gemini-omni-flash-preview`, `gemini-omni-1.1-flash`, `gemini-omni-1.2-flash` (131,072/65,536); `gemini-3.5-transcribe` (98,304/32,768) | R: omni paid |
| Live (`bidiGenerateContent`) | `gemini-3.5-transcribe-live`, `gemini-2.5-flash-native-audio-latest`/`-preview-09-2025`/`-preview-12-2025` (131,072/8,192), `gemini-3.1-flash-live-preview`, `gemini-3.8-live`, `gemini-3.8-live-extended-thinking`, `gemini-robotics-er-2-streaming-preview`, `gemini-3.5-live-translate-preview` (16,384/32,768) | |
| Music | `lyria-3-clip-preview`, `lyria-3-pro-preview`, `lyria-3.5`, `lyria-realtime-exp` | R: paid |
| Embeddings (`embedContent`) | `gemini-embedding-001` (2,048 in), `gemini-embedding-2-preview`, **`gemini-embedding-2`** (8,192 in) | R yes (~100 RPM / 1,000 RPD) |
| Other | `aqa` (`generateAnswer`, 7,168/1,024) | |

### 3.3 Probe calls (exactly what ran)

| Call | Result |
|---|---|
| `POST …/v1beta/models/gemini-2.5-flash-lite:generateContent` ("Reply with exactly the word: pong", `maxOutputTokens: 8`) | **404 NOT_FOUND** in 0.99 s: *"This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite … We recommend you to use the Interactions API."* |
| `POST …/v1beta/models/gemini-3.5-flash-lite:generateContent` (same body) | **200** in **1.20 s** (TTFB 1.196 s, `server-timing dur=1157`), text `"pong"`, `finishReason: STOP`, `usageMetadata: {promptTokenCount: 7, candidatesTokenCount: 1, totalTokenCount: 8, serviceTier: "standard"}`, `modelVersion: gemini-3.5-flash-lite` |
| `POST …/v1beta/models/gemini-3.1-pro-preview:generateContent` (tier probe) | **429 RESOURCE_EXHAUSTED** in 1.0 s with `QuotaFailure` violations: `GenerateContentInputTokensPerModelPerDay-FreeTier`, `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, `GenerateContentInputTokensPerModelPerMinute-FreeTier` (model `gemini-3.1-pro`, location `global`), description "*…limit exceeded on Free Tier*", `RetryInfo.retryDelay: 72170s` (≈ next midnight Pacific = ~13:30 IST). No `quotaValue` field was present → effectively limit 0 |
| `POST …/v1beta/models/<14 models>:countTokens` | **404 with empty body for every model** (2.5-flash, 2.5-pro, 2.5-flash-lite, 3-flash-preview, 3.1-pro-preview, 3.1-flash-lite, 3.5-flash, 3.5-flash-lite, 3.8-flash, 4-argon, flash-latest, flash-lite-latest, pro-latest, gemma-4-31b-it) |
| `POST …/v1/models/gemini-3.5-flash-lite:countTokens` | **200** in 0.50 s (`totalTokens: 2`) → `countTokens` works on `v1`, not `v1beta`, for this key/date. Don't use countTokens for accessibility probing; read `usageMetadata` instead |

### 3.4 Free tier — how to tell, and what it means

- **Definitive signal**: a 429 whose `error.details[].violations[].quotaId` ends in `-FreeTier` (ours does). Paid projects show `…-PaidTier` IDs / `generate_content_paid_tier_*` metrics. `usageMetadata.serviceTier: "standard"` is *not* a billing-tier signal (it's standard vs flex/priority processing).
- Google no longer publishes per-model free RPM/RPD; the only official numbers are at **https://aistudio.google.com/rate-limit** (login required — the user should screenshot this into `docs/research/`). Limits are **per Google Cloud project per model**, not per key; daily counters reset at midnight Pacific (~13:30 IST during US standard time).
- Third-party measurements (aiplug.work 2 Sep 2026, binmage.com 27 Oct 2026, naveencreation/gemini-free-tier-limits; **unverified for our project**): Flash-Lite ≈ 15 RPM / 500 RPD; Flash (3.5/3.6/3.7/3-preview) ≈ 5 RPM / **20 RPD**; embedding-2 ≈ 100 RPM / 1,000 RPD; Pro and image/video/music = 0 on free tier; free Google-Search grounding only existed on 2.5 Flash models, which new keys can't reach → **no free grounding** (relevant for management-change bios → use Tavily/Wikipedia instead).
- Failed requests (400/500) still count against limits.

**Implications for FINN (strong recommendation):**
1. Workhorse = `gemini-3.5-flash-lite` (1M context, 64K output, context caching, batch). Everything bulk — announcement classification, one-liners, PDF table extraction, transcript chunk summaries — goes here.
2. A Flash-class model (`gemini-3.5-flash` or `3.8-flash`; have agent 06 verify each with one call) only for the few reasoning-heavy outputs (guidance-vs-delivery, bull/bear), **precomputed offline** for the demo set. Since quota is per *model*, the 4–5 Flash models each carry their own daily budget — a legitimate routing trick, but treat ~20/day/model as the planning number until AI Studio says otherwise.
3. **Never call Gemini at demo/request time for anything the seed data already covers.** Cache every LLM output in the repo keyed by `(model, prompt_hash, source_hash)`; the deployed app reads the cache first. Live calls only for "point it at a company we didn't pick" — and even that path should degrade gracefully (show extracted tables without LLM prose if 429).
4. Fallbacks: Ollama `gemma3:4b` locally for bulk classification if quota dies mid-build; `gemma-4-*` via API if free; or enable billing (Tier 1) — Flash-Lite pricing has historically been ~$0.10/M input, so the entire build would cost a few dollars. This is the coordinator's call; the brief rewards efficiency, not zero spend.
5. Use the `v1beta` path for generation; use `v1` for `countTokens` if ever needed.

---

## 4. Python compatibility: 3.12 vs 3.14

Both venvs created with uv; same install set: `yfinance pymupdf pdfplumber requests beautifulsoup4 lxml pandas httpx fastapi`.

| | uv-managed CPython **3.12.9** | Homebrew CPython **3.14.4** |
|---|---|---|
| `uv venv` | 0.04 s | 0.01 s |
| `uv pip install …` | **0.34 s** (49 packages resolved 126 ms; all wheels cached) | **3.1 s** (49 packages; downloaded cp314 wheels: onnxruntime 19.9 MiB, lxml 8.2, numpy 5.2, pillow 4.6, pydantic-core 2.0) |
| Result | all 49 installed, exit 0 | all 49 installed, exit 0 |
| Imports (11 modules) | all OK | all OK |
| venv size | 374 MB | 377 MB |
| HTTPS from venv Python | OK | OK |

Resolved versions (identical on both): yfinance **1.8.0**, pymupdf **2.1** (+ pymupdf-layout, pymupdf4llm 2.1), pdfplumber 0.11.10 (pdfminer-six 20260107, pypdfium2 5.15.1), requests 2.34.2, beautifulsoup4 4.15.0, lxml 6.1.3, pandas **3.1.1**, numpy 2.5.4, httpx 0.28.1, fastapi 0.162.2 (starlette 1.10.0), pydantic 2.14.3, **curl_cffi 0.17.0** (pulled in by yfinance), onnxruntime 1.31.1 (pulled in by pymupdf-layout — 20 MiB we may not need), peewee, websockets, protobuf.

Timings worth knowing:
- **Cold import of yfinance: 20.7 s (3.12) / 11.3 s (3.14)** — first-run bytecode compilation of its large dependency tree; warm import 0.4 s. Irrelevant if Python only runs offline; a real cost if anyone puts Python on a serverless path.
- yfinance live: `Ticker("RELIANCE.NS").history(period="5d")` → 6 rows in **0.80 s**; `download(["TCS.NS","INFY.NS","HDFCBANK.BO"], period="5d")` → shape (6, 15) in **0.74 s**. (Plain curl to the same Yahoo endpoint is 429 — yfinance's Chrome TLS impersonation + crumb is what makes it work.)
- Observation for the anomaly detector: the data includes **Sun 8 Nov 2026** with volume 4.17 M vs ~20 M on normal days — a Muhurat (Diwali) special session. Special/short sessions will trip naive "volume vs 20-day average" rules in the *downward* direction and distort the average; exclude or flag sessions by exchange calendar.

**Verdict**: Python 3.14 works for this stack today, so the "3.14 risk" is retired for these packages. Still pin **3.12** (`.python-version`) for the widest wheel coverage if we add anything heavier (torch, sentence-transformers, polars…). Bigger hidden risk: **pandas 3.x** (copy-on-write + string dtype defaults) differs from what most agents were trained on — expect subtle breakage in agent-written pandas code; keep ingestion pandas-light or pin `pandas<3` if yfinance allows.

---

## 5. Node ecosystem probe

`CI=1 pnpm create next-app@latest finn-probe --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes --disable-git --no-agent-feedback` (ran in `/tmp/finn-exec`, deleted afterwards).

| Metric | Value |
|---|---|
| `pnpm dlx create-next-app@latest --help` | 1.5 s (flags of note: `--react-compiler`, `--cache-components`, `--biome`/`--eslint`, `--rspack`, `--api`, `--empty`, `--agents-md` (default on), `--disable-git`, `--skip-install`, `--yes`) |
| Scaffold + install | **17.5 s** wall; 354 packages (resolved 426, 191 reused from store, 165 downloaded) |
| Versions | **next 16.4.5**, react 19.3.0, react-dom 19.3.0, **tailwindcss 4.3.5** + `@tailwindcss/turbopack`, typescript 5.9.3 (7.0.2 exists), eslint 9.39.5 (**flagged deprecated**, 10.x exists), eslint-config-next 16.4.5, @types/node 20 |
| `node_modules` | 460 MB apparent (hardlinks into the pnpm store; store grew 392 MB) |
| `pnpm build` | **4.2 s** wall (Turbopack; "Compiled successfully in 1667 ms", TypeScript 906 ms, 4 static pages); `.next` = 30 MB |
| Generated config | `next.config.ts` has **`cacheComponents: true`, `partialPrefetching: true`** by default, Tailwind wired as a Turbopack CSS loader; `pnpm-workspace.yaml` with `ignoredBuiltDependencies: [sharp, unrs-resolver]`; `AGENTS.md` auto-inserted ("This is NOT the Next.js you know… read `node_modules/next/dist/docs/`") |
| Scripts | `dev: next dev`, `build: next build`, `start: next start`, `lint: eslint` |
| Disk after cleanup | 19 GB free |

Risks/decisions:
- **Cache Components on by default** changes data-fetching semantics (dynamic data must sit under Suspense or `use cache`; uncached `fetch`/`cookies()` outside boundaries fails the build). For a 7-day prototype full of dynamic, data-driven screens I recommend **setting `cacheComponents: false`** unless the implementing agent has read `node_modules/next/dist/docs/` first. Either way, keep the generated `AGENTS.md` block committed — it's the single best guard against agents writing Next-14-era code.
- ESLint 9 is already deprecated in this scaffold → choose `--biome` (faster, no config churn) or accept the warning. Linting is not graded; don't spend time here.
- React 19.3 + Tailwind 4 are what agents will generate against; Tailwind 4 has no `tailwind.config.js` by default (CSS-first `@theme`) — tell design/implementation agents explicitly.
- `pnpm` is the right choice on this disk (content-addressed store; worktrees share it).

---

## 6. Network reachability & latency (2 samples each unless noted; from the build machine, residential IP)

| Host / request | HTTP | total (s) | Notes |
|---|---|---|---|
| `query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d` (Chrome UA + Accept) | **429** | 0.50 / 0.53 | 19-byte body; bare curl also 429 (0.34 s). **yfinance 1.8.0 → 200 in 0.8 s** (curl_cffi impersonation + crumb). Don't hand-roll Yahoo |
| `www.bseindia.com/` | 200 | 0.05 / 0.05 | 16.9 KB |
| `api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?…` (UA + Referer + Origin + Accept) | **403** | 0.04 / 0.04 | Akamai "Access Denied" (`errors.edgesuite.net` reference). Same with Referer-only |
| same URL via **`curl_cffi` `impersonate="chrome"`** | **200** | 0.10 | body `"No Record Found!"` for the Sunday window — the block is TLS-fingerprint based, not header based. Plain `curl_cffi` with Chrome UA string but no impersonation → 403 |
| `www.screener.in/` | 200 | 0.16 / 0.15 | 50 KB |
| `www.screener.in/company/RELIANCE/consolidated/` | 200 | 0.22 / 0.21 | 271 KB HTML, no block |
| `www.nseindia.com/` full browser headers incl. `Sec-Fetch-*` + `--compressed` | 200 | 0.10 | **0-byte body**; Akamai cookies `bm_sz`, `_abck` set |
| `www.nseindia.com/` minimal headers (UA, Accept, Accept-Language) | **403** | 0.05 | |
| `www.nseindia.com/api/corporate-announcements?index=equities` — **UA + `Accept: application/json`, no cookies** | **200** | 0.07–0.12 | **29,150-byte JSON array (20 items)**; keys: `an_dt, attFileSize, attchmntFile, attchmntText, bflag, csvName, desc, difference, dt, exchdisstime, fileSize, hasXbrl, old_new, orgid, seq_id, smIndustry, sm_isin, sm_name, sort_date, symbol, voiceSummary, voiceUrl`; first item `AUTOIND / Copy of Newspaper Publication / 08-Nov-2026 17:13:13 / https://nsearchives.nseindia.com/corporate/AUTOIND_…pdf` |
| same API with the cookie jar from the full-header handshake | 200 | 0.08 | **0-byte body** (twice) — Akamai soft-block; more "browser-like" headers made it *worse* |
| same API with empty jar + Referer | 200 | 0.11 | 7.7 KB gzip → 20-item array |
| `nsearchives.nseindia.com/content/equities/EQUITY_L.csv` | 200 | 0.08 / 0.07 | 186 KB full file (Range ignored) |
| `generativelanguage.googleapis.com/` | 404 (expected) | 0.10 / 0.41 | TLS ≈ 25 ms; models.list 0.55 s; generateContent 1.2 s |
| `api.github.com/user` | 200 | **7.0** | slow API path; `/user/repos` 18 s |
| `github.com:22` (ssh) | denied | 1.7 | publickey |

Takeaways: (a) every Indian source answers in <250 ms from here; (b) bot protection is TLS-fingerprint based on Yahoo and BSE and header-heuristic (inconsistent) on NSE — **use `curl_cffi` for all three**, keep headers minimal, add jittered retries, and expect **datacenter IPs (Vercel) to be blocked** — the ingestion must run from the laptop and ship snapshots into the repo (see §8); (c) NSE attachments live on `nsearchives.nseindia.com`, which is a plain CDN (no block seen) — PDF fetches are cheap; (d) the 0-byte-200 behaviour means **validate bodies (non-empty, parses as JSON) and never trust the status code alone**.

---

## 7. Where things stand for the four submission artefacts

| Artefact | Path to green | Risk |
|---|---|---|
| Deployed mobile link | Push repo to GitHub → import into Vercel dashboard (Hobby) → auto-deploys `main`; preview URLs per branch. Verify in the dashboard: function `maxDuration` (Fluid compute allows longer than the old 10 s default — confirm) and Hobby **cron frequency limits** (historically once/day) — agent 13's remit | Needs the user's one-time Vercel login in a browser |
| GitHub repo | `git remote add origin https://github.com/ansh200516/<repo>.git && git push -u origin main` using the keychain PAT | PAT may be repo-scoped → fix in GitHub settings or `gh auth login` |
| AI build history | §9 | Only risk is forgetting; automate it |
| Covering note | `docs/COVERING-NOTE.md` drafted alongside, pasted into the email | — |

---

## 8. Recommended repository layout & workflow

### 8.1 Layout (Next.js app at the repo root for zero-config Vercel; Python only offline)

```
enam/                              (rename GitHub repo to e.g. finn)
├── AGENTS.md                      # stack facts for agents (Next 16, Tailwind 4, pandas 3, model names, no-secrets rule) + Next's auto block
├── README.md                      # 60-second quickstart: pnpm i && pnpm dev; phone URL; what's seeded
├── package.json                   # scripts (below), engines: node >=24, packageManager: pnpm@10.17.1
├── pnpm-lock.yaml  pnpm-workspace.yaml  next.config.ts  tsconfig.json  eslint/biome config
├── .env.example  .gitignore  .python-version (3.12)  Makefile
├── src/
│   ├── app/                       # routes: /(today digest)  /alerts  /research/[symbol]  /settings  /api/*
│   ├── components/                # mobile-first UI primitives (dense cards, sheets, sparkline)
│   ├── lib/
│   │   ├── llm/                   # gemini client, model router (lite/flash), prompt files, cache (hash → data/cache)
│   │   ├── data/                  # typed loaders over /data snapshots; zod schemas shared with Python via JSON Schema
│   │   ├── scoring/               # announcement priority, anomaly rules (configurable thresholds)
│   │   └── format/                # INR crore/lakh, QoQ/YoY, dates in IST
│   └── styles/
├── public/manifest.webmanifest  public/icons/   # installable PWA
├── ingest/                        # Python 3.12 via uv — OFFLINE pipeline only
│   ├── pyproject.toml  uv.lock  README.md
│   └── finn_ingest/
│       ├── http.py                # curl_cffi session (impersonate=chrome), retries, body validation, on-disk cache
│       ├── prices.py              # yfinance EOD → data/prices/<SYMBOL>.json
│       ├── announcements.py       # NSE/BSE feeds → data/announcements/YYYY-MM-DD.json (+ attachment download to data/raw)
│       ├── documents.py           # screener.in → AR/concall PDF links → text (pymupdf) → data/docs/<SYMBOL>/
│       ├── extract.py             # Gemini calls (flash-lite) → structured JSON, cached by content hash
│       └── cli.py                 # `uv run finn-ingest prices|announcements|docs|all --since 2026-11-01`
├── data/                          # COMMITTED seed snapshots (small JSON, < ~30 MB total)
│   ├── portfolio.json             # 15–20 symbols w/ sector, exchange codes, screener slug
│   ├── prices/  announcements/  docs/<SYMBOL>/{text,chunks}.json  research/<SYMBOL>/*.json
│   └── cache/llm/<model>/<hash>.json   # memoised LLM outputs → demo never needs quota
├── data/raw/                      # PDFs etc. — GITIGNORED (regenerable)
├── scripts/
│   ├── export_build_history.py    # §9 (stdlib only)
│   ├── seed.sh                    # full offline refresh: ingest all → data/ → git commit -m "data: snapshot <date>"
│   └── phone.sh                   # prints LAN URL + QR for the dev server
└── docs/
    ├── challenge/  research/  decisions/ (ADR-style, 10 lines each)  build-history/  COVERING-NOTE.md
```

Move `problem statement/*.pdf` into `docs/challenge/` (spaces in a root folder name are a papercut for every shell command).

### 8.2 `.gitignore` (extend the existing one)

```
node_modules/  .next/  out/  dist/  .turbo/  .vercel/  coverage/
.env  .env.*  !.env.example
.venv/  __pycache__/  *.pyc  .pytest_cache/  .ruff_cache/
data/raw/  *.pdf  !docs/challenge/*.pdf
.DS_Store  *.log  /tmp/
```
(Keep `next-env.d.ts` ignored as create-next-app does. Do **not** use git-lfs — GitHub free LFS bandwidth is 1 GB/month and graders cloning would hit it; commit extracted text, not PDFs.)

### 8.3 `.env.example` (committed; real values in `.env.local`, which Next loads automatically)

```
# LLM
GEMINI_API_KEY=                      # https://aistudio.google.com/apikey (free tier is enough)
FINN_MODEL_FAST=gemini-3.5-flash-lite
FINN_MODEL_STRONG=gemini-3.5-flash   # scarce on free tier; used only for reasoning tasks
FINN_LLM_CACHE_ONLY=true             # demo mode: never call the API if a cached answer exists
# Optional enrichment
TAVILY_API_KEY=                      # management-change bios
# App
NEXT_PUBLIC_APP_NAME=FINN
FINN_DATA_DIR=./data
FINN_DEMO_DATE=                      # pin "today" for the digest window during demos (YYYY-MM-DD, IST); empty = real clock
CRON_SECRET=                         # protects /api/cron/* if we schedule anything server-side
```
Rule: every variable has a comment and a safe default; the app must boot with only `GEMINI_API_KEY` missing (cache-only mode). The Python side reads the same file (`uv run --env-file ../.env.local`).

### 8.4 Scripts / Makefile (one-liners agents and graders can run)

`package.json` scripts: `dev` (`next dev -H 0.0.0.0`), `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `check` (`lint && typecheck && build`), `seed` (`make seed`), `history` (`python3 scripts/export_build_history.py`).

```make
export UV_PYTHON_PREFERENCE=only-managed
.PHONY: setup dev check seed ingest-% history history-check phone clean
setup:          ## one-time: node deps + python venv
	pnpm install --frozen-lockfile
	cd ingest && uv venv --python 3.12 && uv sync
dev:            ## run app on LAN (phone on same Wi-Fi: http://<mac-ip>:3000)
	pnpm dev
check:          ## what CI/pre-push runs
	pnpm check
ingest-%:       ## ingest-prices | ingest-announcements | ingest-docs SYMBOL=RELIANCE
	cd ingest && uv run finn-ingest $* $(if $(SYMBOL),--symbol $(SYMBOL),) $(if $(SINCE),--since $(SINCE),)
seed: ingest-prices ingest-announcements ingest-docs   ## full offline refresh → data/
	git add data && git commit -m "data: snapshot $$(date +%F)" || true
history:        ## export Cursor transcripts → docs/build-history/
	python3 scripts/export_build_history.py
history-check:  ## fail if any secret-looking string is in docs/build-history
	python3 scripts/export_build_history.py --check-secrets
```

### 8.5 Demo reproducibility (the "demo that doesn't run" guard)
1. `git clone && pnpm install && pnpm dev` must show the full product **offline**, from committed `data/` + `data/cache/llm`. No Python, no API key required for the seeded portfolio. Test this on a clean clone before submission (`git clone . /tmp/finn-clean && cd /tmp/finn-clean && pnpm install && pnpm build`).
2. `FINN_DEMO_DATE` pins the "last 24 h" window to a day with interesting filings, with a visible "demo clock" chip so graders aren't misled.
3. Live paths (arbitrary ticker research, refresh) are additive and fail soft: show cached/extracted data first, LLM prose when available, an honest "quota exhausted — showing extracted tables" state otherwise.
4. Data refresh runs on the laptop (`make seed`, optionally via `launchd` at 19:00 IST on trading days) and ships as `data:` commits → Vercel redeploys. This sidesteps Vercel-IP blocking and Hobby cron limits entirely for the demo; keep a tiny `/api/cron/refresh` only if agent 08/13 proves it works from Vercel.
5. Pre-submission checklist lives in `docs/decisions/00-release-checklist.md`: clean-clone build, phone test on iOS Safari + Android Chrome, Lighthouse mobile, build-history export, secrets scan, README quickstart.

### 8.6 Conventions
- **Commits**: Conventional Commits, small and frequent: `feat(digest): …`, `fix(ingest): …`, `data: snapshot 2026-11-10`, `exp(voice): …` (experiments), `docs: …`, `chore: …`. Add a trailer linking the chat that produced the change — `AI-Session: f10ea618` (first 8 chars of the Cursor composer id; the export in §9 uses the same prefix) — so the build history is navigable from `git log`. Never commit `data/raw`, `.env.local`, or anything >5 MB.
- **Branches**: `main` = always deployable (Vercel production). Features/experiments on short-lived `exp/<topic>` or `feat/<topic>` branches, merged fast-forward; no long-lived divergence in a 7-day build.
- **Parallel agent experiments with worktrees**: `git worktree add ../finn-exp-<topic> -b exp/<topic>` → each agent gets an isolated checkout; `pnpm install` in each costs little disk (hardlinks into the shared store) but keep ≤3 worktrees live and prune (`git worktree remove`) when done. Cursor's own worktree-based agents (`isWorktree` is a field on its chat headers) work the same way. Vercel builds every pushed branch as a preview URL — free A/B of interaction concepts on a phone.
- **AGENTS.md / `.cursor/rules`**: stack versions (Next 16.4 w/ cacheComponents decision, React 19.3, Tailwind 4 CSS-first, pandas 3, yfinance 1.8, Python via `uv run` only), model names (`gemini-3.5-flash-lite` default; never `gemini-2.5-*`), "scratch outside the repo", "no secrets in code or chats", commit trailer rule, "run `pnpm check` before claiming done".
- **Definition of done for any screen**: works on a 390×844 viewport, from seed data, with no console errors, in `pnpm build`.

---

## 9. AI build-history capture plan (submission requirement)

### 9.1 What exists on this machine (verified)

**A. Per-project JSONL transcripts (simplest, already complete for agent-mode chats)**
`~/.cursor/projects/Users-anshsingh200516-enam/agent-transcripts/<composerId>/<composerId>.jsonl` plus `…/<composerId>/subagents/<subagentId>.jsonl`. Right now: 1 parent chat (`f10ea618…`, "ENAM AI Engineer challenge", 111 KB / 17 records so far) and 15 subagent files (30–56 KB each — the research agents, including this one). Files are appended live, one JSON object per line:

```json
{"role":"user","message":{"content":"<timestamp>Sunday, Nov 8, 2026, 5:09 PM (UTC+5:30)</timestamp>\n<user_query>…</user_query>"}}
{"role":"assistant","message":{"content":[{"type":"text","text":"…"},{"type":"tool_use","name":"Read","input":{"path":"…"}}]}}
{"type":"turn_ended","status":"success"}
```
Block types seen: `text`, `tool_use` (name + full input); **no `tool_result` blocks** (tool outputs are not stored here) and no per-record timestamps (only the `<timestamp>` tag inside user messages). Tool names in the parent chat so far: `CallDynamicTool` ×15, `Read` ×5, `Shell` ×4, `Write` ×3, `GetDynamicTools` ×2, `StrReplace` ×1.

**B. Cursor's SQLite store (complete, includes tool results and thinking)**
`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` — **7 GiB** here. Tables: `ItemTable`, `cursorDiskKV`, `composerHeaders`, `remoteAgentHeaders`.
- `composerHeaders(composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, recency, checkpointAt, value JSON, subagentTypeName)` — 408 rows; for this workspace (`workspaceId = f46586dfed4b9465287b8776f4c77863`, i.e. `workspaceStorage/<id>/workspace.json` → `file:///Users/anshsingh200516/enam`) there are 15 rows: the parent (name "ENAM AI Engineer challenge", `unifiedMode: multitask`) and 14 `general-purpose` subagents, with ms timestamps.
- `cursorDiskKV` keys: `bubbleId:<composerId>:<bubbleId>` (259 for the parent so far; JSON with `type` 1=user/2=assistant, `text`, `thinking`, `toolResults`, `createdAt` ISO, `capabilities`, …), `composerData:<id>`, `checkpointId:`, `ofsContent:`, `agentKv:blob:`, `codeBlockDiff:`, …
- Read it with `sqlite3 "file:…/state.vscdb?mode=ro"` (WAL mode; works read-only). Don't copy the 7 GiB file.

**C. Cursor UI**
- **Export Transcript** → right-click the chat tab (or `⋯` on the editor title bar) → saves a `.md` including tool calls *and results* (per Cursor forum staff, Apr 2026; not available for Cloud Agent chats).
- **Share link** → Share icon in chat header → Public → `cursor.com/s/<id>`; docs page says Teams/Enterprise only, a forum staff reply says Pro can share publicly. **Unverified for this account** — click Share once to find out. Best-effort secret redaction only; 50 shares/day.

### 9.2 Plan
1. Add `scripts/export_build_history.py` (draft below; stdlib only) and run `make history` at the end of every working session and before submission. Output: `docs/build-history/INDEX.md` + one Markdown file per chat/subagent, deterministic names (`2026-11-08_1705-f10ea618-enam-ai-engineer-challenge.md`, `…-sub-3ce4ce4e-….md`). Commit them — the repo *is* the build history.
2. Also run the richer **Export Transcript** manually for the 3–6 key chats (they include tool results) into `docs/build-history/exports/`, and try one **Share link**; list all links in `docs/build-history/README.md` and the covering email.
3. Any non-Cursor LLM use (ChatGPT/Claude web, AI Studio prompt tuning) → paste/export into `docs/build-history/other/` with date + purpose.
4. Hygiene: the script strips `/Users/anshsingh200516` → `~`, redacts secret patterns (`AIza…`, `tvly-…`, `github_pat_…`, `gh?_…`, `sk-…`, `Bearer …`, `KEY=value`), truncates tool inputs >1,500 chars with a count, and `--check-secrets` fails if anything slips. Review the diff before committing.
5. Make the history *legible* for graders: `INDEX.md` has a one-line purpose per chat, counts of turns/tool calls, and a short "how we worked" preamble (parallel research agents → synthesis → build in worktrees → nightly data snapshots). The covering note links to `INDEX.md`.

### 9.3 Draft script (not yet added to the repo)

```python
#!/usr/bin/env python3
"""Export Cursor agent transcripts for this project to docs/build-history/ as Markdown.

Sources
  1. ~/.cursor/projects/<slug>/agent-transcripts/**/*.jsonl   (parent chats + subagents; appended live)
  2. Cursor's SQLite store, composerHeaders table              (titles/timestamps only; read-only; optional)

Usage
  python3 scripts/export_build_history.py                 # export everything
  python3 scripts/export_build_history.py --check-secrets # scan output dir, exit 1 if anything secret-looking remains
Stdlib only. Never prints secret values.
"""
from __future__ import annotations
import argparse, datetime as dt, json, re, sqlite3, sys
from pathlib import Path

HOME = Path.home()
DEFAULT_SLUG = "Users-anshsingh200516-enam"   # ~/.cursor/projects/<slug>
CURSOR_DB = HOME / "Library/Application Support/Cursor/User/globalStorage/state.vscdb"

SECRET_PATTERNS = [
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),                       # Google API keys
    re.compile(r"tvly-[0-9A-Za-z_\-]{16,}"),                       # Tavily
    re.compile(r"github_pat_[0-9A-Za-z_]{40,}"),                   # GitHub fine-grained PAT
    re.compile(r"gh[pousr]_[0-9A-Za-z]{30,}"),                     # GitHub classic tokens
    re.compile(r"sk-[0-9A-Za-z_\-]{20,}"),                         # OpenAI/Anthropic-style
    re.compile(r"(?i)bearer\s+[0-9A-Za-z_\-.=]{20,}"),
    re.compile(r"(?i)\b(api[_-]?key|token|secret|password)\b\s*[=:]\s*['\"]?(?!\$)[0-9A-Za-z_\-.]{12,}"),
]

def redact(text: str) -> str:
    for pat in SECRET_PATTERNS:
        text = pat.sub(lambda m: m.group(0)[:4] + "…<redacted>", text)
    return text.replace(str(HOME), "~")

def slugify(s: str, n: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:n].rstrip("-") or "chat"

def load_headers() -> dict[str, dict]:
    """composerId -> {name, isSubagent, subagentType, createdAt, updatedAt}; {} if the DB is unavailable."""
    if not CURSOR_DB.exists():
        return {}
    try:
        con = sqlite3.connect(f"file:{CURSOR_DB}?mode=ro", uri=True, timeout=5)
        rows = con.execute("SELECT composerId,isSubagent,subagentTypeName,createdAt,lastUpdatedAt,value FROM composerHeaders").fetchall()
        con.close()
    except sqlite3.Error as e:
        print(f"warn: could not read Cursor DB ({e}); titles will be derived from prompts", file=sys.stderr)
        return {}
    out = {}
    for cid, is_sub, sub_type, created, updated, value in rows:
        try:
            v = json.loads(value or "{}")
        except json.JSONDecodeError:
            v = {}
        out[cid] = {"name": v.get("name") or "", "isSubagent": bool(is_sub), "subagentType": sub_type,
                    "createdAt": created, "updatedAt": updated}
    return out

def records(path: Path):
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue

def split_user(text: str) -> tuple[str | None, str]:
    ts = re.search(r"<timestamp>(.*?)</timestamp>", text, re.S)
    uq = re.search(r"<user_query>(.*?)</user_query>", text, re.S)
    return (ts.group(1).strip() if ts else None), (uq.group(1).strip() if uq else text.strip())

def tool_summary(name: str, inp: dict) -> str:
    for key in ("path", "command", "description", "pattern", "search_term", "current_step", "toolName", "query"):
        if isinstance(inp.get(key), str) and inp[key].strip():
            return "— " + inp[key].strip().splitlines()[0][:100]
    return ""

def render(path: Path, meta: dict, max_tool_chars: int) -> tuple[str, dict]:
    lines, stats = [], {"turns": 0, "tools": 0, "by_tool": {}, "first_prompt": "", "first_ts": None}
    for rec in records(path):
        if rec.get("type") == "turn_ended":
            lines.append("\n---\n")
            continue
        role, content = rec.get("role"), (rec.get("message") or {}).get("content")
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else (content or [])
        for b in blocks:
            if b.get("type") == "text" and role == "user":
                ts, body = split_user(b.get("text", ""))
                stats["turns"] += 1
                stats["first_prompt"] = stats["first_prompt"] or body.splitlines()[0][:120]
                stats["first_ts"] = stats["first_ts"] or ts
                lines.append(f"\n## User{' — ' + ts if ts else ''}\n\n{redact(body)}\n")
            elif b.get("type") == "text":
                t = (b.get("text") or "").strip()
                if t:
                    lines.append(f"\n**Agent:** {redact(t)}\n")
            elif b.get("type") == "tool_use":
                name, inp = b.get("name", "?"), b.get("input")
                if not isinstance(inp, dict):          # some tools record a bare string/list input
                    inp = {"input": inp}
                stats["tools"] += 1
                stats["by_tool"][name] = stats["by_tool"].get(name, 0) + 1
                dumped = json.dumps(inp, ensure_ascii=False, indent=2)
                if len(dumped) > max_tool_chars:
                    dumped = dumped[:max_tool_chars] + f"\n… (+{len(dumped) - max_tool_chars} chars truncated)"
                lines.append(f"\n<details><summary><code>{name}</code> {redact(tool_summary(name, inp))}</summary>\n\n"
                             f"```json\n{redact(dumped)}\n```\n\n</details>\n")
            elif b.get("type") == "tool_result":   # not present in current Cursor builds, kept for forward-compat
                body = json.dumps(b.get("content"), ensure_ascii=False)[:max_tool_chars]
                lines.append(f"\n<details><summary>tool result</summary>\n\n```\n{redact(body)}\n```\n\n</details>\n")
    title = meta.get("name") or stats["first_prompt"] or path.stem
    kind = f"subagent ({meta.get('subagentType') or 'unknown'})" if meta.get("isSubagent") else "chat"
    created = dt.datetime.fromtimestamp(meta["createdAt"] / 1000).astimezone().strftime("%Y-%m-%d %H:%M %Z") if meta.get("createdAt") else (stats["first_ts"] or "unknown")
    head = [f"# {redact(title)}", "", f"- Type: {kind}", f"- Cursor composer id: `{path.stem}`", f"- Started: {created}",
            f"- Turns: {stats['turns']} · Tool calls: {stats['tools']} · Tools: " + ", ".join(f"{k}×{v}" for k, v in sorted(stats["by_tool"].items(), key=lambda kv: -kv[1])),
            f"- Source: `{redact(str(path))}` (tool outputs are not stored in this source)", ""]
    return "\n".join(head + lines), {**stats, "title": title, "kind": kind, "created": created}

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default=DEFAULT_SLUG)
    ap.add_argument("--out", default="docs/build-history")
    ap.add_argument("--max-tool-chars", type=int, default=1500)
    ap.add_argument("--check-secrets", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)

    if a.check_secrets:
        bad = [(p, pat.pattern) for p in out.rglob("*.md") for pat in SECRET_PATTERNS if pat.search(p.read_text(encoding="utf-8"))]
        for p, pat in bad:
            print(f"SECRET-LIKE CONTENT: {p} matches /{pat}/")
        return 1 if bad else 0

    src = HOME / ".cursor/projects" / a.slug / "agent-transcripts"
    files = sorted(src.rglob("*.jsonl"))
    if not files:
        print(f"no transcripts under {src}", file=sys.stderr)
        return 1
    headers = load_headers()
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for f in files:
        meta = headers.get(f.stem, {})
        parent = f.parents[1].name if f.parent.name == "subagents" else f.stem
        md, st = render(f, meta, a.max_tool_chars)
        when = dt.datetime.fromtimestamp(meta["createdAt"] / 1000).strftime("%Y-%m-%d_%H%M") if meta.get("createdAt") else "0000-00-00_0000"
        name = f"{when}-{parent[:8]}" + (f"-sub-{f.stem[:8]}" if parent != f.stem else "") + f"-{slugify(st['title'])}.md"
        (out / name).write_text(md, encoding="utf-8")
        rows.append((when, st["kind"], st["title"], st["turns"], st["tools"], name))
    rows.sort()
    index = ["# AI build history (Cursor agent transcripts)", "",
             "Exported with `scripts/export_build_history.py` from Cursor's per-project transcripts. Secrets are redacted; tool *outputs* are not stored in this source — see `exports/` for Cursor's own 'Export Transcript' files which include them.", "",
             "| Started | Type | Chat | Turns | Tool calls | File |", "|---|---|---|---|---|---|"]
    index += [f"| {w.replace('_', ' ')} | {k} | {redact(t)[:80]} | {n} | {m} | [{fn}](./{fn}) |" for w, k, t, n, m, fn in rows]
    (out / "INDEX.md").write_text("\n".join(index) + "\n", encoding="utf-8")
    print(f"exported {len(rows)} transcripts → {out}/ (INDEX.md updated)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

**Dry-run (8 Nov, output to `/tmp`, deleted)**: exported all 15 current transcripts in 0.09 s with titles and timestamps resolved from `composerHeaders` (e.g. `2026-11-08_1705-f10ea618-enam-ai-engineer-challenge.md`, `…-sub-3de04bed-nse-bse-announcements-feed-research.md`); `INDEX.md` rendered; `--check-secrets` exit 0; a grep for the real Gemini key prefix found nothing.

Known limitations of the draft: subagent `createdAt` comes from the DB (JSONL has none) — without the DB, subagent files sort to the top as `0000-…`; the `turn_ended` marker is rendered as a rule; thinking blocks are not in the JSONL source. If we want tool results and thinking, extend `load_headers` into a `bubbleId:` reader (`type`, `text`, `thinking`, `toolResults`, `createdAt`) — ~40 more lines, but it means querying a 7 GiB DB; do it once at the end, not nightly.

---

## 10. Prioritised recommendations

1. **Today**: user runs `vercel login` (or connects GitHub in the Vercel dashboard) and creates the GitHub repo in the browser; then `git push` over HTTPS to confirm the PAT scope. These are the only two things an agent cannot do.
2. **Today**: user opens https://aistudio.google.com/rate-limit and records the real per-model free limits in `docs/research/` — it decides how much LLM work is feasible per day. Decide now whether to enable Tier 1 billing (a few dollars) as insurance; set a spend cap if so.
3. **Scaffold** with `pnpm create next-app@latest . --ts --tailwind --app --src-dir --import-alias "@/*" --use-pnpm --biome --disable-git`, set `cacheComponents: false` (unless agent 08 argues otherwise), commit the generated `AGENTS.md`, add `.env.example`, Makefile, `.python-version`, extended `.gitignore` as in §8.
4. **Ingestion** in Python 3.12 via uv, with `curl_cffi` (`impersonate="chrome"`) as the one HTTP client for Yahoo/NSE/BSE, body validation (non-empty + parseable), on-disk cache; outputs are small JSON snapshots committed under `data/`. Runs on the laptop, never on Vercel.
5. **LLM layer**: `gemini-3.5-flash-lite` everywhere by default; a Flash model only for 2–3 reasoning outputs per company, precomputed; every call memoised into `data/cache/llm`; cache-only mode for the deployed demo; Ollama `gemma3:4b` as emergency fallback for bulk classification.
6. **Build-history**: add the §9 script in the first commit, run it at every session end; do Export Transcript + Share-link attempt before submission.
7. **Disk discipline**: ≤3 worktrees, one venv, no Docker, no Playwright browsers unless the browser-use agent needs them; re-check `df -h` daily (19 GB free now).
8. Fix small traps: move `problem statement/` PDFs into `docs/challenge/`; never invoke bare `python`/`ngrok`; move the Tavily key in `~/.cursor/mcp.json` to an env reference.

## 11. Assumptions other agents should challenge

- That Vercel Hobby is the right host (vs. Cloudflare Pages/Workers, which has no CLI installed here but may have better cron/edge semantics) — agent 13.
- That Vercel/datacenter IPs are blocked by NSE/BSE/Yahoo (strongly suspected from Akamai behaviour, **not tested** from a datacenter) — agent 05 could test from a free CI runner (GitHub Actions) in one job.
- That free-tier Flash is ~20 RPD/model — a third-party number; our own AI Studio page is the truth.
- That keeping Python entirely offline is acceptable — if the "any NSE ticker on demand" path needs PDF parsing at request time, either Gemini must read PDFs directly (it accepts PDF inline/Files API; verify size limits and free-tier TPM) or a Python function must run on Vercel (cold start + yfinance import 11–20 s would be fatal; pymupdf alone is fine).
- That `cacheComponents: false` is the safer default — an agent who has read Next 16's docs may prefer `use cache` for the digest pages.
- That the JSONL transcripts capture everything graders care about — they lack tool outputs; the SQLite bubbles have them if we decide that matters.
- That pandas 3.x will not bite — unverified beyond import.
