import { FeedSession } from '@/features/markets/markets.types'

export type LiveHeartRateState = {
  latestBpm: number | null
  peakBpm: number | null
  sampleCount: number
  lastSequence: number
  telemetryUpdatedAt: string | null
  rollingAverageBpm: number | null
  deviceId: string | null
  source: string | null
  status: string | null
}

function readNumber(value: unknown, fallback: number | null = null) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function getLiveHeartRateState(session?: FeedSession | null): LiveHeartRateState {
  const metadataState: Record<string, unknown> =
    session?.session_metadata &&
    typeof session.session_metadata === 'object' &&
    session.session_metadata.liveSignalState &&
    typeof session.session_metadata.liveSignalState === 'object'
      ? (session.session_metadata.liveSignalState as Record<string, unknown>)
      : {}
  const signalState: Record<string, unknown> =
    session?.live_signal_state && typeof session.live_signal_state === 'object'
      ? (session.live_signal_state as Record<string, unknown>)
      : metadataState

  return {
    latestBpm: readNumber(session?.latest_bpm ?? signalState.latestBpm),
    peakBpm: readNumber(session?.peak_bpm ?? signalState.peakBpm),
    sampleCount: readNumber(session?.sample_count ?? signalState.sampleCount, 0) ?? 0,
    lastSequence: readNumber(session?.last_sequence ?? signalState.lastSequence, -1) ?? -1,
    telemetryUpdatedAt: readString(session?.telemetry_updated_at ?? signalState.lastSampledAt),
    rollingAverageBpm: readNumber(signalState.rollingAverageBpm),
    deviceId: readString(signalState.deviceId),
    source: readString(signalState.source),
    status: readString(signalState.status),
  }
}
