import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pump.fun new mints use Token-2022 — always prefer this for sniping. */
export const PUMP_TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

export function resolvePumpTokenProgram(_hint?: PublicKey): PublicKey {
  return PUMP_TOKEN_PROGRAM;
}

export async function confirmSignature(
  connection: Connection,
  signature: string,
  timeoutMs = 30_000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (!status) {
      await sleep(400);
      continue;
    }
    if (status.err) {
      return false;
    }
    if (
      status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized"
    ) {
      return true;
    }
    await sleep(400);
  }
  return false;
}
