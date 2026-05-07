import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const config = {
  apiPort: Number.parseInt(process.env.API_PORT ?? '8787', 10),
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? '',
  devnetRpcUrl: process.env.DEVNET_RPC_URL ?? 'https://api.devnet.solana.com',
  airdropEnabled: process.env.AIRDROP_ENABLED === 'true',
  airdropLamports: BigInt(process.env.AIRDROP_LAMPORTS ?? '1000000000'),
  airdropCooldownMs: Number.parseInt(process.env.AIRDROP_COOLDOWN_MS ?? `${10 * 60 * 1000}`, 10),
  oraclePublicKey: process.env.ORACLE_PUBLIC_KEY ?? '',
  oracleKeypairPath: process.env.ORACLE_KEYPAIR_PATH ?? '',
  resolverPollMs: Number.parseInt(process.env.RESOLVER_POLL_MS ?? '3000', 10),
  chainSyncPollMs: Number.parseInt(process.env.CHAIN_SYNC_POLL_MS ?? '15000', 10),
};

const airdropCooldownByWallet = new Map();
let solanaRuntimePromise = null;
let resolverWorkerActive = false;
let resolverWorkerTimer = null;
let chainSyncWorkerActive = false;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(status, message, details) {
  return json({ error: message, details }, status);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function buildSupabaseHeaders(extra = {}) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    'content-type': 'application/json',
    ...extra,
  };
}

function requireSupabaseConfig() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
}

async function supabaseRequest(path, init = {}) {
  requireSupabaseConfig();
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: buildSupabaseHeaders(init.headers),
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message ?? `Supabase request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isoNow() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureHex32(value, label) {
  if (typeof value !== 'string' || !/^[\da-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be a 32-byte hex string.`);
  }
  return Buffer.from(value, 'hex');
}

function bigIntToU64Buffer(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function normalizeMarketStatus(status) {
  if (status?.open !== undefined) return 'open';
  if (status?.locked !== undefined) return 'locked';
  if (status?.resolving !== undefined) return 'resolving';
  if (status?.resolved !== undefined) return 'resolved';
  if (status?.settled !== undefined) return 'settled';
  return 'unknown';
}

function normalizeOutcome(outcome) {
  if (typeof outcome === 'string') return outcome.toUpperCase();
  if (outcome?.yes !== undefined) return 'YES';
  if (outcome?.no !== undefined) return 'NO';
  if (outcome?.invalid !== undefined) return 'INVALID';
  return null;
}

function normalizeSide(side) {
  if (typeof side === 'string') return side.toUpperCase();
  if (side?.yes !== undefined) return 'YES';
  if (side?.no !== undefined) return 'NO';
  return null;
}

function serializeError(error, stage) {
  return {
    stage,
    message: error?.message ?? 'Unknown error',
    stack: error?.stack ?? null,
    details: error?.details ?? null,
  };
}

function buildOutcomeVariant(outcome) {
  if (outcome === 'YES') return { yes: {} };
  if (outcome === 'NO') return { no: {} };
  if (outcome === 'INVALID') return { invalid: {} };
  throw new Error(`Unsupported market outcome: ${outcome}`);
}

async function getSolanaRuntime() {
  if (!solanaRuntimePromise) {
    solanaRuntimePromise = (async () => {
      if (!config.oraclePublicKey || !config.oracleKeypairPath) {
        throw new Error('ORACLE_PUBLIC_KEY and ORACLE_KEYPAIR_PATH are required for on-chain settlement.');
      }

      const anchor = require('../../../oddson-program/node_modules/@coral-xyz/anchor');
      const { Connection, Keypair, PublicKey } = require('../../../oddson-program/node_modules/@solana/web3.js');
      const idl = require('../../../oddson-program/target/idl/oddson_program.json');
      const secretKey = JSON.parse(readFileSync(resolvePath(config.oracleKeypairPath), 'utf8'));
      const oracleKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
      const expectedOracle = new PublicKey(config.oraclePublicKey);

      if (!oracleKeypair.publicKey.equals(expectedOracle)) {
        throw new Error('Configured ORACLE_PUBLIC_KEY does not match ORACLE_KEYPAIR_PATH.');
      }

      const connection = new Connection(config.devnetRpcUrl, 'confirmed');
      const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(oracleKeypair), {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
      });
      const programId = new PublicKey(idl.address);
      const program = new anchor.Program(idl, provider);
      const coder = new anchor.BorshCoder(idl);
      const eventParser = new anchor.EventParser(programId, coder);

      return {
        anchor,
        eventParser,
        idl,
        PublicKey,
        connection,
        oracleKeypair,
        programId,
        program,
      };
    })();
  }

  return solanaRuntimePromise;
}

async function settleMarketOnChain({ onchainMarketId, outcome, evidenceHash, resolutionHash }) {
  if (onchainMarketId === null || onchainMarketId === undefined) {
    throw new Error('Market is missing onchain_market_id and cannot be settled on-chain.');
  }

  const {
    anchor,
    PublicKey,
    connection,
    oracleKeypair,
    programId,
    program,
  } = await getSolanaRuntime();

  const marketId = new anchor.BN(String(onchainMarketId));
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), bigIntToU64Buffer(BigInt(onchainMarketId))],
    programId
  );

  let marketAccount = await program.account.market.fetch(marketPda);
  const currentStatus = normalizeMarketStatus(marketAccount.status);
  const now = Math.floor(Date.now() / 1000);
  const predictionCutoff = Number(marketAccount.predictionCutoff.toString());

  let lockSignature = null;
  if (currentStatus === 'open' && predictionCutoff <= now) {
    lockSignature = await program.methods
      .lockMarket()
      .accounts({
        market: marketPda,
      })
      .rpc();

    await connection.confirmTransaction(lockSignature, 'confirmed');
    await sleep(600);
    marketAccount = await program.account.market.fetch(marketPda);
  }

  const statusBeforeResolve = normalizeMarketStatus(marketAccount.status);
  if (statusBeforeResolve !== 'locked') {
    throw new Error(`Market must be locked before resolution. Current on-chain status: ${statusBeforeResolve}.`);
  }

  const resolveSignature = await program.methods
    .resolveMarket(
      buildOutcomeVariant(outcome),
      Array.from(ensureHex32(evidenceHash, 'Evidence hash')),
      Array.from(ensureHex32(resolutionHash, 'Resolution hash'))
    )
    .accounts({
      market: marketPda,
      oracle: oracleKeypair.publicKey,
    })
    .rpc();

  await connection.confirmTransaction(resolveSignature, 'confirmed');
  const resolvedAccount = await program.account.market.fetch(marketPda);

  return {
    marketAddress: marketPda.toBase58(),
    lockSignature,
    resolveSignature,
    oraclePublicKey: oracleKeypair.publicKey.toBase58(),
    status: normalizeMarketStatus(resolvedAccount.status),
  };
}

function deriveMarketPda(PublicKey, programId, onchainMarketId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), bigIntToU64Buffer(BigInt(onchainMarketId))],
    programId
  )[0];
}

function derivePositionPda(PublicKey, programId, marketPda, userPublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), marketPda.toBuffer(), userPublicKey.toBuffer()],
    programId
  )[0];
}

function signatureSet(...values) {
  return [...new Set(values.filter(Boolean))];
}

function blockTimeToIso(blockTime) {
  return blockTime ? new Date(blockTime * 1000).toISOString() : isoNow();
}

async function upsertPositionFromChain({
  program,
  PublicKey,
  programId,
  marketRow,
  marketPda,
  signature,
  blockTime,
  userWallet,
  claimTxSignature,
}) {
  const userPublicKey = new PublicKey(userWallet);
  const positionPda = derivePositionPda(PublicKey, programId, marketPda, userPublicKey);
  const positionAccount = await program.account.position.fetchNullable(positionPda);
  if (!positionAccount) {
    return null;
  }

  const existingRows = await supabaseRequest(
    `/rest/v1/positions?market_id=eq.${marketRow.id}&user_wallet=eq.${userWallet}&select=*`
  );
  const existingRow = existingRows?.[0] ?? null;

  const row = {
    market_id: marketRow.id,
    user_wallet: userWallet,
    side: normalizeSide(positionAccount.side),
    amount: Number(positionAccount.amount.toString()),
    tx_signature: existingRow?.tx_signature ?? (claimTxSignature ? null : signature ?? null),
    created_at: existingRow?.created_at ?? blockTimeToIso(blockTime),
    claimed_at: positionAccount.claimed ? blockTimeToIso(blockTime) : null,
    claim_tx_signature: positionAccount.claimed ? claimTxSignature ?? existingRow?.claim_tx_signature ?? null : null,
  };

  const rows = await supabaseRequest('/rest/v1/positions?on_conflict=market_id,user_wallet', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  });

  return rows?.[0] ?? row;
}

async function syncMarketFromChain(marketRow) {
  if (!marketRow?.onchain_market_id) {
    throw new Error('Market is missing onchain_market_id and cannot be synced from chain.');
  }

  const {
    PublicKey,
    connection,
    eventParser,
    oracleKeypair,
    program,
    programId,
  } = await getSolanaRuntime();

  const marketPda = deriveMarketPda(PublicKey, programId, marketRow.onchain_market_id);
  const signatureOptions = { limit: 100 };
  if (marketRow.last_indexed_signature) {
    signatureOptions.until = marketRow.last_indexed_signature;
  }

  let signatures;
  try {
    signatures = await connection.getSignaturesForAddress(marketPda, signatureOptions, 'confirmed');
  } catch (error) {
    if (signatureOptions.until && error.message?.includes('not found')) {
      signatures = await connection.getSignaturesForAddress(marketPda, { limit: 100 }, 'confirmed');
    } else {
      throw error;
    }
  }
  const orderedSignatures = [...signatures].reverse();

  const summary = {
    marketAddress: marketPda.toBase58(),
    scannedSignatures: orderedSignatures.length,
    predictionCount: 0,
    claimCount: 0,
    resolutionSignatures: [],
    lockSignatures: [],
  };

  for (const signatureInfo of orderedSignatures) {
    const transaction = await connection.getTransaction(signatureInfo.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    const logMessages = transaction?.meta?.logMessages ?? [];
    if (logMessages.length === 0) {
      continue;
    }

    const events = [...eventParser.parseLogs(logMessages)];
    for (const event of events) {
      if (event.name === 'PredictionPlaced') {
        await upsertPositionFromChain({
          program,
          PublicKey,
          programId,
          marketRow,
          marketPda,
          signature: signatureInfo.signature,
          blockTime: signatureInfo.blockTime,
          userWallet: event.data.user.toBase58(),
        });
        summary.predictionCount += 1;
      }

      if (event.name === 'PayoutClaimed') {
        await upsertPositionFromChain({
          program,
          PublicKey,
          programId,
          marketRow,
          marketPda,
          signature: signatureInfo.signature,
          blockTime: signatureInfo.blockTime,
          userWallet: event.data.user.toBase58(),
          claimTxSignature: signatureInfo.signature,
        });
        summary.claimCount += 1;
      }

      if (event.name === 'MarketLocked') {
        summary.lockSignatures.push(signatureInfo.signature);
      }

      if (event.name === 'MarketResolved') {
        summary.resolutionSignatures.push(signatureInfo.signature);
      }
    }
  }

  const marketAccount = await program.account.market.fetch(marketPda);
  const normalizedStatus = normalizeMarketStatus(marketAccount.status);
  const normalizedOutcome = normalizeOutcome(marketAccount.outcome);
  const marketPatch = {
    status: normalizedStatus,
    chain_synced_at: isoNow(),
    last_indexed_signature: signatures[0]?.signature ?? marketRow.last_indexed_signature ?? null,
  };

  await supabaseRequest(`/rest/v1/markets?id=eq.${marketRow.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(marketPatch),
  });

  if (normalizedOutcome) {
    const existingResolution = await supabaseRequest(`/rest/v1/resolutions?market_id=eq.${marketRow.id}&select=*`);
    const currentResolution = existingResolution?.[0] ?? {};
    await supabaseRequest('/rest/v1/resolutions?on_conflict=market_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        market_id: marketRow.id,
        outcome: normalizedOutcome,
        confidence: currentResolution.confidence ?? null,
        reasoning_summary: currentResolution.reasoning_summary ?? 'Indexed from on-chain market state.',
        evidence_hash: currentResolution.evidence_hash ?? (marketAccount.evidenceHash ? Buffer.from(marketAccount.evidenceHash).toString('hex') : null),
        analysis_hash: currentResolution.analysis_hash ?? null,
        resolution_hash:
          currentResolution.resolution_hash ??
          (marketAccount.resolutionHash ? Buffer.from(marketAccount.resolutionHash).toString('hex') : null),
        resolver_signature: currentResolution.resolver_signature ?? oracleKeypair.publicKey.toBase58(),
        settlement_tx: currentResolution.settlement_tx ?? summary.resolutionSignatures.at(-1) ?? null,
      }),
    });
  }

  return {
    ...summary,
    status: normalizedStatus,
    outcome: normalizedOutcome,
    indexedSignatures: signatureSet(
      ...summary.lockSignatures,
      ...summary.resolutionSignatures
    ),
  };
}

function buildResolutionPackage(market, evidence, readings) {
  const evaluation = evaluateRule(market.structured_rule, readings);
  const outcome = evaluation.conditionMet ? 'YES' : 'NO';
  const normalizedReadings = readings.map((reading) => ({
    bpm: reading.bpm,
    timestampOffset: reading.timestamp_offset,
    sequenceIndex: reading.sequence_index,
  }));
  const normalizedEvidence = {
    evidenceId: evidence.id,
    evidenceHash: evidence.evidence_hash,
    source: evidence.source,
    submittedBy: evidence.submitted_by,
    readings: normalizedReadings,
  };
  const analysisHash = hashJson({ evaluation, marketId: market.id, evidenceId: evidence.id });
  const resolutionHash = hashJson({
    outcome,
    confidence: evaluation.confidence,
    evidenceHash: evidence.evidence_hash,
    analysisHash,
  });

  return {
    outcome,
    evaluation,
    analysisHash,
    resolutionHash,
    packagePayload: {
      marketId: market.id,
      onchainMarketId: market.onchain_market_id,
      evidenceId: evidence.id,
      normalizedEvidence,
      evaluation,
      outcome,
      confidence: evaluation.confidence,
      analysisHash,
      resolutionHash,
    },
  };
}

async function updateAgentRun(agentRunId, patch) {
  const rows = await supabaseRequest(`/rest/v1/agent_runs?id=eq.${agentRunId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return rows?.[0] ?? null;
}

async function getOpenAgentRunForMarket(marketId) {
  const rows = await supabaseRequest(
    `/rest/v1/agent_runs?market_id=eq.${marketId}&status=in.(queued,running)&select=*&order=created_at.desc&limit=1`
  );
  return rows?.[0] ?? null;
}

async function listAgentRunsForMarket(marketId) {
  return supabaseRequest(`/rest/v1/agent_runs?market_id=eq.${marketId}&select=*&order=created_at.desc&limit=20`);
}

async function enqueueAgentRun(marketId) {
  const rows = await supabaseRequest('/rest/v1/agent_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      market_id: marketId,
      agent_version: 'resolver-v2',
      status: 'queued',
      stage: 'queued',
    }),
  });
  return rows?.[0] ?? null;
}

async function claimNextQueuedAgentRun() {
  const rows = await supabaseRequest(`/rest/v1/agent_runs?status=eq.queued&select=*&order=created_at.asc&limit=1`);
  const next = rows?.[0] ?? null;
  if (!next) {
    return null;
  }

  const claimedRows = await supabaseRequest(
    `/rest/v1/agent_runs?id=eq.${next.id}&status=eq.queued`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'running',
        stage: 'loading_market',
        started_at: isoNow(),
        attempt_count: (next.attempt_count ?? 0) + 1,
        error_message: null,
        error_details: null,
      }),
    }
  );

  return claimedRows?.[0] ?? null;
}

async function processAgentRun(agentRun) {
  let stage = 'loading_market';
  try {
    const market = await getMarket(agentRun.market_id);
    if (!market) {
      throw new Error('Market not found for agent run.');
    }

    await supabaseRequest(`/rest/v1/markets?id=eq.${market.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'resolving' }),
    });

    stage = 'loading_evidence';
    await updateAgentRun(agentRun.id, { stage });
    let evidence = await getLatestEvidence(market.id);
    if (!evidence && market.feed_session_id) {
      const auditEvidence = await createLiveSessionAuditEvidence(market);
      evidence = auditEvidence.evidence;
    }
    if (!evidence) {
      throw new Error('Cannot resolve market without evidence.');
    }

    stage = 'loading_readings';
    await updateAgentRun(agentRun.id, {
      stage,
      evidence_id: evidence.id,
    });
    const readings = await supabaseRequest(
      `/rest/v1/heart_rate_readings?evidence_id=eq.${evidence.id}&select=*&order=sequence_index.asc`
    );
    if (!Array.isArray(readings) || readings.length === 0) {
      throw new Error('Cannot resolve market without heart-rate readings.');
    }

    stage = 'building_resolution_package';
    const resolutionPackage = buildResolutionPackage(market, evidence, readings);
    await updateAgentRun(agentRun.id, {
      stage,
      input_hash: evidence.evidence_hash,
      output_hash: resolutionPackage.resolutionHash,
      resolution_payload: resolutionPackage.packagePayload,
    });

    stage = 'submitting_onchain';
    const settlement = await settleMarketOnChain({
      onchainMarketId: market.onchain_market_id,
      outcome: resolutionPackage.outcome,
      evidenceHash: evidence.evidence_hash,
      resolutionHash: resolutionPackage.resolutionHash,
    });

    stage = 'persisting_resolution';
    const resolutionRows = await supabaseRequest('/rest/v1/resolutions?on_conflict=market_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        market_id: market.id,
        outcome: resolutionPackage.outcome,
        confidence: resolutionPackage.evaluation.confidence,
        reasoning_summary: resolutionPackage.evaluation.reasoning,
        evidence_hash: evidence.evidence_hash,
        analysis_hash: resolutionPackage.analysisHash,
        resolution_hash: resolutionPackage.resolutionHash,
        resolver_signature: settlement.oraclePublicKey,
        settlement_tx: settlement.resolveSignature,
      }),
    });

    await supabaseRequest(`/rest/v1/markets?id=eq.${market.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'resolved' }),
    });

    stage = 'syncing_chain_state';
    const sync = await syncMarketFromChain({
      ...market,
      last_indexed_signature: market.last_indexed_signature,
    });

    stage = 'completed';
    const completedRun = await updateAgentRun(agentRun.id, {
      status: 'completed',
      stage,
      completed_at: isoNow(),
      settlement_tx: settlement.resolveSignature,
      resolution_payload: {
        ...resolutionPackage.packagePayload,
        settlement,
        sync,
      },
    });

    return {
      agentRun: completedRun,
      marketId: market.id,
      evaluation: resolutionPackage.evaluation,
      resolution: resolutionRows?.[0] ?? null,
      settlement,
      sync,
    };
  } catch (error) {
    await updateAgentRun(agentRun.id, {
      status: 'failed',
      stage,
      completed_at: isoNow(),
      error_message: error.message,
      error_details: serializeError(error, stage),
    });
    throw error;
  }
}

function startResolverWorkerSoon() {
  if (resolverWorkerTimer) {
    return;
  }

  resolverWorkerTimer = setTimeout(() => {
    resolverWorkerTimer = null;
    runResolverWorker().catch((error) => {
      console.error('Resolver worker error', error);
    });
  }, 0);
}

async function runResolverWorker() {
  if (resolverWorkerActive) {
    return;
  }

  resolverWorkerActive = true;
  try {
    while (true) {
      const agentRun = await claimNextQueuedAgentRun();
      if (!agentRun) {
        break;
      }

      try {
        await processAgentRun(agentRun);
      } catch (error) {
        console.error(`Agent run ${agentRun.id} failed`, error);
      }
    }
  } finally {
    resolverWorkerActive = false;
  }
}

async function runChainSyncWorker() {
  if (chainSyncWorkerActive) {
    return;
  }

  chainSyncWorkerActive = true;
  try {
    const rows = await supabaseRequest(
      '/rest/v1/markets?onchain_market_id=not.is.null&select=*&order=created_at.desc&limit=25'
    );

    const now = Date.now();
    for (const market of rows) {
      const lastSyncAt = market.chain_synced_at ? new Date(market.chain_synced_at).getTime() : 0;
      const shouldSync =
        !market.chain_synced_at ||
        (
          ['open', 'locked', 'resolving', 'resolved'].includes(market.status) &&
          now - lastSyncAt > config.chainSyncPollMs
        );

      if (!shouldSync) {
        continue;
      }

      try {
        await syncMarketFromChain(market);
      } catch (error) {
        console.error(`Chain sync failed for market ${market.id}`, error);
      }
    }
  } finally {
    chainSyncWorkerActive = false;
  }
}

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host}`);
}

async function rpcRequest(method, params = [], rpcUrl = config.devnetRpcUrl) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${method}-${Date.now()}`,
      method,
      params,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    const error = new Error(data?.error?.message ?? `RPC ${method} failed`);
    error.details = data?.error ?? data;
    throw error;
  }

  return data.result;
}

async function getBalanceLamports(walletAddress) {
  const result = await rpcRequest('getBalance', [walletAddress, { commitment: 'confirmed' }]);
  return BigInt(result.value);
}

async function requestDevnetAirdrop(walletAddress) {
  const signature = await rpcRequest('requestAirdrop', [walletAddress, Number(config.airdropLamports)]);
  await sleep(1500);
  return signature;
}

function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

function validateMarketPayload(body) {
  const requiredFields = ['creatorWallet', 'title', 'structuredRule', 'status', 'predictionCutoff'];
  const missing = requiredFields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

function validateFeedPayload(body) {
  const requiredFields = ['ownerWallet', 'feedType', 'verificationMode'];
  const missing = requiredFields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

function validateFeedSessionPayload(body) {
  const requiredFields = ['status'];
  const missing = requiredFields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

function validateFeedSessionUpdatePayload(body) {
  const hasAnyField =
    body.status !== undefined ||
    body.startedAt !== undefined ||
    body.endedAt !== undefined ||
    body.sessionMetadata !== undefined;

  if (!hasAnyField) {
    throw new Error('At least one session field must be provided.');
  }
}

function validateHeartRateTelemetryPayload(body) {
  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    throw new Error('Telemetry samples must be a non-empty array.');
  }

  for (const sample of body.samples) {
    if (typeof sample.sequence !== 'number' || Number.isNaN(sample.sequence) || sample.sequence < 0) {
      throw new Error('Each telemetry sample must include a non-negative numeric sequence.');
    }
    if (typeof sample.bpm !== 'number' || Number.isNaN(sample.bpm) || sample.bpm < 20 || sample.bpm > 260) {
      throw new Error('Each telemetry sample must include a plausible BPM value between 20 and 260.');
    }
    if (sample.sampledAt && Number.isNaN(Date.parse(sample.sampledAt))) {
      throw new Error('Telemetry sample timestamps must be valid ISO timestamps.');
    }
  }
}

function normalizeHeartRateSamples(samples) {
  return [...samples]
    .map((sample) => ({
      sequence: Math.trunc(sample.sequence),
      bpm: Math.round(sample.bpm),
      sampledAt: sample.sampledAt ?? isoNow(),
      rrIntervalsMs: Array.isArray(sample.rrIntervalsMs)
        ? sample.rrIntervalsMs.map((value) => Math.round(Number(value))).filter((value) => Number.isFinite(value))
        : [],
      contactDetected: sample.contactDetected === true,
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

function parseTimestampMs(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getSessionLiveSignalState(session) {
  if (session?.live_signal_state && typeof session.live_signal_state === 'object') {
    return session.live_signal_state;
  }

  const metadata = session?.session_metadata;
  if (metadata?.liveSignalState && typeof metadata.liveSignalState === 'object') {
    return metadata.liveSignalState;
  }

  return {};
}

function getNormalizedSessionRecentSamples(session) {
  const state = getSessionLiveSignalState(session);
  const recentSamples = Array.isArray(state.recentSamples) ? state.recentSamples : [];

  return recentSamples
    .map((sample) => ({
      sequence: readSequenceValue(sample.sequence, -1),
      bpm: typeof sample.bpm === 'number' ? Math.round(sample.bpm) : Number.parseInt(sample.bpm ?? '', 10),
      sampledAt: typeof sample.sampledAt === 'string' ? sample.sampledAt : null,
      rrIntervalsMs: Array.isArray(sample.rrIntervalsMs)
        ? sample.rrIntervalsMs.map((value) => Math.round(Number(value))).filter((value) => Number.isFinite(value))
        : [],
      contactDetected: sample.contactDetected === true,
    }))
    .filter(
      (sample) =>
        sample.sequence >= 0 &&
        Number.isFinite(sample.bpm) &&
        sample.bpm >= 20 &&
        sample.bpm <= 260 &&
        sample.sampledAt &&
        parseTimestampMs(sample.sampledAt) !== null
    )
    .sort((a, b) => a.sequence - b.sequence);
}

function sampleMatchesRule(rule, bpm) {
  if (rule.operator === '>') return bpm > rule.threshold;
  if (rule.operator === '<') return bpm < rule.threshold;
  return bpm === rule.threshold;
}

function buildSessionReadingsForMarket(session, market) {
  const samples = getNormalizedSessionRecentSamples(session);
  if (samples.length === 0) {
    return [];
  }

  const sessionStartMs =
    parseTimestampMs(market.event_start_time) ??
    parseTimestampMs(session.started_at) ??
    parseTimestampMs(samples[0]?.sampledAt);

  if (sessionStartMs === null) {
    return [];
  }

  const windowStartMs = parseTimestampMs(market.event_start_time) ?? sessionStartMs;
  const windowEndMs =
    parseTimestampMs(market.event_end_time) ??
    (windowStartMs + Math.max(Number(market.structured_rule?.timeWindowSeconds ?? 0), 0) * 1000);

  return samples
    .filter((sample) => {
      const sampledAtMs = parseTimestampMs(sample.sampledAt);
      return sampledAtMs !== null && sampledAtMs >= windowStartMs && sampledAtMs <= windowEndMs;
    })
    .map((sample) => {
      const sampledAtMs = parseTimestampMs(sample.sampledAt);
      return {
        bpm: sample.bpm,
        timestamp_offset: Math.max(0, Math.round((sampledAtMs - windowStartMs) / 1000)),
        sequence_index: sample.sequence,
        sampled_at: sample.sampledAt,
        rr_intervals_ms: sample.rrIntervalsMs,
        contact_detected: sample.contactDetected,
      };
    });
}

function summarizeSessionMarketState(session, market) {
  const readings = buildSessionReadingsForMarket(session, market);
  const evaluation = evaluateRule(market.structured_rule, readings);
  const state = getSessionLiveSignalState(session);
  const windowStartMs = parseTimestampMs(market.event_start_time);
  const windowEndMs =
    parseTimestampMs(market.event_end_time) ??
    (windowStartMs !== null
      ? windowStartMs + Math.max(Number(market.structured_rule?.timeWindowSeconds ?? 0), 0) * 1000
      : null);
  const nowMs = Date.now();
  const windowClosed = windowEndMs !== null ? nowMs >= windowEndMs : session.status === 'ended';
  const thresholdSamples = readings.filter((reading) => sampleMatchesRule(market.structured_rule, reading.bpm));

  let activeDurationMs = 0;
  for (let index = 1; index < thresholdSamples.length; index += 1) {
    const previous = parseTimestampMs(thresholdSamples[index - 1].sampled_at);
    const current = parseTimestampMs(thresholdSamples[index].sampled_at);
    if (previous !== null && current !== null) {
      activeDurationMs += Math.max(0, current - previous);
    }
  }

  return {
    marketId: market.id,
    latestBpm: readings.at(-1)?.bpm ?? Number(session.latest_bpm ?? null),
    peakBpm: evaluation.peakBpm,
    sampleCount: readings.length,
    thresholdCrossed: evaluation.conditionMet,
    thresholdCrossedAt: evaluation.thresholdCrossedAt,
    conditionActiveDurationMs: activeDurationMs,
    rollingAverageBpm: state.rollingAverageBpm ?? null,
    windowStarted: windowStartMs !== null ? nowMs >= windowStartMs : true,
    windowClosed,
    outcomeCandidate: evaluation.conditionMet ? 'YES' : windowClosed ? 'NO' : null,
    lastEvaluatedAt: isoNow(),
  };
}

function readSequenceValue(value, fallback = -1) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function buildLiveSignalSessionPatch(session, body) {
  const existingMetadata =
    session.session_metadata && typeof session.session_metadata === 'object' ? session.session_metadata : {};
  const existingState =
    existingMetadata.liveSignalState && typeof existingMetadata.liveSignalState === 'object'
      ? existingMetadata.liveSignalState
      : {};
  const normalizedSamples = normalizeHeartRateSamples(body.samples);
  const lastSequence = readSequenceValue(session.last_sequence, readSequenceValue(existingState.lastSequence, -1));
  const acceptedSamples = normalizedSamples.filter((sample) => sample.sequence > lastSequence);

  if (acceptedSamples.length === 0) {
    return null;
  }

  const existingRecentSamples = Array.isArray(existingState.recentSamples) ? existingState.recentSamples : [];
  const nextRecentSamples = [
    ...existingRecentSamples,
    ...acceptedSamples.map((sample) => ({
      sequence: sample.sequence,
      bpm: sample.bpm,
      sampledAt: sample.sampledAt,
      rrIntervalsMs: sample.rrIntervalsMs,
      contactDetected: sample.contactDetected,
    })),
  ].slice(-180);

  const totalSampleCount = Math.max(
    Number(session.sample_count ?? 0) + acceptedSamples.length,
    nextRecentSamples.length
  );
  const nextPeakBpm = Math.max(Number(session.peak_bpm ?? 0), ...acceptedSamples.map((sample) => sample.bpm));
  const nextLatestSample = acceptedSamples.at(-1);
  const rollingAverageBpm =
    nextRecentSamples.reduce((sum, sample) => sum + Number(sample.bpm ?? 0), 0) /
    Math.max(nextRecentSamples.length, 1);

  return {
    latest_bpm: nextLatestSample.bpm,
    peak_bpm: nextPeakBpm,
    sample_count: totalSampleCount,
    last_sequence: nextLatestSample.sequence,
    telemetry_updated_at: nextLatestSample.sampledAt,
    live_signal_state: {
      deviceId: body.deviceId ?? existingState.deviceId ?? null,
      source: body.source ?? existingState.source ?? 'android-ble-heart-rate',
      unit: 'bpm',
      status: 'streaming',
      latestBpm: nextLatestSample.bpm,
      peakBpm: nextPeakBpm,
      sampleCount: totalSampleCount,
      rollingAverageBpm: Math.round(rollingAverageBpm * 100) / 100,
      recentSamples: nextRecentSamples,
      lastSequence: nextLatestSample.sequence,
      lastSampledAt: nextLatestSample.sampledAt,
      updatedAt: isoNow(),
    },
    session_metadata: {
      ...existingMetadata,
      device: body.deviceLabel ?? existingMetadata.device ?? null,
      liveSignalState: {
        ...existingState,
        deviceId: body.deviceId ?? existingState.deviceId ?? null,
        source: body.source ?? existingState.source ?? 'android-ble-heart-rate',
        unit: 'bpm',
        status: 'streaming',
        latestBpm: nextLatestSample.bpm,
        peakBpm: nextPeakBpm,
        sampleCount: totalSampleCount,
        rollingAverageBpm: Math.round(rollingAverageBpm * 100) / 100,
        recentSamples: nextRecentSamples,
        lastSequence: nextLatestSample.sequence,
        lastSampledAt: nextLatestSample.sampledAt,
        updatedAt: isoNow(),
      },
    },
  };
}

function buildLegacySessionPatch(patch) {
  const metadata = patch?.session_metadata && typeof patch.session_metadata === 'object' ? patch.session_metadata : {};
  return {
    session_metadata: metadata,
  };
}

function isMissingSupabaseColumnError(error) {
  const details = typeof error?.details === 'string' ? error.details : JSON.stringify(error?.details ?? '');
  const message = String(error?.message ?? '');
  return (
    message.includes('schema cache') ||
    message.includes('Could not find') ||
    details.includes('schema cache') ||
    details.includes('Could not find') ||
    details.includes('last_sequence') ||
    details.includes('live_signal_state') ||
    details.includes('latest_bpm') ||
    details.includes('peak_bpm') ||
    details.includes('sample_count') ||
    details.includes('telemetry_updated_at')
  );
}

async function patchFeedSessionWithFallback(feedId, sessionId, patch) {
  const path = `/rest/v1/feed_sessions?id=eq.${sessionId}&feed_id=eq.${feedId}`;

  try {
    const rows = await supabaseRequest(path, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });

    return rows?.[0] ?? null;
  } catch (error) {
    if (!isMissingSupabaseColumnError(error)) {
      throw error;
    }

    const legacyPatch = buildLegacySessionPatch(patch);
    const rows = await supabaseRequest(path, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(legacyPatch),
    });

    return rows?.[0] ?? null;
  }
}

function mergeSessionMarketEvaluations(session, evaluations) {
  const existingMetadata =
    session.session_metadata && typeof session.session_metadata === 'object' ? session.session_metadata : {};
  const existingState = getSessionLiveSignalState(session);
  const existingMarketEvaluations =
    existingState.marketEvaluations && typeof existingState.marketEvaluations === 'object'
      ? existingState.marketEvaluations
      : {};

  const nextMarketEvaluations = {
    ...existingMarketEvaluations,
    ...Object.fromEntries(evaluations.map((evaluation) => [evaluation.marketId, evaluation])),
  };

  return {
    live_signal_state: {
      ...existingState,
      marketEvaluations: nextMarketEvaluations,
      updatedAt: isoNow(),
    },
    session_metadata: {
      ...existingMetadata,
      liveSignalState: {
        ...existingState,
        marketEvaluations: nextMarketEvaluations,
        updatedAt: isoNow(),
      },
    },
  };
}

function validateEvidencePayload(body) {
  const requiredFields = ['evidenceType', 'source', 'submittedBy', 'readings'];
  const missing = requiredFields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
  if (!Array.isArray(body.readings) || body.readings.length === 0) {
    throw new Error('Evidence readings must be a non-empty array.');
  }
}

async function uploadEvidencePayload(marketId, evidenceId, payload) {
  if (!config.storageBucket) {
    return null;
  }

  const path = `/storage/v1/object/${config.storageBucket}/${marketId}/${evidenceId}.json`;
  requireSupabaseConfig();
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      'content-type': 'application/json',
      'x-upsert': 'true',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error('Failed to upload evidence payload.');
    error.status = response.status;
    error.details = details;
    throw error;
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${config.storageBucket}/${marketId}/${evidenceId}.json`;
}

async function getMarket(id) {
  const rows = await supabaseRequest(`/rest/v1/markets?id=eq.${id}&select=*`);
  return rows?.[0] ?? null;
}

async function getFeed(id) {
  const rows = await supabaseRequest(`/rest/v1/feeds?id=eq.${id}&select=*`);
  return rows?.[0] ?? null;
}

async function getFeedSessions(feedId, { status, limit } = {}) {
  const query = new URLSearchParams({
    feed_id: `eq.${feedId}`,
    select: '*',
    order: 'started_at.desc.nullslast,created_at.desc',
  });

  if (status) {
    query.set('status', `eq.${status}`);
  }

  if (limit) {
    query.set('limit', String(limit));
  }

  return supabaseRequest(`/rest/v1/feed_sessions?${query.toString()}`);
}

async function getFeedSession(feedId, sessionId) {
  const rows = await supabaseRequest(
    `/rest/v1/feed_sessions?id=eq.${sessionId}&feed_id=eq.${feedId}&select=*`
  );
  return rows?.[0] ?? null;
}

async function getFeedSessionById(sessionId) {
  const rows = await supabaseRequest(`/rest/v1/feed_sessions?id=eq.${sessionId}&select=*`);
  return rows?.[0] ?? null;
}

async function getLatestEvidence(marketId) {
  const rows = await supabaseRequest(
    `/rest/v1/evidence?market_id=eq.${marketId}&select=*&order=submitted_at.desc&limit=1`
  );
  return rows?.[0] ?? null;
}

async function listDeterministicSessionMarkets(session) {
  const query = new URLSearchParams({
    feed_session_id: `eq.${session.id}`,
    resolution_lane: 'eq.deterministic',
    status: 'in.(open,locked)',
    select: '*',
    order: 'created_at.asc',
  });

  return supabaseRequest(`/rest/v1/markets?${query.toString()}`);
}

async function getMarketByOnchainMarketId(onchainMarketId) {
  const rows = await supabaseRequest(`/rest/v1/markets?onchain_market_id=eq.${onchainMarketId}&select=*`);
  return rows?.[0] ?? null;
}

function evaluateRule(rule, readings) {
  const sortedReadings = [...readings].sort((a, b) => a.sequence_index - b.sequence_index);
  const matching = sortedReadings.find((reading) => {
    if (rule.operator === '>') return reading.bpm > rule.threshold;
    if (rule.operator === '<') return reading.bpm < rule.threshold;
    return reading.bpm === rule.threshold;
  });

  const peakBpm = sortedReadings.reduce((max, reading) => Math.max(max, reading.bpm), 0);
  const baselineBpm = sortedReadings[0]?.bpm ?? 0;
  const conditionMet = Boolean(matching);
  const confidence = sortedReadings.length >= 3 ? 0.99 : 0.6;

  return {
    conditionMet,
    thresholdCrossedAt: matching?.timestamp_offset ?? null,
    confidence,
    peakBpm,
    baselineBpm,
    reasoning: conditionMet
      ? `Threshold crossed at ${matching.timestamp_offset}s with ${matching.bpm} BPM.`
      : `Threshold not crossed. Peak BPM was ${peakBpm}.`,
  };
}

async function createStructuredEvidenceForMarket(market, payload) {
  const evidenceId = randomUUID();
  const evidencePayload = {
    feedSessionId: market.feed_session_id ?? null,
    marketId: market.id,
    source: payload.source,
    submittedBy: payload.submittedBy,
    readings: payload.readings,
    auditMetadata: payload.auditMetadata ?? {},
  };
  const evidenceHash = hashJson(evidencePayload);
  const rawStorageUrl = await uploadEvidencePayload(market.id, evidenceId, evidencePayload);

  const evidenceRows = await supabaseRequest('/rest/v1/evidence', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: evidenceId,
      market_id: market.id,
      feed_id: market.feed_id ?? null,
      feed_session_id: market.feed_session_id ?? null,
      evidence_type: payload.evidenceType,
      source: payload.source,
      raw_storage_url: rawStorageUrl,
      normalized_storage_url: rawStorageUrl,
      evidence_hash: evidenceHash,
      submitted_by: payload.submittedBy,
    }),
  });

  const readingsPayload = payload.readings.map((reading, index) => ({
    market_id: market.id,
    evidence_id: evidenceId,
    timestamp_offset: reading.t ?? reading.timestampOffset ?? 0,
    bpm: reading.bpm,
    sequence_index: reading.sequenceIndex ?? index,
  }));

  await supabaseRequest('/rest/v1/heart_rate_readings', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(readingsPayload),
  });

  return {
    evidence: evidenceRows?.[0] ?? null,
    readingsInserted: readingsPayload.length,
    evidenceHash,
  };
}

async function createLiveSessionAuditEvidence(market) {
  if (!market.feed_session_id) {
    throw new Error('Cannot build live-session audit evidence without feed_session_id.');
  }

  const session = await getFeedSessionById(market.feed_session_id);
  if (!session) {
    throw new Error('Feed session not found for live-session audit evidence.');
  }

  const feed = market.feed_id ? await getFeed(market.feed_id) : null;
  const readings = buildSessionReadingsForMarket(session, market);
  if (readings.length === 0) {
    throw new Error('No live session telemetry available for this market window.');
  }

  const auditMetadata = {
    sessionId: session.id,
    sessionStatus: session.status,
    sessionStartedAt: session.started_at,
    telemetryUpdatedAt: session.telemetry_updated_at ?? null,
    liveSignalState: getSessionLiveSignalState(session),
  };

  return createStructuredEvidenceForMarket(market, {
    evidenceType: market.evidence_type ?? 'heart_rate_live_session_audit',
    source: 'session_live_signal_state',
    submittedBy: feed?.owner_wallet ?? market.creator_wallet,
    readings: readings.map((reading) => ({
      t: reading.timestamp_offset,
      bpm: reading.bpm,
      sequenceIndex: reading.sequence_index,
      sampledAt: reading.sampled_at,
    })),
    auditMetadata,
  });
}

async function maybeQueueSessionDeterministicMarkets(session) {
  const markets = await listDeterministicSessionMarkets(session);
  if (!Array.isArray(markets) || markets.length === 0) {
    return { queuedMarketIds: [], evaluations: [] };
  }

  const evaluations = markets.map((market) => summarizeSessionMarketState(session, market));
  const queuedMarketIds = [];

  for (const evaluation of evaluations) {
    if (!evaluation.outcomeCandidate) {
      continue;
    }

    const market = markets.find((candidate) => candidate.id === evaluation.marketId);
    if (!market) {
      continue;
    }

    const openRun = await getOpenAgentRunForMarket(market.id);
    if (openRun) {
      continue;
    }

    const resolutionRows = await supabaseRequest(`/rest/v1/resolutions?market_id=eq.${market.id}&select=id&limit=1`);
    if (resolutionRows?.[0]) {
      continue;
    }

    await enqueueAgentRun(market.id);
    queuedMarketIds.push(market.id);
  }

  return { queuedMarketIds, evaluations };
}

async function listMarketTransactions(marketId) {
  const [positions, resolutions] = await Promise.all([
    supabaseRequest(
      `/rest/v1/positions?market_id=eq.${marketId}&select=id,tx_signature,claim_tx_signature,claimed_at,created_at,user_wallet,amount,side`
    ),
    supabaseRequest(`/rest/v1/resolutions?market_id=eq.${marketId}&select=id,settlement_tx,created_at,outcome`),
  ]);

  return [
    ...positions
      .filter((position) => position.tx_signature)
      .map((position) => ({
        id: position.id,
        type: 'prediction',
        signature: position.tx_signature,
        createdAt: position.created_at,
        wallet: position.user_wallet,
        amount: position.amount,
        side: position.side,
      })),
    ...positions
      .filter((position) => position.claim_tx_signature)
      .map((position) => ({
        id: `${position.id}:claim`,
        type: 'claim',
        signature: position.claim_tx_signature,
        createdAt: position.claimed_at ?? position.created_at,
        wallet: position.user_wallet,
        amount: position.amount,
        side: position.side,
      })),
    ...resolutions
      .filter((resolution) => resolution.settlement_tx)
      .map((resolution) => ({
        id: resolution.id,
        type: 'resolution',
        signature: resolution.settlement_tx,
        createdAt: resolution.created_at,
        outcome: resolution.outcome,
      })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

const routes = [
  {
    method: 'GET',
    pattern: '/health',
    handler: async () =>
      json({
        ok: true,
        timestamp: isoNow(),
        workers: {
          resolverActive: resolverWorkerActive,
          chainSyncActive: chainSyncWorkerActive,
        },
      }),
  },
  {
    method: 'POST',
    pattern: '/feeds',
    handler: async (req) => {
      const body = await parseBody(req);
      validateFeedPayload(body);

      const payload = {
        owner_wallet: body.ownerWallet,
        feed_type: body.feedType,
        verification_mode: body.verificationMode,
        title: body.title ?? null,
      };

      const rows = await supabaseRequest('/rest/v1/feeds', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });

      return json(rows?.[0] ?? payload, 201);
    },
  },
  {
    method: 'GET',
    pattern: '/feeds',
    handler: async (req) => {
      const url = parseUrl(req);
      const ownerWallet = url.searchParams.get('ownerWallet');
      const feedType = url.searchParams.get('feedType');
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
      const query = new URLSearchParams({
        select: '*',
        order: 'created_at.desc',
        limit: String(Number.isNaN(limit) ? 20 : Math.min(limit, 100)),
      });

      if (ownerWallet) query.set('owner_wallet', `eq.${ownerWallet}`);
      if (feedType) query.set('feed_type', `eq.${feedType}`);

      const rows = await supabaseRequest(`/rest/v1/feeds?${query.toString()}`);
      return json(rows);
    },
  },
  {
    method: 'GET',
    pattern: '/feeds/:id',
    handler: async (_req, params) => {
      const feed = await getFeed(params.id);
      if (!feed) {
        return errorResponse(404, 'Feed not found.');
      }
      return json(feed);
    },
  },
  {
    method: 'POST',
    pattern: '/feeds/:id/sessions',
    handler: async (req, params) => {
      const body = await parseBody(req);
      validateFeedSessionPayload(body);

      const feed = await getFeed(params.id);
      if (!feed) {
        return errorResponse(404, 'Feed not found.');
      }

      const payload = {
        feed_id: params.id,
        status: body.status,
        started_at: body.startedAt ?? null,
        ended_at: body.endedAt ?? null,
        session_metadata: body.sessionMetadata ?? {},
      };

      const rows = await supabaseRequest('/rest/v1/feed_sessions', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });

      return json(rows?.[0] ?? payload, 201);
    },
  },
  {
    method: 'GET',
    pattern: '/feeds/:id/sessions',
    handler: async (req, params) => {
      const feed = await getFeed(params.id);
      if (!feed) {
        return errorResponse(404, 'Feed not found.');
      }

      const url = parseUrl(req);
      const status = url.searchParams.get('status');
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
      const rows = await getFeedSessions(params.id, {
        status: status || undefined,
        limit: Number.isNaN(limit) ? 20 : Math.min(limit, 100),
      });
      return json(rows);
    },
  },
  {
    method: 'GET',
    pattern: '/feeds/:id/sessions/:sessionId',
    handler: async (_req, params) => {
      const session = await getFeedSession(params.id, params.sessionId);
      if (!session) {
        return errorResponse(404, 'Feed session not found.');
      }
      return json(session);
    },
  },
  {
    method: 'PATCH',
    pattern: '/feeds/:id/sessions/:sessionId',
    handler: async (req, params) => {
      const body = await parseBody(req);
      validateFeedSessionUpdatePayload(body);

      const session = await getFeedSession(params.id, params.sessionId);
      if (!session) {
        return errorResponse(404, 'Feed session not found.');
      }

      const payload = {};
      if (body.status !== undefined) payload.status = body.status;
      if (body.startedAt !== undefined) payload.started_at = body.startedAt;
      if (body.endedAt !== undefined) payload.ended_at = body.endedAt;
      if (body.sessionMetadata !== undefined) payload.session_metadata = body.sessionMetadata;

      const rows = await supabaseRequest(
        `/rest/v1/feed_sessions?id=eq.${params.sessionId}&feed_id=eq.${params.id}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        }
      );

      return json(rows?.[0] ?? { ...session, ...payload });
    },
  },
  {
    method: 'POST',
    pattern: '/feeds/:id/sessions/:sessionId/telemetry/heart-rate',
    handler: async (req, params) => {
      const body = await parseBody(req);
      validateHeartRateTelemetryPayload(body);

      const session = await getFeedSession(params.id, params.sessionId);
      if (!session) {
        return errorResponse(404, 'Feed session not found.');
      }

      const patch = buildLiveSignalSessionPatch(session, body);
      if (!patch) {
        return json({
          acceptedSamples: 0,
          ignoredSamples: body.samples.length,
          session,
        });
      }

      const patchedSession = await patchFeedSessionWithFallback(params.id, params.sessionId, patch);

      const acceptedSamples = normalizeHeartRateSamples(body.samples).filter(
        (sample) => sample.sequence > readSequenceValue(session.last_sequence, -1)
      ).length;
      const ignoredSamples = body.samples.length - acceptedSamples;
      const updatedSession = patchedSession ?? { ...session, ...patch };
      const { queuedMarketIds, evaluations } = await maybeQueueSessionDeterministicMarkets(updatedSession);

      if (evaluations.length > 0) {
        const evaluationPatch = mergeSessionMarketEvaluations(updatedSession, evaluations);
        const evaluationSession = await patchFeedSessionWithFallback(params.id, params.sessionId, evaluationPatch);

        if (queuedMarketIds.length > 0) {
          startResolverWorkerSoon();
        }

        return json({
          acceptedSamples,
          ignoredSamples,
          queuedMarketIds,
          session: evaluationSession ?? { ...updatedSession, ...evaluationPatch },
        });
      }

      return json({
        acceptedSamples,
        ignoredSamples,
        queuedMarketIds,
        session: updatedSession,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/feeds/:id/markets',
    handler: async (_req, params) => {
      const feed = await getFeed(params.id);
      if (!feed) {
        return errorResponse(404, 'Feed not found.');
      }

      const rows = await supabaseRequest(
        `/rest/v1/markets?feed_id=eq.${params.id}&select=*&order=created_at.desc`
      );
      return json(rows);
    },
  },
  {
    method: 'POST',
    pattern: '/markets',
    handler: async (req) => {
      const body = await parseBody(req);
      validateMarketPayload(body);

      const payload = {
        onchain_market_id: body.onchainMarketId ?? null,
        feed_id: body.feedId ?? null,
        feed_session_id: body.feedSessionId ?? null,
        creator_wallet: body.creatorWallet,
        title: body.title,
        market_type: body.marketType ?? 'heart_rate_threshold',
        resolution_lane: body.resolutionLane ?? 'deterministic',
        verification_mode: body.verificationMode ?? null,
        structured_rule: body.structuredRule,
        status: body.status,
        prediction_cutoff: body.predictionCutoff,
        event_start_time: body.eventStartTime ?? null,
        event_end_time: body.eventEndTime ?? null,
        evidence_type: body.evidenceType ?? 'heart_rate_demo_feed',
        metadata_hash: body.metadataHash ?? hashJson(body),
      };

      const rows = await supabaseRequest('/rest/v1/markets', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });

      return json(rows?.[0] ?? payload, 201);
    },
  },
  {
    method: 'GET',
    pattern: '/markets',
    handler: async (req) => {
      const url = parseUrl(req);
      const status = url.searchParams.get('status');
      const creatorWallet = url.searchParams.get('creatorWallet');
      const feedId = url.searchParams.get('feedId');
      const feedSessionId = url.searchParams.get('feedSessionId');
      const resolutionLane = url.searchParams.get('resolutionLane');
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
      const query = new URLSearchParams({
        select: '*',
        order: 'created_at.desc',
        limit: String(Number.isNaN(limit) ? 20 : Math.min(limit, 100)),
      });

      if (status) query.set('status', `eq.${status}`);
      if (creatorWallet) query.set('creator_wallet', `eq.${creatorWallet}`);
      if (feedId) query.set('feed_id', `eq.${feedId}`);
      if (feedSessionId) query.set('feed_session_id', `eq.${feedSessionId}`);
      if (resolutionLane) query.set('resolution_lane', `eq.${resolutionLane}`);

      const rows = await supabaseRequest(`/rest/v1/markets?${query.toString()}`);
      return json(rows);
    },
  },
  {
    method: 'GET',
    pattern: '/markets/:id',
    handler: async (_req, params) => {
      const market = await getMarket(params.id);
      if (!market) {
        return errorResponse(404, 'Market not found.');
      }
      return json(market);
    },
  },
  {
    method: 'GET',
    pattern: '/markets/:id/positions',
    handler: async (_req, params) => {
      const rows = await supabaseRequest(
        `/rest/v1/positions?market_id=eq.${params.id}&select=*&order=created_at.desc`
      );
      return json(rows);
    },
  },
  {
    method: 'POST',
    pattern: '/markets/:id/evidence',
    handler: async (req, params) => {
      const body = await parseBody(req);
      validateEvidencePayload(body);

      const market = await getMarket(params.id);
      if (!market) {
        return errorResponse(404, 'Market not found.');
      }

      const result = await createStructuredEvidenceForMarket(market, {
        evidenceType: body.evidenceType,
        source: body.source,
        submittedBy: body.submittedBy,
        readings: body.readings,
      });

      return json(
        {
          evidence: result.evidence,
          readingsInserted: result.readingsInserted,
        },
        201
      );
    },
  },
  {
    method: 'GET',
    pattern: '/markets/:id/evidence',
    handler: async (_req, params) => {
      const rows = await supabaseRequest(
        `/rest/v1/evidence?market_id=eq.${params.id}&select=*&order=submitted_at.desc`
      );
      return json(rows);
    },
  },
  {
    method: 'GET',
    pattern: '/markets/:id/readings',
    handler: async (_req, params) => {
      const rows = await supabaseRequest(
        `/rest/v1/heart_rate_readings?market_id=eq.${params.id}&select=*&order=sequence_index.asc`
      );
      return json(rows);
    },
  },
  {
    method: 'POST',
    pattern: '/markets/:id/resolve',
    handler: async (_req, params) => {
      const market = await getMarket(params.id);
      if (!market) {
        return errorResponse(404, 'Market not found.');
      }

      const resolutionRows = await supabaseRequest(`/rest/v1/resolutions?market_id=eq.${params.id}&select=*`);
      if (['resolved', 'settled'].includes(market.status) && resolutionRows?.[0]) {
        return json({
          status: 'already_resolved',
          resolution: resolutionRows[0],
        });
      }

      const existingRun = await getOpenAgentRunForMarket(params.id);
      if (existingRun) {
        return json(
          {
            status: 'already_queued',
            agentRun: existingRun,
          },
          202
        );
      }

      const agentRun = await enqueueAgentRun(params.id);
      startResolverWorkerSoon();

      return json(
        {
          status: 'queued',
          agentRun,
        },
        202
      );
    },
  },
  {
    method: 'GET',
    pattern: '/markets/:id/agent-runs',
    handler: async (_req, params) => json(await listAgentRunsForMarket(params.id)),
  },
  {
    method: 'GET',
    pattern: '/markets/:id/resolution',
    handler: async (_req, params) => {
      const rows = await supabaseRequest(`/rest/v1/resolutions?market_id=eq.${params.id}&select=*`);
      if (!rows?.[0]) {
        return errorResponse(404, 'Resolution not found.');
      }
      return json(rows[0]);
    },
  },
  {
    method: 'GET',
    pattern: '/markets/:id/transactions',
    handler: async (_req, params) => json(await listMarketTransactions(params.id)),
  },
  {
    method: 'GET',
    pattern: '/users/:wallet/transactions',
    handler: async (_req, params) => {
      const rows = await supabaseRequest(
        `/rest/v1/positions?user_wallet=eq.${params.wallet}&select=id,tx_signature,claim_tx_signature,claimed_at,created_at,market_id,amount,side`
      );
      return json(
        [
          ...rows
            .filter((row) => row.tx_signature)
            .map((row) => ({
              id: row.id,
              type: 'prediction',
              signature: row.tx_signature,
              createdAt: row.created_at,
              marketId: row.market_id,
              amount: row.amount,
              side: row.side,
            })),
          ...rows
            .filter((row) => row.claim_tx_signature)
            .map((row) => ({
              id: `${row.id}:claim`,
              type: 'claim',
              signature: row.claim_tx_signature,
              createdAt: row.claimed_at ?? row.created_at,
              marketId: row.market_id,
              amount: row.amount,
              side: row.side,
            })),
        ]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
    },
  },
  {
    method: 'POST',
    pattern: '/markets/:id/sync-chain',
    handler: async (_req, params) => {
      const market = await getMarket(params.id);
      if (!market) {
        return errorResponse(404, 'Market not found.');
      }

      return json({
        marketId: market.id,
        onchainMarketId: market.onchain_market_id,
        sync: await syncMarketFromChain(market),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/markets/onchain/:onchainMarketId/sync-chain',
    handler: async (_req, params) => {
      const market = await getMarketByOnchainMarketId(params.onchainMarketId);
      if (!market) {
        return errorResponse(404, 'Market not found.');
      }

      return json({
        marketId: market.id,
        onchainMarketId: market.onchain_market_id,
        sync: await syncMarketFromChain(market),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/users/:wallet/airdrop',
    handler: async (_req, params) => {
      if (!config.airdropEnabled) {
        return errorResponse(403, 'Devnet faucet is disabled.');
      }

      const walletAddress = params.wallet;
      const now = Date.now();
      const lastAirdropAt = airdropCooldownByWallet.get(walletAddress) ?? 0;
      const cooldownRemainingMs = lastAirdropAt + config.airdropCooldownMs - now;

      if (cooldownRemainingMs > 0) {
        return errorResponse(429, 'Airdrop cooldown active.', {
          cooldownRemainingMs,
        });
      }

      const balanceBeforeLamports = await getBalanceLamports(walletAddress);
      const signature = await requestDevnetAirdrop(walletAddress);
      const balanceAfterLamports = await getBalanceLamports(walletAddress);

      airdropCooldownByWallet.set(walletAddress, now);

      return json({
        walletAddress,
        signature,
        rpcUrl: config.devnetRpcUrl,
        lamportsRequested: config.airdropLamports.toString(),
        balanceBeforeLamports: balanceBeforeLamports.toString(),
        balanceAfterLamports: balanceAfterLamports.toString(),
        cooldownMs: config.airdropCooldownMs,
      });
    },
  },
];

async function handle(req, res) {
  const url = parseUrl(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    });
    res.end();
    return;
  }

  try {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchRoute(route.pattern, url.pathname);
      if (!params) continue;

      const response = await route.handler(req, params);
      const body = await response.text();

      res.writeHead(response.status, {
        'access-control-allow-origin': '*',
        ...Object.fromEntries(response.headers.entries()),
      });
      res.end(body);
      return;
    }

    const response = errorResponse(404, 'Route not found.');
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(await response.text());
  } catch (error) {
    const status = error.status ?? 500;
    const response = errorResponse(status, error.message, error.details);
    res.writeHead(response.status, {
      'access-control-allow-origin': '*',
      ...Object.fromEntries(response.headers.entries()),
    });
    res.end(await response.text());
  }
}

const server = createServer(handle);

server.listen(config.apiPort, () => {
  console.log(`OddsOn backend API listening on http://localhost:${config.apiPort}`);
  startResolverWorkerSoon();
  setInterval(() => {
    runResolverWorker().catch((error) => {
      console.error('Resolver worker poll failed', error);
    });
  }, config.resolverPollMs);
  setInterval(() => {
    runChainSyncWorker().catch((error) => {
      console.error('Chain sync worker poll failed', error);
    });
  }, config.chainSyncPollMs);
});
