import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import getBondingCurveTokenAccountWithRetry from "./getBondingCurveTokenAccountWithRetry";
import tokenDataFromBondingCurveTokenAccBuffer from "./tokenDataFromBondingCurveTokenAccBuffer";

const BOANDING_CURVE_ACC_RETRY_AMOUNT = 5;

export const getSellPrice = async (connection: Connection, bondingCurve: PublicKey, slippage: number, tokenAmount: number) => {
    const bondingCurveTokenAccount = await getBondingCurveTokenAccountWithRetry(
        connection,
        bondingCurve,
        BOANDING_CURVE_ACC_RETRY_AMOUNT
    );

    if (bondingCurveTokenAccount === null) {
        throw new Error("Bonding curve account not found");
    }
    const tokenData = tokenDataFromBondingCurveTokenAccBuffer(bondingCurveTokenAccount!.data);

    const SLIPAGE_POINTS = BigInt(slippage * 100);
    const tokenAmountLam = BigInt(tokenAmount);
    const solOutAmount = await getTokenOut(tokenAmountLam, 100n, tokenData);
    return Number(solOutAmount) / LAMPORTS_PER_SOL
}

export const getTokenOut = async (amount: bigint, feeBasisPoints: bigint, tokenData: any) => {
    if (amount <= 0n) {
        return 0n;
    }

    // Calculate the proportional amount of virtual sol reserves to be received
    let n =
        (amount * tokenData.virtualSolReserves) / (tokenData.virtualTokenReserves + amount);

    // Calculate the fee amount in the same units
    let a = (n * feeBasisPoints) / 10000n;

    // Return the net amount after deducting the fee
    return n - a;
}
