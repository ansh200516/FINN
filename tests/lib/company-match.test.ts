import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { resolveNseSymbol } from "@/engine/jobs/resolve";
import {
  type CompanyName,
  companiesMentioned,
  matchCompanyName,
} from "@/lib/companyMatch";

const BOOK: CompanyName[] = [
  {
    symbol: "FLUOROCHEM",
    name: "Gujarat Fluorochemicals Limited",
    aliases: ["GFL"],
  },
  {
    symbol: "STALLION",
    name: "Stallion India Fluorochemicals Limited",
    aliases: [],
  },
  {
    symbol: "VOLTAS",
    name: "Voltas Limited",
    aliases: [],
  },
  {
    symbol: "BHARTIARTL",
    name: "Bharti Airtel Limited",
    aliases: [],
  },
];

beforeAll(async () => {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});

describe("company name resolution", () => {
  it("resolves Gujarat Fluorochemicals and Fluorochem to FLUOROCHEM", async () => {
    expect(matchCompanyName("Gujarat Fluorochemicals", BOOK)?.symbol).toBe(
      "FLUOROCHEM",
    );
    expect(matchCompanyName("Fluorochem", BOOK)?.symbol).toBe("FLUOROCHEM");
    expect(matchCompanyName("GFL", BOOK)?.symbol).toBe("FLUOROCHEM");
    expect(
      companiesMentioned("Gujarat Fluorochemicals across four quarters", BOOK),
    ).toEqual(["FLUOROCHEM"]);
    expect((await resolveNseSymbol("Gujarat Fluorochemicals"))?.symbol).toBe(
      "FLUOROCHEM",
    );
    expect((await resolveNseSymbol("Fluorochem"))?.symbol).toBe("FLUOROCHEM");
  });

  it("names Voltas from the sentence and not another holding", () => {
    expect(
      companiesMentioned(
        "If the latest Voltas filing is routine, give me one line.",
        BOOK,
      ),
    ).toEqual(["VOLTAS"]);
  });

  it("does not read management as Nuvama", () => {
    const rows = [
      ...BOOK,
      {
        symbol: "RELIANCE",
        name: "Reliance Industries Limited",
        aliases: [],
      },
      {
        symbol: "NUVAMA",
        name: "Nuvama Wealth Management Limited",
        aliases: [],
      },
    ];
    expect(
      companiesMentioned(
        "for reliance take the last four quarters and, against management's own headline guidance and growth commentary, tell me what was promised vs. what was actually delivered.",
        rows,
      ),
    ).toEqual(["RELIANCE"]);
    expect(companiesMentioned("Airtel filed a board notice.", rows)).toEqual([
      "BHARTIARTL",
    ]);
    expect(
      companiesMentioned("Gujarat Fluorochemicals across four quarters", rows),
    ).toEqual(["FLUOROCHEM"]);
  });
});
