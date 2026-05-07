const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const anchor = require('../../oddson-program/node_modules/@coral-xyz/anchor');
const { Keypair, PublicKey, SystemProgram, Connection } = require('../../oddson-program/node_modules/@solana/web3.js');

const idl = require('../../oddson-program/target/idl/oddson_program.json');

const PROGRAM_ID = new PublicKey(idl.address);
const ORACLE_KEYPAIR_PATH = path.resolve(__dirname, '..', 'oracle-devnet.json');
const RPC_URL = process.env.DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
const connection = new Connection(RPC_URL, 'confirmed');

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(pathname, init) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${pathname} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitForCompletedAgentRun(marketRowId, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = await apiRequest(`/markets/${marketRowId}/agent-runs`);
    const latest = runs?.[0] ?? null;
    if (latest?.status === 'completed') {
      return latest;
    }
    if (latest?.status === 'failed') {
      throw new Error(`Agent run failed: ${latest.error_message ?? 'unknown error'}`);
    }
    await wait(1500);
  }

  throw new Error('Timed out waiting for queued resolution.');
}

async function main() {
  const oracle = loadKeypair(ORACLE_KEYPAIR_PATH);
  const provider = providerFromKeypair(oracle);
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);

  const marketId = new anchor.BN(Date.now());
  const title = `Backend settlement smoke ${marketId.toString()}`;
  const threshold = 140;
  const timeWindowSeconds = 60;
  const now = Math.floor(Date.now() / 1000);
  const predictionCutoff = new anchor.BN(now + 5);
  const eventStartTime = new anchor.BN(now + 10);
  const eventEndTime = new anchor.BN(now + 120);
  const metadataHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        title,
        threshold,
        timeWindowSeconds,
        predictionCutoff: new Date(predictionCutoff.toNumber() * 1000).toISOString(),
        eventStartTime: new Date(eventStartTime.toNumber() * 1000).toISOString(),
        eventEndTime: new Date(eventEndTime.toNumber() * 1000).toISOString(),
      })
    )
    .digest();

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), marketId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault'), marketPda.toBuffer()], PROGRAM_ID);

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

  const marketRow = await apiRequest('/markets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      onchainMarketId: Number(marketId.toString()),
      creatorWallet: oracle.publicKey.toBase58(),
      title,
      structuredRule: {
        metric: 'heart_rate_bpm',
        operator: '>',
        threshold,
        timeWindowSeconds,
      },
      status: 'open',
      predictionCutoff: new Date(predictionCutoff.toNumber() * 1000).toISOString(),
      eventStartTime: new Date(eventStartTime.toNumber() * 1000).toISOString(),
      eventEndTime: new Date(eventEndTime.toNumber() * 1000).toISOString(),
      evidenceType: 'heart_rate_demo_feed',
      metadataHash: metadataHash.toString('hex'),
    }),
  });

  await apiRequest(`/markets/${marketRow.id}/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      evidenceType: 'heart_rate_demo_feed',
      source: 'backend-resolve-e2e',
      submittedBy: oracle.publicKey.toBase58(),
      readings: [
        { t: 0, bpm: 101 },
        { t: 10, bpm: 118 },
        { t: 20, bpm: 142 },
        { t: 30, bpm: 148 },
      ],
    }),
  });

  await wait(6500);

  const resolveResult = await apiRequest(`/markets/${marketRow.id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });

  const completedRun = await waitForCompletedAgentRun(marketRow.id);
  const resolution = await apiRequest(`/markets/${marketRow.id}/resolution`);

  console.log(
    JSON.stringify(
      {
        programId: PROGRAM_ID.toBase58(),
        apiBaseUrl: API_BASE_URL,
        marketRowId: marketRow.id,
        onchainMarketId: marketId.toString(),
        marketAddress: marketPda.toBase58(),
        agentRunId: resolveResult.agentRun.id,
        agentRunStatus: completedRun.status,
        createSignature,
        resolveSignature: completedRun.settlement_tx,
        outcome: resolution.outcome,
        settlementTx: resolution.settlement_tx,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
