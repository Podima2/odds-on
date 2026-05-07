import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'
import { AppProviders } from '@/components/app-providers'

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="feed/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="create-stream" />
        <Stack.Screen name="create-market" />
        <Stack.Screen name="market/[id]" />
        <Stack.Screen name="challenge/[id]" />
        <Stack.Screen name="result/[id]" />
      </Stack>
      <StatusBar style="auto" />
    </AppProviders>
  )
}
