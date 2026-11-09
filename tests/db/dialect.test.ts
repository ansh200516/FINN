import { describe, expect, it } from "vitest";
import { isPostgresUrl, sessionPoolerUrl } from "@/db/dialect";

const TX =
  "postgresql://postgres.example:s3cret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres";

describe("sessionPoolerUrl", () => {
  it("moves a Supavisor transaction URL onto the session port", () => {
    expect(sessionPoolerUrl(TX)).toBe(
      "postgresql://postgres.example:s3cret@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
    );
  });

  it("keeps the query string and an encoded password", () => {
    const url =
      "postgres://postgres.example:p%2Fss@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require";
    expect(sessionPoolerUrl(url)).toBe(
      "postgres://postgres.example:p%2Fss@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require",
    );
  });

  it("leaves session, direct, and local URLs alone", () => {
    const session = TX.replace(":6543", ":5432");
    expect(sessionPoolerUrl(session)).toBe(session);
    const direct =
      "postgresql://postgres:s3cret@db.example.supabase.co:5432/postgres";
    expect(sessionPoolerUrl(direct)).toBe(direct);
    const other =
      "postgresql://postgres:s3cret@db.example.supabase.co:6543/postgres";
    expect(sessionPoolerUrl(other)).toBe(other);
    expect(sessionPoolerUrl("file:./data/finn.db")).toBe("file:./data/finn.db");
  });
});

describe("isPostgresUrl", () => {
  it("accepts only postgres schemes", () => {
    expect(isPostgresUrl(TX)).toBe(true);
    expect(isPostgresUrl("postgres://localhost/finn")).toBe(true);
    expect(isPostgresUrl("file:./data/finn.db")).toBe(false);
    expect(isPostgresUrl(undefined)).toBe(false);
  });
});
