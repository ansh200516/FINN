import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dedupeDocuments,
  docIdForSha,
  recentQuarterLabels,
} from "@/engine/ingest/documents";
import { alternateBseUrl, normaliseBseUrl } from "@/engine/sources/bse-docs";
import {
  annualReportsFromNse,
  transcriptsFromAnnouncements,
} from "@/engine/sources/nse-docs";
import {
  documentsFromScreener,
  parseScreenerDocuments,
} from "@/engine/sources/screener";
import type { AnnouncementRaw, DiscoveredDocument } from "@/engine/types";

const FIX = join(process.cwd(), "tests", "fixtures", "docs");
const NOW = Date.UTC(2026, 10, 8, 12);

describe("NSE discovery (pure)", () => {
  const rows = JSON.parse(
    readFileSync(join(FIX, "nse-announcements-infy.json"), "utf8"),
  ) as AnnouncementRaw[];
  it("keeps earnings-call transcripts, drops AGM / investor-day transcripts and noise, labels periods", () => {
    const out = transcriptsFromAnnouncements(rows);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(
      out.every(
        (d) =>
          d.kind === "transcript" &&
          d.source === "nse" &&
          d.url.startsWith("https://"),
      ),
    ).toBe(true);
    expect(
      out.some((d) => /Annual General Meeting|AI Day/i.test(d.title ?? "")),
    ).toBe(false);
    const q2 = out.find((d) => /28102026/.test(d.url));
    expect(q2).toMatchObject({
      period: "Q2FY27",
      announcementId: expect.stringMatching(/^nse:/),
    });
    expect(out.find((d) => /28072026/.test(d.url))?.period).toBe("Q1FY27");
    expect(out.find((d) => /19012026/.test(d.url))?.period).toBe("Q3FY26");
    // newest first
    expect((out[0]?.publishedAtMs ?? 0) >= (out[1]?.publishedAtMs ?? 0)).toBe(
      true,
    );
  });
  it("respects the since bound", () => {
    expect(
      transcriptsFromAnnouncements(rows, { sinceMs: Date.UTC(2099, 0, 1) }),
    ).toHaveLength(0);
  });
  it("turns the annual-reports index into FY-labelled documents", () => {
    const ar = JSON.parse(
      readFileSync(join(FIX, "nse-annual-reports-supremeind.json"), "utf8"),
    ) as { data: Parameters<typeof annualReportsFromNse>[0] };
    const out = annualReportsFromNse(ar.data);
    expect(out[0]).toMatchObject({
      kind: "annual_report",
      period: "FY26",
      source: "nse",
    });
    expect(out[0]?.url).toMatch(/AR_29321_SUPREMEIND_2025_2026/);
    expect(out[1]?.period).toBe("FY25");
  });
});

describe("screener discovery (pure)", () => {
  const html = readFileSync(
    join(FIX, "screener-supremeind-documents.html.txt"),
    "utf8",
  );
  it("parses concall rows and annual reports from the Documents section", () => {
    const docs = parseScreenerDocuments(html);
    expect(docs.concalls.length).toBeGreaterThan(5);
    const nov = docs.concalls.find((c) => c.label === "Nov 2026");
    expect(nov?.transcript).toMatch(/AnnPdfOpen\.aspx\?Pname=ceb674b9/);
    expect(nov?.ppt).toMatch(/AnnPdfOpen/);
    expect(nov?.rec).toMatch(/\.mp3$/);
    expect(docs.annualReports[0]).toMatchObject({ year: 2026 });
    expect(docs.annualReports[0]?.url).toMatch(/AttachHis\/2fff9f50/);
  });
  it("maps rows to documents with direct BSE URLs and quarter labels", () => {
    const out = documentsFromScreener(parseScreenerDocuments(html), {
      maxAnnualReports: 1,
    });
    const t = out.filter((d) => d.kind === "transcript");
    expect(t[0]).toMatchObject({ period: "Q2FY27", source: "screener" });
    expect(t[0]?.url).toBe(
      "https://www.bseindia.com/xml-data/corpfiling/AttachLive/ceb674b9-cd2e-4ef8-bf77-bece0e59fe0f.pdf",
    );
    expect(out.filter((d) => d.kind === "annual_report")).toHaveLength(1);
    expect(out.find((d) => d.kind === "annual_report")?.period).toBe("FY26");
  });
});

describe("BSE url helpers", () => {
  it("skips the aspx hop and knows the sibling path", () => {
    expect(
      normaliseBseUrl(
        "https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=abc-123.pdf",
      ),
    ).toBe(
      "https://www.bseindia.com/xml-data/corpfiling/AttachLive/abc-123.pdf",
    );
    expect(
      normaliseBseUrl("https://nsearchives.nseindia.com/corporate/x.pdf"),
    ).toBe("https://nsearchives.nseindia.com/corporate/x.pdf");
    expect(
      alternateBseUrl(
        "https://www.bseindia.com/xml-data/corpfiling/AttachLive/a.pdf",
      ),
    ).toBe("https://www.bseindia.com/xml-data/corpfiling/AttachHis/a.pdf");
    expect(alternateBseUrl("https://example.com/a.pdf")).toBeNull();
  });
});

describe("union + de-duplication", () => {
  const mk = (
    over: Partial<DiscoveredDocument> & { score?: number },
  ): DiscoveredDocument & { score?: number } => ({
    kind: "transcript",
    period: "Q2FY27",
    url: `https://x/${Math.random()}`,
    source: "nse",
    publishedAtMs: NOW,
    title: null,
    announcementId: null,
    ...over,
  });
  it("prefers NSE over screener for the same period and keeps screener-only periods", () => {
    const out = dedupeDocuments(
      [
        mk({ url: "https://nse/q2", source: "nse", score: 3 }),
        mk({ url: "https://bse/q2", source: "screener" }),
        mk({ url: "https://bse/q1", source: "screener", period: "Q1FY27" }),
        mk({ url: "https://nse/ar26", kind: "annual_report", period: "FY26" }),
        mk({
          url: "https://bse/ar26",
          kind: "annual_report",
          period: "FY26",
          source: "screener",
        }),
        mk({ url: "https://nse/ar25", kind: "annual_report", period: "FY25" }),
        mk({ url: "https://nse/ar24", kind: "annual_report", period: "FY24" }),
      ],
      { allowedPeriods: new Set(["Q2FY27", "Q1FY27"]), maxAnnualReports: 2 },
    );
    expect(out.map((d) => d.url)).toEqual([
      "https://nse/q2",
      "https://bse/q1",
      "https://nse/ar26",
      "https://nse/ar25",
    ]);
  });
  it("picks the better-scored / earlier NSE filing when two transcripts land in one quarter", () => {
    const out = dedupeDocuments([
      mk({
        url: "https://nse/acq-call",
        score: 2,
        publishedAtMs: Date.UTC(2026, 1, 18),
      }),
      mk({
        url: "https://nse/earnings-call",
        score: 2,
        publishedAtMs: Date.UTC(2026, 0, 30),
      }),
      mk({
        url: "https://nse/other",
        score: 1,
        publishedAtMs: Date.UTC(2026, 0, 10),
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe("https://nse/earnings-call");
  });
  it("drops transcripts outside the quarter window", () => {
    const out = dedupeDocuments(
      [mk({ url: "https://nse/old", period: "Q1FY25" })],
      { allowedPeriods: new Set(["Q2FY27"]) },
    );
    expect(out).toHaveLength(0);
  });
  it("lists the last N completed quarters newest first", () => {
    expect(recentQuarterLabels(6, NOW)).toEqual([
      "Q2FY27",
      "Q1FY27",
      "Q4FY26",
      "Q3FY26",
      "Q2FY26",
      "Q1FY26",
    ]);
  });
  it("derives document ids from the content hash", () => {
    expect(docIdForSha("abcdef0123456789abcdef0123456789abcdef")).toBe(
      "doc_abcdef0123456789abcdef01",
    );
  });
});
