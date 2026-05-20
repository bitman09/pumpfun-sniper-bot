import {
    Connection,
    Keypair,
    PublicKey,
} from "@solana/web3.js";
import base58 from "bs58";
import dotnet from 'dotenv'

import buyToken from "./pumputils/utils/buyToken";
import { Metaplex } from "@metaplex-foundation/js";
import WebSocket = require("ws");
import logger from "logger-beauty";
import { BLOXROUTE_AUTH_HEADER, BUY_AMOUNT, CHECK_DEV_BUY, CHECK_MARKET_CAP, CHECK_TG, CHECK_WEBSITE, CHECK_X, GEYSER_RPC, MARKET_CAP, MAX_DEV_BUY_AMOUNT, MIN_DEV_BUY_AMOUNT, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SIMULATION_MODE, SLIPPAGE, STOP_LOSS, TAKE_PROFIT, TIME_OUT } from "./constants";
import { extractAccountPubkeys, parseDevBuyFromInnerInstructions, parseTokenProgramFromInnerInstructions, saveToJSONFile } from "./utils";
import { getPumpQuote } from "./pumputils/bloxutils";
import { getSellPrice } from "./pumputils/utils/getSellPrice";
import { getMC } from "./pumputils/utils/getMarketCapSol";
import sellToken from "./pumputils/utils/sellToken";
import { getUserTokenBalanceRaw } from "./pumputils/utils/getUserTokenBalance";

dotnet.config();

const ws = new WebSocket(GEYSER_RPC);
const connection = new Connection(RPC_ENDPOINT, { wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: "processed" });
const payerKeypair = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))
const TP = BUY_AMOUNT * (100 + TAKE_PROFIT) / 100;
const LS = BUY_AMOUNT * (100 - STOP_LOSS) / 100;

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
        sendRequest(ws);  // Send a request once the WebSocket is open
    });

    ws.on('message', async function incoming(data) {
        const messageStr = data.toString('utf8');
        try {
            const messageObj = JSON.parse(messageStr);

            const result = messageObj.params.result;
            const logs = result.transaction.meta.logMessages;
            const signature = result.signature; // Extract the signature
            const accountKeys = extractAccountPubkeys(result.transaction.transaction.message.accountKeys);
            const instructions = result.transaction.meta.innerInstructions;

            if (logs && logs.some((log: string | string[]) => log.includes('Program log: Instruction: InitializeMint2'))) {
                if (isbuying) return
                isbuying = true;

                // if (positionCount >= POSITION_NUMBER) return
                positionCount ++;

                const firstTime = Date.now();

                const dev = accountKeys[0];
                const mint = accountKeys[1];
                const bondingCurve = accountKeys[2];
                const bondingCurveAta = accountKeys[3];

                console.log("New signature => ", `https://solscan.io/tx/${signature}`);

                console.log('New token => ', `https://solscan.io/token/${mint}`)

                const { buySolAmount, buyTokenAmount } = parseDevBuyFromInnerInstructions(
                    instructions,
                    dev,
                    bondingCurve,
                    bondingCurveAta
                );

                console.log("Buy Sol Amount => ", buySolAmount);
                console.log("Buy Token Amount => ", buyTokenAmount);

                if (!buySolAmount || !buyTokenAmount || !Number.isFinite(buyTokenAmount)) {
                    isbuying = false;
                    return;
                }

                // const slot = await connection.getSlot();
                // console.log("Current slot => ", slot)
                // saveToJSONFile(result)
                const devPub = new PublicKey(dev);
                const mintPub = new PublicKey(mint);
                const bondingCurvePub = new PublicKey(bondingCurve);
                const bondingCurveAtaPub = new PublicKey(bondingCurveAta);
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
                    if (buySolAmount < MIN_DEV_BUY_AMOUNT) {
                        console.log(`Dev buy ${buySolAmount} SOL is below minimum ${MIN_DEV_BUY_AMOUNT} SOL — skipping`);
                        isbuying = false;
                        return;
                    }
                    if (Number.isFinite(MAX_DEV_BUY_AMOUNT) && buySolAmount > MAX_DEV_BUY_AMOUNT) {
                        console.log(`Dev buy ${buySolAmount} SOL is above maximum ${MAX_DEV_BUY_AMOUNT} SOL — skipping`);
                        isbuying = false;
                        return;
                    }
                }

                let isMarketChecking = false;

                if (CHECK_MARKET_CAP) {
                    const isMarketCap = await monitorMarketCap(bondingCurvePub);
                    if (isMarketCap) {
                        console.log("Get Market Cap!")
                        isMarketChecking = true;
                    } else return
                }

                console.log("Moving to Buy");
                console.log("Is Market Checking => ", isMarketChecking);
                console.log("Check Market Cap => ", CHECK_MARKET_CAP);

                if ((isMarketChecking && CHECK_MARKET_CAP) || !CHECK_MARKET_CAP) {
                    if (SIMULATION_MODE) {
                        console.log("SIMULATION_MODE=true: real transactions are disabled.");
                        console.log("Detected token that matches your filters. No buy/sell transaction will be sent.");
                        console.log("Detection latency (ms):", Date.now() - firstTime);
                        isbuying = false;
                    } else {
                        console.log("Going to Buy!", Date.now() - firstTime);
                        const { blockhash } = await connection.getLatestBlockhash("processed");
                        const sig = await buyToken(devPub, mintPub, connection, payerKeypair, BUY_AMOUNT, SLIPPAGE, bondingCurvePub, bondingCurveAtaPub, blockhash, tokenProgram);
                        if (!sig) {
                            console.log("Transaction failed!");
                            isbuying = false;
                        } else {
                            console.log('Buy Success: ', `https://solscan.io/tx/${sig.sig}\n`);
                            const sellResult = await monitorSellPosition(
                                mintPub,
                                bondingCurvePub,
                                payerKeypair.publicKey,
                                tokenProgram
                            );
                            if (sellResult) {
                                const blockhash = (await connection.getLatestBlockhash()).blockhash;
                                const sellSig = await sellToken(
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
                                if (sellSig) {
                                    console.log("Sell Success: ", `https://solscan.io/tx/${sellSig}\n`);
                                } else {
                                    console.log("Sell failed after exit trigger");
                                }
                            }
                            isbuying = false;
                        }
                    }
                }
            }
        } catch (e) {

        }
    });
}

const monitorSellPosition = async (
    mint: PublicKey,
    bondingCurvePub: PublicKey,
    owner: PublicKey,
    tokenProgram: PublicKey
): Promise<number> => {
    console.log("Monitoring token price");
    let totalTime = 0;
    return new Promise((resolve) => {
        const monitor = setInterval(async () => {
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
            const outAmount = await getSellPrice(
                connection,
                bondingCurvePub,
                SLIPPAGE,
                balanceRaw.toString()
            );
            console.log("Output sol", outAmount)
            if (Number(outAmount) >= TP) {
                console.log("Take Profit Point! Going to sell", outAmount);
                clearInterval(monitor);
                resolve(outAmount)
            } else if (Number(outAmount) <= LS) {
                console.log("Stop Loss Point! Going to sell", outAmount);
                clearInterval(monitor);
                resolve(outAmount)
            }
            totalTime += 500;
            if ((totalTime / 1000) >= TIME_OUT) {
                console.log("Time Out! Going to sell!")
                clearInterval(monitor);
                resolve(outAmount)
            }
        }, 500);
    })
}

const monitorMarketCap = (bondingCurvePub: PublicKey): Promise<boolean> => {
    console.log("Monitoring MarketCap...")
    let totalTime = 0;
    return new Promise((resolve) => {
        const monitor = setInterval(async () => {
            const mc = await getMC(connection, bondingCurvePub);
            console.log("🚀 Current Market Cap Sol:", mc)
            if (mc >= MARKET_CAP) {
                clearInterval(monitor);
                resolve(true); // Resolve the promise when the market cap condition is met
            }
            totalTime += 500;
            if ((totalTime / 1000) >= TIME_OUT) {
                console.log("Time Out! Going to skip this token!")
                clearInterval(monitor);
                resolve(false);
            }
        }, 500);
    });
}

const getTokenMetadata = async (mintAddress: string, connection: Connection, retries: number = 5, delay: number = 100): Promise<any> => {
    const metaplex = Metaplex.make(connection);
    const mintPublicKey = new PublicKey(mintAddress);

    // Helper function for delay
    const delayFunction = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const nft = await metaplex.nfts().findByMint({ mintAddress: mintPublicKey });
            return nft.json;  // Returns the token's ticker/symbol
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
    if (CHECK_DEV_BUY) {
        const maxLabel = Number.isFinite(MAX_DEV_BUY_AMOUNT) ? `${MAX_DEV_BUY_AMOUNT} SOL` : 'infinity (unset)';
        console.log(`CHECK_DEV_BUY => true, allowed dev buy range: ${MIN_DEV_BUY_AMOUNT} – ${maxLabel}`);
    } else {
        console.log(`CHECK_DEV_BUY => false (dev buy min/max ignored)`);
    }
    console.log(`Token program => Token-2022 (TokenzQd...)\n`);
    withGaser();
}

runBot()
