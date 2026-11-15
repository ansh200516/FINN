To: assessment@enam.com
Subject: IIT Delhi – AI Engineer - 2027

FINN is a brief that remembers what management promised. Once each weekday evening a cron hands an investor a finite edition: the filings that need a decision, the routine counted and folded away, and a last line that says the edition is over. What management said on a call is a ledger, settled only against the exchange's own numbers. The investor writes the alert rules.

The home screen is that edition because the job is to filter a day, then stop. The window is 24 hours by default, or 48 hours, 7 days, 30 days, or since the last close. "Needs you" is a short stack of cards. "Worth knowing" is one line. Routine filings stay under a count you can open. An empty day widens and says why, including a holiday. The page ends "You're done." Ask lives on a company page, and only after an explicit question.

Results numbers are NSE's integrated-filing XBRL: revenue, finance costs, depreciation, profit before tax and profit for the period, in rupees, with a consolidated or standalone flag. EBITDA and the quarter-on-quarter and year-on-year changes are arithmetic on those tags. The card may say the exchange verified the print only when the lines add up and the half year equals the two quarters. A PDF is the fallback when that XBRL is absent, and the fallback does not wear the verified badge.

Ask answers a price, the index, and corporate actions from NSE's official MCP at https://www.nseindia.com/nse-mcp. Two public Streamable HTTP servers, no API key: end-of-day https://mcp.nseindia.in/bhavcopy/cm/mcp, and delayed prices (1–3 minutes) at https://mcp.nseindia.in/cmmkt/mcp. Five of 36 tools are wired. A live quote never replaces an XBRL result or a promise-ledger verdict. "reliance price" is the delayed NSE quote when that feed answers, and the stored close when it does not. "results" stays the filing.

A promise is scored only when the quote and the delivered line are the same quantity: the same metric, the same unit, the same scope. Early rows set a real transcript sentence beside the company total — a brand, a division, a dollar target, assets under management — and still said beat or miss. A product named in the question counts even when the quote omits it. Growth that leaves one business out is not the company growth rate. A mismatch stays unscored, and the company figure is cleared. Supreme Industries guided FY26 revenue to ₹11,000–11,500 crore; the exchange line is ₹11,217.68 crore, shown on the row as ₹11,218 crore, and the ledger says kept. A read of the database after that rule scored correctness 4 and demo reliability 4 (`docs/research/29-critique-round-7.md`). A citation can still land a page early.

Silence is the same rule applied to absence. The edition ends, and routine filings remain as a counted fold. A promise the profit-and-loss cannot settle is marked unverifiable, with the reason. When the period has ended and the next transcript never mentions it, the verdict is "not addressed". A company that does not hold calls is given no invented due date. The blank stays labelled.

Spend follows the free tier we measured. Rules classify most filings. Flash-Lite extracts quotes, one-line filings and appointment profiles. Flash is reserved for the rare synthesis and for an Ask the investor starts. The same prompt, document and schema is cached. Each model stops at 80% of its daily cap: Flash at 16 of 20, Flash-Lite at 400 of 500. A failed attempt counts. The brief, the card and the ledger are already computed. `/status` shows the day.

The app is https://finn-gray.vercel.app. The home screen is the edition. Ten minutes on a phone:

1. Open the edition and read to "You're done". The window starts at the last 24 hours. If that day is empty the page widens and says so. Do not switch to 7 days when that week has no filings; the scrubber's 30 days is there if you want a longer look.
2. Open a results card whose title quarter matches the grid. Voltas is a safe one. Inox Wind and Tata Motors (TMPV) can title a September quarter while the stored XBRL is still June; that card does not say the June grid is exchange-verified for September.
3. Open Supreme's ledger at https://finn-gray.vercel.app/c/SUPREMEIND and read the FY26 revenue row: kept, promised ₹11,000–11,500 crore, delivered about ₹11,218 crore. The row says the basis, the horizon, and the tolerance.
4. Open Alerts. The price and volume rules are already there. Save is only for a change you make.

The repository is https://github.com/ansh200516/FINN.git. The build is `docs/submission/build-history.md`. The log is `docs/experiments/LOG.md`.

Left out on purpose: sign-in, news and broker notes, voice, a vector database, portfolio profit and loss, and a native app. The half-year checksum is already on the results card: a failed check does not wear "Exchange XBRL verified". A citation can still open a PDF page before the quote; that is not patched with a fixed offset. Ask still waits on a model when the investor asks.
