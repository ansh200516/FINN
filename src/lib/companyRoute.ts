/**
 * What `/c/[symbol]` should render.
 *
 * A symbol that is not on file starts the existing research job. While that
 * job is still open, the page stays on the working receipt — a reading that
 * says "not in the filings" is only honest after the job has looked. A name
 * already in the portfolio keeps its page. A finished job renders the company
 * page even when the exchanges had nothing to file.
 */

export type CompanyRouteMode = "start" | "receipt" | "page";

export function companyRouteMode(input: {
  onFile: boolean;
  inPortfolio: boolean;
  /** A price, a filing, a quarter, or a stored document — not the name alone. */
  hasSubstance: boolean;
  researchFinished: boolean;
  jobOpen: boolean;
  jobFailed: boolean;
}): CompanyRouteMode {
  if (!input.onFile) {
    if (input.jobOpen || input.jobFailed) return "receipt";
    return "start";
  }
  if (input.inPortfolio) return "page";
  if (input.researchFinished) return "page";
  if (input.jobOpen || input.jobFailed) return "receipt";
  if (input.hasSubstance) return "page";
  return "start";
}

export function companyHasSubstance(model: {
  prices: { lastClose: number | null; closes: Array<number | null> };
  events: readonly unknown[];
  quarters: readonly unknown[];
  documents: readonly unknown[];
}): boolean {
  const priced =
    model.prices.lastClose != null ||
    model.prices.closes.some((close) => close != null);
  return (
    priced ||
    model.events.length > 0 ||
    model.quarters.length > 0 ||
    model.documents.length > 0
  );
}
