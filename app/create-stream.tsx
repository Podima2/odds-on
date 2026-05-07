import React, { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, router } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { theme } from '@/constants/theme'
import { getStreamThumbnailFallback, normalizeStreamUrl } from '@/features/markets/feed-media'
import { createFeedSession } from '@/features/markets/markets.api'
import { useCreateFeed } from '@/features/markets/use-feeds'

export default function CreateStreamScreen() {
  const { account, connect } = useMobileWallet()
  const createFeedMutation = useCreateFeed()
  const [title, setTitle] = useState('')
  const [thumbnailUrl, setThumbnailUrl] = useState('')
  const [embedUrl, setEmbedUrl] = useState('')
  const [deviceLabel, setDeviceLabel] = useState('android-ble')

  async function handleCreateStream() {
    if (!account) {
      Alert.alert('Wallet required')
      return
    }

    if (!title.trim()) {
      Alert.alert('Title required')
      return
    }

    if (!embedUrl.trim()) {
      Alert.alert('URL required')
      return
    }

    const normalizedStreamUrl = normalizeStreamUrl(embedUrl)
    const normalizedThumbnailUrl = thumbnailUrl.trim() || getStreamThumbnailFallback(normalizedStreamUrl) || undefined

    try {
      const feed = await createFeedMutation.mutateAsync({
        ownerWallet: account.address,
        feedType: 'ble_heart_rate',
        verificationMode: 'structured_oracle_verified',
        title: title.trim(),
      })

      const session = await createFeedSession(feed.id, {
        status: 'live',
        startedAt: new Date().toISOString(),
        sessionMetadata: {
          origin: 'android-app',
          device: deviceLabel.trim() || 'android-ble',
          embedUrl: normalizedStreamUrl,
          thumbnailUrl: normalizedThumbnailUrl,
        },
      })

      router.replace(`/feed/${feed.id}?sessionId=${session.id}`)
    } catch (error) {
      Alert.alert('Unable to create stream', error instanceof Error ? error.message : 'Stream bootstrap failed.')
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Create Stream', headerTintColor: '#FFFFFF', headerStyle: { backgroundColor: theme.colors.background } }} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroCard}>
            <Text style={styles.title}>New Stream</Text>
            <Text style={styles.subtitle}>Only the stream URL is required. Thumbnail is optional.</Text>
          </View>

          {!account ? (
            <TouchableOpacity style={styles.connectButton} onPress={connect}>
              <Text style={styles.connectButtonText}>Connect Wallet</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.formCard}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="PeakPerformance leg day challenge"
              placeholderTextColor={theme.colors.text.tertiary}
            />

            <Text style={styles.label}>Stream URL</Text>
            <TextInput
              style={styles.input}
              value={embedUrl}
              onChangeText={setEmbedUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://youtube.com/live/... or https://... (required)"
              placeholderTextColor={theme.colors.text.tertiary}
            />

            <Text style={styles.label}>Thumbnail URL (optional)</Text>
            <TextInput
              style={styles.input}
              value={thumbnailUrl}
              onChangeText={setThumbnailUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://..."
              placeholderTextColor={theme.colors.text.tertiary}
            />

            <Text style={styles.label}>Device</Text>
            <TextInput
              style={styles.input}
              value={deviceLabel}
              onChangeText={setDeviceLabel}
              placeholder="android-ble"
              placeholderTextColor={theme.colors.text.tertiary}
            />

            <TouchableOpacity
              style={[styles.primaryButton, (!account || createFeedMutation.isPending) && styles.disabledButton]}
              disabled={!account || createFeedMutation.isPending}
              onPress={handleCreateStream}
            >
              <Text style={styles.primaryButtonText}>
                {createFeedMutation.isPending ? 'Creating...' : 'Create Stream'}
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
  subtitle: { color: theme.colors.text.secondary, fontSize: theme.fontSize.sm, lineHeight: 20 },
  connectButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary,
  },
  connectButtonText: { color: theme.colors.text.primary, fontSize: theme.fontSize.sm, fontWeight: '700' },
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
