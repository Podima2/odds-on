import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createMarket,
  CreateMarketPayload,
  getMarketAgentRuns,
  getMarket,
  getMarketEvidence,
  getMarketPositions,
  getMarketReadings,
  getMarketResolution,
  requestDevnetAirdrop,
  resolveMarket,
  syncMarket,
  submitMarketEvidence,
  SubmitEvidenceInput,
} from '@/features/markets/markets.api'

export function useMarket(marketId: string) {
  return useQuery({
    queryKey: ['markets', marketId],
    queryFn: () => getMarket(marketId),
    enabled: Boolean(marketId),
  })
}

export function useMarketPositions(marketId: string) {
  return useQuery({
    queryKey: ['markets', marketId, 'positions'],
    queryFn: () => getMarketPositions(marketId),
    enabled: Boolean(marketId),
  })
}

export function useMarketEvidence(marketId: string) {
  return useQuery({
    queryKey: ['markets', marketId, 'evidence'],
    queryFn: () => getMarketEvidence(marketId),
    enabled: Boolean(marketId),
  })
}

export function useMarketReadings(marketId: string) {
  return useQuery({
    queryKey: ['markets', marketId, 'readings'],
    queryFn: () => getMarketReadings(marketId),
    enabled: Boolean(marketId),
  })
}

export function useMarketResolution(marketId: string) {
  return useQuery({
    queryKey: ['markets', marketId, 'resolution'],
    queryFn: () => getMarketResolution(marketId),
    enabled: Boolean(marketId),
    retry: false,
  })
}

export function useMarketAgentRuns(marketId: string) {
  return useQuery({
    queryKey: ['markets', marketId, 'agent-runs'],
    queryFn: () => getMarketAgentRuns(marketId),
    enabled: Boolean(marketId),
    refetchInterval: (query) => {
      const latest = query.state.data?.[0]
      return latest && ['queued', 'running'].includes(latest.status) ? 2000 : false
    },
  })
}

export function useSubmitMarketEvidence(marketId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: SubmitEvidenceInput) => submitMarketEvidence(marketId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'evidence'] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'readings'] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId] }),
      ])
    },
  })
}

export function useResolveMarket(marketId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => resolveMarket(marketId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['markets', marketId] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'resolution'] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'agent-runs'] }),
        queryClient.invalidateQueries({ queryKey: ['markets'] }),
      ])
    },
  })
}

export function useCreateMarket() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateMarketPayload) => createMarket(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['markets'] })
    },
  })
}

export function useRequestDevnetAirdrop() {
  return useMutation({
    mutationFn: (walletAddress: string) => requestDevnetAirdrop(walletAddress),
  })
}

export function useSyncMarket(marketId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => syncMarket(marketId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['markets', marketId] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'positions'] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'resolution'] }),
        queryClient.invalidateQueries({ queryKey: ['markets', marketId, 'agent-runs'] }),
        queryClient.invalidateQueries({ queryKey: ['markets'] }),
      ])
    },
  })
}
