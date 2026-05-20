import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";
import { PumpFun } from "../idl/pump-fun";
import { PUMP_FUN_PROGRAM } from "../../constants";

const BUYBACK_FEE_RECIPIENTS = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
];

const pumpPda = (seeds: Buffer[]): PublicKey =>
  PublicKey.findProgramAddressSync(seeds, PUMP_FUN_PROGRAM)[0];

export const globalPda = (): PublicKey => pumpPda([Buffer.from("global")]);

export const bondingCurveV2Pda = (mint: PublicKey): PublicKey =>
  pumpPda([Buffer.from("bonding-curve-v2"), mint.toBuffer()]);

/** Bonding curve is a PDA — must use allowOwnerOffCurve for Token-2022 ATA. */
export const getAssociatedBondingCurveAta = (
  mint: PublicKey,
  bondingCurve: PublicKey,
  tokenProgram: PublicKey
): PublicKey =>
  getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram);

const isNonZeroPubkey = (pk: PublicKey) => !pk.equals(PublicKey.default);

/** Pick a fee recipient authorized on-chain (avoids NotAuthorized / 6000). */
export async function getPumpFeeRecipient(
  program: Program<PumpFun>
): Promise<PublicKey> {
  const global = await program.account.global.fetch(globalPda());
  const recipients = [
    global.feeRecipient,
    ...(global.feeRecipients ?? []),
  ].filter(isNonZeroPubkey);

  if (recipients.length === 0) {
    throw new Error("No authorized fee recipients found on pump global account");
  }

  return recipients[Math.floor(Math.random() * recipients.length)];
}

export const getPumpBuybackFeeRecipient = (): PublicKey =>
  new PublicKey(
    BUYBACK_FEE_RECIPIENTS[Math.floor(Math.random() * BUYBACK_FEE_RECIPIENTS.length)]
  );

export const getPumpBuyRemainingAccounts = (mint: PublicKey) => [
  {
    pubkey: bondingCurveV2Pda(mint),
    isWritable: false,
    isSigner: false,
  },
  {
    pubkey: getPumpBuybackFeeRecipient(),
    isWritable: true,
    isSigner: false,
  },
];

export const getPumpSellRemainingAccounts = (mint: PublicKey) =>
  getPumpBuyRemainingAccounts(mint);
