import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAT_LOG_KEY,
  type ChatLogTurn,
  chainFromLog,
  clearChatLog,
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
                revenue: {
                  label: "Revenue",
                  crore: 150,
                  qoqPct: null,
                  yoyPct: 50,
                },
                ebitda: null,
                pbt: null,
                pat: { label: "PAT", crore: 15, qoqPct: null, yoyPct: 50 },
              },
            ],
            periodCards: [
              {
                isin: "INE002A01018",
                basis: "consolidated",
                checksum: "exchange_xbrl",
                rows: [],
                ebitdaFormula: "pbt+fin+dna",
                sourceUrl: null,
                fiscalLabel: "Q2 FY27",
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
      periodCards: [{ fiscalLabel: "Q2 FY27" }],
    });
  });

  it("clips a stored quarter recital to two sentences", () => {
    const storage = memoryStorage();
    const wall = [
      "For Q3 FY26, Revenue was 1 crore, EBITDA was 2, PBT was 3, and PAT was 4.",
      "For Q4 FY26, Revenue was 5 crore, EBITDA was 6, PBT was 7, and PAT was 8.",
      "For Q1 FY27, Revenue was 9 crore, EBITDA was 10, PBT was 11, and PAT was 12.",
    ].join(" ");
    saveChatLog(storage, [turn(1, { say: wall })]);
    const loaded = loadChatLog(storage);
    expect(loaded[0]?.say).toContain("Q3 FY26");
    expect(loaded[0]?.say).toContain("Q4 FY26");
    expect(loaded[0]?.say).not.toContain("Q1 FY27");
    expect(loaded[0]?.say.split(/(?<=[.!?])\s+/)).toHaveLength(2);
  });

  it("does not load a thread saved under the previous key", () => {
    const storage = memoryStorage();
    storage.setItem(
      "finnie.chat.v1",
      JSON.stringify({ turns: [turn(1, { say: "old thread" })] }),
    );
    expect(CHAT_LOG_KEY).toBe("finn-chat-v2");
    expect(loadChatLog(storage)).toEqual([]);
    saveChatLog(storage, [turn(4, { say: "new thread" })]);
    expect(loadChatLog(storage).map((row) => row.say)).toEqual(["new thread"]);
    expect(storage.getItem("finnie.chat.v1")).toContain("old thread");
    clearChatLog(storage);
    expect(loadChatLog(storage)).toEqual([]);
    expect(storage.getItem(CHAT_LOG_KEY)).toBeNull();
    expect(storage.getItem("finnie.chat.v1")).toContain("old thread");
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
    expect(desk).toContain("clearChatLog(window.localStorage)");
    expect(desk).toContain("chainFromLog(storedTurns(turnsRef.current))");
    expect(desk).toContain("{FINNIE_GREETING}");
    expect(desk).toContain("New chat");
  });
});
