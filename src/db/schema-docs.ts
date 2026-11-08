/**
 * Document text storage (owner: Builder C — documents / guidance / ledger).
 *
 * `document_pages` holds the extracted text of every PDF page so that a
 * citation `{docId, page}` can be resolved to the exact page text on Vercel
 * (no filesystem). `document_meta` carries the per-document facts that the
 * shared `documents` table has no columns for (where the document came from,
 * when it was published, how good the text layer is).
 *
 * Re-exported from `./schema` so drizzle-kit and `db.query` see both tables.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

export const documentPages = sqliteTable(
  "document_pages",
  {
    /** documents.id */
    docId: text("doc_id").notNull(),
    /** 1-indexed PDF page (what a viewer's `#page=N` expects) */
    page: integer("page").notNull(),
    text: text("text").notNull().default(""),
    /** non-whitespace characters on the page (< 200 ⇒ low-text / scanned) */
    chars: integer("chars").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.docId, t.page] }),
    index("document_pages_doc_idx").on(t.docId),
  ],
);

export const documentMeta = sqliteTable("document_meta", {
  /** documents.id */
  docId: text("doc_id").primaryKey(),
  /** 'nse' | 'bse' | 'screener' | 'ir' */
  source: text("source").notNull().default("nse"),
  /** exchange filing / publication time, ms UTC (null when unknown) */
  publishedAt: integer("published_at"),
  /** human title from the source listing (announcement text, link label) */
  title: text("title"),
  /** 'ok' | 'mixed' | 'low' | 'scanned' */
  textQuality: text("text_quality").notNull().default("ok"),
  /** total non-whitespace characters across pages */
  chars: integer("chars").notNull().default(0),
  /** pages with < 200 characters */
  lowTextPages: integer("low_text_pages").notNull().default(0),
  /** true when pages were 2-up spreads split at the midline */
  spreads: integer("spreads", { mode: "boolean" }).notNull().default(false),
  /** downloaded bytes */
  bytes: integer("bytes"),
  /** transcript: parsed turn count; AR: mapped section count — JSON { turns, mgmtTurns, sections, callDate, ... } */
  structureJson: text("structure_json").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull().default(nowMs),
});

export type DocumentPageRow = typeof documentPages.$inferSelect;
export type DocumentMetaRow = typeof documentMeta.$inferSelect;
