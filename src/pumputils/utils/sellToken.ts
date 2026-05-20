import * as token from "@solana/spl-token";
import * as web3 from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { BN } from "bn.js";
import { PumpFun } from "../idl/pump-fun";
import IDL from "../idl/pump-fun.json";
import { SystemProgram } from "@solana/web3.js";
import {
  BLOXROUTE_MODE,
  NEXT_BLOCK_API,
  NEXT_BLOCK_FEE,
  NEXTBLOCK_MODE,
  PRIORITY_FEE,
  SLIPPAGE,
} from "../../constants";
import { bloXroute_executeAndConfirm } from "../../executor/bloXroute";
import bs58 from "bs58";
import { confirmSignature, resolvePumpTokenProgram } from "./transactionUtils";
import {
  getAssociatedBondingCurveAta,
  getPumpFeeRecipient,
  getPumpSellRemainingAccounts,
} from "./pumpAccounts";
import { getCreatorVault } from "./getCreatorVault";
import getBondingCurveTokenAccountWithRetry from "./getBondingCurveTokenAccountWithRetry";
import tokenDataFromBondingCurveTokenAccBuffer from "./tokenDataFromBondingCurveTokenAccBuffer";
import { getTokenOut } from "./getSellPrice";
import { getUserTokenBalanceRaw } from "./getUserTokenBalance";

async function submitAndConfirm(
  connection: web3.Connection,
  transaction: web3.Transaction,
  keypair: web3.Keypair
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
    console.error("Failed to send sell transaction:", response.status, responseData);
    return false;
  }

  const confirmed = await confirmSignature(connection, signature);
  if (!confirmed) {
    const status = await connection.getSignatureStatus(signature);
    console.error("Sell transaction failed on-chain:", signature, status.value?.err ?? "timeout");
    return false;
  }

  return signature;
}

async function sellToken(
  dev: web3.PublicKey,
  mint: web3.PublicKey,
  connection: web3.Connection,
  keypair: web3.Keypair,
  _tokenAmount: string | number,
  bondingCurve: web3.PublicKey,
  _associatedBondingCurveFromGeyser: web3.PublicKey,
  _blockhash: string,
  tokenProgramHint?: web3.PublicKey
) {
  try {
    const provider = new AnchorProvider(connection, new Wallet(keypair), {
      commitment: "processed",
    });
    const program = new Program<PumpFun>(IDL as PumpFun, provider);
    const transaction = new web3.Transaction();

    const mintTokenProgram = resolvePumpTokenProgram(tokenProgramHint);
    const associatedBondingCurve = getAssociatedBondingCurveAta(
      mint,
      bondingCurve,
      mintTokenProgram
    );
    const associatedUser = token.getAssociatedTokenAddressSync(
      mint,
      keypair.publicKey,
      false,
      mintTokenProgram
    );

    const sellAmount = await getUserTokenBalanceRaw(
      connection,
      mint,
      keypair.publicKey,
      mintTokenProgram
    );

    if (sellAmount <= 0n) {
      console.error("Sell skipped: wallet token balance is 0");
      return false;
    }

    console.log(`Selling ${sellAmount.toString()} raw tokens (actual wallet balance)`);

    const bondingCurveAccount = await getBondingCurveTokenAccountWithRetry(
      connection,
      bondingCurve,
      30,
      50
    );
    const tokenData = tokenDataFromBondingCurveTokenAccBuffer(bondingCurveAccount.data);

    const slippagePoints = BigInt(Math.floor(SLIPPAGE * 100));
    const expectedSol = await getTokenOut(sellAmount, 100n, tokenData);
    const minSolOut =
      expectedSol - (expectedSol * slippagePoints) / 10000n;

    const feeRecipient = await getPumpFeeRecipient(program);
    const creatorVault = await getCreatorVault(dev, program.programId);

    const modifyComputeUnits = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 250_000,
    });
    const addPriorityFee = web3.ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor(((PRIORITY_FEE * 10 ** 9) / 250_000) * 10 ** 6),
    });

    transaction
      .add(modifyComputeUnits)
      .add(addPriorityFee)
      .add(
        await program.methods
          .sell(new BN(sellAmount.toString()), new BN(minSolOut.toString()))
          .accountsPartial({
            associatedUser,
            feeRecipient,
            mint,
            user: keypair.publicKey,
            tokenProgram: mintTokenProgram,
            bondingCurve,
            associatedBondingCurve,
            creatorVault,
          })
          .remainingAccounts(getPumpSellRemainingAccounts(mint))
          .transaction()
      )
      .add(
        token.createCloseAccountInstruction(
          associatedUser,
          keypair.publicKey,
          keypair.publicKey,
          [],
          mintTokenProgram
        )
      );

    if (NEXTBLOCK_MODE) {
      const nextBlockAddr = "NEXTbLoCkB51HpLBLojQfpyVAMorm3zzKg7w9NFdqid";
      if (!NEXT_BLOCK_API) {
        console.log("Nextblock API is not provided");
        return false;
      }

      transaction.add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new web3.PublicKey(nextBlockAddr),
          lamports: NEXT_BLOCK_FEE * web3.LAMPORTS_PER_SOL,
        })
      );

      return submitAndConfirm(connection, transaction, keypair);
    }

    if (BLOXROUTE_MODE) {
      const { blockhash } = await connection.getLatestBlockhash("processed");
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;
      const result = await bloXroute_executeAndConfirm(transaction, keypair);
      if (!result) return false;
      const ok = await confirmSignature(connection, result);
      if (!ok) {
        console.error("Sell transaction failed on-chain:", result);
        return false;
      }
      return result;
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
      console.error("Sell transaction failed on-chain:", txSig, confirmSig.value.err);
      return false;
    }

    return txSig;
  } catch (error) {
    console.error(error);
    return false;
  }
}
export default sellToken;
