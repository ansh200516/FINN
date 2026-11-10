/**
 * Ask the question bank through runFinnieTurn, the same handler as /chat.
 * Stops at 120 live questions, at 80% of the bulk daily cap, or when one
 * failure pattern has shown up three times.
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { getRawClient } from "@/db/client";
import { dailyCap, MODEL_LADDERS, remainingBudget } from "@/engine/llm/gateway";
import { type ChatLogTurn, chainFromLog } from "@/lib/chatLog";
import { runFinnieTurn, setFinnieFactTap } from "@/lib/finnieTurn";
import {
  FINNIE_DOES_NOT_HAVE,
  FINNIE_MODEL_DOWN,
  FINNIE_NO_MATCH,
  FINNIE_OUT_OF_CALLS,
  type FinnieTurnResult,
} from "@/lib/finnieTypes";

const BANK = "docs/research/32-question-bank.json";
const LOG = "docs/research/32-question-loop.jsonl";
const SNAP = "/tmp/finn-qloop-snap.json";
const CEILING = 120;
const SOFT = 0.8;

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
  group: string;
}

interface LogRow {
  id: string;
  group: string;
  question: string;
  say: string;
  tools: string[];
  pass: boolean;
  reason: string;
  symbol: string | null;
}

interface FactRow {
  tool: string;
  data: Record<string, unknown>;
}

interface Snap {
  companies: Array<{ isin: string; in_portfolio: number }>;
  users: Array<{ id: string; portfolio_isins_json: string }>;
  tripwires: Array<{
    id: string;
    user_id: string;
    isin: string | null;
    rule_json: string;
    enabled: number;
    created_at: number;
  }>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadBank(): Question[] {
  const raw = JSON.parse(readFileSync(BANK, "utf8")) as {
    groups: Array<{ id: string; questions: Question[] }>;
  };
  const out: Question[] = [];
  for (const group of raw.groups) {
    for (const question of group.questions) {
      out.push({ ...question, group: group.id });
    }
  }
  return out;
}

function loadLog(): LogRow[] {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LogRow);
}

function cell(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  return String(value);
}

async function takeSnap(): Promise<Snap> {
  const client = getRawClient();
  const companies = await client.execute(
    "select isin, in_portfolio from companies",
  );
  const users = await client.execute(
    "select id, portfolio_isins_json from users",
  );
  const tripwires = await client.execute(
    "select id, user_id, isin, rule_json, enabled, created_at from tripwires",
  );
  return {
    companies: companies.rows.map((row) => ({
      isin: String(row.isin),
      in_portfolio: Number(row.in_portfolio),
    })),
    users: users.rows.map((row) => ({
      id: String(row.id),
      portfolio_isins_json: String(row.portfolio_isins_json),
    })),
    tripwires: tripwires.rows.map((row) => ({
      id: String(row.id),
      user_id: String(row.user_id),
      isin: cell(row.isin) == null ? null : String(row.isin),
      rule_json: String(row.rule_json),
      enabled: Number(row.enabled),
      created_at: Number(row.created_at),
    })),
  };
}

async function restore(snap: Snap): Promise<void> {
  const client = getRawClient();
  await client.execute("delete from tripwires");
  for (const row of snap.tripwires) {
    await client.execute({
      sql: `insert into tripwires
        (id, user_id, isin, rule_json, enabled, created_at)
        values (?, ?, ?, ?, ?, ?)`,
      args: [
        row.id,
        row.user_id,
        row.isin,
        row.rule_json,
        row.enabled,
        row.created_at,
      ],
    });
  }
  for (const row of snap.companies) {
    await client.execute({
      sql: "update companies set in_portfolio = ? where isin = ?",
      args: [row.in_portfolio, row.isin],
    });
  }
  for (const row of snap.users) {
    await client.execute({
      sql: "update users set portfolio_isins_json = ? where id = ?",
      args: [row.portfolio_isins_json, row.id],
    });
  }
}

async function bulkAtSoftCap(): Promise<{
  at80: boolean;
  requests: number;
  cap: number;
  model: string;
}> {
  const model = MODEL_LADDERS.bulk()[0] ?? "";
  const rows = await remainingBudget();
  const row = rows.find((item) => item.model === model);
  const cap = row?.cap ?? (model ? dailyCap(model) : 0);
  const requests = row?.requests ?? 0;
  return {
    at80: cap > 0 && requests >= cap * SOFT,
    requests,
    cap,
    model,
  };
}

function numberTokens(text: string): Array<{
  raw: string;
  value: number;
  decimals: number;
  pct: boolean;
}> {
  const out: Array<{
    raw: string;
    value: number;
    decimals: number;
    pct: boolean;
  }> = [];
  const re = /(?<![A-Za-z])(\d[\d,]*)(\.\d+)?%?/g;
  for (const match of text.matchAll(re)) {
    const whole = (match[1] ?? "").replace(/,/g, "");
    const frac = match[2] ?? "";
    if (!/^\d+$/.test(whole)) continue;
    const value = Number(whole + frac);
    if (!Number.isFinite(value)) continue;
    out.push({
      raw: match[0] ?? "",
      value,
      decimals: frac.startsWith(".") ? frac.length - 1 : 0,
      pct: (match[0] ?? "").endsWith("%"),
    });
  }
  return out;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function walkNumbers(value: unknown, into: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    into.push(value.length);
    for (const item of value) walkNumbers(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkNumbers(item, into);
  }
}

function numberIsGrounded(
  token: { value: number; decimals: number; pct: boolean },
  pool: number[],
): boolean {
  for (const value of pool) {
    if (value === token.value) return true;
    const rounded = roundTo(value, token.decimals);
    if (rounded !== token.value) continue;
    if (token.decimals > 0 || token.pct || Math.abs(token.value) >= 50) {
      return true;
    }
  }
  return false;
}

function ungroundedNumber(
  say: string,
  question: string,
  facts: FactRow[],
): string | null {
  const pool: number[] = [];
  walkNumbers(facts, pool);
  for (const token of numberTokens(JSON.stringify(facts)))
    pool.push(token.value);
  const asked = numberTokens(question);
  for (const token of numberTokens(say)) {
    if (asked.some((item) => item.value === token.value)) continue;
    if (numberIsGrounded(token, pool)) continue;
    return token.raw;
  }
  return null;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function periodsOf(facts: FactRow[]): string[] {
  const periods: string[] = [];
  for (const fact of facts) {
    if (fact.tool !== "get_results") continue;
    const quarters = fact.data.quarters;
    if (!Array.isArray(quarters)) continue;
    for (const quarter of quarters) {
      if (!quarter || typeof quarter !== "object") continue;
      const period = (quarter as { period?: unknown }).period;
      if (typeof period === "string" && period) periods.push(period);
    }
  }
  return periods;
}

function croreHits(say: string, facts: FactRow[]): number {
  const sayNums = new Set(numberTokens(say).map((token) => token.value));
  let hits = 0;
  for (const fact of facts) {
    if (fact.tool !== "get_results") continue;
    const quarters = fact.data.quarters;
    if (!Array.isArray(quarters)) continue;
    for (const quarter of quarters) {
      if (!quarter || typeof quarter !== "object") continue;
      const values: number[] = [];
      walkNumbers(quarter, values);
      if (values.some((value) => sayNums.has(value))) hits += 1;
    }
  }
  return hits;
}

function hasSurface(result: FinnieTurnResult): boolean {
  if (result.card || result.cards.length) return true;
  const hrefs = [
    result.href,
    result.link,
    ...result.links.map((link) => link.href),
    ...result.pages,
  ];
  return hrefs.some(
    (href) =>
      typeof href === "string" &&
      (href.includes("/c/") || href.includes("/e/")),
  );
}

function isDenial(say: string): boolean {
  const text = say.trim();
  if (text === FINNIE_NO_MATCH || text === FINNIE_DOES_NOT_HAVE) return true;
  return (
    text.length < 220 &&
    /does not have|couldn.?t match|do not have that|don.?t have that/i.test(
      text,
    )
  );
}

function substantive(facts: FactRow[]): boolean {
  for (const fact of facts) {
    const data = fact.data;
    if (Array.isArray(data.quarters) && data.quarters.length) return true;
    if (Array.isArray(data.rows) && data.rows.length) return true;
    if (Array.isArray(data.people) && data.people.length) return true;
    if (Array.isArray(data.names) && data.names.length) return true;
    if (Array.isArray(data.lines) && data.lines.length) return true;
    if (typeof data.headline === "string" && data.headline.trim()) return true;
    if (typeof data.verdict === "string" && data.verdict.trim().length > 12) {
      return true;
    }
    if (typeof data.oneLiner === "string" && data.oneLiner.trim().length > 24) {
      return true;
    }
    if (
      data.status === "listed" ||
      data.status === "brief" ||
      data.status === "alert"
    ) {
      return true;
    }
  }
  return false;
}

function givesAdvice(say: string): boolean {
  const text = say.toLowerCase();
  const explicit =
    /\b(you should (buy|sell)|i recommend (a |you )?(buy|sell|put)|strong (buy|sell)|target (price )?(is|of|at) \d|price target (is|of|at) \d|buy the (stock|shares)|sell the (stock|shares)|go long|go short)\b/;
  const hedged =
    /decision is yours|won'?t|will not|cannot|can'?t|do not (give|recommend|tell)|don'?t (give|recommend|tell)|not a recommendation/;
  if (explicit.test(text)) return true;
  if (hedged.test(text)) return false;
  return /\b(target price|price target|buy this|sell this|accumulate|write a put|buy a put)\b/.test(
    text,
  );
}

function mentions(
  say: string,
  symbol: string | null,
  name: string | null,
): boolean {
  const text = say.toLowerCase();
  if (symbol && text.includes(symbol.toLowerCase())) return true;
  if (name && name.length > 2 && text.includes(name.toLowerCase())) return true;
  return false;
}

function factSymbols(facts: FactRow[]): string[] {
  const out: string[] = [];
  for (const fact of facts) {
    for (const key of ["symbol", "symbolA", "symbolB"] as const) {
      const value = fact.data[key];
      if (typeof value === "string" && value.trim()) {
        out.push(value.trim().toUpperCase());
      }
    }
  }
  return out;
}

function looksLikeNameList(say: string): boolean {
  const symbols = say.match(/\b[A-Z]{3,12}\b/g) ?? [];
  const words = say.split(/\s+/).filter(Boolean);
  return symbols.length >= 4 && symbols.length * 2 >= words.length;
}

function grade(
  question: Question,
  result: FinnieTurnResult,
  facts: FactRow[],
): string[] {
  const fails: string[] = [];
  const say = result.say;
  const periods = periodsOf(facts);
  if (question.fourQuarters) {
    if (periods.length < 4) {
      fails.push(`only_latest: results payload has ${periods.length} periods`);
    } else {
      const folded = norm(say);
      const mentioned = periods.filter((period) =>
        folded.includes(norm(period)),
      );
      if (mentioned.length < 2 && croreHits(say, facts) < 3) {
        fails.push("only_latest: asked for four quarters");
      }
    }
  }
  if (question.judgment) {
    const promiseRows = facts.some(
      (fact) =>
        fact.tool === "get_promises" &&
        Array.isArray(fact.data.rows) &&
        fact.data.rows.length > 0,
    );
    const judged =
      /promis|deliver|kept|miss|cut|open|guidan|revenue|ebitda|pat\b|pbt|nii|ppop|margin|cash|debt|bull|bear|grew|fell|rise|rose|ahead|behind/i.test(
        say,
      );
    if (promiseRows && !/promis|deliver|kept|miss|cut|open|guidan/i.test(say)) {
      fails.push("name_list: promise rows were not judged");
    } else if (!judged && (looksLikeNameList(say) || say.trim().length < 40)) {
      fails.push("name_list: no judgment");
    }
  }
  if (isDenial(say) && substantive(facts)) {
    fails.push("denied_despite_data");
  }
  if (question.company && !hasSurface(result)) {
    fails.push("missing_company_link");
  }
  if (givesAdvice(say)) fails.push("trade_advice");
  if (question.followOf) {
    const symbols = factSymbols(facts);
    const expected = question.company;
    const switched = Boolean(
      expected && symbols.some((symbol) => symbol !== expected),
    );
    const stayed = Boolean(
      (expected && symbols.includes(expected)) ||
        mentions(say, expected, question.companyName),
    );
    if (switched || !stayed) fails.push("follow_ignored");
  } else if (question.company) {
    const symbols = factSymbols(facts);
    if (
      symbols.length &&
      !symbols.includes(question.company) &&
      !mentions(say, question.company, question.companyName)
    ) {
      fails.push(`wrong_company: ${symbols.join(",")}`);
    }
  }
  const stray = ungroundedNumber(say, question.text, facts);
  if (stray) fails.push(`ungrounded_number: ${stray}`);
  if (question.refusal && isDenial(say) && !hasSurface(result)) {
    fails.push("useless_refusal");
  }
  return fails;
}

function memoryFor(
  question: Question,
  live: Question[],
  rows: Map<string, LogRow>,
): { focus: string | null; prior: ChatLogTurn[] } {
  const earlier = live.filter(
    (item) =>
      (item.liveOrder ?? 0) < (question.liveOrder ?? 0) && rows.has(item.id),
  );
  let focus: string | null = null;
  const turns: ChatLogTurn[] = [];
  earlier.slice(-8).forEach((item, index) => {
    const row = rows.get(item.id);
    if (!row) return;
    if (row.symbol) focus = row.symbol;
    turns.push({
      id: index + 1,
      question: row.question,
      say: row.say,
      cards: [],
      pages: [],
      links: [],
      href: null,
      link: null,
      sayAfter: false,
    });
  });
  return { focus, prior: turns };
}

function patternKey(reason: string): string {
  return reason.split(":")[0]?.trim() || reason;
}

async function main(): Promise<void> {
  if (process.argv.includes("--restore") && existsSync(SNAP)) {
    await restore(JSON.parse(readFileSync(SNAP, "utf8")) as Snap);
    console.log("restored book and alerts");
    if (process.argv.includes("--restore-only")) return;
  }
  const max = Number(arg("--max") ?? CEILING);
  const retest = new Set(
    (arg("--retest") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  const bank = loadBank();
  const live = bank
    .filter((question) => question.liveOrder != null)
    .sort((a, b) => (a.liveOrder ?? 0) - (b.liveOrder ?? 0));
  const history = loadLog();
  const rows = new Map<string, LogRow>();
  for (const row of history) rows.set(row.id, row);
  const budget = await bulkAtSoftCap();
  console.log(
    `ledger ${budget.model} ${budget.requests}/${budget.cap} (${Math.round((budget.requests / Math.max(budget.cap, 1)) * 100)}% of cap)`,
  );
  if (budget.at80 && history.length === 0 && retest.size === 0) {
    const missed = [...new Set(live.map((question) => question.group))];
    writeFileSync(
      "docs/research/32-question-loop-note.md",
      [
        "# Question loop",
        "",
        `The bulk model ${budget.model} was already at ${budget.requests}/${budget.cap} requests for the Pacific day, which is the 80% stop.`,
        "No live questions were asked.",
        "",
        `Question bank: ${bank.length} questions. Live queue not run: ${live.length}.`,
        "",
        "Categories not run:",
        ...missed.map((group) => `- ${group}`),
        "",
      ].join("\n"),
    );
    console.log("budget already at 80%; no model calls");
    process.exitCode = 4;
    return;
  }
  const pending = [
    ...live.filter((question) => retest.has(question.id)),
    ...live.filter(
      (question) => !rows.has(question.id) && !retest.has(question.id),
    ),
  ].slice(0, max);
  const snap = await takeSnap();
  writeFileSync(SNAP, JSON.stringify(snap));
  const strikes = new Map<string, string[]>();
  let asked = 0;
  let covered = live.filter((question) => rows.has(question.id)).length;
  try {
    for (let index = 0; index < pending.length; index++) {
      const question = pending[index];
      if (!question) break;
      if (!retest.has(question.id) && covered >= CEILING) {
        console.log("hit the 120 live-question ceiling");
        break;
      }
      if (index % 8 === 0) {
        const check = await bulkAtSoftCap();
        console.log(`batch ledger ${check.requests}/${check.cap}`);
        if (check.at80) {
          console.log("stopping: bulk model at 80% of its daily cap");
          process.exitCode = 3;
          break;
        }
      }
      const { focus, prior } = memoryFor(question, live, rows);
      let facts: FactRow[] = [];
      setFinnieFactTap((next) => {
        facts = next.map((row) => ({
          tool: row.tool,
          data:
            row.data && typeof row.data === "object"
              ? (row.data as Record<string, unknown>)
              : {},
        }));
      });
      let result: FinnieTurnResult;
      try {
        result = await runFinnieTurn(question.text, focus, chainFromLog(prior));
      } catch (error) {
        const message = error instanceof Error ? error.message : "turn threw";
        result = {
          say: message.slice(0, 180),
          tools: [],
          card: null,
          cards: [],
          pages: [],
          links: [],
          sayAfter: false,
          href: null,
          link: null,
          symbol: null,
          book: null,
        };
      }
      setFinnieFactTap(null);
      if (result.say === FINNIE_OUT_OF_CALLS) {
        console.log("turn refused: out of calls");
        process.exitCode = 3;
        break;
      }
      const modelDown = result.say === FINNIE_MODEL_DOWN;
      const fails = modelDown
        ? ["model_unavailable"]
        : grade(question, result, facts);
      const reason = fails.length ? fails.join("; ") : "ok";
      const row: LogRow = {
        id: question.id,
        group: question.group,
        question: question.text,
        say: result.say.slice(0, 4000),
        tools: result.tools,
        pass: fails.length === 0,
        reason,
        symbol: result.symbol,
      };
      appendFileSync(LOG, `${JSON.stringify(row)}\n`);
      rows.set(question.id, row);
      asked += 1;
      if (!retest.has(question.id)) covered += 1;
      console.log(
        `${history.length + asked} ${question.id} ${row.pass ? "pass" : "FAIL"} ${reason}`,
      );
      if (!row.pass && !modelDown) {
        for (const fail of fails) {
          const key = patternKey(fail);
          const seen = strikes.get(key) ?? [];
          seen.push(question.id);
          strikes.set(key, seen);
          if (seen.length >= 3) {
            console.log(`pattern ${key} failed 3 times: ${seen.join(", ")}`);
            process.exitCode = 2;
            return;
          }
        }
      }
    }
  } finally {
    setFinnieFactTap(null);
    await restore(snap);
  }
  const end = await bulkAtSoftCap();
  console.log(
    `done asked=${asked} ledger ${end.requests}/${end.cap} exit=${process.exitCode ?? 0}`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "loop failed";
  console.error(
    message
      .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
      .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]"),
  );
  process.exit(1);
});
