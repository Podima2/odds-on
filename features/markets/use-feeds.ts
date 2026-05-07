import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFeed,
  createFeedSession,
  CreateFeedPayload,
  CreateFeedSessionPayload,
  getFeed,
  getFeedMarkets,
  getFeeds,
  getFeedSessions,
} from '@/features/markets/markets.api'

export function useFeeds() {
  return useQuery({
    queryKey: ['feeds'],
    queryFn: () => getFeeds(),
    refetchInterval: 10_000,
  })
}

export function useFeed(feedId: string) {
  return useQuery({
    queryKey: ['feeds', feedId],
    queryFn: () => getFeed(feedId),
    enabled: Boolean(feedId),
  })
}

export function useFeedSessions(feedId: string, status?: 'planned' | 'live' | 'ended') {
  return useQuery({
    queryKey: ['feeds', feedId, 'sessions', status ?? 'all'],
    queryFn: () => getFeedSessions(feedId, status),
    enabled: Boolean(feedId),
    refetchInterval: status === 'live' || status === undefined ? 10_000 : false,
  })
}

export function useFeedMarkets(feedId: string) {
  return useQuery({
    queryKey: ['feeds', feedId, 'markets'],
    queryFn: () => getFeedMarkets(feedId),
    enabled: Boolean(feedId),
    refetchInterval: 8_000,
  })
}

export function useCreateFeed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateFeedPayload) => createFeed(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['feeds'] })
    },
  })
}

export function useCreateFeedSession(feedId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateFeedSessionPayload) => createFeedSession(feedId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['feeds'] }),
        queryClient.invalidateQueries({ queryKey: ['feeds', feedId, 'sessions'] }),
      ])
    },
  })
}
