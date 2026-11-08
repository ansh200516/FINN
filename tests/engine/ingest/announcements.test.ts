import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { db, getDb } from "@/db/client";
import { announcements, companies, events } from "@/db/schema";
import {
  type CardPayload,
  ingestAnnouncements,
} from "@/engine/ingest/announcements";
import type { AnnouncementRaw } from "@/engine/types";

interface Fixture {
  items: Array<{
    raw: AnnouncementRaw;
    label: { category: string; tier: number };
  }>;
}
const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "data/seed/fixtures/announcements-labelled.json"),
    "utf8",
  ),
) as Fixture;

const RELIANCE = fixture.items
  .filter((i) => i.raw.symbol === "RELIANCE")
  .map((i) => i.raw);
const SUPREME = fixture.items
  .filter((i) => i.raw.symbol === "SUPREMEIND")
  .map((i) => i.raw);

beforeAll(async () => {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  await db.insert(companies).values([
    {
      isin: "INE002A01018",
      nseSymbol: "RELIANCE",
      name: "Reliance Industries Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    },
    {
      isin: "INE195A01028",
      nseSymbol: "SUPREMEIND",
      name: "Supreme Industries Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    },
  ]);
});

describe("ingestAnnouncements (in-memory DB, no LLM, no attachments)", () => {
  it("stores rows, groups events, folds results follow-ups and re-posts, and is idempotent", async () => {
    const r1 = await ingestAnnouncements([...RELIANCE, ...SUPREME], {
      llm: false,
      attachments: false,
    });
    expect(r1.errors).toEqual([]);
    expect(r1.inserted).toBe(RELIANCE.length + SUPREME.length);
    expect(r1.updated).toBe(0);
    expect(r1.reposts).toBe(0); // the two identical RELIANCE outcome rows are not both in the fixture
    expect(r1.eventsByTier[1]).toBeGreaterThanOrEqual(3);
    const rows = await db.select().from(announcements);
    expect(rows).toHaveLength(RELIANCE.length + SUPREME.length);

    // SUPREMEIND 26 Oct: results outcome + dividend + record date + press release + deck×2 + newspaper + recording + transcript
    const evs = await db.select().from(events);
    const supremeResults = evs.find(
      (e) => e.eventKey === "INE195A01028|results|2026-10-26",
    );
    expect(supremeResults).toBeDefined();
    const ids = JSON.parse(
      supremeResults?.announcementIdsJson ?? "[]",
    ) as string[];
    expect(ids.length).toBeGreaterThanOrEqual(6); // outcome, press release, two decks, newspaper, recording, transcript
    expect(supremeResults?.tier).toBe(1);
    expect(supremeResults?.cardType).toBe("results");
    const payload = JSON.parse(supremeResults?.cardJson ?? "{}") as CardPayload;
    expect(payload.title).toMatch(/Q2 FY27 results filed|results filed/i);
    expect(payload.sources.length).toBeGreaterThanOrEqual(4);
    expect(payload.sources.some((s) => s.kind === "deck")).toBe(true);
    expect(payload.sources.some((s) => s.kind === "transcript")).toBe(true);
    expect(payload.tags).toContain("Outcome of Board Meeting");

    // the dividend declaration and its record date share one dividend event
    const dividend = evs.find(
      (e) => e.isin === "INE195A01028" && e.category === "dividend",
    );
    expect(dividend).toBeDefined();
    expect(
      (JSON.parse(dividend?.announcementIdsJson ?? "[]") as string[]).length,
    ).toBe(2);

    // RELIANCE: credit ratings two weeks apart are separate events; the Jio IPO filings cluster
    const ratings = evs.filter(
      (e) => e.isin === "INE002A01018" && e.category === "credit_rating",
    );
    expect(ratings).toHaveLength(2);

    // second run: everything updates, nothing duplicates, same number of events
    const r2 = await ingestAnnouncements([...RELIANCE, ...SUPREME], {
      llm: false,
      attachments: false,
    });
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(RELIANCE.length + SUPREME.length);
    expect((await db.select().from(announcements)).length).toBe(rows.length);
    expect((await db.select().from(events)).length).toBe(evs.length);
  });

  it("marks exact re-posts and attaches them to the original's event", async () => {
    const orig = RELIANCE.find(
      (r) => r.seq_id === "106837394",
    ) as AnnouncementRaw;
    const repost: AnnouncementRaw = { ...orig, seq_id: "106837395" };
    const r = await ingestAnnouncements([orig, repost], {
      llm: false,
      attachments: false,
    });
    expect(r.reposts).toBe(1);
    const row = (await db.select().from(announcements)).find(
      (a) => a.id === "nse:106837395",
    );
    expect(row?.subcategory).toBe("repost");
    expect(row?.tier).toBe(3);
    expect(row?.eventKey).toBe("INE002A01018|results|2026-10-30");
  });

  it("skips rows without a resolvable ISIN; corrects the API's stale sm_isin from the companies master", async () => {
    const r = await ingestAnnouncements(
      [
        {
          ...(RELIANCE[0] as AnnouncementRaw),
          symbol: "UNKNOWNCO",
          sm_isin: "",
          seq_id: "zzz",
        },
      ],
      { llm: false, attachments: false },
    );
    expect(r.skipped).toBe(1);
    expect(r.inserted).toBe(0);
    // SUPREMEIND rows carry the pre-split ISIN INE195A01010 in the feed; rows are stored under the current one
    const sup = (await db.select().from(announcements)).filter(
      (a) => a.symbol === "SUPREMEIND",
    );
    expect(sup.length).toBeGreaterThan(0);
    expect(sup.every((a) => a.isin === "INE195A01028")).toBe(true);
  });
});
