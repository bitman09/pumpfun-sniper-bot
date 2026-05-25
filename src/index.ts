import {
    Connection,
    Keypair,
    PublicKey,
} from "@solana/web3.js";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import base58 from "bs58";
import dotnet from 'dotenv'

import buyToken from "./pumputils/utils/buyToken";
import { buyTokenQuote, sellTokenQuote } from "./pumputils/utils/pumpSdkTrade";
import { getQuoteMarketCap, getQuoteSellPrice } from "./pumputils/utils/quotePricing";
import { Metaplex } from "@metaplex-foundation/js";
import WebSocket = require("ws");
import logger from "pretty-pino-loggers";
import {
    BUY_AMOUNT,
    BUY_AMOUNT_USDC,
    CHECK_DEV_BUY,
    CHECK_MARKET_CAP,
    CHECK_TG,
    CHECK_WEBSITE,
    CHECK_X,
    GEYSER_RPC,
    MAX_DEV_BUY_AMOUNT,
    MAX_DEV_BUY_AMOUNT_USDC,
    MIN_DEV_BUY_AMOUNT,
    MIN_DEV_BUY_AMOUNT_USDC,
    PRIVATE_KEY,
    RPC_ENDPOINT,
    RPC_WEBSOCKET_ENDPOINT,
    SIMULATION_MODE,
    SLIPPAGE,
    SNIPE_QUOTE_MODE,
    STOP_LOSS,
    TAKE_PROFIT,
    TIME_OUT,
    USDC_MINT,
} from "./constants";
import { extractAccountPubkeys, parseDevBuyFromInnerInstructions, parseTokenProgramFromInnerInstructions } from "./utils";
import { getSellPrice } from "./pumputils/utils/getSellPrice";
import sellToken from "./pumputils/utils/sellToken";
import { getUserTokenBalanceRaw } from "./pumputils/utils/getUserTokenBalance";
import {
    QuoteKind,
    detectQuoteKindFromAccounts,
    getBuyAmountForQuote,
    getEnabledQuoteKinds,
    getMarketCapThresholdForQuote,
    getStopLossThreshold,
    getTakeProfitThreshold,
    quoteLabel,
    shouldSnipeQuote,
} from "./quote/quoteKind";
dotnet.config();

const ws = new WebSocket(GEYSER_RPC);
const connection = new Connection(RPC_ENDPOINT, { wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: "processed" });
const payerKeypair = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
const enabledQuoteKinds = getEnabledQuoteKinds();

const isLaunchLog = (log: string) =>
    log.includes('Program log: Instruction: InitializeMint2') ||
    log.includes('Program log: Instruction: CreateV2');

const withGaser = () => {

    logger.info('Your Pub Key => ', payerKeypair.publicKey.toString());

    let isbuying = false;
    let positionCount = 0;

    function sendRequest(ws: WebSocket) {
        const request = {
            jsonrpc: "2.0",
            id: 420,
            method: "transactionSubscribe",
            params: [
                {
                    failed: false,
                    accountInclude: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]
                },
                {
                    commitment: "processed",
                    encoding: "jsonParsed",
                    transactionDetails: "full",
                    maxSupportedTransactionVersion: 0
                }
            ]
        };
        ws.send(JSON.stringify(request));
    }

    ws.on('open', function open() {
        console.log('WebSocket is open');
        sendRequest(ws);
    });

    ws.on('message', async function incoming(data) {
        const messageStr = data.toString('utf8');
        try {
            const messageObj = JSON.parse(messageStr);

            const result = messageObj.params.result;
            const logs = result.transaction.meta.logMessages;
            const signature = result.signature;
            const accountKeys = extractAccountPubkeys(result.transaction.transaction.message.accountKeys);
            const instructions = result.transaction.meta.innerInstructions;

            if (logs && logs.some((log: string | string[]) => isLaunchLog(String(log)))) {
                if (isbuying) return
                isbuying = true;

                positionCount++;

                const firstTime = Date.now();

                const dev = accountKeys[0];
                const mint = accountKeys[1];
                const mintPubKey = new PublicKey(mint);

                const quoteKind = detectQuoteKindFromAccounts(accountKeys);

                if (!shouldSnipeQuote(quoteKind, enabledQuoteKinds)) {
                    console.log(`Skipping ${quoteLabel(quoteKind)} pool (SNIPE_QUOTE_MODE=${SNIPE_QUOTE_MODE})`);
                    isbuying = false;
                    return;
                }

                const bondingCurvePub = bondingCurvePda(mintPubKey);
                const baseBondingCurveAta = getAssociatedTokenAddressSync(
                    mintPubKey,
                    bondingCurvePub,
                    true,
                    TOKEN_2022_PROGRAM_ID
                ).toBase58();
                const buyAmountUi = getBuyAmountForQuote(quoteKind);
                const tp = getTakeProfitThreshold(buyAmountUi, TAKE_PROFIT);
                const ls = getStopLossThreshold(buyAmountUi, STOP_LOSS);
                const mcapThreshold = getMarketCapThresholdForQuote(quoteKind);

                console.log("New signature => ", `https://solscan.io/tx/${signature}`);
                console.log('New token => ', `https://solscan.io/token/${mint}`)
                console.log(`Quote pool => ${quoteLabel(quoteKind)}`);

                const { buyQuoteAmount, buyTokenAmount } = parseDevBuyFromInnerInstructions(
                    instructions,
                    dev,
                    bondingCurvePub.toBase58(),
                    baseBondingCurveAta,
                    accountKeys
                );

                console.log(`Dev buy (${quoteLabel(quoteKind)}) =>`, buyQuoteAmount);
                console.log("Buy Token Amount => ", buyTokenAmount);

                if (!buyQuoteAmount || !buyTokenAmount || !Number.isFinite(buyTokenAmount)) {
                    isbuying = false;
                    return;
                }

                const devPub = new PublicKey(dev);
                const mintPub = mintPubKey;
                const bondingCurveAtaPub = new PublicKey(baseBondingCurveAta);
                const tokenProgram = parseTokenProgramFromInnerInstructions(instructions);

                if (CHECK_X || CHECK_WEBSITE || CHECK_TG) {
                    const tokenInfo = await getTokenMetadata(mint, connection);
                    if (tokenInfo) {
                        try {
                            if (CHECK_X && (tokenInfo.twitter.indexOf('https://x.com') === -1)) {
                                console.log('Twitter link is not valid!')
                                isbuying = false;
                                return
                            }
                            if (CHECK_TG && (tokenInfo.telegram.indexOf('https://t.me') === -1)) {
                                console.log('Telegram link is not valid!')
                                isbuying = false;
                                return
                            }
                            if (CHECK_WEBSITE && (tokenInfo.website.length === 0)) {
                                console.log('Website link is not provided!')
                                isbuying = false;
                                return
                            }
                        } catch (error) {
                            console.log("Social Check failed!")
                            isbuying = false;
                            return
                        }
                    } else {
                        console.log('token info => ', tokenInfo);
                        isbuying = false;
                        return
                    }
                }

                if (CHECK_DEV_BUY) {
                    const minDev = quoteKind === 'usdc' ? MIN_DEV_BUY_AMOUNT_USDC : MIN_DEV_BUY_AMOUNT;
                    const maxDev = quoteKind === 'usdc' ? MAX_DEV_BUY_AMOUNT_USDC : MAX_DEV_BUY_AMOUNT;
                    const unit = quoteLabel(quoteKind);

                    if (buyQuoteAmount < minDev) {
                        console.log(`Dev buy ${buyQuoteAmount} ${unit} is below minimum ${minDev} ${unit} — skipping`);
                        isbuying = false;
                        return;
                    }
                    if (Number.isFinite(maxDev) && buyQuoteAmount > maxDev) {
                        console.log(`Dev buy ${buyQuoteAmount} ${unit} is above maximum ${maxDev} ${unit} — skipping`);
                        isbuying = false;
                        return;
                    }
                }

                let isMarketChecking = false;

                if (CHECK_MARKET_CAP) {
                    const isMarketCap = await monitorMarketCap(mintPub, quoteKind, mcapThreshold);
                    if (isMarketCap) {
                        console.log("Get Market Cap!")
                        isMarketChecking = true;
                    } else {
                        isbuying = false;
                        return;
                    }
                }

                console.log("Moving to Buy");
                console.log("Is Market Checking => ", isMarketChecking);
                console.log("Check Market Cap => ", CHECK_MARKET_CAP);

                if ((isMarketChecking && CHECK_MARKET_CAP) || !CHECK_MARKET_CAP) {
                    if (SIMULATION_MODE) {
                        console.log("SIMULATION_MODE=true: real transactions are disabled.");
                        console.log(`Detected ${quoteLabel(quoteKind)} pool token that matches your filters. No buy/sell transaction will be sent.`);
                        console.log("Detection latency (ms):", Date.now() - firstTime);
                        isbuying = false;
                    } else {
                        console.log("Going to Buy!", Date.now() - firstTime);

                        let sig: { sig: string; tokenAmount: string | number } | false = false;

                        if (quoteKind === 'usdc') {
                            sig = await buyTokenQuote(
                                mintPub,
                                connection,
                                payerKeypair,
                                buyAmountUi,
                                quoteKind
                            );
                        } else {
                            const { blockhash } = await connection.getLatestBlockhash("processed");
                            sig = await buyToken(
                                devPub,
                                mintPub,
                                connection,
                                payerKeypair,
                                buyAmountUi,
                                SLIPPAGE,
                                bondingCurvePub,
                                bondingCurveAtaPub,
                                blockhash,
                                tokenProgram
                            );
                        }

                        if (!sig) {
                            console.log("Transaction failed!");
                            isbuying = false;
                        } else {
                            console.log('Buy Success: ', `https://solscan.io/tx/${sig.sig}\n`);
                            const sellResult = await monitorSellPosition(
                                mintPub,
                                bondingCurvePub,
                                payerKeypair.publicKey,
                                tokenProgram,
                                quoteKind,
                                tp,
                                ls
                            );
                            if (sellResult) {
                                let sellSig: string | false = false;
                                if (quoteKind === 'usdc') {
                                    const balanceRaw = await getUserTokenBalanceRaw(
                                        connection,
                                        mintPub,
                                        payerKeypair.publicKey,
                                        tokenProgram
                                    );
                                    sellSig = await sellTokenQuote(
                                        mintPub,
                                        connection,
                                        payerKeypair,
                                        balanceRaw > 0n ? balanceRaw : BigInt(String(sig.tokenAmount)),
                                        quoteKind
                                    );
                                } else {
                                    const blockhash = (await connection.getLatestBlockhash()).blockhash;
                                    sellSig = await sellToken(
                                        devPub,
                                        mintPub,
                                        connection,
                                        payerKeypair,
                                        sig.tokenAmount,
                                        bondingCurvePub,
                                        bondingCurveAtaPub,
                                        blockhash,
                                        tokenProgram
                                    );
                                }
                                if (sellSig) {
                                    console.log("Sell Success: ", `https://solscan.io/tx/${sellSig}\n`);
                                } else {
                                    console.log("Sell failed after exit trigger");
                                }
                            }
                            isbuying = false;
                        }
                    }
                } else {
                    isbuying = false;
                }
            }
        } catch (e) {
            isbuying = false;
        }
    });
}

const monitorSellPosition = async (
    mint: PublicKey,
    bondingCurvePub: PublicKey,
    owner: PublicKey,
    tokenProgram: PublicKey,
    quoteKind: QuoteKind,
    tp: number,
    ls: number
): Promise<number> => {
    console.log(`Monitoring token price (${quoteLabel(quoteKind)})`);
    let totalTime = 0;
    const unit = quoteLabel(quoteKind);

    return new Promise((resolve) => {
        const monitor = setInterval(async () => {
            try {
                const balanceRaw = await getUserTokenBalanceRaw(
                    connection,
                    mint,
                    owner,
                    tokenProgram,
                    3,
                    100
                );
                if (balanceRaw <= 0n) {
                    console.log("No token balance left — stopping monitor");
                    clearInterval(monitor);
                    resolve(0);
                    return;
                }

                let outAmount: number;
                if (quoteKind === 'usdc') {
                    const quote = await getQuoteSellPrice(connection, mint, balanceRaw);
                    outAmount = quote.outAmount;
                } else {
                    outAmount = await getSellPrice(
                        connection,
                        bondingCurvePub,
                        SLIPPAGE,
                        balanceRaw.toString()
                    );
                }

                console.log(`Output ${unit}`, outAmount);
                if (Number(outAmount) >= tp) {
                    console.log(`Take Profit Point! Going to sell ${outAmount} ${unit}`);
                    clearInterval(monitor);
                    resolve(outAmount);
                } else if (Number(outAmount) <= ls) {
                    console.log(`Stop Loss Point! Going to sell ${outAmount} ${unit}`);
                    clearInterval(monitor);
                    resolve(outAmount);
                }
                totalTime += 500;
                if ((totalTime / 1000) >= TIME_OUT) {
                    console.log("Time Out! Going to sell!");
                    clearInterval(monitor);
                    resolve(outAmount);
                }
            } catch (err) {
                console.error("monitorSellPosition error:", err);
            }
        }, 500);
    });
};

const monitorMarketCap = (
    mint: PublicKey,
    quoteKind: QuoteKind,
    threshold: number
): Promise<boolean> => {
    console.log(`Monitoring MarketCap (${quoteLabel(quoteKind)})...`);
    let totalTime = 0;
    const unit = quoteLabel(quoteKind);

    return new Promise((resolve) => {
        const monitor = setInterval(async () => {
            try {
                const { mc } = await getQuoteMarketCap(connection, mint);
                console.log(`🚀 Current Market Cap ${unit}:`, mc);
                if (mc >= threshold) {
                    clearInterval(monitor);
                    resolve(true);
                }
                totalTime += 500;
                if ((totalTime / 1000) >= TIME_OUT) {
                    console.log("Time Out! Going to skip this token!");
                    clearInterval(monitor);
                    resolve(false);
                }
            } catch (err) {
                console.error("monitorMarketCap error:", err);
            }
        }, 500);
    });
};

const getTokenMetadata = async (mintAddress: string, connection: Connection, retries: number = 5, delay: number = 100): Promise<any> => {
    const metaplex = Metaplex.make(connection);
    const mintPublicKey = new PublicKey(mintAddress);

    const delayFunction = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const nft = await metaplex.nfts().findByMint({ mintAddress: mintPublicKey });
            return nft.json;
        } catch (error) {
            if (attempt < retries) {
                await delayFunction(delay);
            } else {
                return false;
            }
        }
    }
};


const runBot = () => {
    console.log('--------------- Geyser mode is running! ---------------\n');
    console.log(`SIMULATION_MODE => ${SIMULATION_MODE} (${SIMULATION_MODE ? 'no real buys/sells' : 'live trading enabled'})`);
    console.log(`SNIPE_QUOTE_MODE => ${SNIPE_QUOTE_MODE} (enabled: ${[...enabledQuoteKinds].join(', ')})`);
    console.log(`SOL buy amount => ${BUY_AMOUNT} SOL | USDC buy amount => ${BUY_AMOUNT_USDC} USDC`);
    console.log(`USDC mint => ${USDC_MINT.toBase58()}`);
    if (CHECK_DEV_BUY) {
        const maxSol = Number.isFinite(MAX_DEV_BUY_AMOUNT) ? `${MAX_DEV_BUY_AMOUNT} SOL` : 'infinity';
        const maxUsdc = Number.isFinite(MAX_DEV_BUY_AMOUNT_USDC) ? `${MAX_DEV_BUY_AMOUNT_USDC} USDC` : 'infinity';
        console.log(`CHECK_DEV_BUY => true`);
        console.log(`  SOL dev buy range: ${MIN_DEV_BUY_AMOUNT} – ${maxSol}`);
        console.log(`  USDC dev buy range: ${MIN_DEV_BUY_AMOUNT_USDC} – ${maxUsdc}`);
    } else {
        console.log(`CHECK_DEV_BUY => false (dev buy min/max ignored)`);
    }
    console.log(`Token program => Token-2022 (TokenzQd...)\n`);
    withGaser();
}

runBot()
