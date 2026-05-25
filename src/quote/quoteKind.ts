import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { isLegacyQuoteMint } from "@pump-fun/pump-sdk";
import {
  BUY_AMOUNT,
  BUY_AMOUNT_USDC,
  MARKET_CAP,
  MARKET_CAP_USDC,
  SNIPE_QUOTE_MODE,
  USDC_MINT,
} from "../constants";

export type QuoteKind = "sol" | "usdc";

const VALID_MODES = new Set(["sol", "usdc", "both"]);

export function getEnabledQuoteKinds(): Set<QuoteKind> {
  const mode = SNIPE_QUOTE_MODE.toLowerCase();
  if (!VALID_MODES.has(mode)) {
    console.log(`Invalid SNIPE_QUOTE_MODE="${SNIPE_QUOTE_MODE}", defaulting to sol`);
    return new Set<QuoteKind>(["sol"]);
  }
  if (mode === "both") return new Set<QuoteKind>(["sol", "usdc"]);
  if (mode === "usdc") return new Set<QuoteKind>(["usdc"]);
  return new Set<QuoteKind>(["sol"]);
}

export function shouldSnipeQuote(kind: QuoteKind, enabled: Set<QuoteKind>): boolean {
  return enabled.has(kind);
}

/** Fast path: USDC mint present in the launch transaction accounts. */
export function detectQuoteKindFromAccounts(accountKeys: string[]): QuoteKind {
  return accountKeys.includes(USDC_MINT.toBase58()) ? "usdc" : "sol";
}

export function quoteKindFromMint(quoteMint: PublicKey): QuoteKind {
  if (!isLegacyQuoteMint(quoteMint) && quoteMint.equals(USDC_MINT)) {
    return "usdc";
  }
  return "sol";
}

export function getBuyAmountForQuote(kind: QuoteKind): number {
  return kind === "usdc" ? BUY_AMOUNT_USDC : BUY_AMOUNT;
}

export function getMarketCapThresholdForQuote(kind: QuoteKind): number {
  return kind === "usdc" ? MARKET_CAP_USDC : MARKET_CAP;
}

export function getTakeProfitThreshold(buyAmount: number, takeProfitPct: number): number {
  return buyAmount * (100 + takeProfitPct) / 100;
}

export function getStopLossThreshold(buyAmount: number, stopLossPct: number): number {
  return buyAmount * (100 - stopLossPct) / 100;
}

export function quoteLabel(kind: QuoteKind): string {
  return kind === "usdc" ? "USDC" : "SOL";
}

export function isNativeSolQuote(quoteMint: PublicKey): boolean {
  return isLegacyQuoteMint(quoteMint) || quoteMint.equals(NATIVE_MINT);
}
