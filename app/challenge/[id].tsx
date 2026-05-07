import React, { useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { theme } from '@/constants/theme'
import { buildDemoReadings } from '@/features/markets/markets.demo'
import { useMarket, useResolveMarket, useSubmitMarketEvidence } from '@/features/markets/use-market'

export default function ChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const marketId = id ?? ''
  const { account } = useMobileWallet()
  const marketQuery = useMarket(marketId)
  const submitEvidence = useSubmitMarketEvidence(marketId)
  const resolveMutation = useResolveMarket(marketId)
  const [submitted, setSubmitted] = useState(false)

  const market = marketQuery.data
  const demoReadings = useMemo(() => {
    if (!market) return []
    return buildDemoReadings(
      market.structured_rule.threshold,
      market.structured_rule.timeWindowSeconds
    )
  }, [market])

  async function handleSubmit() {
    if (!market || !account) return

    await submitEvidence.mutateAsync({
      evidenceType: market.evidence_type ?? 'heart_rate_demo_feed',
      source: 'demo_feed',
      submittedBy: account.address,
      readings: demoReadings,
    })
    setSubmitted(true)
  }

  async function handleResolve() {
    await resolveMutation.mutateAsync()
    router.replace(`/result/${marketId}`)
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Challenge', headerTintColor: '#FFFFFF', headerStyle: { backgroundColor: theme.colors.background } }} />
      <SafeAreaView style={styles.safeArea}>
        {marketQuery.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : market ? (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.heroCard}>
              <Text style={styles.title}>{market.title}</Text>
            </View>

            <View style={styles.timelineCard}>
              <Text style={styles.sectionTitle}>Captured Readings</Text>
              {demoReadings.map((reading) => (
                <View key={`${reading.t}-${reading.bpm}`} style={styles.readingRow}>
                  <Text style={styles.readingTime}>{reading.t}s</Text>
                  <View style={styles.readingBarTrack}>
                    <View
                      style={[
                        styles.readingBarFill,
                        {
                          width: `${Math.min(100, Math.max(18, (reading.bpm / (market.structured_rule.threshold + 20)) * 100))}%`,
                          backgroundColor:
                            reading.bpm > market.structured_rule.threshold
                              ? theme.colors.yes
                              : theme.colors.secondary,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.readingBpm}>{reading.bpm}</Text>
                </View>
              ))}
            </View>

            {!account ? (
              <View style={styles.noticeCard}>
                <Text style={styles.noticeText}>Wallet required</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryButton, (!account || submitEvidence.isPending) && styles.disabledButton]}
              disabled={!account || submitEvidence.isPending}
              onPress={handleSubmit}
            >
              <Text style={styles.primaryButtonText}>
                {submitEvidence.isPending ? 'Submitting Evidence...' : submitted ? 'Evidence Submitted' : 'Submit Demo Evidence'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, (!submitted || resolveMutation.isPending) && styles.disabledButton]}
              disabled={!submitted || resolveMutation.isPending}
              onPress={handleResolve}
            >
              <Text style={styles.secondaryButtonText}>
                {resolveMutation.isPending ? 'Resolving...' : 'Trigger Resolution'}
              </Text>
            </TouchableOpacity>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.spacing.md, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  heroCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  title: { color: theme.colors.text.primary, fontSize: theme.fontSize.xl, fontWeight: '700', marginBottom: theme.spacing.xs },
  timelineCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    gap: theme.spacing.sm,
  },
  sectionTitle: { color: theme.colors.text.primary, fontSize: theme.fontSize.lg, fontWeight: '600' },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  readingTime: { width: 34, color: theme.colors.text.tertiary, fontSize: theme.fontSize.xs },
  readingBarTrack: { flex: 1, height: 10, borderRadius: 999, backgroundColor: '#12131A', overflow: 'hidden' },
  readingBarFill: { height: '100%', borderRadius: 999 },
  readingBpm: { width: 40, textAlign: 'right', color: theme.colors.text.primary, fontSize: theme.fontSize.sm, fontWeight: '700' },
  noticeCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  noticeText: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: theme.colors.secondary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: theme.colors.text.primary, fontSize: theme.fontSize.md, fontWeight: '700' },
  secondaryButtonText: { color: theme.colors.background, fontSize: theme.fontSize.md, fontWeight: '700' },
  disabledButton: { opacity: 0.55 },
  errorText: { color: theme.colors.danger, fontSize: theme.fontSize.md },
})
