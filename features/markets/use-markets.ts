import { useQueries, useQuery } from '@tanstack/react-query'
import { getMarketPositions, getMarketResolution, getMarkets } from '@/features/markets/markets.api'

export function useMarkets() {
  return useQuery({
    queryKey: ['markets', 'all'],
    queryFn: () => getMarkets(),
  })
}

export function useMarketsSupplemental(markets: Array<{ id: string }>) {
  return useQueries({
    queries: markets.map((market) => ({
      queryKey: ['markets', market.id, 'positions'],
      queryFn: () => getMarketPositions(market.id),
    })),
  })
}

export function useResolvedMarkets(markets: Array<{ id: string; status: string }>) {
  return useQueries({
    queries: markets
      .filter((market) => market.status === 'resolved' || market.status === 'settled')
      .map((market) => ({
        queryKey: ['markets', market.id, 'resolution'],
        queryFn: () => getMarketResolution(market.id),
      })),
  })
}
