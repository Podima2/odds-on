<div align="center">

<img src="./assets/images/logo.png" alt="OddsOn" width="200" />

# OddsOn

**Live-feed prediction markets on Solana, settled by what your body actually does.**

Prosumers stream. A BLE heart-rate belt produces verifiable evidence. Consumers spin up YES/NO markets around the live session. An oracle resolves on-chain. Payouts are trustless.

[![Solana](https://img.shields.io/badge/Solana-Devnet-14F195?style=flat-square&logo=solana&logoColor=black)](https://solana.com)
[![Expo](https://img.shields.io/badge/Expo-React_Native-000?style=flat-square&logo=expo)](https://expo.dev)
[![BLE](https://img.shields.io/badge/BLE-Heart_Rate_0x180D-E11D48?style=flat-square)](https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/)
[![Anchor](https://img.shields.io/badge/Anchor-Program-512BD4?style=flat-square)](https://www.anchor-lang.com/)

</div>

---

## ✨ What it is

OddsOn is a Solana-mobile-first prediction market dApp. Two roles, one feed:

- **Prosumers** publish a livestream and pair a BLE heart-rate belt. Their session becomes the source of truth.
- **Consumers** discover live feeds, create or join YES/NO markets ("BPM crosses 165 in the next 60s?"), and claim payouts when the market resolves.

Settlement is hybrid: **deterministic** for structured biometric thresholds, and an **AI oracle path** for messier, interpretive markets. Both roads end the same way — a signed resolution package gets pushed on-chain by the oracle authority, and the program releases escrow.

---

## 🏗️ Technical Architecture

```mermaid
flowchart TB
    subgraph Mobile["📱 Mobile App  ·  Expo + React Native + Wallet UI Kit"]
        direction TB
        ProUI["Prosumer UI<br/>create-stream · session control"]
        ConsUI["Consumer UI<br/>feed grid · market create · predict · claim"]
        BLE["heart-rate-belt-client<br/>react-native-ble-plx"]
        ProgCli["program-client.ts<br/>@solana/kit instruction builder"]
        Wallet["Mobile Wallet Adapter"]
    end

    subgraph Belt["❤️ BLE Integration"]
        direction LR
        Strap["Heart-rate strap<br/>GATT 0x180D / 0x2A37"]
        Parser["Flag parser<br/>uint8/uint16 BPM · RR intervals · contact bit"]
        Buffer["Sample buffer<br/>flush every 2s · batch ≥ 5"]
        Strap -- "GATT notify" --> Parser --> Buffer
    end

    subgraph Backend["🛰️  Backend API  ·  Node http + Supabase"]
        direction TB
        Routes["REST routes<br/>/feeds · /markets · /sessions · /telemetry"]
        Ingest["Telemetry ingest<br/>normalize · sequence · store readings"]
        Resolver["Resolver worker<br/>queue → claim → process"]
        ChainSync["Chain sync worker<br/>indexes on-chain positions"]
        OracleKey["Oracle keypair<br/>signs settle_market tx"]
    end

    subgraph Resolution["⚖️  Market Resolution"]
        direction TB
        Evidence["Evidence package<br/>session readings + market rule"]
        Det["Deterministic evaluator<br/>threshold · time-window rule"]
        AI["AI oracle path<br/>messy / interpretive markets"]
        Pkg["Resolution package<br/>evidence_hash · resolution_hash · outcome"]
    end

    subgraph Chain["⛓️  Solana Program  ·  Anchor"]
        direction TB
        Market["Market PDA<br/>pools · cutoff · status · outcome"]
        Vault["Escrow vault<br/>YES/NO lamports"]
        Position["Position PDA<br/>user · side · amount"]
        Ix["Instructions<br/>create_market · place_prediction · settle_market · claim_payout"]
    end

    Storage[("Supabase<br/>Postgres + Storage<br/>feeds · sessions · markets · readings · evidence · agent_runs · resolutions")]
    RPC[("Solana Devnet RPC")]

    %% Stream connection flow
    ProUI -- "create feed + session" --> Routes
    ConsUI -- "discover feeds · open market" --> Routes

    %% BLE flow
    BLE --> Buffer
    Buffer -- "POST /feeds/:id/sessions/:sid/heart-rate" --> Ingest

    %% Storage
    Routes --> Storage
    Ingest --> Storage

    %% Predictions on-chain
    ConsUI --> ProgCli
    ProUI --> ProgCli
    ProgCli --> Wallet
    Wallet -- "place_prediction · claim_payout" --> Ix
    Ix --> Market
    Ix --> Vault
    Ix --> Position

    %% Resolution flow
    Storage --> Resolver
    Resolver --> Evidence
    Evidence --> Det
    Evidence --> AI
    Det --> Pkg
    AI --> Pkg
    Pkg -- "settle_market" --> OracleKey
    OracleKey --> Ix
    ChainSync <-- "getSignatures · parse positions" --> RPC
    Ix --> RPC
    Resolver --> Storage

    classDef mobile fill:#0EA5E9,stroke:#0369A1,color:#fff
    classDef ble fill:#E11D48,stroke:#9F1239,color:#fff
    classDef backend fill:#7C3AED,stroke:#5B21B6,color:#fff
    classDef resolution fill:#F59E0B,stroke:#B45309,color:#1f2937
    classDef chain fill:#14F195,stroke:#059669,color:#064E3B
    classDef store fill:#1F2937,stroke:#111827,color:#F9FAFB

    class ProUI,ConsUI,ProgCli,Wallet mobile
    class Strap,Parser,Buffer,BLE ble
    class Routes,Ingest,Resolver,ChainSync,OracleKey backend
    class Evidence,Det,AI,Pkg resolution
    class Market,Vault,Position,Ix chain
    class Storage,RPC store
```

### The three load-bearing pieces

#### 🔴 Stream connection
A prosumer opens **`create-stream`**, picks an embed URL and a device label, and the app posts a `feed` + `live` `feed_session` to the backend. The session id is the join key everything else hangs off — markets reference it, telemetry posts to it, and the resolver pulls evidence through it. Consumers reach the same session through `/feed/[id]` and see the embed plus every market attached to it.

> Code: `app/create-stream.tsx`, `features/markets/markets.api.ts`, `features/markets/use-feeds.ts`

#### ⚖️ Market resolution
At cutoff, the backend's **resolver worker** atomically claims the next queued `agent_run`, loads the market and its evidence (or builds an audit-evidence record from the live session), evaluates the rule against ordered heart-rate readings, and produces a deterministic `resolution_package` with `evidence_hash`, `analysis_hash`, and `resolution_hash`. The package is signed by the **oracle authority keypair** and pushed to the Anchor program via `settle_market`. A separate **chain-sync worker** mirrors on-chain state back to Supabase so the UI sees a consistent view.

> Code: `backend/src/server.mjs` — `processAgentRun`, `buildResolutionPackage`, `settleMarketOnChain`, `runResolverWorker`, `runChainSyncWorker`

#### ❤️ BLE integration
The Android client speaks the standard BLE Heart Rate GATT profile: scans for service `0x180D`, subscribes to characteristic `0x2A37`, and parses each notification respecting the flags byte (uint8 vs uint16 BPM, energy-expended, RR-intervals, contact bit). Readings are sequence-numbered, buffered, and flushed every **2s** in batches of **≥5** to `POST /feeds/:id/sessions/:sid/heart-rate`. Permissions, scanning, retries, and stale-disconnect handling are managed by a singleton client so the strap survives navigation.

> Code: `features/prosumer/heart-rate-belt-client.ts`, `features/prosumer/use-prosumer-heart-rate.ts`, `features/prosumer/heart-rate-session.ts`

---

## 🧱 Stack

| Layer | Tech |
|---|---|
| Mobile | Expo 55 · React Native 0.83 · React 19 · expo-router · Reanimated |
| Wallet | `@wallet-ui/react-native-kit` · Solana Mobile Wallet Adapter |
| Solana | `@solana/kit` · Anchor program · devnet |
| BLE | `react-native-ble-plx` · standard HRP profile |
| Backend | Node `http` (zero-framework) · Supabase REST · oracle keypair signer |
| Storage | Supabase Postgres + Storage bucket |

---

## 🚀 Run it

```bash
# 1. Install
npm install

# 2. Backend (Supabase + oracle env in backend/.env.local)
npm run api:dev:live

# 3. Mobile (Android device with the BLE strap paired)
npm run android
```

The app expects a devnet wallet, the backend on `localhost:8787`, and the Anchor program id wired into `constants/app-config.ts`.

---

## 📁 Layout

```
app/                Expo Router screens (feed, market, create-*, result, challenge)
features/
  markets/          Feeds, sessions, markets — types, API client, hooks
  prosumer/         BLE strap client + telemetry flush hook
  program/          @solana/kit instruction builder for the Anchor program
  account/          Wallet connect, balance, sign
backend/src/        Single-file Node API: routes, resolver worker, chain sync
supabase/           Migrations + seed for the off-chain schema
docs/               Project scope, program spec, settlement plan
```

---

<div align="center">

Built for Consensus '26 · Solana Mobile Hackathon

</div>
