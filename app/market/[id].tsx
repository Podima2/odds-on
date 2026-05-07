import React from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { theme } from '@/constants/theme'
import {
  formatCountdown,
  formatRule,
  formatSolFromLamports,
  getImpliedOdds,
  getPoolTotals,
} from '@/features/markets/markets.format'
import {
  useMarket,
  useMarketAgentRuns,
  useMarketEvidence,
  useMarketPositions,
  useMarketReadings,
  useMarketResolution,
  useSyncMarket,
} from '@/features/markets/use-market'
import { summarizeReadings } from '@/features/markets/markets.demo'
import { useProgramClient } from '@/features/program/program-client'

export default function MarketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const marketId = id ?? ''
  const { account } = useMobileWallet()
  const programClient = useProgramClient()
  const marketQuery = useMarket(marketId)
  const positionsQuery = useMarketPositions(marketId)
  const evidenceQuery = useMarketEvidence(marketId)
  const readingsQuery = useMarketReadings(marketId)
  const resolutionQuery = useMarketResolution(marketId)
  const agentRunsQuery = useMarketAgentRuns(marketId)
  const syncMarketMutation = useSyncMarket(marketId)

  const market = marketQuery.data
  const pools = getPoolTotals(positionsQuery.data ?? [])
  const odds = getImpliedOdds(pools.yes, pools.no)
  const evidenceCount = evidenceQuery.data?.length ?? 0
  const readingSummary = summarizeReadings(readingsQuery.data ?? [])
  const latestAgentRun = agentRunsQuery.data?.[0]

  async function handlePrediction(side: 'YES' | 'NO') {
    if (!account) {
      Alert.alert('Wallet required')
      return
    }
    if (!market?.onchain_market_id) {
      Alert.alert('On-chain market missing')
      return
    }

    try {
      await programClient.placePrediction(BigInt(market.onchain_market_id), side, BigInt(100_000_000))
      await syncMarketMutation.mutateAsync()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prediction failed.'
      Alert.alert('Prediction failed', message)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Market', headerTintColor: '#FFFFFF', headerStyle: { backgroundColor: theme.colors.background } }} />
      <SafeAreaView style={styles.safeArea}>
        {marketQuery.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : market ? (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.heroCard}>
              <Text style={styles.statusPill}>{market.status.toUpperCase()}</Text>
              <Text style={styles.title}>{market.title}</Text>
              <Text style={styles.subtitle}>{formatRule(market.structured_rule)}</Text>
              <Text style={styles.timer}>{formatCountdown(market.prediction_cutoff)}</Text>
              <Text style={styles.timer}>{market.onchain_market_id ?? 'Not linked'}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Liquidity</Text>
              <View style={styles.grid}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>YES Pool</Text>
                  <Text style={styles.metricValue}>{formatSolFromLamports(pools.yes)} SOL</Text>
                  <Text style={styles.metricSubvalue}>Odds {odds.yes}</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>NO Pool</Text>
                  <Text style={styles.metricValue}>{formatSolFromLamports(pools.no)} SOL</Text>
                  <Text style={styles.metricSubvalue}>Odds {odds.no}</Text>
                </View>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.yesButton} onPress={() => handlePrediction('YES')}>
                  <Text style={styles.actionText}>Predict YES</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.noButton} onPress={() => handlePrediction('NO')}>
                  <Text style={styles.actionText}>Predict NO</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Evidence State</Text>
              <View style={styles.infoCard}>
                <Text style={styles.infoText}>Submissions: {evidenceCount}</Text>
                <Text style={styles.infoText}>Readings: {readingSummary.readingCount}</Text>
                <Text style={styles.infoText}>Baseline: {readingSummary.baselineBpm} BPM</Text>
                <Text style={styles.infoText}>Peak: {readingSummary.peakBpm} BPM</Text>
              </View>
            </View>

            {resolutionQuery.data ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Resolution</Text>
                <View style={styles.resolutionCard}>
                  <Text style={styles.resolutionOutcome}>Outcome {resolutionQuery.data.outcome}</Text>
                  <Text style={styles.resolutionReason}>{resolutionQuery.data.reasoning_summary}</Text>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => router.push(`/result/${marketId}`)}
                  >
                    <Text style={styles.primaryButtonText}>View Result</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Pending</Text>
                <View style={styles.infoCard}>
                  {latestAgentRun ? (
                    <Text style={styles.infoText}>
                      {latestAgentRun.status.toUpperCase()}
                      {latestAgentRun.stage ? ` • ${latestAgentRun.stage}` : ''}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => router.push(`/challenge/${marketId}`)}
                  >
                    <Text style={styles.primaryButtonText}>Open Challenge Flow</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={styles.centered}>
            <Text style={styles.errorText}>Market not found.</Text>
          </View>
        )}
      </SafeAreaView>
    </>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  loadingText: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm },
  errorText: { color: theme.colors.danger, fontSize: theme.fontSize.md },
  content: { padding: theme.spacing.md, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  heroCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  statusPill: {
    alignSelf: 'flex-start',
    color: theme.colors.primary,
    fontSize: theme.fontSize.xs,
    fontWeight: '700',
    marginBottom: theme.spacing.sm,
  },
  title: { color: theme.colors.text.primary, fontSize: theme.fontSize.xl, fontWeight: '700', marginBottom: theme.spacing.xs },
  subtitle: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.sm },
  timer: { color: theme.colors.text.tertiary, fontSize: theme.fontSize.sm },
  section: { gap: theme.spacing.sm },
  sectionTitle: { color: theme.colors.text.primary, fontSize: theme.fontSize.lg, fontWeight: '600' },
  grid: { flexDirection: 'row', gap: theme.spacing.sm },
  actionRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  metricCard: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  metricLabel: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.xs },
  metricValue: { color: theme.colors.text.primary, fontSize: theme.fontSize.lg, fontWeight: '700' },
  metricSubvalue: { color: theme.colors.text.tertiary, fontSize: theme.fontSize.sm, marginTop: theme.spacing.xs },
  yesButton: {
    flex: 1,
    backgroundColor: theme.colors.yes,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  noButton: {
    flex: 1,
    backgroundColor: theme.colors.no,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  actionText: { color: theme.colors.text.primary, fontSize: theme.fontSize.sm, fontWeight: '700' },
  infoCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    gap: theme.spacing.sm,
  },
  infoText: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm, lineHeight: 20 },
  resolutionCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    gap: theme.spacing.sm,
  },
  resolutionOutcome: { color: theme.colors.success, fontSize: theme.fontSize.md, fontWeight: '700' },
  resolutionReason: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm, lineHeight: 20 },
  primaryButton: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: theme.colors.text.primary, fontSize: theme.fontSize.md, fontWeight: '700' },
})
