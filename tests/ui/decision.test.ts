/**
 * Decision sentences are pure: category, one-liner, headline deltas, ledger
 * counts. No model, no database.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResultsCard } from "@/engine/types";
import { tallyLedger } from "@/lib/ledger-counts";
import { DecisionCard } from "@/ui/DecisionCard";
import {
  editionHeadline,
  hasFigures,
  judgeEvent,
  judgeMove,
  type LedgerCounts,
  oneFact,
  showAsMoveCard,
} from "@/ui/decision";
import type { EventCard } from "@/ui/model";

function ev(
  partial: Partial<EventCard> & Pick<EventCard, "category">,
): EventCard {
  return {
    eventKey: "k",
    isin: "INE",
    symbol: "RELIANCE",
    companyName: "Reliance Industries Limited",
    tier: 1,
    priority: 80,
    title: "Filing",
    oneLiner: "",
    filedAtMs: 0,
    filedAtIst: "06-Nov-2026 17:20:57",
    sources: [],
    card: null,
    followUps: 0,
    ...partial,
  };
}

const revenue: ResultsCard = {
  isin: "INE",
  basis: "consolidated",
  checksum: "exchange_xbrl",
  rows: [
    {
      metric: "revenue",
      value: 100e7,
      qoqPct: 6.7,
      yoyPct: 28.6,
      spark: [],
    },
  ],
  ebitdaFormula: "pbt+fin+dna-oi",
  sourceUrl: null,
};

const kept: LedgerCounts = {
  missed: 0,
  cut: 0,
  open: 2,
  kept: 1,
  beat: 0,
  rows: 4,
};

describe("edition headline", () => {
  it("counts decisions, and says when there are none", () => {
    expect(editionHeadline(0)).toBe("Nothing to decide.");
    expect(editionHeadline(1)).toBe("1 decision.");
    expect(editionHeadline(3)).toBe("3 decisions.");
  });
});

describe("ledger tally", () => {
  it("ignores a superseded cut and counts a settled miss", () => {
    const c = tallyLedger([
      { verdict: "cut", status: "superseded", n: 2 },
      { verdict: "missed", status: "settled" },
      { verdict: null, status: "open", n: 3 },
      { verdict: "kept", status: "settled" },
    ]);
    expect(c.cut).toBe(0);
    expect(c.missed).toBe(1);
    expect(c.open).toBe(3);
    expect(c.kept).toBe(1);
    expect(c.rows).toBe(7);
  });
});

describe("judgeEvent", () => {
  it("turns a revenue print with no break into the watch sentence", () => {
    const j = judgeEvent(
      ev({
        category: "results",
        oneLiner: "Reliance filed its quarterly results on 06 Nov.",
        card: revenue,
      }),
      kept,
    );
    expect(j.decision).toBe("watch");
    expect(j.sentence).toBe("Revenue up 29% year on year. No promise broken.");
  });

  it("acts when a promise was missed or cut", () => {
    const missed = judgeEvent(ev({ category: "results", card: revenue }), {
      ...kept,
      missed: 1,
      kept: 0,
    });
    expect(missed.decision).toBe("act");
    expect(missed.sentence).toBe(
      "Revenue up 29% year on year. A promise was missed.",
    );
    const cut = judgeEvent(ev({ category: "results", card: revenue }), {
      ...kept,
      cut: 1,
      kept: 0,
      beat: 0,
    });
    expect(cut.decision).toBe("act");
    expect(cut.sentence).toContain("A promise was cut.");
  });

  it("says the promises are still open when nothing has settled", () => {
    const j = judgeEvent(ev({ category: "results", card: revenue }), {
      missed: 0,
      cut: 0,
      open: 4,
      kept: 0,
      beat: 0,
      rows: 4,
    });
    expect(j.decision).toBe("watch");
    expect(j.sentence).toBe("Revenue up 29% year on year. No promise broken.");
  });

  it("names the person and points at the profile", () => {
    const j = judgeEvent(
      ev({
        category: "management_change",
        symbol: "TATA",
        oneLiner:
          "A long filing about several other matters that is not the sentence.",
        card: {
          person: "Mr. Jayant Balan",
          role: "Managing Director",
          action: "appointed",
          effective_date: null,
          reason: null,
          brief_profile_excerpt:
            "Mr. Jayant Balan is a chartered accountant with twenty years across the group.",
          prior_roles: [],
          confidence: "high",
        },
      }),
      { ...kept, open: 9 },
    );
    expect(j.decision).toBe("act");
    expect(j.sentence).toBe(
      "Jayant Balan becomes MD. The filing has his profile.",
    );
  });

  it("watches an unrelated filing when promises are open", () => {
    const j = judgeEvent(
      ev({
        category: "m_and_a",
        oneLiner:
          "Marico acquired an additional 20% stake in Cosmix Wellness Private Limited for an aggregate consideration of ₹350 crore.",
      }),
      { missed: 0, cut: 0, open: 9, kept: 0, beat: 0, rows: 9 },
    );
    expect(j.decision).toBe("watch");
    expect(j.sentence).toBe(
      "Marico acquired an additional 20% stake in Cosmix Wellness for an aggregate consideration of ₹350 crore. Promises still open.",
    );
  });

  it("calls a routine filing nothing when the ledger is empty", () => {
    const j = judgeEvent(
      ev({
        category: "dividend",
        tier: 2,
        oneLiner: "Interim dividend of ₹6 per share.",
      }),
      null,
    );
    expect(j.decision).toBe("nothing");
    expect(j.sentence).toBe("Interim dividend of ₹6 per share.");
  });

  it("cuts a long penalty line before the purpose clause", () => {
    expect(
      oneFact(
        "The Department of Telecommunications imposed a penalty of Rs. 1,50,000 for alleged violation of subscriber verification norms and several other conditions that run on.",
      ),
    ).toBe(
      "The Department of Telecommunications imposed a penalty of Rs. 1,50,000.",
    );
  });
});

describe("judgeMove", () => {
  it("acts on a rule hit in the shape of the tape", () => {
    const j = judgeMove({ pct: -17, volumeRatio: 17, ruleHit: true });
    expect(j.decision).toBe("act");
    expect(j.sentence).toBe("Down 17% on 17× volume. You asked to be told.");
  });

  it("keeps initials inside the sentence", () => {
    expect(
      oneFact(
        "IndusInd Bank leverages J.P. Morgan Payments for outward remittances.",
      ),
    ).toBe(
      "IndusInd Bank leverages J.P. Morgan Payments for outward remittances.",
    );
  });

  it("cards a price-line hit and counts a volume graze", () => {
    expect(
      showAsMoveCard({ pct: -17, volumeRatio: 17, ruleHit: true }, 5),
    ).toBe(true);
    expect(
      showAsMoveCard({ pct: 0.6, volumeRatio: 2.3, ruleHit: true }, 5),
    ).toBe(false);
  });

  it("watches a large move that did not hit the rule", () => {
    const j = judgeMove({ pct: -4, volumeRatio: 1.2, ruleHit: false });
    expect(j.decision).toBe("watch");
    expect(j.sentence).toBe("Down 4% on 1.2× volume. Under your line.");
  });
});

describe("hasFigures", () => {
  it("is true for a results grid and a management bio, false when empty", () => {
    expect(hasFigures(ev({ category: "results", card: revenue }))).toBe(true);
    expect(
      hasFigures(
        ev({
          category: "management_change",
          card: {
            person: "Mr. Jayant Balan",
            role: "MD",
            action: "appointed",
            effective_date: null,
            reason: null,
            brief_profile_excerpt: null,
            prior_roles: [],
            confidence: "low",
          },
        }),
      ),
    ).toBe(true);
    expect(hasFigures(ev({ category: "dividend", card: null }))).toBe(false);
  });
});

describe("DecisionCard", () => {
  it("keeps the figures closed and the filing one tap away", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionCard, {
        symbol: "RELIANCE",
        time: "17:21 · after close",
        decision: "watch",
        sentence: "Revenue up 29% year on year. No promise broken.",
        href: "/e/k",
        action: "Filing",
        figures: createElement("p", null, "EBITDA grid"),
      }),
    );
    expect(html).toContain("Revenue up 29% year on year. No promise broken.");
    expect(html).toContain("Watch");
    expect(html).toContain("The figures");
    expect(html).toContain("EBITDA grid");
    expect(html).toContain('href="/e/k"');
    expect(html).toContain("Filing");
    expect(html).not.toMatch(/<details[^>]*\sopen[\s>]/);
    expect(html).toContain("hit");
  });
});
