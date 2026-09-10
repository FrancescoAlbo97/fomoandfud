import type { GameState, PlayerState, ScoreResult, SectorId } from './types'

export function holdingsBySector(state: GameState, player: PlayerState): Record<SectorId, number> {
  const counts: Record<SectorId, number> = {}
  for (const id of state.config.sectorIds) counts[id] = 0
  for (const card of player.actionCards) {
    counts[state.config.actionById[card.defId].sector] += 1
  }
  return counts
}

export function etfSatisfied(
  counts: Record<SectorId, number>,
  requirement: Partial<Record<SectorId, number>>,
): boolean {
  return (Object.entries(requirement) as [SectorId, number][]).every(
    ([sector, needed]) => (counts[sector] ?? 0) >= needed,
  )
}

/** Quante Carte Azione mancano ancora per completare l'ETF. 0 = completo. */
export function etfCardsMissing(
  counts: Record<SectorId, number>,
  requirement: Partial<Record<SectorId, number>>,
): number {
  return (Object.entries(requirement) as [SectorId, number][]).reduce(
    (missing, [sector, needed]) => missing + Math.max(0, needed - (counts[sector] ?? 0)),
    0,
  )
}

export function computeScores(state: GameState): ScoreResult[] {
  return state.players.map((player): ScoreResult => {
    const holdingsValue = player.actionCards.reduce(
      (sum, card) => sum + state.sectors[state.config.actionById[card.defId].sector],
      0,
    )
    const wealth = player.cash + holdingsValue
    const wealthPV = Math.floor(wealth / state.config.wealthPerPV)

    const counts = holdingsBySector(state, player)
    const completedEtfs: string[] = []
    let etfPV = 0
    for (const etfCard of player.etfCards) {
      const def = state.config.etfById[etfCard.defId]
      if (etfSatisfied(counts, def.requirement)) {
        completedEtfs.push(def.id)
        etfPV += def.pv
      }
    }

    return {
      playerId: player.id,
      cash: player.cash,
      holdingsValue,
      wealth,
      wealthPV,
      etfPV,
      totalPV: wealthPV + etfPV,
      completedEtfs,
    }
  })
}

/** §11.5 — most total PV wins; ties broken by ETF PV, then cash, then Action cards in hand. */
export function rankResults(state: GameState, results: ScoreResult[]): ScoreResult[] {
  const playerById = new Map(state.players.map((p) => [p.id, p]))
  return [...results].sort((a, b) => {
    if (b.totalPV !== a.totalPV) return b.totalPV - a.totalPV
    if (b.etfPV !== a.etfPV) return b.etfPV - a.etfPV
    if (b.cash !== a.cash) return b.cash - a.cash
    const aCards = playerById.get(a.playerId)?.actionCards.length ?? 0
    const bCards = playerById.get(b.playerId)?.actionCards.length ?? 0
    return bCards - aCards
  })
}
