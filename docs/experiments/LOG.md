# Experiment & decision log

Running history of what was improved, why, how it was tested, and what was kept or rejected. Newest entries at the bottom. Every material change to product concept, UX, data, algorithms, implementation, performance or reliability gets an entry.

Entry template:

```
## EXP-NNN — <short title>            (date)
Improving:     <what capability / quality>
Limitation:    <the concrete weakness observed before>
Hypothesis:    <proposed approach and why it should help>
Experiment:    <what was actually run / built / measured>
Result:        <objective evidence: numbers, pass/fail, screenshots, timings>
Decision:      KEEP | REJECT | PARTIAL — <reason>
Rejected alts: <alternatives considered and why not>
```

---

## EXP-000 — Research phase kickoff            (2026-11-08)
Improving:     Problem understanding before any implementation.
Limitation:    Empty repository; no verified knowledge of data-source reliability, model availability, or what graders value.
Hypothesis:    A broad, independent, parallel investigation (14 specialised agents) will surface non-obvious opportunities and de-risk the plumbing (NSE/BSE access, PDF extraction) before architecture is chosen.
Experiment:    Launched agents 01–14 (see `docs/research/README.md`). Each must test empirically and report evidence, limits and assumptions to challenge.
Result:        14 reports delivered (docs/research/01–14). Coordinator independently re-verified: Gemini model availability and free-tier quotas (Flash 20 RPD, Flash-Lite 500 RPD, Pro 0); NSE announcements API open to plain clients and to a datacenter vantage; BSE API TLS-fingerprinted; NSE UDiFF bhavcopy; NSE Integrated-Filing XBRL parses to exact headline numbers (RIL Q2 FY27); NSE 2026 holiday calendar (10 Nov holiday, Muhurat session 8 Nov).
Decision:      KEEP — synthesis in `docs/research/20-synthesis-and-decision.md`.

## EXP-001 — Product concept and architecture decision            (2026-11-08)
Improving:     Direction of the whole build.
Limitation:    Conventional interpretation (chat app + summariser + yfinance) is what most submissions will be (09); competes on latency in a crowded Indian filings-alert market (03).
Hypothesis:    "A brief that remembers what management promised": finite twice-daily brief (collapsed routine, computed QoQ/YoY, filing-sourced bios) + promise ledger settled against exchange XBRL + user-written tripwires. All-TypeScript Next.js monolith, precomputed and cached, XBRL-first results engine, Flash-Lite bulk / Flash synthesis routing under measured quotas.
Experiment:    Cross-agent convergence check (01, 03, 07, 10 independently proposed brief + ledger); feasibility evidence from live prototypes (XBRL exact 5/5 companies; guidance quotes 9/9 and 71/75→100% after gate; bios 9/9; classification 96–98%).
Result:        Feasible within free tier: ~40 Flash-Lite calls per first-time company research, <25 calls/day for 20-stock Push (06).
Decision:      KEEP — proceed to build. Gate: guidance precision ≥ ~90% on ad-hoc set by Thu 12 Nov, else ledger degrades to quoted prose.
Rejected alts: Python engine on Vercel/hosted worker (no free always-on host; dual runtime); Expo/TestFlight ($99 + review; friction for graders); chat as home screen (template the brief warns against); vector DB (structured extraction + fact store suffice); PDF-first results parsing (scanned OCR layers; XBRL is exact and free); Gemma 4 API as load-bearing (500s on real prompts).
