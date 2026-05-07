const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const anchor = require('../../oddson-program/node_modules/@coral-xyz/anchor');
const { Keypair, PublicKey, SystemProgram, Connection, clusterApiUrl, LAMPORTS_PER_SOL } = require('../../oddson-program/node_modules/@solana/web3.js');

const idl = require('../../oddson-program/target/idl/oddson_program.json');

const PROGRAM_ID = new PublicKey('XJe3F8ygpo8UE4K79PWqgh6FjBefbyU9EbbTvmB6FBs');
const ORACLE_KEYPAIR_PATH = path.resolve(__dirname, '..', 'oracle-devnet.json');
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

function loadKeypair(filePath) {
  const secretKey = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function providerFromKeypair(keypair) {
  const wallet = new anchor.Wallet(keypair);
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transferSol(fromProvider, recipient, solAmount) {
  const signature = await fromProvider.sendAndConfirm(
    new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromProvider.wallet.publicKey,
        toPubkey: recipient.publicKey,
        lamports: Math.floor(solAmount * LAMPORTS_PER_SOL),
      })
    ),
    []
  );

  return signature;
}

async function getBalance(pubkey) {
  return connection.getBalance(pubkey, 'confirmed');
}

async function main() {
  const oracle = loadKeypair(ORACLE_KEYPAIR_PATH);
  const oracleProvider = providerFromKeypair(oracle);
  anchor.setProvider(oracleProvider);

  const oracleStartingBalance = await getBalance(oracle.publicKey);
  const program = new anchor.Program(idl, oracleProvider);
  const userA = Keypair.generate();
  const userB = Keypair.generate();

  const marketId = new anchor.BN(Date.now());
  const metadataHash = crypto.createHash('sha256').update(`market-${marketId.toString()}`).digest();
  const now = Math.floor(Date.now() / 1000);
  const predictionCutoff = new anchor.BN(now + 10);
  const eventStartTime = new anchor.BN(now + 20);
  const eventEndTime = new anchor.BN(now + 180);

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), marketId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketPda.toBuffer()],
    PROGRAM_ID
  );
  const [positionAPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), marketPda.toBuffer(), userA.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [positionBPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), marketPda.toBuffer(), userB.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log('Funding temp users from oracle...');
  const fundUserAmountSol = 0.03;
  const predictionYesLamports = new anchor.BN(0.01 * LAMPORTS_PER_SOL);
  const predictionNoLamports = new anchor.BN(0.015 * LAMPORTS_PER_SOL);
  const fundUserATx = await transferSol(oracleProvider, userA, fundUserAmountSol);
  const fundUserBTx = await transferSol(oracleProvider, userB, fundUserAmountSol);

  console.log('Creating market...');
  const createSignature = await program.methods
    .createMarket(
      marketId,
      Array.from(metadataHash),
      predictionCutoff,
      eventStartTime,
      eventEndTime,
      oracle.publicKey
    )
    .accounts({
      market: marketPda,
      vault: vaultPda,
      creator: oracle.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log('Placing YES prediction...');
  const placeYesSignature = await program.methods
    .placePrediction({ yes: {} }, predictionYesLamports)
    .accounts({
      market: marketPda,
      position: positionAPda,
      vault: vaultPda,
      user: userA.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([userA])
    .rpc();

  console.log('Placing NO prediction...');
  const placeNoSignature = await program.methods
    .placePrediction({ no: {} }, predictionNoLamports)
    .accounts({
      market: marketPda,
      position: positionBPda,
      vault: vaultPda,
      user: userB.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([userB])
    .rpc();

  const secondsUntilCutoff = Number(predictionCutoff.toNumber() - Math.floor(Date.now() / 1000) + 1);
  if (secondsUntilCutoff > 0) {
    console.log(`Waiting ${secondsUntilCutoff}s for cutoff before locking...`);
    await sleep(secondsUntilCutoff * 1000);
  }

  console.log('Locking market...');
  const lockSignature = await program.methods
    .lockMarket()
    .accounts({
      market: marketPda,
    })
    .rpc();

  console.log('Resolving market...');
  const evidenceHash = crypto.createHash('sha256').update(`evidence-${marketId.toString()}`).digest();
  const resolutionHash = crypto.createHash('sha256').update(`resolution-${marketId.toString()}`).digest();
  const resolveSignature = await program.methods
    .resolveMarket({ yes: {} }, Array.from(evidenceHash), Array.from(resolutionHash))
    .accounts({
      market: marketPda,
      oracle: oracle.publicKey,
    })
    .rpc();

  const balanceBeforeClaim = await getBalance(userA.publicKey);
  console.log('Claiming payout for YES side...');
  const claimSignature = await program.methods
    .claimPayout()
    .accounts({
      market: marketPda,
      position: positionAPda,
      vault: vaultPda,
      user: userA.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([userA])
    .rpc();
  const balanceAfterClaim = await getBalance(userA.publicKey);

  const marketAccount = await program.account.market.fetch(marketPda);
  const positionA = await program.account.position.fetch(positionAPda);

  const summary = {
    oracle: oracle.publicKey.toBase58(),
    marketId: marketId.toString(),
    marketPda: marketPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    userA: userA.publicKey.toBase58(),
    userB: userB.publicKey.toBase58(),
    balances: {
      oracleStartingLamports: oracleStartingBalance,
      userABeforeClaimLamports: balanceBeforeClaim,
      userAAfterClaimLamports: balanceAfterClaim,
    },
    transactions: {
      fundUserATx,
      fundUserBTx,
      createSignature,
      placeYesSignature,
      placeNoSignature,
      lockSignature,
      resolveSignature,
      claimSignature,
    },
    marketState: {
      status: marketAccount.status,
      outcome: marketAccount.outcome,
      yesPoolTotal: marketAccount.yesPoolTotal.toString(),
      noPoolTotal: marketAccount.noPoolTotal.toString(),
    },
    positionAClaimed: positionA.claimed,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
