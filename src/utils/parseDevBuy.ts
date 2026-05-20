import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

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

export const parseDevBuyFromInnerInstructions = (
    innerInstructions: InnerInstructionGroup[],
    dev: string,
    bondingCurve: string,
    bondingCurveAta: string
): { buySolAmount: number; buyTokenAmount: number } => {
    let buySolAmount = 0;
    let buyTokenAmount = 0;

    for (const group of innerInstructions) {
        let groupTokenRaw: number | null = null;
        let groupSolLamports = 0;

        for (const ix of group.instructions) {
            const parsed = ix.parsed;
            if (!parsed?.info) continue;

            const info = parsed.info;

            if (
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

        if (groupTokenRaw != null && groupSolLamports > 0) {
            buyTokenAmount = groupTokenRaw / 1_000_000;
            buySolAmount = groupSolLamports / LAMPORTS_PER_SOL;
            break;
        }

        if (groupSolLamports > buySolAmount * LAMPORTS_PER_SOL) {
            buySolAmount = groupSolLamports / LAMPORTS_PER_SOL;
        }
        if (groupTokenRaw != null && buyTokenAmount === 0) {
            buyTokenAmount = groupTokenRaw / 1_000_000;
        }
    }

    return { buySolAmount, buyTokenAmount };
};

export const extractAccountPubkeys = (
    accountKeys: Array<string | { pubkey: string }>
): string[] => accountKeys.map(toPubkey);

/** Pump.fun sniper uses Token-2022 only (no RPC lookup). */
export const parseTokenProgramFromInnerInstructions = (
    _innerInstructions: InnerInstructionGroup[]
): PublicKey => TOKEN_2022_PROGRAM_ID;
