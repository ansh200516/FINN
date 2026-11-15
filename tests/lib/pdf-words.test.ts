import { describe, expect, it } from "vitest";
import { repairPdfWords } from "@/lib/pdfWords";

const KPIT = [
  "appointment) disclosure of relationships between director s (in case of appointment of a director).",
  "holds a bachelor'sdegree in Mechanical Engineering",
  "a master'sdegree from the University",
  "Managing Di rector of the Cummins Group in India",
  "a member of t h e Cumm ins Inc. global leade rship team",
  "till Octobe r 2017 and t he Presiden t of the Cummins Inc. Compon ents Group",
  "the Managin g Director of Tat a Cumm ins Private Limited",
  "a 50:50 jo int venture between Cumm ins Inc. and Tata Motors Limited",
  "chaired t he boards of four other Cumm ins legal entiti es in Ind ia as well",
  "He wor ked as a financial an alyst, manufactu ring engin eer, proj ect manager",
  "sust ainable community in it iatives such as model villages and higher ed uc at ion",
].join(" ");

describe("repairPdfWords", () => {
  it("joins a single-letter or suffix break without gluing real words", () => {
    expect(repairPdfWords("d isclosure")).toBe("disclosure");
    expect(repairPdfWords("Mechan ical Engineering")).toBe(
      "Mechanical Engineering",
    );
    expect(repairPdfWords("holds a bachelor")).toBe("holds a bachelor");
    expect(repairPdfWords("of the Cummins Group")).toBe("of the Cummins Group");
    expect(repairPdfWords("Q2 FY27")).toBe("Q2 FY27");
  });

  it("joins the KPIT filing breaks and leaves the sentence boundaries", () => {
    const shown = repairPdfWords(KPIT);
    expect(shown).not.toMatch(
      /director s|Di rector|t h e|Cumm ins|leade rship|Octobe r|t he |Presiden t|Compon ents|Managin g|Tat a|jo int|entiti es|Ind ia|wor ked|an alyst|manufactu ring|engin eer|proj ect|sust ainable|in it iatives|ed uc at ion|bachelor'sdegree|master'sdegree/,
    );
    expect(shown).toContain("between directors (in case");
    expect(shown).toContain(
      "holds a bachelor's degree in Mechanical Engineering",
    );
    expect(shown).toContain("a master's degree from the University");
    expect(shown).toContain("Managing Director of the Cummins Group in India");
    expect(shown).toContain(
      "a member of the Cummins Inc. global leadership team",
    );
    expect(shown).toContain(
      "till October 2017 and the President of the Cummins Inc. Components Group",
    );
    expect(shown).toContain(
      "the Managing Director of Tata Cummins Private Limited",
    );
    expect(shown).toContain(
      "a 50:50 joint venture between Cummins Inc. and Tata Motors Limited",
    );
    expect(shown).toContain(
      "chaired the boards of four other Cummins legal entities in India as well",
    );
    expect(shown).toContain(
      "He worked as a financial analyst, manufacturing engineer, project manager",
    );
    expect(shown).toContain(
      "sustainable community initiatives such as model villages and higher education",
    );
  });
});
