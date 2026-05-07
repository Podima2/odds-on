export type MarketStatus =
  | 'draft'
  | 'open'
  | 'locked'
  | 'resolving'
  | 'resolved'
  | 'settled'
  | 'cancelled'

export type ResolutionLane = 'deterministic' | 'agentic' | 'hybrid'
export type VerificationMode =
  | 'structured_attested'
  | 'structured_oracle_verified'
  | 'media_agentic'

export type MarketRule = {
  metric: 'heart_rate_bpm'
  operator: '>' | '<' | '=='
  threshold: number
  timeWindowSeconds: number
}

export type Feed = {
  id: string
  owner_wallet: string
  feed_type: 'ble_heart_rate' | 'livestream_video' | 'phone_camera' | 'gps' | 'step_counter'
  verification_mode: VerificationMode
  title: string | null
  created_at: string
}

export type FeedSession = {
  id: string
  feed_id: string
  status: 'planned' | 'live' | 'ended'
  started_at: string | null
  ended_at: string | null
  session_metadata: Record<string, unknown> | null
  latest_bpm?: number | null
  peak_bpm?: number | null
  sample_count?: number
  last_sequence?: number | string | null
  telemetry_updated_at?: string | null
  live_signal_state?: Record<string, unknown> | null
  created_at: string
}

export type HeartRateTelemetrySample = {
  sequence: number
  bpm: number
  sampledAt: string
  rrIntervalsMs?: number[]
  contactDetected?: boolean
}

export type Market = {
  id: string
  onchain_market_id: number | null
  feed_id: string | null
  feed_session_id: string | null
  creator_wallet: string
  title: string
  market_type: string
  resolution_lane: ResolutionLane
  verification_mode: VerificationMode | null
  structured_rule: MarketRule
  status: MarketStatus
  prediction_cutoff: string
  event_start_time: string | null
  event_end_time: string | null
  evidence_type: string | null
  metadata_hash: string | null
  created_at: string
}

export type Resolution = {
  id: string
  market_id: string
  outcome: 'YES' | 'NO' | 'INVALID'
  confidence: number | null
  reasoning_summary: string | null
  evidence_hash: string | null
  analysis_hash: string | null
  resolution_hash: string | null
  resolver_signature: string | null
  settlement_tx: string | null
  created_at: string
}

export type MarketPosition = {
  id: string
  market_id: string
  user_wallet: string
  side: 'YES' | 'NO'
  amount: number
  tx_signature: string | null
  created_at: string
  claimed_at?: string | null
  claim_tx_signature?: string | null
}

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed'

export type AgentRun = {
  id: string
  market_id: string
  evidence_id: string | null
  agent_version: string
  input_hash: string | null
  output_hash: string | null
  status: AgentRunStatus
  started_at: string | null
  completed_at: string | null
  created_at: string
  stage?: string | null
  error_message?: string | null
  error_details?: unknown
  attempt_count?: number
  resolution_payload?: unknown
  settlement_tx?: string | null
}
