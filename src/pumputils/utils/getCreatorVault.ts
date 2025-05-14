import { PublicKey } from '@solana/web3.js';

export const getCreatorVault = async (
    creator: string | PublicKey,  // Accept both string address and PublicKey
    programId: string | PublicKey
): Promise<PublicKey> => {
    try {
        // Convert inputs to PublicKey if they aren't already
        const creatorKey = typeof creator === 'string' 
            ? new PublicKey(creator) 
            : creator;
            
        const programKey = typeof programId === 'string'
            ? new PublicKey(programId)
            : programId;

        const seeds = [
            Buffer.from("creator-vault", 'utf8'),
            creatorKey.toBuffer()  // Now this will work
        ];
        
        const [pda] = await PublicKey.findProgramAddress(seeds, programKey);
        return pda;
    } catch (error) {
        throw new Error(`Failed to derive creator vault PDA: ${error instanceof Error ? error.message : String(error)}`);
    }
};
