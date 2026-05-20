import { Connection, PublicKey } from "@solana/web3.js";
import * as token from "@solana/spl-token";

export async function getUserTokenBalanceRaw(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
  maxRetries = 15,
  retryDelayMs = 200
): Promise<bigint> {
  const ata = token.getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const balance = await connection.getTokenAccountBalance(ata, "processed");
      return BigInt(balance.value.amount);
    } catch {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  return 0n;
}
