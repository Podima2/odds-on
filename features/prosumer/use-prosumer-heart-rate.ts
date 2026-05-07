import { useEffect, useMemo, useRef, useState } from 'react'
import { ingestHeartRateTelemetry } from '@/features/markets/markets.api'
import { HeartRateTelemetrySample } from '@/features/markets/markets.types'
import { heartRateBeltClient, HeartRateDiscovery, HeartRateReading } from '@/features/prosumer/heart-rate-belt-client'
import { getLiveHeartRateState } from '@/features/prosumer/heart-rate-session'
import type { FeedSession } from '@/features/markets/markets.types'

const FLUSH_INTERVAL_MS = 2_000
const FLUSH_BATCH_SIZE = 5

type UseProsumerHeartRateOptions = {
  feedId: string
  session: FeedSession | null | undefined
  enabled: boolean
}

export function useProsumerHeartRate({ feedId, session, enabled }: UseProsumerHeartRateOptions) {
  const liveState = useMemo(() => getLiveHeartRateState(session), [session])
  const [devices, setDevices] = useState<HeartRateDiscovery[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [connectedDevice, setConnectedDevice] = useState<HeartRateDiscovery | null>(null)
  const [latestReading, setLatestReading] = useState<HeartRateReading | null>(null)
  const [flushError, setFlushError] = useState<string | null>(null)

  const sequenceRef = useRef(liveState.lastSequence + 1)
  const bufferRef = useRef<HeartRateTelemetrySample[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flushInFlightRef = useRef(false)

  useEffect(() => {
    sequenceRef.current = Math.max(sequenceRef.current, liveState.lastSequence + 1)
  }, [liveState.lastSequence])

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current)
      }
      heartRateBeltClient.stopScan()
      void heartRateBeltClient.disconnect()
    }
  }, [])

  async function flushBufferedSamples() {
    if (!session?.id || bufferRef.current.length === 0 || flushInFlightRef.current) {
      return
    }

    flushInFlightRef.current = true
    const payload = bufferRef.current.splice(0, bufferRef.current.length)

    try {
      await ingestHeartRateTelemetry(feedId, session.id, {
        deviceId: connectedDevice?.id,
        deviceLabel: connectedDevice?.name,
        source: 'android-ble-heart-rate',
        samples: payload,
      })
      setFlushError(null)
    } catch (error) {
      bufferRef.current = [...payload, ...bufferRef.current].slice(-180)
      setFlushError(error instanceof Error ? error.message : 'Unable to send live heart-rate telemetry.')
    } finally {
      flushInFlightRef.current = false
    }
  }

  function ensureFlushLoop() {
    if (flushTimerRef.current) {
      return
    }

    flushTimerRef.current = setInterval(() => {
      void flushBufferedSamples()
    }, FLUSH_INTERVAL_MS)
  }

  function stopFlushLoop() {
    if (!flushTimerRef.current) {
      return
    }

    clearInterval(flushTimerRef.current)
    flushTimerRef.current = null
  }

  function handleReading(reading: HeartRateReading) {
    setLatestReading(reading)

    const sample: HeartRateTelemetrySample = {
      sequence: sequenceRef.current,
      bpm: reading.bpm,
      sampledAt: reading.sampledAt,
      rrIntervalsMs: reading.rrIntervalsMs,
      contactDetected: reading.contactDetected,
    }

    sequenceRef.current += 1
    bufferRef.current.push(sample)

    if (bufferRef.current.length >= FLUSH_BATCH_SIZE) {
      void flushBufferedSamples()
    }
  }

  async function startScan() {
    if (!enabled) {
      return
    }

    setDevices([])
    setIsScanning(true)
    setFlushError(null)

    try {
      await heartRateBeltClient.scanForBelts((device) => {
        setDevices((current) => {
          if (current.some((candidate) => candidate.id === device.id)) {
            return current
          }
          return [...current, device]
        })
      })
    } catch (error) {
      setIsScanning(false)
      setFlushError(error instanceof Error ? error.message : 'Unable to scan for belts.')
      throw error
    }
  }

  function stopScan() {
    heartRateBeltClient.stopScan()
    setIsScanning(false)
  }

  async function connect(device: HeartRateDiscovery) {
    if (!session?.id) {
      throw new Error('Start a stream session before connecting a belt.')
    }

    setIsConnecting(true)
    setFlushError(null)

    try {
      const connected = await heartRateBeltClient.connect(device.id, handleReading)
      setConnectedDevice({
        id: connected.id,
        name: connected.name,
        rssi: device.rssi,
      })
      setIsStreaming(true)
      setIsScanning(false)
      ensureFlushLoop()
    } finally {
      setIsConnecting(false)
    }
  }

  async function disconnect() {
    stopScan()
    stopFlushLoop()
    await flushBufferedSamples()
    await heartRateBeltClient.disconnect()
    setConnectedDevice(null)
    setIsStreaming(false)
  }

  return {
    devices,
    isScanning,
    isConnecting,
    isStreaming,
    connectedDevice,
    latestBpm: latestReading?.bpm ?? liveState.latestBpm,
    peakBpm: liveState.peakBpm,
    sampleCount: liveState.sampleCount + bufferRef.current.length,
    flushError,
    startScan,
    stopScan,
    connect,
    disconnect,
  }
}
