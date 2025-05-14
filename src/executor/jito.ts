import { AddressLookupTableAccount, Commitment, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import axios from "axios";
import { JITO_FEE, NEXT_BLOCK_API, NEXT_BLOCK_FEE, NEXTBLOCK_MODE, PRIORITY_FEE, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "../constants";


interface Payload {
  transaction: TransactionMessages;
}

interface TransactionMessages {
  content: string;
}

const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
})

export const executeJitoTx = async (transactions: VersionedTransaction[], payer: Keypair, commitment: Commitment, latestBlockhash: any) => {

  // console.log('Starting Jito transaction execution...');
  const tipAccounts = [
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  ];
  const jitoFeeWallet = new PublicKey(tipAccounts[Math.floor(tipAccounts.length * Math.random())])

  // console.log(`Selected Jito fee wallet: ${jitoFeeWallet.toBase58()}`);

  try {
    const jitTipTxFeeMessage = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: jitoFeeWallet,
          lamports: Math.floor(JITO_FEE * 10 ** 9),
        }),
      ],
    }).compileToV0Message();

    const jitoFeeTx = new VersionedTransaction(jitTipTxFeeMessage);
    jitoFeeTx.sign([payer]);


    const jitoTxsignature = base58.encode(transactions[0].signatures[0]);

    // Serialize the transactions once here
    const serializedjitoFeeTx = base58.encode(jitoFeeTx.serialize());
    const serializedTransactions = [serializedjitoFeeTx];
    for (let i = 0; i < transactions.length; i++) {
      let message = transactions[i].message;
      let addressLookupTableAccounts = await loadAddressLookupTablesFromMessage(message, solanaConnection);
      let txMessage = TransactionMessage.decompile(message, { addressLookupTableAccounts });
      let newMessage = txMessage.compileToV0Message(addressLookupTableAccounts);
      newMessage.recentBlockhash = latestBlockhash.blockhash;

      let newTransaction = new VersionedTransaction(newMessage);
      newTransaction.sign([payer]);
      const serializedTransaction = base58.encode(newTransaction.serialize());
      serializedTransactions.push(serializedTransaction);
    }


    const endpoints = [
      // 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
      // 'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
      // 'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
      // 'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
    ];

    const requests = endpoints.map((url) =>
      axios.post(url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [serializedTransactions],
      })
    );

    // console.log('Sending transactions to endpoints...');

    const results = await Promise.all(requests.map((p) => p.catch((e) => e)));

    const successfulResults = results.filter((result) => !(result instanceof Error));

    if (successfulResults.length > 0) {
      // console.log(`Successful response`);
      // console.log(`Confirming jito transaction...`);

      const confirmation = await solanaConnection.confirmTransaction(
        {
          signature: jitoTxsignature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        commitment,
      );

      if (confirmation.value.err) {
        console.log("Confirmtaion error")
        return null
      } else {
        return jitoTxsignature;
      }
    } else {
      console.log(`No successful responses received for jito`);
    }
    console.log("case 1")
    return null
  } catch (error) {
    console.log('Error during transaction execution', error);
    return null
  }
}

export const excuteBlockTx = async (transaction: VersionedTransaction, payer: Keypair, commitment: Commitment) => {
  const next_block_addrs = [
    'NEXTbLoCkB51HpLBLojQfpyVAMorm3zzKg7w9NFdqid',
    'NeXTBLoCKs9F1y5PJS9CKrFNNLU1keHW71rfh7KgA1X',
    'NexTBLockJYZ7QD7p2byrUa6df8ndV2WSd8GkbWqfbb',
    'neXtBLock1LeC67jYd1QdAa32kbVeubsfPNTJC1V5At',
    'nEXTBLockYgngeRmRrjDV31mGSekVPqZoMGhQEZtPVG',
    'nextBLoCkPMgmG8ZgJtABeScP35qLa2AMCNKntAP7Xc',
    'NextbLoCkVtMGcV47JzewQdvBpLqT9TxQFozQkN98pE',
    'NexTbLoCkWykbLuB1NkjXgFWkX9oAtcoagQegygXXA2'
  ]

  for (let i = 0; i < next_block_addrs.length; i++) {
    const next_block_addr = next_block_addrs[i];
    const next_block_api = NEXT_BLOCK_API;

    if (!next_block_addr) return console.log("Nextblock wallet is not provided");
    if (!next_block_api) return console.log("Nextblock block api is not provided");

    // NextBlock Instruction
    const recipientPublicKey = new PublicKey(next_block_addr);
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipientPublicKey,
      lamports: NEXT_BLOCK_FEE * LAMPORTS_PER_SOL
    });


    const latestBlockhash = await solanaConnection.getLatestBlockhash()

    let message = transaction.message;
    let addressLookupTableAccounts = await loadAddressLookupTablesFromMessage(message, solanaConnection);
    let txMessage = TransactionMessage.decompile(message, { addressLookupTableAccounts });

    txMessage.instructions.push(transferInstruction);

    let newMessage = txMessage.compileToV0Message(addressLookupTableAccounts);
    newMessage.recentBlockhash = latestBlockhash.blockhash;

    let newTransaction = new VersionedTransaction(newMessage);
    newTransaction.sign([payer]);

    console.log(await solanaConnection.simulateTransaction(newTransaction));

    // const tx64Str = transaction.serialize().toString();
    const tx64Str = Buffer.from(newTransaction.serialize()).toString('base64');
    const payload: Payload = {
      transaction: {
        content: tx64Str
      }
    };

    try {
      console.log("Trying transaction to confirm using nextblock")
      const response = await fetch('https://fra.nextblock.io/api/v2/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authorization': next_block_api // Insert your authorization token here
        },
        body: JSON.stringify(payload)
      });

      const responseData = await response.json();

      if (response.ok) {
        return responseData.signature.toString()
      } else {
        console.error("Failed to send transaction:", response.status, responseData);
        continue;
      }
    } catch (error) {
      console.error("Error sending transaction:", error);
      continue;
    }
  }
}

async function loadAddressLookupTablesFromMessage(message: VersionedMessage, connection: Connection) {
  let addressLookupTableAccounts: AddressLookupTableAccount[] = [];
  for (let lookup of message.addressTableLookups) {
    let lutAccounts = await connection.getAddressLookupTable(lookup.accountKey);
    addressLookupTableAccounts.push(lutAccounts.value!);
  }

  return addressLookupTableAccounts;
}
