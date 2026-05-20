import { logger, retrieveEnvVariable, retrieveOptionalEnvNumber } from "../utils"
import { PublicKey } from "@metaplex-foundation/js";
import { bool, struct, u64 } from "@raydium-io/raydium-sdk";

export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger)
export const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger)
export const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger)
export const GEYSER_RPC = retrieveEnvVariable('GEYSER_RPC', logger)

export const BUY_AMOUNT = Number(retrieveEnvVariable('BUY_AMOUNT', logger));
export const SIMULATION_MODE = retrieveEnvVariable('SIMULATION_MODE', logger) === 'true'

export const TAKE_PROFIT = Number(retrieveEnvVariable('TAKE_PROFIT', logger))
export const STOP_LOSS = Number(retrieveEnvVariable('STOP_LOSS', logger))
export const TIME_OUT = Number(retrieveEnvVariable('TIME_OUT', logger))

export const CHECK_MARKET_CAP = retrieveEnvVariable('CHECK_MARKET_CAP', logger) === 'true'
export const MARKET_CAP = Number(retrieveEnvVariable('MARKET_CAP', logger))

// export const POSITION_CONTROL = retrieveEnvVariable('POSITION_CONTROL', logger) === 'true'
// export const POSITION_NUMBER = Number(retrieveEnvVariable('POSITION_NUMBER', logger))

export const CHECK_DEV_BUY = retrieveEnvVariable('CHECK_DEV_BUY', logger) === 'true'
export const MIN_DEV_BUY_AMOUNT = retrieveOptionalEnvNumber('MIN_DEV_BUY_AMOUNT', 0)
export const MAX_DEV_BUY_AMOUNT = retrieveOptionalEnvNumber('MAX_DEV_BUY_AMOUNT', Infinity)

export const CHECK_X = retrieveEnvVariable('CHECK_X', logger) === 'true'
export const CHECK_WEBSITE = retrieveEnvVariable('CHECK_WEBSITE', logger) === 'true'
export const CHECK_TG = retrieveEnvVariable('CHECK_TG', logger) === 'true'

// Fee configs
// export const JITO_MODE = retrieveEnvVariable('JITO_MODE', logger) === 'true'
// export const JITO_FEE = Number(retrieveEnvVariable('JITO_FEE', logger))

export const NEXTBLOCK_MODE = retrieveEnvVariable('NEXTBLOCK_MODE', logger) === 'true'
export const NEXT_BLOCK_API = retrieveEnvVariable('NEXT_BLOCK_API', logger)
export const NEXT_BLOCK_FEE = Number(retrieveEnvVariable('NEXT_BLOCK_FEE', logger))

export const BLOXROUTE_MODE = retrieveEnvVariable('BLOXROUTE_MODE', logger) === 'true'
export const BLOXROUTE_FEE = Number(retrieveEnvVariable('BLOXROUTE_FEE', logger))
export const BLOXROUTE_AUTH_HEADER = retrieveEnvVariable('BLOXROUTE_AUTH_HEADER', logger)

export const SLIPPAGE = Number(retrieveEnvVariable('SLIPPAGE', logger))
export const PRIORITY_FEE =  Number(retrieveEnvVariable('PRIORITY_FEE', logger))



// Pumpfun Configs
export const computeUnit = 100000;

export const TRADE_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const BONDING_ADDR_SEED = new Uint8Array([98, 111, 110, 100, 105, 110, 103, 45, 99, 117, 114, 118, 101]);

export const commitment = "confirmed";

export const GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
export const FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const RENT = new PublicKey("SysvarRent111111111111111111111111111111111");
export const PUMP_FUN_ACCOUNT = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
export const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export const BONDING_CURV = struct([
    // u64('initialized'),
    // publicKey('authority'),
    // publicKey('feeRecipient'),
    // u64('initialVirtualTokenReserves'),
    // u64('initialVirtualSolReserves'),
    // u64('initialRealTokenReserves'),
    // u64('tokenTotalSupply'),
    // u64('feeBasisPoints'),
    u64('virtualTokenReserves'),
    u64('virtualSolReserves'),
    u64('realTokenReserves'),
    u64('realSolReserves'),
    u64('tokenTotalSupply'),
    bool('complete'),
])
