import axios from "axios";
import { BLOXROUTE_AUTH_HEADER } from "../../constants";

export const getPumpQuote = async (type: string, mintAddress: string, bondingCurveAddress: string, amount: number) => {

    const params = {
        quoteType: type,
        mintAddress: mintAddress,
        bondingCurveAddress: bondingCurveAddress,
        amount: amount
    };
    const response = await axios.get(`https://pump-ny.solana.dex.blxrbdn.com/api/v2/pumpfun/quotes`, {
        headers: {
            'Authorization': BLOXROUTE_AUTH_HEADER,
            'Content-Type': 'application/json',
        },
        params: params
    })

    return response.data.outAmount
}