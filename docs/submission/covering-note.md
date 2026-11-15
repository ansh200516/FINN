To: assessment@enam.com
Subject: IIT Delhi – AI Engineer - 2027

FINN is a brief that remembers what management promised. The home screen is that brief. https://finn-gray.vercel.app opens it: `/` replaces itself with `/brief`, and Chat, Companies, Alerts, and Inbox are the other tabs.

The brief is an evening edition. It starts at the last 24 hours. When that day is empty it widens and says why. On this deployment, Sunday 15 November 2026, the last 24 hours is empty because the market is closed for the weekend, and the page says it is showing the last 30 days. That edition has 11 items to act on, a watch list, routine filings under a count, and it ends “You’re done.” The 7-day control on the same page is empty: nothing to act on, and no filings from the book in that window. Leave it alone.

Ten minutes:

1. Open https://finn-gray.vercel.app and read the brief through to “You’re done.” Stay on the edition the page already opened.
2. In the watch list, open KPITTECH. The line is “Revenue up 6.5% year on year. No promise broken.” The figures are Q2 FY27, consolidated, in ₹ crore, and the card says the exchange XBRL verified them.
3. Open Supreme Industries at https://finn-gray.vercel.app/c/SUPREMEIND and read the FY26 revenue row in the promise ledger. It is Kept. P.C. Somani, on the Q3 FY26 call, says the company is maintaining ₹11,000–11,500 crore instead of ₹12,000 crore. Promised is ₹11,000–11,500 cr. Delivered is ₹11,218 cr, from the exchange XBRL for Q4 FY26. The row says consolidated, FY26, within that band ±3%. The citation opens the call at page 13, and the sheet shows the quote. Above the ledger, the latest quarter on the page is Q2 FY27, XBRL verified: revenue ₹3,361 cr, EBITDA ₹431 cr, PAT ₹262 cr.
4. Open Chat at https://finn-gray.vercel.app/chat. Finnie greets with “Hey, I’m Finnie. Ask me for a result, a promise, a price, or a rule.” Ask this, as one question: “Take the last four quarters of Supreme Industries and, against management’s own headline guidance, tell me what was promised versus what was delivered.” The turn reads the quarters and the guidance rows. Each pair on the screen is the quote, what was promised, what was delivered, and a chip for Kept, Missed, or Unverifiable. The bubble is one sentence from a live model. While the turn runs, the chat shows the step titles. If Gemini is out of credit, capped, or returns a quota error, that same turn tries the next configured free provider, Groq and then OpenRouter. A provider with no key is skipped. Cerebras is in that list and is not set on this deployment, so it is not called.

A promise is scored only when the quote and the delivered line are the same quantity: the same metric, the same unit, the same scope. A brand, a division, a dollar target, or a growth rate that leaves a business out stays unscored, and the company figure is not left beside it. Round 7 of that ledger read, in `docs/research/29-critique-round-7.md`, scored correctness 4 and demo reliability 4. That was a read of the stored rows.

On the company page the pull readings stay separate, and none of them calls a model. A segment mix is the business snapshot. Supreme’s is the turnover share printed in the annual report: Plastics Piping Products 70%, Packaging Products 15%, Industrial Products 11%, Consumer Products 4%. Leverage and debt ratios stay on the balance sheet. A guidance quote stays under Guidance. The FY26 revenue promise is the ledger row, not the piping mix.

A price question uses NSE’s official MCP at https://www.nseindia.com/nse-mcp. Five of 36 tools are wired. A live quote does not replace an XBRL result or a ledger verdict.

The repository is https://github.com/ansh200516/FINN. How it was built is `docs/submission/build-history.md`. The experiment log is `docs/experiments/LOG.md`. Raw agent transcripts are not in the repository.

Left out on purpose: sign-in, news and broker notes, voice, and a native app. There is no vector database and no portfolio profit and loss. The chat answer waits on a live model.
