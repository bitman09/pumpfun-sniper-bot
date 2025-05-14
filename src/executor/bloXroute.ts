import {
    createTraderAPIMemoInstruction,
    HttpProvider,
    MAINNET_API_UK_HTTP,
    MAINNET_API_NY_HTTP,
  } from "@bloxroute/solana-trader-client-ts";
  import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    Keypair,
    SystemProgram,
  } from "@solana/web3.js";
  import base58 from "bs58";
  import { Transaction } from "@solana/web3.js";
import { BLOXROUTE_AUTH_HEADER, BLOXROUTE_FEE, PRIVATE_KEY } from "../constants";
  const TRADER_API_TIP_WALLET = "HWEoBxYs7ssKuudEjzjmpfJVX7Dvi7wescFsVx2L5yoY";
  const provider = new HttpProvider(
    BLOXROUTE_AUTH_HEADER,
    PRIVATE_KEY,
    MAINNET_API_NY_HTTP // or MAINNET_API_NY_HTTP
  );
  export async function CreateTraderAPITipTransaction(
    senderAddress:any,
    tipAmountInLamports:any
  ) {
    const tipAddress = new PublicKey(TRADER_API_TIP_WALLET);
    return new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderAddress,
        toPubkey: tipAddress,
        lamports: tipAmountInLamports,
      })
    );
  }
  export async function bloXroute_executeAndConfirm(tx: Transaction, wallet: Keypair) {
    const fee = BLOXROUTE_FEE;
    tx.add(
      await CreateTraderAPITipTransaction(
        wallet.publicKey,
        (fee) * LAMPORTS_PER_SOL
      )
    ); // why 0.001 SOL?
    tx.sign(wallet);
    const serializeTxBytes = tx.serialize();
    const buffTx = Buffer.from(serializeTxBytes);
    const encodedTx:any = buffTx.toString("base64");
  
    const request:any= {
      transaction: { content: encodedTx, isCleanup: false },
      frontRunningProtection: false,
      useStakedRPCs: true, // comment this line if you don't want to directly send txn to current blockleader
    }
    const response = await provider.postSubmit(request);
  
    if (response.signature) {
      return response.signature
    } else {
      return false
    }
  }
  
  module.exports = { bloXroute_executeAndConfirm };