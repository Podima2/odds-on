import { MarketPosition, MarketRule } from '@/features/markets/markets.types'

export function formatCountdown(isoDate: string) {
  const msRemaining = new Date(isoDate).getTime() - Date.now()
  if (msRemaining <= 0) {
    return 'Closed'
  }

  const totalMinutes = Math.floor(msRemaining / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m left`
  }

  return `${minutes}m left`
}

export function formatRule(rule: MarketRule) {
  return `Target ${rule.operator} ${rule.threshold} BPM inside ${rule.timeWindowSeconds}s`
}

export function getPoolTotals(positions: MarketPosition[]) {
  return positions.reduce(
    (totals, position) => {
      if (position.side === 'YES') totals.yes += position.amount
      if (position.side === 'NO') totals.no += position.amount
      return totals
    },
    { yes: 0, no: 0 }
  )
}

export function formatSolFromLamports(lamports: number) {
  return (lamports / 1_000_000_000).toFixed(lamports % 1_000_000_000 === 0 ? 0 : 2)
}

export function getImpliedOdds(yesLamports: number, noLamports: number) {
  const total = yesLamports + noLamports
  if (total === 0) {
    return { yes: '1.00', no: '1.00' }
  }

  const yesProbability = yesLamports > 0 ? yesLamports / total : 0.5
  const noProbability = noLamports > 0 ? noLamports / total : 0.5

  return {
    yes: (1 / yesProbability).toFixed(2),
    no: (1 / noProbability).toFixed(2),
  }
}
