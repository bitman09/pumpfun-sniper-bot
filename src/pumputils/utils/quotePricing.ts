import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurveMarketCap,
  bondingCurvePda,
  getSellSolAmountFromTokenAmount,
  isLegacyQuoteMint,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { QuoteKind } from "../../quote/quoteKind";
import { USDC_DECIMALS, USDC_MINT } from "../../constants";

const onlineSdkCache = new WeakMap<Connection, OnlinePumpSdk>();

function getOnlineSdk(connection: Connection): OnlinePumpSdk {
  let sdk = onlineSdkCache.get(connection);
  if (!sdk) {
    sdk = new OnlinePumpSdk(connection);
    onlineSdkCache.set(connection, sdk);
  }
  return sdk;
}

function rawToUi(amount: BN, kind: QuoteKind): number {
  if (kind === "usdc") {
    return Number(amount) / 10 ** USDC_DECIMALS;
  }
  return Number(amount) / LAMPORTS_PER_SOL;
}

export async function getQuoteSellPrice(
  connection: Connection,
  mint: PublicKey,
  tokenAmountRaw: bigint
): Promise<{ outAmount: number; quoteKind: QuoteKind }> {
  const onlineSdk = getOnlineSdk(connection);
  const [global, feeConfig, bondingCurveAccountInfo] = await Promise.all([
    onlineSdk.fetchGlobal(),
    onlineSdk.fetchFeeConfig(),
    connection.getAccountInfo(bondingCurvePda(mint), "processed"),
  ]);

  if (!bondingCurveAccountInfo) {
    throw new Error("Bonding curve account not found");
  }

  const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveAccountInfo);
  const quoteMint = isLegacyQuoteMint(bondingCurve.quoteMint)
    ? NATIVE_MINT
    : bondingCurve.quoteMint;
  const quoteKind: QuoteKind = quoteMint.equals(USDC_MINT) ? "usdc" : "sol";

  const quoteOut = getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: new BN(tokenAmountRaw.toString()),
  });

  return { outAmount: rawToUi(quoteOut, quoteKind), quoteKind };
}

export async function getQuoteMarketCap(
  connection: Connection,
  mint: PublicKey
): Promise<{ mc: number; quoteKind: QuoteKind }> {
  const bondingCurveAccountInfo = await connection.getAccountInfo(
    bondingCurvePda(mint),
    "processed"
  );

  if (!bondingCurveAccountInfo) {
    throw new Error("Bonding curve account not found");
  }

  const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveAccountInfo);
  const quoteMint = isLegacyQuoteMint(bondingCurve.quoteMint)
    ? NATIVE_MINT
    : bondingCurve.quoteMint;
  const quoteKind: QuoteKind = quoteMint.equals(USDC_MINT) ? "usdc" : "sol";

  const mcRaw = bondingCurveMarketCap({
    mintSupply: bondingCurve.tokenTotalSupply,
    virtualQuoteReserves: bondingCurve.virtualQuoteReserves,
    virtualTokenReserves: bondingCurve.virtualTokenReserves,
  });

  return { mc: rawToUi(mcRaw, quoteKind), quoteKind };
}
