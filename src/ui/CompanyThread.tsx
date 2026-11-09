"use client";

import { companyTurn } from "@/app/c/[symbol]/actions";
import { askFiling } from "./askClient";
import { CompanyConversation } from "./CompanyConversation";

/** Wires the thread to the rule handler and to grounded Ask. */
export function CompanyThread({
  symbol,
  name,
}: {
  symbol: string;
  name: string;
}) {
  return (
    <CompanyConversation
      symbol={symbol}
      name={name}
      onReply={(text) => companyTurn(symbol, text)}
      onAsk={(question) => askFiling(symbol, question)}
    />
  );
}
