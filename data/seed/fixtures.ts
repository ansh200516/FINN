/**
 * FIXTURE seeder for UI development — `FINN_FIXTURES=1 pnpm tsx data/seed/fixtures.ts`.
 *
 * Inserts a small, clearly-labelled set of rows so every surface renders
 * while the engine builders fill the real tables. Every number, quote,
 * subject and URL below is REAL and comes from the research docs:
 *
 *   RELIANCE Q2 FY27 XBRL numbers ........ docs/research/00-shared-context.md, 05 §7.3, 12 §3.2
 *   HDFCBANK Q2 FY27 bank-format numbers .. docs/research/12 §2.2 (printed PDF p.9)
 *   SUPREMEIND Q2 FY27 + guidance quotes .. docs/research/12 §2.2, §4.2 (9/9 quotes verified)
 *   VOLTAS board reshuffle + verbatim bio . docs/research/14 §2–3 (filing posted 5×)
 *   HDFCBANK CCO appointment .............. docs/research/14 §2
 *   HINDUNILVR / INFY / RELIANCE subjects . docs/research/05 §6.2 (real `desc` + `attchmntText`)
 *   Board-meeting calendar 9–14 Nov ....... docs/research/21 §8
 *   Prices: real anchors (closes, % moves, volume ratios) from docs/research/21 §4;
 *           the days in between are a deterministic infill marked `source = 'fixture'`.
 *
 * Where NSE's time-of-day stamp is not in the docs, `filed_at_ist` is the
 * date only ("17-Oct-2026") and the UI shows the day without a time.
 * Idempotent: everything upserts on its primary key; fixture prices are
 * replaced wholesale. Never run against a production database.
 */

import { formatInTimeZone } from "date-fns-tz";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import type { ResultsCard } from "@/engine/types";
import { parseNseDateTime, tradingDaysBetween } from "@/lib/time";

if (process.env.FINN_FIXTURES !== "1") {
  console.error(
    "Refusing to run: set FINN_FIXTURES=1 to seed fixture data into the local DB.",
  );
  process.exit(2);
}
if ((process.env.DATABASE_URL ?? "file:").startsWith("libsql://")) {
  console.error("Refusing to seed fixtures into a remote libsql:// database.");
  process.exit(2);
}

const CR = 1e7;
const NOW = Date.now();
const CHECKED_AT = NOW - 9 * 60_000; // "checked NSE 9 min ago"

const ms = (ist: string) => parseNseDateTime(ist);

// ---------------------------------------------------------------------------
// Companies — 6 with rich data + 5 calendar-only names from the verified portfolio
// ---------------------------------------------------------------------------

const COMPANIES = [
  {
    isin: "INE002A01018",
    nseSymbol: "RELIANCE",
    bseCode: "500325",
    name: "Reliance Industries Limited",
    sector: "Oil, Gas & Consumable Fuels",
    industry: "Refineries & Marketing",
    screenerSlug: "RELIANCE",
  },
  {
    isin: "INE040A01034",
    nseSymbol: "HDFCBANK",
    bseCode: "500180",
    name: "HDFC Bank Limited",
    sector: "Financial Services",
    industry: "Private Sector Bank",
    screenerSlug: "HDFCBANK",
  },
  {
    isin: "INE030A01027",
    nseSymbol: "HINDUNILVR",
    bseCode: "500696",
    name: "Hindustan Unilever Limited",
    sector: "Fast Moving Consumer Goods",
    industry: "Diversified FMCG",
    screenerSlug: "HINDUNILVR",
  },
  {
    isin: "INE009A01021",
    nseSymbol: "INFY",
    bseCode: "500209",
    name: "Infosys Limited",
    sector: "Information Technology",
    industry: "Computers - Software & Consulting",
    screenerSlug: "INFY",
  },
  {
    isin: "INE195A01028",
    nseSymbol: "SUPREMEIND",
    bseCode: "509930",
    name: "Supreme Industries Limited",
    sector: "Capital Goods",
    industry: "Plastic Products - Industrial",
    screenerSlug: "SUPREMEIND",
  },
  {
    isin: "INE226A01021",
    nseSymbol: "VOLTAS",
    bseCode: "500575",
    name: "Voltas Limited",
    sector: "Consumer Durables",
    industry: "Household Appliances",
    screenerSlug: "VOLTAS",
  },
  // calendar-only (board meetings 9–14 Nov, docs/research/21 §8)
  {
    isin: "INE303R01014",
    nseSymbol: "KALYANKJIL",
    bseCode: "543278",
    name: "Kalyan Jewellers India Limited",
    sector: "Consumer Durables",
    industry: "Gems, Jewellery And Watches",
    screenerSlug: "KALYANKJIL",
  },
  {
    isin: "INE669E01016",
    nseSymbol: "IDEA",
    bseCode: "532822",
    name: "Vodafone Idea Limited",
    sector: "Telecommunication",
    industry: "Telecom - Cellular & Fixed line services",
    screenerSlug: "IDEA",
  },
  {
    isin: "INE371P01015",
    nseSymbol: "AMBER",
    bseCode: "540902",
    name: "Amber Enterprises India Limited",
    sector: "Consumer Durables",
    industry: "Household Appliances",
    screenerSlug: "AMBER",
  },
  {
    isin: "INE155A01022",
    nseSymbol: "TMPV",
    bseCode: "500570",
    name: "Tata Motors Passenger Vehicles Limited",
    sector: "Automobile and Auto Components",
    industry: "Passenger Cars & Utility Vehicles",
    screenerSlug: "TMPV",
    aliases: ["TATAMOTORS"],
  },
  {
    isin: "INE066P01011",
    nseSymbol: "INOXWIND",
    bseCode: "539083",
    name: "Inox Wind Limited",
    sector: "Capital Goods",
    industry: "Heavy Electrical Equipment",
    screenerSlug: "INOXWIND",
  },
];

const ISIN = {
  RIL: "INE002A01018",
  HDFC: "INE040A01034",
  HUL: "INE030A01027",
  INFY: "INE009A01021",
  SUPREME: "INE195A01028",
  VOLTAS: "INE226A01021",
  KALYAN: "INE303R01014",
  IDEA: "INE669E01016",
  AMBER: "INE371P01015",
  TMPV: "INE155A01022",
  INOXWIND: "INE066P01011",
} as const;

// ---------------------------------------------------------------------------
// Source URLs (all real)
// ---------------------------------------------------------------------------

const URL = {
  rilResultsPdf:
    "https://www.bseindia.com/xml-data/corpfiling/AttachHis/880087f6-7ecc-40a9-8cac-de48d4616b25.pdf",
  rilXbrl:
    "https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1750537_30102026093254_WEB.xml",
  rilTranscript:
    "https://www.bseindia.com/xml-data/corpfiling/AttachLive/8e997741-4d35-4188-933a-cf020fb9c816.pdf",
  rilAr:
    "https://nsearchives.nseindia.com/annual_reports/AR_29285_RELIANCE_2025_2026_A_11007429_28052026133947.pdf",
  hdfcResultsPdf:
    "https://www.bseindia.com/xml-data/corpfiling/AttachHis/f5d5fb37-aa66-401c-85d6-58ccd3982828.pdf",
  hdfcTranscript:
    "https://www.bseindia.com/xml-data/corpfiling/AttachLive/d7e45614-ae12-4bb9-b92d-623b3a63f166.pdf",
  hdfcAr:
    "https://nsearchives.nseindia.com/annual_reports/AR_29735_HDFCBANK_2025_2026_A_12667766_11072026001055.pdf",
  hdfcSrivatsan:
    "https://nsearchives.nseindia.com/corporate/HDFCBANK3_06112026152141_SE_Intimation-Srivatsan.pdf",
  supremeResultsPdf:
    "https://www.bseindia.com/xml-data/corpfiling/AttachHis/d0288072-8a02-4ddf-a06d-e3994909b6ef.pdf",
  supremeTranscript:
    "https://www.bseindia.com/xml-data/corpfiling/AttachLive/ceb674b9-cd2e-4ef8-bf77-bece0e59fe0f.pdf",
  supremeAr:
    "https://nsearchives.nseindia.com/annual_reports/AR_29321_SUPREMEIND_2025_2026_A_7275995_01062026164639.pdf",
  voltasFiling:
    "https://nsearchives.nseindia.com/corporate/VOLTAS_RB_06112026172057_02SE_Directorssigned.pdf",
  hulAr:
    "https://nsearchives.nseindia.com/annual_reports/AR_29330_HINDUNILVR_2025_2026_A_21643813_02062026215058.pdf",
  infyTranscript:
    "https://www.bseindia.com/xml-data/corpfiling/AttachLive/7982fc61-7765-4981-ab3d-6aec36ba2137.pdf",
  infyAr:
    "https://nsearchives.nseindia.com/annual_reports/AR_29313_INFY_2025_2026_U_8985411_30052026200413.pdf",
};

// ---------------------------------------------------------------------------
// Announcements → events
// ---------------------------------------------------------------------------

interface AnnSpec {
  id: string;
  isin: string;
  symbol: string;
  desc: string;
  subject: string;
  text?: string;
  /** IST stamp; date-only when the docs do not give a time */
  at: string;
  url?: string;
  size?: number;
  xbrl?: boolean;
  category: string;
  sub?: string;
  tier: 1 | 2 | 3;
  priority: number;
  eventKey: string;
  voice?: string;
  raw?: Record<string, unknown>;
}

const EK = {
  rilResults: `${ISIN.RIL}|results|2026-09-30`,
  rilMeet: `${ISIN.RIL}|investor_meetings|2026-11-06`,
  rilRating: `${ISIN.RIL}|credit_rating|2026-11-04`,
  hdfcCco: `${ISIN.HDFC}|management_change|2026-11-06|srivatsan`,
  hdfcResults: `${ISIN.HDFC}|results|2026-09-30`,
  hdfcMgmt31: `${ISIN.HDFC}|management_change|2026-10-31`,
  hdfcEsop1: `${ISIN.HDFC}|unclassified|esop|2026-10-20`,
  hdfcEsop2: `${ISIN.HDFC}|unclassified|esop|2026-10-28`,
  hdfcEsop3: `${ISIN.HDFC}|unclassified|esop|2026-11-05`,
  hdfcBallot: `${ISIN.HDFC}|postal_ballot|2026-10-30`,
  hdfcMeet1: `${ISIN.HDFC}|investor_meetings|2026-10-18`,
  hdfcMeet2: `${ISIN.HDFC}|investor_meetings|2026-11-03`,
  voltas: `${ISIN.VOLTAS}|management_change|2026-11-06|board`,
  supremeResults: `${ISIN.SUPREME}|results|2026-09-30`,
  supremeCall: `${ISIN.SUPREME}|earnings_call|2026-09-30`,
  hulDividend: `${ISIN.HUL}|dividend|2026-10-28`,
  hulNews1: `${ISIN.HUL}|unclassified|newspaper|2026-10-29`,
  hulNews2: `${ISIN.HUL}|unclassified|newspaper|2026-10-30`,
  hulNews3: `${ISIN.HUL}|unclassified|newspaper|2026-11-06`,
  hulMeet1: `${ISIN.HUL}|investor_meetings|2026-10-20`,
  hulMeet2: `${ISIN.HUL}|investor_meetings|2026-11-03`,
  infyDividend: `${ISIN.INFY}|dividend|2026-11-03`,
  infyCapex: `${ISIN.INFY}|capex|2026-10-27`,
  infyDate: `${ISIN.INFY}|unclassified|results_date|2026-10-12`,
  infyPress: `${ISIN.INFY}|press_release|2026-10-30`,
  infyCsr: `${ISIN.INFY}|unclassified|csr|2026-11-04`,
  infyConf: `${ISIN.INFY}|investor_meetings|2026-11-05`,
  infyNews1: `${ISIN.INFY}|unclassified|newspaper|2026-10-24`,
  infyNews2: `${ISIN.INFY}|unclassified|newspaper|2026-10-25`,
  bmKalyan: `${ISIN.KALYAN}|results|bm_intimation|2026-11-10`,
  bmIdea: `${ISIN.IDEA}|results|bm_intimation|2026-11-12`,
  bmAmber: `${ISIN.AMBER}|results|bm_intimation|2026-11-12`,
  bmTmpv: `${ISIN.TMPV}|results|bm_intimation|2026-11-13`,
  bmInox: `${ISIN.INOXWIND}|results|bm_intimation|2026-11-13`,
};

const informed = (name: string, what: string) =>
  `${name} has informed the Exchange about ${what}`;

const ANNS: AnnSpec[] = [
  // --- RELIANCE -----------------------------------------------------------
  {
    id: "fx:ril:results-pdf",
    isin: ISIN.RIL,
    symbol: "RELIANCE",
    desc: "Outcome of Board Meeting",
    subject:
      "Unaudited Financial Results (Consolidated and Standalone) for the Quarter and Half Year ended September 30, 2026",
    at: "30-Oct-2026 19:42:49",
    url: URL.rilResultsPdf,
    size: 8_818_015,
    category: "results",
    tier: 1,
    priority: 92,
    eventKey: EK.rilResults,
  },
  {
    id: "fx:ril:results-xbrl",
    isin: ISIN.RIL,
    symbol: "RELIANCE",
    desc: "Integrated Filing- Financial",
    subject:
      "Integrated Filing (Financial) for the quarter ended September 30, 2026",
    at: "30-Oct-2026 21:32:55",
    url: URL.rilXbrl,
    size: 103_237,
    xbrl: true,
    category: "results",
    tier: 1,
    priority: 92,
    eventKey: EK.rilResults,
  },
  {
    id: "fx:ril:results-newspaper",
    isin: ISIN.RIL,
    symbol: "RELIANCE",
    desc: "Copy of Newspaper Publication",
    subject: informed(
      "Reliance Industries Limited",
      "Copy of Newspaper Publication",
    ),
    at: "31-Oct-2026",
    category: "results",
    sub: "newspaper",
    tier: 1,
    priority: 10,
    eventKey: EK.rilResults,
  },
  {
    id: "fx:ril:clsa",
    isin: ISIN.RIL,
    symbol: "RELIANCE",
    desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
    subject:
      "Please note that the Company executives will be participating in the Institutional Investors meeting - CLSA India Forum, scheduled to be held on November 16, 2026 at Mumbai.",
    at: "06-Nov-2026 19:17:12",
    category: "investor_meetings",
    tier: 3,
    priority: 8,
    eventKey: EK.rilMeet,
  },
  {
    id: "fx:ril:rating",
    isin: ISIN.RIL,
    symbol: "RELIANCE",
    desc: "Credit Rating",
    subject: informed("Reliance Industries Limited", "Credit Rating"),
    at: "04-Nov-2026",
    category: "credit_rating",
    tier: 3,
    priority: 20,
    eventKey: EK.rilRating,
  },
  // --- HDFCBANK -----------------------------------------------------------
  {
    id: "fx:hdfc:srivatsan",
    isin: ISIN.HDFC,
    symbol: "HDFCBANK",
    desc: "Change in Management",
    subject:
      "Intimation under Regulation 30 — appointment of Mr. V. N. Srivatsan as Chief Compliance Officer of the Bank",
    at: "06-Nov-2026 15:21:41",
    url: URL.hdfcSrivatsan,
    category: "management_change",
    sub: "appointment_smp",
    tier: 2,
    priority: 58,
    eventKey: EK.hdfcCco,
  },
  {
    id: "fx:hdfc:results-pdf",
    isin: ISIN.HDFC,
    symbol: "HDFCBANK",
    desc: "Outcome of Board Meeting",
    subject:
      "Unaudited Financial Results (Standalone and Consolidated) for the quarter and half year ended September 30, 2026",
    at: "17-Oct-2026",
    url: URL.hdfcResultsPdf,
    category: "results",
    tier: 1,
    priority: 88,
    eventKey: EK.hdfcResults,
  },
  {
    id: "fx:hdfc:mgmt-31oct",
    isin: ISIN.HDFC,
    symbol: "HDFCBANK",
    desc: "Change in Management",
    subject: informed("HDFC Bank Limited", "Change in Management"),
    at: "31-Oct-2026",
    category: "management_change",
    tier: 3,
    priority: 30,
    eventKey: EK.hdfcMgmt31,
  },
  ...["20-Oct-2026", "28-Oct-2026", "05-Nov-2026"].map((d, i) => ({
    id: `fx:hdfc:esop-${i + 1}`,
    isin: ISIN.HDFC,
    symbol: "HDFCBANK",
    desc: "ESOP/ESOS/ESPS",
    subject: informed("HDFC Bank Limited", "ESOP/ESOS/ESPS"),
    at: d,
    category: "unclassified",
    sub: "esop",
    tier: 3 as const,
    priority: 5,
    eventKey: [EK.hdfcEsop1, EK.hdfcEsop2, EK.hdfcEsop3][i] as string,
  })),
  {
    id: "fx:hdfc:ballot",
    isin: ISIN.HDFC,
    symbol: "HDFCBANK",
    desc: "Shareholders meeting",
    subject: "Notice of Postal Ballot",
    at: "30-Oct-2026",
    category: "postal_ballot",
    tier: 3,
    priority: 12,
    eventKey: EK.hdfcBallot,
  },
  {
    id: "fx:hdfc:meet-1",
    isin: ISIN.HDFC,
    symbol: "HDFCBANK",
    desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
    subject: "Presentation",
    at: "18-Oct-2026",
    category: "investor_meetings",
    tier: 3,
    priority: 8,
    eventKey: EK.hdfcMeet1,
  },
  {
    id: "fx:hdfc:meet-2",
    isin: ISIN.HDFC,
    symbol: "HDFCBANK",
    desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
    subject: "Schedule of meet",
    at: "03-Nov-2026",
    category: "investor_meetings",
    tier: 3,
    priority: 8,
    eventKey: EK.hdfcMeet2,
  },
  // --- VOLTAS (one PDF posted five times under different subjects) --------
  ...[
    "Appointment",
    "Retirement",
    "Change in Director(s)",
    "Outcome of Board Meeting",
    "Change in Management",
  ].map((desc, i) => ({
    id: `fx:voltas:board-${i + 1}`,
    isin: ISIN.VOLTAS,
    symbol: "VOLTAS",
    desc,
    subject:
      "Appointment of Mr. Jayant Balan as Managing Director; appointment of Mr. Venkatesalu Palaniswamy as Non-Executive Director; Mr. Sunil D'Souza to be Chairman; retirement of Mr. Noel N. Tata and Mr. M. Menon",
    at: "06-Nov-2026 17:20:57",
    url: URL.voltasFiling,
    category: "management_change",
    sub: "board_reshuffle",
    tier: 1 as const,
    priority: 86,
    eventKey: EK.voltas,
  })),
  // --- SUPREMEIND ---------------------------------------------------------
  {
    id: "fx:supreme:results-pdf",
    isin: ISIN.SUPREME,
    symbol: "SUPREMEIND",
    desc: "Outcome of Board Meeting",
    subject:
      "Unaudited Financial Results (Standalone and Consolidated) for the quarter and half year ended September 30, 2026",
    at: "26-Oct-2026",
    url: URL.supremeResultsPdf,
    category: "results",
    tier: 2,
    priority: 70,
    eventKey: EK.supremeResults,
  },
  {
    id: "fx:supreme:deck",
    isin: ISIN.SUPREME,
    symbol: "SUPREMEIND",
    desc: "Investor Presentation",
    subject: informed("Supreme Industries Limited", "Investor Presentation"),
    at: "26-Oct-2026",
    category: "results",
    sub: "presentation",
    tier: 2,
    priority: 20,
    eventKey: EK.supremeResults,
  },
  {
    id: "fx:supreme:newspaper",
    isin: ISIN.SUPREME,
    symbol: "SUPREMEIND",
    desc: "Copy of Newspaper Publication",
    subject: informed(
      "Supreme Industries Limited",
      "Copy of Newspaper Publication",
    ),
    at: "27-Oct-2026",
    category: "results",
    sub: "newspaper",
    tier: 2,
    priority: 10,
    eventKey: EK.supremeResults,
  },
  {
    id: "fx:supreme:transcript",
    isin: ISIN.SUPREME,
    symbol: "SUPREMEIND",
    desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
    subject:
      "Transcript of the Q2 FY27 earnings conference call held on October 26, 2026",
    at: "31-Oct-2026",
    url: URL.supremeTranscript,
    category: "earnings_call",
    sub: "transcript",
    tier: 3,
    priority: 25,
    eventKey: EK.supremeCall,
  },
  // --- HINDUNILVR ---------------------------------------------------------
  {
    id: "fx:hul:dividend",
    isin: ISIN.HUL,
    symbol: "HINDUNILVR",
    desc: "Dividend",
    subject:
      "Board approves Interim Dividend of Rs. 19 per equity share for FY 2026-27",
    at: "28-Oct-2026",
    category: "dividend",
    tier: 2,
    priority: 55,
    eventKey: EK.hulDividend,
  },
  {
    id: "fx:hul:outcome",
    isin: ISIN.HUL,
    symbol: "HINDUNILVR",
    desc: "Outcome of Board Meeting",
    subject: "Outcome of the Board Meeting held on 28th October, 2026.",
    at: "28-Oct-2026",
    category: "dividend",
    sub: "board_outcome",
    tier: 2,
    priority: 40,
    eventKey: EK.hulDividend,
  },
  {
    id: "fx:hul:record-date",
    isin: ISIN.HUL,
    symbol: "HINDUNILVR",
    desc: "Record Date",
    subject: "Record date for the purpose of Interim Dividend",
    at: "28-Oct-2026",
    category: "dividend",
    sub: "record_date",
    tier: 2,
    priority: 30,
    eventKey: EK.hulDividend,
  },
  ...["29-Oct-2026", "30-Oct-2026", "06-Nov-2026"].map((d, i) => ({
    id: `fx:hul:newspaper-${i + 1}`,
    isin: ISIN.HUL,
    symbol: "HINDUNILVR",
    desc: "Copy of Newspaper Publication",
    subject: informed(
      "Hindustan Unilever Limited",
      "Copy of Newspaper Publication",
    ),
    at: d,
    category: "unclassified",
    sub: "newspaper",
    tier: 3 as const,
    priority: 4,
    eventKey: [EK.hulNews1, EK.hulNews2, EK.hulNews3][i] as string,
  })),
  {
    id: "fx:hul:meet-1",
    isin: ISIN.HUL,
    symbol: "HINDUNILVR",
    desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
    subject: "Schedule of Analyst / Institutional Investor meetings",
    at: "20-Oct-2026",
    category: "investor_meetings",
    tier: 3,
    priority: 8,
    eventKey: EK.hulMeet1,
  },
  {
    id: "fx:hul:meet-2",
    isin: ISIN.HUL,
    symbol: "HINDUNILVR",
    desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
    subject: "Schedule of Analyst / Institutional Investor meetings",
    at: "03-Nov-2026",
    category: "investor_meetings",
    tier: 3,
    priority: 8,
    eventKey: EK.hulMeet2,
  },
  // --- INFY ---------------------------------------------------------------
  {
    id: "fx:infy:record-date",
    isin: ISIN.INFY,
    symbol: "INFY",
    desc: "Record Date",
    subject: "Record date for the purpose of Dividend is 03-Nov-2026.",
    at: "23-Oct-2026",
    category: "dividend",
    sub: "record_date",
    tier: 2,
    priority: 45,
    eventKey: EK.infyDividend,
  },
  {
    id: "fx:infy:pocharam",
    isin: ISIN.INFY,
    symbol: "INFY",
    desc: "Updates",
    subject:
      "Infosys Limited has informed the Exchange regarding 'Infosys Announces Expansion of Pocharam Development Center'.",
    at: "27-Oct-2026",
    category: "capex",
    tier: 2,
    priority: 42,
    eventKey: EK.infyCapex,
  },
  {
    id: "fx:infy:results-date",
    isin: ISIN.INFY,
    symbol: "INFY",
    desc: "Updates",
    subject:
      "Infosys Limited has informed the Exchange regarding 'Infosys to Announce Second Quarter Results on October 23, 2026'.",
    at: "12-Oct-2026",
    category: "unclassified",
    sub: "results_date",
    tier: 3,
    priority: 6,
    eventKey: EK.infyDate,
  },
  {
    id: "fx:infy:syngenta",
    isin: ISIN.INFY,
    symbol: "INFY",
    desc: "Updates",
    subject:
      "Infosys Limited has informed the Exchange regarding 'Infosys Successfully Delivers Syngenta's Global SAP S/4HANA Transformation'.",
    at: "30-Oct-2026",
    category: "press_release",
    tier: 3,
    priority: 9,
    eventKey: EK.infyPress,
  },
  {
    id: "fx:infy:foundation",
    isin: ISIN.INFY,
    symbol: "INFY",
    desc: "Updates",
    subject:
      "Infosys Limited has informed the Exchange regarding 'Infosys Foundation Enables Over 2.5 Lakh Job Offers'.",
    at: "04-Nov-2026",
    category: "unclassified",
    sub: "csr",
    tier: 3,
    priority: 3,
    eventKey: EK.infyCsr,
  },
  {
    id: "fx:infy:conference",
    isin: ISIN.INFY,
    symbol: "INFY",
    desc: "Updates",
    subject:
      "Infosys Limited has informed the Exchange regarding 'Investor Conference'.",
    at: "05-Nov-2026",
    category: "investor_meetings",
    tier: 3,
    priority: 8,
    eventKey: EK.infyConf,
  },
  ...["24-Oct-2026", "25-Oct-2026"].map((d, i) => ({
    id: `fx:infy:newspaper-${i + 1}`,
    isin: ISIN.INFY,
    symbol: "INFY",
    desc: "Copy of Newspaper Publication",
    subject: informed("Infosys Limited", "Copy of Newspaper Publication"),
    at: d,
    category: "unclassified",
    sub: "newspaper",
    tier: 3 as const,
    priority: 4,
    eventKey: [EK.infyNews1, EK.infyNews2][i] as string,
  })),
  // --- Board-meeting intimations (docs/research/21 §8) ---------------------
  ...(
    [
      [
        ISIN.KALYAN,
        "KALYANKJIL",
        "KALYAN JEWELLERS INDIA LIMITED",
        "10-Nov-2026",
        "2026-11-10",
        "03-Nov-2026",
        EK.bmKalyan,
      ],
      [
        ISIN.IDEA,
        "IDEA",
        "Vodafone Idea Limited",
        "12-Nov-2026",
        "2026-11-12",
        "04-Nov-2026",
        EK.bmIdea,
      ],
      [
        ISIN.AMBER,
        "AMBER",
        "Amber Enterprises India Limited",
        "12-Nov-2026",
        "2026-11-12",
        "04-Nov-2026",
        EK.bmAmber,
      ],
      [
        ISIN.TMPV,
        "TMPV",
        "Tata Motors Passenger Vehicles Limited",
        "13-Nov-2026",
        "2026-11-13",
        "05-Nov-2026",
        EK.bmTmpv,
      ],
      [
        ISIN.INOXWIND,
        "INOXWIND",
        "INOX WIND LIMITED",
        "13-Nov-2026",
        "2026-11-13",
        "05-Nov-2026",
        EK.bmInox,
      ],
    ] as const
  ).map(([isin, symbol, name, bmDate, eventDate, filed, eventKey]) => ({
    id: `fx:bm:${symbol.toLowerCase()}`,
    isin,
    symbol,
    desc: "Board Meeting Intimation",
    subject: `${name} has informed the Exchange about Board Meeting to be held on ${bmDate} to inter-alia consider and approve the financial results for the period ended September 30, 2026`,
    at: filed,
    category: "results",
    sub: "bm_intimation",
    tier: 3 as const,
    priority: 15,
    eventKey,
    raw: { eventDate, eventPurpose: "Board meeting · Q2 FY27 results" },
  })),
];

// --- Card payloads (envelopes) ---------------------------------------------

function pctOf(now: number, base: number): number {
  return Math.round(((now - base) / base) * 1000) / 10;
}

function resultsRow(
  metric: ResultsCard["rows"][number]["metric"],
  seriesCr: Array<number | null>,
): ResultsCard["rows"][number] {
  const spark = seriesCr.map((v) => (v == null ? null : v * CR));
  const cur = seriesCr.at(-1) ?? null;
  const prev = seriesCr.at(-2) ?? null;
  const yoy = seriesCr.at(-5) ?? null;
  return {
    metric,
    value: cur == null ? null : cur * CR,
    qoqPct: cur != null && prev != null ? pctOf(cur, prev) : null,
    yoyPct: cur != null && yoy != null ? pctOf(cur, yoy) : null,
    spark,
  };
}

/** RELIANCE consolidated, ₹ cr, oldest → newest: Q2 FY26 … Q2 FY27 (docs/research/05 §7.3). */
const RIL_SERIES = {
  revenue: [258_898, 269_496, 298_621, 311_850, 332_861],
  ebitda: [45_885, 46_018, 44_141, 47_517, 56_616],
  pbt: [29_124, 29_697, 27_195, 30_630, 38_613],
  pat: [22_092, 22_290, 20_589, 23_196, 29_550],
  eps: [13.42, 13.78, 12.54, 15.48, 18.88],
  periods: [
    "2025-09-30",
    "2025-12-31",
    "2026-03-31",
    "2026-06-30",
    "2026-09-30",
  ],
};

const rilCard: ResultsCard = {
  isin: ISIN.RIL,
  basis: "consolidated",
  checksum: "exchange_xbrl",
  rows: [
    resultsRow("revenue", RIL_SERIES.revenue),
    resultsRow("ebitda", RIL_SERIES.ebitda),
    resultsRow("pbt", RIL_SERIES.pbt),
    resultsRow("pat", RIL_SERIES.pat),
  ],
  ebitdaFormula: "pbt+fin+dna-oi",
  sourceUrl: URL.rilXbrl,
};

const hdfcCard: ResultsCard = {
  isin: ISIN.HDFC,
  basis: "consolidated",
  checksum: "preliminary",
  rows: [
    {
      metric: "revenue",
      value: 95_131.63 * CR,
      qoqPct: 5.0,
      yoyPct: 9.4,
      spark: [null, null, null, null, 95_131.63 * CR],
    },
    {
      metric: "pbt",
      value: 28_662.54 * CR,
      qoqPct: null,
      yoyPct: null,
      spark: [null, null, null, null, 28_662.54 * CR],
    },
    {
      metric: "pat",
      value: 21_537.09 * CR,
      qoqPct: null,
      yoyPct: 5.6,
      spark: [null, null, null, null, 21_537.09 * CR],
    },
  ],
  ebitdaFormula: "pbt+fin+dna",
  sourceUrl: URL.hdfcResultsPdf,
};

const EVENTS: Record<
  string,
  { cardType: string; envelope: Record<string, unknown> }
> = {
  [EK.rilResults]: {
    cardType: "results",
    envelope: {
      title: "Q2 FY27: revenue up 28.6%, PAT up 33.8% YoY",
      oneLiner:
        "Consolidated revenue ₹3,32,861 cr and PAT ₹29,550 cr; EBITDA ₹56,616 cr (+19.1% QoQ) on the ex-other-income convention, no exceptional items.",
      priority: 92,
      periodEnd: "2026-09-30",
      sources: [
        { url: URL.rilResultsPdf, kind: "pdf", label: "Results PDF p.10" },
        { url: URL.rilXbrl, kind: "xbrl", label: "XBRL" },
        {
          url: URL.rilTranscript,
          kind: "transcript",
          label: "Analyst meet 30 Oct",
        },
      ],
      card: rilCard,
    },
  },
  [EK.hdfcResults]: {
    cardType: "results",
    envelope: {
      title: "Q2 FY27: PAT ₹21,537 cr, NII ₹44,464 cr",
      oneLiner:
        "Interest earned ₹95,132 cr (+5.0% QoQ, +9.4% YoY); PAT +5.6% YoY. Bank format — NII and operating profit before provisions (₹32,872 cr) stand in for EBITDA.",
      priority: 88,
      periodEnd: "2026-09-30",
      sources: [
        { url: URL.hdfcResultsPdf, kind: "pdf", label: "Results PDF p.9" },
        {
          url: URL.hdfcTranscript,
          kind: "transcript",
          label: "Q2 call transcript",
        },
      ],
      card: hdfcCard,
    },
  },
  [EK.hdfcCco]: {
    cardType: "management_change",
    envelope: {
      title: "Srivatsan appointed Chief Compliance Officer, 3-year term",
      oneLiner:
        "Senior-management appointment; ex-ICICI Bank head of overseas compliance with about 34 years in BFSI.",
      priority: 58,
      sources: [
        { url: URL.hdfcSrivatsan, kind: "filing", label: "Reg 30 filing" },
      ],
      card: {
        person: "V. N. Srivatsan",
        role: "Chief Compliance Officer",
        action: "appointed",
        effective_date: null,
        reason: null,
        brief_profile_excerpt: null,
        profile_summary:
          "Approximately 34 years of overall professional experience, including around 25 years in the BFSI sector and nearly 10 years in compliance and regulatory inspection. Previously Head – Compliance: Overseas Banking and Subsidiaries & Data Privacy Officer at ICICI Bank Limited.",
        prior_roles: [
          "Head – Compliance: Overseas Banking and Subsidiaries & Data Privacy Officer, ICICI Bank Limited",
        ],
        confidence: "high",
        term: "3 years",
      },
    },
  },
  [EK.voltas]: {
    cardType: "management_change",
    envelope: {
      title: "Jayant Balan named MD from May 2027; Noel Tata retires",
      oneLiner:
        "Five-person board reshuffle: Sunil D'Souza becomes Chairman, Venkatesalu Palaniswamy joins as non-executive director. The same PDF was posted five times under different subjects.",
      priority: 86,
      sources: [
        { url: URL.voltasFiling, kind: "filing", label: "Reg 30 filing" },
      ],
      card: {
        person: "Jayant Balan",
        role: "Managing Director",
        action: "appointed",
        effective_date: "2027-05-25",
        reason: null,
        brief_profile_excerpt:
          "Mr. Jayant Balan is a Mechanical Engineer and PGDM from SP Jain Institute of Management & Research. Mr. Balan joined the Tata Group in 1999 as part of the Tata Administrative Service and moved to Voltas in 2001. … CEO of Voltbek Home Appliances Private Limited since 2019 before transitioning to the role of Head – Room Air Conditioner Business of the Company in January 2026.",
        prior_roles: [
          "Head – Room Air Conditioner Business, Voltas (Jan 2026 →)",
          "CEO, Voltbek Home Appliances Pvt Ltd (2019–2026)",
          "Tata Administrative Service 1999; Voltas since 2001",
        ],
        confidence: "high",
        term: "five years",
        others: [
          { person: "Sunil D'Souza", role: "Chairman", action: "appointed" },
          {
            person: "Venkatesalu Palaniswamy",
            role: "Non-Executive Director",
            action: "appointed",
          },
          { person: "Noel N. Tata", role: "Director", action: "retired" },
          { person: "M. Menon", role: "Director", action: "retired" },
        ],
      },
    },
  },
  [EK.supremeResults]: {
    cardType: "oneliner",
    envelope: {
      title: "Q2 FY27: PAT ₹262 cr; FY27 guidance of ₹13,500–14,000 cr held",
      oneLiner:
        "Operating EBITDA ₹431 cr, PBT ₹344 cr after a ₹30 cr associate share; H1 operating margin 13.6% against a 14–14.5% full-year promise.",
      priority: 70,
      periodEnd: "2026-09-30",
      sources: [
        { url: URL.supremeResultsPdf, kind: "pdf", label: "Results PDF p.5" },
        {
          url: URL.supremeTranscript,
          kind: "transcript",
          label: "Q2 call p.8",
        },
      ],
      card: {
        basis: "Consolidated",
        operating_ebitda_cr: 431.01,
        profit_before_tax_cr: 343.91,
        profit_after_tax_cr: 262.44,
        other_income_cr: 8.69,
        share_of_associate_cr: 29.6,
        h1_fy27_revenue_cr: 6078.93,
        h1_fy27_operating_margin_pct: 13.6,
        extraction: "deterministic PDF table read · 4/4 identity checks passed",
        verbatim: [
          "profit_before_tax_cr",
          "profit_after_tax_cr",
          "other_income_cr",
        ],
      },
    },
  },
  [EK.hulDividend]: {
    cardType: "oneliner",
    envelope: {
      title: "Interim dividend ₹19 per share for FY27",
      oneLiner:
        "Declared at the 28 Oct board meeting with the Q2 results; the record date was intimated in a separate filing the same day.",
      priority: 55,
      card: {
        dividend_type: "Interim",
        amount_per_share_inr: 19,
        fiscal_year: "FY 2026-27",
        declared_on: "2026-10-28",
        verbatim: ["amount_per_share_inr", "fiscal_year"],
      },
    },
  },
  [EK.infyDividend]: {
    cardType: "oneliner",
    envelope: {
      title: "Record date 3 Nov for the dividend",
      oneLiner:
        "Exchange text states the record date only; the amount sits in the 23 Oct results outcome.",
      priority: 45,
      card: {
        record_date: "2026-11-03",
        verbatim: ["record_date"],
      },
    },
  },
  [EK.infyCapex]: {
    cardType: "oneliner",
    envelope: {
      title: "Pocharam development centre expansion announced",
      oneLiner:
        "Capacity addition at the Hyderabad campus; amount and timeline are not stated in the exchange text.",
      priority: 42,
      card: {
        what: "Expansion of Pocharam Development Center",
        location: "Hyderabad",
        amount_cr: null,
        timeline: null,
        verbatim: ["what"],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Results quarters (absolute rupees)
// ---------------------------------------------------------------------------

const RESULTS: Array<typeof t.resultsQuarters.$inferInsert> = [
  ...RIL_SERIES.periods.map((periodEnd, i) => {
    const latest = i === RIL_SERIES.periods.length - 1;
    return {
      isin: ISIN.RIL,
      periodEnd,
      basis: "consolidated",
      source: "xbrl",
      audited: false,
      revenue: (RIL_SERIES.revenue[i] as number) * CR,
      otherIncome: latest ? 5_793 * CR : null,
      financeCosts: latest ? 8_481 * CR : null,
      dna: latest ? 15_315 * CR : null,
      pbeit: latest ? 38_613 * CR : null,
      exceptional: latest ? 0 : null,
      pbt: (RIL_SERIES.pbt[i] as number) * CR,
      tax: latest ? 9_363 * CR : null,
      pat: (RIL_SERIES.pat[i] as number) * CR,
      patCont: latest ? 29_250 * CR : null,
      eps: RIL_SERIES.eps[i] as number,
      checksJson: JSON.stringify({
        warnings: latest
          ? []
          : [
              "Prior-quarter line items beyond revenue/PBT/PAT/EPS not in fixture",
            ],
      }),
      sourceUrl: latest ? URL.rilXbrl : null,
      filedAt: latest ? ms("30-Oct-2026 21:32:55") : null,
      updatedAt: NOW,
    };
  }),
  {
    isin: ISIN.RIL,
    periodEnd: "2026-09-30",
    basis: "standalone",
    source: "pdf",
    audited: false,
    revenue: 174_668 * CR,
    pbt: 20_339 * CR,
    pat: 15_354 * CR,
    checksJson: JSON.stringify({ warnings: [] }),
    sourceUrl: URL.rilResultsPdf,
    filedAt: ms("30-Oct-2026 19:42:49"),
    updatedAt: NOW,
  },
  {
    isin: ISIN.HDFC,
    periodEnd: "2026-09-30",
    basis: "consolidated",
    source: "pdf",
    audited: false,
    revenue: 95_131.63 * CR,
    pbt: 28_662.54 * CR,
    pat: 21_537.09 * CR,
    eps: 13.43,
    checksJson: JSON.stringify({
      nii: 44_464.2 * CR,
      ppop: 32_871.54 * CR,
      warnings: [
        "XBRL ProfitLossFromOrdinaryActivitiesBeforeTax 27,825.48 cr differs from the printed 28,662.54 cr (filer deducted minority interest above PBT)",
      ],
    }),
    sourceUrl: URL.hdfcResultsPdf,
    filedAt: ms("17-Oct-2026"),
    updatedAt: NOW,
  },
  {
    isin: ISIN.SUPREME,
    periodEnd: "2026-09-30",
    basis: "consolidated",
    source: "pdf",
    audited: false,
    otherIncome: 8.69 * CR,
    pbt: 343.91 * CR,
    pat: 262.44 * CR,
    checksJson: JSON.stringify({
      warnings: [
        "Revenue and the EBITDA components are not in the fixture; H1 FY27 revenue ₹6,078.93 cr",
      ],
    }),
    sourceUrl: URL.supremeResultsPdf,
    filedAt: ms("26-Oct-2026"),
    updatedAt: NOW,
  },
];

// ---------------------------------------------------------------------------
// Documents + guidance (SUPREMEIND quotes verified verbatim, docs/research/12 §4.2)
// ---------------------------------------------------------------------------

const DOCS: Array<typeof t.documents.$inferInsert> = [
  {
    id: "fx:doc:ril:results-q2fy27",
    isin: ISIN.RIL,
    kind: "results_pdf",
    period: "Q2FY27",
    url: URL.rilResultsPdf,
    pages: 31,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:20:40"),
    announcementId: "fx:ril:results-pdf",
  },
  {
    id: "fx:doc:ril:transcript-q2fy27",
    isin: ISIN.RIL,
    kind: "transcript",
    period: "Q2FY27",
    url: URL.rilTranscript,
    pages: 29,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:22:10"),
  },
  {
    id: "fx:doc:ril:ar-fy26",
    isin: ISIN.RIL,
    kind: "annual_report",
    period: "FY26",
    url: URL.rilAr,
    pages: 187,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:25:02"),
  },
  {
    id: "fx:doc:hdfc:results-q2fy27",
    isin: ISIN.HDFC,
    kind: "results_pdf",
    period: "Q2FY27",
    url: URL.hdfcResultsPdf,
    pages: 24,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:31:00"),
    announcementId: "fx:hdfc:results-pdf",
  },
  {
    id: "fx:doc:hdfc:transcript-q2fy27",
    isin: ISIN.HDFC,
    kind: "transcript",
    period: "Q2FY27",
    url: URL.hdfcTranscript,
    pages: 17,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:31:40"),
  },
  {
    id: "fx:doc:hdfc:ar-fy26",
    isin: ISIN.HDFC,
    kind: "annual_report",
    period: "FY26",
    url: URL.hdfcAr,
    pages: 678,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:34:12"),
  },
  {
    id: "fx:doc:supreme:results-q2fy27",
    isin: ISIN.SUPREME,
    kind: "results_pdf",
    period: "Q2FY27",
    url: URL.supremeResultsPdf,
    pages: 13,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:40:05"),
    announcementId: "fx:supreme:results-pdf",
  },
  {
    id: "fx:doc:supreme:transcript-q2fy27",
    isin: ISIN.SUPREME,
    kind: "transcript",
    period: "Q2FY27",
    url: URL.supremeTranscript,
    pages: 12,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:40:50"),
    announcementId: "fx:supreme:transcript",
  },
  {
    id: "fx:doc:supreme:ar-fy26",
    isin: ISIN.SUPREME,
    kind: "annual_report",
    period: "FY26",
    url: URL.supremeAr,
    pages: 209,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:42:30"),
  },
  {
    id: "fx:doc:hul:ar-fy26",
    isin: ISIN.HUL,
    kind: "annual_report",
    period: "FY26",
    url: URL.hulAr,
    pages: null,
    textStatus: "pending",
  },
  {
    id: "fx:doc:infy:transcript-q2fy27",
    isin: ISIN.INFY,
    kind: "transcript",
    period: "Q2FY27",
    url: URL.infyTranscript,
    pages: 48,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:45:00"),
  },
  {
    id: "fx:doc:infy:ar-fy26",
    isin: ISIN.INFY,
    kind: "annual_report",
    period: "FY26",
    url: URL.infyAr,
    pages: null,
    textStatus: "pending",
  },
  {
    id: "fx:doc:voltas:filing-2026-11-06",
    isin: ISIN.VOLTAS,
    kind: "other",
    period: null,
    url: URL.voltasFiling,
    pages: null,
    textStatus: "ok",
    fetchedAt: ms("08-Nov-2026 17:50:00"),
    announcementId: "fx:voltas:board-1",
  },
];

const SUPREME_CALL = ms("26-Oct-2026");

const GUIDANCE: Array<typeof t.guidance.$inferInsert> = [
  {
    id: "fx:g:supreme:volume-fy27",
    isin: ISIN.SUPREME,
    docId: "fx:doc:supreme:transcript-q2fy27",
    speaker: "M. P. Taparia",
    role: "Managing Director",
    page: 3,
    quote: "we expect company-wide volume growth of about 10% for FY27",
    metric: "volume_growth",
    direction: "absolute",
    low: 10,
    high: 10,
    unit: "%",
    horizon: "FY27",
    status: "open",
    evidenceJson: JSON.stringify({
      statedAt: SUPREME_CALL,
      turn: 2,
      quoteVerified: true,
    }),
    createdAt: NOW,
  },
  {
    id: "fx:g:supreme:margin-fy27",
    isin: ISIN.SUPREME,
    docId: "fx:doc:supreme:transcript-q2fy27",
    speaker: "M. P. Taparia",
    role: "Managing Director",
    page: 7,
    quote: "margin guidance for the full year at 14% to 14.5%",
    metric: "operating_margin",
    direction: "range",
    low: 14,
    high: 14.5,
    unit: "%",
    horizon: "FY27",
    status: "open",
    evidenceJson: JSON.stringify({
      statedAt: SUPREME_CALL,
      turn: 34,
      quoteVerified: true,
      delivered: {
        value: 13.6,
        unit: "%",
        source:
          "H1 FY27 operating EBITDA ₹828.96 cr / revenue ₹6,078.93 cr (results PDF)",
      },
    }),
    createdAt: NOW,
  },
  {
    id: "fx:g:supreme:capex-fy27",
    isin: ISIN.SUPREME,
    docId: "fx:doc:supreme:transcript-q2fy27",
    speaker: "M. P. Taparia",
    role: "Managing Director",
    page: 7,
    quote: "Outflow should not be more than INR700 crores to INR750 crores",
    metric: "capex",
    direction: "range",
    low: 700,
    high: 750,
    unit: "INR_cr",
    horizon: "FY27",
    status: "open",
    evidenceJson: JSON.stringify({
      statedAt: SUPREME_CALL,
      turn: 45,
      quoteVerified: true,
    }),
    createdAt: NOW,
  },
  {
    id: "fx:g:supreme:revenue-fy27",
    isin: ISIN.SUPREME,
    docId: "fx:doc:supreme:transcript-q2fy27",
    speaker: "M. P. Taparia",
    role: "Managing Director",
    page: 8,
    quote:
      "FY27, we expect our business to grow between INR13,500 crores to INR14,000 crores, operating margin between 14% to 14.5%",
    metric: "revenue",
    direction: "range",
    low: 13_500,
    high: 14_000,
    unit: "INR_cr",
    horizon: "FY27",
    status: "open",
    evidenceJson: JSON.stringify({
      statedAt: SUPREME_CALL,
      turn: 60,
      quoteVerified: true,
      delivered: {
        value: 6078.93,
        unit: "INR_cr",
        source: "H1 FY27 revenue (results PDF)",
      },
    }),
    createdAt: NOW,
  },
  {
    id: "fx:g:hdfc:lcr",
    isin: ISIN.HDFC,
    docId: "fx:doc:hdfc:transcript-q2fy27",
    speaker: null,
    role: "Management",
    page: 16,
    quote: "we would like to operate between 110 and 120",
    metric: "liquidity_coverage_ratio",
    direction: "range",
    low: 110,
    high: 120,
    unit: "%",
    horizon: "medium_term",
    status: "open",
    evidenceJson: JSON.stringify({
      statedAt: ms("17-Oct-2026"),
      turn: 66,
      quoteVerified: true,
    }),
    createdAt: NOW,
  },
];

// ---------------------------------------------------------------------------
// Prices — real anchors + deterministic infill
// ---------------------------------------------------------------------------

interface Anchor {
  close?: number;
  pct?: number;
  ratio?: number;
  volume?: number;
}

interface PriceSpec {
  isin: string;
  baseVolume: number;
  anchors: Record<string, Anchor>;
}

const PRICES: PriceSpec[] = [
  {
    isin: ISIN.RIL,
    baseVolume: 15_100_000,
    anchors: {
      "2026-11-02": { close: 1300.0, pct: 11.6, volume: 88_121_121 },
      "2026-11-03": { pct: 0.61, ratio: 2.27 },
      "2026-11-06": { close: 1320.0, pct: 0.5, volume: 22_768_301 },
      "2026-11-08": { ratio: 0.203, pct: 0.2 },
    },
  },
  {
    isin: ISIN.HDFC,
    baseVolume: 30_200_000,
    anchors: {
      "2026-11-05": { pct: 3.16, ratio: 2.17 },
      "2026-11-06": { close: 788.25, pct: 3.72, volume: 73_482_878 },
      "2026-11-08": { ratio: 0.226, pct: 0.1 },
    },
  },
  {
    isin: ISIN.HUL,
    baseVolume: 1_430_000,
    anchors: {
      "2026-10-14": { pct: 1.07, ratio: 2.54 },
      "2026-10-27": { pct: -0.03, ratio: 2.71 },
      "2026-10-28": { pct: -0.12, ratio: 2.18 },
      "2026-11-06": { close: 1998.4, pct: 0.83, volume: 1_058_803 },
      "2026-11-08": { ratio: 0.082, pct: 0.1 },
    },
  },
  {
    isin: ISIN.INFY,
    baseVolume: 15_900_000,
    anchors: {
      "2026-10-23": { pct: 0.04, ratio: 2.15 },
      "2026-11-06": { close: 1181.4, pct: 1.2, volume: 15_301_109 },
      "2026-11-08": { ratio: 0.06, pct: 0.1 },
    },
  },
  {
    isin: ISIN.SUPREME,
    baseVolume: 172_500,
    anchors: {
      "2026-10-14": { pct: 2.85, ratio: 2.14 },
      "2026-10-26": { close: 3250.0, pct: -4.13, ratio: 4.3 },
      "2026-11-06": { close: 3156.9, pct: -4.07, volume: 504_269 },
      "2026-11-08": { ratio: 0.216, pct: -0.1 },
    },
  },
];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seedFrom(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function genPrices(spec: PriceSpec): Array<typeof t.prices.$inferInsert> {
  const days = tradingDaysBetween("2026-08-10", "2026-11-08");
  const rnd = lcg(seedFrom(spec.isin));
  const n = days.length;
  const pct: number[] = new Array(n);
  const fixed: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const a = spec.anchors[days[i] as string];
    if (a?.pct != null) {
      pct[i] = a.pct;
      fixed[i] = true;
    } else {
      // triangular noise in ±1.4%, slightly mean-reverting
      pct[i] = (rnd() + rnd() - 1) * 1.4;
    }
  }
  // known closes → scale the free days between consecutive anchors so the chain matches
  const knownIdx = days
    .map((d, i) => (spec.anchors[d]?.close != null ? i : -1))
    .filter((i) => i >= 0);
  for (let k = 0; k + 1 < knownIdx.length; k++) {
    const a = knownIdx[k] as number;
    const b = knownIdx[k + 1] as number;
    const required =
      (spec.anchors[days[b] as string]?.close as number) /
      (spec.anchors[days[a] as string]?.close as number);
    let fixedProduct = 1;
    const free: number[] = [];
    for (let i = a + 1; i <= b; i++) {
      if (fixed[i]) fixedProduct *= 1 + (pct[i] as number) / 100;
      else free.push(i);
    }
    if (!free.length) continue;
    const target = (required / fixedProduct) ** (1 / free.length) - 1;
    const mean = free.reduce((s, i) => s + (pct[i] as number), 0) / free.length;
    for (const i of free)
      pct[i] = target * 100 + ((pct[i] as number) - mean) * 0.5;
  }
  const closes: number[] = new Array(n);
  const last = knownIdx.at(-1);
  if (last === undefined) throw new Error(`no close anchor for ${spec.isin}`);
  closes[last] = spec.anchors[days[last] as string]?.close as number;
  for (let i = last + 1; i < n; i++)
    closes[i] = (closes[i - 1] as number) * (1 + (pct[i] as number) / 100);
  for (let i = last - 1; i >= 0; i--)
    closes[i] = (closes[i + 1] as number) / (1 + (pct[i + 1] as number) / 100);
  // snap every known close exactly; the residual lands in the adjacent infill day
  for (const i of knownIdx)
    closes[i] = spec.anchors[days[i] as string]?.close as number;

  const rows: Array<typeof t.prices.$inferInsert> = [];
  const trailing: number[] = [];
  for (let i = 0; i < n; i++) {
    const date = days[i] as string;
    const a = spec.anchors[date];
    const special = date === "2026-11-08";
    const avg =
      trailing.length >= 5
        ? trailing.reduce((s, v) => s + v, 0) / trailing.length
        : spec.baseVolume;
    let volume: number;
    if (a?.volume != null) volume = a.volume;
    else if (a?.ratio != null) volume = Math.round(a.ratio * avg);
    else volume = Math.round(spec.baseVolume * (0.72 + 0.56 * rnd()));
    const close = Math.round((closes[i] as number) * 100) / 100;
    const prevClose =
      i > 0 ? Math.round((closes[i - 1] as number) * 100) / 100 : null;
    const open =
      prevClose == null
        ? close
        : Math.round(prevClose * (1 + (rnd() - 0.5) * 0.006) * 100) / 100;
    const hi =
      Math.round(Math.max(open, close) * (1 + rnd() * 0.006) * 100) / 100;
    const lo =
      Math.round(Math.min(open, close) * (1 - rnd() * 0.006) * 100) / 100;
    rows.push({
      isin: spec.isin,
      date,
      open,
      high: hi,
      low: lo,
      close,
      prevClose,
      volume,
      turnover: Math.round(volume * close),
      trades: null,
      sessionType: special ? "special" : "normal",
      source: "fixture",
    });
    if (!special) {
      trailing.push(volume);
      if (trailing.length > 20) trailing.shift();
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// User, tripwires, alerts, ledger, cache, jobs
// ---------------------------------------------------------------------------

const DEMO = "demo";
const PORTFOLIO = COMPANIES.map((c) => c.isin);

const TRIPWIRES: Array<typeof t.tripwires.$inferInsert> = [
  {
    id: "demo:volume_ratio",
    userId: DEMO,
    ruleJson: JSON.stringify({
      kind: "volume_ratio",
      params: { ratio: 2, lookbackDays: 20 },
    }),
    enabled: true,
    createdAt: ms("01-Nov-2026 09:00:00"),
  },
  {
    id: "demo:price_move",
    userId: DEMO,
    ruleJson: JSON.stringify({ kind: "price_move", params: { pct: 5 } }),
    enabled: true,
    createdAt: ms("01-Nov-2026 09:00:01"),
  },
  {
    id: "demo:category",
    userId: DEMO,
    ruleJson: JSON.stringify({
      kind: "category",
      params: {
        categories: [
          "results",
          "m_and_a",
          "management_change",
          "pledging",
          "credit_rating",
          "litigation",
        ],
      },
    }),
    enabled: true,
    createdAt: ms("01-Nov-2026 09:00:02"),
  },
];

const ALERTS: Array<typeof t.alerts.$inferInsert> = [
  {
    id: "fx:alert:ril-2nov",
    userId: DEMO,
    isin: ISIN.RIL,
    kind: "anomaly",
    tripwireId: "demo:price_move",
    payloadJson: JSON.stringify({
      title: "RELIANCE up 11.6% on 5.8× volume",
      body: "Close ₹1,300.0 · 8.81 cr shares against a 20-day average of about 1.5 cr · three sessions after Q2 results",
      because:
        "Price move beyond ±5% in a day · volume over 2× its 20-day average",
      symbol: "RELIANCE",
    }),
    firedAt: ms("02-Nov-2026 19:04:12"),
    deliveredViaJson: JSON.stringify({
      inbox: "sent",
      telegram: "sent",
      webpush: "failed:410",
    }),
    readAt: ms("02-Nov-2026 21:10:00"),
  },
  {
    id: "fx:alert:voltas-6nov",
    userId: DEMO,
    isin: ISIN.VOLTAS,
    kind: "announcement",
    eventKey: EK.voltas,
    payloadJson: JSON.stringify({
      title: "VOLTAS: Jayant Balan named MD from May 2027",
      body: "Board reshuffle filed 17:20 IST — Noel Tata retires, Sunil D'Souza to chair. Brief profile taken from the filing.",
      because:
        "Category you always surface: management change (MD / CEO / board)",
      symbol: "VOLTAS",
    }),
    firedAt: ms("06-Nov-2026 17:31:05"),
    deliveredViaJson: JSON.stringify({ inbox: "sent", telegram: "sent" }),
    readAt: null,
  },
  {
    id: "fx:alert:hdfc-6nov",
    userId: DEMO,
    isin: ISIN.HDFC,
    kind: "announcement",
    eventKey: EK.hdfcCco,
    payloadJson: JSON.stringify({
      title: "HDFCBANK: Srivatsan appointed Chief Compliance Officer",
      body: "Senior-management appointment, three-year term; ex-ICICI Bank compliance head.",
      because: "Category you always surface: management change",
      symbol: "HDFCBANK",
    }),
    firedAt: ms("06-Nov-2026 15:35:40"),
    deliveredViaJson: JSON.stringify({ inbox: "sent", telegram: "sent" }),
    readAt: ms("06-Nov-2026 18:02:00"),
  },
  {
    id: "fx:alert:digest-6nov",
    userId: DEMO,
    isin: null,
    kind: "digest",
    payloadJson: JSON.stringify({
      title: "Evening edition · Fri 6 Nov",
      body: "1 needs you, 2 worth knowing, 9 filed away. Read in about 2 minutes.",
      because: "Daily edition after the close",
    }),
    firedAt: ms("06-Nov-2026 20:30:00"),
    deliveredViaJson: JSON.stringify({ inbox: "sent", telegram: "sent" }),
    readAt: null,
  },
  {
    id: "fx:alert:supreme-26oct",
    userId: DEMO,
    isin: ISIN.SUPREME,
    kind: "tripwire",
    tripwireId: "demo:volume_ratio",
    payloadJson: JSON.stringify({
      title: "SUPREMEIND volume 4.3× its 20-day average",
      body: "Close ₹3,250.0, down 4.1% on results day; price rule (±5%) did not fire.",
      because: "Volume over 2× its 20-day average",
      symbol: "SUPREMEIND",
    }),
    firedAt: ms("26-Oct-2026 19:02:48"),
    deliveredViaJson: JSON.stringify({ inbox: "sent" }),
    readAt: ms("27-Oct-2026 08:15:00"),
  },
];

const DATE_PT = formatInTimeZone(
  new Date(NOW),
  "America/Los_Angeles",
  "yyyy-MM-dd",
);

const LEDGER: Array<typeof t.llmLedger.$inferInsert> = [
  {
    model: "gemini-3.5-flash-lite",
    datePt: DATE_PT,
    requests: 41,
    tokensIn: 106_538,
    tokensOut: 13_079,
    tokensThought: 0,
    errors: 1,
    updatedAt: NOW,
  },
  {
    model: "gemini-3.6-flash",
    datePt: DATE_PT,
    requests: 3,
    tokensIn: 21_406,
    tokensOut: 2_212,
    tokensThought: 1_840,
    errors: 0,
    updatedAt: NOW,
  },
  {
    model: "gemma-4-26b-a4b-it",
    datePt: DATE_PT,
    requests: 12,
    tokensIn: 18_204,
    tokensOut: 2_931,
    tokensThought: 0,
    errors: 1,
    updatedAt: NOW,
  },
];

const CACHE: Array<typeof t.llmCache.$inferInsert> = [
  ...[
    "oneliner",
    "oneliner",
    "oneliner",
    "oneliner",
    "oneliner",
    "oneliner",
    "bio",
    "bio",
    "guidance_extract",
    "guidance_extract",
    "guidance_extract",
    "classify_residue",
    "classify_residue",
    "classify_residue",
    "classify_residue",
  ].map((task, i) => ({
    key: `fx:cache:${task}:${i}`,
    task,
    model:
      task === "bio" || task === "guidance_extract"
        ? "gemini-3.5-flash-lite"
        : "gemma-4-26b-a4b-it",
    promptVersion: "v1",
    responseJson: "{}",
    tokensIn: 2_400 + i * 37,
    tokensOut: 310 + i * 5,
    createdAt: NOW - (i + 1) * 3_600_000,
  })),
];

const JOBS: Array<typeof t.jobs.$inferInsert> = [
  {
    id: "fx:job:announcements",
    kind: "announcements",
    isin: null,
    step: "done",
    state: "done",
    logJson: JSON.stringify([
      {
        at: CHECKED_AT - 4_000,
        step: "fetch_announcements",
        msg: "NSE market-wide window 06→08 Nov: 458 rows in 1.4 s",
      },
      {
        at: CHECKED_AT - 2_500,
        step: "fetch_announcements",
        msg: "filtered to 11 portfolio ISINs: 2 new, 0 re-posts",
      },
      {
        at: CHECKED_AT,
        step: "done",
        msg: "classified by rules: 2/2 · LLM residue 0",
      },
    ]),
    createdAt: CHECKED_AT - 5_000,
    updatedAt: CHECKED_AT,
  },
  {
    id: "fx:job:prices",
    kind: "prices",
    isin: null,
    step: "done",
    state: "done",
    logJson: JSON.stringify([
      {
        at: ms("06-Nov-2026 19:01:10"),
        step: "fetch_prices",
        msg: "bhavcopy 2026-11-06: 3,716 instruments, 205 KB",
      },
      {
        at: ms("06-Nov-2026 19:01:12"),
        step: "done",
        msg: "anomaly scan: 2 hits at 2×/±5% (HDFCBANK 2.31×, SUPREMEIND 2.39×)",
      },
    ]),
    createdAt: ms("06-Nov-2026 19:01:00"),
    updatedAt: ms("06-Nov-2026 19:01:12"),
  },
  {
    id: "fx:job:research-supreme",
    kind: "research",
    isin: ISIN.SUPREME,
    step: "done",
    state: "done",
    logJson: JSON.stringify([
      {
        at: ms("08-Nov-2026 17:40:00"),
        step: "resolve_company",
        msg: "SUPREMEIND → INE195A01028 (EQ)",
      },
      {
        at: ms("08-Nov-2026 17:40:05"),
        step: "fetch_results",
        msg: "results PDF 13 pp · consolidated P&L on p.5 · 4/4 identity checks",
      },
      {
        at: ms("08-Nov-2026 17:40:50"),
        step: "fetch_documents",
        msg: "transcript 12 pp (111 turns) · AR FY26 209 pp",
      },
      {
        at: ms("08-Nov-2026 17:41:20"),
        step: "extract_guidance",
        msg: "4 guidance statements · 4/4 quotes verified verbatim",
      },
      {
        at: ms("08-Nov-2026 17:41:21"),
        step: "done",
        msg: "ledger: 4 open promises, settle with Q4 FY27",
      },
    ]),
    createdAt: ms("08-Nov-2026 17:39:58"),
    updatedAt: ms("08-Nov-2026 17:41:21"),
  },
];

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function upsertCompanies(): Promise<void> {
  for (const c of COMPANIES) {
    const row = {
      isin: c.isin,
      nseSymbol: c.nseSymbol,
      bseCode: c.bseCode,
      name: c.name,
      sector: c.sector,
      industry: c.industry,
      aliasesJson: JSON.stringify(c.aliases ?? []),
      screenerSlug: c.screenerSlug,
      inPortfolio: true,
      isAdhoc: false,
    };
    await db
      .insert(t.companies)
      .values(row)
      .onConflictDoUpdate({
        target: t.companies.isin,
        set: {
          nseSymbol: row.nseSymbol,
          bseCode: row.bseCode,
          name: row.name,
          sector: row.sector,
          industry: row.industry,
          screenerSlug: row.screenerSlug,
          inPortfolio: true,
        },
      });
  }
}

async function upsertAnnouncementsAndEvents(): Promise<{
  anns: number;
  events: number;
}> {
  // drop fixture events from earlier runs whose key convention has changed
  await db
    .delete(t.events)
    .where(sql`${t.events.eventKey} LIKE '%|unclassified|board_meeting|%'`);

  // Real ingest wins: once a company has non-fixture announcements, the
  // fixture filings for it are removed and not re-inserted.
  const realRows = await db
    .select({ isin: t.announcements.isin })
    .from(t.announcements)
    .where(sql`${t.announcements.id} NOT LIKE 'fx:%'`)
    .groupBy(t.announcements.isin);
  const realIsins = new Set(realRows.map((r) => r.isin));
  if (realIsins.size) {
    const list = [...realIsins];
    await db
      .delete(t.announcements)
      .where(
        and(
          inArray(t.announcements.isin, list),
          sql`${t.announcements.id} LIKE 'fx:%' AND ${t.announcements.id} NOT LIKE 'fx:bm:%'`,
        ),
      );
    await db
      .delete(t.events)
      .where(
        and(
          inArray(t.events.isin, list),
          sql`${t.events.announcementIdsJson} LIKE '%"fx:%' AND ${t.events.announcementIdsJson} NOT LIKE '%"fx:bm:%'`,
        ),
      );
    const skipped = COMPANIES.filter((c) => realIsins.has(c.isin)).map(
      (c) => c.nseSymbol,
    );
    if (skipped.length)
      console.log(
        `filings         real ingest present for ${skipped.join(", ")} — fixture filings skipped`,
      );
  }

  const byEvent = new Map<string, AnnSpec[]>();
  for (const a of ANNS) {
    // calendar intimations come from NSE's event-calendar, which the announcements
    // feed does not carry — keep them even when real filings exist
    if (realIsins.has(a.isin) && !a.raw?.eventDate) continue;
    const filedAt = ms(a.at);
    await db
      .insert(t.announcements)
      .values({
        id: a.id,
        isin: a.isin,
        symbol: a.symbol,
        exchange: "NSE",
        desc: a.desc,
        subject: a.subject,
        text: a.text ?? a.subject,
        attachmentUrl: a.url ?? null,
        attachmentSize: a.size ?? null,
        hasXbrl: a.xbrl ?? false,
        filedAt,
        filedAtIst: a.at,
        category: a.category,
        subcategory: a.sub ?? null,
        classifiedBy: "rule",
        priority: a.priority,
        tier: a.tier,
        eventKey: a.eventKey,
        voiceSummary: a.voice ?? null,
        rawJson: JSON.stringify({
          ...(a.raw ?? {}),
          fixture: true,
          desc: a.desc,
        }),
        createdAt: CHECKED_AT,
      })
      .onConflictDoUpdate({
        target: t.announcements.id,
        set: {
          desc: a.desc,
          subject: a.subject,
          text: a.text ?? a.subject,
          attachmentUrl: a.url ?? null,
          attachmentSize: a.size ?? null,
          hasXbrl: a.xbrl ?? false,
          filedAt,
          filedAtIst: a.at,
          category: a.category,
          subcategory: a.sub ?? null,
          priority: a.priority,
          tier: a.tier,
          eventKey: a.eventKey,
          rawJson: JSON.stringify({
            ...(a.raw ?? {}),
            fixture: true,
            desc: a.desc,
          }),
          createdAt: CHECKED_AT,
        },
      });
    const l = byEvent.get(a.eventKey) ?? [];
    l.push(a);
    byEvent.set(a.eventKey, l);
  }
  for (const [eventKey, list] of byEvent) {
    const times = list.map((a) => ms(a.at));
    const spec = EVENTS[eventKey];
    const first = list[0] as AnnSpec;
    const row = {
      eventKey,
      isin: first.isin,
      category: first.category,
      firstAt: Math.min(...times),
      lastAt: Math.max(...times),
      tier: Math.min(...list.map((a) => a.tier)),
      cardType: spec?.cardType ?? "routine",
      cardJson: JSON.stringify(spec?.envelope ?? {}),
      announcementIdsJson: JSON.stringify(list.map((a) => a.id)),
      updatedAt: NOW,
    };
    // an event row written by the real ingest under the same key is left alone
    await db.insert(t.events).values(row).onConflictDoNothing();
  }
  return {
    anns: ANNS.filter((a) => !realIsins.has(a.isin) || a.raw?.eventDate).length,
    events: byEvent.size,
  };
}

async function upsertResults(): Promise<number> {
  for (const r of RESULTS) {
    // never overwrite a row the real XBRL/PDF ingest has written
    await db.insert(t.resultsQuarters).values(r).onConflictDoNothing();
  }
  return RESULTS.length;
}

async function upsertDocsAndGuidance(): Promise<{
  docs: number;
  guidance: number;
}> {
  // documents.url is unique and the real ingest may already hold the same
  // PDF under its own id — real rows win; fixture guidance then points at them.
  const docIdMap = new Map<string, string>();
  let inserted = 0;
  for (const d of DOCS) {
    const existing = await db
      .select({ id: t.documents.id })
      .from(t.documents)
      .where(eq(t.documents.url, d.url))
      .limit(1);
    if (existing[0] && existing[0].id !== d.id) {
      docIdMap.set(d.id, existing[0].id);
      continue;
    }
    await db
      .insert(t.documents)
      .values({ ...d, createdAt: NOW })
      .onConflictDoNothing();
    inserted++;
  }
  // once the real extractor has written guidance for a company, its fixture rows go
  const realG = await db
    .select({ isin: t.guidance.isin })
    .from(t.guidance)
    .where(sql`${t.guidance.id} NOT LIKE 'fx:%'`)
    .groupBy(t.guidance.isin);
  const realGuidanceIsins = new Set(realG.map((r) => r.isin));
  if (realGuidanceIsins.size)
    await db
      .delete(t.guidance)
      .where(
        and(
          inArray(t.guidance.isin, [...realGuidanceIsins]),
          sql`${t.guidance.id} LIKE 'fx:%'`,
        ),
      );
  let guidanceInserted = 0;
  for (const g of GUIDANCE) {
    if (realGuidanceIsins.has(g.isin)) continue;
    const row = { ...g, docId: docIdMap.get(g.docId) ?? g.docId };
    await db.insert(t.guidance).values(row).onConflictDoNothing();
    guidanceInserted++;
  }
  return { docs: inserted, guidance: guidanceInserted };
}

async function replacePrices(): Promise<number> {
  const isins = PRICES.map((p) => p.isin);
  await db
    .delete(t.prices)
    .where(and(inArray(t.prices.isin, isins), eq(t.prices.source, "fixture")));
  let n = 0;
  for (const spec of PRICES) {
    const rows = genPrices(spec);
    for (const r of rows) {
      // real bhavcopy bars win; fixture bars only fill dates nobody has
      await db.insert(t.prices).values(r).onConflictDoNothing();
      n++;
    }
  }
  return n;
}

async function upsertUserAndAlerts(): Promise<void> {
  const existing = await db
    .select()
    .from(t.users)
    .where(eq(t.users.id, DEMO))
    .limit(1);
  const prior = existing[0]
    ? (JSON.parse(existing[0].portfolioIsinsJson) as string[])
    : [];
  const merged = [...new Set([...prior, ...PORTFOLIO])];
  await db
    .insert(t.users)
    .values({
      id: DEMO,
      portfolioIsinsJson: JSON.stringify(merged),
      prefsJson: JSON.stringify({
        windowHours: 24,
        theme: "auto",
        quietCategories: [],
      }),
      pushSubscriptionsJson: "[]",
      createdAt: ms("01-Nov-2026 08:55:00"),
      lastSeenAt: NOW,
    })
    .onConflictDoUpdate({
      target: t.users.id,
      set: { portfolioIsinsJson: JSON.stringify(merged), lastSeenAt: NOW },
    });
  for (const w of TRIPWIRES) {
    await db
      .insert(t.tripwires)
      .values(w)
      .onConflictDoUpdate({
        target: t.tripwires.id,
        set: { ruleJson: w.ruleJson, enabled: true },
      });
  }
  for (const a of ALERTS) {
    await db
      .insert(t.alerts)
      .values(a)
      .onConflictDoUpdate({ target: t.alerts.id, set: { ...a } });
  }
}

async function upsertLedgerCacheJobs(): Promise<void> {
  // Never write llm_ledger or llm_cache. An earlier seeder reset the
  // Flash-Lite request count with onConflictDoUpdate and defeated the daily cap.
  for (const j of JOBS) {
    await db.insert(t.jobs).values(j).onConflictDoNothing();
  }
}

async function main(): Promise<void> {
  console.log(
    "┌──────────────────────────────────────────────────────────────┐",
  );
  console.log(
    "│  FINN FIXTURES — labelled UI fixture set (not an ingest run)   │",
  );
  console.log(
    "│  prices.source = 'fixture' · ids prefixed fx: · user 'demo'    │",
  );
  console.log(
    "└──────────────────────────────────────────────────────────────┘",
  );
  await upsertCompanies();
  console.log(
    `companies        ${COMPANIES.length} upserted (6 rich + 5 calendar-only)`,
  );
  const ae = await upsertAnnouncementsAndEvents();
  console.log(`announcements    ${ae.anns} · events ${ae.events}`);
  console.log(`results_quarters ${await upsertResults()}`);
  const dg = await upsertDocsAndGuidance();
  console.log(
    `documents        ${dg.docs} · guidance ${dg.guidance} (SUPREMEIND quotes verbatim)`,
  );
  console.log(
    `prices           ${await replacePrices()} bars (real anchors, fixture infill)`,
  );
  await upsertUserAndAlerts();
  console.log(
    `users/tripwires  demo · ${TRIPWIRES.length} rules · ${ALERTS.length} alerts`,
  );
  await upsertLedgerCacheJobs();
  console.log(
    `llm_ledger       skipped (${LEDGER.length} fixture rows not applied) · llm_cache skipped (${CACHE.length}) · jobs ${JOBS.length} insert-if-absent`,
  );
  console.log("done — open http://localhost:3000/?w=30d");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
