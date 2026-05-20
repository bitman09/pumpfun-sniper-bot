import dotenv from "dotenv";
import base58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  createHarvestWithheldTokensToMintInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

dotenv.config();

const BATCH_SIZE = 3;

type TokenAccountRow = {
  pubkey: PublicKey;
  mint: PublicKey;
  amount: bigint;
  decimals: number;
  programId: PublicKey;
};

async function buildBurnCloseInstructions(
  row: TokenAccountRow,
  payer: PublicKey
): Promise<TransactionInstruction[]> {
  const ix: TransactionInstruction[] = [
    createBurnCheckedInstruction(
      row.pubkey,
      row.mint,
      payer,
      row.amount,
      row.decimals,
      [],
      row.programId
    ),
  ];

  // Pump.fun mints use Token-2022 transfer fees; harvest before close (error 0x23).
  if (row.programId.equals(TOKEN_2022_PROGRAM_ID)) {
    ix.push(
      createHarvestWithheldTokensToMintInstruction(
        row.mint,
        [row.pubkey],
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  ix.push(
    createCloseAccountInstruction(
      row.pubkey,
      payer,
      payer,
      [],
      row.programId
    )
  );

  return ix;
}

async function buildCloseOnlyInstructions(
  pubkey: PublicKey,
  mint: PublicKey,
  payer: PublicKey,
  programId: PublicKey
): Promise<TransactionInstruction[]> {
  const ix: TransactionInstruction[] = [];

  if (programId.equals(TOKEN_2022_PROGRAM_ID)) {
    ix.push(
      createHarvestWithheldTokensToMintInstruction(mint, [pubkey], TOKEN_2022_PROGRAM_ID)
    );
  }

  ix.push(
    createCloseAccountInstruction(pubkey, payer, payer, [], programId)
  );

  return ix;
}

async function sendTx(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[]
): Promise<string> {
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
    skipPreflight: false,
  });
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY?.trim();
  const rpc = process.env.RPC_ENDPOINT?.trim();

  if (!privateKey || !rpc) {
    console.error("PRIVATE_KEY and RPC_ENDPOINT must be set in .env");
    process.exit(1);
  }

  const connection = new Connection(rpc, "confirmed");
  const payer = Keypair.fromSecretKey(base58.decode(privateKey));

  console.log("Wallet:", payer.publicKey.toBase58());
  console.log("Fetching token accounts...\n");

  const rows: TokenAccountRow[] = [];

  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const { value: accounts } = await connection.getParsedTokenAccountsByOwner(
      payer.publicKey,
      { programId }
    );

    for (const { pubkey, account } of accounts) {
      const parsed = account.data.parsed;
      if (!parsed || parsed.type !== "account") continue;

      const info = parsed.info;
      const amount = BigInt(info.tokenAmount.amount);
      if (amount <= BigInt(0)) continue;

      rows.push({
        pubkey,
        mint: new PublicKey(info.mint),
        amount,
        decimals: info.tokenAmount.decimals,
        programId,
      });
    }
  }

  if (rows.length === 0) {
    console.log("No token balances to burn.");
  } else {
    console.log(`Found ${rows.length} token account(s) with balance:\n`);
    for (const row of rows) {
      const ui = Number(row.amount) / 10 ** row.decimals;
      console.log(
        `  ${row.mint.toBase58().slice(0, 8)}... | ${ui} tokens | ${row.pubkey.toBase58().slice(0, 8)}...`
      );
    }
    console.log("\nBurning all balances and closing accounts...\n");

    let burned = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const batchIx: TransactionInstruction[] = [];

      for (const row of batch) {
        batchIx.push(...(await buildBurnCloseInstructions(row, payer.publicKey)));
      }

      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      try {
        const sig = await sendTx(connection, payer, batchIx);
        burned += batch.length;
        console.log(`Batch ${batchNum}: ${batch.length} token(s) — ${sig}`);
      } catch (err) {
        console.error(`Batch ${batchNum} failed, retrying one-by-one...`);
        for (const row of batch) {
          try {
            const ix = await buildBurnCloseInstructions(row, payer.publicKey);
            const sig = await sendTx(connection, payer, ix);
            burned++;
            console.log(`  OK ${row.mint.toBase58().slice(0, 8)}... — ${sig}`);
          } catch (rowErr) {
            failed++;
            console.error(`  FAIL ${row.mint.toBase58()}:`, rowErr);
          }
        }
      }
    }

    console.log(`\nBurn pass done. Burned: ${burned}, Failed: ${failed}`);
  }

  await closeEmptyTokenAccounts(connection, payer);
}

async function closeEmptyTokenAccounts(connection: Connection, payer: Keypair) {
  const empty: { pubkey: PublicKey; mint: PublicKey; programId: PublicKey }[] = [];

  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const { value: accounts } = await connection.getParsedTokenAccountsByOwner(
      payer.publicKey,
      { programId }
    );
    for (const { pubkey, account } of accounts) {
      const parsed = account.data.parsed;
      if (!parsed || parsed.type !== "account") continue;
      if (BigInt(parsed.info.tokenAmount.amount) === BigInt(0)) {
        empty.push({
          pubkey,
          mint: new PublicKey(parsed.info.mint),
          programId,
        });
      }
    }
  }

  if (empty.length === 0) return;

  console.log(`\nClosing ${empty.length} empty token account(s)...`);

  let closed = 0;
  for (const { pubkey, mint, programId } of empty) {
    try {
      const ix = await buildCloseOnlyInstructions(
        pubkey,
        mint,
        payer.publicKey,
        programId
      );
      const sig = await sendTx(connection, payer, ix);
      closed++;
      console.log(`  Closed ${mint.toBase58().slice(0, 8)}... — ${sig}`);
    } catch (err) {
      console.error(`  Close failed ${mint.toBase58()}:`, err);
    }
  }

  console.log(`Closed ${closed}/${empty.length} empty account(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
