import React, { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useQueries } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { theme } from '@/constants/theme'
import { getFeedSessions } from '@/features/markets/markets.api'
import { getSessionThumbnailUrl } from '@/features/markets/feed-media'
import { useFeeds } from '@/features/markets/use-feeds'
import { useAccountGetBalance } from '@/features/account/use-account-get-balance'
import { lamportsToSol } from '@/utils/lamports-to-sol'
import { useRequestDevnetAirdrop } from '@/features/markets/use-market'

export default function HomeScreen() {
  const { width } = useWindowDimensions()
  const { account, connect } = useMobileWallet()
  const [isAccountOpen, setIsAccountOpen] = useState(false)
  const balanceQuery = useAccountGetBalance({ address: account?.address })
  const airdropMutation = useRequestDevnetAirdrop()
  const feedsQuery = useFeeds()

  const feeds = feedsQuery.data ?? []
  const columns = width >= 1180 ? 3 : 2
  const contentWidth = width - theme.spacing.md * 2
  const cardWidth = (contentWidth - theme.spacing.md * (columns - 1)) / columns
  const balanceLamports = account ? (balanceQuery.data?.value ?? 0n) : 0n
  const shouldShowAirdrop = Boolean(account) && balanceLamports < 500_000_000n

  const feedSessionsQueries = useQueries({
    queries: feeds.map((feed) => ({
      queryKey: ['feeds', feed.id, 'sessions', 'all'],
      queryFn: () => getFeedSessions(feed.id),
      enabled: Boolean(feed.id),
      refetchInterval: 10_000,
    })),
  })

  const feedCards = feeds.map((feed, index) => {
    const sessions = feedSessionsQueries[index]?.data ?? []
    const currentSession =
      sessions.find((session) => session.status === 'live') ??
      sessions.find((session) => session.status === 'planned') ??
      sessions[0]
    const thumbnailUrl = getSessionThumbnailUrl(currentSession)

    return {
      feed,
      currentSession,
      thumbnailUrl,
    }
  })

  async function handleAirdrop() {
    if (!account) {
      return
    }

    try {
      await airdropMutation.mutateAsync(account.address)
      await balanceQuery.refetch()
    } catch (error) {
      Alert.alert('Airdrop failed', error instanceof Error ? error.message : 'Unable to request devnet SOL.')
    }
  }

  function handleCopyWalletAddress() {
    if (!account) {
      return
    }

    Clipboard.setString(account.address)
    Alert.alert('Address copied', account.address)
  }

  function handleStartStream() {
    if (!account) {
      Alert.alert('Wallet required')
      return
    }

    router.push('/create-stream')
  }

  return (
    <LinearGradient colors={theme.gradients.hero} style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <View style={styles.logoMark}>
              <Ionicons name="flash" size={18} color={theme.colors.secondary} />
            </View>
            <View style={styles.brandCopy}>
              <Text style={styles.brandTitle}>Odds On</Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            {account ? (
              <TouchableOpacity
                style={styles.accountButton}
                accessibilityRole="button"
                accessibilityLabel="Toggle my account"
                onPress={() => setIsAccountOpen((current) => !current)}
              >
                <Text style={styles.accountButtonText}>My Account</Text>
                <Ionicons
                  name={isAccountOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={theme.colors.text.primary}
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.connectButton} onPress={connect}>
                <Text style={styles.connectButtonText}>Connect Wallet</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {account && isAccountOpen ? (
            <View style={styles.walletPanel}>
              <View style={styles.walletColumn}>
                <Text style={styles.panelLabel}>Wallet</Text>
                <View style={styles.walletAddressRow}>
                  <Text style={styles.walletAddress}>{account.address}</Text>
                  <TouchableOpacity
                    style={styles.walletCopyButton}
                    accessibilityRole="button"
                    accessibilityLabel="Copy wallet address"
                    onPress={handleCopyWalletAddress}
                  >
                    <Ionicons name="copy-outline" size={16} color={theme.colors.text.primary} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.balanceValue}>
                  {balanceQuery.isLoading ? 'Loading...' : `${lamportsToSol(balanceLamports)} SOL`}
                </Text>
              </View>

              <View style={styles.walletActions}>
                {shouldShowAirdrop ? (
                  <TouchableOpacity
                    style={[styles.primaryButton, airdropMutation.isPending && styles.disabledButton]}
                    disabled={airdropMutation.isPending}
                    onPress={handleAirdrop}
                  >
                    <Text style={styles.primaryButtonText}>
                      {airdropMutation.isPending ? 'Funding...' : 'Fund Wallet'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.fundedBadge}>
                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.tertiary} />
                    <Text style={styles.fundedBadgeText}>Funded</Text>
                  </View>
                )}
              </View>
            </View>
          ) : null}

          <View style={styles.sectionHeader}>
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Streams</Text>
            </View>
            {account ? (
              <TouchableOpacity style={styles.headerGhostButton} onPress={handleStartStream}>
                <Ionicons name="radio" size={16} color={theme.colors.text.primary} />
                <Text style={styles.headerGhostButtonText}>Start Stream</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {feedsQuery.isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={theme.colors.secondary} />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : feedsQuery.isError ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Backend unavailable</Text>
            </View>
          ) : feedCards.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No streams</Text>
              {account ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleStartStream}
                >
                  <Text style={styles.primaryButtonText}>Create First Stream</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <View style={styles.grid}>
              {feedCards.map(({ feed, currentSession, thumbnailUrl }) => (
                <TouchableOpacity
                  key={feed.id}
                  style={[styles.feedCard, { width: cardWidth }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open stream ${feed.title ?? 'Untitled feed'}`}
                  onPress={() =>
                    router.push(currentSession ? `/feed/${feed.id}?sessionId=${currentSession.id}` : `/feed/${feed.id}`)
                  }
                >
                  <LinearGradient colors={theme.gradients.card} style={styles.feedCardGradient}>
                    <View style={styles.feedThumbFrame}>
                      {thumbnailUrl ? (
                        <Image
                          source={{ uri: thumbnailUrl }}
                          style={styles.feedThumbImage}
                          contentFit="cover"
                          accessible
                          accessibilityLabel={`${feed.title ?? 'Stream'} thumbnail`}
                        />
                      ) : (
                        <LinearGradient colors={['#0B1430', '#122347']} style={styles.feedThumbFallback}>
                          <Ionicons name="videocam-outline" size={24} color={theme.colors.secondary} />
                          <Text style={styles.feedThumbFallbackTitle}>No thumbnail</Text>
                        </LinearGradient>
                      )}

                      <View style={styles.thumbBadgeRow}>
                        <Text style={styles.thumbnailTitle}>{feed.title ?? 'Untitled stream'}</Text>
                      </View>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  brandBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  brandCopy: { flexShrink: 1 },
  logoMark: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(31, 214, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(31, 214, 255, 0.35)',
  },
  brandTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.xl,
    fontWeight: '800',
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: theme.spacing.sm,
  },
  accountButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 77, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.35)',
  },
  accountButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  headerGhostButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  headerGhostButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  walletCopyButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  connectButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
  },
  connectButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  walletPanel: {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: 'rgba(9, 14, 28, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(120, 138, 175, 0.18)',
  },
  walletColumn: {
    gap: theme.spacing.xs,
  },
  walletAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  panelLabel: {
    color: theme.colors.text.tertiary,
    fontSize: theme.fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  walletAddress: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
  },
  balanceValue: {
    color: theme.colors.secondary,
    fontSize: theme.fontSize.xxl,
    fontWeight: '800',
  },
  walletActions: {
    alignItems: 'flex-start',
  },
  primaryButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary,
  },
  primaryButtonText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '800',
  },
  fundedBadge: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 999,
    backgroundColor: 'rgba(45, 230, 192, 0.12)',
  },
  fundedBadgeText: {
    color: theme.colors.tertiary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  sectionCopy: {
    flex: 1,
  },
  sectionTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.xl,
    fontWeight: '800',
  },
  loadingCard: {
    gap: theme.spacing.sm,
    alignItems: 'center',
    padding: theme.spacing.xl,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: 'rgba(9, 14, 28, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(120, 138, 175, 0.18)',
  },
  loadingText: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
  },
  emptyCard: {
    gap: theme.spacing.sm,
    padding: theme.spacing.xl,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: 'rgba(9, 14, 28, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(120, 138, 175, 0.18)',
  },
  emptyTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
    justifyContent: 'space-between',
  },
  feedCard: {
    width: '100%',
    borderRadius: theme.borderRadius.xl,
    overflow: 'hidden',
  },
  feedCardGradient: {
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: 'rgba(120, 138, 175, 0.18)',
    overflow: 'hidden',
  },
  feedThumbFrame: {
    position: 'relative',
    aspectRatio: 1,
    backgroundColor: '#0B1430',
  },
  feedThumbImage: {
    width: '100%',
    height: '100%',
  },
  feedThumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg,
  },
  feedThumbFallbackTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.md,
    fontWeight: '700',
  },
  thumbBadgeRow: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
  },
  thumbnailTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.lg,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 0, 0, 0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 48, 79, 0.16)',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.live,
  },
  liveBadgeText: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.xs,
    fontWeight: '800',
  },
  feedCardBody: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  feedCardTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.xl,
    fontWeight: '800',
  },
  feedCardSubtitle: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
  },
  feedMetricsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  feedMetric: {
    flex: 1,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  feedMetricValue: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.lg,
    fontWeight: '800',
  },
  feedMetricLabel: {
    color: theme.colors.text.tertiary,
    fontSize: theme.fontSize.xs,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  feedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  feedFooterCopy: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  feedFooterTitle: {
    color: theme.colors.text.primary,
    fontSize: theme.fontSize.md,
    fontWeight: '700',
  },
  feedFooterSubtitle: {
    color: theme.colors.text.secondary,
    fontSize: theme.fontSize.sm,
  },
  disabledButton: {
    opacity: 0.6,
  },
})
