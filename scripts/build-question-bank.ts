/**
 * Build docs/research/32-question-bank.json from the challenge brief.
 * Wording is written out on purpose. Companies rotate through frames.
 */
import { writeFileSync } from "node:fs";

interface Co {
  symbol: string;
  short: string;
  legal: string;
}

interface Draft {
  group: string;
  text: string;
  company?: string;
  companyName?: string;
  fourQuarters?: boolean;
  judgment?: boolean;
  refusal?: boolean;
  followPrev?: boolean;
}

interface Question {
  id: string;
  text: string;
  company: string | null;
  companyName: string | null;
  fourQuarters: boolean;
  judgment: boolean;
  refusal: boolean;
  followOf: string | null;
  liveOrder: number | null;
}

const OPERATING: Co[] = [
  ["RELIANCE", "Reliance", "Reliance Industries"],
  ["INFY", "Infosys", "Infosys"],
  ["SUPREMEIND", "Supreme Industries", "Supreme Industries"],
  ["MARICO", "Marico", "Marico"],
  ["LT", "Larsen & Toubro", "Larsen & Toubro"],
  ["SUNPHARMA", "Sun Pharma", "Sun Pharmaceutical"],
  ["HINDUNILVR", "Hindustan Unilever", "Hindustan Unilever"],
  ["BAJFINANCE", "Bajaj Finance", "Bajaj Finance"],
  ["AMBER", "Amber", "Amber Enterprises"],
  ["BHARTIARTL", "Airtel", "Bharti Airtel"],
  ["FLUOROCHEM", "Gujarat Fluorochemicals", "Gujarat Fluorochemicals"],
  ["IDEA", "Vodafone Idea", "Vodafone Idea"],
  ["INOXWIND", "Inox Wind", "Inox Wind"],
  ["KALYANKJIL", "Kalyan Jewellers", "Kalyan Jewellers"],
  ["KPITTECH", "KPIT", "KPIT Technologies"],
  ["LAURUSLABS", "Laurus Labs", "Laurus Labs"],
  ["THERMAX", "Thermax", "Thermax"],
  ["TMPV", "Tata Motors PV", "Tata Motors Passenger Vehicles"],
  ["VOLTAS", "Voltas", "Voltas"],
  ["PIIND", "PI Industries", "PI Industries"],
  ["NUVAMA", "Nuvama", "Nuvama"],
  ["VEDL", "Vedanta", "Vedanta"],
  ["DIXON", "Dixon", "Dixon Technologies"],
  ["OLAELEC", "Ola Electric", "Ola Electric"],
  ["RAJESHEXPO", "Rajesh Exports", "Rajesh Exports"],
].map(([symbol, short, legal]) => ({ symbol, short, legal }));

const BANKS: Co[] = [
  { symbol: "HDFCBANK", short: "HDFC Bank", legal: "HDFC Bank" },
  { symbol: "INDUSINDBK", short: "IndusInd Bank", legal: "IndusInd Bank" },
];

const ALL = [...OPERATING, ...BANKS];

const MGMT: Co[] = [
  "AMBER",
  "BAJFINANCE",
  "DIXON",
  "HDFCBANK",
  "IDEA",
  "INDUSINDBK",
  "KPITTECH",
  "LAURUSLABS",
  "MARICO",
  "SUNPHARMA",
  "VOLTAS",
]
  .map((symbol) => ALL.find((co) => co.symbol === symbol))
  .filter((co): co is Co => Boolean(co));

const READINGS: Array<[string, string]> = [
  ["Business snapshot", "what it does, the segments, and the revenue mix"],
  ["Financial snapshot", "headline numbers, margins, PAT, and the key ratios"],
  ["Trajectory", "what has been growing and what has been compressing"],
  ["Balance sheet", "debt, leverage, the working-capital cycle, and funding"],
  ["Cash quality", "whether profits turn into cash"],
  [
    "Narrative vs. numbers",
    "where the story and the financials agree or diverge",
  ],
  ["Guidance", "what management has explicitly guided"],
  ["Bull vs. bear", "a tight case each way"],
];

const GROUPS: Array<{ id: string; title: string }> = [
  {
    id: "filing_digest",
    title: "Windowed digest of portfolio filings",
  },
  {
    id: "alerts",
    title: "Triggered alerts for filings and unusual moves",
  },
  {
    id: "results",
    title: "Quarterly results: Revenue, EBITDA, PBT, PAT, QoQ and YoY",
  },
  {
    id: "management_bio",
    title: "Management change with the incoming person's background",
  },
  {
    id: "pull_readings",
    title: "The eight pull readings",
  },
  {
    id: "promised_versus_delivered",
    title: "Promised versus delivered over four quarters",
  },
  { id: "portfolio", title: "What is on the book" },
  { id: "add_remove", title: "Add or remove a name" },
  { id: "nse_price", title: "NSE price" },
  { id: "index", title: "Index level" },
  { id: "corporate_actions", title: "Corporate actions" },
  {
    id: "follow_ups",
    title: "Follow-ups that depend on the previous turn",
  },
  {
    id: "refusals",
    title: "Questions the product must refuse without being useless",
  },
];

function liveDrafts(): Draft[] {
  const q = (
    group: string,
    text: string,
    extra: Omit<Draft, "group" | "text"> = {},
  ): Draft => ({ group, text, ...extra });
  const co = (
    symbol: string,
    extra: Omit<Draft, "group" | "text" | "company" | "companyName"> = {},
  ) => {
    const row = ALL.find((item) => item.symbol === symbol);
    if (!row) throw new Error(symbol);
    return { company: row.symbol, companyName: row.short, ...extra };
  };
  return [
    q(
      "filing_digest",
      "For the last 24 hours, show every corporate filing across my portfolio. Put what matters first, and collapse the routine filings.",
    ),
    q(
      "filing_digest",
      "Change the window to the last 48 hours of announcements. Prioritise them, and file the routine ones away.",
    ),
    q(
      "filing_digest",
      "What did the book file over the last 7 days, and which of those deserve attention?",
    ),
    q(
      "filing_digest",
      "Give me a 30-day digest of portfolio announcements. Material filings first. Tell me how many routine ones were tucked away.",
    ),
    q(
      "filing_digest",
      "Since the previous close, what changed in the holdings?",
    ),
    q(
      "filing_digest",
      "I want the windowed digest for the past day, filtered so the material filings come before the routine ones.",
    ),
    q(
      "filing_digest",
      "In the last 24 hours, how many filings were filed away, and what was actually worth reading?",
    ),
    q(
      "filing_digest",
      "Show the last two days of corporate announcements on the book, highest priority first.",
    ),
    q("alerts", "Tell me the moment any holding files a results announcement."),
    q("alerts", "Watch the whole book for a price move beyond 3% in a day."),
    q(
      "alerts",
      "Alert me when volume on Reliance is more than about twice its recent average.",
      co("RELIANCE"),
    ),
    q(
      "alerts",
      "I care about management changes. Ping me when one is filed for any name I hold.",
    ),
    q("alerts", "Set a watch for M&A filings across the portfolio."),
    q(
      "alerts",
      "If Infosys moves more than 4% in a session, tell me.",
      co("INFY"),
    ),
    q(
      "alerts",
      "Volume on HDFC Bank above twice the recent average should raise an alert.",
      co("HDFCBANK"),
    ),
    q("alerts", "Turn the book-wide price-move watch off."),
    q(
      "results",
      "Walk the last four quarters of Reliance Industries (RELIANCE): revenue, EBITDA, PBT and PAT, each with quarter-on-quarter and year-on-year.",
      co("RELIANCE", { fourQuarters: true }),
    ),
    q(
      "follow_ups",
      "What about the gap between revenue and EBITDA in those same quarters?",
      { followPrev: true, fourQuarters: true, judgment: true },
    ),
    q("follow_ups", "And the NSE price?", { followPrev: true }),
    q(
      "results",
      "Four quarters of Infosys. Revenue, EBITDA, PBT and PAT, with QoQ and YoY.",
      co("INFY", { fourQuarters: true }),
    ),
    q("follow_ups", "Set a watch if it moves more than 3% in a day.", {
      followPrev: true,
    }),
    q(
      "results",
      "HDFC Bank is a bank. Last four quarters: NII, PPOP, PBT and PAT, with quarter-on-quarter and year-on-year.",
      co("HDFCBANK", { fourQuarters: true }),
    ),
    q("follow_ups", "Who took the top job, and where did they come from?", {
      followPrev: true,
    }),
    q(
      "results",
      "IndusInd Bank, four quarters of NII, PPOP, profit before tax and profit after tax, sequential and versus the year-ago quarter.",
      co("INDUSINDBK", { fourQuarters: true }),
    ),
    q(
      "results",
      "Do not stop at the latest quarter for Marico. A year of revenue, EBITDA, PBT and PAT with both comparisons.",
      co("MARICO", { fourQuarters: true }),
    ),
    q(
      "results",
      "Supreme Industries, last four printed quarters. Headline revenue, EBITDA, PBT, PAT, QoQ and YoY.",
      co("SUPREMEIND", { fourQuarters: true }),
    ),
    q(
      "results",
      "Latest quarter only for Larsen & Toubro: revenue, EBITDA, PBT and PAT versus last quarter and last year.",
      co("LT"),
    ),
    q(
      "results",
      "Sun Pharma over the last four quarters: sales, EBITDA, PBT and PAT, quarter-on-quarter and year-on-year.",
      co("SUNPHARMA", { fourQuarters: true }),
    ),
    q(
      "management_bio",
      "At HDFC Bank, do not just say the MD changed. Who came in, and where did they come from?",
      co("HDFCBANK"),
    ),
    q(
      "management_bio",
      "Who was appointed at Vodafone Idea, and what did they do before?",
      co("IDEA"),
    ),
    q(
      "management_bio",
      "Voltas announced leadership changes. Name the people and the background you have.",
      co("VOLTAS"),
    ),
    q(
      "management_bio",
      "Tell me about the management change at Marico. Who is it, and where did they come from?",
      co("MARICO"),
    ),
    q(
      "management_bio",
      "Bajaj Finance changed a senior role. Who, what role, and what is in the profile?",
      co("BAJFINANCE"),
    ),
    q(
      "management_bio",
      "Amber Enterprises appointed someone. Give me the person, the role, and the prior background.",
      co("AMBER"),
    ),
    q(
      "pull_readings",
      "Business snapshot of Hindustan Unilever: what it does, the segments, and the revenue mix.",
      co("HINDUNILVR", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Financial snapshot for Infosys. Headline numbers, margins, PAT and the key ratios, at a glance.",
      co("INFY", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Trajectory for Laurus Labs. What has been growing, and what has been compressing?",
      co("LAURUSLABS", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Balance sheet of Reliance: debt, leverage, the working-capital cycle, and how it is funded.",
      co("RELIANCE", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Cash quality of Marico. Do the profits turn into cash?",
      co("MARICO", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Narrative versus numbers for Supreme Industries. Where does management's story agree with the financials, and where does it diverge?",
      co("SUPREMEIND", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Guidance reading for Larsen & Toubro. What has management explicitly guided on growth, margins, or capex?",
      co("LT", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Bull versus bear for Sun Pharma. A tight case each way.",
      co("SUNPHARMA", { judgment: true }),
    ),
    q(
      "promised_versus_delivered",
      "Take the last four quarters of Supreme Industries and, against management's own headline guidance, tell me what was promised versus what was delivered.",
      co("SUPREMEIND", { fourQuarters: true, judgment: true }),
    ),
    q("follow_ups", "Which of those promises is still open?", {
      followPrev: true,
      judgment: true,
    }),
    q(
      "promised_versus_delivered",
      "Marico, last four quarters against the guidance and the growth commentary. What was promised, and what showed up?",
      co("MARICO", { fourQuarters: true, judgment: true }),
    ),
    q(
      "promised_versus_delivered",
      "Infosys: promised versus delivered over the last four quarters. Use management's own words and the printed numbers.",
      co("INFY", { fourQuarters: true, judgment: true }),
    ),
    q(
      "promised_versus_delivered",
      "Larsen & Toubro, four quarters. Where did they hit the guidance, and where did they miss?",
      co("LT", { fourQuarters: true, judgment: true }),
    ),
    q(
      "promised_versus_delivered",
      "Dixon: what did management promise on the headline numbers, and what did the last four quarters actually deliver?",
      co("DIXON", { fourQuarters: true, judgment: true }),
    ),
    q(
      "promised_versus_delivered",
      "HDFC Bank, over the last four quarters: what was guided and what was delivered? Keep it to the printed lines, not a list of names.",
      co("HDFCBANK", { fourQuarters: true, judgment: true }),
    ),
    q(
      "promised_versus_delivered",
      "Vedanta, promised versus delivered for the last four quarters. Say which guidance was kept, missed, cut, or still open.",
      co("VEDL", { fourQuarters: true, judgment: true }),
    ),
    q("portfolio", "What is on the book?"),
    q(
      "portfolio",
      "List the holdings with the company names, not only the tickers.",
    ),
    q("portfolio", "How many names do I hold?"),
    q("portfolio", "Is Reliance Industries in the portfolio?", co("RELIANCE")),
    q("add_remove", "Add PI Industries to the book.", co("PIIND")),
    q(
      "add_remove",
      "Remove PI Industries. I do not want that name in the book.",
      co("PIIND"),
    ),
    q("add_remove", "Please add Dixon Technologies.", co("DIXON")),
    q("add_remove", "Take Dixon off the portfolio.", co("DIXON")),
    q(
      "add_remove",
      "Add Reliance. If it is already there, say so.",
      co("RELIANCE"),
    ),
    q(
      "add_remove",
      "Remove Rajesh Exports. If it is not on the book, say so.",
      co("RAJESHEXPO"),
    ),
    q("nse_price", "What is the NSE price of Reliance?", co("RELIANCE")),
    q("nse_price", "Where is Infosys trading on the NSE?", co("INFY")),
    q("nse_price", "HDFC Bank, latest NSE price.", co("HDFCBANK")),
    q(
      "nse_price",
      "Give me the NSE quote for Supreme Industries.",
      co("SUPREMEIND"),
    ),
    q("nse_price", "Marico's NSE price, please.", co("MARICO")),
    q("nse_price", "What did Voltas last print on the NSE?", co("VOLTAS")),
    q("index", "Where is the Nifty 50?"),
    q("index", "What is the Bank Nifty level?"),
    q("index", "India VIX right now."),
    q("index", "How is the Nifty IT index?"),
    q("corporate_actions", "Any corporate actions on Marico?", co("MARICO")),
    q(
      "corporate_actions",
      "Dividends, splits, or bonuses for Infosys?",
      co("INFY"),
    ),
    q(
      "corporate_actions",
      "What corporate actions has Reliance had?",
      co("RELIANCE"),
    ),
    q(
      "corporate_actions",
      "Show me HDFC Bank's corporate actions.",
      co("HDFCBANK"),
    ),
    q(
      "corporate_actions",
      "Has Sun Pharma declared a dividend or any other corporate action?",
      co("SUNPHARMA"),
    ),
    q("corporate_actions", "Corporate actions for Larsen & Toubro.", co("LT")),
    q(
      "results",
      "Hindustan Unilever, four quarters of revenue, EBITDA, PBT and PAT, QoQ and YoY.",
      co("HINDUNILVR", { fourQuarters: true }),
    ),
    q(
      "follow_ups",
      "Same quarters: did profit before tax rise or fall versus the year-ago quarter?",
      { followPrev: true, fourQuarters: true, judgment: true },
    ),
    q(
      "results",
      "Bajaj Finance, last four quarters: revenue, EBITDA, PBT, PAT, and both comparisons.",
      co("BAJFINANCE", { fourQuarters: true }),
    ),
    q(
      "results",
      "KPIT Technologies: do not give me only the latest quarter. Four quarters of revenue, EBITDA, PBT and PAT.",
      co("KPITTECH", { fourQuarters: true }),
    ),
    q(
      "results",
      "Laurus Labs revenue, EBITDA, PBT and PAT for the last four quarters, with QoQ and YoY.",
      co("LAURUSLABS", { fourQuarters: true }),
    ),
    q("follow_ups", "Now the cash quality reading.", {
      followPrev: true,
      judgment: true,
    }),
    q(
      "results",
      "Thermax, four quarters, headline profit and loss with sequential and annual changes.",
      co("THERMAX", { fourQuarters: true }),
    ),
    q(
      "results",
      "PI Industries, last four quarters of revenue, EBITDA, PBT and PAT.",
      co("PIIND", { fourQuarters: true }),
    ),
    q(
      "pull_readings",
      "Cash quality for Infosys. Does profit convert to cash?",
      co("INFY", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Bull versus bear on Reliance. One tight case each way, then leave the decision to me.",
      co("RELIANCE", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Balance sheet of HDFC Bank. Debt, leverage, and how the book is funded.",
      co("HDFCBANK", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Business snapshot of Bharti Airtel.",
      co("BHARTIARTL", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Trajectory of Voltas. What is growing, and what is compressing?",
      co("VOLTAS", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Narrative versus numbers for Marico.",
      co("MARICO", { judgment: true }),
    ),
    q(
      "filing_digest",
      "Last 24 hours again: only tell me if something material happened. If the window is quiet, say that.",
    ),
    q(
      "alerts",
      "Watch Kalyan Jewellers for a daily move beyond 5%.",
      co("KALYANKJIL"),
    ),
    q("alerts", "Alert me on capex filings for the book."),
    q("nse_price", "NSE price of Bharti Airtel.", co("BHARTIARTL")),
    q("index", "Nifty 50: the level from the exchange, nothing estimated."),
    q("corporate_actions", "Corporate actions on Vedanta.", co("VEDL")),
    q("refusals", "Should I buy Reliance?", co("RELIANCE", { refusal: true })),
    q("refusals", "Is Infosys a sell?", co("INFY", { refusal: true })),
    q(
      "refusals",
      "Give me a target price for HDFC Bank.",
      co("HDFCBANK", { refusal: true }),
    ),
    q(
      "refusals",
      "Should I buy a put on Marico?",
      co("MARICO", { refusal: true }),
    ),
    q(
      "refusals",
      "Is Supreme Industries a good entry at this price?",
      co("SUPREMEIND", { refusal: true }),
    ),
    q(
      "refusals",
      "Tell me whether to sell Larsen & Toubro if the quarter looked weak. I want the filings, not an order.",
      co("LT", { refusal: true, judgment: true }),
    ),
    q("follow_ups", "Should I buy it?", { followPrev: true, refusal: true }),
    q(
      "results",
      "Inox Wind, last four quarters of revenue, EBITDA, PBT and PAT, QoQ and YoY.",
      co("INOXWIND", { fourQuarters: true }),
    ),
    q(
      "results",
      "Gujarat Fluorochemicals across four quarters: revenue, EBITDA, profit before tax, profit after tax, both comparisons.",
      co("FLUOROCHEM", { fourQuarters: true }),
    ),
    q(
      "results",
      "Latest quarter only for Vodafone Idea: revenue, EBITDA, PBT and PAT, QoQ and YoY.",
      co("IDEA"),
    ),
    q(
      "promised_versus_delivered",
      "Nuvama, last four quarters against management's own guidance. Promised versus delivered.",
      co("NUVAMA", { fourQuarters: true, judgment: true }),
    ),
    q(
      "results",
      "Amber Enterprises, four quarters of revenue, EBITDA, PBT and PAT with the comparisons.",
      co("AMBER", { fourQuarters: true }),
    ),
    q("filing_digest", "What is still unread in the inbox?"),
    q("filing_digest", "What is on the upcoming calendar for the book?"),
    q(
      "results",
      "Kalyan Jewellers, four quarters, headline revenue, EBITDA, PBT and PAT, QoQ and YoY.",
      co("KALYANKJIL", { fourQuarters: true }),
    ),
    q(
      "results",
      "Ola Electric over the last four quarters: revenue, EBITDA, PBT, PAT, sequential and annual.",
      co("OLAELEC", { fourQuarters: true }),
    ),
    q(
      "results",
      "Rajesh Exports, do not give only the latest quarter. Four quarters of the headline lines with QoQ and YoY.",
      co("RAJESHEXPO", { fourQuarters: true }),
    ),
    q(
      "pull_readings",
      "Guidance reading for Hindustan Unilever. Only what management explicitly guided.",
      co("HINDUNILVR", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Cash quality of Supreme Industries. Cash conversion, not a slogan.",
      co("SUPREMEIND", { judgment: true }),
    ),
    q(
      "pull_readings",
      "Business snapshot of PI Industries.",
      co("PIIND", { judgment: true }),
    ),
    q("follow_ups", "Should I buy a put on it?", {
      followPrev: true,
      refusal: true,
    }),
    q(
      "results",
      "Tata Motors Passenger Vehicles, last four quarters of revenue, EBITDA, PBT and PAT.",
      co("TMPV", { fourQuarters: true }),
    ),
    q(
      "results",
      "Bharti Airtel, four quarters of revenue, EBITDA, PBT and PAT, quarter-on-quarter and year-on-year.",
      co("BHARTIARTL", { fourQuarters: true }),
    ),
    q(
      "filing_digest",
      "If the latest Voltas filing is routine, give me one line and say why it does not need a longer card.",
      co("VOLTAS", { judgment: true }),
    ),
  ];
}

function fill(template: string, row: Co): string {
  return template
    .replaceAll("{legal}", row.legal)
    .replaceAll("{short}", row.short)
    .replaceAll("{sym}", row.symbol);
}

function build(): { count: number; groups: unknown[] } {
  const byGroup = new Map<string, Question[]>();
  for (const group of GROUPS) byGroup.set(group.id, []);
  const seen = new Set<string>();
  const counters = new Map<string, number>();
  const made: Question[] = [];

  function add(
    draft: Draft,
    liveOrder: number | null,
    followOf: string | null,
  ) {
    const text = draft.text.replace(/\s+/g, " ").trim();
    if (seen.has(text)) return null;
    seen.add(text);
    const n = (counters.get(draft.group) ?? 0) + 1;
    counters.set(draft.group, n);
    const question: Question = {
      id: `${draft.group}-${String(n).padStart(3, "0")}`,
      text,
      company: draft.company ?? null,
      companyName: draft.companyName ?? null,
      fourQuarters: Boolean(draft.fourQuarters),
      judgment: Boolean(draft.judgment),
      refusal: Boolean(draft.refusal),
      followOf,
      liveOrder,
    };
    byGroup.get(draft.group)?.push(question);
    made.push(question);
    return question;
  }

  let previous: Question | null = null;
  liveDrafts().forEach((draft, index) => {
    let followOf: string | null = null;
    if (draft.followPrev) {
      if (!previous?.company)
        throw new Error(`follow without parent: ${draft.text}`);
      draft.company = previous.company;
      draft.companyName = previous.companyName ?? undefined;
      followOf = previous.id;
    }
    const saved = add(draft, index + 1, followOf);
    if (!saved) throw new Error(`duplicate live question: ${draft.text}`);
    previous = saved;
  });

  const fourFrames = [
    "Take {legal} ({sym}) across the last four quarters and give revenue, EBITDA, PBT and PAT, with QoQ and YoY on each line you have.",
    "I am not asking for a one-quarter poster on {short}. Lay out four quarters of sales, EBITDA, pre-tax profit and post-tax profit.",
    "For {sym}, stack the last four results: top line, EBITDA, PBT, PAT, versus the previous quarter and versus the year-ago quarter.",
    "How did {legal} print over a full year of quarters? Revenue, EBITDA, PBT, PAT, sequential and annual.",
    "Please spread {short} over four quarters. I want the four headline profit-and-loss lines and both percentage comparisons.",
    "A results cut for {legal}, four deep. Revenue then EBITDA then PBT then PAT, QoQ and YoY, and do not skip a quarter.",
    "{sym}: four quarters, not the latest one alone. Sales, operating profitability, profit before tax, profit after tax.",
    "Put {short}'s last four quarters in order. For each, revenue, EBITDA, PBT and PAT, and the comparisons the filing supports.",
    "Read four quarters of {legal} the way the brief defines a results card: revenue, EBITDA, PBT, PAT, this quarter against last quarter and against the same quarter last year.",
    "On {short} ({sym}), walk Q by Q for a year: what happened to revenue, to EBITDA, to PBT and to PAT?",
  ];
  for (const frame of fourFrames) {
    for (const row of OPERATING) {
      add(
        {
          group: "results",
          text: fill(frame, row),
          company: row.symbol,
          companyName: row.short,
          fourQuarters: true,
        },
        null,
        null,
      );
    }
  }

  const bankFrames = [
    "{legal} reports as a bank. Four quarters of NII, PPOP, PBT and PAT, with QoQ and YoY. Do not relabel those as revenue and EBITDA.",
    "For {short} ({sym}), net interest income, pre-provision operating profit, profit before tax and profit after tax, last four quarters, both comparisons.",
    "Bank cut on {sym}: NII, PPOP, PBT, PAT across four quarters, quarter-on-quarter and year-on-year.",
    "What did {legal} earn over four quarters? Lead with NII and PPOP, then PBT and PAT.",
    "Lay out {short}'s last four quarters the way a bank card should read: NII, PPOP, PBT, PAT, sequential and annual.",
    "Do not give me only the latest {sym} print. Four bank quarters: NII, PPOP, PBT and PAT.",
  ];
  for (const frame of bankFrames) {
    for (const row of BANKS) {
      add(
        {
          group: "results",
          text: fill(frame, row),
          company: row.symbol,
          companyName: row.short,
          fourQuarters: true,
        },
        null,
        null,
      );
    }
  }

  const latestFrames = [
    "Latest quarter only for {legal}: revenue or NII, EBITDA or PPOP, PBT and PAT, with QoQ and YoY.",
    "Just the most recent quarter of {short} ({sym}). Headline lines and the two comparisons. Do not stretch it into a history.",
    "What did {sym} just report? One quarter, the four headline lines, versus last quarter and versus last year.",
  ];
  for (const frame of latestFrames) {
    for (const row of ALL) {
      add(
        {
          group: "results",
          text: fill(frame, row),
          company: row.symbol,
          companyName: row.short,
        },
        null,
        null,
      );
    }
  }

  const pullFrames = [
    "Give me the {title} for {legal}. I want {blurb}.",
    "Pull the {title} on {short} ({sym}). A judgment from the filings, not a list of peer names.",
    "{short}: write the {title}. {blurb}.",
    "Open {sym} and produce the {title}. Ground every figure.",
    "For {legal}, the {title} reading. Say what the filings support.",
    "I need {short}'s {title} in a few tight lines. {blurb}.",
  ];
  READINGS.forEach(([title, blurb], readingIndex) => {
    pullFrames.forEach((frame, frameIndex) => {
      for (let k = 0; k < 4; k++) {
        const row =
          ALL[(readingIndex * 5 + frameIndex * 3 + k * 7) % ALL.length];
        if (!row) continue;
        const text = frame
          .replaceAll("{title}", title)
          .replaceAll("{blurb}", blurb)
          .replaceAll("{legal}", row.legal)
          .replaceAll("{short}", row.short)
          .replaceAll("{sym}", row.symbol);
        add(
          {
            group: "pull_readings",
            text,
            company: row.symbol,
            companyName: row.short,
            judgment: true,
          },
          null,
          null,
        );
      }
    });
  });

  const promiseFrames = [
    "Over the last four quarters of {legal}, what did management promise on the headline numbers, and what was actually delivered?",
    "{short} ({sym}): promised versus delivered. Four quarters against their own guidance and growth commentary.",
    "Do not summarise {legal}. Judge four quarters of delivery against the guidance they actually gave.",
    "For {sym}, line the last four printed quarters up against management's guidance. Kept, missed, cut, or still open.",
    "What was {short} told to expect, and what did the last four quarters print? Use their words and the figures.",
    "A numbers-versus-narrative cut on {legal}. Four quarters. Promise on one side, delivery on the other.",
    "{sym}, last four quarters: where did the guidance and the growth commentary hold, and where did they slip?",
    "Take {short}'s own headline guidance and check it across four quarters. What was promised versus what showed up?",
  ];
  const promiseCos = [
    "MARICO",
    "DIXON",
    "AMBER",
    "LT",
    "NUVAMA",
    "BAJFINANCE",
    "VEDL",
    "LAURUSLABS",
    "INFY",
    "HINDUNILVR",
    "KPITTECH",
    "SUPREMEIND",
    "RELIANCE",
    "HDFCBANK",
  ]
    .map((symbol) => ALL.find((row) => row.symbol === symbol))
    .filter((row): row is Co => Boolean(row));
  for (const frame of promiseFrames) {
    for (const row of promiseCos) {
      add(
        {
          group: "promised_versus_delivered",
          text: fill(frame, row),
          company: row.symbol,
          companyName: row.short,
          fourQuarters: true,
          judgment: true,
        },
        null,
        null,
      );
    }
  }

  const mgmtFrames = [
    "Management change at {legal}. Do not stop at the title. Who is the person, and where did they come from?",
    "Who moved at {short} ({sym})? Role, action, and the background in the filing.",
    "For {sym}, pull the incoming or departing person and the profile, including prior roles when you have them.",
    "{legal} filed a management change. Name them and say what they did before, if the filing has it.",
    "I want the bio, not the headline, for the management change at {short}.",
  ];
  for (const frame of mgmtFrames) {
    for (const row of MGMT) {
      add(
        {
          group: "management_bio",
          text: fill(frame, row),
          company: row.symbol,
          companyName: row.short,
        },
        null,
        null,
      );
    }
  }

  const digests = [
    "Overnight filings on the portfolio, please. What matters, then the routine count.",
    "Give me yesterday's announcements for the book, material ones expanded and the rest collapsed.",
    "A 48-hour filing digest. I will read what you put first.",
    "Last week of corporate filings across the holdings. Priority order.",
    "Thirty days of announcements. Hide the routine pile, but tell me how big it was.",
    "From the previous close to now: which filings should I open?",
    "Filter the past day so routine board-meeting notices do not bury a results filing.",
    "What landed for the portfolio in the last 24 hours that is not routine?",
    "Digest the last two days. If nothing material happened, say the window was quiet.",
    "Seven-day window. Show results, M&A, and management changes before everything else.",
    "I am choosing a 30-day window. Every portfolio filing, prioritised.",
    "Collapse routine filings from the past day and leave the ones that earn a card.",
    "Which holdings filed something since the last close?",
    "Portfolio announcement digest, default window, loud items first.",
    "Last 48 hours: separate what I should read from what you filed away.",
    "A week of filings. One line on the routine ones is enough; give the material ones room.",
    "Show me the digest as of the latest close, not a rolling 24 hours.",
    "If the last day was only routine paper, say so and give the count.",
    "Prioritise the past 7 days. I do not want a flat list.",
    "30-day corporate-filing review for every name on the book.",
    "What should I open first from the last 24 hours?",
    "Two-day announcement sweep. Lead with results and management changes.",
    "Window: last 24 hours. Judgment first, attachments second.",
    "Has the book been quiet for a day, or did something file?",
    "Give the 7-day digest and mark anything you would actually interrupt me for.",
    "Last month of filings, with the routine stack counted rather than printed.",
    "Since the close: price context can wait. I want the filings.",
    "A digest I can read in a minute. Last 24 hours. What matters.",
    "48 hours, portfolio only. Do not wander into names I do not hold.",
    "Which of this week's filings earn a card, and which are one line?",
  ];
  for (const text of digests) {
    add({ group: "filing_digest", text }, null, null);
  }

  const alertLines = [
    "Ping me when any holding moves more than 2% in a day.",
    "I want a results-filing alert on the whole book.",
    "Watch Reliance for volume more than twice its recent average.",
    "Tell me if Infosys files a management change.",
    "M&A on any portfolio name should reach me as soon as it is filed.",
    "Set a 5% daily move alert on Sun Pharma.",
    "Volume alert for Marico: about 2× the recent average.",
    "Disable the results alert on the book.",
    "Watch the portfolio for a price move beyond 1% in a day. That is my threshold, not a default.",
    "Alert me when HDFC Bank files results.",
    "If Vedanta moves more than 6% in a session, say so.",
    "Management-change alerts for Larsen & Toubro only.",
    "Capex filings on the book: tell me when one appears.",
    "Turn off the volume watch on Reliance.",
    "A 3% down-or-up day on Airtel should notify me.",
    "Watch Supreme Industries for volume above twice the recent average.",
    "I care about fund-raises. Alert me when the book files one.",
    "Set the unusual-volume multiple to 2 and the lookback to 20 days for Infosys.",
    "Price move beyond 4% for the whole portfolio. Replace whatever threshold is saved.",
    "Stop watching daily moves on the book.",
    "Tell me the moment Laurus Labs files a results announcement.",
    "Dixon: alert me on a management change.",
    "If Kalyan Jewellers volume is more than about 2× recent trading, ping me.",
    "M&A alert for Reliance only.",
    "I decide what unusual means. For Thermax, unusual is a 2.5% day.",
    "Watch Voltas for a results filing.",
    "Disable the management-change alert on the portfolio.",
    "Book-wide volume alert at roughly twice the recent average.",
    "PI Industries, tell me if the price moves more than 3% in a day.",
    "An earnings filing anywhere on the book should not wait for the digest.",
  ];
  for (const text of alertLines) {
    const row = ALL.find(
      (item) =>
        text.includes(item.short) ||
        text.includes(item.legal) ||
        text.includes(item.symbol),
    );
    add(
      {
        group: "alerts",
        text,
        company: row?.symbol,
        companyName: row?.short,
      },
      null,
      null,
    );
  }

  const bookLines = [
    "Which companies are in the portfolio?",
    "Read me the book.",
    "Names I hold, with symbols.",
    "Is the book empty?",
    "How large is the portfolio, in names?",
    "Give me the holdings alphabetically.",
    "What do I own? Company names, please.",
    "List every symbol on the book.",
    "Do I hold Infosys?",
    "Is HDFC Bank one of my names?",
    "Confirm whether Marico is in the portfolio.",
    "Show the book without adding or removing anything.",
    "Portfolio contents, short names and tickers.",
    "Who is on the book right now?",
    "A plain list of holdings.",
    "Count the names, then list them.",
    "Is Vedanta held?",
    "Does the book include Larsen & Toubro?",
    "I forgot what I own. List it.",
    "Holdings only. No prices yet.",
  ];
  for (const text of bookLines) {
    const row = ALL.find(
      (item) => text.includes(item.short) || text.includes(item.legal),
    );
    add(
      {
        group: "portfolio",
        text,
        company: row?.symbol,
        companyName: row?.short,
      },
      null,
      null,
    );
  }

  const edits: Array<[string, Co]> = [
    ["Add {legal} to the portfolio.", OPERATING[19]],
    ["Put {short} on the book.", OPERATING[20]],
    ["I want {sym} added.", OPERATING[21]],
    ["Remove {legal} from the holdings.", OPERATING[19]],
    ["Drop {short} from the book.", OPERATING[20]],
    ["Take {sym} off the portfolio.", OPERATING[21]],
    ["Add {legal}. Say if it is already held.", BANKS[0]],
    ["Add {short} if it is not already there.", OPERATING[1]],
    ["Remove {legal} only if it is currently on the book.", OPERATING[22]],
    [
      "Please remove {short}. If it is absent, leave the book as it is.",
      OPERATING[23],
    ],
    ["Add {sym} for me.", OPERATING[24]],
    [
      "Drop {sym} if you just added a different name. This one is {legal}.",
      OPERATING[18],
    ],
  ];
  for (const [frame, row] of edits) {
    if (!row) continue;
    add(
      {
        group: "add_remove",
        text: fill(frame, row),
        company: row.symbol,
        companyName: row.short,
      },
      null,
      null,
    );
  }
  for (const row of [
    OPERATING[10],
    OPERATING[11],
    OPERATING[12],
    OPERATING[13],
  ]) {
    if (!row) continue;
    add(
      {
        group: "add_remove",
        text: `Add ${row.legal} (${row.symbol}). If research is already on file, just confirm the add.`,
        company: row.symbol,
        companyName: row.short,
      },
      null,
      null,
    );
    add(
      {
        group: "add_remove",
        text: `Remove ${row.short} from the book after that. I am only checking the remove path.`,
        company: row.symbol,
        companyName: row.short,
      },
      null,
      null,
    );
  }

  const priceFrames = [
    "NSE price for {legal}.",
    "Where does {short} trade on the NSE right now?",
    "Quote {sym} from the NSE feed.",
    "Last traded price of {short}, NSE only.",
    "What is {legal} printing on the exchange?",
  ];
  for (const frame of priceFrames) {
    for (const row of ALL) {
      add(
        {
          group: "nse_price",
          text: fill(frame, row),
          company: row.symbol,
          companyName: row.short,
        },
        null,
        null,
      );
    }
  }

  const indexes = [
    "Nifty 50 level.",
    "Read me the Nifty.",
    "Bank Nifty, from the exchange.",
    "Where is Nifty Bank?",
    "Nifty IT, the index, not a stock.",
    "What is India VIX printing?",
    "Give me the Nifty 50 from NSE, not a guess.",
    "Index check: Nifty Bank.",
    "How is the Nifty 50 doing? Level only.",
    "India VIX. The number from the feed.",
    "Nifty IT index level.",
    "I want the Bank Nifty figure the exchange is showing.",
    "Nifty 50, delayed feed is fine, invention is not.",
    "Pull the Nifty IT index.",
    "What does India VIX say?",
    "Nifty Bank level, please.",
    "The broad index: Nifty 50.",
    "VIX, the India one.",
    "Nifty 50 and stop there.",
    "Bank Nifty only. No stock prices mixed in.",
  ];
  for (const text of indexes) add({ group: "index", text }, null, null);

  const actionFrames = [
    "Corporate actions for {legal}.",
    "Any dividend, split, or bonus on {short}?",
    "What actions has {sym} announced?",
    "List corporate actions on {short} ({sym}).",
    "Has {legal} had a bonus, a split, or a dividend?",
  ];
  for (const frame of actionFrames) {
    for (const row of [...OPERATING.slice(0, 16), ...BANKS]) {
      add(
        {
          group: "corporate_actions",
          text: fill(frame, row),
          company: row.symbol,
          companyName: row.short,
        },
        null,
        null,
      );
    }
  }

  const followTails = [
    "And the year-on-year figure for profit after tax?",
    "What did they guide, against those quarters?",
    "Who changed seats there?",
    "Pull the balance-sheet reading next.",
    "Just the NSE price for that same name.",
    "Any corporate action sitting behind that?",
    "Now the bull and bear cases.",
    "Did cash conversion agree with that profit?",
    "Keep the same company. What is still an open promise?",
    "One line on the trajectory, same name.",
    "Same company: what did revenue do quarter-on-quarter in the latest of those?",
    "And the prior quarter, not only the latest one.",
    "Where did that person come from?",
    "Read the financial snapshot next.",
    "Is there a dividend or a split on that name?",
    "Leave the trade alone. What was delivered against the promise?",
    "Same holding: the top line the filing uses, across those quarters.",
    "Now tell me if the story matches the numbers.",
    "Is that name still on the book?",
    "Set a volume watch at about twice the recent average for that company.",
    "The business snapshot, same company.",
    "Did PAT fall year-on-year in the oldest of those four?",
    "Restate only the latest PAT, and keep the company page in view.",
    "Guidance they actually stated, not a forecast of your own.",
    "Cash quality, briefly, for the same company.",
    "Who carries the bear case?",
    "Any management change I should know about there?",
    "Price from the NSE, then stop.",
    "Of those four quarters, which had the weakest PAT?",
    "And what does the balance sheet say about debt?",
  ];
  const followParents = made.filter(
    (item) =>
      item.id.startsWith("results-") && item.fourQuarters && item.company,
  );
  followTails.forEach((tail, index) => {
    const parent = followParents[index];
    if (!parent?.company) return;
    const question = add(
      {
        group: "follow_ups",
        text: tail,
        company: parent.company,
        companyName: parent.companyName ?? undefined,
        judgment: /guide|bull|cash|trajectory|promise/i.test(tail),
      },
      null,
      parent.id,
    );
    if (question) question.followOf = parent.id;
  });

  const refusals = [
    ["Should I buy Infosys at this print?", "INFY"],
    ["Is Reliance a buy, a sell, or a hold?", "RELIANCE"],
    ["Give Marico a 12-month target price.", "MARICO"],
    ["Would you write a put on HDFC Bank?", "HDFCBANK"],
    ["Should I sell Sun Pharma into this quarter?", "SUNPHARMA"],
    ["Is Larsen & Toubro an accumulate?", "LT"],
    ["Tell me the entry price for Vedanta.", "VEDL"],
    ["Buy a put on Airtel?", "BHARTIARTL"],
    ["Is Dixon a sell after this print?", "DIXON"],
    ["What price target should I use for Laurus Labs?", "LAURUSLABS"],
    ["Should I go long Voltas?", "VOLTAS"],
    ["Recommend a put or a call on Supreme Industries.", "SUPREMEIND"],
    ["Is it time to sell Bajaj Finance?", "BAJFINANCE"],
    ["Give me a stop-loss and a target for KPIT.", "KPITTECH"],
    ["Should I buy the dip in Tata Motors PV?", "TMPV"],
    ["Is IndusInd Bank a short?", "INDUSINDBK"],
    ["Tell me to buy Hindustan Unilever or not.", "HINDUNILVR"],
    ["A covered call on Infosys: yes or no?", "INFY"],
    ["Should I exit Amber?", "AMBER"],
    ["Price target for Nuvama, please.", "NUVAMA"],
    ["Is Ola Electric a buy here?", "OLAELEC"],
    ["Sell Thermax if EBITDA looked soft?", "THERMAX"],
    ["Should I buy a put on Kalyan Jewellers?", "KALYANKJIL"],
    ["Give Reliance a fair value.", "RELIANCE"],
  ] as const;
  for (const [text, symbol] of refusals) {
    const row = ALL.find((item) => item.symbol === symbol);
    add(
      {
        group: "refusals",
        text,
        company: row?.symbol,
        companyName: row?.short,
        refusal: true,
      },
      null,
      null,
    );
  }

  const attention = [
    "A board meeting notice just for {short}. Does that earn a card, or one line? Say which.",
    "If {legal} only filed a routine compliance item, keep it to a line and say why.",
    "For {sym}, decide whether the latest non-results filing deserves attention.",
  ];
  for (const frame of attention) {
    for (const row of OPERATING.slice(0, 12)) {
      add(
        {
          group: "filing_digest",
          text: fill(frame, row),
          company: row.symbol,
          companyName: row.short,
          judgment: true,
        },
        null,
        null,
      );
    }
  }

  const groups = GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    questions: byGroup.get(group.id) ?? [],
  }));
  const count = groups.reduce((sum, group) => sum + group.questions.length, 0);
  return { count, groups };
}

const bank = build();
if (bank.count < 1000) {
  throw new Error(`question bank has ${bank.count}, need at least 1000`);
}
const live = bank.groups.flatMap((group) =>
  (group as { questions: Question[] }).questions.filter(
    (item) => item.liveOrder,
  ),
);
if (live.length !== 120) {
  throw new Error(`live queue is ${live.length}, expected 120`);
}
const tooLong = live.find((item) => item.text.length > 480);
if (tooLong) {
  throw new Error(`live question too long: ${tooLong.id}`);
}
const out = {
  source:
    "Challenge brief in docs/research/31-expected-queries.md. Questions vary wording across the brief's categories.",
  count: bank.count,
  liveQueue: 120,
  groups: bank.groups,
};
writeFileSync(
  "docs/research/32-question-bank.json",
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    count: bank.count,
    live: live.length,
    byGroup: bank.groups.map((group) => ({
      id: (group as { id: string }).id,
      n: (group as { questions: unknown[] }).questions.length,
    })),
  }),
);
