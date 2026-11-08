import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  bhavcopyUrl,
  parseBhavcopyCsv,
  parseBhavcopyZip,
  readZipEntries,
} from "@/engine/sources/bhavcopy";

/** Minimal zip writer (one deflated entry) so the reader can be tested without fixtures on disk. */
function makeZip(name: string, content: string): Uint8Array {
  const data = Buffer.from(content, "utf8");
  const comp = deflateRawSync(data);
  const nameB = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(0, 14); // crc (not checked by our reader)
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameB.length, 26);
  local.writeUInt16LE(0, 28);
  const localOff = 0;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameB.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(localOff, 42);
  const cdOff = local.length + nameB.length + comp.length;
  const cdSize = central.length + nameB.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOff, 16);
  eocd.writeUInt16LE(0, 20);
  return new Uint8Array(
    Buffer.concat([local, nameB, comp, central, nameB, eocd]),
  );
}

const HEADER =
  "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4";
const CSV = `${HEADER}
2026-11-06,2026-11-06,CM,NSE,STK,2885,INE002A01018,RELIANCE,EQ,,,,,Reliance Industries Limited,1314.1,1324.9,1310,1320,1320.5,1313.5,,,,,22768301,30000000000,500000,F1,1,,,,,
2026-11-06,2026-11-06,CM,NSE,STK,999,INE343B01030,RAJESHEXPO,BZ,,,,,Rajesh Exports Limited,51,51.5,49.8,50.04,50,50.93,,,,,175359,8800000,1200,F1,1,,,,,
2026-11-06,2026-11-06,CM,NSE,STK,1,INE111111111,SOMEETF,GB,,,,,Some Gold Bond,100,100,100,100,100,100,,,,,10,1000,1,F1,1,,,,,
2026-11-06,2026-11-06,CM,NSE,STK,2,INE222222222,NOSERIES,N1,,,,,Debt thing,100,100,100,100,100,100,,,,,10,1000,1,F1,1,,,,,
`;

describe("bhavcopy", () => {
  it("builds the UDiFF URL", () => {
    expect(bhavcopyUrl("2026-11-06")).toBe(
      "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261106_F_0000.csv.zip",
    );
    expect(() => bhavcopyUrl("garbage")).toThrow();
  });
  it("parses the CSV, keeping only EQ/BE/BZ/SM series", () => {
    const rows = parseBhavcopyCsv(CSV);
    expect(rows.map((r) => r.TckrSymb)).toEqual(["RELIANCE", "RAJESHEXPO"]);
    const ril = rows[0];
    expect(ril).toMatchObject({
      ISIN: "INE002A01018",
      SctySrs: "EQ",
      ClsPric: 1320,
      PrvsClsgPric: 1313.5,
      TtlTradgVol: 22768301,
      TtlNbOfTxsExctd: 500000,
    });
  });
  it("reads a zip and guards against stale files", () => {
    const zip = makeZip("BhavCopy_NSE_CM_0_0_0_20261106_F_0000.csv", CSV);
    expect(readZipEntries(zip).map((e) => e.name)).toEqual([
      "BhavCopy_NSE_CM_0_0_0_20261106_F_0000.csv",
    ]);
    expect(parseBhavcopyZip(zip, "2026-11-06")).toHaveLength(2);
    expect(() => parseBhavcopyZip(zip, "2026-11-08")).toThrow(/stale|TradDt/);
  });
});
