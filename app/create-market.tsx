import React, { useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { theme } from '@/constants/theme'
import { syncMarket } from '@/features/markets/markets.api'
import { useCreateMarket } from '@/features/markets/use-market'
import { useProgramClient } from '@/features/program/program-client'

export default function CreateMarketScreen() {
  const { feedId, sessionId } = useLocalSearchParams<{ feedId?: string; sessionId?: string }>()
  const { account } = useMobileWallet()
  const programClient = useProgramClient()
  const createMarketMutation = useCreateMarket()
  const [title, setTitle] = useState('Will I exceed 150 BPM in 90 seconds?')
  const [threshold, setThreshold] = useState('150')
  const [windowSeconds, setWindowSeconds] = useState('90')

  const schedule = useMemo(() => {
    const now = Date.now()
    const isLiveSessionMarket = Boolean(sessionId)
    const predictionLeadSeconds = isLiveSessionMarket ? 45 : 60 * 60
    const eventLeadSeconds = isLiveSessionMarket ? 60 : 70 * 60
    const eventDurationSeconds = isLiveSessionMarket ? Number.parseInt(windowSeconds, 10) || 90 : 90

    return {
      predictionCutoff: new Date(now + predictionLeadSeconds * 1000).toISOString(),
      eventStartTime: new Date(now + eventLeadSeconds * 1000).toISOString(),
      eventEndTime: new Date(now + (eventLeadSeconds + eventDurationSeconds) * 1000).toISOString(),
    }
  }, [sessionId, windowSeconds])

  async function handleCreate() {
    if (!account) {
      Alert.alert('Wallet required')
      return
    }

    const parsedThreshold = Number.parseInt(threshold, 10)
    const parsedWindow = Number.parseInt(windowSeconds, 10)

    if (!title.trim() || Number.isNaN(parsedThreshold) || Number.isNaN(parsedWindow)) {
      Alert.alert('Invalid form')
      return
    }

    let programResult

    try {
      programResult = await programClient.createMarket({
        title: title.trim(),
        threshold: parsedThreshold,
        timeWindowSeconds: parsedWindow,
        predictionCutoff: schedule.predictionCutoff,
        eventStartTime: schedule.eventStartTime,
        eventEndTime: schedule.eventEndTime,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create on-chain market.'
      Alert.alert('Create market failed', message)
      return
    }

    try {
      const market = await createMarketMutation.mutateAsync({
        onchainMarketId: Number(programResult.marketId),
        feedId,
        feedSessionId: sessionId,
        creatorWallet: account.address,
        title: title.trim(),
        structuredRule: {
          metric: 'heart_rate_bpm',
          operator: '>',
          threshold: parsedThreshold,
          timeWindowSeconds: parsedWindow,
        },
        status: 'open',
        predictionCutoff: schedule.predictionCutoff,
        eventStartTime: schedule.eventStartTime,
        eventEndTime: schedule.eventEndTime,
        evidenceType: 'heart_rate_live_session_audit',
        metadataHash: programResult.metadataHashHex,
      })

      await syncMarket(market.id)
      router.replace(`/market/${market.id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to persist market metadata.'
      Alert.alert('Backend sync failed', message)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Create Market', headerTintColor: '#FFFFFF', headerStyle: { backgroundColor: theme.colors.background } }} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroCard}>
            <Text style={styles.title}>New Market</Text>
            {feedId ? (
              <View style={styles.contextBadge}>
                <Text style={styles.contextBadgeText}>
                  {sessionId ? 'Session' : 'Feed'}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.formCard}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Will I exceed 150 BPM in 90 seconds?"
              placeholderTextColor={theme.colors.text.tertiary}
            />

            <Text style={styles.label}>Threshold BPM</Text>
            <TextInput
              style={styles.input}
              value={threshold}
              onChangeText={setThreshold}
              keyboardType="numeric"
              placeholder="150"
              placeholderTextColor={theme.colors.text.tertiary}
            />

            <Text style={styles.label}>Window Seconds</Text>
            <TextInput
              style={styles.input}
              value={windowSeconds}
              onChangeText={setWindowSeconds}
              keyboardType="numeric"
              placeholder="90"
              placeholderTextColor={theme.colors.text.tertiary}
            />

            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>Preview</Text>
              <Text style={styles.previewText}>Cutoff: {new Date(schedule.predictionCutoff).toLocaleString()}</Text>
              <Text style={styles.previewText}>Event start: {new Date(schedule.eventStartTime).toLocaleString()}</Text>
              <Text style={styles.previewText}>Event end: {new Date(schedule.eventEndTime).toLocaleString()}</Text>
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                createMarketMutation.isPending && styles.disabledButton,
                !account && styles.disabledButton,
              ]}
              disabled={createMarketMutation.isPending || !account}
              onPress={handleCreate}
            >
              <Text style={styles.primaryButtonText}>
                {createMarketMutation.isPending ? 'Creating...' : 'Create Market'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  heroCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  title: { color: theme.colors.text.primary, fontSize: theme.fontSize.xl, fontWeight: '700', marginBottom: theme.spacing.xs },
  contextBadge: {
    alignSelf: 'flex-start',
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(31, 214, 255, 0.12)',
  },
  contextBadgeText: { color: theme.colors.secondary, fontSize: theme.fontSize.xs, fontWeight: '700' },
  formCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  label: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.xs, marginTop: theme.spacing.sm },
  input: {
    backgroundColor: '#12131A',
    color: theme.colors.text.primary,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  previewCard: {
    marginTop: theme.spacing.md,
    backgroundColor: '#12131A',
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  previewTitle: { color: theme.colors.text.primary, fontSize: theme.fontSize.sm, fontWeight: '700' },
  previewText: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm },
  primaryButton: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: theme.colors.text.primary, fontSize: theme.fontSize.md, fontWeight: '700' },
  disabledButton: { opacity: 0.55 },
})
