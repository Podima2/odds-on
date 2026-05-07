import { AppConfig } from '@/constants/app-config'
import {
  AgentRun,
  Feed,
  FeedSession,
  HeartRateTelemetrySample,
  Market,
  MarketPosition,
  Resolution,
} from '@/features/markets/markets.types'

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${AppConfig.apiBaseUrl}${path}`, init)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `API request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export function getMarkets(status?: string) {
  const params = status ? `?status=${encodeURIComponent(status)}` : ''
  return apiRequest<Market[]>(`/markets${params}`)
}

export type CreateFeedPayload = {
  ownerWallet: string
  feedType: Feed['feed_type']
  verificationMode: Feed['verification_mode']
  title?: string
}

export type CreateFeedSessionPayload = {
  status: FeedSession['status']
  startedAt?: string
  endedAt?: string
  sessionMetadata?: Record<string, unknown>
}

export type UpdateFeedSessionPayload = {
  status?: FeedSession['status']
  startedAt?: string
  endedAt?: string
  sessionMetadata?: Record<string, unknown>
}

export type HeartRateTelemetryPayload = {
  deviceId?: string
  deviceLabel?: string
  source?: string
  samples: HeartRateTelemetrySample[]
}

export function getFeeds() {
  return apiRequest<Feed[]>('/feeds')
}

export function getFeed(feedId: string) {
  return apiRequest<Feed>(`/feeds/${feedId}`)
}

export function createFeed(payload: CreateFeedPayload) {
  return apiRequest<Feed>('/feeds', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function createFeedSession(feedId: string, payload: CreateFeedSessionPayload) {
  return apiRequest<FeedSession>(`/feeds/${feedId}/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function getFeedSessions(feedId: string, status?: FeedSession['status']) {
  const params = new URLSearchParams()
  if (status) {
    params.set('status', status)
  }

  const query = params.toString()
  return apiRequest<FeedSession[]>(`/feeds/${feedId}/sessions${query ? `?${query}` : ''}`)
}

export function getFeedSession(feedId: string, sessionId: string) {
  return apiRequest<FeedSession>(`/feeds/${feedId}/sessions/${sessionId}`)
}

export function updateFeedSession(feedId: string, sessionId: string, payload: UpdateFeedSessionPayload) {
  return apiRequest<FeedSession>(`/feeds/${feedId}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function ingestHeartRateTelemetry(feedId: string, sessionId: string, payload: HeartRateTelemetryPayload) {
  return apiRequest<{
    acceptedSamples: number
    ignoredSamples: number
    session: FeedSession
  }>(`/feeds/${feedId}/sessions/${sessionId}/telemetry/heart-rate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function getFeedMarkets(feedId: string) {
  return apiRequest<Market[]>(`/feeds/${feedId}/markets`)
}

export function getMarket(marketId: string) {
  return apiRequest<Market>(`/markets/${marketId}`)
}

export function getMarketPositions(marketId: string) {
  return apiRequest<MarketPosition[]>(`/markets/${marketId}/positions`)
}

export function getMarketResolution(marketId: string) {
  return apiRequest<Resolution>(`/markets/${marketId}/resolution`)
}

export function getMarketAgentRuns(marketId: string) {
  return apiRequest<AgentRun[]>(`/markets/${marketId}/agent-runs`)
}

export type MarketEvidence = {
  id: string
  market_id: string
  evidence_type: string
  source: string
  raw_storage_url: string | null
  normalized_storage_url: string | null
  evidence_hash: string | null
  submitted_by: string | null
  submitted_at: string
}

export type HeartRateReading = {
  id: string
  evidence_id: string
  market_id: string
  timestamp_offset: number
  bpm: number
  sequence_index: number
}

export type SubmitEvidenceInput = {
  evidenceType: string
  source: string
  submittedBy: string
  readings: Array<{ t: number; bpm: number }>
}

export type CreateMarketPayload = {
  onchainMarketId?: number
  feedId?: string
  feedSessionId?: string
  creatorWallet: string
  title: string
  resolutionLane?: Market['resolution_lane']
  verificationMode?: Market['verification_mode']
  structuredRule: {
    metric: 'heart_rate_bpm'
    operator: '>' | '<' | '=='
    threshold: number
    timeWindowSeconds: number
  }
  status: string
  predictionCutoff: string
  eventStartTime: string
  eventEndTime: string
  evidenceType: string
  metadataHash?: string
}

export function getMarketEvidence(marketId: string) {
  return apiRequest<MarketEvidence[]>(`/markets/${marketId}/evidence`)
}

export function getMarketReadings(marketId: string) {
  return apiRequest<HeartRateReading[]>(`/markets/${marketId}/readings`)
}

export function createMarket(payload: CreateMarketPayload) {
  return apiRequest<Market>('/markets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function submitMarketEvidence(marketId: string, payload: SubmitEvidenceInput) {
  return apiRequest<{ evidence: MarketEvidence; readingsInserted: number }>(`/markets/${marketId}/evidence`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function resolveMarket(marketId: string) {
  return apiRequest<{ status: string; agentRun: AgentRun }>(`/markets/${marketId}/resolve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
  })
}

export function syncMarket(marketId: string) {
  return apiRequest<{ marketId: string; onchainMarketId: number | null }>(`/markets/${marketId}/sync-chain`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
  })
}

export type DevnetAirdropResult = {
  walletAddress: string
  signature: string
  rpcUrl: string
  lamportsRequested: string
  balanceBeforeLamports: string
  balanceAfterLamports: string
  cooldownMs: number
}

export function requestDevnetAirdrop(walletAddress: string) {
  return apiRequest<DevnetAirdropResult>(`/users/${walletAddress}/airdrop`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
  })
}
