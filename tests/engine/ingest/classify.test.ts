import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classify,
  classifyBatch,
  classifyRules,
  type ResidueClassifier,
} from "@/engine/ingest/classify";
import type { AnnouncementRaw, Category, Tier } from "@/engine/types";

interface Fixture {
  items: Array<{
    raw: AnnouncementRaw;
    label: { category: Category; tier: Tier };
  }>;
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "data/seed/fixtures/announcements-labelled.json"),
    "utf8",
  ),
) as Fixture;

/** Conservative stand-in for Flash-Lite: never promotes, files residue away. Tests must not call Gemini. */
const conservativeLlm: ResidueClassifier = async (items) =>
  items.map((it) => ({
    id: it.id,
    category: "unclassified",
    tier: 3,
    reason: "mock",
  }));

function mkRaw(over: Partial<AnnouncementRaw>): AnnouncementRaw {
  return {
    symbol: "TEST",
    sm_name: "Test Limited",
    sm_isin: "INE000A01001",
    smIndustry: null,
    desc: "Updates",
    attchmntText: "",
    attchmntFile:
      "https://nsearchives.nseindia.com/corporate/TEST_08112026170000_x.pdf",
    attFileSize: "100 KB",
    fileSize: "100 KB",
    hasXbrl: "No",
    an_dt: "08-Nov-2026 17:00:00",
    sort_date: "2026-11-08 17:00:00",
    exchdisstime: "08-Nov-2026 17:00:00",
    seq_id: String(Math.floor(Math.random() * 1e9)),
    ...over,
  };
}

describe("classifier on 174 hand-labelled real NSE filings (rules + mocked LLM residue)", () => {
  it("has at least 60 real items across ≥ 12 categories", () => {
    expect(fixture.items.length).toBeGreaterThanOrEqual(60);
    expect(
      new Set(fixture.items.map((i) => i.label.category)).size,
    ).toBeGreaterThanOrEqual(12);
  });

  it("reaches ≥ 95% category accuracy", async () => {
    const out = await classifyBatch(
      fixture.items.map((i) => i.raw),
      { llm: conservativeLlm },
    );
    const byId = new Map(out.map((o) => [o.raw.seq_id, o]));
    const wrong: string[] = [];
    for (const it of fixture.items) {
      const got = byId.get(it.raw.seq_id);
      if (!got) throw new Error(`missing ${it.raw.seq_id}`);
      if (got.classification.category !== it.label.category) {
        wrong.push(
          `${it.raw.symbol} ${it.raw.seq_id}: want ${it.label.category} got ${got.classification.category} (${got.rule.cue}) :: ${it.raw.desc} / ${it.raw.attchmntText.slice(0, 80)}`,
        );
      }
    }
    const acc = 1 - wrong.length / fixture.items.length;
    expect(wrong, wrong.join("\n")).toHaveLength(
      Math.min(wrong.length, Math.floor(fixture.items.length * 0.05)),
    );
    expect(acc).toBeGreaterThanOrEqual(0.95);
  });

  it("agrees with the hand-labelled tier on ≥ 85% of items (first-time filings)", async () => {
    const out = await classifyBatch(
      fixture.items.map((i) => i.raw),
      { llm: conservativeLlm },
    );
    const byId = new Map(out.map((o) => [o.raw.seq_id, o]));
    let ok = 0;
    const diffs: string[] = [];
    for (const it of fixture.items) {
      const got = byId.get(it.raw.seq_id);
      if (got?.classification.tier === it.label.tier) ok++;
      else
        diffs.push(
          `${it.raw.symbol} ${it.raw.seq_id}: want T${it.label.tier} got T${got?.classification.tier} p${got?.classification.priority} ${got?.classification.category}/${got?.classification.subcategory}`,
        );
    }
    expect(ok / fixture.items.length, diffs.join("\n")).toBeGreaterThanOrEqual(
      0.85,
    );
  });

  it("never files a Tier-1 labelled item as Tier 3", async () => {
    const out = await classifyBatch(
      fixture.items.map((i) => i.raw),
      { llm: conservativeLlm },
    );
    const byId = new Map(out.map((o) => [o.raw.seq_id, o]));
    const bad = fixture.items.filter(
      (it) =>
        it.label.tier === 1 &&
        byId.get(it.raw.seq_id)?.classification.tier === 3,
    );
    expect(bad.map((b) => `${b.raw.symbol} ${b.raw.seq_id}`)).toEqual([]);
  });
});

describe("classifyRules — specific cues", () => {
  const meet = "Analysts/Institutional Investor Meet/Con. Call Updates";
  it("analyst-meet desc: schedules of meets are investor_meetings, calls are earnings_call, transcripts beat schedules only when not a schedule", () => {
    expect(
      classifyRules(
        mkRaw({
          desc: meet,
          attchmntText:
            "X Ltd has informed the Exchange about Schedule of meet",
        }),
      ).category,
    ).toBe("investor_meetings");
    expect(
      classifyRules(
        mkRaw({
          desc: meet,
          attchmntText: "X Ltd has informed the Exchange about Transcript",
        }),
      ),
    ).toMatchObject({ category: "earnings_call", subcategory: "transcript" });
    expect(
      classifyRules(
        mkRaw({
          desc: meet,
          attchmntText:
            "X Ltd has informed the Exchange about Link of Recording",
        }),
      ),
    ).toMatchObject({ category: "earnings_call", subcategory: "recording" });
    expect(
      classifyRules(
        mkRaw({
          desc: meet,
          attchmntText:
            "The Company will hold an investor/analyst conference call on Monday, November 2, 2026 at 6:00 p.m. Audio recording and transcript of the said call will be subsequently published.",
        }),
      ),
    ).toMatchObject({ category: "earnings_call", subcategory: "schedule" });
    expect(
      classifyRules(
        mkRaw({
          desc: meet,
          attchmntText:
            "Company executives will be participating in the Institutional Investors' Meeting - CLSA India Forum",
        }),
      ).category,
    ).toBe("investor_meetings");
  });

  it("newspaper copies: results ad → results/newspaper (Tier 3), other ads → unclassified", async () => {
    const a = await classify(
      mkRaw({
        desc: "Copy of Newspaper Publication",
        attchmntText: "Newspaper Publication of Q2 Results",
      }),
    );
    expect(a).toMatchObject({
      category: "results",
      subcategory: "newspaper",
      tier: 3,
    });
    const b = await classify(
      mkRaw({
        desc: "Copy of Newspaper Publication",
        attchmntText:
          "X Ltd has informed the Exchange about Copy of Newspaper Publication",
      }),
    );
    expect(b).toMatchObject({ category: "unclassified", tier: 3 });
  });

  it("routine descs are Tier 3: trading window, 74(5) certificate, ESOP allotment, CP/NCD allotments", async () => {
    for (const raw of [
      mkRaw({
        desc: "Trading Window",
        attchmntText:
          "Trading Window closure pursuant to SEBI (PIT) Regulations",
      }),
      mkRaw({
        desc: "Certificate under SEBI (Depositories and Participants) Regulations, 2018",
        attchmntText: "Certificate under Regulation 74(5)",
      }),
      mkRaw({
        desc: "ESOP/ESOS/ESPS",
        attchmntText: "Allotment of 9138522 Shares.",
      }),
      mkRaw({
        desc: "Allotment of Securities",
        attchmntText:
          "allotment of 51000 securities pursuant to Non Convertible Securities",
      }),
      mkRaw({
        desc: "Allotment of Securities",
        attchmntText: "allotment of 2,000 commercial paper",
      }),
    ]) {
      const c = await classify(raw);
      expect(c.tier, `${raw.desc}: ${raw.attchmntText}`).toBe(3);
    }
  });

  it("fund-raise: rights allotment is Tier 1 equity; call-money reminders are Tier 3", async () => {
    const rights = await classify(
      mkRaw({
        desc: "Allotment of Securities",
        attchmntText:
          "allotment of 370272665 partly paid-up equity shares on Rights Basis at its Rights Issue Committee Meeting",
      }),
    );
    expect(rights).toMatchObject({
      category: "fund_raise",
      subcategory: "equity",
      tier: 1,
    });
    const call = await classify(
      mkRaw({
        desc: "General Updates",
        attchmntText:
          "Second Reminder Notice for Payment of First and Final Call on partly paid-up equity shares",
      }),
    );
    expect(call).toMatchObject({
      category: "fund_raise",
      subcategory: "call_money",
      tier: 3,
    });
  });

  it("credit rating: change/downgrade → Tier 1, unknown action → Tier 2", async () => {
    const plain = await classify(
      mkRaw({
        desc: "Credit Rating",
        attchmntText: "X Ltd has informed the Exchange about Credit Rating",
      }),
    );
    expect(plain).toMatchObject({ category: "credit_rating", tier: 2 });
    const down = await classify(
      mkRaw({
        desc: "Credit Rating- Revision",
        attchmntText:
          "CRISIL downgrades long-term rating to AA-; outlook revised to Negative",
      }),
    );
    expect(down).toMatchObject({
      category: "credit_rating",
      subcategory: "change",
      tier: 1,
    });
    const reaff = await classify(
      mkRaw({
        desc: "Credit Rating",
        attchmntText:
          "CARE Ratings reaffirms the rating of CARE AA; Stable on bank facilities",
      }),
    );
    expect(reaff).toMatchObject({
      category: "credit_rating",
      subcategory: "reaffirm",
      tier: 2,
    });
  });

  it("management change: CxO/director → Tier 1, SMP → Tier 2, junior CS → Tier 3, auditor resignation → Tier 1, rotation → Tier 2", async () => {
    expect(
      (
        await classify(
          mkRaw({
            desc: "Appointment",
            attchmntText:
              "Appointment of Mr. A as Chief Operating Officer of the Company",
          }),
        )
      ).tier,
    ).toBe(1);
    expect(
      (
        await classify(
          mkRaw({
            desc: "Resignation",
            attchmntText: "Resignation of Director of the Company",
          }),
        )
      ).tier,
    ).toBe(1);
    expect(
      (
        await classify(
          mkRaw({
            desc: "Change in Management",
            attchmntText: "changes in Senior Management Personnel of the Bank",
          }),
        )
      ).tier,
    ).toBe(2);
    expect(
      (
        await classify(
          mkRaw({
            desc: "General Updates",
            attchmntText:
              "appointment of Mr. K as Joint Company Secretary of the Company w.e.f. November 1, 2026",
          }),
        )
      ).tier,
    ).toBe(3);
    expect(
      await classify(
        mkRaw({
          desc: "General Updates",
          attchmntText: "Resignation of Statutory Auditors of the Company",
        }),
      ),
    ).toMatchObject({
      category: "management_change",
      subcategory: "auditor",
      tier: 1,
    });
    expect(
      await classify(
        mkRaw({
          desc: "General Updates",
          attchmntText:
            "Appointment of Statutory Auditors Pursuant to Mandatory Auditor Rotation",
        }),
      ),
    ).toMatchObject({
      category: "management_change",
      subcategory: "auditor_appointment",
      tier: 2,
    });
  });

  it("outcome of board meeting: results when the subject says so, else low confidence (LLM residue)", () => {
    expect(
      classifyRules(
        mkRaw({
          desc: "Outcome of Board Meeting",
          attchmntText:
            "X has submitted to the Exchange, the financial results for the period ended September 30, 2026.",
        }),
      ),
    ).toMatchObject({ category: "results", confidence: 0.95 });
    const bare = classifyRules(
      mkRaw({
        desc: "Outcome of Board Meeting",
        attchmntText: "Outcome of the Board Meeting held on 12 October 2026",
      }),
    );
    expect(bare.category).toBe("results");
    expect(bare.confidence).toBeLessThan(0.7);
    // with the attachment text the omnibus reveals a resignation
    const withText = classifyRules(
      bare &&
        mkRaw({
          desc: "Outcome of Board Meeting",
          attchmntText: "Outcome of the Board Meeting held on 12 October 2026",
        }),
      "The Board noted the resignation of Mr. X as Independent Director with effect from today.",
    );
    expect(withText).toMatchObject({ category: "management_change" });
  });

  it("pledge cues inside SAST disclosures route to pledging; PIT without pledge stays insider_trading", () => {
    expect(
      classifyRules(
        mkRaw({
          desc: "Disclosure under SEBI Takeover Regulations",
          attchmntText:
            "Disclosure under Regulation 31(1) — creation of pledge by promoter",
        }),
      ).category,
    ).toBe("pledging");
    expect(
      classifyRules(
        mkRaw({
          desc: "Disclosure under SEBI Takeover Regulations",
          attchmntText: "Disclosure under Regulation 29(2) of SAST",
        }),
      ).category,
    ).toBe("insider_trading");
    expect(
      classifyRules(
        mkRaw({
          desc: "Updates",
          attchmntText:
            "Disclosure under Regulation 7(2) of SEBI (PIT) Regulations — market sale by promoter",
        }),
      ).category,
    ).toBe("insider_trading");
  });

  it("uses the attachment filename as a hint when the subject is content-free", () => {
    const r = classifyRules(
      mkRaw({
        desc: "Disclosure of material issue",
        attchmntText:
          "X Limited has informed regarding Disclosure of material issue",
        attchmntFile:
          "https://nsearchives.nseindia.com/corporate/RAJESHEXPO_15102026182813_OrderFromSEBI.pdf",
      }),
    );
    expect(r.category).toBe("litigation");
  });
});

describe("classifyBatch — LLM residue", () => {
  it("sends only low-confidence items to the LLM, in batches of ≤ 40, honouring maxCalls", async () => {
    const raws = Array.from({ length: 50 }, (_, i) =>
      mkRaw({
        seq_id: `r${i}`,
        desc: "Updates",
        attchmntText:
          "X Limited has informed the Exchange regarding 'Updates'.",
      }),
    );
    raws.push(
      mkRaw({
        seq_id: "sure",
        desc: "Dividend",
        attchmntText:
          "Board approves Interim Dividend of Rs. 19 per equity share",
      }),
    );
    const calls: number[] = [];
    const llm: ResidueClassifier = async (items) => {
      calls.push(items.length);
      return items.map((it) => ({
        id: it.id,
        category: "press_release",
        tier: 2,
        reason: "mock",
      }));
    };
    const out = await classifyBatch(raws, { llm, maxCalls: 1 });
    expect(calls).toEqual([40]);
    const byId = new Map(out.map((o) => [o.raw.seq_id, o]));
    expect(byId.get("r0")?.classification).toMatchObject({
      category: "press_release",
      classifiedBy: "llm",
    });
    // the 11 beyond the budget keep the rule result
    expect(byId.get("r49")?.classification).toMatchObject({
      category: "unclassified",
      classifiedBy: "rule",
    });
    expect(byId.get("sure")?.classification).toMatchObject({
      category: "dividend",
      classifiedBy: "rule",
    });
  });

  it("survives an LLM failure (keeps rule results)", async () => {
    const raws = [
      mkRaw({
        seq_id: "a",
        desc: "Updates",
        attchmntText:
          "X Limited has informed the Exchange regarding 'Updates'.",
      }),
    ];
    const out = await classifyBatch(raws, {
      llm: async () => {
        throw new Error("503");
      },
    });
    expect(out[0]?.classification.classifiedBy).toBe("rule");
  });
});
