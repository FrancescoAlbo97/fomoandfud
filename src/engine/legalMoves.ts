import type { TradeActionInput } from './decisions'
import { getPlayer } from './engine'
import { purchaseCost } from './market'
import type { GameState, OrderTarget } from './types'

export function legalTradeActions(state: GameState, playerId: string): TradeActionInput[] {
  const player = getPlayer(state, playerId)
  const actions: TradeActionInput[] = []

  state.market.forEach((_, i) => {
    if (player.cash >= purchaseCost(state, i)) actions.push({ kind: 'buy', marketIndex: i })
  })
  for (const card of player.actionCards) {
    actions.push({ kind: 'sell', cardInstanceId: card.instanceId })
  }
  if (player.ipoUsesThisRound < state.config.ipoPerRound && player.cash >= state.config.ipoCost && state.market.length > 0) {
    actions.push({ kind: 'ipo' })
  }
  if (state.round <= state.config.etfAbandonUntilRound) {
    for (const card of player.etfCards) {
      const def = state.config.etfById[card.defId]
      if (player.cash >= def.fireSaleCost) actions.push({ kind: 'abandonEtf', cardInstanceId: card.instanceId })
    }
  }
  actions.push({ kind: 'end' })
  return actions
}

export function legalOrderTargets(state: GameState, playerId: string): OrderTarget[] {
  const targets: OrderTarget[] = []
  for (const sector of state.config.sectorIds) {
    targets.push({ kind: 'sector', sector, direction: 'up' })
    targets.push({ kind: 'sector', sector, direction: 'down' })
  }
  targets.push({ kind: 'fees', direction: 'up' })
  targets.push({ kind: 'fees', direction: 'down' })
  for (const opponent of state.players) {
    if (opponent.id === playerId) continue
    targets.push({ kind: 'opponent', direction: 'up', opponentId: opponent.id })
    targets.push({ kind: 'opponent', direction: 'down', opponentId: opponent.id })
  }
  return targets
}
