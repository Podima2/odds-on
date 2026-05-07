# OddsOn Backend API

This backend is a lightweight Node 20 HTTP server that fronts Supabase tables and storage without adding new runtime dependencies.

## Prerequisites

- Node.js 20+
- Supabase CLI initialized in this repo
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

## Start

```bash
npm run api:dev
```

## Endpoints

- `POST /feeds`
- `GET /feeds`
- `POST /feeds/:id/sessions`
- `GET /feeds/:id/sessions/:sessionId`
- `GET /feeds/:id/markets`
- `POST /markets`
- `GET /markets`
- `GET /markets/:id`
- `GET /markets/:id/positions`
- `POST /markets/:id/evidence`
- `GET /markets/:id/evidence`
- `GET /markets/:id/readings`
- `POST /markets/:id/resolve`
- `GET /markets/:id/resolution`
- `GET /markets/:id/agent-runs`
- `POST /markets/:id/sync-chain`
- `POST /markets/onchain/:onchainMarketId/sync-chain`
- `GET /markets/:id/transactions`
- `GET /users/:wallet/transactions`

## Notes

- This server uses the Supabase PostgREST API through `fetch`.
- Evidence payloads are written to storage only when `SUPABASE_STORAGE_BUCKET` is configured and the bucket exists.
- The data model now supports `feeds`, `feed_sessions`, `markets.feed_id`, `markets.feed_session_id`, `markets.resolution_lane`, and `markets.verification_mode`.
- The resolver route now enqueues an `agent_runs` job and returns `202`; an in-process worker performs deterministic evaluation and submits the live devnet oracle transaction when the market has an `onchain_market_id`.
- Chain sync routes parse Anchor events from devnet transaction logs and upsert positions, resolution signatures, claim signatures, and market sync status back into Supabase.
- The API server also runs a polling resolver worker and an incremental chain-sync worker using `last_indexed_signature` as a per-market cursor.
