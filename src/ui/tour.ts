/** First-run tour. Dismissed in localStorage; it does not return on this browser. */
export const TOUR_STORAGE_KEY = "finn.tour";
export const TOUR_DISMISSED = "done";

export interface TourStep {
  id: string;
  href: string;
  title: string;
  body: string;
  /** `[data-tour]` on the control this step points at. */
  target: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "chat",
    href: "/chat",
    title: "Ask in the filings",
    body: "Finnie answers from the filings on the book. The line in the box is an example, and an empty send asks that line. While a turn runs, the thinking row names the step.",
    target: "chat",
  },
  {
    id: "foryou",
    href: "/brief",
    title: "Your edition",
    body: "This is the edition for the names you follow. \u201cTo act on\u201d means a filing or a close that needs a look. The rest stays on the watch line or is filed away.",
    target: "edition",
  },
  {
    id: "companies",
    href: "/c",
    title: "The book",
    body: "Every portfolio name, and any company you added for research, is listed here. Open one for the price, the last quarter, and the promise ledger.",
    target: "companies",
  },
  {
    id: "readings",
    href: "/c/SUPREMEIND",
    title: "Readings",
    body: "These lines sit under the price. One tap opens that reading from the annual report or the exchange results. If the filing is silent, the line says so.",
    target: "readings",
  },
  {
    id: "alerts",
    href: "/alerts",
    title: "What counts",
    body: "You set the price move, the volume, and which filings count as unusual. Nothing is saved until you press Save alerts.",
    target: "alerts",
  },
  {
    id: "inbox",
    href: "/inbox",
    title: "What already fired",
    body: "Tripwires and filings that have already landed are here. Opening the inbox marks them read on this device.",
    target: "inbox",
  },
];
