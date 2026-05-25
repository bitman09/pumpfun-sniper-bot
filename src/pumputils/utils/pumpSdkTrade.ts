import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurvePda,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
  isLegacyQuoteMint,
} from "@pump-fun/pump-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  BLOXROUTE_MODE,
  NEXT_BLOCK_API,
  NEXT_BLOCK_FEE,
  NEXTBLOCK_MODE,
  PRIORITY_FEE,
  SLIPPAGE,
  USDC_MINT,
} from "../../constants";
import { QuoteKind } from "../../quote/quoteKind";
import { bloXroute_executeAndConfirm } from "../../executor/bloXroute";
import { confirmSignature } from "./transactionUtils";

const QUOTE_TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const BASE_TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

async function submitTransaction(
  connection: Connection,
  transaction: Transaction,
  keypair: Keypair
): Promise<string | false> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("processed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = keypair.publicKey;
  transaction.sign(keypair);

  const signature = bs58.encode(transaction.signature!);
  const response = await fetch("https://fra.nextblock.io/api/v2/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: NEXT_BLOCK_API,
    },
    body: JSON.stringify({
      transaction: { content: transaction.serialize().toString("base64") },
    }),
  });

  const responseData = await response.json();
  if (!response.ok) {
    console.error("Failed to send transaction:", response.status, responseData);
    return false;
  }

  const confirmed = await confirmSignature(connection, signature);
  if (!confirmed) {
    const status = await connection.getSignatureStatus(signature);
    console.error("Transaction failed on-chain:", signature, status.value?.err ?? "timeout");
    return false;
  }

  return signature;
}

function appendComputeBudget(ix: TransactionInstruction[]): TransactionInstruction[] {
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: Math.floor(((PRIORITY_FEE * 10 ** 9) / 300_000) * 10 ** 6),
  });
  return [modifyComputeUnits, addPriorityFee, ...ix];
}

function quoteAmountToBn(amountUi: number, kind: QuoteKind): BN {
  if (kind === "usdc") {
    return new BN(Math.floor(amountUi * 1_000_000));
  }
  return new BN(Math.floor(amountUi * 1_000_000_000));
}

async function sendTradeTransaction(
  connection: Connection,
  keypair: Keypair,
  instructions: TransactionInstruction[]
): Promise<string | false> {
  const transaction = new Transaction();
  appendComputeBudget(instructions).forEach((ix) => transaction.add(ix));

  if (NEXTBLOCK_MODE) {
    const nextBlockAddr = "NEXTbLoCkB51HpLBLojQfpyVAMorm3zzKg7w9NFdqid";
    if (!NEXT_BLOCK_API) {
      console.log("Nextblock API is not provided");
      return false;
    }
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(nextBlockAddr),
        lamports: NEXT_BLOCK_FEE * 1_000_000_000,
      })
    );
    return submitTransaction(connection, transaction, keypair);
  }

  if (BLOXROUTE_MODE) {
    const { blockhash } = await connection.getLatestBlockhash("processed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    const result = await bloXroute_executeAndConfirm(transaction, keypair);
    if (!result) return false;
    const ok = await confirmSignature(connection, result);
    return ok ? result : false;
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("processed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = keypair.publicKey;
  transaction.sign(keypair);

  const txSig = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 2,
  });
  const confirmSig = await connection.confirmTransaction(
    { signature: txSig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  if (confirmSig.value.err) {
    console.error("Transaction failed on-chain:", txSig, confirmSig.value.err);
    return false;
  }

  return txSig;
}

async function ensureQuoteAta(
  connection: Connection,
  user: PublicKey,
  quoteMint: PublicKey,
  quoteKind: QuoteKind
): Promise<TransactionInstruction | null> {
  if (quoteKind !== "usdc") return null;

  const quoteAta = getAssociatedTokenAddressSync(
    quoteMint,
    user,
    false,
    QUOTE_TOKEN_PROGRAM
  );
  const info = await connection.getAccountInfo(quoteAta, "processed");
  if (info) return null;

  return createAssociatedTokenAccountIdempotentInstruction(
    user,
    quoteAta,
    user,
    quoteMint,
    QUOTE_TOKEN_PROGRAM
  );
}

export async function buyTokenQuote(
  mint: PublicKey,
  connection: Connection,
  keypair: Keypair,
  buyAmountUi: number,
  quoteKind: QuoteKind
): Promise<{ sig: string; tokenAmount: string } | false> {
  try {
    const onlineSdk = new OnlinePumpSdk(connection);
    const [global, feeConfig] = await Promise.all([
      onlineSdk.fetchGlobal(),
      onlineSdk.fetchFeeConfig(),
    ]);

    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
      await onlineSdk.fetchBuyState(mint, keypair.publicKey, BASE_TOKEN_PROGRAM);

    if (bondingCurve.complete) {
      throw new Error("Bonding curve already completed");
    }

    const quoteMint = isLegacyQuoteMint(bondingCurve.quoteMint)
      ? NATIVE_MINT
      : bondingCurve.quoteMint;

    const quoteAmountBn = quoteAmountToBn(buyAmountUi, quoteKind);
    const tokenAmount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount: quoteAmountBn,
      quoteMint,
    });

    const instructions = await PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      associatedUserAccountInfo,
      mint,
      user: keypair.publicKey,
      amount: tokenAmount,
      quoteAmount: quoteAmountBn,
      slippage: SLIPPAGE,
      tokenProgram: BASE_TOKEN_PROGRAM,
      quoteTokenProgram: QUOTE_TOKEN_PROGRAM,
    });

    const quoteAtaIx = await ensureQuoteAta(connection, keypair.publicKey, quoteMint, quoteKind);
    if (quoteAtaIx) {
      instructions.unshift(quoteAtaIx);
    }

    const sig = await sendTradeTransaction(connection, keypair, instructions);
    if (!sig) return false;

    return { sig, tokenAmount: tokenAmount.toString() };
  } catch (error) {
    console.error("buyTokenQuote failed:", error);
    return false;
  }
}

export async function sellTokenQuote(
  mint: PublicKey,
  connection: Connection,
  keypair: Keypair,
  tokenAmountRaw: bigint,
  quoteKind: QuoteKind
): Promise<string | false> {
  try {
    const onlineSdk = new OnlinePumpSdk(connection);
    const [global, feeConfig] = await Promise.all([
      onlineSdk.fetchGlobal(),
      onlineSdk.fetchFeeConfig(),
    ]);

    const bondingCurveAccountInfo = await connection.getAccountInfo(
      bondingCurvePda(mint),
      "processed"
    );
    if (!bondingCurveAccountInfo) {
      throw new Error("Bonding curve account not found");
    }

    const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveAccountInfo);
    const amount = new BN(tokenAmountRaw.toString());

    const expectedQuote = getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount,
    });

    const instructions = await PUMP_SDK.sellV2Instructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      mint,
      user: keypair.publicKey,
      amount,
      quoteAmount: expectedQuote,
      slippage: SLIPPAGE,
      tokenProgram: BASE_TOKEN_PROGRAM,
      quoteTokenProgram: QUOTE_TOKEN_PROGRAM,
    });

    const associatedUser = getAssociatedTokenAddressSync(
      mint,
      keypair.publicKey,
      false,
      BASE_TOKEN_PROGRAM
    );
    instructions.push(
      createCloseAccountInstruction(
        associatedUser,
        keypair.publicKey,
        keypair.publicKey,
        [],
        BASE_TOKEN_PROGRAM
      )
    );

    return sendTradeTransaction(connection, keypair, instructions);
  } catch (error) {
    console.error("sellTokenQuote failed:", error);
    return false;
  }
}
