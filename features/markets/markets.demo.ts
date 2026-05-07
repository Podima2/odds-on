import { HeartRateReading } from '@/features/markets/markets.api'

export type DemoReading = { t: number; bpm: number }

export function buildDemoReadings(threshold: number, timeWindowSeconds: number): DemoReading[] {
  const steps = Math.max(6, Math.floor(timeWindowSeconds / 15))
  const interval = Math.max(10, Math.floor(timeWindowSeconds / steps))

  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = Math.min(index * interval, timeWindowSeconds)
    const bpm =
      index === 0
        ? 92
        : Math.min(threshold + 8, 92 + index * 13 + (index % 2 === 0 ? 2 : -1))

    return { t, bpm }
  })
}

export function summarizeReadings(readings: Array<Pick<HeartRateReading, 'timestamp_offset' | 'bpm'>>) {
  const sorted = [...readings].sort((a, b) => a.timestamp_offset - b.timestamp_offset)
  const baselineBpm = sorted[0]?.bpm ?? 0
  const peakBpm = sorted.reduce((max, reading) => Math.max(max, reading.bpm), 0)

  return {
    baselineBpm,
    peakBpm,
    readingCount: sorted.length,
  }
}
