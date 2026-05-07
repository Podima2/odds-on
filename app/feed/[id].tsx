import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  LayoutChangeEvent,
  Pressable,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import * as ScreenOrientation from 'expo-screen-orientation'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { theme } from '@/constants/theme'
import { formatCountdown, formatRule, formatSolFromLamports, getImpliedOdds, getPoolTotals } from '@/features/markets/markets.format'
import { getSessionStreamUrl, getSessionThumbnailUrl } from '@/features/markets/feed-media'
import { createMarket, getMarketPositions, getMarketResolution, syncMarket } from '@/features/markets/markets.api'
import { useFeed, useFeedMarkets, useFeedSessions } from '@/features/markets/use-feeds'
import { useProgramClient } from '@/features/program/program-client'
import { useProsumerHeartRate } from '@/features/prosumer/use-prosumer-heart-rate'

function normalizeYouTubeUrl(streamUrl: string) {
  try {
    const url = new URL(streamUrl)
    const host = url.hostname.replace(/^www\./, '')

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') {
        const videoId = url.searchParams.get('v')
        if (!videoId) {
          return null
        }

        return videoId
      }

      if (url.pathname.startsWith('/embed/')) {
        const videoId = url.pathname.split('/embed/')[1]?.split('/')[0]
        if (!videoId) {
          return null
        }

        return videoId
      }
    }

    if (host === 'youtu.be') {
      const videoId = url.pathname.replace('/', '').trim()
      if (!videoId) {
        return null
      }

      return videoId
    }
  } catch {
    return null
  }

  return null
}

function getStreamEmbedSource(streamUrl: string) {
  const youTubeVideoId = normalizeYouTubeUrl(streamUrl)
  if (youTubeVideoId) {
    const embedUrl = `https://www.youtube-nocookie.com/embed/${youTubeVideoId}?playsinline=1&rel=0&modestbranding=1`

    return {
      html: `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #091126;
        overflow: hidden;
      }
      body {
        position: fixed;
        inset: 0;
      }
      iframe {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe
      src="${embedUrl}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen="allowfullscreen"
    ></iframe>
  </body>
</html>`,
      baseUrl: 'https://www.youtube-nocookie.com',
    }
  }

  return { uri: streamUrl }
}

const BPM_MIN = 90
const BPM_MAX = 200
const BPM_STEP = 5
const DURATION_MIN = 15
const DURATION_MAX = 180
const DURATION_STEP = 15

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function snap(value: number, min: number, max: number, step: number) {
  const normalized = Math.round((clamp(value, min, max) - min) / step) * step + min
  return clamp(normalized, min, max)
}

function formatOperatorLabel(aboveThreshold: boolean) {
  return aboveThreshold ? 'Above' : 'Below'
}

type SliderFieldProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}

function SliderField({ label, value, min, max, step, suffix, onChange }: SliderFieldProps) {
  const [trackWidth, setTrackWidth] = useState(1)
  const ratio = (value - min) / Math.max(max - min, 1)
  const thumbOffset = ratio * trackWidth

  function updateFromLocation(locationX: number) {
    const bounded = clamp(locationX, 0, trackWidth)
    const next = min + ((bounded / Math.max(trackWidth, 1)) * (max - min))
    onChange(snap(next, min, max, step))
  }

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => updateFromLocation(event.nativeEvent.locationX),
        onPanResponderMove: (event) => updateFromLocation(event.nativeEvent.locationX),
      }),
    [trackWidth, min, max, step]
  )

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width)
  }

  return (
    <View style={styles.sliderField}>
      <View style={styles.sliderFieldHeader}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>
          {value}
          {suffix}
        </Text>
      </View>

      <View
        style={styles.sliderTrack}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        onLayout={handleLayout}
        {...responder.panHandlers}
      >
        <View style={[styles.sliderFill, { width: `${ratio * 100}%` }]} />
        <View style={[styles.sliderThumb, { left: thumbOffset }]} />
      </View>

      <View style={styles.sliderStepRow}>
        <TouchableOpacity style={styles.sliderAdjustButton} onPress={() => onChange(snap(value - step, min, max, step))}>
          <Ionicons name="remove" size={14} color={theme.colors.text.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sliderAdjustButton} onPress={() => onChange(snap(value + step, min, max, step))}>
          <Ionicons name="add" size={14} color={theme.colors.text.primary} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default function FeedDetailScreen() {
  const { width, height } = useWindowDimensions()
  const { id, sessionId } = useLocalSearchParams<{ id: string; sessionId?: string }>()
  const feedId = id ?? ''
  const { account } = useMobileWallet()
  const queryClient = useQueryClient()
  const programClient = useProgramClient()
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null)
  const [pendingMarketId, setPendingMarketId] = useState<string | null>(null)
  const [prosumerPanelOpen, setProsumerPanelOpen] = useState(false)
  const [marketOverlayOpen, setMarketOverlayOpen] = useState(false)
  const [marketThreshold, setMarketThreshold] = useState(150)
  const [marketDuration, setMarketDuration] = useState(60)
  const [marketAboveThreshold, setMarketAboveThreshold] = useState(true)
  const [marketCreatePending, setMarketCreatePending] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [isStreamLoading, setIsStreamLoading] = useState(false)
  const [hasStreamLoaded, setHasStreamLoaded] = useState(false)

  const feedQuery = useFeed(feedId)
  const sessionsQuery = useFeedSessions(feedId)
  const marketsQuery = useFeedMarkets(feedId)
  const feed = feedQuery.data
  const sessions = sessionsQuery.data ?? []
  const useLandscapeLayout = width > height || width >= 900
  const selectedSession =
    sessions.find((candidate) => candidate.id === sessionId) ??
    sessions.find((candidate) => candidate.status === 'live') ??
    sessions.find((candidate) => candidate.status === 'planned') ??
    sessions[0]

  const scopedMarkets = useMemo(() => {
    const markets = marketsQuery.data ?? []

    if (!selectedSession) {
      return markets
    }

    const matchingSessionMarkets = markets.filter((market) => market.feed_session_id === selectedSession.id)
    return matchingSessionMarkets.length > 0 ? matchingSessionMarkets : markets
  }, [marketsQuery.data, selectedSession])

  const positionsQueries = useQueries({
    queries: scopedMarkets.map((market) => ({
      queryKey: ['markets', market.id, 'positions'],
      queryFn: () => getMarketPositions(market.id),
      enabled: Boolean(market.id),
      refetchInterval: 8_000,
    })),
  })

  const resolutionQueries = useQueries({
    queries: scopedMarkets
      .filter((market) => market.status === 'resolved' || market.status === 'settled')
      .map((market) => ({
        queryKey: ['markets', market.id, 'resolution'],
        queryFn: () => getMarketResolution(market.id),
        enabled: Boolean(market.id),
        refetchInterval: 8_000,
      })),
  })

  const thumbnailUrl = getSessionThumbnailUrl(selectedSession)
  const streamUrl = getSessionStreamUrl(selectedSession)
  const streamSource = streamUrl ? getStreamEmbedSource(streamUrl) : null
  const resolvedStreamUri =
    streamSource && 'uri' in streamSource && typeof streamSource.uri === 'string' ? streamSource.uri : null
  const pinnedMarketId = expandedMarketId
  const isProsumer = Boolean(account && feed?.owner_wallet === account.address && selectedSession)
  const prosumerHeartRate = useProsumerHeartRate({
    feedId,
    session: selectedSession,
    enabled: isProsumer,
  })

  useEffect(() => {
    let isMounted = true

    async function lockOrientation() {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      } catch {
        if (isMounted) {
          console.warn('Unable to lock screen orientation for the stream page.')
        }
      }
    }

    void lockOrientation()

    return () => {
      isMounted = false
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT)
    }
  }, [])

  async function handlePrediction(marketId: string, side: 'YES' | 'NO', onchainMarketId: number | null) {
    if (!account) {
      Alert.alert('Wallet required')
      return
    }

    if (!onchainMarketId) {
      Alert.alert('Market unavailable')
      return
    }

    try {
      setPendingMarketId(marketId)
      await programClient.placePrediction(BigInt(onchainMarketId), side, BigInt(100_000_000))
      await syncMarket(marketId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['feeds', feedId, 'markets'] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'positions'] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'resolution'] }),
      ])
    } catch (error) {
      Alert.alert('Prediction failed', error instanceof Error ? error.message : 'Unable to place prediction.')
    } finally {
      setPendingMarketId(null)
    }
  }

  async function handleCreateInlineMarket() {
    if (!account) {
      Alert.alert('Wallet required')
      return
    }

    if (!selectedSession) {
      Alert.alert('Session required', 'Start a stream session before creating a market.')
      return
    }

    const now = Date.now()
    const predictionCutoff = new Date(now + 15_000).toISOString()
    const eventStartTime = new Date(now).toISOString()
    const eventEndTime = new Date(now + marketDuration * 1000).toISOString()
    const operator: '>' | '<' = marketAboveThreshold ? '>' : '<'
    const title = `Will BPM stay ${marketAboveThreshold ? 'above' : 'below'} ${marketThreshold} for ${marketDuration}s?`

    setMarketCreatePending(true)

    try {
      const programResult = await programClient.createMarket({
        title,
        threshold: marketThreshold,
        timeWindowSeconds: marketDuration,
        predictionCutoff,
        eventStartTime,
        eventEndTime,
      })

      const market = await createMarket({
        onchainMarketId: Number(programResult.marketId),
        feedId,
        feedSessionId: selectedSession.id,
        creatorWallet: account.address,
        title,
        structuredRule: {
          metric: 'heart_rate_bpm',
          operator,
          threshold: marketThreshold,
          timeWindowSeconds: marketDuration,
        },
        status: 'open',
        predictionCutoff,
        eventStartTime,
        eventEndTime,
        evidenceType: 'heart_rate_live_session_audit',
        metadataHash: programResult.metadataHashHex,
      })

      await syncMarket(market.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['feeds', feedId, 'markets'] }),
        queryClient.invalidateQueries({ queryKey: ['markets'] }),
      ])
      setMarketOverlayOpen(false)
      setExpandedMarketId(market.id)
    } catch (error) {
      Alert.alert('Create market failed', error instanceof Error ? error.message : 'Unable to create live market.')
    } finally {
      setMarketCreatePending(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient colors={theme.gradients.hero} style={styles.screen}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          {feedQuery.isLoading || sessionsQuery.isLoading || marketsQuery.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.colors.secondary} />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : feed ? (
            <View style={styles.page}>
              <View style={[styles.mainLayout, useLandscapeLayout ? styles.mainLayoutLandscape : styles.mainLayoutPortrait]}>
                <LinearGradient
                  colors={theme.gradients.card}
                  style={[styles.streamPanel, useLandscapeLayout ? styles.streamPanelLandscape : styles.streamPanelPortrait]}
                >
                  <View
                    style={[
                      styles.streamMediaFrame,
                      useLandscapeLayout ? styles.streamMediaFrameLandscape : styles.streamMediaFramePortrait,
                    ]}
                  >
                    {streamSource ? (
                      <WebView
                        key={resolvedStreamUri ?? streamUrl}
                        source={streamSource}
                        originWhitelist={['*']}
                        style={styles.streamWebView}
                        javaScriptEnabled
                        domStorageEnabled
                        mediaPlaybackRequiresUserAction={false}
                        allowsInlineMediaPlayback
                        allowsFullscreenVideo
                        setSupportMultipleWindows={false}
                        scrollEnabled={false}
                        cacheEnabled
                        androidLayerType="hardware"
                        onLoadStart={() => {
                          setStreamError(null)
                          setHasStreamLoaded(false)
                          setIsStreamLoading(true)
                        }}
                        onLoadEnd={() => {
                          setIsStreamLoading(false)
                          setHasStreamLoaded(true)
                        }}
                        onError={(event) => {
                          setIsStreamLoading(false)
                          setStreamError(event.nativeEvent.description || 'WebView failed to load stream.')
                        }}
                        onHttpError={(event) => {
                          setIsStreamLoading(false)
                          setStreamError(`HTTP ${event.nativeEvent.statusCode} while loading stream.`)
                        }}
                      />
                    ) : thumbnailUrl ? (
                      <Image
                        source={{ uri: thumbnailUrl }}
                        style={styles.streamImage}
                        contentFit="cover"
                        accessible
                        accessibilityLabel={`${feed.title ?? 'Stream'} media preview`}
                      />
                    ) : (
                      <LinearGradient colors={['#081127', '#0F1D3F']} style={styles.streamFallback}>
                        <Ionicons name="camera-outline" size={28} color={theme.colors.secondary} />
                        <Text style={styles.streamFallbackTitle}>Stream preview unavailable</Text>
                      </LinearGradient>
                    )}

                    {streamSource && !hasStreamLoaded && !streamError ? (
                      <View style={styles.streamLoadingOverlay} pointerEvents="none">
                        <ActivityIndicator color={theme.colors.secondary} />
                        <Text style={styles.streamLoadingText}>
                          {isStreamLoading ? 'Loading stream...' : 'Preparing player...'}
                        </Text>
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={styles.floatingBackButton}
                      accessibilityRole="button"
                      accessibilityLabel="Back to stream selection"
                      onPress={() => router.back()}
                    >
                      <Ionicons name="arrow-back" size={18} color={theme.colors.text.primary} />
                    </TouchableOpacity>
                  </View>
                </LinearGradient>

                <View style={[styles.chatPanel, useLandscapeLayout ? styles.chatPanelLandscape : styles.chatPanelPortrait]}>
                  <View style={styles.railHeader}>
                    <Text style={styles.chatTitle}>Markets</Text>
                    {isProsumer ? (
                      <TouchableOpacity
                        style={[styles.beltToggleButton, prosumerPanelOpen && styles.beltToggleButtonActive]}
                        accessibilityRole="button"
                        accessibilityLabel={prosumerPanelOpen ? 'Hide heart-rate belt controls' : 'Show heart-rate belt controls'}
                        onPress={() => setProsumerPanelOpen((current) => !current)}
                      >
                        <Ionicons
                          name={prosumerPanelOpen ? 'close' : 'pulse'}
                          size={16}
                          color={prosumerPanelOpen ? '#04111E' : theme.colors.text.primary}
                        />
                        <Text style={[styles.beltToggleButtonText, prosumerPanelOpen && styles.beltToggleButtonTextActive]}>
                          {prosumerHeartRate.latestBpm ? `${prosumerHeartRate.latestBpm} BPM` : 'Belt'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {prosumerPanelOpen && isProsumer ? (
                    <View style={styles.prosumerSheet}>
                      <View style={styles.prosumerCard}>
                        <View style={styles.prosumerTopRow}>
                          <View>
                            <Text style={styles.prosumerEyebrow}>Prosumer ingest</Text>
                            <Text style={styles.prosumerValue}>
                              {prosumerHeartRate.latestBpm ? `${prosumerHeartRate.latestBpm} BPM` : 'No live data yet'}
                            </Text>
                          </View>
                          <View style={styles.prosumerBadge}>
                            <Text style={styles.prosumerBadgeText}>
                              {prosumerHeartRate.isStreaming
                                ? 'Streaming'
                                : prosumerHeartRate.connectedDevice
                                  ? 'Connected'
                                  : 'Idle'}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.prosumerMeta}>
                          {prosumerHeartRate.connectedDevice
                            ? `${prosumerHeartRate.connectedDevice.name} • ${prosumerHeartRate.sampleCount} samples`
                            : 'Connect a heart-rate belt to publish deterministic telemetry for this stream.'}
                        </Text>

                        <View style={styles.prosumerActions}>
                          {prosumerHeartRate.isStreaming ? (
                            <TouchableOpacity style={styles.prosumerSecondaryButton} onPress={() => void prosumerHeartRate.disconnect()}>
                              <Text style={styles.prosumerSecondaryButtonText}>Disconnect belt</Text>
                            </TouchableOpacity>
                          ) : prosumerHeartRate.isScanning ? (
                            <TouchableOpacity style={styles.prosumerSecondaryButton} onPress={prosumerHeartRate.stopScan}>
                              <Text style={styles.prosumerSecondaryButtonText}>Stop scan</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity style={styles.prosumerPrimaryButton} onPress={() => void prosumerHeartRate.startScan()}>
                              <Text style={styles.prosumerPrimaryButtonText}>Scan for belts</Text>
                            </TouchableOpacity>
                          )}
                        </View>

                        {prosumerHeartRate.devices.length > 0 ? (
                          <View style={styles.deviceList}>
                            {prosumerHeartRate.devices.map((device) => (
                              <TouchableOpacity
                                key={device.id}
                                style={styles.deviceButton}
                                disabled={prosumerHeartRate.isConnecting}
                                onPress={() => void prosumerHeartRate.connect(device)}
                              >
                                <Text style={styles.deviceButtonTitle} numberOfLines={1}>
                                  {device.name}
                                </Text>
                                <Text style={styles.deviceButtonMeta} numberOfLines={1}>
                                  {device.id}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        ) : null}

                        {prosumerHeartRate.flushError ? (
                          <Text style={styles.prosumerError}>{prosumerHeartRate.flushError}</Text>
                        ) : null}
                      </View>
                    </View>
                  ) : (
                    <ScrollView
                      style={styles.chatScrollArea}
                      contentContainerStyle={styles.chatScrollContent}
                      showsVerticalScrollIndicator={false}
                    >
                      {scopedMarkets.length > 0 ? (
                        <View style={styles.chatList}>
                          {scopedMarkets.map((market, index) => {
                            const pools = getPoolTotals(positionsQueries[index]?.data ?? [])
                            const odds = getImpliedOdds(pools.yes, pools.no)
                            const resolution = resolutionQueries.find((query) => query.data?.market_id === market.id)?.data
                            const isExpanded = pinnedMarketId === market.id

                            return (
                              <View
                                key={market.id}
                                style={[styles.chatItem, isExpanded && styles.chatItemExpanded]}
                              >
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} market ${market.title}`}
                                  onPress={() => setExpandedMarketId(isExpanded ? null : market.id)}
                                  activeOpacity={0.92}
                                >
                                  <View style={styles.chatRowTop}>
                                    <View style={styles.chatAvatar}>
                                      <Ionicons name="pulse" size={16} color={theme.colors.secondary} />
                                    </View>
                                    <View style={styles.chatLineCopy}>
                                      <Text style={styles.chatLineTitle} numberOfLines={1}>
                                        {market.title}
                                      </Text>
                                      <Text style={styles.chatLineMeta} numberOfLines={1}>
                                        {market.status.toUpperCase()} • YES {formatSolFromLamports(pools.yes)} • NO {formatSolFromLamports(pools.no)}
                                      </Text>
                                    </View>
                                    <Text style={styles.chatTimestamp}>{formatCountdown(market.prediction_cutoff)}</Text>
                                  </View>
                                </TouchableOpacity>

                                {isExpanded ? (
                                  <View style={styles.expandedMarket}>
                                    <Text style={styles.expandedRule}>{formatRule(market.structured_rule)}</Text>

                                    <View style={styles.expandedStatsRow}>
                                      <View style={styles.expandedStatBlock}>
                                        <Text style={styles.expandedStatLabel}>YES POOL</Text>
                                        <Text style={styles.expandedStatYes}>
                                          {formatSolFromLamports(pools.yes)} SOL
                                        </Text>
                                      </View>
                                      <View style={styles.expandedStatBlock}>
                                        <Text style={styles.expandedStatLabel}>NO POOL</Text>
                                        <Text style={styles.expandedStatNo}>
                                          {formatSolFromLamports(pools.no)} SOL
                                        </Text>
                                      </View>
                                    </View>

                                    <View style={styles.expandedActions}>
                                      <TouchableOpacity
                                        style={styles.predictYesButton}
                                        disabled={pendingMarketId === market.id}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Predict yes on ${market.title}`}
                                        onPress={() => handlePrediction(market.id, 'YES', market.onchain_market_id)}
                                      >
                                        <Text style={styles.predictButtonText}>
                                          {pendingMarketId === market.id ? 'Submitting...' : 'Predict YES'}
                                        </Text>
                                        <Text style={styles.predictButtonMeta}>@ {odds.yes}</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        style={styles.predictNoButton}
                                        disabled={pendingMarketId === market.id}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Predict no on ${market.title}`}
                                        onPress={() => handlePrediction(market.id, 'NO', market.onchain_market_id)}
                                      >
                                        <Text style={styles.predictButtonText}>
                                          {pendingMarketId === market.id ? 'Submitting...' : 'Predict NO'}
                                        </Text>
                                        <Text style={styles.predictButtonMeta}>@ {odds.no}</Text>
                                      </TouchableOpacity>
                                    </View>

                                    {resolution ? (
                                      <View style={styles.resolutionBanner}>
                                        <Text style={styles.resolutionBannerTitle}>Resolved {resolution.outcome}</Text>
                                        <Text style={styles.resolutionBannerBody} numberOfLines={3}>
                                          {resolution.reasoning_summary}
                                        </Text>
                                      </View>
                                    ) : null}

                                    <View style={styles.expandedFooter}>
                                      <TouchableOpacity
                                        style={styles.detailButton}
                                        onPress={() => router.push(`/market/${market.id}`)}
                                      >
                                        <Text style={styles.detailButtonText}>Full Market</Text>
                                      </TouchableOpacity>
                                    </View>
                                  </View>
                                ) : null}
                              </View>
                            )
                          })}
                        </View>
                      ) : (
                        <View style={styles.emptyChatCard}>
                          <Text style={styles.emptyChatTitle}>No markets</Text>
                        </View>
                      )}
                    </ScrollView>
                  )}

                  <TouchableOpacity
                    style={styles.createMarketButton}
                    onPress={() => setMarketOverlayOpen(true)}
                  >
                    <Ionicons name="add" size={18} color={theme.colors.text.primary} />
                    <Text style={styles.createMarketButtonText}>Create</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Modal
                visible={marketOverlayOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setMarketOverlayOpen(false)}
              >
                <View style={styles.marketOverlayBackdrop}>
                  <Pressable style={styles.marketOverlayScrim} onPress={() => setMarketOverlayOpen(false)} />
                  <View style={styles.marketOverlaySheet}>
                    <View style={styles.marketOverlayHeader}>
                      <View>
                        <Text style={styles.marketOverlayEyebrow}>Live Market</Text>
                        <Text style={styles.marketOverlayTitle}>
                          {formatOperatorLabel(marketAboveThreshold)} {marketThreshold} BPM for {marketDuration}s
                        </Text>
                      </View>
                      <TouchableOpacity style={styles.marketOverlayClose} onPress={() => setMarketOverlayOpen(false)}>
                        <Ionicons name="close" size={18} color={theme.colors.text.primary} />
                      </TouchableOpacity>
                    </View>

                    <SliderField
                      label="BPM"
                      value={marketThreshold}
                      min={BPM_MIN}
                      max={BPM_MAX}
                      step={BPM_STEP}
                      suffix=""
                      onChange={setMarketThreshold}
                    />

                    <SliderField
                      label="Duration"
                      value={marketDuration}
                      min={DURATION_MIN}
                      max={DURATION_MAX}
                      step={DURATION_STEP}
                      suffix="s"
                      onChange={setMarketDuration}
                    />

                    <View style={styles.overlaySwitchRow}>
                      <View>
                        <Text style={styles.sliderLabel}>Threshold mode</Text>
                        <Text style={styles.overlaySwitchValue}>{formatOperatorLabel(marketAboveThreshold)}</Text>
                      </View>
                      <View style={styles.operatorSegmented}>
                        <TouchableOpacity
                          style={[styles.operatorSegment, marketAboveThreshold && styles.operatorSegmentActive]}
                          onPress={() => setMarketAboveThreshold(true)}
                        >
                          <Text style={[styles.operatorSegmentText, marketAboveThreshold && styles.operatorSegmentTextActive]}>
                            Above
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.operatorSegment, !marketAboveThreshold && styles.operatorSegmentActive]}
                          onPress={() => setMarketAboveThreshold(false)}
                        >
                          <Text style={[styles.operatorSegmentText, !marketAboveThreshold && styles.operatorSegmentTextActive]}>
                            Below
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <Text style={styles.marketOverlayPreview}>
                      The settlement window starts immediately and resolves from live stream telemetry tied to this session.
                    </Text>

                    <TouchableOpacity
                      style={[styles.marketOverlayCreateButton, marketCreatePending && styles.disabledButton]}
                      disabled={marketCreatePending}
                      onPress={() => void handleCreateInlineMarket()}
                    >
                      <Text style={styles.marketOverlayCreateText}>
                        {marketCreatePending ? 'Creating...' : 'Create Live Market'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            </View>
          ) : (
            <View style={styles.centered}>
              <Text style={styles.errorText}>Feed not found.</Text>
            </View>
          )}
        </SafeAreaView>
      </LinearGradient>
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  loadingText: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: theme.fontSize.md,
  },
  page: {
    flex: 1,
    padding: 0,
  },
  disabledButton: {
    opacity: 0.55,
  },
  createMarketButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary,
  },
  createMarketButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '800',
  },
  mainLayout: {
    flex: 1,
    gap: 0,
  },
  mainLayoutLandscape: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  mainLayoutPortrait: {
    flexDirection: 'column',
  },
  streamPanel: {
    borderRadius: 0,
    overflow: 'hidden',
  },
  streamPanelLandscape: {
    width: '60%',
    minWidth: 0,
    minHeight: 360,
  },
  streamPanelPortrait: {
    width: '100%',
    minHeight: 240,
  },
  streamMediaFrame: {
    width: '100%',
    backgroundColor: '#091126',
    position: 'relative',
    overflow: 'hidden',
  },
  streamMediaFrameLandscape: {
    flex: 1,
    minHeight: 360,
  },
  streamMediaFramePortrait: {
    aspectRatio: 16 / 9,
    minHeight: 220,
  },
  floatingBackButton: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 10, 20, 0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  streamImage: {
    width: '100%',
    height: '100%',
  },
  streamWebView: {
    flex: 1,
    backgroundColor: '#091126',
  },
  streamFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
  },
  streamFallbackTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.lg,
    fontWeight: '800',
  },
  streamLoadingOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    backgroundColor: 'rgba(9, 17, 38, 0.58)',
  },
  streamLoadingText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  chatPanel: {
    flex: 1,
    borderRadius: 0,
    backgroundColor: 'rgba(8, 12, 24, 0.92)',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.md,
  },
  chatPanelLandscape: {
    width: '40%',
    minWidth: 0,
    flex: 1,
  },
  chatPanelPortrait: {
    flex: 1,
  },
  prosumerSheet: {
    flex: 1,
    minHeight: 0,
  },
  railHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  chatScrollArea: {
    flex: 1,
    minHeight: 0,
  },
  chatScrollContent: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  chatTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.lg,
    fontWeight: '800',
  },
  beltToggleButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  beltToggleButtonActive: {
    backgroundColor: theme.colors.secondary,
    borderColor: theme.colors.secondary,
  },
  beltToggleButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.xs,
    fontWeight: '800',
  },
  beltToggleButtonTextActive: {
    color: '#04111E',
  },
  prosumerCard: {
    flex: 1,
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  prosumerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  prosumerEyebrow: {
    color: theme.colors.text.tertiary,
    fontSize: theme.fontSize.xs,
    textTransform: 'uppercase',
  },
  prosumerValue: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.lg,
    fontWeight: '800',
    marginTop: 4,
  },
  prosumerBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(45, 230, 192, 0.12)',
  },
  prosumerBadgeText: {
    color: theme.colors.tertiary,
    fontSize: theme.fontSize.xs,
    fontWeight: '800',
  },
  prosumerMeta: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  prosumerActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  prosumerPrimaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.secondary,
  },
  prosumerPrimaryButtonText: {
    color: '#04111E',
    fontSize: theme.fontSize.sm,
    fontWeight: '800',
  },
  prosumerSecondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  prosumerSecondaryButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  deviceList: {
    gap: theme.spacing.xs,
  },
  deviceButton: {
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  deviceButtonTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  deviceButtonMeta: {
    color: theme.colors.text.tertiary,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
  },
  prosumerError: {
    color: theme.colors.danger,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  chatList: {
    gap: theme.spacing.sm,
  },
  chatItem: {
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  chatItemExpanded: {
    backgroundColor: 'rgba(124, 77, 255, 0.08)',
    borderColor: 'rgba(167, 139, 250, 0.22)',
  },
  chatRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  chatAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(31, 214, 255, 0.12)',
  },
  chatLineCopy: {
    flex: 1,
    gap: 2,
  },
  chatLineTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  chatLineMeta: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.xs,
  },
  chatTimestamp: {
    color: theme.colors.text.tertiary,
    fontSize: theme.fontSize.xs,
  },
  expandedMarket: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  expandedRule: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  expandedStatsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  expandedStatBlock: {
    flex: 1,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  expandedStatLabel: {
    color: theme.colors.text.tertiary,
    fontSize: theme.fontSize.xs,
    textTransform: 'uppercase',
  },
  expandedStatYes: {
    marginTop: theme.spacing.xs,
    color: theme.colors.tertiary,
    fontSize: theme.fontSize.lg,
    fontWeight: '800',
  },
  expandedStatNo: {
    marginTop: theme.spacing.xs,
    color: '#FF76AF',
    fontSize: theme.fontSize.lg,
    fontWeight: '800',
  },
  expandedActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  predictYesButton: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.yes,
  },
  predictNoButton: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.lg,
    backgroundColor: '#F1488B',
  },
  predictButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '800',
  },
  predictButtonMeta: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
  },
  resolutionBanner: {
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: 'rgba(45, 230, 192, 0.12)',
  },
  resolutionBannerTitle: {
    color: theme.colors.tertiary,
    fontSize: theme.fontSize.sm,
    fontWeight: '800',
  },
  resolutionBannerBody: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  expandedFooter: {
    alignItems: 'flex-start',
  },
  detailButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  detailButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  emptyChatCard: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  emptyChatTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.md,
    fontWeight: '700',
  },
  marketOverlayBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.md,
    backgroundColor: 'rgba(2, 6, 15, 0.18)',
  },
  marketOverlayScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  marketOverlaySheet: {
    alignSelf: 'center',
    width: '92%',
    maxWidth: 420,
    borderRadius: 20,
    backgroundColor: 'rgba(8, 12, 24, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(120, 138, 175, 0.18)',
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  marketOverlayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  marketOverlayEyebrow: {
    color: theme.colors.text.tertiary,
    fontSize: theme.fontSize.xs,
    textTransform: 'uppercase',
  },
  marketOverlayTitle: {
    marginTop: 4,
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.md,
    fontWeight: '800',
  },
  marketOverlayClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sliderField: {
    gap: theme.spacing.sm,
  },
  sliderFieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  sliderLabel: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  sliderValue: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.md,
    fontWeight: '800',
  },
  sliderTrack: {
    height: 22,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    overflow: 'visible',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
  },
  sliderThumb: {
    position: 'absolute',
    top: '50%',
    marginTop: -12,
    marginLeft: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F8FBFF',
    borderWidth: 3,
    borderColor: theme.colors.secondary,
  },
  sliderStepRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
  },
  sliderAdjustButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  overlaySwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  overlaySwitchValue: {
    marginTop: 4,
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.md,
    fontWeight: '800',
  },
  operatorSegmented: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: 4,
    gap: 4,
  },
  operatorSegment: {
    minHeight: 38,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  operatorSegmentActive: {
    backgroundColor: theme.colors.secondary,
  },
  operatorSegmentText: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
    fontWeight: '800',
  },
  operatorSegmentTextActive: {
    color: '#04111E',
  },
  marketOverlayPreview: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  marketOverlayCreateButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary,
  },
  marketOverlayCreateText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.md,
    fontWeight: '800',
  },
})
