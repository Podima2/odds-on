# Checkpoint First Night

This document is a plain-language checkpoint of what was completed in this session, why certain architecture decisions were made, and what should happen next.

## What Was Done

### In simple terms

The project now has a working end-to-end backbone for the demo:

- the mobile app can create markets, view markets, submit evidence, and show results
- the Solana program is connected to the app and backend
- the backend can now act as the oracle for market settlement
- market resolution is no longer just a fake backend write; it sends a real devnet transaction
- the backend can also read chain activity back into Supabase so the app can show prediction, resolution, and claim history

## Important Model Correction

The original wording around the heart-rate data flow was too broad.

The product should not be described as if every user connects biometric data.

There are two different user types:

- **prosumers**: stream creators who publish the livestream and deterministic evidence source
- **consumers**: viewers and traders who browse streams and create/participate in markets

That means:

- only prosumers need the BLE heart-rate ingestion path
- consumers do not publish telemetry in the normal product flow
- consumers depend on prosumer-owned feed sessions in order to trade against real evidence

So the architecture should be read as:

- prosumer stream setup
- prosumer evidence publication
- consumer stream discovery
- consumer market participation
- deterministic or agentic settlement depending on market type

There is a second important correction too:

- deterministic biometric markets should not depend on a large buffered upload before settlement
- minute markets need a live-signal path and backend rolling settlement state
- durable evidence packaging should sit in a separate audit lane

### What is working now

#### Mobile app

- Wallet connection is wired.
- Market feed and market detail screens are wired.
- Market creation is wired to the on-chain program and backend metadata storage.
- Challenge / evidence submission flow is wired.
- Result screen is wired.
- The app is isolated from the Anchor internals through a program client boundary.

With the corrected model, the mobile product should evolve into:

- prosumer stream creation and data-source linking
- consumer stream browsing and prediction placement
- shared stream pages where consumers trade against prosumer-published evidence

For prosumer telemetry, the target runtime flow should become:

- native BLE collection
- compact live update publishing
- rolling deterministic settlement state on the backend
- separate audit snapshots and final evidence packaging

#### Solana program integration

- Stable Anchor artifacts were integrated:
  - program binary
  - IDL
  - generated TypeScript types
- Real program instructions are being used for:
  - create market
  - place prediction
  - claim payout
- The app uses a fixed oracle authority for market creation, which matches the backend settlement design.

#### Oracle setup

- A dedicated demo oracle keypair was created and documented.
- The oracle public key is configured in app and backend env.
- The oracle private key stays on the backend only.
- The oracle wallet was used for real devnet settlement tests.

#### Backend API

- Supabase schema exists for:
  - markets
  - evidence
  - heart-rate readings
  - positions
  - resolutions
  - agent runs
- The backend supports:
  - market creation and listing
  - evidence submission
  - readings fetch
  - resolution trigger
  - market/user transactions
  - devnet faucet route

#### Real autonomous settlement

- The backend now loads the oracle keypair.
- The backend derives the market PDA from `onchain_market_id`.
- The backend can lock a market if needed.
- The backend can submit a real `resolveMarket` transaction on devnet.
- The backend stores the real settlement signature in Supabase.

#### Chain indexing

- The backend can parse Anchor event logs from devnet transactions.
- It syncs these back into Supabase:
  - `PredictionPlaced`
  - `MarketLocked`
  - `MarketResolved`
  - `PayoutClaimed`
- Positions now preserve:
  - original prediction tx signature
  - separate payout claim tx signature
- Transaction history now shows prediction, resolution, and claim entries distinctly.

#### Queue + worker path

- `POST /markets/:id/resolve` no longer resolves inline.
- It now creates a queued `agent_runs` job and returns immediately.
- A backend worker picks up the queued job, evaluates evidence, submits the oracle transaction, syncs chain state, and records success or failure.
- Failure stage and error details are persisted.

### Live validation completed

These were not just code changes. Real devnet flows were run:

- full on-chain create -> predict -> lock -> resolve -> claim
- backend-driven create -> evidence -> resolve
- chain indexing flow that read prediction, resolution, and claim activity back into Supabase
- queued resolver flow that completed asynchronously through `agent_runs`

### Verification completed

- `npx tsc --noEmit`
- `npm run lint:check`
- `npm run build`
- multiple live devnet smoke tests

## Architectural Decisions Made

### 1. Backend worker for settlement instead of OpenAI API usage

This was the correct choice for the current MVP.

Why:

- settlement must be deterministic and reproducible
- the backend must control the oracle keypair
- the system needs clear stage tracking and retry behavior
- the decision logic is currently simple rule evaluation, not open-ended reasoning
- on-chain settlement should not depend on an external model call for every resolution

In plain language:

The important part of settlement is not “AI creativity.” It is reliable evidence processing, consistent rule evaluation, and signing the right Solana transaction. A backend worker is a better fit for that than calling a language model.

OpenAI or another model may still become useful later for:

- anomaly explanations
- richer natural-language reasoning summaries
- fraud pattern review
- operator tooling

But not as the primary settlement engine for this MVP.

### 2. Dedicated backend oracle keypair instead of using a user wallet

Why:

- the market creator should not have to be the resolver
- autonomous settlement requires backend-held signing authority
- user wallets should not hold oracle responsibility

In plain language:

If a user wallet were set as oracle authority, only that wallet could resolve the market. That would break the goal of autonomous backend settlement.

### 3. Adapter boundary between app and Anchor program

Why:

- the UI should not depend directly on raw PDA/account details everywhere
- it keeps the frontend cleaner and easier to change
- it reduced interference with the separate Anchor work earlier

In plain language:

All chain-specific logic is funneled through one client layer instead of being spread all over the app.

### 4. Supabase as backend state + indexed chain mirror

Why:

- the app needs fast reads and structured query flows
- evidence, agent runs, and reasoning data are not purely on-chain concerns
- chain activity still needs to be reflected for positions and settlements

In plain language:

Supabase is being used as the app database, but important on-chain facts are synced back into it so the app has a clean source for UI queries.

With the corrected user model, Supabase should also be understood as:

- metadata storage for prosumer-owned feed sessions
- the read layer consumers use to discover streams and markets

not the place where all users push raw biometric telemetry.

For minute deterministic markets, Supabase should also not be treated as the latency-critical settlement substrate. That role should belong to rolling backend session state, with Supabase receiving hashes, summaries, and final audit records.

### 5. Queued settlement instead of inline request settlement

Why:

- on-chain settlement can take time
- evidence processing and sync are multi-step operations
- failures need to be inspectable after the request ends
- duplicate resolve requests need idempotency

In plain language:

The API should not sit there doing everything in one request and hoping nothing fails. A queue makes the flow safer and easier to debug.

### 6. Incremental chain sync using a cursor

Why:

- rescanning full market history each time is wasteful
- devnet tests will accumulate over time
- worker-style sync is easier to scale if it only processes new signatures

In plain language:

The backend remembers the last signature it synced, then only asks Solana for newer activity.

## Concrete Next Steps To Complete Section 4

Section 4 in this repo is the agentic settlement layer. A lot of it is already working, but it is not fully complete.

### Highest-priority remaining tasks

1. Add real retry policy for failed `agent_runs`
- retry only transient errors
- cap retry count
- avoid double-settlement

2. Add dead-letter handling
- failed runs that should not keep retrying need a stable terminal state
- they should be visible in admin/debug tooling

3. Add rolling deterministic session-state evaluation
- current BPM
- peak BPM
- threshold-crossing state
- integrity / gap tracking

4. Strengthen the resolution package
- make evidence preprocessing more explicit
- validate malformed or suspicious evidence
- persist cleaner normalized evidence summaries in the audit lane

5. Add a historical backfill command for chain sync
- process older test markets
- repair older rows if sync format changes

6. Trigger sync automatically after app-side chain actions
- especially after create
- after prediction
- after claim

7. Surface resolver status in the app
- queued
- running
- completed
- failed

8. Decide whether workers stay in-process or become a separate service
- current in-process worker is good for MVP
- separate worker becomes useful if deployment/runtime reliability matters

### Definition of “Section 4 complete enough for MVP”

Section 4 should be considered done when:

- a market can be resolved through the queued backend worker
- minute deterministic markets can settle from rolling live session state
- the real oracle transaction is stored and visible
- failures are inspectable and safely retryable
- chain events for prediction / resolution / claim are reliably indexed
- the app can show settlement progress and final outcome cleanly

## Concrete Next Steps To Complete Phase 5

In the full scope doc, “Phase 5” is the Agentic Resolver phase. In practice, some of that work has already started under section 4.

What is still left to fully satisfy that phase:

### 1. Live deterministic ingest

- compact low-latency signal transport
- rolling state integrity tracking
- settlement readiness before full audit package persistence

### 2. Evidence preprocessing

- formal raw evidence validator
- validation errors and invalid-state handling
- baseline / peak / threshold crossing extraction as a first-class step

### 3. Rule evaluation logic hardening

- support clearer edge-case handling
- explicit invalid outcomes when evidence is insufficient or corrupted
- confidence scoring that reflects actual data quality, not only reading count

### 3. Resolution package builder

- standardize the package shape
- include all hashes and normalized evidence fields
- make it fully reproducible for audits

### 4. Reasoning generation

- keep deterministic facts as the source of truth
- generate clearer human-readable summaries for the app
- potentially use AI later only for explanation polish, not for final authority

### 5. Oracle submission robustness

- better error mapping
- retry policy around RPC issues
- cleaner status transitions around lock/resolve/sync

### 6. Monitoring and operator visibility

- expose agent run history
- expose failure stage
- expose settlement tx
- expose evidence hash / analysis hash / resolution hash in a simple admin view or API response

## Recommended Order For Tomorrow

If work resumes, the order should be:

1. Wire agent-run status into the mobile app UI
2. Add retry + dead-letter behavior to failed `agent_runs`
3. Harden evidence preprocessing and invalid evidence handling
4. Add a historical backfill command for chain sync
5. Decide whether to keep workers in the API process or split them out

## Important Files Added or Updated In This Session

- [backend/src/server.mjs](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/backend/src/server.mjs)
- [backend/README.md](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/backend/README.md)
- [backend/.env.example](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/backend/.env.example)
- [ORACLEKEYPAIR.md](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/ORACLEKEYPAIR.md)
- [docs/SECTION4_AGENTIC_SETTLEMENT_PLAN.md](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/docs/SECTION4_AGENTIC_SETTLEMENT_PLAN.md)
- [scripts/backend-resolve-e2e.cjs](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/scripts/backend-resolve-e2e.cjs)
- [scripts/chain-indexer-e2e.cjs](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/scripts/chain-indexer-e2e.cjs)
- [supabase/migrations/20260506012000_add_chain_sync_fields.sql](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/supabase/migrations/20260506012000_add_chain_sync_fields.sql)
- [supabase/migrations/20260506014500_add_agent_run_queue_fields.sql](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/supabase/migrations/20260506014500_add_agent_run_queue_fields.sql)

## Final Plain-English State

The project is no longer just a frontend plus a mock backend.

It now has:

- real on-chain market actions
- a real backend oracle
- real devnet settlement
- a queue for resolver jobs
- chain activity syncing back into the app database

The main remaining work is not “make it exist.” The remaining work is to make it more reliable, more observable, and better surfaced in the UI.

## Planning Addendum

After this checkpoint, the product direction was refined further:

- biometric / structured measurable markets should be treated as **deterministic** markets
- visually messy / interpretation-heavy markets should be treated as **agentic** markets
- livestreams and other evidence sources should become first-class **feeds**
- markets should attach to feeds / sessions instead of existing only as isolated standalone records
- Android BLE belt support should move to a native low-latency live-signal path with a separate audit lane
- Supabase should not be used as the primary row-per-sample relay for live telemetry across all users

The new planning document for that direction is:

- [docs/REFACTORED_PLAN_FEEDS_AND_RESOLUTION.md](/Users/agustinschiariti/Desktop/Consensus26/Hackathon/docs/REFACTORED_PLAN_FEEDS_AND_RESOLUTION.md)

That document should be treated as the roadmap correction before the next substantial development pass.
