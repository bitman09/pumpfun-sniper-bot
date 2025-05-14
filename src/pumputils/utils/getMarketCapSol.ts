import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import getBondingCurveTokenAccountWithRetry from "./getBondingCurveTokenAccountWithRetry";
import tokenDataFromBondingCurveTokenAccBuffer from "./tokenDataFromBondingCurveTokenAccBuffer";

const BOANDING_CURVE_ACC_RETRY_AMOUNT = 5;

export const getMC = async (connection: Connection, bondingCurve: PublicKey) => {
    const bondingCurveTokenAccount = await getBondingCurveTokenAccountWithRetry(
        connection,
        bondingCurve,
        BOANDING_CURVE_ACC_RETRY_AMOUNT
    );

    if (bondingCurveTokenAccount === null) {
        throw new Error("Bonding curve account not found");
    }
    const tokenData = tokenDataFromBondingCurveTokenAccBuffer(bondingCurveTokenAccount!.data);

    const mcSol = getMarketCapSOL(tokenData);
    return Number(mcSol) / LAMPORTS_PER_SOL
}

export const getMarketCapSOL = (tokenData: any) => {
    if (tokenData.virtualTokenReserves === 0n) {
      return 0n;
    }

    return (
      (tokenData.tokenTotalSupply * tokenData.virtualSolReserves) /
      tokenData.virtualTokenReserves
    );
  }