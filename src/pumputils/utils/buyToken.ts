import * as token from "@solana/spl-token";
import * as web3 from "@solana/web3.js";
import tokenDataFromBondingCurveTokenAccBuffer from "./tokenDataFromBondingCurveTokenAccBuffer";
import getBuyPrice from "./getBuyPrice";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { BN } from "bn.js";
import { PumpFun } from "../idl/pump-fun";
import IDL from "../idl/pump-fun.json";
import getBondingCurveTokenAccountWithRetry from "./getBondingCurveTokenAccountWithRetry";
import { SystemProgram } from "@solana/web3.js";
import { BLOXROUTE_MODE, NEXT_BLOCK_API, NEXT_BLOCK_FEE, NEXTBLOCK_MODE, PRIORITY_FEE } from "../../constants";
import { bloXroute_executeAndConfirm } from "../../executor/bloXroute";
import { getCreatorVault } from "./getCreatorVault";

const BOANDING_CURVE_ACC_RETRY_AMOUNT = 5;
const BOANDING_CURVE_ACC_RETRY_DELAY = 50;


interface Payload {
  transaction: TransactionMessages;
}

interface TransactionMessages {
  content: string;
}

async function buyToken(
  dev: web3.PublicKey,
  mint: web3.PublicKey,
  connection: web3.Connection,
  keypair: web3.Keypair,
  solAmount: number,
  slippage: number,
  bondingCurve: web3.PublicKey,
  associatedBondingCurve: web3.PublicKey,
  blockhash: string,
) {
  try {
    const firstTime = Date.now();
    // Load Pumpfun provider
    const provider = new AnchorProvider(connection, new Wallet(keypair), {
      commitment: "processed",
    });
    const program = new Program<PumpFun>(IDL as PumpFun, provider);

    // Create transaction
    const transaction = new web3.Transaction();

    // Get/Create token account
    const associatedUser = token.getAssociatedTokenAddressSync(mint, keypair.publicKey, false);

    const bondingCurveTokenAccount = await getBondingCurveTokenAccountWithRetry(
      connection,
      bondingCurve,
      BOANDING_CURVE_ACC_RETRY_AMOUNT
    );

    const creatorVault = await getCreatorVault(dev, program.programId);

    if (bondingCurveTokenAccount === null) {
      throw new Error("Bonding curve account not found");
    }
    const tokenData = tokenDataFromBondingCurveTokenAccBuffer(bondingCurveTokenAccount!.data);
    if (tokenData.complete) {
      throw new Error("Bonding curve already completed");
    }
    const SLIPAGE_POINTS = BigInt(slippage * 100);
    const solAmountLamp = BigInt(solAmount * web3.LAMPORTS_PER_SOL);
    const buyAmountToken = getBuyPrice(solAmountLamp, tokenData);
    const buyAmountSolWithSlippage = solAmountLamp + (solAmountLamp * SLIPAGE_POINTS) / 10000n;

    const FEE_RECEIPT = new web3.PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

    // request a specific compute unit budget
    const modifyComputeUnits = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 70_000,
    });

    // set the desired priority fee
    const addPriorityFee = web3.ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor((PRIORITY_FEE * 10 ** 9) / 70_000 * 10 ** 6)
    });

    transaction
      .add(modifyComputeUnits)
      .add(addPriorityFee)
      .add(token.createAssociatedTokenAccountInstruction(keypair.publicKey, associatedUser, keypair.publicKey, mint))
      .add(
        await program.methods
          .buy(new BN(buyAmountToken.toString()), new BN(buyAmountSolWithSlippage.toString()), { "0": true })
          .accounts({
            associatedUser: associatedUser,
            feeRecipient: FEE_RECEIPT,
            mint: mint,
            user: keypair.publicKey
          })
          .transaction()
      );

    transaction.feePayer = keypair.publicKey;
    transaction.recentBlockhash = blockhash;

    if (NEXTBLOCK_MODE) {
      const next_block_addrs = [
        'NEXTbLoCkB51HpLBLojQfpyVAMorm3zzKg7w9NFdqid',
        // 'NeXTBLoCKs9F1y5PJS9CKrFNNLU1keHW71rfh7KgA1X',
        // 'NexTBLockJYZ7QD7p2byrUa6df8ndV2WSd8GkbWqfbb',
        // 'neXtBLock1LeC67jYd1QdAa32kbVeubsfPNTJC1V5At',
        // 'nEXTBLockYgngeRmRrjDV31mGSekVPqZoMGhQEZtPVG',
        // 'nextBLoCkPMgmG8ZgJtABeScP35qLa2AMCNKntAP7Xc',
        // 'NextbLoCkVtMGcV47JzewQdvBpLqT9TxQFozQkN98pE',
        // 'NexTbLoCkWykbLuB1NkjXgFWkX9oAtcoagQegygXXA2'
      ]

      for (let i = 0; i < next_block_addrs.length; i++) {
        const next_block_addr = next_block_addrs[i];

        if (!next_block_addr) return console.log("Nextblock wallet is not provided");
        if (!NEXT_BLOCK_API) return console.log("Nextblock block api is not provided");

        // NextBlock Instruction
        const recipientPublicKey = new web3.PublicKey(next_block_addr);
        const transferInstruction = SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: recipientPublicKey,
          lamports: NEXT_BLOCK_FEE * web3.LAMPORTS_PER_SOL
        });

        transaction.add(transferInstruction);

        transaction.sign(keypair)

        const tx64Str = transaction.serialize().toString('base64');
        const payload: Payload = {
          transaction: {
            content: tx64Str
          }
        };

        try {
          const response = await fetch('https://fra.nextblock.io/api/v2/submit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'authorization': NEXT_BLOCK_API // Insert your authorization token here
            },
            body: JSON.stringify(payload)
          });

          const responseData = await response.json();

          if (response.ok) {
            return {
              sig: transaction.signature?.toString(),
              tokenAmount: Number(buyAmountToken)
            }
          } else {
            console.error("Failed to send transaction:", response.status, responseData);
            return false
          }
        } catch (error) {
          console.error("Error sending transaction:", error);
          return false
        }
      }
    } else if (BLOXROUTE_MODE) {
      const result = await bloXroute_executeAndConfirm(transaction, keypair);
      if (result) {
        return {
          sig: result,
          tokenAmount: Number(buyAmountToken)
        }
      } else {
        return false
      }
    } else {
      const txSig = await connection.sendTransaction(transaction, [keypair]);
      const confirmSig = await connection.confirmTransaction(txSig, 'confirmed');
      
      if (!confirmSig.value.err) {
        return false
      } else {
        return {
          sig: txSig,
          tokenAmount: Number(buyAmountToken)
        }
      }
    }

  } catch (error) {
    console.error(error);
    return false
  }
}
export default buyToken;
