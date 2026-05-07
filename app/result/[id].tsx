import React from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { theme } from '@/constants/theme'
import { summarizeReadings } from '@/features/markets/markets.demo'
import { useMarket, useMarketAgentRuns, useMarketReadings, useMarketResolution, useSyncMarket } from '@/features/markets/use-market'
import { useProgramClient } from '@/features/program/program-client'

export default function ResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const marketId = id ?? ''
  const programClient = useProgramClient()
  const marketQuery = useMarket(marketId)
  const resolutionQuery = useMarketResolution(marketId)
  const readingsQuery = useMarketReadings(marketId)
  const agentRunsQuery = useMarketAgentRuns(marketId)
  const syncMarketMutation = useSyncMarket(marketId)

  const market = marketQuery.data
  const resolution = resolutionQuery.data
  const readingSummary = summarizeReadings(readingsQuery.data ?? [])
  const latestAgentRun = agentRunsQuery.data?.[0]

  async function handleClaim() {
    if (!market?.onchain_market_id) {
      Alert.alert('On-chain market missing')
      return
    }

    try {
      await programClient.claimPayout(BigInt(market.onchain_market_id))
      await syncMarketMutation.mutateAsync()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Claim failed.'
      Alert.alert('Claim failed', message)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Result', headerTintColor: '#FFFFFF', headerStyle: { backgroundColor: theme.colors.background } }} />
      <SafeAreaView style={styles.safeArea}>
        {marketQuery.isLoading || resolutionQuery.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : market && resolution ? (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.resultHero}>
              <Text style={styles.outcomeLabel}>Outcome</Text>
              <Text style={styles.outcomeValue}>{resolution.outcome}</Text>
              <Text style={styles.reasoning}>{resolution.reasoning_summary}</Text>
            </View>

            <View style={styles.metricsCard}>
              <Text style={styles.sectionTitle}>Evidence Summary</Text>
              <Text style={styles.metricText}>Baseline BPM: {readingSummary.baselineBpm}</Text>
              <Text style={styles.metricText}>Peak BPM: {readingSummary.peakBpm}</Text>
              <Text style={styles.metricText}>Confidence: {resolution.confidence ?? 0}</Text>
              <Text style={styles.metricText}>Evidence Hash: {resolution.evidence_hash?.slice(0, 18)}...</Text>
              <Text style={styles.metricText}>Resolution Hash: {resolution.resolution_hash?.slice(0, 18)}...</Text>
            </View>

            <View style={styles.metricsCard}>
              <Text style={styles.sectionTitle}>Settlement State</Text>
              <Text style={styles.metricText}>Settlement tx: {resolution.settlement_tx ?? 'pending'}</Text>
              <TouchableOpacity style={styles.claimButton} onPress={handleClaim}>
                <Text style={styles.claimButtonText}>Claim Payout</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace(`/market/${marketId}`)}>
                <Text style={styles.primaryButtonText}>Back to Market</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : market && latestAgentRun && ['queued', 'running'].includes(latestAgentRun.status) ? (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.resultHero}>
              <Text style={styles.outcomeLabel}>Settlement In Progress</Text>
              <Text style={styles.outcomeValuePending}>{latestAgentRun.status.toUpperCase()}</Text>
              <Text style={styles.reasoning}>
                {latestAgentRun.stage
                  ? latestAgentRun.stage
                  : 'Running'}
              </Text>
            </View>

            <View style={styles.metricsCard}>
              <Text style={styles.sectionTitle}>Agent Run</Text>
              <Text style={styles.metricText}>Run ID: {latestAgentRun.id}</Text>
              <Text style={styles.metricText}>Status: {latestAgentRun.status}</Text>
              <Text style={styles.metricText}>Stage: {latestAgentRun.stage ?? 'unknown'}</Text>
            </View>
          </ScrollView>
        ) : market && latestAgentRun?.status === 'failed' ? (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.resultHero}>
              <Text style={styles.outcomeLabel}>Settlement Failed</Text>
              <Text style={styles.outcomeValueError}>FAILED</Text>
              <Text style={styles.reasoning}>{latestAgentRun.error_message ?? 'Unknown resolver error.'}</Text>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.centered}>
            <Text style={styles.errorText}>Resolution not available yet.</Text>
          </View>
        )}
      </SafeAreaView>
    </>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.spacing.md, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  resultHero: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    alignItems: 'center',
  },
  outcomeLabel: { color: theme.colors.text.tertiary, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.xs },
  outcomeValue: { color: theme.colors.success, fontSize: theme.fontSize.xxl, fontWeight: '700', marginBottom: theme.spacing.sm },
  outcomeValuePending: { color: theme.colors.primary, fontSize: theme.fontSize.xxl, fontWeight: '700', marginBottom: theme.spacing.sm },
  outcomeValueError: { color: theme.colors.danger, fontSize: theme.fontSize.xxl, fontWeight: '700', marginBottom: theme.spacing.sm },
  reasoning: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm, textAlign: 'center', lineHeight: 20 },
  metricsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    gap: theme.spacing.sm,
  },
  sectionTitle: { color: theme.colors.text.primary, fontSize: theme.fontSize.lg, fontWeight: '600' },
  metricText: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm, lineHeight: 20 },
  claimButton: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.yes,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  claimButtonText: { color: theme.colors.text.primary, fontSize: theme.fontSize.md, fontWeight: '700' },
  primaryButton: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: theme.colors.text.primary, fontSize: theme.fontSize.md, fontWeight: '700' },
  errorText: { color: theme.colors.danger, fontSize: theme.fontSize.md },
})
