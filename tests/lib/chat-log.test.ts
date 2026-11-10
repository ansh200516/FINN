import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAT_LOG_KEY,
  type ChatLogTurn,
  chainFromLog,
  loadChatLog,
  resultsShown,
  saveChatLog,
} from "@/lib/chatLog";
import type { FinnieCard } from "@/lib/finnieTypes";
import { FINNIE_CHAIN_CAP, FINNIE_LOG_CAP } from "@/lib/finnieTypes";
import { FINNIE_GREETING } from "@/ui/composer";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function turn(id: number, extra: Partial<ChatLogTurn> = {}): ChatLogTurn {
  return {
    id,
    question: `q-${id}`,
    say: `PIIND line ${id}`,
    cards: [],
    pages: [],
    links: [],
    href: null,
    link: null,
    sayAfter: false,
    ...extra,
  };
}

const resultsCard: FinnieCard = {
  kind: "reply",
  symbol: "PIIND",
  reply: {
    kind: "results",
    card: {
      isin: "INE603J01030",
      basis: "consolidated",
      checksum: "exchange_xbrl",
      rows: [],
      ebitdaFormula: "pbt+fin+dna",
      sourceUrl: null,
    },
  },
};

describe("chat log", () => {
  it("reloads the thread, capped at the last 30, without the greeting", () => {
    const storage = memoryStorage();
    const saved = Array.from({ length: FINNIE_LOG_CAP + 1 }, (_, i) =>
      turn(i + 1),
    );
    saved[1] = turn(2, {
      cards: [resultsCard],
      pages: ["/c/PIIND"],
      say: "For PIIND, Q2 FY27 Revenue is 1701.8 crore.",
    });
    saveChatLog(storage, saved);
    const loaded = loadChatLog(storage);
    expect(loaded).toHaveLength(FINNIE_LOG_CAP);
    expect(loaded[0]?.id).toBe(2);
    expect(loaded.at(-1)?.id).toBe(FINNIE_LOG_CAP + 1);
    expect(loaded.some((row) => row.say === FINNIE_GREETING)).toBe(false);
    expect(loaded[0]?.cards[0]).toMatchObject({
      kind: "reply",
      symbol: "PIIND",
      reply: { kind: "results" },
    });
    expect(resultsShown(loaded[0]?.cards ?? [])).toEqual(["PIIND"]);
    const chain = chainFromLog(loaded);
    expect(chain).toHaveLength(FINNIE_CHAIN_CAP);
    expect(chain[0]?.user).toBe(
      `q-${FINNIE_LOG_CAP + 1 - FINNIE_CHAIN_CAP + 1}`,
    );
    expect(chain.at(-1)?.say).toContain(`PIIND line ${FINNIE_LOG_CAP + 1}`);
    expect(chain.at(-1)?.results).toContain("PIIND");
    expect(storage.getItem(CHAT_LOG_KEY)).toContain("1701.8");
  });

  it("keeps the quarter strip on a results card", () => {
    const storage = memoryStorage();
    saveChatLog(storage, [
      turn(1, {
        cards: [
          {
            kind: "reply",
            symbol: "RELIANCE",
            reply: {
              kind: "results",
              card: {
                isin: "INE002A01018",
                basis: "consolidated",
                checksum: "exchange_xbrl",
                rows: [],
                ebitdaFormula: "pbt+fin+dna",
                sourceUrl: null,
              },
            },
            quarters: [
              {
                period: "Q2 FY27",
                revenue: { label: "Revenue", crore: 150, yoyPct: 50 },
                ebitda: null,
                pat: { label: "PAT", crore: 15, yoyPct: 50 },
              },
            ],
          },
        ],
        pages: ["/c/RELIANCE"],
      }),
    ]);
    const loaded = loadChatLog(storage);
    expect(loaded[0]?.cards[0]).toMatchObject({
      kind: "reply",
      symbol: "RELIANCE",
      quarters: [{ period: "Q2 FY27", revenue: { crore: 150, yoyPct: 50 } }],
    });
  });

  it("returns nothing for a missing or broken log", () => {
    const storage = memoryStorage();
    expect(loadChatLog(storage)).toEqual([]);
    storage.setItem(CHAT_LOG_KEY, "not json");
    expect(loadChatLog(storage)).toEqual([]);
    storage.setItem(
      CHAT_LOG_KEY,
      JSON.stringify({ turns: [{ id: 1, question: "  ", say: "x" }] }),
    );
    expect(loadChatLog(storage)).toEqual([]);
  });

  it("is what the chat screen loads and sends", () => {
    const desk = readFileSync("src/ui/Desk.tsx", "utf8");
    expect(desk).toContain("loadChatLog(window.localStorage)");
    expect(desk).toContain("saveChatLog(window.localStorage");
    expect(desk).toContain("chainFromLog(storedTurns(turnsRef.current))");
    expect(desk).toContain("{FINNIE_GREETING}");
  });
});
