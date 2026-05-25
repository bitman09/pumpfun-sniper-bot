import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { USDC_DECIMALS, USDC_MINT } from "../constants";
import { QuoteKind } from "../quote/quoteKind";

type ParsedInstruction = {
    program?: string;
    programId?: string;
    parsed?: {
        type?: string;
        info?: Record<string, unknown>;
    };
};

type InnerInstructionGroup = {
    instructions: ParsedInstruction[];
};

export type DevBuyResult = {
    buyQuoteAmount: number;
    buyTokenAmount: number;
    quoteKind: QuoteKind;
};

const toPubkey = (key: string | { pubkey: string }): string =>
    typeof key === "string" ? key : key.pubkey;

const getTokenAmountRaw = (info: Record<string, unknown>): number | null => {
    if (typeof info.amount === "string" || typeof info.amount === "number") {
        return Number(info.amount);
    }
    const tokenAmount = info.tokenAmount as
        | { amount?: string | number; uiAmount?: number }
        | undefined;
    if (tokenAmount?.amount != null) {
        return Number(tokenAmount.amount);
    }
    if (tokenAmount?.uiAmount != null) {
        return Math.round(tokenAmount.uiAmount * 1_000_000);
    }
    return null;
};

const usdcMintStr = USDC_MINT.toBase58();

export const parseDevBuyFromInnerInstructions = (
    innerInstructions: InnerInstructionGroup[],
    dev: string,
    bondingCurve: string,
    bondingCurveAta: string,
    accountKeys: string[] = []
): DevBuyResult => {
    const isUsdcPool = accountKeys.includes(usdcMintStr);
    let buyQuoteAmount = 0;
    let buyTokenAmount = 0;
    let maxUsdcRaw = 0;

    for (const group of innerInstructions) {
        let groupTokenRaw: number | null = null;
        let groupSolLamports = 0;
        let groupUsdcRaw = 0;

        for (const ix of group.instructions) {
            const parsed = ix.parsed;
            if (!parsed?.info) continue;

            const info = parsed.info;

            if (
                !isUsdcPool &&
                ix.program === "system" &&
                parsed.type === "transfer" &&
                info.source === dev &&
                info.destination === bondingCurve
            ) {
                const lamports = Number(info.lamports);
                if (lamports > groupSolLamports) {
                    groupSolLamports = lamports;
                }
            }

            if (
                isUsdcPool &&
                ix.program === "spl-token" &&
                parsed.type === "transferChecked" &&
                info.mint === usdcMintStr
            ) {
                const raw = getTokenAmountRaw(info);
                if (raw != null && raw > groupUsdcRaw) {
                    groupUsdcRaw = raw;
                }
            }

            if (
                ix.program === "spl-token" &&
                (parsed.type === "transfer" || parsed.type === "transferChecked") &&
                info.source === bondingCurveAta
            ) {
                const raw = getTokenAmountRaw(info);
                if (raw != null && raw > 0) {
                    groupTokenRaw = raw;
                }
            }
        }

        if (isUsdcPool && groupUsdcRaw > 0 && groupTokenRaw != null) {
            buyTokenAmount = groupTokenRaw / 1_000_000;
            buyQuoteAmount = groupUsdcRaw / 10 ** USDC_DECIMALS;
            break;
        }

        if (!isUsdcPool && groupTokenRaw != null && groupSolLamports > 0) {
            buyTokenAmount = groupTokenRaw / 1_000_000;
            buyQuoteAmount = groupSolLamports / LAMPORTS_PER_SOL;
            break;
        }

        if (!isUsdcPool && groupSolLamports > buyQuoteAmount * LAMPORTS_PER_SOL) {
            buyQuoteAmount = groupSolLamports / LAMPORTS_PER_SOL;
        }
        if (groupTokenRaw != null && buyTokenAmount === 0) {
            buyTokenAmount = groupTokenRaw / 1_000_000;
        }
        if (isUsdcPool && groupUsdcRaw > maxUsdcRaw) {
            maxUsdcRaw = groupUsdcRaw;
            buyQuoteAmount = groupUsdcRaw / 10 ** USDC_DECIMALS;
        }
    }

    return {
        buyQuoteAmount,
        buyTokenAmount,
        quoteKind: isUsdcPool ? "usdc" : "sol",
    };
};

export const extractAccountPubkeys = (
    accountKeys: Array<string | { pubkey: string }>
): string[] => accountKeys.map(toPubkey);

/** Pump.fun sniper uses Token-2022 for base mints. */
export const parseTokenProgramFromInnerInstructions = (
    _innerInstructions: InnerInstructionGroup[]
): PublicKey => TOKEN_2022_PROGRAM_ID;
