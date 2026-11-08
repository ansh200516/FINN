/**
 * Active Drizzle schema.
 *
 * `postgres://` and `postgresql://` use the Postgres tables in `schema.pg.ts`.
 * `file:` and `libsql:` keep the SQLite tables (and `drizzle/` migrations).
 * Call sites stay typed against the SQLite models; the column names match.
 */
import { env } from "../lib/env";
import { isPostgresUrl } from "./dialect";
import * as pg from "./schema.pg";
import * as sqlite from "./schema.sqlite";

const src = isPostgresUrl(env().DATABASE_URL) ? pg : sqlite;

export const companies = src.companies as typeof sqlite.companies;
export const prices = src.prices as typeof sqlite.prices;
export const announcements = src.announcements as typeof sqlite.announcements;
export const events = src.events as typeof sqlite.events;
export const resultsQuarters =
  src.resultsQuarters as typeof sqlite.resultsQuarters;
export const documents = src.documents as typeof sqlite.documents;
export const guidance = src.guidance as typeof sqlite.guidance;
export const facts = src.facts as typeof sqlite.facts;
export const researchSections =
  src.researchSections as typeof sqlite.researchSections;
export const users = src.users as typeof sqlite.users;
export const tripwires = src.tripwires as typeof sqlite.tripwires;
export const alerts = src.alerts as typeof sqlite.alerts;
export const llmLedger = src.llmLedger as typeof sqlite.llmLedger;
export const llmCache = src.llmCache as typeof sqlite.llmCache;
export const jobs = src.jobs as typeof sqlite.jobs;
export const documentPages = src.documentPages as typeof sqlite.documentPages;
export const documentMeta = src.documentMeta as typeof sqlite.documentMeta;

export type {
  AlertRow,
  AnnouncementRow,
  Company,
  DocumentRow,
  EventRow,
  FactRow,
  GuidanceRow,
  JobRow,
  LlmCacheRow,
  LlmLedgerRow,
  NewAnnouncementRow,
  NewCompany,
  PriceRow,
  ResearchSectionRow,
  ResultsQuarterRow,
  TripwireRow,
  UserRow,
} from "./schema.sqlite";
export type { DocumentMetaRow, DocumentPageRow } from "./schema-docs";
